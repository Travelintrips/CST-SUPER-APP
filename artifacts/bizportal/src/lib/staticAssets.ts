const STORAGE_ROOT = "/api/storage/public-objects/portal-assets/static/bizportal";

export function staticAsset(path: string): string {
  return `${STORAGE_ROOT}/${path.replace(/^\/+/, "")}`;
}

export const BIZ_ASSETS = {
  logo: staticAsset("logocst.webp"),
  favicon: staticAsset("favicon.svg"),
} as const;