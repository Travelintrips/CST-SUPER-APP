const STORAGE_ROOT = "/api/storage/public-objects/portal-assets/static/customer-portal";

export function staticAsset(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  // Static raster assets are published as WebP by the release pipeline. Keep
  // source call sites readable (`staticAsset("images/logo.png")`) while
  // ensuring the runtime requests the derived object that the manifest
  // promotes and verifies.
  return `${STORAGE_ROOT}/${normalized.replace(/\.(png|jpe?g)$/i, ".webp")}`;
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