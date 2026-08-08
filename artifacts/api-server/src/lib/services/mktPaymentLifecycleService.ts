import {
  db,
  mktApPreparationsTable,
  mktPaymentExecutionAttemptsTable,
  paymentRequestsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";

export const MARKETPLACE_PAYMENT_STATUSES = [
  "payment_request_created",
  "finance_review",
  "approved",
  "treasury_ready",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type MarketplacePaymentStatus = typeof MARKETPLACE_PAYMENT_STATUSES[number];
export type MarketplacePaymentAttemptStatus = "processing" | "completed" | "failed";

type Actor = { actorId?: string | null; actorName?: string | null };
type PaymentRequestRow = typeof paymentRequestsTable.$inferSelect;
type AttemptRow = typeof mktPaymentExecutionAttemptsTable.$inferSelect;

export type MarketplacePaymentFailureCode =
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "CONCURRENT_UPDATE"
  | "IDEMPOTENCY_CONFLICT"
  | "ATTEMPT_NOT_FOUND"
  | "CANCELLATION_NOT_ALLOWED"
  | "INVALID_REASON";

export type MarketplacePaymentLifecycleResult =
  | {
      ok: true;
      paymentRequest: PaymentRequestRow;
      attempt?: AttemptRow | null;
      alreadyExists: boolean;
    }
  | {
      ok: false;
      code: MarketplacePaymentFailureCode;
      currentStatus?: string | null;
      message?: string;
    };

class MarketplacePaymentTransactionError extends Error {
  readonly code = "CONCURRENT_UPDATE" as const;
}

function rollbackLifecycleTransaction(message: string): never {
  throw new MarketplacePaymentTransactionError(message);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}

function concurrentUpdateResult(message: string): MarketplacePaymentLifecycleResult {
  return { ok: false, code: "CONCURRENT_UPDATE", message };
}

function isMarketplaceRequest(row: PaymentRequestRow): boolean {
  // Legacy 09A rows may have the Marketplace source marker without the later
  // AP-preparation foreign key. The source marker remains authoritative for
  // lifecycle scope; the preparation link is optional for legacy context.
  return row.sourceType === "marketplace_ap_preparation";
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 3 && reason.length <= 2000 ? reason : null;
}

async function getPaymentRequest(id: number, tx: any = db): Promise<PaymentRequestRow | null> {
  const [row] = await tx
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.id, id))
    .limit(1);
  return row ?? null;
}

async function getMarketplaceContext(paymentRequest: PaymentRequestRow): Promise<number | null> {
  if (paymentRequest.mktApPreparationId == null) return null;
  const [preparation] = await db
    .select({ purchaseOrderId: mktApPreparationsTable.mktPurchaseOrderId })
    .from(mktApPreparationsTable)
    .where(eq(mktApPreparationsTable.id, paymentRequest.mktApPreparationId))
    .limit(1);
  return preparation?.purchaseOrderId ?? null;
}

async function recordLifecycleEvent(
  paymentRequest: PaymentRequestRow,
  actor: Actor,
  action: string,
  oldStatus: string | null,
  newStatus: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const purchaseOrderId = await getMarketplaceContext(paymentRequest);
  await logActivity({
    actorType: "admin",
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    mktPurchaseOrderId: purchaseOrderId,
    action,
    description: `${paymentRequest.payReqNumber}: ${oldStatus ?? "none"} → ${newStatus ?? "none"}`,
    oldValue: { paymentRequestId: paymentRequest.id, status: oldStatus },
    newValue: { paymentRequestId: paymentRequest.id, status: newStatus, ...extra },
    deduplicationKey: extra.idempotencyKey
      ? `mkt_payment:${paymentRequest.id}:${action}:${String(extra.idempotencyKey)}`
      : null,
  });
}

