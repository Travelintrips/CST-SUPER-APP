#!/usr/bin/env node
/**
 * setup-dev-supabase.mjs
 *
 * Script interaktif untuk menambahkan kunci _DEV ke GCP Secret Manager
 * sehingga preview/dev memakai database Supabase terpisah dari production.
 *
 * Prasyarat:
 *   - GCP_PROJECT_ID, GCP_SECRET_ID, GCP_SECRET_MANAGER_BOOTSTRAP_JSON ada di environment
 *   - node load-secrets.mjs sudah berjalan (atau env vars bootstrap sudah di-set)
 *
 * Cara pakai:
 *   cd artifacts/api-server && node load-secrets.mjs node ../../scripts/setup-dev-supabase.mjs
 *   atau (jika env vars sudah ada):
 *   node scripts/setup-dev-supabase.mjs
 *
 * Apa yang dilakukan:
 *   1. Membaca payload GCP Secret Manager saat ini
 *   2. Menampilkan key _DEV yang belum dikonfigurasi
 *   3. Meminta nilai dev Supabase dari stdin
 *   4. Menulis payload baru ke GCP Secret Manager (versi baru)
 *   5. Memverifikasi isolasi berhasil
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const RED    = "\x1b[31m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE   = "\x1b[34m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

// ── Bootstrap validation ──────────────────────────────────────────────────────
const PROJECT_ID     = process.env.GCP_PROJECT_ID;
const SECRET_ID      = process.env.GCP_SECRET_ID;
const BOOTSTRAP_JSON = process.env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON
  ?? process.env.GOOGLE_SECRET_MANAGER_SERVICE_ACCOUNT_JSON;

if (!PROJECT_ID || !SECRET_ID || !BOOTSTRAP_JSON) {
  console.error(`${RED}ERROR: Bootstrap credentials GCP tidak lengkap.${RESET}`);
  console.error("Diperlukan: GCP_PROJECT_ID, GCP_SECRET_ID, GCP_SECRET_MANAGER_BOOTSTRAP_JSON");
  console.error("");
  console.error("Cara pakai dari workspace root:");
  console.error("  cd artifacts/api-server && node load-secrets.mjs node ../../scripts/setup-dev-supabase.mjs");
  process.exit(1);
}

// ── Keys yang butuh _DEV variant untuk isolasi penuh ─────────────────────────
// Setiap entry: { devKey, canonicalKey, description, required }
const DEV_KEYS = [
  {
    devKey:       "SUPABASE_DATABASE_URL_DEV",
    canonicalKey: "SUPABASE_DATABASE_URL",
    description:  "PostgreSQL connection string (pooler mode port 6543)\n     Format: postgres://postgres.[ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    required:     true,
    isUrl:        true,
  },
  {
    devKey:       "SUPABASE_URL_DEV",
    canonicalKey: "SUPABASE_URL",
    description:  "Supabase project API URL\n     Format: https://[project-ref].supabase.co",
    required:     true,
    isUrl:        false,
  },
  {
    devKey:       "SUPABASE_ANON_KEY_DEV",
    canonicalKey: "SUPABASE_ANON_KEY",
    description:  "Supabase anon/public key (JWT, dimulai dengan eyJ...)",
    required:     true,
    isUrl:        false,
  },
  {
    devKey:       "SUPABASE_SERVICE_ROLE_KEY_DEV",
    canonicalKey: "SUPABASE_SERVICE_ROLE_KEY",
    description:  "Supabase service role key (JWT dengan elevated privileges)",
    required:     true,
    isUrl:        false,
  },
  {
    devKey:       "VITE_SUPABASE_URL_DEV",
    canonicalKey: "VITE_SUPABASE_URL",
    description:  "Supabase URL untuk frontend bundle (biasanya sama dengan SUPABASE_URL_DEV)\n     Tekan Enter untuk copy dari SUPABASE_URL_DEV",
    required:     false,
    isUrl:        false,
    copyFrom:     "SUPABASE_URL_DEV",
  },
  {
    devKey:       "VITE_SUPABASE_ANON_KEY_DEV",
    canonicalKey: "VITE_SUPABASE_ANON_KEY",
    description:  "Supabase anon key untuk frontend bundle (biasanya sama dengan SUPABASE_ANON_KEY_DEV)\n     Tekan Enter untuk copy dari SUPABASE_ANON_KEY_DEV",
    required:     false,
    isUrl:        false,
    copyFrom:     "SUPABASE_ANON_KEY_DEV",
  },
  {
    devKey:       "SUPABASE_STORAGE_BUCKET_DEV",
    canonicalKey: "SUPABASE_STORAGE_BUCKET",
    description:  "Storage bucket name di project dev (biasanya 'assets' atau 'public')\n     Tekan Enter untuk skip (pakai bucket prod — upload file tidak akan terisolasi)",
    required:     false,
    isUrl:        false,
  },
];

// ── Baca payload GCP Secret Manager ──────────────────────────────────────────
async function readCurrentPayload() {
  let credentials;
  try {
    credentials = JSON.parse(BOOTSTRAP_JSON);
  } catch {
    console.error(`${RED}ERROR: GCP_SECRET_MANAGER_BOOTSTRAP_JSON bukan JSON valid.${RESET}`);
    process.exit(1);
  }

  const client = new SecretManagerServiceClient({ credentials });
  const secretName = `projects/${PROJECT_ID}/secrets/${SECRET_ID}/versions/latest`;

  console.log(`\n${BLUE}Membaca payload GCP Secret Manager...${RESET}`);
  console.log(`  ${secretName}`);

  const [version] = await client.accessSecretVersion({ name: secretName });
  const raw = version.payload?.data?.toString("utf8");
  if (!raw) {
    console.error(`${RED}ERROR: Payload kosong.${RESET}`);
    process.exit(1);
  }
  const payload = JSON.parse(raw);
  console.log(`${GREEN}✓ Payload berhasil dibaca (${Object.keys(payload).length} keys)${RESET}`);
  return { client, payload };
}

// ── Tulis payload baru ke GCP Secret Manager ─────────────────────────────────
async function writeNewPayload(client, payload) {
  const secretPath = `projects/${PROJECT_ID}/secrets/${SECRET_ID}`;
  const payloadStr = JSON.stringify(payload, null, 2);

  console.log(`\n${BLUE}Menulis versi baru ke GCP Secret Manager...${RESET}`);
  const [version] = await client.addSecretVersion({
    parent: secretPath,
    payload: {
      data: Buffer.from(payloadStr, "utf8"),
    },
  });
  const versionName = version.name;
  console.log(`${GREEN}✓ Secret versi baru dibuat: ${versionName}${RESET}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input, output });

try {
  console.log(`\n${BOLD}${BLUE}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${BLUE}  Setup Database Dev Supabase Terpisah${RESET}`);
  console.log(`${BOLD}${BLUE}═══════════════════════════════════════════════════════${RESET}`);
  console.log("\nScript ini akan menambahkan kunci _DEV ke GCP Secret Manager");
  console.log("sehingga environment dev memakai project Supabase yang berbeda dari prod.\n");

  const { client, payload } = await readCurrentPayload();

  // Cek keys mana yang sudah ada
  const existing   = DEV_KEYS.filter(k => payload[k.devKey]);
  const missing    = DEV_KEYS.filter(k => !payload[k.devKey]);

  if (existing.length > 0) {
    console.log(`\n${GREEN}Keys _DEV yang sudah ada (${existing.length}):${RESET}`);
    for (const k of existing) {
      const val = payload[k.devKey];
      const masked = val.length > 20 ? val.slice(0, 10) + "..." + val.slice(-5) : "***";
      console.log(`  ✓ ${k.devKey} = ${masked}`);
    }
  }

  if (missing.length === 0) {
    console.log(`\n${GREEN}✓ Semua kunci _DEV sudah dikonfigurasi! Tidak ada yang perlu ditambahkan.${RESET}`);
    console.log("\nJika data prod masih muncul di dev, restart Gateway workflow.");
    rl.close();
    process.exit(0);
  }

  console.log(`\n${YELLOW}Keys _DEV yang belum dikonfigurasi (${missing.length}):${RESET}`);
  for (const k of missing) {
    const req = k.required ? `${RED}[WAJIB]${RESET}` : `${YELLOW}[opsional]${RESET}`;
    console.log(`  ✗ ${k.devKey} ${req}`);
  }

  console.log(`\n${BOLD}Cara mendapatkan nilai dari Supabase:${RESET}`);
  console.log("  1. Buka https://supabase.com/dashboard/project/<project-ref>/settings/database");
  console.log("     → Transaction Mode (port 6543), salin connection string");
  console.log("  2. Buka https://supabase.com/dashboard/project/<project-ref>/settings/api");
  console.log("     → Project URL, anon key, service_role key");
  console.log("");

  const confirm = await rl.question(`Lanjutkan input nilai _DEV? [y/N] `);
  if (!confirm.trim().toLowerCase().startsWith("y")) {
    console.log("Dibatalkan.");
    rl.close();
    process.exit(0);
  }

  const newValues = {};
  const providedValues = {};

  for (const k of missing) {
    console.log(`\n${BOLD}${k.devKey}${RESET}`);
    console.log(`  Untuk: ${k.canonicalKey} (dipakai API dan frontend saat dev)`);
    console.log(`  ${k.description}`);

    // Jika bisa copy dari key lain yang sudah diisi
    if (k.copyFrom && providedValues[k.copyFrom]) {
      const suggestion = providedValues[k.copyFrom];
      const answer = await rl.question(
        `  Nilai [Enter = pakai ${k.copyFrom}]: `
      );
      const val = answer.trim() || suggestion;
      if (val) {
        newValues[k.devKey] = val;
        providedValues[k.devKey] = val;
        console.log(`  ${GREEN}✓ Diset${k.required ? "" : " (optional)"}${RESET}`);
      } else {
        console.log(`  ${YELLOW}⚠ Dilewati${RESET}`);
      }
      continue;
    }

    const answer = await rl.question(`  Nilai${k.required ? "" : " (Enter untuk skip)"}: `);
    const val = answer.trim();

    if (!val) {
      if (k.required) {
        console.error(`  ${RED}ERROR: Key ini wajib diisi.${RESET}`);
        process.exit(1);
      }
      console.log(`  ${YELLOW}⚠ Dilewati (opsional)${RESET}`);
      continue;
    }

    // Validasi URL format untuk DATABASE_URL
    if (k.isUrl && !/^postgres(?:ql)?:\/\//i.test(val)) {
      console.error(`  ${RED}ERROR: Format URL tidak valid. Harus dimulai dengan postgres:// atau postgresql://${RESET}`);
      process.exit(1);
    }

    newValues[k.devKey] = val;
    providedValues[k.devKey] = val;
    console.log(`  ${GREEN}✓ Diset${RESET}`);
  }

  if (Object.keys(newValues).length === 0) {
    console.log(`\n${YELLOW}Tidak ada nilai baru yang dimasukkan. Keluar.${RESET}`);
    rl.close();
    process.exit(0);
  }

  // Preview perubahan
  console.log(`\n${BOLD}Perubahan yang akan ditulis ke GCP Secret Manager:${RESET}`);
  for (const [k, v] of Object.entries(newValues)) {
    const masked = v.length > 20 ? v.slice(0, 10) + "..." + v.slice(-5) : "***";
    console.log(`  + ${k} = ${masked}`);
  }

  const ok = await rl.question(`\nKonfirmasi tulis ke GCP Secret Manager? [y/N] `);
  if (!ok.trim().toLowerCase().startsWith("y")) {
    console.log("Dibatalkan. Tidak ada yang berubah.");
    rl.close();
    process.exit(0);
  }

  // Gabung payload lama + values baru
  const updatedPayload = { ...payload, ...newValues };
  await writeNewPayload(client, updatedPayload);

  // Ringkasan
  console.log(`\n${BOLD}${GREEN}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${GREEN}  Setup Selesai!${RESET}`);
  console.log(`${BOLD}${GREEN}═══════════════════════════════════════════════════════${RESET}`);

  // Apakah DATABASE_URL_DEV dikonfigurasi?
  const hasDbUrl = newValues["SUPABASE_DATABASE_URL_DEV"] || payload["SUPABASE_DATABASE_URL_DEV"];

  console.log("\nLangkah berikutnya:\n");

  if (hasDbUrl) {
    const dbUrl = newValues["SUPABASE_DATABASE_URL_DEV"] ?? payload["SUPABASE_DATABASE_URL_DEV"];
    console.log(`${BOLD}1. Jalankan migrasi skema ke database dev:${RESET}`);
    console.log(`   ${BLUE}SUPABASE_DATABASE_URL_DEV='${dbUrl.slice(0,40)}...' node scripts/run-dev-migrations.mjs${RESET}`);
    console.log("   atau (setelah Gateway restart dengan secret baru):");
    console.log(`   ${BLUE}cd artifacts/api-server && node load-secrets.mjs node ../../scripts/run-dev-migrations.mjs${RESET}`);
    console.log("");
  }

  console.log(`${BOLD}2. Restart workflow Gateway di Replit:${RESET}`);
  console.log("   → API akan otomatis memuat SUPABASE_DATABASE_URL_DEV dari GCP");
  console.log("   → load-secrets.mjs akan inject key _DEV sebagai SUPABASE_DATABASE_URL (dev)");
  console.log("");
  console.log(`${BOLD}3. Verifikasi isolasi:${RESET}`);
  console.log("   → Buka BizPortal → Trial Balance harus kosong (database dev baru)");
  console.log("   → Data production tidak akan terlihat");

  if (!newValues["SUPABASE_STORAGE_BUCKET_DEV"] && !payload["SUPABASE_STORAGE_BUCKET_DEV"]) {
    console.log(`\n${YELLOW}⚠ CATATAN: SUPABASE_STORAGE_BUCKET_DEV tidak dikonfigurasi.${RESET}`);
    console.log("  Upload file di dev masih akan ke bucket production.");
    console.log("  Buat bucket baru di project dev jika diperlukan, lalu jalankan script ini lagi.");
  }

} catch (err) {
  console.error(`\n${RED}ERROR:${RESET}`, err.message);
  process.exit(1);
} finally {
  rl.close();
}
