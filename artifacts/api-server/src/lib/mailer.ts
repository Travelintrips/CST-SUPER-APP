import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { logNotification } from "./notificationLog.js";
import {
  getSmtpPass,
  getSmtpPassWithSource,
  getSmtpFromWithSource,
} from "./appSecrets.js";
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

export type SmtpErrorCategory =
  | "CONFIG"
  | "DNS"
  | "CONNECT"
  | "TLS"
  | "AUTH"
  | "MAIL_FROM"
  | "RCPT"
  | "SEND"
  | "UNKNOWN";

type SmtpSource = "ENV" | "DEFAULT" | "DB" | "FALLBACK" | "GCP_ENV";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fingerprint: string;
  sources: {
    host: SmtpSource;
    port: SmtpSource;
    user: SmtpSource;
    pass: SmtpSource;
    from: SmtpSource;
  };
}

export interface SmtpHealthResult {
  status: "ok" | "error" | "unconfigured";
  latencyMs: number | null;
  errorCategory: SmtpErrorCategory | null;
  errorCode: string | null;
  configFingerprint: string | null;
  configSources: SmtpConfig["sources"] | null;
}

export function fingerprintSmtpConfig(input: {
  host: string;
  port: number;
  secure: boolean;
  userPresent: boolean;
  passPresent: boolean;
  fromPresent: boolean;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
}

export function classifySmtpError(err: unknown): {
  category: SmtpErrorCategory;
  code: string | null;
} {
  const error = err as { code?: unknown; responseCode?: unknown; command?: unknown };
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const responseCode =
    typeof error.responseCode === "number" ? error.responseCode : null;

  if (responseCode === 535 || code === "EAUTH") return { category: "AUTH", code: responseCode === 535 ? "SMTP_535" : "EAUTH" };
  if (responseCode === 550) return { category: "MAIL_FROM", code: "SMTP_550" };
  if (responseCode === 553) return { category: "MAIL_FROM", code: "SMTP_553" };
  if (responseCode === 450 || responseCode === 451 || responseCode === 452) {
    return { category: "RCPT", code: `SMTP_${responseCode}` };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { category: "DNS", code };
  if (code === "ECONNREFUSED" || code === "ECONNECTION") return { category: "CONNECT", code };
  if (code === "ETIMEDOUT" || code === "ESOCKET") return { category: "CONNECT", code };
  if (code === "EPROTO" || code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return { category: "TLS", code };
  }
  if (typeof error.command === "string" && error.command.toUpperCase() === "MAIL") {
    return { category: "MAIL_FROM", code: code || null };
  }
  if (typeof error.command === "string" && error.command.toUpperCase() === "RCPT") {
    return { category: "RCPT", code: code || null };
  }
  if (code) return { category: "SEND", code };
  return { category: "UNKNOWN", code: null };
}

export async function resolveSmtpConfig(): Promise<SmtpConfig> {
  const passSetting = await getSmtpPassWithSource();
  const fromSetting = await getSmtpFromWithSource();
  const host = process.env.SMTP_HOST ?? process.env["SMTP-HOST"] ?? "smtp.hostinger.com";
  const port = parseInt(process.env.SMTP_PORT ?? "465", 10);
  const user = process.env.SMTP_USER ?? fromSetting.value;
  const secure = port === 465;
  const sources: SmtpConfig["sources"] = {
    host: process.env.SMTP_HOST || process.env["SMTP-HOST"] ? "ENV" : "DEFAULT",
    port: process.env.SMTP_PORT ? "ENV" : "DEFAULT",
    user: process.env.SMTP_USER ? "ENV" : fromSetting.source === "DB" ? "DB" : "FALLBACK",
    pass: passSetting.source === "DB" ? "DB" : "GCP_ENV",
    from: fromSetting.source === "DB" ? "DB" : "GCP_ENV",
  };
  const fingerprint = fingerprintSmtpConfig({
    host,
    port,
    secure,
    userPresent: Boolean(user),
    passPresent: Boolean(passSetting.value),
    fromPresent: Boolean(fromSetting.value),
  });
  return { host, port, secure, user, pass: passSetting.value, from: fromSetting.value, fingerprint, sources };
}

async function createTransport() {
  const config = await resolveSmtpConfig();
  const { pass, user } = config;

  _hasSmtpKey = !!pass;

  if (!pass) {
    throw new Error("SMTP_PASS belum diset. Masukkan password email Hostinger di Secrets.");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  return { transporter, from: user, config };
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
  errorCategory: SmtpErrorCategory | null;
  errorCode: string | null;
  configFingerprint: string | null;
  configSources: SmtpConfig["sources"] | null;
}> {
  if (externalIntegrationsDisabled()) {
    return {
      status: "unconfigured",
      latencyMs: null,
      errorCategory: null,
      errorCode: null,
      configFingerprint: null,
      configSources: null,
    };
  }

  const startedAt = Date.now();
  let config: SmtpConfig | null = null;
  try {
    config = await resolveSmtpConfig();
    const { transporter } = await createTransport();
    await transporter.verify();
    return {
      status: "ok",
      latencyMs: Date.now() - startedAt,
      errorCategory: null,
      errorCode: null,
      configFingerprint: config.fingerprint,
      configSources: config.sources,
    };
  } catch (err) {
    const classified = classifySmtpError(err);
    return {
      status: "error",
      latencyMs: Date.now() - startedAt,
      errorCategory: classified.category,
      errorCode: classified.code,
      configFingerprint: config?.fingerprint ?? null,
      configSources: config?.sources ?? null,
    };
  }
}
