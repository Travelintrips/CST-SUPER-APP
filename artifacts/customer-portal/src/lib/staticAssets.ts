const STORAGE_ROOT = "/api/storage/public-objects/portal-assets/static/customer-portal";

export function staticAsset(path: string): string {
  return `${STORAGE_ROOT}/${path.replace(/^\/+/, "")}`;
}

export const CUSTOMER_ASSETS = {
  logo: staticAsset("images/logo.png"),
  logoBrand: staticAsset("images/logo-baru.png"),
  ogCover: staticAsset("images/og-cover.png"),
  hero: staticAsset("images/hero-bg.webp"),
  warehouse: staticAsset("images/warehouse.webp"),
  portOperations: staticAsset("images/port-operations.webp"),
  customs: staticAsset("images/customs.png"),
  customsDocument: staticAsset("images/customs-document.png"),
  airFreight: staticAsset("images/air-freight.png"),
  seaFreight: staticAsset("images/sea-freight.png"),
  logisticsRoutes: staticAsset("images/logistics-routes.svg"),
} as const;