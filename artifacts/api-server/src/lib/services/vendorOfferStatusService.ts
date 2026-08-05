/**
 * vendorOfferStatusService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CANONICAL service untuk perubahan vendor_offers.status.
 *
 * Semua perubahan status vendor offer WAJIB melalui transitionVendorOfferStatus()
 * — tidak boleh ada direct db.update(vendorOffersTable).set({status: ...}) di luar
 * service ini.
 *
 * Fitur:
 *  - State machine validation (PENDING → OPTIONS_SENT → CUSTOMER_CHOSEN/REJECTED)
 *  - Idempotent: jika sudah di target status, return ok + alreadyAt: true
 *  - Concurrent-safe: SELECT current status + UPDATE dalam satu DB transaction
 *  - Audit trail via logVendorQuoteEvent (non-blocking)
 *  - Actor validation: admin boleh OPTIONS_SENT; customer boleh CHOSEN/REJECTED
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db, vendorOffersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logVendorQuoteEvent } from "../auditTrail.js";
import { logger } from "../logger.js";

// ── State machine ─────────────────────────────────────────────────────────────

export const VENDOR_OFFER_VALID_TRANSITIONS: Record<string, string[]> = {
  "PENDING":           ["OPTIONS_SENT", "CANCELLED"],
  "OPTIONS_SENT":      ["CUSTOMER_CHOSEN", "CUSTOMER_REJECTED", "CANCELLED"],
  "CUSTOMER_CHOSEN":   [],  // terminal
  "CUSTOMER_REJECTED": [],  // terminal
  "CANCELLED":         [],  // terminal
};

/** Actor yang diizinkan untuk tiap transisi */
const TRANSITION_ALLOWED_ACTORS: Record<string, Array<"admin" | "customer" | "system">> = {
  "OPTIONS_SENT":      ["admin", "system"],
  "CUSTOMER_CHOSEN":   ["customer", "admin", "system"],
  "CUSTOMER_REJECTED": ["customer", "admin", "system"],
  "CANCELLED":         ["admin", "system"],
};

export type VendorOfferActor = "admin" | "customer" | "system";

export interface VendorOfferTransitionOpts {
  source: string;
  actorType: VendorOfferActor;
  orderId?: number;        // for ownership check (optional)
}

export interface VendorOfferTransitionResult {
  ok: boolean;
  alreadyAt?: boolean;
  error?: string;
  errorCode?: "INVALID_TRANSITION" | "ACTOR_FORBIDDEN" | "NOT_FOUND" | "OWNERSHIP_MISMATCH";
}

// ── Single offer transition ───────────────────────────────────────────────────

/**
 * Transition a single vendor offer to newStatus.
 *
 * Concurrent-safe: reads current status and writes new status inside a DB
 * transaction, so two concurrent requests for the same offer will serialize.
 */
