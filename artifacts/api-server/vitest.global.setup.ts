/**
 * Vitest Global Setup — DB pool teardown
 *
 * Dipanggil sekali SETELAH semua test file selesai.
 * Menutup pool secara eksplisit agar proses bisa exit tanpa SIGKILL.
 *
 * Kenapa ini diperlukan:
 *   - pg.Pool dengan allowExitOnIdle: false (production default) menahan event loop.
 *   - allowExitOnIdle: true (test mode) membantu, tapi teardown eksplisit memastikan
 *     pool ditutup segera meski masih ada idle client yang belum di-release.
 *   - File ini TIDAK dijalankan di production — hanya oleh vitest runner.
 */

export async function setup(): Promise<void> {
  // nothing needed before tests
}

export async function teardown(): Promise<void> {
  try {
    // Dynamic import agar pool hanya di-close jika memang pernah dibuat
    // (Batch 3 pure-logic tests tidak pernah menyentuh @workspace/db)
    const dbModule = await import("@workspace/db");
    if (typeof (dbModule as any).endPool === "function") {
      await (dbModule as any).endPool();
    }
  } catch {
    // Pool belum pernah dibuat (test pure-logic) — tidak ada yang perlu ditutup
  }
}
