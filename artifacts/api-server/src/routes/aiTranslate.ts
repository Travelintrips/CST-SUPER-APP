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

export { aiTranslateRouter };