export async function transitionVendorOfferStatus(
  offerId: number,
  newStatus: string,
  opts: VendorOfferTransitionOpts,
): Promise<VendorOfferTransitionResult> {
  let currentStatus: string | undefined;

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Read current status (within transaction for serialization)
      const [offer] = await tx
        .select({ id: vendorOffersTable.id, status: vendorOffersTable.status, orderId: vendorOffersTable.orderId })
        .from(vendorOffersTable)
        .where(eq(vendorOffersTable.id, offerId));

      if (!offer) {
        return { ok: false, errorCode: "NOT_FOUND" as const, error: `Vendor offer ${offerId} tidak ditemukan` };
      }

      currentStatus = offer.status ?? "PENDING";

      // 2. Ownership check
      if (opts.orderId !== undefined && offer.orderId !== opts.orderId) {
        return { ok: false, errorCode: "OWNERSHIP_MISMATCH" as const, error: "Offer tidak belong ke order ini" };
      }

      // 3. Idempotency: already at target
      if (currentStatus === newStatus) {
        return { ok: true, alreadyAt: true };
      }

      // 4. State machine validation
      const allowed = VENDOR_OFFER_VALID_TRANSITIONS[currentStatus] ?? [];
      if (!allowed.includes(newStatus)) {
        return {
          ok: false,
          errorCode: "INVALID_TRANSITION" as const,
          error: `Transisi ${currentStatus} → ${newStatus} tidak diizinkan`,
        };
      }

      // 5. Actor validation
      const allowedActors = TRANSITION_ALLOWED_ACTORS[newStatus] ?? [];
      if (!allowedActors.includes(opts.actorType)) {
        return {
          ok: false,
          errorCode: "ACTOR_FORBIDDEN" as const,
          error: `Actor '${opts.actorType}' tidak diizinkan untuk transisi ke ${newStatus}`,
        };
      }

      // 6. Apply transition
      const updatePayload: Record<string, unknown> = { status: newStatus };
      if (newStatus === "CUSTOMER_CHOSEN") {
        updatePayload["chosenAt"] = new Date();
      }

      await tx
        .update(vendorOffersTable)
        .set(updatePayload as Parameters<typeof tx.update>[0] extends ReturnType<typeof tx.update> ? never : typeof updatePayload)
        .where(eq(vendorOffersTable.id, offerId));

      return { ok: true };
    });

    // 7. Audit trail (non-blocking, outside transaction)
    if (result.ok && !result.alreadyAt) {
      logVendorQuoteEvent({
        orderId: opts.orderId ?? 0,
        eventType: `vendor_offer_status:${currentStatus}→${newStatus}`,
        changedByType: opts.actorType,
        notes: JSON.stringify({ offerId, source: opts.source, newStatus }),
      }).catch((err) => {
        logger.warn({ err, offerId, newStatus }, "vendorOfferStatusService: audit trail failed (non-fatal)");
      });
    }

    return result;
  } catch (err) {
    logger.error({ err, offerId, newStatus, opts }, "vendorOfferStatusService: unexpected error");
    throw err;
  }
}

// ── Batch: send options (mark multiple offers as OPTIONS_SENT) ────────────────

export interface SendOptionsResult {
  ok: boolean;
  updatedIds: number[];
  skipped: number[];
  error?: string;
}

/**
 * Transition multiple vendor offers to OPTIONS_SENT atomically.
 * Used by the admin "send-customer-options" endpoint.
 */
export async function markOffersOptionsSent(
  offerIds: number[],
  orderId: number,
  opts: { source: string },
): Promise<SendOptionsResult> {
  if (offerIds.length === 0) {
    return { ok: true, updatedIds: [], skipped: [] };
  }

  const updatedIds: number[] = [];
  const skipped: number[] = [];

  await db.transaction(async (tx) => {
    const offers = await tx
      .select({ id: vendorOffersTable.id, status: vendorOffersTable.status, orderId: vendorOffersTable.orderId })
      .from(vendorOffersTable)
      .where(inArray(vendorOffersTable.id, offerIds));

    for (const offer of offers) {
      const current = offer.status ?? "PENDING";

      // Ownership guard
      if (offer.orderId !== orderId) {
        skipped.push(offer.id);
        continue;
      }

      // Idempotent: already OPTIONS_SENT
      if (current === "OPTIONS_SENT") {
        updatedIds.push(offer.id); // count as done
        continue;
      }

      const allowed = VENDOR_OFFER_VALID_TRANSITIONS[current] ?? [];
      if (!allowed.includes("OPTIONS_SENT")) {
        skipped.push(offer.id);
        continue;
      }

      await tx
        .update(vendorOffersTable)
        .set({ status: "OPTIONS_SENT" } as any)
        .where(eq(vendorOffersTable.id, offer.id));

      updatedIds.push(offer.id);
    }
  });

  // Audit trail (non-blocking)
  logVendorQuoteEvent({
    orderId,
    eventType: "vendor_offer_batch:OPTIONS_SENT",
    changedByType: "admin",
    notes: JSON.stringify({ updatedIds, skipped, source: opts.source }),
  }).catch((err) => {
    logger.warn({ err, orderId }, "markOffersOptionsSent: audit trail failed (non-fatal)");
  });

  return { ok: true, updatedIds, skipped };
}

