import { useState, useEffect, useCallback, useRef } from "react";

// Map app locale codes → OpenAI translate API lang codes.
// Returns null when no translation is needed (product content is typically English/Indonesian).
function localeToLangCode(locale: string): string | null {
  const l = locale.toLowerCase();
  if (l.startsWith("id")) return null;  // Indonesian — content is often already in ID
  if (l.startsWith("en")) return null;  // English — content is often already in EN
  if (l.startsWith("zh")) return "zh";
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("ms")) return "ms";
  if (l.startsWith("ja")) return "ja";
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("de")) return "de";
  if (l.startsWith("fr")) return "fr";
  if (l.startsWith("es")) return "es";
  if (l.startsWith("nl")) return "nl";
  if (l.startsWith("it")) return "it";
  if (l.startsWith("hi")) return "hi";
  if (l.startsWith("ru")) return "ru";
  if (l.startsWith("th")) return "th";
  if (l.startsWith("vi")) return "vi";
  return null; // unknown locale → skip
}

async function callTranslate(text: string, targetLang: string): Promise<string> {
  const res = await fetch("/api/ai-translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, targetLang }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Translation failed");
  return data.translation as string;
}

interface TranslationState {
  name: string | null;
  description: string | null;
  isTranslating: boolean;
  isTranslated: boolean;
  error: string | null;
  targetLang: string | null;
}

interface UseProductTranslationResult extends TranslationState {
  retranslate: () => void;
  dismiss: () => void;
}

/**
 * Auto-translates product name + description when the app locale
 * is not Indonesian. Triggers once per item+locale combination.
 */
export function useProductTranslation(
  itemId: number | string | undefined,
  name: string | undefined,
  description: string | undefined,
  locale: string
): UseProductTranslationResult {
  const [state, setState] = useState<TranslationState>({
    name: null,
    description: null,
    isTranslating: false,
    isTranslated: false,
    error: null,
    targetLang: null,
  });

  // Track which item+locale we last translated to avoid duplicate calls
  const lastKeyRef = useRef<string>("");

  const doTranslate = useCallback(
    async (itemName: string, itemDesc: string | undefined, langCode: string) => {
      setState((s) => ({ ...s, isTranslating: true, error: null }));
      try {
        const [translatedName, translatedDesc] = await Promise.all([
          callTranslate(itemName, langCode),
          itemDesc ? callTranslate(itemDesc, langCode) : Promise.resolve(null),
        ]);
        setState({
          name: translatedName,
          description: translatedDesc,
          isTranslating: false,
          isTranslated: true,
          error: null,
          targetLang: langCode,
        });
      } catch (err) {
        setState((s) => ({
          ...s,
          isTranslating: false,
          error: err instanceof Error ? err.message : "Translation failed",
        }));
      }
    },
    []
  );

  useEffect(() => {
    if (!itemId || !name) return;
    const langCode = localeToLangCode(locale);
    if (!langCode) {
      // Back to Indonesian — clear any prior translation
      setState({ name: null, description: null, isTranslating: false, isTranslated: false, error: null, targetLang: null });
      lastKeyRef.current = "";
      return;
    }
    const key = `${itemId}::${langCode}`;
    if (lastKeyRef.current === key) return; // already done
    lastKeyRef.current = key;
    void doTranslate(name, description, langCode);
  }, [itemId, name, description, locale, doTranslate]);

  const retranslate = useCallback(() => {
    if (!itemId || !name) return;
    const langCode = localeToLangCode(locale);
    if (!langCode) return;
    lastKeyRef.current = ""; // force re-run
    void doTranslate(name, description, langCode);
  }, [itemId, name, description, locale, doTranslate]);

  const dismiss = useCallback(() => {
    setState({ name: null, description: null, isTranslating: false, isTranslated: false, error: null, targetLang: null });
    lastKeyRef.current = "";
  }, []);

  return { ...state, retranslate, dismiss };
}
