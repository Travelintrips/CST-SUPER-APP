import OpenAI from "openai";

let _openai: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_openai) {
    const directKey = process.env.OPENAI_API_KEY;
    const directBase = process.env.OPENAI_BASE_URL;
    const integrationsKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const integrationsBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

    // Prefer direct OPENAI_API_KEY (real OpenAI endpoint) when present.
    // Fall back to Replit AI Integration proxy only when direct key is absent.
    if (directKey) {
      _openai = new OpenAI({
        apiKey: directKey,
        ...(directBase ? { baseURL: directBase } : {}),
      });
    } else if (integrationsKey && integrationsBase) {
      _openai = new OpenAI({ apiKey: integrationsKey, baseURL: integrationsBase });
    } else {
      throw new Error("OpenAI API key tidak dikonfigurasi. Set OPENAI_API_KEY atau aktifkan Replit AI Integration.");
    }
  }
  return _openai;
}

export function resetOpenAI(): void {
  _openai = null;
}
