import { useRef, useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Locale } from "@/contexts/LanguageContext";

const LANGUAGES: { code: Locale; flag: string; language: string; country: string; label: string }[] = [
  { code: "id-ID", flag: "🇮🇩", language: "Bahasa Indonesia", country: "Indonesia", label: "ID" },
  { code: "en-US", flag: "🇺🇸", language: "English", country: "United States", label: "EN" },
  { code: "en-GB", flag: "🇬🇧", language: "English", country: "United Kingdom", label: "EN" },
  { code: "zh-CN", flag: "🇨🇳", language: "中文 (简体)", country: "China", label: "ZH" },
  { code: "zh-TW", flag: "🇹🇼", language: "中文 (繁體)", country: "Taiwan", label: "ZH" },
  { code: "ja-JP", flag: "🇯🇵", language: "日本語", country: "Japan", label: "JA" },
  { code: "ko-KR", flag: "🇰🇷", language: "한국어", country: "South Korea", label: "KO" },
  { code: "ar-SA", flag: "🇸🇦", language: "العربية", country: "Saudi Arabia", label: "AR" },
  { code: "fr-FR", flag: "🇫🇷", language: "Français", country: "France", label: "FR" },
  { code: "de-DE", flag: "🇩🇪", language: "Deutsch", country: "Germany", label: "DE" },
  { code: "es-ES", flag: "🇪🇸", language: "Español", country: "Spain", label: "ES" },
  { code: "pt-BR", flag: "🇧🇷", language: "Português", country: "Brazil", label: "PT" },
  { code: "ru-RU", flag: "🇷🇺", language: "Русский", country: "Russia", label: "RU" },
  { code: "hi-IN", flag: "🇮🇳", language: "हिन्दी", country: "India", label: "HI" },
  { code: "ms-MY", flag: "🇲🇾", language: "Bahasa Melayu", country: "Malaysia", label: "MS" },
  { code: "th-TH", flag: "🇹🇭", language: "ภาษาไทย", country: "Thailand", label: "TH" },
  { code: "vi-VN", flag: "🇻🇳", language: "Tiếng Việt", country: "Vietnam", label: "VI" },
];

interface LanguageSelectorProps {
  compact?: boolean;
}

export function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { locale, setLocale } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0];

  function selectLocale(code: Locale) {
    setLocale(code);
    setOpen(false);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:text-foreground ${open ? "bg-muted text-foreground" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Select language"
      >
        <Globe className="h-4 w-4 flex-shrink-0" />
        {!compact && <span className="text-xs font-semibold tracking-wide">{current.label}</span>}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          role="listbox"
          aria-label="Select language"
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                role="option"
                aria-selected={locale === lang.code}
                onClick={() => selectLocale(lang.code)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:bg-muted ${
                  locale === lang.code ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                }`}
              >
                <span className="text-base leading-none">{lang.flag}</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-xs leading-tight">{lang.language}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{lang.country}</span>
                </div>
                {locale === lang.code && (
                  <span className="ml-auto text-primary text-xs font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
