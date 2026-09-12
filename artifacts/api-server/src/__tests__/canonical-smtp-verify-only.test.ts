import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/notificationLog.js", () => ({
  logNotification: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  portalContentTable: {},
}));

const { checkSmtpConnection, resolveSmtpConfig } = await import("../lib/mailer.js");

const safeCode = (value: string | null): string => value ?? "NONE";

describe("temporary canonical SMTP verification", () => {
  it("verifies the canonical mailer without sending", async () => {
    const result = await checkSmtpConnection();
    const resolved = await resolveSmtpConfig();
    const rawPass = process.env.SMTP_PASS ?? "";
    const rawUser = process.env.SMTP_USER ?? "";

    console.log(`CANONICAL_MAILER_VERIFY = ${result.status === "ok" ? "PASS" : "FAIL"}`);
    console.log(`SMTP_ERROR_CATEGORY = ${result.errorCategory ?? "NONE"}`);
    console.log(`SMTP_ERROR_CODE = ${safeCode(result.errorCode)}`);
    console.log(`RAW_GCP_SMTP_PASS == RESOLVED_MAILER_PASS = ${rawPass === resolved.pass ? "YES" : "NO"}`);
    console.log(`SMTP_USER canonical == resolved user = ${rawUser === resolved.user ? "YES" : "NO"}`);

    expect(result.status).not.toBe("unconfigured");
  });
});