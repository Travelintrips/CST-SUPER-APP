import { api } from "@/lib/api";

// ── Enums / Union types ──────────────────────────────────────────────────────

export type AIReviewDecision =
  | "APPROVE_RECOMMENDATION"
  | "CHANGE_COA"
  | "REJECT_RECOMMENDATION"
  | "REQUEST_INFORMATION"
  | "ESCALATE";

export type AIReviewStatus =
  | "QUEUED"
  | "ASSIGNED"
  | "IN_REVIEW"
  | "APPROVED"
  | "COA_CHANGED"
  | "REJECTED"
  | "INFO_REQUESTED"
  | "ESCALATED"
  | "CLOSED"
  | "CANCELLED"
  | "REEVALUATED";

export type AIReviewPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type AIReviewQueue =
  | "ACCOUNTING_REVIEW"
  | "TREASURY_REVIEW"
  | "TAX_REVIEW"
  | "PAYROLL_REVIEW"
  | "INTERCOMPANY_REVIEW"
  | "HIGH_RISK_REVIEW";

export type AIRiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

// ── Core types ───────────────────────────────────────────────────────────────

export interface AICoaCandidate {
  coaId?: string;
  coaCode: string;
  coaName: string;
  confidence: number;
  rank?: number;
  reason?: string;
}

export interface AISlaInfo {
  deadlineAt?: string;
  dueAt?: string;
  isOverdue?: boolean;
  hoursRemaining?: number;
  slaStatus?: "ON_TRACK" | "AT_RISK" | "OVERDUE" | "COMPLETED";
}

export interface AIAnomalyFinding {
  type: string;
  description?: string;
  evidence?: string[];
  severity?: string;
  score?: number;
}

export interface AIPolicyDecision {
  reviewRequired?: boolean;
  queue?: AIReviewQueue;
  priority?: AIReviewPriority;
  reviewerRole?: string;
  slaHours?: number;
  escalationRecommended?: boolean;
  policyVersion?: string;
  rulesFired?: string[];
}

export interface AIExplainability {
  summary?: string;
  intentReason?: string;
  matchedKeywords?: string[];
  directionEvidence?: string[];
  counterpartyEvidence?: string[];
  historicalEvidence?: string[];
  amountPattern?: string;
  candidateRanking?: AICoaCandidate[];
  confidenceDeductions?: Array<{ reason: string; amount?: number }>;
  ambiguityFlags?: string[];
  policyRulesFired?: string[];
  taxSubtype?: string;
  taxUncertaintyWarning?: string;
}

export interface AIReviewCase {
  id: string;
  transactionId: string;
  companyId: string;
  status: AIReviewStatus;
  queue: AIReviewQueue;
  priority: AIReviewPriority;
  riskLevel?: AIRiskLevel;
  anomalyScore?: number;

  // Transaction fields
  transactionDate?: string;
  transactionSource?: string;
  description?: string;
  counterparty?: string;
  accountNumber?: string;
  amount?: number;
  currency?: string;
  direction?: "DEBIT" | "CREDIT";
  reference?: string;

  // AI recommendation
  detectedIntent?: string;
  intentConfidence?: number;
  recommendedCoaId?: string;
  recommendedCoaCode?: string;
  recommendedCoaName?: string;
  coaConfidence?: number;
  manualReviewFlag?: boolean;

  // Assignment
  assignedReviewerId?: string;
  assignedReviewerName?: string;
  assignedReviewerRole?: string;

  // SLA
  sla?: AISlaInfo;

  // Snapshot version
  snapshotVersion?: number;
  policyVersion?: string;

  // Timestamps
  createdAt: string;
  updatedAt?: string;
  reviewStartedAt?: string;
  decidedAt?: string;

  // Decision outcome
  decision?: AIReviewDecision;
  selectedCoaCode?: string;
  selectedCoaName?: string;
  reasonCode?: string;
  comments?: string;
  reviewerConfidence?: number;
  decidedByReviewerId?: string;
}

export interface AIReviewDetail extends AIReviewCase {
  // Full AI analysis
  explainability?: AIExplainability;
  alternativeCoas?: AICoaCandidate[];
  confidenceBreakdown?: Array<{ factor: string; contribution: number; description?: string }>;
  anomalyFindings?: AIAnomalyFinding[];
  policyDecision?: AIPolicyDecision;
  rawSnapshot?: Record<string, unknown>;
  taxSubtype?: string | null;
  taxUncertaintyWarning?: string | null;
  latestSnapshot?: AIReviewSnapshot | null;
  decisions?: Array<Record<string, unknown>>;
  auditEvents?: Array<Record<string, unknown>>;
}

