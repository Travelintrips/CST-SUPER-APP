/**
 * Structured reconciliation diagnosis.
 *
 * This contract is intentionally safe to persist and return to the browser:
 * it contains source identifiers and remediation guidance, never credentials
 * or raw database connection details.
 */

export type ReconciliationRepairResult =
  | "FIXED_AND_RETRIED"
  | "ADMIN_ACTION_REQUIRED"
  | "DEVELOPER_ACTION_REQUIRED";

export interface StructuredReconciliationDiagnosis {
  errorCode: string;
  title: string;
  rootCause: string;
  affectedRecord: {
    type: string;
    id: string | number | null;
    mutationId?: number | null;
    companyId?: number | null;
  } | null;
  expectedValue: unknown;
  actualValue: unknown;
  canAutoFix: boolean;
  autoFixAction: string | null;
  adminAction: string | null;
  adminLocation: string | null;
  tableName: string | null;
  recordId: string | number | null;
  fieldNames: string[];
  retryAllowed: boolean;
  correlationId: string;
  component: string;

  // Backward-compatible fields used by the current persisted/UI projection.
  code: string;
  stage: string;
  problem: string;
  revision: string;
  action: string;
  technicalDetail?: string | null;
}

export interface QrisDiagnosisContext {
  candidateId?: number | null;
  mutationId?: number | null;
  companyId?: number | null;
  correlationId?: string | null;
}

type DiagnosisProfile = {
  title: string;
  rootCause: string;
  expectedValue: unknown;
  adminAction: string | null;
  adminLocation: string | null;
  tableName: string | null;
  fieldNames: string[];
  canAutoFix?: boolean;
  autoFixAction?: string | null;
  retryAllowed?: boolean;
  developerAction?: boolean;
};

