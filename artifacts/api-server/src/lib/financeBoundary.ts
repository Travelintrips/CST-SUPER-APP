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