// ── Customer choice: CUSTOMER_CHOSEN + CUSTOMER_REJECTED atomically ───────────

export interface CustomerChoiceResult {
  ok: boolean;
  alreadyChosen?: boolean;
  chosenOfferId?: number;
  error?: string;
  errorCode?: "NOT_FOUND" | "ALREADY_CHOSEN" | "OFFER_NOT_IN_ORDER" | "INVALID_TRANSITION";
}

/**
 * Customer picks one offer:
 *  - Chosen offer → CUSTOMER_CHOSEN
 *  - All other offers for the same order → CUSTOMER_REJECTED
 *
 * Idempotent: if the SAME offer is already CUSTOMER_CHOSEN, returns ok + alreadyChosen.
 * If a DIFFERENT offer is already CUSTOMER_CHOSEN, returns 409.
 */
export async function recordCustomerChoice(
  orderId: number,
  chosenOfferId: number,
  opts: { source: string; actorType: VendorOfferActor },
): Promise<CustomerChoiceResult> {
  try {
    const result = await db.transaction(async (tx) => {
      // Read all offers for this order
      const allOffers = await tx
        .select({ id: vendorOffersTable.id, status: vendorOffersTable.status, orderId: vendorOffersTable.orderId })
        .from(vendorOffersTable)
        .where(eq(vendorOffersTable.orderId, orderId));

      const chosen = allOffers.find((o) => o.id === chosenOfferId);
      if (!chosen) {
        return { ok: false, errorCode: "OFFER_NOT_IN_ORDER" as const, error: "Opsi tidak ditemukan untuk order ini" };
      }

      // Idempotency: same offer already chosen
      if (chosen.status === "CUSTOMER_CHOSEN") {
        return { ok: true, alreadyChosen: true, chosenOfferId };
      }

      // Conflict: different offer already chosen
      const otherChosen = allOffers.find((o) => o.id !== chosenOfferId && o.status === "CUSTOMER_CHOSEN");
      if (otherChosen) {
        return { ok: false, errorCode: "ALREADY_CHOSEN" as const, error: "Anda sudah memilih opsi sebelumnya" };
      }

      // Validate transition for chosen offer
      const currentStatus = chosen.status ?? "PENDING";
      const allowed = VENDOR_OFFER_VALID_TRANSITIONS[currentStatus] ?? [];
      if (!allowed.includes("CUSTOMER_CHOSEN")) {
        return {
          ok: false,
          errorCode: "INVALID_TRANSITION" as const,
          error: `Tidak dapat memilih opsi: status saat ini adalah ${currentStatus}`,
        };
      }

      // Apply: mark chosen
      await tx
        .update(vendorOffersTable)
        .set({ status: "CUSTOMER_CHOSEN", chosenAt: new Date() } as any)
        .where(eq(vendorOffersTable.id, chosenOfferId));

      // Apply: mark others as rejected (only those still in OPTIONS_SENT)
      const rejectIds = allOffers
        .filter((o) => o.id !== chosenOfferId && o.status === "OPTIONS_SENT")
        .map((o) => o.id);

      if (rejectIds.length > 0) {
        await tx
          .update(vendorOffersTable)
          .set({ status: "CUSTOMER_REJECTED" } as any)
          .where(inArray(vendorOffersTable.id, rejectIds));
      }

      return { ok: true, chosenOfferId };
    });

    // Audit trail (non-blocking)
    if (result.ok && !result.alreadyChosen) {
      logVendorQuoteEvent({
        orderId,
        eventType: "vendor_offer:CUSTOMER_CHOSEN",
        changedByType: opts.actorType,
        notes: JSON.stringify({ chosenOfferId, source: opts.source }),
      }).catch((err) => {
        logger.warn({ err, orderId, chosenOfferId }, "recordCustomerChoice: audit trail failed (non-fatal)");
      });
    }

    return result;
  } catch (err) {
    logger.error({ err, orderId, chosenOfferId, opts }, "recordCustomerChoice: unexpected error");
    throw err;
  }
}
