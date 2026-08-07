const STORAGE_ROOT = "/api/storage/public-objects/portal-assets/static/customer-portal";

export function staticAsset(path: string): string {
  return `${STORAGE_ROOT}/${path.replace(/^\/+/, "")}`;
}

export const CUSTOMER_ASSETS = {
  logo: staticAsset("images/logo.webp"),
  logoBrand: staticAsset("images/logo-baru.webp"),
  ogCover: staticAsset("images/og-cover.webp"),
  hero: staticAsset("images/hero-bg.webp"),
  warehouse: staticAsset("images/warehouse.webp"),
  portOperations: staticAsset("images/port-operations.webp"),
  customs: staticAsset("images/customs.webp"),
  customsDocument: staticAsset("images/customs-document.webp"),
  airFreight: staticAsset("images/air-freight.webp"),
  seaFreight: staticAsset("images/sea-freight.webp"),
  logisticsRoutes: staticAsset("images/logistics-routes.svg"),
} as const;