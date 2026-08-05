/**
 * Vitest per-worker setup file.
 * Closes pg Pool after every test file so the process can exit cleanly.
 */

import { afterAll } from "vitest";

afterAll(async () => {
  try {
    const db = await import("@workspace/db");
    if (typeof (db as any).endPool === "function") {
      await (db as any).endPool();
    }
  } catch { /* DB not loaded — nothing to close */ }
});
