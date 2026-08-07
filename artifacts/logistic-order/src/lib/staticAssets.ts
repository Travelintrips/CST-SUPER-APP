const STORAGE_ROOT = "/api/storage/public-objects/portal-assets/static/logistic-order";

export function staticAsset(path: string): string {
  return `${STORAGE_ROOT}/${path.replace(/^\/+/, "")}`;
}

export const LOGISTIC_ORDER_ASSETS = {
  logo: staticAsset("logocst-new.webp"),
  favicon: staticAsset("favicon.svg"),
} as const;