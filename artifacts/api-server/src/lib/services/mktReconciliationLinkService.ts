import {
  db,
  mktAccountingHandoffsTable,
  mktApPreparationsTable,
  mktPurchaseOrdersTable,
  mktReconciliationLinksTable,
  paymentRequestsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import {
  buildReconciliationCorrelationReference,
  buildReconciliationLinkFingerprint,
  MARKETPLACE_RECONCILIATION_LINK_SOURCE,
  MARKETPLACE_RECONCILIATION_LINK_STATUS,
  validateReconciliationLinkKey,
} from "../mktReconciliationLinkContract.js";

type Actor = { actorId?: string | null; actorName?: string | null };
type LinkRow = typeof mktReconciliationLinksTable.$inferSelect;

export type ReconciliationLinkFailureCode =
  | "NOT_FOUND"
  | "INVALID_SOURCE"
  | "INVALID_STATUS"
  | "INVALID_REFERENCE"
  | "COMPANY_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_KEY"
  | "CONCURRENT_UPDATE";

export type ReconciliationLinkResult =
  | { ok: true; link: LinkRow; alreadyExists: boolean }
  | {
      ok: false;
      code: ReconciliationLinkFailureCode;
      message?: string;
      currentStatus?: string | null;
    };

function isDuplicateError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}

function messageFor(code: ReconciliationLinkFailureCode): string {
  switch (code) {
    case "INVALID_SOURCE":
      return "Payment bukan payment Marketplace AP";
    case "INVALID_STATUS":
      return "Payment Marketplace harus berstatus paid dan lifecycle completed";
    case "INVALID_REFERENCE":
      return "Accounting handoff atau referensi Marketplace tidak konsisten";
    case "COMPANY_MISMATCH":
      return "Company context tidak sesuai dengan payment Marketplace";
    case "IDEMPOTENCY_CONFLICT":
      return "Idempotency key sudah dipakai untuk link berbeda";
    case "INVALID_KEY":
      return "Idempotency-Key wajib 8-128 karakter";
    default:
      return "Reconciliation link tidak dapat dibuat";
  }
}

function queueLinkNotification(
  link: LinkRow | null,
  eventType:
    | "marketplace_reconciliation_link_created"
    | "marketplace_reconciliation_link_reused"
    | "marketplace_reconciliation_link_failed",
  payload: Record<string, unknown>,
  deduplicationKey: string,
): void {
  void enqueueNotification({
    eventType,
    recipientType: "admin",
    purchaseOrderId: link?.mktPurchaseOrderId ?? Number(payload.mktPurchaseOrderId),
    payloadJson: { source: MARKETPLACE_RECONCILIATION_LINK_SOURCE, ...payload },
    deduplicationKey,
  }).catch(() => {});
}

async function auditFailure(
  actor: Actor,
  context: { apPreparationId: number; mktPurchaseOrderId: number | null },
  paymentRequestId: number,
  key: string | null,
  code: ReconciliationLinkFailureCode,
  message: string,
): Promise<void> {
  await logActivity({
    mktPurchaseOrderId: context.mktPurchaseOrderId,
    actorType: "admin",
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action: "marketplace_reconciliation_link_failed",
    description: `Payment request ${paymentRequestId}: ${message}`,
    newValue: { paymentRequestId, apPreparationId: context.apPreparationId, code, message },
    deduplicationKey: key
      ? `mkt_reconciliation_link_failed:${paymentRequestId}:${key}:${code}`
      : null,
  });
  queueLinkNotification(
    null,
    "marketplace_reconciliation_link_failed",
    {
      paymentRequestId,
      apPreparationId: context.apPreparationId,
      mktPurchaseOrderId: context.mktPurchaseOrderId,
      code,
      message,
    },
    `mkt_reconciliation_link_failed:${paymentRequestId}:${key ?? "none"}:${code}`,
  );
}

export async function getMarketplaceReconciliationLink(
  paymentRequestId: number,
): Promise<LinkRow | null> {
  const [row] = await db
    .select()
    .from(mktReconciliationLinksTable)
    .where(eq(mktReconciliationLinksTable.paymentRequestId, paymentRequestId))
    .limit(1);
  return row ?? null;
}

