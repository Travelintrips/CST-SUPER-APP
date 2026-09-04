/**
 * Seed translations from frontend TS files into Supabase app_translations table.
 *
 * Usage:
 *   pnpm tsx scripts/seed-translations.ts
 *   pnpm tsx scripts/seed-translations.ts --force   # overwrite existing
 */
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes("--force");

const DB_URL =
  process.env.SUPABASE_DATABASE_URL_DEV;

if (!DB_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL_DEV must be set");
  process.exit(1);
}

const pool = new Pool({ connectionString: DB_URL, max: 3 });

// ── Helpers ──────────────────────────────────────────────────────────────────

function flatten(
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      result[fullKey] = v;
    } else if (v !== null && typeof v === "object") {
      Object.assign(result, flatten(v as Record<string, unknown>, fullKey));
    }
  }
  return result;
}

async function seedApp(
  app: string,
  localeMap: Record<string, Record<string, unknown>>
) {
  const client = await pool.connect();
  try {
    for (const [locale, data] of Object.entries(localeMap)) {
      const flat = flatten(data);
      const entries = Object.entries(flat);
      if (entries.length === 0) continue;

      if (!FORCE) {
        const existing = await client.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM app_translations WHERE app = $1 AND locale = $2",
          [app, locale]
        );
        const count = parseInt(existing.rows[0].count, 10);
        if (count > 0) {
          console.log(`  ${app}/${locale}: already has ${count} keys — skipped (use --force to overwrite)`);
          continue;
        }
      }

      await client.query("BEGIN");
      try {
        for (const [key, value] of entries) {
          await client.query(
            `INSERT INTO app_translations(app, locale, key, value, updated_at)
             VALUES($1, $2, $3, $4, NOW())
             ON CONFLICT ON CONSTRAINT app_translations_unique
             DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [app, locale, key, value]
          );
        }
        await client.query("COMMIT");
        console.log(`  ✓ ${app}/${locale}: seeded ${entries.length} keys`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗ ${app}/${locale}: failed —`, err);
      }
    }
  } finally {
    client.release();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding translations (force=${FORCE})…\n`);

  // ── customer-portal ───────────────────────────────────────────────────────
  console.log("customer-portal:");
  try {
    const { TRANSLATIONS } = await import(
      path.resolve(__dirname, "../artifacts/customer-portal/src/i18n/translations.ts")
    );
    await seedApp("customer-portal", TRANSLATIONS as Record<string, Record<string, unknown>>);
  } catch (err) {
    console.error("  Failed to import customer-portal translations:", err);
  }

  // ── bizportal ─────────────────────────────────────────────────────────────
  console.log("\nbizportal:");
  try {
    const { translationMap, getTranslations } = await import(
      path.resolve(__dirname, "../artifacts/bizportal/src/lib/translations.ts")
    );
    const locales = Object.keys(translationMap) as string[];
    const merged: Record<string, Record<string, unknown>> = {};
    for (const locale of locales) {
      merged[locale] = getTranslations(locale) as Record<string, unknown>;
    }
    await seedApp("bizportal", merged);
  } catch (err) {
    console.error("  Failed to import bizportal translations:", err);
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
