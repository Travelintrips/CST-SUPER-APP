import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import idID from "@/i18n/locales/id-ID";
import enUS from "@/i18n/locales/en-US";
import enGB from "@/i18n/locales/en-GB";
import zhCN from "@/i18n/locales/zh-CN";
import zhTW from "@/i18n/locales/zh-TW";
import jaJP from "@/i18n/locales/ja-JP";
import koKR from "@/i18n/locales/ko-KR";
import arSA from "@/i18n/locales/ar-SA";
import frFR from "@/i18n/locales/fr-FR";
import deDE from "@/i18n/locales/de-DE";
import esES from "@/i18n/locales/es-ES";
import ptBR from "@/i18n/locales/pt-BR";
import ruRU from "@/i18n/locales/ru-RU";
import hiIN from "@/i18n/locales/hi-IN";
import msMY from "@/i18n/locales/ms-MY";
import thTH from "@/i18n/locales/th-TH";
import viVN from "@/i18n/locales/vi-VN";

export type Locale =
  | "id-ID" | "en-US" | "en-GB" | "zh-CN" | "zh-TW" | "ja-JP"
  | "ko-KR" | "ar-SA" | "fr-FR" | "de-DE" | "es-ES" | "pt-BR"
  | "ru-RU" | "hi-IN" | "ms-MY" | "th-TH" | "vi-VN";

const STORAGE_KEY = "app_locale";
const CACHE_PREFIX = "lo_trs_v1_";
const CACHE_TTL_MS = 60 * 60 * 1000;

const SUPPORTED_LOCALES: Locale[] = [
  "id-ID", "en-US", "en-GB", "zh-CN", "zh-TW", "ja-JP",
  "ko-KR", "ar-SA", "fr-FR", "de-DE", "es-ES", "pt-BR",
  "ru-RU", "hi-IN", "ms-MY", "th-TH", "vi-VN",
];

// Bundled translations — always available, no network needed
const BUNDLED: Partial<Record<Locale, Record<string, string>>> = {
  "id-ID": idID as Record<string, string>,
  "en-US": enUS as Record<string, string>,
  "en-GB": enGB as Record<string, string>,
  "zh-CN": zhCN as Record<string, string>,
  "zh-TW": zhTW as Record<string, string>,
  "ja-JP": jaJP as Record<string, string>,
  "ko-KR": koKR as Record<string, string>,
  "ar-SA": arSA as Record<string, string>,
  "fr-FR": frFR as Record<string, string>,
  "de-DE": deDE as Record<string, string>,
  "es-ES": esES as Record<string, string>,
  "pt-BR": ptBR as Record<string, string>,
  "ru-RU": ruRU as Record<string, string>,
  "hi-IN": hiIN as Record<string, string>,
  "ms-MY": msMY as Record<string, string>,
  "th-TH": thTH as Record<string, string>,
  "vi-VN": viVN as Record<string, string>,
};

function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;
  } catch {}
  const browser = navigator.language;
  const exact = SUPPORTED_LOCALES.find((l) => l === browser);
  if (exact) return exact;
  const prefix = browser.split("-")[0];
  return SUPPORTED_LOCALES.find((l) => l.startsWith(prefix)) ?? "id-ID";
}

function applyLocale(locale: string) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar-SA" || locale === "ar-AE" ? "rtl" : "ltr";
}

// ── Cache ─────────────────────────────────────────────────────────────────────
function readCache(locale: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${locale}`);
    if (!raw) return null;
    const { data, fetchedAt } = JSON.parse(raw) as { data: Record<string, string>; fetchedAt: number };
    return Date.now() - fetchedAt < CACHE_TTL_MS ? data : null;
  } catch { return null; }
}

function writeCache(locale: string, flat: Record<string, string>) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${locale}`, JSON.stringify({ data: flat, fetchedAt: Date.now() }));
  } catch {}
}

// ── API fetch ─────────────────────────────────────────────────────────────────
async function fetchRemote(locale: string): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`/api/translations/logistic-order/${encodeURIComponent(locale)}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, string>;
    return data && typeof data === "object" && Object.keys(data).length > 0 ? data : null;
  } catch { return null; }
}

// ── Context ───────────────────────────────────────────────────────────────────
interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);
  // Start with cached remote data if available; bundled is always the fallback layer
  const [remoteFlat, setRemoteFlat] = useState<Record<string, string>>(() => readCache(detectInitialLocale()) ?? {});

  useEffect(() => {
    applyLocale(locale);
    const cached = readCache(locale);
    if (cached) { setRemoteFlat(cached); return; }
    fetchRemote(locale).then((data) => {
      if (!data) return;
      writeCache(locale, data);
      setRemoteFlat(data);
    });
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
    applyLocale(l);
  }, []);

  // Lookup order: remote API flat → bundled for current locale → bundled en-US → fallback arg → key itself
  const t = useCallback(
    (key: string, fallback?: string): string =>
      remoteFlat[key] ??
      BUNDLED[locale]?.[key] ??
      BUNDLED["en-US"]?.[key] ??
      fallback ??
      key,
    [remoteFlat, locale]
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be inside <LanguageProvider>");
  return ctx;
}
