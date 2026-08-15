import nodemailer from "nodemailer";
import { logNotification } from "./notificationLog.js";
import { getSmtpPass, getSmtpFrom } from "./appSecrets.js";
import { getCachedOrEnvConfig } from "./appConfig.js";
import { externalIntegrationsDisabled } from "./safeDev.js";

let _hasSmtpKey: boolean = !!(process.env.SMTP_PASS?.trim());

export function isSmtpConfigured(): boolean {
  if (externalIntegrationsDisabled()) return false;
  return _hasSmtpKey || !!getCachedOrEnvConfig("SMTP_PASS");
}

export async function warmupMailer(): Promise<void> {
  if (externalIntegrationsDisabled()) return;
  try {
    const pass = await getSmtpPass();
    _hasSmtpKey = !!pass;
  } catch { }
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  context?: string;
  refType?: string;
  refId?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

async function createTransport() {
  const pass = await getSmtpPass();
  const from = await getSmtpFrom();

  _hasSmtpKey = !!pass;

  if (!pass) {
    throw new Error("SMTP_PASS belum diset. Masukkan password email Hostinger di Secrets.");
  }

  const host = process.env.SMTP_HOST ?? process.env["SMTP-HOST"] ?? "smtp.hostinger.com";
  const port = parseInt(process.env.SMTP_PORT ?? "465", 10);
  const user = process.env.SMTP_USER ?? from;
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  return { transporter, from: user };
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  if (externalIntegrationsDisabled()) {
    await logNotification({
      channel: "email",
      recipient: opts.to,
      subject: opts.subject,
      message: opts.text,
      status: "simulated",
      errorMsg: "TEST_MODE — simulated, not sent",
      context: opts.context,
      refType: opts.refType,
      refId: opts.refId,
    });
    return;
  }

  const { transporter, from } = await createTransport();

  const attachments = opts.attachments?.map((a) => ({
    filename: a.filename,
    content: a.content,
    contentType: a.contentType,
  }));

  try {
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logNotification({
      channel: "email",
      recipient: opts.to,
      subject: opts.subject,
      message: opts.text,
      status: "failed",
      errorMsg: errMsg,
      context: opts.context,
      refType: opts.refType,
      refId: opts.refId,
    });
    throw new Error(`SMTP error: ${errMsg}`);
  }

  await logNotification({
    channel: "email",
    recipient: opts.to,
    subject: opts.subject,
    message: opts.text,
    status: "sent",
    context: opts.context,
    refType: opts.refType,
    refId: opts.refId,
  });
}

/**
 * Verify the same SMTP transport used by application email delivery.
 * This intentionally does not send a message; it only validates the
 * configured credentials and connection.
 */
export async function checkSmtpConnection(): Promise<{
  status: "ok" | "error" | "unconfigured";
  latencyMs: number | null;
  detail?: string;
}> {
  if (externalIntegrationsDisabled()) {
    return { status: "unconfigured", latencyMs: null };
  }

  const startedAt = Date.now();
  try {
    const { transporter } = await createTransport();
    await transporter.verify();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - startedAt,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
