import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/notificationLog.js", () => ({
  logNotification: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: {},
  portalContentTable: {},
}));

import {
  classifySmtpError,
  fingerprintSmtpConfig,
} from "../lib/mailer.js";

const baseConfig = {
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  userPresent: true,
  passPresent: true,
  fromPresent: true,
};

describe("SMTP runtime observability", () => {
  it("keeps the canonical fingerprint stable and changes it for config identity changes", () => {
    expect(fingerprintSmtpConfig(baseConfig)).toBe(
      fingerprintSmtpConfig({ ...baseConfig }),
    );
    expect(
      fingerprintSmtpConfig({ ...baseConfig, port: 587, secure: false }),
    ).not.toBe(fingerprintSmtpConfig(baseConfig));
  });

  it("does not include raw credentials in the fingerprint", () => {
    const fingerprint = fingerprintSmtpConfig(baseConfig);
    expect(fingerprint).not.toContain("password");
    expect(fingerprint).not.toContain("secret");
    expect(fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it("classifies safe provider failures without exposing messages", () => {
    expect(classifySmtpError({ code: "EAUTH" })).toEqual({
      category: "AUTH",
      code: "EAUTH",
    });
    expect(classifySmtpError({ code: "ENOTFOUND" })).toEqual({
      category: "DNS",
      code: "ENOTFOUND",
    });
    expect(classifySmtpError({ responseCode: 550 })).toEqual({
      category: "MAIL_FROM",
      code: "SMTP_550",
    });
  });
});