/**
 * Portal Content Service
 *
 * Business logic for portal CMS content management with in-memory cache.
 * Controller (portal.ts) calls these functions; no logic lives in the controller.
 */

import { db, portalContentTable } from "@workspace/db";
import { SECRETS_CATALOG } from "../appSecrets.js";

const DEFAULT_LOCALE = "id-ID";
const LOCALE_SUFFIX_SEP = "__";

// Media/config values are shared by the public site regardless of the
// visitor's language. Text fields remain locale-specific, but an admin should
// not have to upload the same hero image once per language.
const LOCALE_INDEPENDENT_KEYS = new Set([
  "logo",
  "header_logo",
  "footer_logo",
  "partner_logo",
  "hero_bg",
  "about_img1",
  "about_img2",
  "testimonials.t1Photo",
  "testimonials.t2Photo",
  "testimonials.t3Photo",
  "site_favicon",
]);

function isLocaleIndependentVisualKey(key: string): boolean {
  return LOCALE_INDEPENDENT_KEYS.has(key)
    || key.startsWith("logo")
    || key.endsWith("_logo")
    || key.endsWith(".logo")
    || /(?:^|[._-])(img|image|photo|favicon|banner|background|bg)(?:[._\d-]|$)/i.test(key);
}

// ─── Cache ────────────────────────────────────────────────────────────────────

// Row type includes locale so getContent() can filter correctly.
// The locale column was added via boot migration — it is NOT NULL DEFAULT 'id-ID'.
type ContentRow = { key: string; value: string; locale: string };

let _cache: { rows: ContentRow[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// portal_content is a shared key-value table: CMS content (hero_bg, hero_title, ...)
// is stored alongside app-level secrets/settings managed by appSecrets.ts
// (Supabase keys, API tokens, etc. — see SECRETS_CATALOG). getContent() backs the
// PUBLIC, unauthenticated GET /api/portal/content endpoint, so every key in
// SECRETS_CATALOG must be excluded here or it leaks credentials to anyone.
const RESERVED_SECRET_KEYS = new Set(SECRETS_CATALOG.map((s) => s.key));

export function invalidateContentCache() {
  _cache = null;
}

async function loadAllRows(): Promise<ContentRow[]> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.rows;
  const rows = await db.select().from(portalContentTable);
  const filtered: ContentRow[] = rows
    .filter((r) => !RESERVED_SECRET_KEYS.has(r.key))
    .map((r) => ({
      key: r.key,
      value: r.value,
      // locale column added via boot migration (NOT NULL DEFAULT 'id-ID').
      // Cast through any because older compiled Drizzle types may not list it.
      locale: (r as any).locale ?? DEFAULT_LOCALE,
    }));
  _cache = { rows: filtered, expiresAt: Date.now() + CACHE_TTL_MS };
  return filtered;
}

// ─── getContent ───────────────────────────────────────────────────────────────
// portal_content is a shared KV table used by unrelated features too, so we
// deliberately do NOT add a `locale` column or change its key-only unique
// constraint (that would break other upserts/reads elsewhere in the app).
//
// Rows with locale === null are truly locale-independent and always apply
// regardless of the requested locale. The migration currently keeps locale
// NOT NULL for compatibility with the shared table, so known media/config
// keys are also resolved from the default locale below.
//
// Rows with an explicit locale (including DEFAULT_LOCALE) are CMS TEXT
// overrides for that specific language only. They must NOT leak into other
// languages: an admin editing the Indonesian hero title must never change
// what English visitors see. If the requested locale has no override for a
// given key, the frontend's own `content[key] || t(key)` falls back to the
// bundled translation for that locale — that fallback, not another
// language's saved text, is the correct empty state.
export async function getContent(locale: string = DEFAULT_LOCALE): Promise<Record<string, string>> {
  const rows = await loadAllRows();
  const content: Record<string, string> = {};

  // First pass: locale-independent rows (locale column is empty/null — truly shared).
  // Note: since the boot migration sets DEFAULT 'id-ID', most rows won't be null,
  // so this pass handles only explicitly locale-independent keys (images, JSON config, etc.)
  // that were inserted without a locale.
  for (const r of rows) {
    if (!r.locale) {
      content[r.key] = r.value;
    }
  }
  // Second pass: text overrides for the exact requested locale only.
  // IMPORTANT: id-ID rows must NOT leak into zh-CN, en-US, etc.
  for (const r of rows) {
    if (r.locale === locale) {
      content[r.key] = r.value;
    }
  }

  // Media/config values are global. Older rows may have been saved while an
  // admin was editing a non-default language, so prefer the requested
  // locale's value when present and otherwise fall back to the canonical
  // default-locale row.
  if (locale !== DEFAULT_LOCALE) {
    for (const r of rows) {
      if (
        r.locale === DEFAULT_LOCALE &&
        isLocaleIndependentVisualKey(r.key) &&
        !(r.key in content)
      ) {
        content[r.key] = r.value;
      }
    }
  }

  return content;
}

// ─── updateContent ────────────────────────────────────────────────────────────
// When `locale` is the default locale (or omitted), writes go to the bare key
// for backward compatibility with the original single-locale CMS. For any
// other locale, writes go to the `${key}__${locale}` suffixed key so they
// never shadow other languages.

export async function updateContent(
  updates: Record<string, string>,
  locale: string = DEFAULT_LOCALE
): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    if (RESERVED_SECRET_KEYS.has(key)) continue; // CMS editor must never write app secrets
    // Keep media/config values in the canonical default-locale row. This
    // prevents an image uploaded from the en-US CMS tab from being invisible
    // to id-ID visitors (and vice versa).
    const storageLocale = isLocaleIndependentVisualKey(key) ? DEFAULT_LOCALE : locale;
    await db
      .insert(portalContentTable)
      .values({ key, value: String(value), updatedAt: new Date(), locale: storageLocale } as any)
      .onConflictDoUpdate({
        target: [portalContentTable.key, (portalContentTable as any).locale],
        set: { value: String(value), updatedAt: new Date() },
      });
  }
  invalidateContentCache();
}
