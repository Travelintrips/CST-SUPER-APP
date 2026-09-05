import { afterEach, describe, expect, it } from "vitest";
import { getPortalAuthCapabilities } from "../lib/portalAuthCapabilities.js";

const originalEnv = {
  APP_ENV: process.env.APP_ENV,
  REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  FONNTE_TOKEN: process.env.FONNTE_TOKEN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("portal auth capability contract", () => {
  it("exposes only the active auth methods", () => {
    process.env.APP_ENV = "production";
    process.env.REPLIT_DEPLOYMENT = "1";
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    process.env.FONNTE_TOKEN = "";

    const capabilities = getPortalAuthCapabilities();

    expect(capabilities.password).toBe(true);
    expect(capabilities.google).toBe(false);
    expect(capabilities.whatsapp).toBe(false);
    expect(Object.keys(capabilities).sort()).toEqual(["emailOtp", "google", "password", "whatsapp"]);
  });

  it("keeps the safe DEV OTP paths available", () => {
    process.env.APP_ENV = "development";
    delete process.env.REPLIT_DEPLOYMENT;
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    process.env.FONNTE_TOKEN = "";

    const capabilities = getPortalAuthCapabilities();

    expect(capabilities.emailOtp).toBe(true);
    expect(capabilities.whatsapp).toBe(true);
    expect(Object.keys(capabilities).sort()).toEqual(["emailOtp", "google", "password", "whatsapp"]);
  });
});