/**
 * Creates or reuses a reference-only Marketplace → Bank Reconciliation link.
 * This function never creates a bank mutation, match, journal, posting, or
 * reconciliation result.
 */
export async function createMarketplaceReconciliationLink(
  paymentRequestId: number,
  idempotencyKeyInput: unknown,
  actor: Actor,
  expectedCompanyId?: number | null,
): Promise<ReconciliationLinkResult> {
  const idempotencyKey = validateReconciliationLinkKey(idempotencyKeyInput);
  if (!idempotencyKey) return { ok: false, code: "INVALID_KEY", message: messageFor("INVALID_KEY") };

  let failureContext: { apPreparationId: number; mktPurchaseOrderId: number | null } | null = null;
  let result: ReconciliationLinkResult;

  try {
    result = await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(paymentRequestsTable)
        .where(eq(paymentRequestsTable.id, paymentRequestId))
        .for("update")
        .limit(1);
      if (!payment) return { ok: false as const, code: "NOT_FOUND" as const };

      if (payment.sourceType !== "marketplace_ap_preparation" || payment.mktApPreparationId == null) {
        return { ok: false as const, code: "INVALID_SOURCE" as const };
      }

      const [preparation] = await tx
        .select()
        .from(mktApPreparationsTable)
        .where(eq(mktApPreparationsTable.id, payment.mktApPreparationId))
        .for("update")
        .limit(1);
      failureContext = {
        apPreparationId: payment.mktApPreparationId,
        mktPurchaseOrderId: preparation?.mktPurchaseOrderId ?? null,
      };
      if (!preparation) return { ok: false as const, code: "INVALID_REFERENCE" as const };

      if (expectedCompanyId != null && preparation.companyId !== expectedCompanyId) {
        return { ok: false as const, code: "COMPANY_MISMATCH" as const };
      }
      if (preparation.companyId == null || payment.companyId !== preparation.companyId) {
        return { ok: false as const, code: "COMPANY_MISMATCH" as const };
      }
      if (payment.sourceId !== preparation.id || payment.mktApPreparationId !== preparation.id) {
        return { ok: false as const, code: "INVALID_SOURCE" as const };
      }
      if (payment.status !== "paid" || payment.mktLifecycleStatus !== "completed") {
        return {
          ok: false as const,
          code: "INVALID_STATUS" as const,
          currentStatus: payment.mktLifecycleStatus,
        };
      }

      const [handoff] = await tx
        .select()
        .from(mktAccountingHandoffsTable)
        .where(eq(mktAccountingHandoffsTable.apPreparationId, preparation.id))
        .limit(1);
      if (!handoff
        || handoff.paymentRequestId !== payment.id
        || handoff.companyId !== preparation.companyId
        || handoff.status !== "accepted") {
        return { ok: false as const, code: "INVALID_REFERENCE" as const };
      }

      const [po] = await tx
        .select({ id: mktPurchaseOrdersTable.id })
        .from(mktPurchaseOrdersTable)
        .where(and(
          eq(mktPurchaseOrdersTable.id, preparation.mktPurchaseOrderId),
          eq(mktPurchaseOrdersTable.companyId, preparation.companyId),
        ))
        .limit(1);
      if (!po) return { ok: false as const, code: "INVALID_REFERENCE" as const };

      const paymentReference = payment.payReqNumber;
      const accountingReference = handoff.accountingReference ?? handoff.correlationReference;
      const marketplaceReference = preparation.preparationNumber;
      const payload = {
        source: MARKETPLACE_RECONCILIATION_LINK_SOURCE,
        accountingHandoffId: handoff.id,
        accountingHandoffCorrelation: handoff.correlationReference,
        apPreparationId: preparation.id,
        preparationNumber: preparation.preparationNumber,
        paymentRequestId: payment.id,
        paymentReference,
        accountingReference,
        marketplaceReference,
        mktPurchaseOrderId: preparation.mktPurchaseOrderId,
        companyId: preparation.companyId,
        supplierId: preparation.supplierId,
        currency: preparation.currencySnapshot,
        amount: preparation.grandTotalSnapshot,
        bankTransactionId: null,
        reconciliationStatus: null,
      };
      const payloadFingerprint = buildReconciliationLinkFingerprint({
        accountingHandoffId: handoff.id,
        apPreparationId: preparation.id,
        paymentRequestId: payment.id,
        companyId: preparation.companyId,
        supplierId: preparation.supplierId,
        currency: preparation.currencySnapshot,
        amount: preparation.grandTotalSnapshot,
        paymentReference,
        accountingReference,
        marketplaceReference,
      });
      const correlationReference = buildReconciliationCorrelationReference(
        payment.id,
        payloadFingerprint,
      );

      const [existing] = await tx
        .select()
        .from(mktReconciliationLinksTable)
        .where(eq(mktReconciliationLinksTable.paymentRequestId, payment.id))
        .for("update")
        .limit(1);
      if (existing) {
        if (existing.linkKey !== idempotencyKey || existing.payloadFingerprint !== payloadFingerprint) {
          return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
        }
        return { ok: true as const, link: existing, alreadyExists: true };
      }

      const [sameKey] = await tx
        .select()
        .from(mktReconciliationLinksTable)
        .where(eq(mktReconciliationLinksTable.linkKey, idempotencyKey))
        .limit(1);
      if (sameKey) return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };

      const [created] = await tx
        .insert(mktReconciliationLinksTable)
        .values({
          linkKey: idempotencyKey,
          correlationReference,
          payloadFingerprint,
          accountingHandoffId: handoff.id,
          apPreparationId: preparation.id,
          mktPurchaseOrderId: preparation.mktPurchaseOrderId,
          paymentRequestId: payment.id,
          companyId: preparation.companyId,
          supplierId: preparation.supplierId,
          currency: preparation.currencySnapshot,
          amount: preparation.grandTotalSnapshot,
          paymentReference,
          accountingReference,
          marketplaceReference,
          status: MARKETPLACE_RECONCILIATION_LINK_STATUS,
          payload,
          requestedBy: actor.actorId ?? null,
        })
        .returning();
      if (!created) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };
      return { ok: true as const, link: created, alreadyExists: false };
    });
  } catch (error) {
    if (isDuplicateError(error)) {
      result = { ok: false, code: "IDEMPOTENCY_CONFLICT", message: messageFor("IDEMPOTENCY_CONFLICT") };
    } else {
      throw error;
    }
  }

  if (!result.ok) {
    if (failureContext) {
      const message = result.message ?? messageFor(result.code);
      await auditFailure(actor, failureContext, paymentRequestId, idempotencyKey, result.code, message);
      return { ...result, message };
    }
    return { ...result, message: result.message ?? messageFor(result.code) };
  }

  const action = result.alreadyExists
    ? "marketplace_reconciliation_link_reused"
    : "marketplace_reconciliation_link_created";
  await logActivity({
    mktPurchaseOrderId: result.link.mktPurchaseOrderId,
    actorType: "admin",
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action,
    description: `Reconciliation link ${result.link.correlationReference} ${result.alreadyExists ? "reused" : "created"}`,
    newValue: {
      linkId: result.link.id,
      paymentRequestId: result.link.paymentRequestId,
      accountingHandoffId: result.link.accountingHandoffId,
      correlationReference: result.link.correlationReference,
      status: result.link.status,
    },
    deduplicationKey: `mkt_reconciliation_link:${action}:${result.link.id}:${idempotencyKey}`,
  });
  queueLinkNotification(
    result.link,
    result.alreadyExists
      ? "marketplace_reconciliation_link_reused"
      : "marketplace_reconciliation_link_created",
    {
      linkId: result.link.id,
      paymentRequestId: result.link.paymentRequestId,
      correlationReference: result.link.correlationReference,
      status: result.link.status,
    },
    `mkt_reconciliation_link:${action}:${result.link.id}`,
  );
  return result;
}