function queueLifecycleNotification(
  paymentRequest: PaymentRequestRow,
  eventType: string,
  status: string,
  extra: Record<string, unknown> = {},
): void {
  void getMarketplaceContext(paymentRequest).then((purchaseOrderId) =>
    enqueueNotification({
      eventType,
      recipientType: "admin",
      purchaseOrderId,
      payloadJson: {
        paymentRequestId: paymentRequest.id,
        payReqNumber: paymentRequest.payReqNumber,
        status,
        sourceType: paymentRequest.sourceType,
        ...extra,
      },
      deduplicationKey: `mkt_payment:${paymentRequest.id}:${eventType}:${extra.attemptId ?? status}`,
    }),
  ).catch(() => {});
}

async function transition(
  paymentRequestId: number,
  expectedStatus: MarketplacePaymentStatus,
  nextStatus: MarketplacePaymentStatus,
  actor: Actor,
  fields: Record<string, unknown>,
): Promise<MarketplacePaymentLifecycleResult> {
  let result: MarketplacePaymentLifecycleResult;
  try {
    result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(paymentRequestsTable)
      .where(eq(paymentRequestsTable.id, paymentRequestId))
      .for("update")
      .limit(1);
    if (!current || !isMarketplaceRequest(current)) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    if (current.mktLifecycleStatus === nextStatus) {
      return { ok: true as const, paymentRequest: current, alreadyExists: true };
    }
    if (current.mktLifecycleStatus !== expectedStatus) {
      return {
        ok: false as const,
        code: "INVALID_STATUS" as const,
        currentStatus: current.mktLifecycleStatus,
        message: `Payment request harus berstatus ${expectedStatus}`,
      };
    }
    const [updated] = await tx
      .update(paymentRequestsTable)
      .set({
        mktLifecycleStatus: nextStatus,
        updatedAt: new Date(),
        ...fields,
      })
      .where(and(
        eq(paymentRequestsTable.id, paymentRequestId),
        eq(paymentRequestsTable.mktLifecycleStatus, expectedStatus),
      ))
      .returning();
    if (!updated) rollbackLifecycleTransaction("Payment request berubah saat transisi lifecycle");
    return { ok: true as const, paymentRequest: updated, alreadyExists: false };
    });
  } catch (error) {
    if (error instanceof MarketplacePaymentTransactionError) return concurrentUpdateResult(error.message);
    throw error;
  }

  if (!result.ok || result.alreadyExists) return result;
  await recordLifecycleEvent(result.paymentRequest, actor, `mkt_payment_${nextStatus}`, expectedStatus, nextStatus);
  queueLifecycleNotification(result.paymentRequest, `mkt_payment_${nextStatus}`, nextStatus);
  return result;
}

export async function getMarketplacePaymentLifecycle(
  paymentRequestId: number,
): Promise<{ paymentRequest: PaymentRequestRow; attempts: AttemptRow[] } | null> {
  const paymentRequest = await getPaymentRequest(paymentRequestId);
  if (!paymentRequest || !isMarketplaceRequest(paymentRequest)) return null;
  const attempts = await db
    .select()
    .from(mktPaymentExecutionAttemptsTable)
    .where(eq(mktPaymentExecutionAttemptsTable.paymentRequestId, paymentRequestId))
    .orderBy(desc(mktPaymentExecutionAttemptsTable.attemptNumber));
  return { paymentRequest, attempts };
}

export function reviewMarketplacePayment(
  paymentRequestId: number,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  return transition(
    paymentRequestId,
    "payment_request_created",
    "finance_review",
    actor,
    { mktFinanceReviewedBy: actor.actorId ?? null, mktFinanceReviewedAt: new Date() },
  );
}

export function approveMarketplacePayment(
  paymentRequestId: number,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  return transition(
    paymentRequestId,
    "finance_review",
    "approved",
    actor,
    { status: "approved", approvedBy: actor.actorId ?? null, approvedAt: new Date(), mktApprovedBy: actor.actorId ?? null, mktApprovedAt: new Date() },
  );
}

