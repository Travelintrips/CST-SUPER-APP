import React, { createContext, useContext, useState, useCallback, useMemo, useLayoutEffect, useEffect } from "react";
import { type Locale, type Translations, getTranslations } from "@/lib/translations";

const STORAGE_KEY = "app_locale";
const CACHE_PREFIX = "biz_trs_v1_";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const SUPPORTED_LOCALES: Locale[] = [
  "id-ID", "en-US", "en-GB", "zh-CN", "zh-TW", "ja-JP",
  "ko-KR", "ar-SA", "fr-FR", "de-DE", "es-ES", "pt-BR",
  "ru-RU", "hi-IN", "ms-MY", "th-TH", "vi-VN",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRTLLocale(locale: string): boolean {
  return locale === "ar-SA" || locale === "ar-AE";
}

function applyDocumentLocale(locale: string): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = isRTLLocale(locale) ? "rtl" : "ltr";
}

function detectInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;
  const browser = navigator.language;
  const exact = SUPPORTED_LOCALES.find((l) => l === browser);
  if (exact) return exact;
  const prefix = browser.split("-")[0];
  const partial = SUPPORTED_LOCALES.find((l) => l.startsWith(prefix));
  return partial ?? "id-ID";
}

/** Unflatten { "a.b.c": "val" } → { a: { b: { c: "val" } } } */
function unflatten(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [dotKey, value] of Object.entries(flat)) {
    const parts = dotKey.split(".");
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  return root;
}

/** Deep merge overlay into base, returning a new object */
function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Record<string, unknown>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(overlay)) {
    if (v !== undefined && v !== null) {
      if (typeof v === "object" && typeof base[k] === "object" && base[k] !== null) {
        result[k] = deepMerge(base[k] as Record<string, unknown>, v as Record<string, unknown>);
      } else {
        result[k] = v;
      }
    }
  }
  return result as T;
}

// ── localStorage cache ─────────────────────────────────────────────────────────

function readCache(locale: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${locale}`);
    if (!raw) return null;
    const { data, fetchedAt } = JSON.parse(raw) as { data: Record<string, string>; fetchedAt: number };
    if (Date.now() - fetchedAt > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function writeCache(locale: string, flat: Record<string, string>) {
  try {
    localStorage.setItem(CACHE_PREFIX + locale, JSON.stringify({ data: flat, fetchedAt: Date.now() }));
  } catch {}
}

// ── API fetch ─────────────────────────────────────────────────────────────────

async function fetchRemote(locale: string, signal?: AbortSignal): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`/api/translations/bizportal/${encodeURIComponent(locale)}`, {
      credentials: "same-origin",
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, string>;
    return data && typeof data === "object" && Object.keys(data).length > 0 ? data : null;
  } catch { return null; }
}

/** Build typed Translations by merging remote data over the bundled base */
function buildTranslations(locale: Locale, remoteFlatOrNull: Record<string, string> | null): Translations {
  const base = getTranslations(locale);
  if (!remoteFlatOrNull || Object.keys(remoteFlatOrNull).length === 0) return base;
  const remoteNested = unflatten(remoteFlatOrNull);
  return deepMerge(
    base as unknown as Record<string, unknown>,
    remoteNested,
  ) as unknown as Translations;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);
  const [remoteFlat, setRemoteFlat] = useState<Record<string, string> | null>(
    () => readCache(detectInitialLocale())
  );

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
    applyDocumentLocale(newLocale);
  }, []);

  useLayoutEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    applyDocumentLocale(stored === "ar-AE" ? stored : locale);
  }, [locale]);

  // Fetch remote translations when locale changes
  useEffect(() => {
    const cached = readCache(locale);
    if (cached) {
      setRemoteFlat(cached);
      return;
    }

    // The bundled translations are complete enough to render the shell. Do not
    // put the first paint behind a database-backed request: on a cold API
    // connection this endpoint can take several seconds. Sync the optional
    // overrides once the browser has had time to paint the page.
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 4000);
    const timer = window.setTimeout(() => {
      void fetchRemote(locale, controller.signal).then((flat) => {
        if (!flat || controller.signal.aborted) return;
        writeCache(locale, flat);
        setRemoteFlat(flat);
      }).finally(() => {
        window.clearTimeout(requestTimeout);
      });
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [locale]);

  const t = useMemo(() => buildTranslations(locale, remoteFlat), [locale, remoteFlat]);
  const isRTL = isRTLLocale(locale);

  const value = useMemo(
    () => ({ locale, setLocale, t, isRTL }),
    [locale, setLocale, t, isRTL]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
