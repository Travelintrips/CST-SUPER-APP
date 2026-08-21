export type SportCenterFinanceMode = "legacy" | "shadow" | "central";

export function getSportCenterFinanceMode(): SportCenterFinanceMode {
  const mode = String(process.env.SPORT_CENTER_FINANCE_MODE ?? "legacy")
    .trim()
    .toLowerCase();
  return mode === "central" || mode === "shadow" ? mode : "legacy";
}

export function isCentralFinanceMode(): boolean {
  return getSportCenterFinanceMode() === "central";
}

export function shouldRunLegacyFinanceWrites(): boolean {
  return !isCentralFinanceMode();
}

export type CustomerPortalFinanceMode = "legacy" | "shadow" | "central";

export function getCustomerPortalFinanceMode(): CustomerPortalFinanceMode {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env === "production") return "legacy";
  const mode = String(process.env.CUSTOMER_PORTAL_FINANCE_MODE ?? "legacy").trim().toLowerCase();
  return mode === "central" || mode === "shadow" ? mode : "legacy";
}

export function shouldRunCustomerPortalLegacyFinanceWrites(): boolean {
  return getCustomerPortalFinanceMode() !== "central";
}