const PROFILE_BY_CODE: Record<string, DiagnosisProfile> = {
  PORTAL_SCP_ORIGIN_INVALID: {
    title: "Origin payment Sport Center tidak valid",
    rootCause: "Payment canonical tidak memiliki identitas origin yang dapat diverifikasi oleh settlement safeguard.",
    expectedValue: "Origin payment canonical yang valid dan konsisten dengan source Sport Center.",
    adminAction: "Perbaiki metadata origin pada payment sumber. Jangan membuat settlement atau jurnal manual.",
    adminLocation: "Sport Center → Payment → metadata origin/source",
    tableName: "sport_center.sport_payments",
    fieldNames: ["origin", "source", "payment_provider"],
  },
  PAYMENT_NOT_CONFIRMED: {
    title: "Payment Sport Center belum confirmed",
    rootCause: "Payment belum mencapai status confirmed sehingga belum boleh menjadi bukti settlement.",
    expectedValue: "status = confirmed",
    adminAction: "Konfirmasi payment pada workflow Sport Center, lalu jalankan retry.",
    adminLocation: "Sport Center → Payments",
    tableName: "sport_center.sport_payments",
    fieldNames: ["status", "confirmed_at", "paid_at"],
  },
  INVALID_CANDIDATE: {
    title: "Kandidat QRIS tidak valid",
    rootCause: "Snapshot kandidat tidak lagi konsisten dengan payment canonical, nominal, tanggal, provider, atau company.",
    expectedValue: "Kandidat H-1 dengan payment canonical valid, company sama, dan payment_items unik.",
    adminAction: "Perbaiki source yang disebutkan, lalu buat ulang kandidat QRIS.",
    adminLocation: "Bank Reconciliation → kandidat QRIS dan source payment",
    tableName: "qris_mutation_batch_candidates",
    fieldNames: ["payment_items", "company_id", "source_date", "estimated_settlement_date", "provider_code"],
    canAutoFix: true,
    autoFixAction: "Regenerasi snapshot kandidat dari source canonical dan retry hanya untuk mutasi ini.",
    retryAllowed: true,
  },
  CANONICAL_SETTLEMENT_CONFIG_UNRESOLVED: {
    title: "Konfigurasi settlement QRIS belum ditemukan",
    rootCause: "Tidak ada tepat satu konfigurasi MDR owner-approved yang berlaku untuk company, provider, rekening, dan tanggal settlement.",
    expectedValue: "Satu payment_settlement_config aktif yang cakupannya tepat.",
    adminAction: "Lengkapi atau aktifkan satu konfigurasi settlement owner-approved, lalu tekan Retry.",
    adminLocation: "Accounting → Bank Reconciliation → konfigurasi settlement QRIS",
    tableName: "sport_center.payment_settlement_configs",
    fieldNames: ["company_id", "provider", "bank_account_id", "effective_from", "effective_until", "status"],
    retryAllowed: true,
  },
  CANONICAL_SETTLEMENT_CONFIG_AMBIGUOUS: {
    title: "Konfigurasi settlement QRIS tumpang tindih",
    rootCause: "Lebih dari satu konfigurasi owner-approved cocok untuk settlement yang sama.",
    expectedValue: "Tepat satu konfigurasi settlement owner-approved.",
    adminAction: "Sisakan satu konfigurasi yang berlaku untuk provider, rekening, company, dan tanggal tersebut, lalu tekan Retry.",
    adminLocation: "Accounting → Bank Reconciliation → konfigurasi settlement QRIS",
    tableName: "sport_center.payment_settlement_configs",
    fieldNames: ["company_id", "provider", "bank_account_id", "effective_from", "effective_until", "status"],
    retryAllowed: true,
  },
  CANONICAL_SETTLEMENT_BANK_COA_UNRESOLVED: {
    title: "COA bank canonical belum dapat ditentukan",
    rootCause: "Rekening bank belum memiliki satu COA canonical yang postable untuk company aktif.",
    expectedValue: "Satu COA bank canonical yang postable dan dimiliki company.",
    adminAction: "Hubungkan rekening bank ke COA canonical yang postable, lalu tekan Retry.",
    adminLocation: "Accounting → Master Bank Account → COA",
    tableName: "company_bank_accounts",
    fieldNames: ["coa_id", "company_id", "bank_account_id"],
    retryAllowed: true,
  },
  CANONICAL_PAYMENT_JOURNAL_NOT_POSTED: {
    title: "Jurnal payment belum posted",
    rootCause: "Payment canonical ada, tetapi jurnal payment belum berstatus posted.",
    expectedValue: "Jurnal payment canonical berstatus posted dan balance.",
    adminAction: "Selesaikan posting melalui workflow accounting yang resmi, lalu tekan Retry.",
    adminLocation: "Accounting → Payment Journal",
    tableName: "accounting_entries",
    fieldNames: ["status", "posted_at", "source_type", "source_id"],
    retryAllowed: true,
  },
  CANONICAL_PAYMENT_JOURNAL_BRIDGE_UNRESOLVED: {
    title: "Bridge payment ke jurnal belum valid",
    rootCause: "Payment tidak dapat dipetakan tepat ke satu jurnal canonical.",
    expectedValue: "Satu relasi payment → jurnal canonical yang exact dan tidak ambigu.",
    adminAction: "Perbaiki relasi sumber melalui workflow accounting. Jangan membuat jurnal paralel.",
    adminLocation: "Accounting → Payment Journal → source linkage",
    tableName: "accounting_payments",
    fieldNames: ["journal_entry_id", "source_type", "source_id"],
    retryAllowed: true,
  },
  CANONICAL_SETTLEMENT_JOURNAL_NOT_POSTED: {
    title: "Jurnal settlement belum posted",
    rootCause: "Settlement canonical belum memiliki jurnal posted yang dapat direconcile.",
    expectedValue: "Jurnal settlement posted dan balance.",
    adminAction: "Periksa posting jurnal settlement melalui workflow canonical, lalu tekan Retry.",
    adminLocation: "Accounting → Settlement Journal",
    tableName: "accounting_entries",
    fieldNames: ["status", "posted_at", "source_type", "source_id"],
    retryAllowed: true,
  },
  CANONICAL_SETTLEMENT_JOURNAL_NOT_BALANCED: {
    title: "Jurnal settlement tidak balance",
    rootCause: "Total debit dan kredit jurnal settlement tidak sama.",
    expectedValue: "Total debit = total kredit.",
    adminAction: "Perbaiki konfigurasi/COA sumber yang menghasilkan jurnal, lalu gunakan workflow posting resmi.",
    adminLocation: "Accounting → Settlement Journal → detail jurnal",
    tableName: "accounting_entry_lines",
    fieldNames: ["entry_id", "account_id", "debit", "credit"],
    retryAllowed: true,
  },
  CANONICAL_PAYMENT_SETTLEMENT_STATE_CONFLICT: {
    title: "Payment sudah dimiliki settlement lain",
    rootCause: "Payment canonical memiliki ownership settlement aktif atau posted yang bertentangan.",
    expectedValue: "Payment belum dimiliki settlement lain, atau hanya satu ownership canonical yang valid.",
    adminAction: "Muat ulang kandidat dan review settlement pemilik payment. Jangan approve ulang.",
    adminLocation: "Bank Reconciliation → settlement QRIS",
    tableName: "sport_center.payment_settlement_items",
    fieldNames: ["payment_id", "settlement_id", "item_status"],
    retryAllowed: true,
  },
  QRIS_CANDIDATE_CONFLICT: {
    title: "Snapshot kandidat QRIS berubah saat diproses",
    rootCause: "Proses lain memperbarui kandidat pada waktu yang sama.",
    expectedValue: "Snapshot kandidat terbaru dari source canonical.",
    adminAction: null,
    adminLocation: null,
    tableName: "qris_mutation_batch_candidates",
    fieldNames: ["mutation_id", "status", "updated_at"],
    canAutoFix: true,
    autoFixAction: "Muat ulang snapshot kandidat terbaru dan retry scoped dengan claim idempotent.",
    retryAllowed: true,
  },
  QRIS_APPROVAL_CONFLICT: {
    title: "Approval QRIS diproses oleh proses lain",
    rootCause: "Lock atau unique guard mencegah dua proses menyelesaikan settlement yang sama.",
    expectedValue: "Satu proses approval canonical untuk satu candidate.",
    adminAction: "Muat ulang status settlement. Jika belum selesai, jalankan retry scoped sekali.",
    adminLocation: "Bank Reconciliation → settlement QRIS",
    tableName: "qris_mutation_batch_candidates",
    fieldNames: ["auto_post_status", "status", "updated_at"],
    canAutoFix: true,
    autoFixAction: "Gunakan claim idempotent dan jalankan ulang approval melalui endpoint canonical.",
    retryAllowed: true,
  },
  MATCHING_IN_PROGRESS: {
    title: "Matching masih berjalan",
    rootCause: "Kandidat QRIS tidak boleh dibuat saat unified matching aktif.",
    expectedValue: "Tidak ada unified matching job aktif.",
    adminAction: "Tunggu matching selesai, lalu tekan Retry.",
    adminLocation: "Bank Reconciliation → status workflow",
    tableName: null,
    fieldNames: [],
    retryAllowed: true,
  },
};