export interface AIReviewSnapshot {
  id: string;
  caseId: string;
  version: number;
  createdAt: string;
  policyVersion?: string;
  orchestrationVersion?: string;
  checksum?: string;
  // Snapshot data fields
  detectedIntent?: string;
  intentConfidence?: number;
  recommendedCoaCode?: string;
  recommendedCoaName?: string;
  coaConfidence?: number;
  anomalyScore?: number;
  queue?: AIReviewQueue;
  priority?: AIReviewPriority;
  policyDecision?: AIPolicyDecision;
}

export interface AIReviewAuditEvent {
  id: string;
  caseId: string;
  eventType: string;
  eventLabel?: string;
  createdAt: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  prevStatus?: AIReviewStatus;
  newStatus?: AIReviewStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AIReviewObservability {
  totalCases?: number;
  openCases?: number;
  overdueCases?: number;
  manualReviewRate?: number;
  approvalRate?: number;
  coaChangeRate?: number;
  rejectionRate?: number;
  escalationRate?: number;
  agreementRate?: number;
  avgReviewDurationMinutes?: number;
  slaComplianceRate?: number;
  byQueue?: Record<string, number>;
  byPriority?: Record<string, number>;
  byStatus?: Record<string, number>;
  byAnomalyRisk?: Record<string, number>;
  recentActivity?: Array<{ date: string; count: number }>;
}

export interface AILearningFeedback {
  id: string;
  caseId?: string;
  feedbackType?: string;
  originalIntent?: string;
  correctedIntent?: string;
  originalCoa?: string;
  correctedCoa?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AIRulePackage {
  id: string;
  version: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  createdAt: string;
}

// ── Filter / Payload types ───────────────────────────────────────────────────

export interface AIReviewFilters {
  status?: AIReviewStatus | "";
  queue?: AIReviewQueue | "";
  priority?: AIReviewPriority | "";
  riskLevel?: AIRiskLevel | "";
  reviewerId?: string;
  transactionId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface AIReviewDecisionPayload {
  decision: AIReviewDecision;
  selectedCoaId?: string;
  selectedCoaCode?: string;
  selectedCoaName?: string;
  reasonCode?: string;
  comments?: string;
  reviewerConfidence?: number;
  idempotencyKey: string;
}

export interface AIReviewAssignPayload {
  reviewerId: string;
  reviewerRole: string;
  idempotencyKey: string;
}

export interface AIReevaluatePayload {
  reason: string;
  idempotencyKey: string;
}

// ── Paginated response wrapper ───────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ── API response wrapper (from backend) ─────────────────────────────────────

interface ApiOkResponse<T> {
  ok: true;
  data: T;
}

// ── API client methods ───────────────────────────────────────────────────────

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== "" && val !== null) {
      qs.set(key, String(val));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

export const aiReviewApi = {
  /** List review cases with optional filters + pagination */
  listCases: async (filters: AIReviewFilters = {}): Promise<PaginatedResult<AIReviewCase>> => {
    const { page = 1, limit = 25, ...rest } = filters;
    const qs = buildQuery({ ...rest, page, limit } as Record<string, string | number | undefined>);
    const { data } = await api.get<ApiOkResponse<PaginatedResult<AIReviewCase>>>(
      `/api/ai-transaction/review-cases${qs}`
    );
    return data.data;
  },

  /** Get single case detail (includes full AI analysis) */
  getCase: async (id: string): Promise<AIReviewDetail> => {
    const { data } = await api.get<ApiOkResponse<AIReviewDetail>>(
      `/api/ai-transaction/review-cases/${id}`
    );
    return data.data;
  },

  /** Get snapshot history for a case */
  getSnapshots: async (id: string): Promise<AIReviewSnapshot[]> => {
    const { data } = await api.get<ApiOkResponse<AIReviewSnapshot[]>>(
      `/api/ai-transaction/review-cases/${id}/snapshots`
    );
    return data.data;
  },

  /** Get append-only audit log for a case */
  getAudit: async (id: string): Promise<AIReviewAuditEvent[]> => {
    const { data } = await api.get<ApiOkResponse<AIReviewAuditEvent[]>>(
      `/api/ai-transaction/review-cases/${id}/audit`
    );
    return data.data;
  },

  /** Assign reviewer to a case */
  assignCase: async (id: string, payload: AIReviewAssignPayload): Promise<AIReviewDetail> => {
    const { data } = await api.post<ApiOkResponse<AIReviewDetail>>(
      `/api/ai-transaction/review-cases/${id}/assign`,
      payload
    );
    return data.data;
  },

  /** Start reviewing a case (idempotent) */
  startReview: async (id: string): Promise<AIReviewDetail> => {
    const { data } = await api.post<ApiOkResponse<AIReviewDetail>>(
      `/api/ai-transaction/review-cases/${id}/start-review`
    );
    return data.data;
  },

  /** Submit reviewer decision */
  submitDecision: async (id: string, payload: AIReviewDecisionPayload): Promise<AIReviewDetail> => {
    const { data } = await api.post<ApiOkResponse<AIReviewDetail>>(
      `/api/ai-transaction/review-cases/${id}/decision`,
      payload
    );
    return data.data;
  },

  /** Reevaluate case (admin only) */
  reevaluateCase: async (id: string, payload: AIReevaluatePayload): Promise<AIReviewDetail> => {
    const { data } = await api.post<ApiOkResponse<AIReviewDetail>>(
      `/api/ai-transaction/review-cases/${id}/reevaluate`,
      payload
    );
    return data.data;
  },

  /** Observability metrics */
  getObservability: async (): Promise<AIReviewObservability> => {
    const { data } = await api.get<ApiOkResponse<AIReviewObservability>>(
      `/api/ai-transaction/observability`
    );
    return data.data;
  },

  /** Learning feedback (admin only) */
  getLearningFeedback: async (): Promise<AILearningFeedback[]> => {
    const { data } = await api.get<ApiOkResponse<AILearningFeedback[]>>(
      `/api/ai-transaction/learning-feedback`
    );
    return data.data;
  },

  /** Rule packages */
  getRulePackages: async (): Promise<AIRulePackage[]> => {
    const { data } = await api.get<ApiOkResponse<AIRulePackage[]>>(
      `/api/ai-transaction/rule-packages`
    );
    return data.data;
  },
};

// ── UI helpers ────────────────────────────────────────────────────────────────

export function maskAccountNumber(account: string | undefined | null): string {
  if (!account) return "";
  if (account.length <= 4) return account;
  return `******${account.slice(-4)}`;
}

export function confidenceLabel(confidence: number | undefined | null): string {
  if (confidence == null) return "—";
  const pct = confidence <= 1 ? confidence * 100 : confidence;
  if (pct >= 90) return "Sangat Tinggi";
  if (pct >= 75) return "Tinggi";
  if (pct >= 60) return "Sedang";
  return "Rendah";
}

export function confidencePct(confidence: number | undefined | null): string {
  if (confidence == null) return "—";
  const pct = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
  return `${pct}%`;
}

export const STATUS_LABELS: Record<AIReviewStatus, string> = {
  QUEUED: "Antrian",
  ASSIGNED: "Ditugaskan",
  IN_REVIEW: "Sedang Ditinjau",
  APPROVED: "Disetujui",
  COA_CHANGED: "COA Diubah",
  REJECTED: "Ditolak",
  INFO_REQUESTED: "Info Diminta",
  ESCALATED: "Dieskalasi",
  CLOSED: "Selesai",
  CANCELLED: "Dibatalkan",
  REEVALUATED: "Dievaluasi Ulang",
};

export const STATUS_COLORS: Record<AIReviewStatus, string> = {
  QUEUED: "bg-yellow-100 text-yellow-800 border-yellow-200",
  ASSIGNED: "bg-blue-100 text-blue-800 border-blue-200",
  IN_REVIEW: "bg-indigo-100 text-indigo-800 border-indigo-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  COA_CHANGED: "bg-teal-100 text-teal-800 border-teal-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  INFO_REQUESTED: "bg-orange-100 text-orange-800 border-orange-200",
  ESCALATED: "bg-purple-100 text-purple-800 border-purple-200",
  CLOSED: "bg-gray-100 text-gray-600 border-gray-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
  REEVALUATED: "bg-cyan-100 text-cyan-800 border-cyan-200",
};

export const PRIORITY_COLORS: Record<AIReviewPriority, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  HIGH: "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-200",
  LOW: "bg-gray-100 text-gray-600 border-gray-200",
};

export const PRIORITY_LABELS: Record<AIReviewPriority, string> = {
  CRITICAL: "Kritis",
  HIGH: "Tinggi",
  MEDIUM: "Sedang",
  LOW: "Rendah",
};

export const QUEUE_LABELS: Record<AIReviewQueue, string> = {
  ACCOUNTING_REVIEW: "Akuntansi",
  TREASURY_REVIEW: "Keuangan",
  TAX_REVIEW: "Pajak",
  PAYROLL_REVIEW: "Penggajian",
  INTERCOMPANY_REVIEW: "Intercompany",
  HIGH_RISK_REVIEW: "Risiko Tinggi",
};

export const RISK_LEVEL_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  HIGH: "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-200",
  LOW: "bg-green-100 text-green-800 border-green-200",
  NONE: "bg-gray-100 text-gray-500 border-gray-200",
};

export const TERMINAL_STATUSES: AIReviewStatus[] = [
  "APPROVED",
  "COA_CHANGED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
];

export function isTerminalStatus(status: AIReviewStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const REASON_CODE_LABELS: Record<string, string> = {
  wrong_intent: "Intent salah",
  wrong_coa: "COA salah",
  insufficient_evidence: "Bukti tidak cukup",
  duplicate_transaction: "Transaksi duplikat",
  incorrect_source: "Sumber tidak benar",
  policy_mismatch: "Tidak sesuai kebijakan",
  other: "Lainnya",
};

export const AUDIT_EVENT_LABELS: Record<string, string> = {
  CASE_CREATED: "Kasus dibuat",
  QUEUED: "Masuk antrian",
  ASSIGNED: "Ditugaskan",
  REVIEW_STARTED: "Ditinjau",
  INFORMATION_REQUESTED: "Info diminta",
  RECOMMENDATION_APPROVED: "Rekomendasi disetujui",
  COA_CHANGED: "COA diubah",
  RECOMMENDATION_REJECTED: "Rekomendasi ditolak",
  ESCALATED: "Dieskalasi",
  REEVALUATED: "Dievaluasi ulang",
  CANCELLED: "Dibatalkan",
  CLOSED: "Ditutup",
  // Phase 12
  SOURCE_LINKED: "Sumber dihubungkan",
  SOURCE_REVIEW_OPENED: "Review sumber dibuka",
};

// ── Phase 12: Source cross-link types ────────────────────────────────────────

export interface AIReviewBySourceResult {
  exists: boolean;
  reviewCase: AIReviewCase | null;
}

export interface AICreateFromSourcePayload {
  source: string;
  sourceRecordId: string;
  transaction: {
    id: string;
    description: string;
    amount?: number;
    currency?: string;
    direction?: "DEBIT" | "CREDIT" | "UNKNOWN";
    transactionDate?: string;
    counterpartyName?: string;
    counterpartyAccount?: string;
    referenceNumber?: string;
    transactionCode?: string;
    bankName?: string;
  };
}

export interface AICreateFromSourceResult {
  created: boolean;
  reviewCaseId?: string | number;
  idempotencyKey?: string;
  status?: AIReviewStatus;
  queue?: AIReviewQueue;
  priority?: AIReviewPriority;
  reviewCase?: AIReviewCase;
}

// ── Phase 12: Source API methods (appended to aiReviewApi) ───────────────────

// Extend aiReviewApi with the new source methods via module augmentation pattern
// (added inline to the existing object in a separate declaration for clarity)

export const aiReviewSourceApi = {
  /**
   * Check if a review case exists for a given source entity.
   * Returns { exists, reviewCase } — does NOT create a case.
   */
  getBySource: async (source: string, sourceRecordId: string): Promise<AIReviewBySourceResult> => {
    const qs = `?source=${encodeURIComponent(source)}&sourceRecordId=${encodeURIComponent(sourceRecordId)}`;
    const { data } = await api.get<{ ok: true; data: AIReviewBySourceResult }>(
      `/api/ai-transaction/review-cases/by-source${qs}`
    );
    return data.data;
  },

  /**
   * Create a review case from a source entity.
   * Idempotent — returns existing case if already created.
   */
  createFromSource: async (payload: AICreateFromSourcePayload): Promise<AICreateFromSourceResult> => {
    const { data } = await api.post<{ ok: true; data: AICreateFromSourceResult }>(
      `/api/ai-transaction/review-cases/from-source`,
      payload
    );
    return data.data;
  },
};
