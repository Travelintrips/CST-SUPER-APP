import { describe, expect, it } from "vitest";
import {
  BIZPORTAL_GOOGLE_LOGIN_FAILURE,
  CUSTOMER_GOOGLE_LOGIN_FAILURE,
  decodeGoogleOAuthContext,
  encodeGoogleOAuthContext,
  getGoogleOAuthCallbackContext,
  getGoogleOAuthFailureRedirect,
} from "../lib/googleOAuthRouting";

describe("Google OAuth flow routing", () => {
  it("preserves Customer Portal context and destination", () => {
    const stored = encodeGoogleOAuthContext("customer_portal", "/login");

    expect(stored).toBe("portal:/login");
    expect(decodeGoogleOAuthContext(stored)).toEqual({
      flow: "customer_portal",
      returnTo: "/login",
    });
    expect(getGoogleOAuthCallbackContext(stored)).toEqual({
      flow: "customer_portal",
      returnTo: "/login",
    });
  });

  it("preserves the BizPortal flow", () => {
    const stored = encodeGoogleOAuthContext("bizportal", "/bizportal/");

    expect(decodeGoogleOAuthContext(stored)).toEqual({
      flow: "bizportal",
      returnTo: "/bizportal/",
    });
    expect(getGoogleOAuthFailureRedirect("bizportal")).toBe(BIZPORTAL_GOOGLE_LOGIN_FAILURE);
  });

  it("fails closed to Customer Portal when state context is missing", () => {
    expect(getGoogleOAuthCallbackContext(null)).toEqual({
      flow: "customer_portal",
      returnTo: CUSTOMER_GOOGLE_LOGIN_FAILURE,
    });
    expect(getGoogleOAuthFailureRedirect(null)).toBe(CUSTOMER_GOOGLE_LOGIN_FAILURE);
  });

  it("rejects external and protocol-relative return paths", () => {
    expect(encodeGoogleOAuthContext("customer_portal", "https://evil.example")).toBe("portal:/");
    expect(encodeGoogleOAuthContext("customer_portal", "//evil.example")).toBe("portal:/");
    expect(decodeGoogleOAuthContext("portal:https://evil.example")).toEqual({
      flow: "customer_portal",
      returnTo: "/",
    });
  });

  it("rejects BizPortal destinations for Customer Portal flow", () => {
    expect(encodeGoogleOAuthContext("customer_portal", "/bizportal/")).toBe("portal:/");
    expect(decodeGoogleOAuthContext("portal:/bizportal/")).toEqual({
      flow: "customer_portal",
      returnTo: "/",
    });
  });

  it("does not treat malformed state as a BizPortal flow", () => {
    expect(decodeGoogleOAuthContext("not-a-valid-context")).toBeNull();
    expect(getGoogleOAuthCallbackContext("not-a-valid-context")).toEqual({
      flow: "customer_portal",
      returnTo: CUSTOMER_GOOGLE_LOGIN_FAILURE,
    });
  });
});