export type BankMutationPaymentType = "bank_transfer" | "qris" | "paylabs";

export interface BankMutationPaymentEvidence {
  providerName?: string | null;
  providerOrderId?: string | null;
  description?: string | null;
  normalizedDescription?: string | null;
}

/**
 * `InhouseTrf` is a bank-side rail marker, not QRIS evidence. Keep this
 * classification independent from the payment method stored on a candidate
 * row so a stale/incorrect Sport Center method cannot unlock QRIS approval.
 */
export function isInhouseBankTransferDescription(value: string | null | undefined): boolean {
  const compact = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return compact.includes("INHOUSETRF");
}

export function isQrisBankEvidence(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return (
    normalized.includes("QRIS")
    || /QR[A-Z0-9]{4,}/.test(normalized)
    || /\bQR\s*(?:CODE|PAY|PAYMENT)\b/.test(normalized)
  );
}

export function classifyBankMutationPaymentType(
  evidence: BankMutationPaymentEvidence,
): BankMutationPaymentType {
  const values = [
    evidence.providerName,
    evidence.providerOrderId,
    evidence.description,
    evidence.normalizedDescription,
  ];

  // Explicit bank rail markers win over candidate/provider metadata.
  if (values.some(isInhouseBankTransferDescription)) return "bank_transfer";
  if (values.some(value => /paylabs/i.test(String(value ?? "")))) return "paylabs";
  if (values.some(isQrisBankEvidence)) return "qris";
  return "bank_transfer";
}

export function isQrisBankApprovalAllowed(
  evidence: BankMutationPaymentEvidence,
): boolean {
  return classifyBankMutationPaymentType(evidence) === "qris";
}