export function markMarketplacePaymentTreasuryReady(
  paymentRequestId: number,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  return transition(
    paymentRequestId,
    "approved",
    "treasury_ready",
    actor,
    { mktTreasuryReadyBy: actor.actorId ?? null, mktTreasuryReadyAt: new Date() },
  );
}

export async function startMarketplacePaymentExecution(
  paymentRequestId: number,
  idempotencyKeyInput: unknown,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyInput);
  if (!idempotencyKey) {
    return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key wajib 8-128 karakter" };
  }

  let result: MarketplacePaymentLifecycleResult;
  try {
    result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(paymentRequestsTable)
      .where(eq(paymentRequestsTable.id, paymentRequestId))
      .for("update")
      .limit(1);
    if (!current || !isMarketplaceRequest(current)) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const [existingForKey] = await tx
      .select()
      .from(mktPaymentExecutionAttemptsTable)
      .where(eq(mktPaymentExecutionAttemptsTable.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existingForKey) {
      if (existingForKey.paymentRequestId !== paymentRequestId) {
        return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
      }
      return { ok: true as const, paymentRequest: current, attempt: existingForKey, alreadyExists: true };
    }
    if (current.mktLifecycleStatus === "processing") {
      const [existing] = await tx
        .select()
        .from(mktPaymentExecutionAttemptsTable)
        .where(and(
          eq(mktPaymentExecutionAttemptsTable.paymentRequestId, paymentRequestId),
          eq(mktPaymentExecutionAttemptsTable.status, "processing"),
        ))
        .limit(1);
      if (existing?.idempotencyKey === idempotencyKey) {
        return { ok: true as const, paymentRequest: current, attempt: existing, alreadyExists: true };
      }
      return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const, currentStatus: current.mktLifecycleStatus };
    }
    if (current.mktLifecycleStatus !== "treasury_ready") {
      return { ok: false as const, code: "INVALID_STATUS" as const, currentStatus: current.mktLifecycleStatus, message: "Payment request harus treasury_ready" };
    }
    const [last] = await tx
      .select({ attemptNumber: mktPaymentExecutionAttemptsTable.attemptNumber })
      .from(mktPaymentExecutionAttemptsTable)
      .where(eq(mktPaymentExecutionAttemptsTable.paymentRequestId, paymentRequestId))
      .orderBy(desc(mktPaymentExecutionAttemptsTable.attemptNumber))
      .limit(1);
    const attemptNumber = (last?.attemptNumber ?? 0) + 1;
    const [attempt] = await tx
      .insert(mktPaymentExecutionAttemptsTable)
      .values({
        paymentRequestId,
        attemptNumber,
        status: "processing",
        idempotencyKey,
        startedAt: new Date(),
        createdBy: actor.actorId ?? null,
      })
      .returning();
    if (!attempt) rollbackLifecycleTransaction("Execution attempt tidak terbentuk");
    const [updated] = await tx
      .update(paymentRequestsTable)
      .set({ mktLifecycleStatus: "processing", mktExecutionStartedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(paymentRequestsTable.id, paymentRequestId),
        eq(paymentRequestsTable.mktLifecycleStatus, "treasury_ready"),
      ))
      .returning();
    if (!updated) rollbackLifecycleTransaction("Payment request gagal masuk status processing");
    return { ok: true as const, paymentRequest: updated, attempt, alreadyExists: false };
    });
  } catch (error) {
    if (error instanceof MarketplacePaymentTransactionError) return concurrentUpdateResult(error.message);
    if (isUniqueViolation(error)) return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key sudah digunakan" };
    throw error;
  }
  if (!result.ok || result.alreadyExists) return result;
  const processingAttempt = result.attempt;
  if (!processingAttempt) return concurrentUpdateResult("Execution attempt tidak ditemukan setelah processing");
  await recordLifecycleEvent(result.paymentRequest, actor, "mkt_payment_processing", "treasury_ready", "processing", {
    attemptId: processingAttempt.id,
    attemptNumber: processingAttempt.attemptNumber,
    idempotencyKey,
  });
  queueLifecycleNotification(result.paymentRequest, "mkt_payment_processing", "processing", {
    attemptId: processingAttempt.id,
  });
  return result;
}

