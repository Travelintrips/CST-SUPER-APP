import { describe, it } from "vitest";
import { checkSmtpConnection, resolveSmtpConfig } from "../lib/mailer.js";

describe("temporary canonical SMTP probe", () => {
  it("runs the production mailer verification path without sending", async () => {
    const result = await checkSmtpConnection();
    const cfg = await resolveSmtpConfig();
    console.log("CANONICAL_SMTP_SAFE_RESULT=" + JSON.stringify({
      result,
      safeConfig: {
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        userPresent: Boolean(cfg.user),
        passPresent: Boolean(cfg.pass),
        fromPresent: Boolean(cfg.from),
        userEqualsFrom: Boolean(cfg.user && cfg.from && cfg.user === cfg.from),
        fingerprint: cfg.fingerprint,
        sources: cfg.sources,
      },
    }));
  });
});
