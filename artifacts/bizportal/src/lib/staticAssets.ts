const STORAGE_ROOT = "/api/storage/public-objects/portal-assets/static/bizportal";
const CST_LOGO = "/api/storage/public-objects/portal-assets/static/customer-portal/images/logo.png";

export function staticAsset(path: string): string {
  return `${STORAGE_ROOT}/${path.replace(/^\/+/, "")}`;
}

export const BIZ_ASSETS = {
  logo: CST_LOGO,
  favicon: CST_LOGO,
} as const;