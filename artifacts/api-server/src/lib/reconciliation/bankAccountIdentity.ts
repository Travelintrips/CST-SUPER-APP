export interface ActiveBankAccount {
  id: number;
  companyId: number | null;
  accountNumber: string | null;
}

export interface BankAccountReference {
  companyId: number | null;
  bankAccountId?: unknown;
  sourceAccount?: unknown;
  description?: unknown;
}

function asCompanyId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function digitsOnly(value: unknown): string {
  return asText(value).replace(/[^0-9]/g, "");
}

function accountBelongsToCompany(
  account: ActiveBankAccount,
  companyId: number | null,
): boolean {
  return account.companyId === companyId || account.companyId === null;
}

/**
 * Resolve either an internal company_bank_accounts.id or an external account
 * number to one active internal account ID.
 *
 * A null result is intentional when no account or more than one account
 * matches. Callers must treat that as an unusable bank dimension, never as a
 * wildcard.
 */
export function resolveActiveBankAccountId(
  reference: BankAccountReference,
  activeAccounts: readonly ActiveBankAccount[],
): number | null {
  const companyId = asCompanyId(reference.companyId);
  const scopedAccounts = activeAccounts.filter((account) =>
    accountBelongsToCompany(account, companyId),
  );
  const rawBankAccountId = asText(reference.bankAccountId);

  let matches: ActiveBankAccount[];
  if (rawBankAccountId) {
    const rawDigits = digitsOnly(rawBankAccountId);
    matches = scopedAccounts.filter((account) => {
      const idMatches = String(account.id) === rawBankAccountId;
      const numberMatches =
        rawDigits.length > 0 &&
        digitsOnly(account.accountNumber) === rawDigits;
      return idMatches || numberMatches;
    });
  } else {
    const sourceDigits = digitsOnly(reference.sourceAccount);
    const descriptionDigits = digitsOnly(reference.description);
    matches = scopedAccounts.filter((account) => {
      const accountDigits = digitsOnly(account.accountNumber);
      if (!accountDigits) return false;
      return (
        (sourceDigits.length > 0 && sourceDigits === accountDigits) ||
        (descriptionDigits.length > 0 && descriptionDigits.includes(accountDigits))
      );
    });
  }

  return matches.length === 1 ? matches[0]!.id : null;
}