function normalizeCode(error: any): string {
  const message = String(error?.message ?? error?.cause?.message ?? "").slice(0, 1000);
  const embedded = message.match(
    /\b(?:PORTAL_SCP_ORIGIN_INVALID|PAYMENT_NOT_CONFIRMED|INVALID_CANDIDATE|CANONICAL_[A-Z0-9_]+|QRIS_[A-Z0-9_]+|MATCHING_IN_PROGRESS)\b/,
  )?.[0];
  return embedded ?? String(error?.code ?? error?.cause?.code ?? "QRIS_AUTO_POST_FAILED");
}

function errorMessage(error: any): string {
  return String(error?.message ?? error?.cause?.message ?? "Auto-post QRIS gagal")
    .replace(/^Failed query:\s*/i, "")
    .trim()
    .slice(0, 500);
}

export function buildQrisAutoPostDiagnosis(
  error: unknown,
  context: QrisDiagnosisContext = {},
): StructuredReconciliationDiagnosis {
  const rawError = error as any;
  const code = normalizeCode(rawError);
  const message = errorMessage(rawError);
  const profile = PROFILE_BY_CODE[code];
  const developerAction = profile?.developerAction
    ?? (!profile && ![
      "QRIS_CANDIDATE_CONFLICT",
      "QRIS_APPROVAL_CONFLICT",
      "MATCHING_IN_PROGRESS",
    ].includes(code));
  const title = profile?.title ?? "Perlu perbaikan sistem pada auto-post QRIS";
  const stage = String(rawError?.qrisStage ?? (
    code.includes("ORIGIN") ? "source payment Sport Center" :
      code.includes("CONFIG") ? "konfigurasi MDR" :
        code.includes("COA") ? "COA bank canonical" :
          code.includes("JOURNAL") ? "jurnal settlement" :
            code.includes("PAYMENT") ? "validasi payment" :
              code.includes("BANK") || code.includes("MUTATION") ? "mutasi bank" :
                "settlement canonical"
  ));
  const recordId = context.candidateId ?? context.mutationId ?? null;
  const correlationId = context.correlationId
    ?? String(rawError?.correlationId ?? `qris-${context.mutationId ?? context.candidateId ?? "unknown"}`);
  const expectedValue = profile?.expectedValue
    ?? "Proses canonical berhasil tanpa melonggarkan safeguard accounting/settlement.";
  const actualValue = {
    message,
    code,
    stage,
    candidateId: context.candidateId ?? null,
    mutationId: context.mutationId ?? null,
    companyId: context.companyId ?? null,
  };
  const adminAction = profile?.adminAction
    ?? (developerAction
      ? "Jangan mengubah database untuk menutupi error. Eskalasi dengan correlation ID kepada developer."
      : "Periksa source/configuration terkait lalu tekan Retry.");
  const adminLocation = profile?.adminLocation
    ?? (developerAction ? "Developer action — log aplikasi dan komponen reconciliation" : "Bank Reconciliation");
  const tableName = profile?.tableName ?? "qris_mutation_batch_candidates";
  const fieldNames = profile?.fieldNames ?? ["status", "auto_post_status", "auto_post_details"];
  const retryAllowed = profile?.retryAllowed ?? false;
  const canAutoFix = profile?.canAutoFix === true;
  const autoFixAction = canAutoFix
    ? profile?.autoFixAction ?? "Regenerasi snapshot dari source canonical dan retry scoped."
    : null;
  const action = canAutoFix
    ? autoFixAction ?? "Auto-fix deterministik dan retry scoped."
    : adminAction;

  return {
    errorCode: code,
    title,
    rootCause: profile?.rootCause ?? "Error tidak termasuk kategori self-healing yang aman.",
    affectedRecord: {
      type: "qris_mutation_batch_candidate",
      id: recordId,
      mutationId: context.mutationId ?? null,
      companyId: context.companyId ?? null,
    },
    expectedValue,
    actualValue,
    canAutoFix,
    autoFixAction,
    adminAction: developerAction ? null : adminAction,
    adminLocation,
    tableName,
    recordId,
    fieldNames,
    retryAllowed,
    correlationId,
    component: "bank-reconciliation.qris-auto-post",
    code,
    stage,
    problem: message || "Safeguard canonical menahan auto-post.",
    revision: profile?.rootCause ?? "Data/configuration canonical pada tahap auto-post",
    action,
    technicalDetail: rawError?.detail
      ? String(rawError.detail).slice(0, 500)
      : rawError?.cause?.detail
        ? String(rawError.cause.detail).slice(0, 500)
        : null,
  };
}

export function asRepairResult(
  diagnosis: StructuredReconciliationDiagnosis,
): ReconciliationRepairResult {
  if (diagnosis.canAutoFix && diagnosis.retryAllowed) return "FIXED_AND_RETRIED";
  if (diagnosis.adminAction && diagnosis.retryAllowed) return "ADMIN_ACTION_REQUIRED";
  return "DEVELOPER_ACTION_REQUIRED";
}