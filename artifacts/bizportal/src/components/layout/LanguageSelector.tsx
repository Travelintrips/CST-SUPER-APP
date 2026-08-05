import { useRef, useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { type Locale } from "@/lib/translations";

const LANGUAGES: { code: Locale; flag: string; language: string; country: string }[] = [
  { code: "id-ID", flag: "🇮🇩", language: "Bahasa Indonesia", country: "Indonesia" },
  { code: "en-US", flag: "🇺🇸", language: "English", country: "United States" },
  { code: "en-GB", flag: "🇬🇧", language: "English", country: "United Kingdom" },
  { code: "zh-CN", flag: "🇨🇳", language: "中文 (简体)", country: "China" },
  { code: "zh-TW", flag: "🇹🇼", language: "中文 (繁體)", country: "Taiwan" },
  { code: "ja-JP", flag: "🇯🇵", language: "日本語", country: "Japan" },
  { code: "ko-KR", flag: "🇰🇷", language: "한국어", country: "South Korea" },
  { code: "ar-SA", flag: "🇸🇦", language: "العربية", country: "Saudi Arabia" },
  { code: "fr-FR", flag: "🇫🇷", language: "Français", country: "France" },
  { code: "de-DE", flag: "🇩🇪", language: "Deutsch", country: "Germany" },
  { code: "es-ES", flag: "🇪🇸", language: "Español", country: "Spain" },
  { code: "pt-BR", flag: "🇧🇷", language: "Português", country: "Brazil" },
  { code: "ru-RU", flag: "🇷🇺", language: "Русский", country: "Russia" },
  { code: "hi-IN", flag: "🇮🇳", language: "हिन्दी", country: "India" },
  { code: "ms-MY", flag: "🇲🇾", language: "Bahasa Melayu", country: "Malaysia" },
  { code: "th-TH", flag: "🇹🇭", language: "ภาษาไทย", country: "Thailand" },
  { code: "vi-VN", flag: "🇻🇳", language: "Tiếng Việt", country: "Vietnam" },
];

export function LanguageSelector() {
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
        className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring text-sidebar-foreground/70 hover:text-sidebar-foreground ${open ? "bg-sidebar-accent text-sidebar-foreground" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Select language"
      >
        <Globe className="h-4 w-4 flex-shrink-0" />
        <div className="flex flex-1 flex-col overflow-hidden">
          <span className="truncate text-xs font-medium leading-none">{current.flag} {current.language}</span>
          <span className="truncate text-[10px] text-sidebar-foreground/50 mt-0.5">{current.country}</span>
        </div>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar shadow-xl"
          role="listbox"
          aria-label="Select language"
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                role="option"
                aria-selected={locale === lang.code}
                onClick={() => selectLocale(lang.code)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:bg-sidebar-accent ${
                  locale === lang.code
                    ? "bg-sidebar-primary/20 text-sidebar-primary font-medium"
                    : "text-sidebar-foreground"
                }`}
              >
                <span className="text-base leading-none">{lang.flag}</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-xs leading-tight">{lang.language}</span>
                  <span className="text-[10px] text-sidebar-foreground/50 leading-tight">{lang.country}</span>
                </div>
                {locale === lang.code && (
                  <span className="ml-auto text-sidebar-primary text-xs font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
