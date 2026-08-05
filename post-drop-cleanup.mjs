#!/usr/bin/env node
/**
 * post-drop-cleanup.mjs
 *
 * Dijalankan SETELAH lib/db/migrations/next-release-drop-legacy-tables.sql
 * berhasil dieksekusi di production.
 *
 * Yang dilakukan:
 *   1. Verifikasi DB: tabel workflow_events + shipments SUDAH TIDAK ADA
 *   2. Hapus lib/db/src/schema/workflowEvents.ts
 *   3. Hapus lib/db/src/schema/shipments.ts
 *   4. Hapus export keduanya dari lib/db/src/schema/index.ts
 *   5. Hapus artifacts/api-server/src/routes/logistics.ts
 *   6. Jalankan drizzle-kit push agar schema Drizzle sinkron dengan DB
 *
 * Usage:
 *   node post-drop-cleanup.mjs
 *   node post-drop-cleanup.mjs --dry-run      (preview saja, tidak ada perubahan)
 *   node post-drop-cleanup.mjs --skip-push    (lewati drizzle-kit push)
 *
 * Env required:
 *   SUPABASE_PG_URL — connection string ke production DB
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN   = process.argv.includes("--dry-run");
const SKIP_PUSH = process.argv.includes("--skip-push");

// ─── Colours ─────────────────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

const ok   = (msg) => console.log(c.green("  ✅ " + msg));
const warn = (msg) => console.log(c.yellow("  ⚠️  " + msg));
const err  = (msg) => console.error(c.red("  ❌ " + msg));
const info = (msg) => console.log(c.dim("     " + msg));
const head = (msg) => console.log("\n" + c.bold(msg));

// ─── Files to delete ─────────────────────────────────────────────────────────
const FILES_TO_DELETE = [
  "lib/db/src/schema/workflowEvents.ts",
  "lib/db/src/schema/shipments.ts",
  "artifacts/api-server/src/routes/logistics.ts",
];

// Lines to remove from lib/db/src/schema/index.ts
const SCHEMA_INDEX = "lib/db/src/schema/index.ts";
const LINES_TO_REMOVE = [
  'export * from "./shipments";',
  'export * from "./workflowEvents";',
];

// ─── Step 1: DB verification ──────────────────────────────────────────────────
head("Step 1 — Verifikasi DB: tabel legacy harus sudah di-drop");

const pgUrl = process.env.SUPABASE_PG_URL;
if (!pgUrl) {
  err("SUPABASE_PG_URL tidak di-set. Export env var terlebih dulu.");
  process.exit(1);
}

let dbCheckOutput;
try {
  dbCheckOutput = execSync(
    `psql "${pgUrl}" -t -c "
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('workflow_events', 'shipments')
      ORDER BY table_name;"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  ).trim();
} catch (e) {
  err("Tidak dapat terhubung ke DB: " + e.message);
  process.exit(1);
}

const remainingTables = dbCheckOutput
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

if (remainingTables.length > 0) {
  err("Tabel legacy MASIH ADA di DB:");
  remainingTables.forEach((t) => info("  - " + t));
  console.log("");
  console.log(c.red("  ABORT: Jalankan DROP migration terlebih dulu:"));
  console.log(c.dim("    psql \"$SUPABASE_PG_URL\" -f lib/db/migrations/next-release-drop-legacy-tables.sql"));
  process.exit(1);
}

ok("workflow_events — tidak ada di DB");
ok("shipments       — tidak ada di DB");

if (DRY_RUN) {
  warn("DRY-RUN mode: DB check PASS. File cleanup akan dilakukan jika dijalankan tanpa --dry-run.");
}

// ─── Step 2: Hapus schema files ───────────────────────────────────────────────
head("Step 2 — Hapus schema files legacy");

for (const rel of FILES_TO_DELETE) {
  const abs = join(__dirname, rel);
  if (!existsSync(abs)) {
    warn(`${rel} — tidak ditemukan (sudah dihapus sebelumnya?)`);
    continue;
  }
  if (DRY_RUN) {
    info(`[dry-run] Akan dihapus: ${rel}`);
    continue;
  }
  try {
    unlinkSync(abs);
    ok(`Dihapus: ${rel}`);
  } catch (e) {
    err(`Gagal hapus ${rel}: ${e.message}`);
    process.exit(1);
  }
}

// ─── Step 3: Edit schema/index.ts ─────────────────────────────────────────────
head("Step 3 — Update lib/db/src/schema/index.ts");

const idxAbs = join(__dirname, SCHEMA_INDEX);
if (!existsSync(idxAbs)) {
  err(SCHEMA_INDEX + " tidak ditemukan.");
  process.exit(1);
}

const original = readFileSync(idxAbs, "utf8");
let updated = original;
let removed = 0;

for (const line of LINES_TO_REMOVE) {
  if (updated.includes(line + "\n")) {
    if (DRY_RUN) {
      info(`[dry-run] Akan dihapus baris: ${line}`);
    } else {
      updated = updated.replace(line + "\n", "");
    }
    removed++;
  } else if (updated.includes(line)) {
    // tanpa newline (edge case: last line)
    if (DRY_RUN) {
      info(`[dry-run] Akan dihapus baris: ${line}`);
    } else {
      updated = updated.replace(line, "");
    }
    removed++;
  } else {
    warn(`Baris sudah tidak ada di ${SCHEMA_INDEX}: ${line}`);
  }
}

if (!DRY_RUN && removed > 0) {
  writeFileSync(idxAbs, updated, "utf8");
  ok(`${SCHEMA_INDEX} — ${removed} baris dihapus`);
  info('  - export * from "./shipments"');
  info('  - export * from "./workflowEvents"');
} else if (!DRY_RUN && removed === 0) {
  warn("Tidak ada perubahan pada " + SCHEMA_INDEX + " (sudah bersih?)");
}

// ─── Step 4: Verifikasi file cleanup ─────────────────────────────────────────
head("Step 4 — Verifikasi file cleanup");

if (!DRY_RUN) {
  let allGone = true;
  for (const rel of FILES_TO_DELETE) {
    if (existsSync(join(__dirname, rel))) {
      err(`Masih ada: ${rel}`);
      allGone = false;
    }
  }

  const finalIdx = readFileSync(idxAbs, "utf8");
  for (const line of LINES_TO_REMOVE) {
    if (finalIdx.includes(line)) {
      err(`Baris masih ada di ${SCHEMA_INDEX}: ${line}`);
      allGone = false;
    }
  }

  if (allGone) {
    ok("Semua file legacy sudah dihapus");
    ok("schema/index.ts bersih dari referensi legacy");
  } else {
    err("Verifikasi gagal — ada file/baris yang tidak terhapus.");
    process.exit(1);
  }
}

// ─── Step 5: drizzle-kit push ─────────────────────────────────────────────────
head("Step 5 — Drizzle schema sync (drizzle-kit push)");

if (SKIP_PUSH) {
  warn("--skip-push: Drizzle push dilewati.");
} else if (DRY_RUN) {
  info("[dry-run] Akan dijalankan: pnpm --filter @workspace/db run push --force");
} else {
  console.log(c.dim("  Menjalankan: pnpm --filter @workspace/db run push --force"));
  console.log(c.dim("  (Ini akan menyamakan schema Drizzle dengan kondisi DB setelah DROP)\n"));

  let pushOk = false;
  try {
    const pushOutput = execSync(
      "pnpm --filter @workspace/db run push --force",
      {
        encoding: "utf8",
        cwd: __dirname,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
      }
    );
    // Print output baris per baris dengan indent
    pushOutput.trim().split("\n").forEach((l) => info(l));
    pushOk = true;
  } catch (e) {
    // drizzle-kit kadang exit non-zero tapi tetap berhasil — cek output
    const out = (e.stdout || "") + (e.stderr || "");
    out.trim().split("\n").forEach((l) => info(l));

    // Deteksi success pattern dari output drizzle-kit
    const successPatterns = [
      /schema applied/i,
      /no changes detected/i,
      /successfully/i,
      /up to date/i,
    ];
    if (successPatterns.some((p) => p.test(out))) {
      pushOk = true;
    } else {
      warn("drizzle-kit push keluar dengan error. Cek output di atas.");
      warn("Jalankan manual jika diperlukan:");
      info("  pnpm --filter @workspace/db run push --force");
    }
  }

  if (pushOk) {
    ok("drizzle-kit push selesai — schema DB sinkron dengan codebase");
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("");
console.log(c.bold("═══════════════════════════════════════════════════════"));
if (DRY_RUN) {
  console.log(c.yellow("  DRY-RUN SELESAI — tidak ada perubahan dilakukan."));
  console.log(c.yellow("  Jalankan tanpa --dry-run untuk eksekusi aktual:"));
  console.log(c.dim("    node post-drop-cleanup.mjs"));
  console.log(c.dim("    node post-drop-cleanup.mjs --skip-push   (tanpa drizzle push)"));
} else {
  const skipNote = SKIP_PUSH ? c.yellow("  ⚠️  drizzle-kit push dilewati (--skip-push)") : "";
  console.log(c.green("  POST-DROP CLEANUP SELESAI ✅"));
  if (skipNote) console.log(skipNote);
  console.log("");
  console.log(c.dim("  Langkah selanjutnya:"));
  if (SKIP_PUSH) {
    console.log(c.dim("  0. Sync schema Drizzle (karena --skip-push):"));
    console.log(c.dim("       pnpm --filter @workspace/db run push --force"));
  }
  console.log(c.dim("  1. Rebuild API server:"));
  console.log(c.dim("       cd artifacts/api-server && node build.mjs"));
  console.log(c.dim("  2. Regenerate API client:"));
  console.log(c.dim("       pnpm --filter @workspace/api-client-react run codegen"));
  console.log(c.dim("  3. Restart workflow API Server"));
  console.log(c.dim("  4. Verifikasi healthz: curl http://localhost:8080/healthz"));
  console.log(c.dim("  5. Commit perubahan ke version control"));
}
console.log(c.bold("═══════════════════════════════════════════════════════"));
console.log("");
