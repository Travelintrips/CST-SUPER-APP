/**
 * featuredProductExpiryWorker.ts — Fase 9
 *
 * Background worker: setiap tick, mengaktifkan-nonaktifkan (expire) Produk
 * Unggulan yang approvedEndAt-nya sudah lewat, dan mengirim reminder H-3
 * untuk yang akan segera berakhir. Registered via registerWorker() di index.ts
 * dengan stagger delay agar tidak bentrok start-up dengan worker lain.
 */

import { logger } from "../logger.js";
import { expireFeaturedProducts, notifyExpiringSoonFeaturedProducts } from "./marketplaceFeaturedProductService.js";

const WORKER_INTERVAL_MS = 15 * 60 * 1000; // 15 menit
const WORKER_INITIAL_DELAY_MS = 10_000;

let _running = false;

async function runCycle(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const { expired } = await expireFeaturedProducts();
    if (expired > 0) logger.info({ expired }, "[featuredProductExpiryWorker] Produk unggulan kedaluwarsa diproses");

    const { notified } = await notifyExpiringSoonFeaturedProducts(3);
    if (notified > 0) logger.info({ notified }, "[featuredProductExpiryWorker] Reminder H-3 dikirim");
  } catch (err) {
    logger.error({ err }, "[featuredProductExpiryWorker] Cycle error");
  } finally {
    _running = false;
  }
}

export function startFeaturedProductExpiryWorker(): void {
  setTimeout(() => {
    void runCycle();
    setInterval(() => {
      void runCycle();
    }, WORKER_INTERVAL_MS);
  }, WORKER_INITIAL_DELAY_MS);

  logger.info(
    { initialDelayMs: WORKER_INITIAL_DELAY_MS, intervalMs: WORKER_INTERVAL_MS },
    "[featuredProductExpiryWorker] Worker terdaftar",
  );
}
