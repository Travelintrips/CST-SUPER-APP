export interface SheetAccountCandidate {
  id: number;
  digits: string;
  companyId: number | null;
}

export interface ResolveSheetAccountInput {
  configuredAccountNumber?: string | null;
  rowBank?: string | null;
  rowDescription?: string | null;
  companyId?: number | null;
  accounts: SheetAccountCandidate[];
}

export function normalizeAccountDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Resolve the bank account identity for one sheet row.
 *
 * A configured account number is authoritative. Row text is only used for
 * legacy configs that do not have an account number yet; otherwise a row from
 * one sheet must never inherit the account identity of another sheet.
 */
export function resolveSheetBankAccountId(input: ResolveSheetAccountInput): number | null {
  const configuredDigits = normalizeAccountDigits(input.configuredAccountNumber);
  const companyId = input.companyId ?? null;

  if (configuredDigits) {
    const configuredMatches = input.accounts
      .filter((account) => account.digits === configuredDigits)
      .sort((a, b) => {
        const aCompanyMatch = a.companyId === companyId ? 1 : 0;
        const bCompanyMatch = b.companyId === companyId ? 1 : 0;
        return bCompanyMatch - aCompanyMatch || a.id - b.id;
      });
    return configuredMatches[0]?.id ?? null;
  }

  const statementDigits = normalizeAccountDigits(
    `${input.rowBank ?? ""} ${input.rowDescription ?? ""}`,
  );
  return (
    input.accounts
      .slice()
      .sort((a, b) => b.digits.length - a.digits.length || a.id - b.id)
      .find((account) => statementDigits.includes(account.digits))
      ?.id ?? null
  );
}