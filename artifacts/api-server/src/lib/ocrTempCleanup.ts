import { logger } from "./logger.js";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const OCR_TEMP_FOLDER = "ocr-temp";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRIVATE_BUCKET = "private-uploads";

function getSupabase() {
  // Dev mode: do not connect to production Supabase storage
  if (!process.env.REPLIT_DEPLOYMENT) return null;
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return null;
  const normalized = url.startsWith("https://") ? url : `https://${url}.supabase.co`;
  return createClient(normalized, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

export async function cleanupOcrTempFiles(): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;
  try {
    const sb = getSupabase();
    if (!sb) return { deleted, errors };
    const { data: files } = await sb.storage.from(PRIVATE_BUCKET).list(OCR_TEMP_FOLDER);
    if (!files) return { deleted, errors };
    const cutoff = Date.now() - MAX_AGE_MS;
    const toDelete = files
      .filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff)
      .map((f) => `${OCR_TEMP_FOLDER}/${f.name}`);
    if (toDelete.length > 0) {
      const { error } = await sb.storage.from(PRIVATE_BUCKET).remove(toDelete);
      if (!error) deleted = toDelete.length;
      else { logger.warn({ err: error }, "OCR temp cleanup: delete error"); errors++; }
    }
  } catch (err) {
    logger.warn({ err }, "OCR temp cleanup: unexpected error (non-fatal)");
    errors++;
  }
  return { deleted, errors };
}

export function startOcrTempCleanup(): void {
  const run = () => {
    cleanupOcrTempFiles().catch((err) => {
      logger.warn({ err }, "OCR temp cleanup scheduler error");
    });
  };
  run();
  setInterval(run, RUN_INTERVAL_MS).unref();
  logger.info(
    { intervalHours: RUN_INTERVAL_MS / 3600000, maxAgeHours: MAX_AGE_MS / 3600000 },
    "OCR temp cleanup scheduler started",
  );
}
