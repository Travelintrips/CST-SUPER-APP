import { logger } from "./logger.js";
import { logNotification, wasRecentlyNotified } from "./notificationLog.js";
import { getFonnteToken } from "./appSecrets.js";
import { isSafeDevTestMode } from "./safeDev.js";

const FONNTE_URL = "https://api.fonnte.com/send";

const DEDUP_WINDOW_MS = parseInt(process.env.WA_DEDUP_WINDOW_MS ?? "1800000", 10);

/** E2E test mode — jangan kirim WA sungguhan, cukup catat ke notification_logs sebagai 'simulated'. */
function isE2ETestMode(): boolean {
  return process.env.E2E_TEST_MODE === "true" || isSafeDevTestMode();
}

function normalizePhoneID(raw: string): string {
  if (raw.includes("@")) return raw.trim();
  let digits = raw.replace(/[^\d+]/g, "");
  digits = digits.replace(/^\+/, "");
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  return "62" + digits;
}

/** Ambil wa_message_id dari respons Fonnte jika ada */
function extractMessageId(body: Record<string, unknown>): string | undefined {
  const raw = body.id ?? body.message_id ?? body.messageId;
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]) : undefined;
  return String(raw);
}

export async function sendWhatsAppMedia(
  target: string,
  message: string,
  mediaUrl: string,
  opts?: { context?: string; refType?: string; refId?: string },
): Promise<void> {
  if (!mediaUrl?.trim()) {
    return sendWhatsApp(target, message, opts);
  }
  if (isE2ETestMode()) {
    logger.info({ target, mediaUrl, context: opts?.context, refId: opts?.refId }, "[SAFE_DEV_TEST_MODE] WA media simulated — not sent");
    await logNotification({
      channel: "wa", recipient: target, message,
      status: "simulated", errorMsg: "SAFE_DEV_TEST_MODE/E2E_TEST_MODE — simulated, not sent",
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
      mediaUrl,
    });
    return;
  }
  const FONNTE_TOKEN = await getFonnteToken();
  if (!FONNTE_TOKEN) {
    logger.warn("FONNTE_TOKEN not set — skipping WhatsApp media notification");
    await logNotification({
      channel: "wa", recipient: target, message,
      status: "failed", errorMsg: "FONNTE_TOKEN not configured",
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
    });
    return;
  }
  if (!target?.trim()) {
    logger.warn("sendWhatsAppMedia: empty target — skipping");
    return;
  }

  if (opts?.context && opts?.refId) {
    const alreadySent = await wasRecentlyNotified(opts.context, opts.refId, DEDUP_WINDOW_MS);
    if (alreadySent) {
      logger.info(
        { context: opts.context, refId: opts.refId, target, windowMs: DEDUP_WINDOW_MS },
        "sendWhatsAppMedia: deduped — same context+refId already sent within window",
      );
      await logNotification({
        channel: "wa", recipient: target, message,
        status: "deduped",
        errorMsg: `Deduped: context=${opts.context} refId=${opts.refId} within ${DEDUP_WINDOW_MS}ms`,
        context: opts.context, refType: opts.refType, refId: opts.refId,
      });
      return;
    }
  }

  const phone = normalizePhoneID(target);
  if (!phone.includes("@") && phone.length < 10) {
    logger.warn({ raw: target, normalized: phone }, "sendWhatsAppMedia: phone too short — skipping");
    await logNotification({
      channel: "wa", recipient: target, message,
      status: "failed", errorMsg: "Phone number too short",
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
    });
    return;
  }

  try {
    const params: Record<string, string> = { target: phone, message, url: mediaUrl };
    const res = await fetch(FONNTE_URL, {
      method: "POST",
      headers: {
        Authorization: FONNTE_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    const body = await res.json() as unknown;
    if (!res.ok) {
      logger.warn({ status: res.status, body, phone, mediaUrl }, "Fonnte media: non-OK status");
      await logNotification({
        channel: "wa", recipient: phone, message,
        status: "failed", errorMsg: `HTTP ${res.status}`,
        context: opts?.context, refType: opts?.refType, refId: opts?.refId,
        mediaUrl,
      });
    } else {
      const b = body as Record<string, unknown>;
      if (b.status === false || b.status === "false") {
        logger.warn({ body, phone, mediaUrl }, "Fonnte media: status:false (send failed)");
        await logNotification({
          channel: "wa", recipient: phone, message,
          status: "failed", errorMsg: String(b.reason ?? b.message ?? "Fonnte status:false"),
          context: opts?.context, refType: opts?.refType, refId: opts?.refId,
          mediaUrl,
        });
      } else {
        const waMessageId = extractMessageId(b);
        logger.info({ phone, mediaUrl, waMessageId }, "WhatsApp media sent via Fonnte");
        await logNotification({
          channel: "wa", recipient: phone, message,
          status: "sent",
          context: opts?.context, refType: opts?.refType, refId: opts?.refId,
          mediaUrl,
          waMessageId,
        });
      }
    }
  } catch (err) {
    logger.error({ err, phone, mediaUrl }, "Failed to send WhatsApp media via Fonnte");
    await logNotification({
      channel: "wa", recipient: phone, message,
      status: "failed", errorMsg: String(err),
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
      mediaUrl,
    });
  }
}

export async function sendWhatsApp(
  target: string,
  message: string,
  opts?: { context?: string; refType?: string; refId?: string; strict?: boolean },
): Promise<void> {
  // strict=true: throw on any failure (used for OTP/critical sends)
  // strict=false (default): fire-and-forget, only log failures
  const strict = opts?.strict === true;

  if (isE2ETestMode()) {
    logger.info({ target, context: opts?.context, refId: opts?.refId }, "[SAFE_DEV_TEST_MODE] WA simulated — not sent");
    await logNotification({
      channel: "wa", recipient: target, message,
      status: "simulated", errorMsg: "SAFE_DEV_TEST_MODE/E2E_TEST_MODE — simulated, not sent",
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
    });
    return;
  }
  const FONNTE_TOKEN = await getFonnteToken();
  if (!FONNTE_TOKEN) {
    logger.warn("FONNTE_TOKEN not set — skipping WhatsApp notification");
    await logNotification({
      channel: "wa", recipient: target, message,
      status: "failed", errorMsg: "FONNTE_TOKEN not configured",
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
    });
    if (strict) throw new Error("FONNTE_TOKEN tidak dikonfigurasi. Hubungi admin.");
    return;
  }
  if (!target?.trim()) {
    logger.warn("sendWhatsApp: empty target — skipping");
    if (strict) throw new Error("Nomor tujuan WhatsApp kosong.");
    return;
  }

  if (opts?.context && opts?.refId) {
    const alreadySent = await wasRecentlyNotified(opts.context, opts.refId, DEDUP_WINDOW_MS);
    if (alreadySent) {
      logger.info(
        { context: opts.context, refId: opts.refId, target, windowMs: DEDUP_WINDOW_MS },
        "sendWhatsApp: deduped — same context+refId already sent within window",
      );
      await logNotification({
        channel: "wa", recipient: target, message,
        status: "deduped",
        errorMsg: `Deduped: context=${opts.context} refId=${opts.refId} within ${DEDUP_WINDOW_MS}ms`,
        context: opts.context, refType: opts.refType, refId: opts.refId,
      });
      return;
    }
  }

  const phone = normalizePhoneID(target);
  if (!phone.includes("@") && phone.length < 10) {
    logger.warn({ raw: target, normalized: phone }, "sendWhatsApp: phone too short — skipping");
    await logNotification({
      channel: "wa", recipient: target, message,
      status: "failed", errorMsg: "Phone number too short",
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
    });
    if (strict) throw new Error("Format nomor HP tidak valid.");
    return;
  }

  try {
    const res = await fetch(FONNTE_URL, {
      method: "POST",
      headers: {
        Authorization: FONNTE_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ target: phone, message }).toString(),
    });
    const body = await res.json() as unknown;
    if (!res.ok) {
      const errMsg = `Fonnte HTTP ${res.status}`;
      logger.warn({ status: res.status, body, phone }, "Fonnte responded with non-OK status");
      await logNotification({
        channel: "wa", recipient: phone, message,
        status: "failed", errorMsg: errMsg,
        context: opts?.context, refType: opts?.refType, refId: opts?.refId,
      });
      if (strict) throw new Error(`Gagal mengirim WhatsApp: ${errMsg}`);
    } else {
      const b = body as Record<string, unknown>;
      if (b.status === false || b.status === "false") {
        const reason = String(b.reason ?? b.message ?? "Fonnte status:false");
        logger.warn({ body, phone }, "Fonnte returned status:false (send failed)");
        await logNotification({
          channel: "wa", recipient: phone, message,
          status: "failed", errorMsg: reason,
          context: opts?.context, refType: opts?.refType, refId: opts?.refId,
        });
        if (strict) throw new Error(`Gagal mengirim WhatsApp: ${reason}`);
      } else {
        const waMessageId = extractMessageId(b);
        logger.info({ phone, waMessageId }, "WhatsApp sent via Fonnte");
        await logNotification({
          channel: "wa", recipient: phone, message,
          status: "sent",
          context: opts?.context, refType: opts?.refType, refId: opts?.refId,
          waMessageId,
        });
      }
    }
  } catch (err) {
    // Re-throw if already a strict error we threw above
    if (strict && err instanceof Error && err.message.startsWith("Gagal mengirim WhatsApp:")) throw err;
    logger.error({ err, phone }, "Failed to send WhatsApp via Fonnte");
    await logNotification({
      channel: "wa", recipient: phone, message,
      status: "failed", errorMsg: String(err),
      context: opts?.context, refType: opts?.refType, refId: opts?.refId,
    });
    if (strict) throw new Error(`Gagal mengirim WhatsApp: ${String(err)}`);
  }
}