export async function completeMarketplacePayment(
  paymentRequestId: number,
  attemptId: number,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  let result: MarketplacePaymentLifecycleResult;
  try {
    result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(paymentRequestsTable)
      .where(eq(paymentRequestsTable.id, paymentRequestId))
      .for("update")
      .limit(1);
    if (!current || !isMarketplaceRequest(current)) return { ok: false as const, code: "NOT_FOUND" as const };
    const [attempt] = await tx
      .select()
      .from(mktPaymentExecutionAttemptsTable)
      .where(and(eq(mktPaymentExecutionAttemptsTable.id, attemptId), eq(mktPaymentExecutionAttemptsTable.paymentRequestId, paymentRequestId)))
      .for("update")
      .limit(1);
    if (!attempt) return { ok: false as const, code: "ATTEMPT_NOT_FOUND" as const };
    if (current.mktLifecycleStatus === "completed") {
      if (attempt.status === "completed") {
        return { ok: true as const, paymentRequest: current, attempt, alreadyExists: true };
      }
      return { ok: false as const, code: "INVALID_STATUS" as const, currentStatus: current.mktLifecycleStatus };
    }
    if (current.mktLifecycleStatus !== "processing") return { ok: false as const, code: "INVALID_STATUS" as const, currentStatus: current.mktLifecycleStatus };
    if (attempt.status === "completed") return { ok: true as const, paymentRequest: current, attempt, alreadyExists: true };
    if (attempt.status !== "processing") return { ok: false as const, code: "INVALID_STATUS" as const, message: "Execution attempt bukan processing" };
    const [updatedAttempt] = await tx
      .update(mktPaymentExecutionAttemptsTable)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(mktPaymentExecutionAttemptsTable.id, attemptId))
      .returning();
    const [updated] = await tx
      .update(paymentRequestsTable)
      .set({ status: "paid", mktLifecycleStatus: "completed", paidAmount: current.totalAmount, paymentDate: new Date(), mktCompletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(paymentRequestsTable.id, paymentRequestId), eq(paymentRequestsTable.mktLifecycleStatus, "processing")))
      .returning();
    if (!updated || !updatedAttempt) rollbackLifecycleTransaction("Completion transaction tidak lengkap");
    return { ok: true as const, paymentRequest: updated, attempt: updatedAttempt, alreadyExists: false };
    });
  } catch (error) {
    if (error instanceof MarketplacePaymentTransactionError) return concurrentUpdateResult(error.message);
    throw error;
  }
  if (!result.ok || result.alreadyExists) return result;
  const completedAttempt = result.attempt;
  if (!completedAttempt) return { ok: false, code: "CONCURRENT_UPDATE", message: "Execution attempt tidak ditemukan setelah completion" };
  await recordLifecycleEvent(result.paymentRequest, actor, "mkt_payment_completed", "processing", "completed", { attemptId: completedAttempt.id });
  queueLifecycleNotification(result.paymentRequest, "mkt_payment_completed", "completed", { attemptId: completedAttempt.id });
  return result;
}

