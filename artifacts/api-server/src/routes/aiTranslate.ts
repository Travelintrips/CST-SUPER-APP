import { Router, type Request, type Response } from "express";
import { getOpenAI } from "../lib/openaiClient";
import { logger } from "../lib/logger";

const aiTranslateRouter = Router();

// Supported language display names
const LANGUAGE_NAMES: Record<string, string> = {
  id: "Indonesian",
  en: "English",
  zh: "Chinese (Simplified)",
  ar: "Arabic",
  ms: "Malay",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  ru: "Russian",
  th: "Thai",
  vi: "Vietnamese",
};

// ── POST /api/ai-translate ────────────────────────────────────────────────────
// Real-time machine translation via OpenAI.
// Body: { text: string, targetLang: string, sourceLang?: string }
// Response: { translation: string, detectedSourceLang?: string }
aiTranslateRouter.post("/", async (req: Request, res: Response) => {
  const { text, targetLang, sourceLang } = req.body as {
    text?: string;
    targetLang?: string;
    sourceLang?: string;
  };

  if (!text || typeof text !== "string" || text.trim() === "") {
    res.status(400).json({ error: "text is required and must be a non-empty string" });
    return;
  }
  if (!targetLang || typeof targetLang !== "string") {
    res.status(400).json({ error: "targetLang is required" });
    return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "text must not exceed 5000 characters" });
    return;
  }

  const targetLangName = LANGUAGE_NAMES[targetLang.toLowerCase()] ?? targetLang;
  const sourceLangName = sourceLang
    ? (LANGUAGE_NAMES[sourceLang.toLowerCase()] ?? sourceLang)
    : null;

  const systemPrompt = sourceLangName
    ? `You are a professional translator. Translate the user's text from ${sourceLangName} to ${targetLangName}. Return ONLY the translated text with no explanations, notes, or preamble.`
    : `You are a professional translator. Detect the language of the user's text and translate it to ${targetLangName}. Return ONLY the translated text with no explanations, notes, or preamble. Do NOT include the detected language label or any prefix.`;

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text.trim() },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const translation = completion.choices[0]?.message?.content?.trim() ?? "";
    logger.info(
      { targetLang, sourceLang: sourceLang ?? "auto", chars: text.length },
      "[ai-translate] OK"
    );
    res.json({ translation });
  } catch (err) {
    // Extract HTTP status from OpenAI error if available
    const status = (err as { status?: number })?.status ?? 0;
    const isAuthError = status === 401 || status === 403;
    const isRateLimit = status === 429;

    // NEVER expose raw OpenAI error messages to clients — they may contain API key fragments
    logger.error({ err, targetLang, status }, "[ai-translate] OpenAI call failed");

    if (isAuthError) {
      res.status(503).json({ error: "Layanan terjemahan tidak tersedia saat ini." });
    } else if (isRateLimit) {
      res.status(503).json({ error: "Layanan terjemahan sedang sibuk, coba beberapa saat lagi." });
    } else {
      res.status(503).json({ error: "Terjemahan tidak tersedia saat ini." });
    }
  }
});

// ── POST /api/ai-translate-batch ─────────────────────────────────────────────
// Translate multiple strings in a single OpenAI call.
// Body: { texts: Record<string, string>, targetLang: string, sourceLang?: string }
// Response: { translations: Record<string, string> }
aiTranslateRouter.post("/batch", async (req: Request, res: Response) => {
  const { texts, targetLang, sourceLang } = req.body as {
    texts?: Record<string, string>;
    targetLang?: string;
    sourceLang?: string;
  };

  if (!texts || typeof texts !== "object" || Array.isArray(texts)) {
    res.status(400).json({ error: "texts must be a non-null object" });
    return;
  }
  if (!targetLang || typeof targetLang !== "string") {
    res.status(400).json({ error: "targetLang is required" });
    return;
  }

  // Filter to only non-empty string values that contain at least one letter
  const toTranslate: Record<string, string> = {};
  for (const [k, v] of Object.entries(texts)) {
    if (typeof v === "string" && v.trim() && /[a-zA-Z\u00C0-\u024F\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF]/.test(v)) {
      toTranslate[k] = v.trim();
    }
  }

  if (Object.keys(toTranslate).length === 0) {
    res.json({ translations: {} });
    return;
  }

  const payload = JSON.stringify(toTranslate);
  if (payload.length > 8000) {
    res.status(400).json({ error: "texts payload too large (max ~8000 chars)" });
    return;
  }

  const targetLangName = LANGUAGE_NAMES[targetLang.toLowerCase()] ?? targetLang;
  const sourceLangName = sourceLang ? (LANGUAGE_NAMES[sourceLang.toLowerCase()] ?? sourceLang) : null;

  const systemPrompt = sourceLangName
    ? `You are a professional translator. Translate all JSON values from ${sourceLangName} to ${targetLangName}. Return ONLY valid JSON with identical keys and translated values. Do not translate keys. Do not add explanations.`
    : `You are a professional translator. Translate all JSON values to ${targetLangName}. Return ONLY valid JSON with identical keys and translated values. Do not translate keys. Do not add explanations.`;

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: payload },
      ],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let translations: Record<string, string> = {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") translations[k] = v;
      }
    } catch {
      logger.warn({ raw }, "[ai-translate-batch] JSON parse failed — returning empty");
    }

    logger.info(
      { targetLang, keys: Object.keys(toTranslate).length },
      "[ai-translate-batch] OK"
    );
    res.json({ translations });
  } catch (err) {
    logger.error({ err, targetLang }, "[ai-translate-batch] OpenAI call failed");
    const message = err instanceof Error ? err.message : "Translation failed";
    res.status(500).json({ error: message });
  }
});

export { aiTranslateRouter };
