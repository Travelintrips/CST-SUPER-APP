export const ADMIN_VENDOR_INVITATION_ERROR =
  "Akun dengan email ini sudah terdaftar sebagai administrator dan tidak dapat digunakan sebagai akun vendor. Gunakan email vendor yang berbeda.";

export type PortalEmailIdentity = {
  role?: string | null;
};

export type VendorInvitationEmailDecision =
  | { ok: true; email: string | null }
  | { ok: false; code: "ADMIN_EMAIL_COLLISION"; message: string };

/**
 * An admin portal identity must never be promoted through the vendor
 * invitation lifecycle. Existing non-admin identities remain eligible for the
 * canonical approval path, which reuses the account by its unique email.
 */
export function evaluateVendorInvitationEmail(
  rawEmail: unknown,
  matchingIdentities: readonly PortalEmailIdentity[],
): VendorInvitationEmailDecision {
  const email =
    typeof rawEmail === "string" && rawEmail.trim()
      ? rawEmail.trim().toLowerCase()
      : null;

  if (matchingIdentities.some((identity) => identity.role === "admin")) {
    return {
      ok: false,
      code: "ADMIN_EMAIL_COLLISION",
      message: ADMIN_VENDOR_INVITATION_ERROR,
    };
  }

  return { ok: true, email };
}