export async function failMarketplacePayment(
  paymentRequestId: number,
  attemptId: number,
  failureCodeInput: unknown,
  failureReasonInput: unknown,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  const failureCode = normalizeReason(failureCodeInput);
  const failureReason = normalizeReason(failureReasonInput);
  if (!failureCode || !failureReason) return { ok: false, code: "INVALID_REASON", message: "failureCode dan failureReason wajib diisi" };
  let result: MarketplacePaymentLifecycleResult;
  try {
    result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, paymentRequestId)).for("update").limit(1);
    if (!current || !isMarketplaceRequest(current)) return { ok: false as const, code: "NOT_FOUND" as const };
    const [attempt] = await tx.select().from(mktPaymentExecutionAttemptsTable).where(and(eq(mktPaymentExecutionAttemptsTable.id, attemptId), eq(mktPaymentExecutionAttemptsTable.paymentRequestId, paymentRequestId))).for("update").limit(1);
    if (!attempt) return { ok: false as const, code: "ATTEMPT_NOT_FOUND" as const };
    if (current.mktLifecycleStatus === "failed") {
      if (attempt.status === "failed") {
        return { ok: true as const, paymentRequest: current, attempt, alreadyExists: true };
      }
      return { ok: false as const, code: "INVALID_STATUS" as const, currentStatus: current.mktLifecycleStatus };
    }
    if (current.mktLifecycleStatus !== "processing") return { ok: false as const, code: "INVALID_STATUS" as const, currentStatus: current.mktLifecycleStatus };
    if (attempt.status !== "processing") return { ok: false as const, code: "INVALID_STATUS" as const, message: "Execution attempt bukan processing" };
    const failedAt = new Date();
    const [updatedAttempt] = await tx.update(mktPaymentExecutionAttemptsTable).set({ status: "failed", failureCode, failureReason, failedAt, failedBy: actor.actorId ?? null, updatedAt: failedAt }).where(eq(mktPaymentExecutionAttemptsTable.id, attemptId)).returning();
    const [updated] = await tx.update(paymentRequestsTable).set({ mktLifecycleStatus: "failed", mktFailureCode: failureCode, mktFailureReason: failureReason, mktFailureAt: failedAt, mktFailedBy: actor.actorId ?? null, updatedAt: failedAt }).where(and(eq(paymentRequestsTable.id, paymentRequestId), eq(paymentRequestsTable.mktLifecycleStatus, "processing"))).returning();
    if (!updated || !updatedAttempt) rollbackLifecycleTransaction("Failure transaction tidak lengkap");
    return { ok: true as const, paymentRequest: updated, attempt: updatedAttempt, alreadyExists: false };
    });
  } catch (error) {
    if (error instanceof MarketplacePaymentTransactionError) return concurrentUpdateResult(error.message);
    throw error;
  }
  if (!result.ok || result.alreadyExists) return result;
  const failedAttempt = result.attempt;
  if (!failedAttempt) return { ok: false, code: "CONCURRENT_UPDATE", message: "Execution attempt tidak ditemukan setelah failure" };
  await recordLifecycleEvent(result.paymentRequest, actor, "mkt_payment_failed", "processing", "failed", { attemptId: failedAttempt.id, failureCode, failureReason });
  queueLifecycleNotification(result.paymentRequest, "mkt_payment_failed", "failed", { attemptId: failedAttempt.id, failureCode });
  return result;
}

