export type KtpOcrErrorCode =
  | "NOT_CONFIGURED"
  | "AUTHENTICATION"
  | "INVALID_IMAGE"
  | "TIMEOUT"
  | "PROVIDER"
  | "INVALID_RESPONSE";

const INTERNAL_MESSAGES: Record<KtpOcrErrorCode, string> = {
  NOT_CONFIGURED: "KTP OCR is not configured.",
  AUTHENTICATION: "KTP OCR provider authentication failed.",
  INVALID_IMAGE: "The KTP image could not be read.",
  TIMEOUT: "KTP OCR provider timed out.",
  PROVIDER: "KTP OCR provider request failed.",
  INVALID_RESPONSE: "KTP OCR returned an invalid response.",
};

export class KtpOcrError extends Error {
  constructor(
    public readonly code: KtpOcrErrorCode,
    public readonly providerStatus?: number,
  ) {
    super(INTERNAL_MESSAGES[code]);
    this.name = "KtpOcrError";
  }
}

function errorField(error: unknown, field: string): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[field];
}

/**
 * Converts provider/client failures into a small, safe set of categories.
 * The original provider error is intentionally not retained in the message
 * returned to the client because SDK errors can contain sensitive details.
 */
export function classifyKtpOcrError(error: unknown): KtpOcrError {
  if (error instanceof KtpOcrError) return error;

  const status = typeof errorField(error, "status") === "number"
    ? errorField(error, "status") as number
    : undefined;
  const code = String(errorField(error, "code") ?? "").toLowerCase();
  const name = String(errorField(error, "name") ?? "").toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (status === 401 || status === 403 || /auth|invalid_api_key|permission/.test(code + name)) {
    return new KtpOcrError("AUTHENTICATION", status);
  }

  if (
    status === 400 &&
    /image|image_url|vision|mime|media|format|content type/.test(code + name + message)
  ) {
    return new KtpOcrError("INVALID_IMAGE", status);
  }

  if (
    status === 408 ||
    /timeout|timed.?out|abort|etimedout|econnreset|econnaborted/.test(code + name + message)
  ) {
    return new KtpOcrError("TIMEOUT", status);
  }

  return new KtpOcrError("PROVIDER", status);
}

export function ktpOcrClientResponse(error: unknown): {
  status: number;
  error: string;
  code: KtpOcrErrorCode;
} {
  const classified = classifyKtpOcrError(error);

  switch (classified.code) {
    case "NOT_CONFIGURED":
      return { status: 503, error: "Layanan OCR belum dikonfigurasi.", code: classified.code };
    case "INVALID_IMAGE":
      return { status: 422, error: "File atau gambar KTP tidak dapat dibaca.", code: classified.code };
    case "TIMEOUT":
      return { status: 503, error: "OCR gagal sementara. Silakan coba lagi.", code: classified.code };
    case "AUTHENTICATION":
    case "PROVIDER":
    case "INVALID_RESPONSE":
      return { status: 503, error: "Layanan OCR sedang bermasalah.", code: classified.code };
  }
}