export interface ServiceHubItem {
  source: "vendor_catalog_item" | "product";
  id: number;
  title: string;
  category: string;
  serviceType: string | null;
  price: number | null;
  unit: string | null;
  targetUrl: string;
  description?: string | null;
  imageUrl?: string | null;
  vendorName?: string | null;
  location?: string | null;
  leadTime?: string | null;
  currency?: string;
  categories?: string[];
  primaryImageUrl?: string | null;
  categoryKey?: string | null;
}

export const CATEGORY_PLACEHOLDER: Record<string, { emoji: string; from: string; to: string }> = {
  trucking:    { emoji: "🚛", from: "#1a3a6c", to: "#2a5aaa" },
  sea_freight: { emoji: "🚢", from: "#0c3057", to: "#1a5080" },
  air_freight: { emoji: "✈️", from: "#1a4060", to: "#2a6090" },
  ppjk:        { emoji: "📋", from: "#3a3060", to: "#5a4a90" },
  handling:    { emoji: "🏭", from: "#2a4a2a", to: "#4a7a4a" },
  document:    { emoji: "📄", from: "#3a4a5a", to: "#5a6a7a" },
  exim_service:{ emoji: "🌍", from: "#1a4a4a", to: "#2a7070" },
};

// Local images (public/images/) are used as primary source so they always
// render, even when Supabase Storage is not yet seeded in this environment.
// The API storage paths (${SB}/…) are kept as comments for reference.
// const SB = "/api/storage/public-objects/portal/images";

export const SERVICE_PHOTOS: Record<string, string> = {
  "Sea Freight":             `/images/sea-freight.png`,
  "Air Freight":             `/images/air-freight.png`,
  "Domestik":                `/images/banner-trucking-container.png`,
  "Custom Clearance Proses": `/images/customs.png`,
  "Konsultan Pabean":        `/images/customs-document.png`,
};

export const CAT_PHOTOS: Record<string, string> = {
  forwarding: `/images/port-operations.png`,
  ppjk:       `/images/customs.png`,
};

export const formatIDR = (v: number): string =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
