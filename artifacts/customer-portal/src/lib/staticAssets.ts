const STORAGE_PATH = "/api/storage/public-objects/portal-assets/static/customer-portal";
const STORAGE_ORIGIN = (
  import.meta.env.VITE_CUSTOMER_PORTAL_ASSET_ORIGIN ??
  "https://cstlogistic.co.id"
).replace(/\/+$/, "");
const STORAGE_ROOT = `${STORAGE_ORIGIN}${STORAGE_PATH}`;
const PNG_ONLY_ASSETS = new Set(["images/logo.png"]);

export function staticAsset(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  // The existing production logo objects are PNGs. Keep these two brand
  // assets on their published format; other raster assets use their derived
  // WebP object from the release pipeline.
  if (PNG_ONLY_ASSETS.has(normalized)) {
    return `${STORAGE_ROOT}/${normalized}`;
  }
  return `${STORAGE_ROOT}/${normalized.replace(/\.(png|jpe?g)$/i, ".webp")}`;
}

export const CUSTOMER_ASSETS = {
  logo: staticAsset("images/logo.png"),
  logoBrand: staticAsset("images/logo-baru.png"),
  ogCover: staticAsset("images/og-cover.png"),
  hero: staticAsset("images/hero-bg.webp"),
  marketplaceHero: staticAsset("images/gambar-baru.webp"),
  warehouse: staticAsset("images/warehouse.webp"),
  portOperations: staticAsset("images/port-operations.webp"),
  customs: staticAsset("images/customs.png"),
  customsDocument: staticAsset("images/customs-document.png"),
  airFreight: staticAsset("images/air-freight.png"),
  seaFreight: staticAsset("images/sea-freight.png"),
  logisticsRoutes: staticAsset("images/logistics-routes.svg"),
} as const;