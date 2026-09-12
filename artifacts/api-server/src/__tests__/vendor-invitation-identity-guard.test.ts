import { describe, expect, it } from "vitest";
import {
  ADMIN_VENDOR_INVITATION_ERROR,
  evaluateVendorInvitationEmail,
} from "../lib/vendorInvitationIdentityGuard.js";

describe("vendor invitation identity guard", () => {
  it("rejects an email already owned by an admin", () => {
    expect(
      evaluateVendorInvitationEmail("Admin@Example.com", [{ role: "admin" }]),
    ).toEqual({
      ok: false,
      code: "ADMIN_EMAIL_COLLISION",
      message: ADMIN_VENDOR_INVITATION_ERROR,
    });
  });

  it("allows an existing non-admin vendor identity to use canonical reuse", () => {
    expect(
      evaluateVendorInvitationEmail("Vendor@Example.com", [{ role: "vendor" }]),
    ).toEqual({ ok: true, email: "vendor@example.com" });
  });

  it("allows a new vendor email", () => {
    expect(evaluateVendorInvitationEmail("New@Example.com", [])).toEqual({
      ok: true,
      email: "new@example.com",
    });
  });
});