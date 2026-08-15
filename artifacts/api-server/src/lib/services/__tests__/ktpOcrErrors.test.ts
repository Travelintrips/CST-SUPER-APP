import { describe, expect, it } from "vitest";
import {
  KtpOcrError,
  classifyKtpOcrError,
  ktpOcrClientResponse,
} from "../ktpOcrErrors.js";

describe("KTP OCR error classification", () => {
  it("returns a dedicated missing-configuration response", () => {
    const result = ktpOcrClientResponse(new KtpOcrError("NOT_CONFIGURED"));
    expect(result).toEqual({
      status: 503,
      error: "Layanan OCR belum dikonfigurasi.",
      code: "NOT_CONFIGURED",
    });
  });

  it("classifies authentication failures without exposing provider details", () => {
    const result = ktpOcrClientResponse({ status: 401, message: "secret detail must not escape" });
    expect(result.code).toBe("AUTHENTICATION");
    expect(result.error).toBe("Layanan OCR sedang bermasalah.");
    expect(result.error).not.toContain("secret");
  });

  it("classifies provider image errors separately", () => {
    const classified = classifyKtpOcrError({
      status: 400,
      code: "invalid_image",
      message: "image format is unsupported",
    });
    expect(classified.code).toBe("INVALID_IMAGE");
    expect(ktpOcrClientResponse(classified).error).toBe("File atau gambar KTP tidak dapat dibaca.");
  });

  it("classifies timeout errors as retryable", () => {
    const result = ktpOcrClientResponse({ name: "APIConnectionTimeoutError", code: "ETIMEDOUT" });
    expect(result).toEqual({
      status: 503,
      error: "OCR gagal sementara. Silakan coba lagi.",
      code: "TIMEOUT",
    });
  });

  it("does not turn invalid structured output into a successful OCR result", () => {
    const result = ktpOcrClientResponse(new KtpOcrError("INVALID_RESPONSE"));
    expect(result.code).toBe("INVALID_RESPONSE");
    expect(result.error).toBe("Layanan OCR sedang bermasalah.");
  });
});