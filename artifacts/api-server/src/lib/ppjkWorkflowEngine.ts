/**
 * PPJK Workflow Engine — Phase 2
 * Validates status transitions and computes SLA deadlines.
 */

// ── Valid workflow statuses ───────────────────────────────────────────────────
export const PPJK_STATUSES = [
  "draft",
  "waiting_documents",
  "document_review",
  "document_completed",
  "quotation",
  "waiting_customer",
  "customer_approved",
  "preparing_pib",
  "preparing_peb",
  "submitted_ceisa",
  "inspection",
  "red_lane",
  "yellow_lane",
  "green_lane",
  "hold",
  "sppb",
  "released",
  "completed",
  "cancelled",
] as const;

export type PpjkStatus = typeof PPJK_STATUSES[number];

export const PPJK_STATUS_LABELS: Record<PpjkStatus, string> = {
  draft: "Draft",
  waiting_documents: "Menunggu Dokumen",
  document_review: "Review Dokumen",
  document_completed: "Dokumen Lengkap",
  quotation: "Penawaran Harga",
  waiting_customer: "Menunggu Persetujuan Customer",
  customer_approved: "Customer Setuju",
  preparing_pib: "Persiapan PIB",
  preparing_peb: "Persiapan PEB",
  submitted_ceisa: "Diajukan ke CEISA",
  inspection: "Pemeriksaan Bea Cukai",
  red_lane: "Jalur Merah",
  yellow_lane: "Jalur Kuning",
  green_lane: "Jalur Hijau",
  hold: "Ditahan",
  sppb: "SPPB Terbit",
  released: "Barang Dikeluarkan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

// ── Allowed transitions (from → to[]) ────────────────────────────────────────
const TRANSITIONS: Record<PpjkStatus, PpjkStatus[]> = {
  draft:              ["waiting_documents", "cancelled"],
  waiting_documents:  ["document_review", "cancelled"],
  document_review:    ["document_completed", "waiting_documents", "cancelled"],
  document_completed: ["quotation", "cancelled"],
  quotation:          ["waiting_customer", "cancelled"],
  waiting_customer:   ["customer_approved", "quotation", "cancelled"],
  customer_approved:  ["preparing_pib", "preparing_peb", "cancelled"],
  preparing_pib:      ["submitted_ceisa", "cancelled"],
  preparing_peb:      ["submitted_ceisa", "cancelled"],
  submitted_ceisa:    ["inspection", "cancelled"],
  inspection:         ["red_lane", "yellow_lane", "green_lane", "hold"],
  red_lane:           ["sppb", "hold", "cancelled"],
  yellow_lane:        ["sppb", "hold", "cancelled"],
  green_lane:         ["sppb"],
  hold:               ["inspection", "cancelled"],
  sppb:               ["released"],
  released:           ["completed"],
  completed:          [],
  cancelled:          [],
};

// ── SLA hours per status (0 = no SLA) ────────────────────────────────────────
export const SLA_HOURS: Partial<Record<PpjkStatus, number>> = {
  waiting_documents:  24,
  document_review:    6,
  document_completed: 4,
  quotation:          8,
  waiting_customer:   48,
  customer_approved:  4,
  preparing_pib:      3,
  preparing_peb:      3,
  submitted_ceisa:    12,
  inspection:         12,
  red_lane:           24,
  yellow_lane:        12,
  green_lane:         6,
  hold:               24,
  sppb:               2,
  released:           4,
};

// ── Ordered progress list (for stepper UI, excluding terminals) ───────────────
export const PPJK_ORDERED_PROGRESS: PpjkStatus[] = [
  "draft",
  "waiting_documents",
  "document_review",
  "document_completed",
  "quotation",
  "waiting_customer",
  "customer_approved",
  "preparing_pib",
  "submitted_ceisa",
  "inspection",
  "green_lane",
  "sppb",
  "released",
  "completed",
];

// ── Old-status migration map (backward compat) ───────────────────────────────
export const LEGACY_STATUS_MAP: Record<string, PpjkStatus> = {
  confirmed:  "waiting_documents",
  processing: "document_review",
  submitted:  "submitted_ceisa",
  examining:  "inspection",
  approved:   "sppb",
  on_hold:    "hold",
};

/**
 * Returns true if transitioning from `from` to `to` is allowed.
 * Admins (forceAdmin=true) may skip to cancelled from any non-terminal state.
 */
export function isTransitionAllowed(
  from: string,
  to: string,
  forceAdmin = false,
): boolean {
  // Normalise legacy statuses
  const normFrom = (LEGACY_STATUS_MAP[from] ?? from) as PpjkStatus;
  const normTo   = (LEGACY_STATUS_MAP[to]   ?? to)   as PpjkStatus;

  if (!PPJK_STATUSES.includes(normFrom) || !PPJK_STATUSES.includes(normTo)) {
    return false;
  }
  if (normFrom === normTo) return false; // no-op
  // Admin force-cancel: only from non-terminal statuses
  const isTerminal = normFrom === "completed" || normFrom === "cancelled";
  if (forceAdmin && normTo === "cancelled" && !isTerminal) return true;
  return (TRANSITIONS[normFrom] ?? []).includes(normTo);
}

/**
 * Returns allowed next statuses from the given current status.
 */
export function allowedTransitions(from: string): PpjkStatus[] {
  const norm = (LEGACY_STATUS_MAP[from] ?? from) as PpjkStatus;
  return TRANSITIONS[norm] ?? [];
}

/**
 * Computes the SLA deadline for a given status starting from `enteredAt`.
 * Returns null if no SLA is defined for that status.
 */
export function computeSlaDeadline(status: string, enteredAt: Date): Date | null {
  const norm = (LEGACY_STATUS_MAP[status] ?? status) as PpjkStatus;
  const hours = SLA_HOURS[norm];
  if (!hours) return null;
  return new Date(enteredAt.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Returns true if the order is overdue based on current time vs SLA deadline.
 */
export function isOverdue(slaDeadline: Date | null): boolean {
  if (!slaDeadline) return false;
  return new Date() > slaDeadline;
}

/**
 * Validates a status string — accepts new and legacy values.
 */
export function isValidStatus(status: string): boolean {
  const norm = LEGACY_STATUS_MAP[status] ?? status;
  return PPJK_STATUSES.includes(norm as PpjkStatus);
}

/**
 * Normalises a status (maps legacy → new).
 */
export function normaliseStatus(status: string): PpjkStatus {
  return (LEGACY_STATUS_MAP[status] ?? status) as PpjkStatus;
}

// ── Customs status canonical values ──────────────────────────────────────────
export const PPJK_CUSTOMS_STATUSES = [
  "pending",
  "submitted",
  "examining",
  "approved",
  "rejected",
  "hold",
  "released",
  "completed",
] as const;

export type PpjkCustomsStatus = typeof PPJK_CUSTOMS_STATUSES[number];

export const PPJK_CUSTOMS_STATUS_LABELS: Record<PpjkCustomsStatus, string> = {
  pending:   "Menunggu",
  submitted: "Diajukan ke Bea Cukai",
  examining: "Sedang Diperiksa",
  approved:  "Disetujui",
  rejected:  "Ditolak",
  hold:      "Ditahan",
  released:  "Barang Dilepas",
  completed: "Selesai",
};

export function isValidCustomsStatus(s: string): boolean {
  return PPJK_CUSTOMS_STATUSES.includes(s as PpjkCustomsStatus);
}

/** Terminal statuses that cannot be transitioned out of. */
export const PPJK_TERMINAL_STATUSES: PpjkStatus[] = ["completed", "cancelled"];
