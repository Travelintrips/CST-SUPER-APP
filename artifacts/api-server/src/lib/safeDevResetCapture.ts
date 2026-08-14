import { isSafeDevTestMode } from "./safeDev.js";

const capturedResetTokens = new Map<string, string>();

export function isSafeDevResetCaptureEnabled(): boolean {
  return (
    process.env.APP_ENV === "development" &&
    process.env.CUSTOMER_AUTH_HARNESS_CAPTURE === "1" &&
    isSafeDevTestMode()
  );
}

export function captureSafeDevResetArtifact(email: string, token: string): void {
  if (!isSafeDevResetCaptureEnabled()) return;
  capturedResetTokens.set(email.toLowerCase().trim(), token);
}

export function consumeSafeDevResetArtifact(email: string): string | null {
  if (!isSafeDevResetCaptureEnabled()) return null;
  const key = email.toLowerCase().trim();
  const token = capturedResetTokens.get(key) ?? null;
  if (token) capturedResetTokens.delete(key);
  return token;
}