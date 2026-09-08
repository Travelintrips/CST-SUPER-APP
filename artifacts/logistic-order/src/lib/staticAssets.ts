const STORAGE_ROOT = "/api/storage/public-objects/portal-assets/static/logistic-order";
const CST_LOGO = "/api/storage/public-objects/portal-assets/static/customer-portal/images/logo.png";

export function staticAsset(path: string): string {
  return `${STORAGE_ROOT}/${path.replace(/^\/+/, "")}`;
}

export const LOGISTIC_ORDER_ASSETS = {
  logo: CST_LOGO,
  favicon: CST_LOGO,
} as const;