export async function retryMarketplacePayment(
  paymentRequestId: number,
  idempotencyKeyInput: unknown,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyInput);
  if (!idempotencyKey) return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key wajib 8-128 karakter" };
  let result: MarketplacePaymentLifecycleResult;
  try {
    result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, paymentRequestId)).for("update").limit(1);
    if (!locked || !isMarketplaceRequest(locked)) return { ok: false as const, code: "NOT_FOUND" as const };
    const [sameKey] = await tx.select().from(mktPaymentExecutionAttemptsTable).where(eq(mktPaymentExecutionAttemptsTable.idempotencyKey, idempotencyKey)).limit(1);
    if (sameKey) {
      if (sameKey.paymentRequestId !== paymentRequestId) return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
      return { ok: true as const, paymentRequest: locked, attempt: sameKey, alreadyExists: true };
    }
    if (locked.mktLifecycleStatus !== "failed") {
      return { ok: false as const, code: "INVALID_STATUS" as const, currentStatus: locked.mktLifecycleStatus, message: "Retry hanya setelah payment failed" };
    }
    const [last] = await tx.select({ attemptNumber: mktPaymentExecutionAttemptsTable.attemptNumber }).from(mktPaymentExecutionAttemptsTable).where(eq(mktPaymentExecutionAttemptsTable.paymentRequestId, paymentRequestId)).orderBy(desc(mktPaymentExecutionAttemptsTable.attemptNumber)).limit(1);
    const [attempt] = await tx.insert(mktPaymentExecutionAttemptsTable).values({
      paymentRequestId,
      attemptNumber: (last?.attemptNumber ?? 0) + 1,
      status: "processing",
      idempotencyKey,
      startedAt: new Date(),
      createdBy: actor.actorId ?? null,
    }).returning();
    const [updated] = await tx.update(paymentRequestsTable).set({ mktLifecycleStatus: "processing", mktExecutionStartedAt: new Date(), mktFailureCode: null, mktFailureReason: null, updatedAt: new Date() }).where(and(eq(paymentRequestsTable.id, paymentRequestId), eq(paymentRequestsTable.mktLifecycleStatus, "failed"))).returning();
    if (!attempt || !updated) rollbackLifecycleTransaction("Retry transaction tidak lengkap");
    return { ok: true as const, paymentRequest: updated, attempt, alreadyExists: false };
    });
  } catch (error) {
    if (error instanceof MarketplacePaymentTransactionError) return concurrentUpdateResult(error.message);
    if (isUniqueViolation(error)) return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key sudah digunakan" };
    throw error;
  }
  if (!result.ok || result.alreadyExists) return result;
  const retryAttempt = result.attempt;
  if (!retryAttempt) return concurrentUpdateResult("Execution attempt tidak ditemukan setelah retry");
  await recordLifecycleEvent(result.paymentRequest, actor, "mkt_payment_retry_processing", "failed", "processing", { attemptId: retryAttempt.id, idempotencyKey });
  queueLifecycleNotification(result.paymentRequest, "mkt_payment_retry_processing", "processing", { attemptId: retryAttempt.id });
  return result;
}

export async function cancelMarketplacePayment(
  paymentRequestId: number,
  idempotencyKeyInput: unknown,
  reasonInput: unknown,
  actor: Actor,
): Promise<MarketplacePaymentLifecycleResult> {
  const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyInput);
  const reason = normalizeReason(reasonInput);
  if (!idempotencyKey) return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key wajib 8-128 karakter" };
  if (!reason) return { ok: false, code: "INVALID_REASON", message: "Cancellation reason wajib 3-2000 karakter" };
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, paymentRequestId)).for("update").limit(1);
    if (!current || !isMarketplaceRequest(current)) return { ok: false as const, code: "NOT_FOUND" as const };
    if (current.mktLifecycleStatus === "cancelled" && current.mktCancellationIdempotencyKey === idempotencyKey) return { ok: true as const, paymentRequest: current, alreadyExists: true };
    if (!["payment_request_created", "finance_review", "approved", "treasury_ready"].includes(current.mktLifecycleStatus ?? "")) {
      return { ok: false as const, code: "CANCELLATION_NOT_ALLOWED" as const, currentStatus: current.mktLifecycleStatus, message: "Cancellation hanya boleh sebelum execution dimulai" };
    }
    const [updated] = await tx.update(paymentRequestsTable).set({ status: "cancelled", mktLifecycleStatus: "cancelled", cancelledAt: new Date(), mktCancelledBy: actor.actorId ?? null, mktCancellationReason: reason, mktCancellationIdempotencyKey: idempotencyKey, updatedAt: new Date() }).where(eq(paymentRequestsTable.id, paymentRequestId)).returning();
    if (!updated) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };
    return { ok: true as const, paymentRequest: updated, alreadyExists: false };
  });
  if (!result.ok || result.alreadyExists) return result;
  await recordLifecycleEvent(result.paymentRequest, actor, "mkt_payment_cancelled", "pre_execution", "cancelled", { idempotencyKey, reason });
  queueLifecycleNotification(result.paymentRequest, "mkt_payment_cancelled", "cancelled");
  return result;
}