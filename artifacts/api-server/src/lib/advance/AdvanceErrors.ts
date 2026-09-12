/**
 * AdvanceErrors — Unified error classes for Advance Management module.
 *
 * RULE: All service methods MUST throw these typed errors instead of:
 *   ✗ throw "string"
 *   ✗ return false
 *   ✗ return null
 *   ✓ throw new AdvanceError(...)
 *
 * Routes convert these to HTTP responses via sendAdvanceError().
 */

export class AdvanceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "AdvanceError";
  }
}

export class AdvanceNotFoundError extends AdvanceError {
  constructor(id: number) {
    super(`Advance #${id} tidak ditemukan`, "ADVANCE_NOT_FOUND", 404);
  }
}

export class InvalidTransitionError extends AdvanceError {
  constructor(from: string, to: string) {
    super(
      `Tidak bisa transisi status dari '${from}' ke '${to}'`,
      "INVALID_TRANSITION",
      400,
    );
  }
}

export class JournalPostingError extends AdvanceError {
  constructor(reason: string) {
    super(`Gagal posting jurnal: ${reason}`, "JOURNAL_POSTING_FAILED", 400);
  }
}

export class MoneyMovedError extends AdvanceError {
  constructor() {
    super(
      "Dana sudah bergerak — tidak bisa Void. Gunakan Repayment/Settlement.",
      "MONEY_MOVED",
      400,
    );
  }
}

export class AlreadyVoidedError extends AdvanceError {
  constructor() {
    super("Advance ini sudah di-void sebelumnya.", "ALREADY_VOIDED", 400);
  }
}

export class AccountingConfigError extends AdvanceError {
  constructor(detail: string) {
    super(detail, "ACCOUNTING_CONFIG_MISSING", 400);
  }
}

export class DuplicateJournalError extends AdvanceError {
  constructor(advanceNumber: string) {
    super(
      `Jurnal disbursement untuk ${advanceNumber} sudah pernah diposting sebelumnya.`,
      "DUPLICATE_JOURNAL",
      400,
    );
  }
}

export class InsufficientRemainingError extends AdvanceError {
  constructor(requested: number, remaining: number) {
    super(
      `Nominal (${requested}) melebihi sisa piutang (${remaining}).`,
      "INSUFFICIENT_REMAINING",
      400,
    );
  }
}

/**
 * Convert an AdvanceError (or unknown error) into a consistent Express JSON response.
 * Response shape is always: { message: string, code?: string, requestId?: string }
 *
 * SECURITY: Raw Drizzle query strings and PostgreSQL internals MUST NOT reach the
 * frontend. Only sanitised human-readable messages are sent.
 */
export function sendAdvanceError(
  res: import("express").Response,
  err: unknown,
  requestId?: string,
): void {
  if (err instanceof AdvanceError) {
    res.status(err.statusCode).json({
      message: err.message,
      code: err.code,
      ...(requestId ? { requestId } : {}),
    });
    return;
  }

  const rawMsg = err instanceof Error ? err.message : String(err);

  // ── Translate known structured error prefixes to user-friendly messages ────
  if (rawMsg.startsWith("PERIOD_CLOSED:")) {
    res.status(400).json({
      message: "Jurnal tidak bisa diposting karena periode keuangan sudah ditutup. Hubungi tim keuangan untuk membuka periode atau gunakan tanggal di periode yang masih terbuka.",
      code: "PERIOD_LOCKED",
      ...(requestId ? { requestId } : {}),
    });
    return;
  }
  if (rawMsg.startsWith("JOURNAL_TX_ABORTED:")) {
    res.status(500).json({
      message: "Gagal mencatat jurnal pengembalian dana talangan karena transaksi dibatalkan. Coba lagi.",
      code: "ADVANCE_REPAYMENT_JOURNAL_FAILED",
      ...(requestId ? { requestId } : {}),
    });
    return;
  }
  if (rawMsg.startsWith("JOURNAL_FK_VIOLATION:") || rawMsg.startsWith("JOURNAL_NULL_VIOLATION:")) {
    res.status(400).json({
      message: "Konfigurasi akuntansi tidak lengkap. Pastikan akun kas/bank dan piutang telah dikonfigurasi dengan benar.",
      code: "ACCOUNTING_CONFIG_MISSING",
      ...(requestId ? { requestId } : {}),
    });
    return;
  }
  if (rawMsg.includes("journal entry") || rawMsg.includes("Failed to create") ||
      rawMsg.includes("Failed query") || rawMsg.includes("accounting_entries")) {
    // Do NOT expose raw SQL or Drizzle internals to the frontend.
    res.status(500).json({
      message: "Gagal mencatat jurnal pengembalian dana talangan. Tidak ada saldo, cicilan, atau jurnal yang berubah.",
      code: "ADVANCE_REPAYMENT_JOURNAL_FAILED",
      ...(requestId ? { requestId } : {}),
    });
    return;
  }

  // Generic fallback — still sanitised (no raw SQL)
  const safeMsg = rawMsg.length > 200 ? rawMsg.slice(0, 200) + "…" : rawMsg;
  res.status(500).json({
    message: safeMsg,
    code: "INTERNAL_ERROR",
    ...(requestId ? { requestId } : {}),
  });
}
