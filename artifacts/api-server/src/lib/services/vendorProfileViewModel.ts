/**
 * DTO for the authenticated vendor profile screen.
 *
 * `vendor_profiles` remains the source of truth and retains the complete bank
 * account number for authorised profile updates. The read model deliberately
 * replaces it before a profile is returned to the Customer Portal.
 */

export type VendorProfileViewModelSource = {
  bankAccountNumber: string | null;
  fullAddress: string | null;
  phone: string | null;
  email: string | null;
};

export function maskVendorBankAccountNumber(
  bankAccountNumber: string | null | undefined,
): string | null {
  const normalized = bankAccountNumber?.trim();
  if (!normalized) return null;

  // Do not reveal an entire unusually short account number.
  const suffix = normalized.length > 4 ? normalized.slice(-4) : "";
  return `••••••${suffix}`;
}

export function toVendorProfileViewModel<T extends VendorProfileViewModelSource>(
  profile: T,
) {
  const maskedBankAccountNumber = maskVendorBankAccountNumber(profile.bankAccountNumber);

  return {
    ...profile,
    // UI-friendly aliases with an explicit schema mapping.
    legalName: null,
    address: profile.fullAddress,
    picPhone: profile.phone,
    picEmail: profile.email,
    // Never expose the persisted account number through this read model.
    bankAccountNumber: maskedBankAccountNumber,
    bankAccountNumberMasked: maskedBankAccountNumber,
  };
}