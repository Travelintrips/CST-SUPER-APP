export interface RoutineAccount {
  type?: string | null;
  subtype?: string | null;
  name?: string | null;
  code?: string | null;
  isActive?: boolean | null;
  isPostable?: boolean | null;
  isHeader?: boolean | null;
}

export function isRoutineSourceAccount(account: RoutineAccount): boolean {
  if (
    account.type !== "asset" ||
    account.isActive === false ||
    account.isPostable === false ||
    account.isHeader === true
  ) {
    return false;
  }

  const name = String(account.name ?? "").toLowerCase();
  const code = String(account.code ?? "").toUpperCase();

  return (
    account.subtype === "cash_bank" ||
    name.includes("kas") ||
    name.includes("bank") ||
    code.startsWith("1-101") ||
    code.startsWith("1-102")
  );
}

export function isRoutineExpenseAccount(account: RoutineAccount): boolean {
  return (
    account.type === "expense" &&
    account.isActive !== false &&
    account.isPostable !== false &&
    account.isHeader !== true
  );
}

export function filterRoutineSourceAccounts<T extends RoutineAccount>(accounts: T[]): T[] {
  return accounts.filter(isRoutineSourceAccount);
}

export function filterRoutineExpenseAccounts<T extends RoutineAccount>(accounts: T[]): T[] {
  return accounts.filter(isRoutineExpenseAccount);
}