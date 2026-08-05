/**
 * criticalAlert — kirim alert LANGSUNG via WhatsApp ke grup admin DAN log sebagai error.
 *
 * Gunakan untuk kondisi yang membutuhkan respons segera dari tim teknis:
 *   - Tax capture gagal DAN queue juga gagal
 *   - Audit log gagal DAN fallback juga gagal
 *   - Kondisi lain yang mengindikasikan data loss
 *
 * Alert WA bersifat non-blocking — kegagalan kirim WA TIDAK melempar exception.
 */

import { logger } from "./logger.js";

export async function criticalAlert(
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  // Selalu log sebagai error dulu — ini yang ditangkap oleh log monitoring
  logger.error({ ...context, isCriticalAlert: true }, `[CRITICAL] ${message}`);

  // Kirim WA ke grup admin — non-blocking, fire-and-forget
  (async () => {
    try {
      const { getAdminGroupWa } = await import("./adminWa.js");
      const { sendWhatsApp }    = await import("./fonnte.js");
      const adminGroup = await getAdminGroupWa();
      if (!adminGroup) return;

      const ctxLines = Object.entries(context)
        .slice(0, 6) // batasi agar pesan tidak terlalu panjang
        .map(([k, v]) => `• ${k}: ${String(v).slice(0, 80)}`)
        .join("\n");

      const body = [
        "🚨 *CRITICAL ALERT — CST Super App*",
        "",
        message,
        "",
        ctxLines,
        "",
        `_${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}_`,
      ]
        .filter((l) => l !== undefined)
        .join("\n");

      await sendWhatsApp(adminGroup, body, { context: "critical_alert" });
    } catch (e) {
      // Jangan throw — alert WA yang gagal tidak boleh memperburuk kondisi kritis
      logger.error({ err: e }, "[criticalAlert] Gagal kirim WhatsApp alert (non-fatal)");
    }
  })();
}
