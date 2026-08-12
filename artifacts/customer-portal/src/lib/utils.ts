import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
export function assetUrl(path: string): string {
  return `${BASE}${path}`;
}

/**
 * Resolve a stored image URL to a displayable URL.
 * - Paths starting with /objects/ (BizPortal format) → /api/storage/objects/...
 * - Paths already starting with /api/storage → used as-is
 * - Other URLs (http/https or null) → returned as-is or null
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const isAbsoluteUrl = /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//");
  if (
    !isAbsoluteUrl &&
    (url.includes("\\") || url.split("/").some((part) => part === "." || part === ".."))
  ) {
    return null;
  }
  if (url.startsWith("/objects/")) return `/api/storage${url}`;
  // Legacy CMS values and old hard-coded paths all resolve to the same
  // canonical Customer Portal storage root. Keep path segments intact; do
  // not normalize arbitrary URLs or allow a caller to escape the image root.
  const legacyPrefixes = [
    "/api/storage/public-objects/portal/images/",
    "/api/storage/public-objects/images/",
    "/portal/images/",
    "/images/",
  ];
  for (const prefix of legacyPrefixes) {
    if (url.startsWith(prefix)) {
      const relative = url.slice(prefix.length);
      if (!relative || relative.split("/").some((part) => part === "." || part === ".." || part.includes("\\"))) return null;
      return `/api/storage/public-objects/portal-assets/static/customer-portal/images/${relative}`;
    }
  }
  return url;
}
