import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Enterprise DB Patch — Phase 3A: Correct RFQ Vendor Links FK Ambiguity
 *
 * Background:
 *   Phase 2 added `fk_rfq_vl_rfq` on rfq_vendor_links.rfq_id → mkt_rfqs, based on
 *   a naming-pattern assumption ("rfq" implied marketplace RFQ). That assumption
 *   was wrong: the Drizzle schema source of truth (lib/db/src/schema/rfqVendorLinks.ts)
 *   already defines rfq_id as a reference to logisticOrderRfqsTable, and every
 *   consumer (rfqStatusService.ts, vendorInvitationService.ts, adminAction.ts,
 *   customerQuoteFlow.ts, vendorTracking.ts, logisticOrders.ts, dashboard.ts,
 *   analyticsProfit.ts) exclusively joins/queries rfq_vendor_links against
 *   logistic_order_rfqs / logistic_orders. There is zero marketplace (mkt_rfqs)
 *   usage of this table anywhere in the codebase.
 *
 *   A pre-existing, already-VALIDATED constraint (rfq_vendor_links_rfq_id_fkey →
 *   logistic_order_rfqs) has been correct all along. Phase 2's fk_rfq_vl_rfq is
 *   the incorrect, redundant, NOT VALID constraint pointing at the wrong table.
 *
 * This patch:
 *   - Drops fk_rfq_vl_rfq ONLY if it still points at mkt_rfqs (idempotent guard —
 *     safe to run repeatedly, safe no-op if already dropped or never created).
 *   - Does NOT touch rfq_vendor_links_rfq_id_fkey (the correct, validated FK).
 *   - Does NOT modify any data, any row, any column, any API response, or any
 *     frontend/business logic.
 *   - Single-statement db.execute() calls only (pgBouncer transaction-mode safe,
 *     avoids the Drizzle sql.raw() `$$` → `$` DO-block mangling bug from Phase 2).
 */
export async function runPhase3aRfqVendorLinksFix(): Promise<void> {
  // NOTE: unlike some other boot migrations, we deliberately do NOT swallow every
  // error into a warn+continue here. If the table/relation is genuinely absent
  // (fresh/partial DB), that's a legitimate no-op — handled explicitly below.
  // Any other failure (lock contention, transient DB error, permission issue)
  // must propagate so runWithRetry() actually retries instead of silently
  // reporting success while the wrong FK is still in place.
  const relationExists = await db.execute(sql`
    SELECT 1 FROM pg_class WHERE relname = 'rfq_vendor_links' AND relkind = 'r' LIMIT 1
  `);
  if (relationExists.rows.length === 0) {
    logger.info("[Phase3aRfqVendorLinksFix] rfq_vendor_links table not present — no-op");
    return;
  }

  // 1. Only proceed if the incorrect constraint exists AND still points at mkt_rfqs.
  //    This makes the drop idempotent: re-running after the fix is a safe no-op.
  const wrongFk = await db.execute(sql`
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_rfq_vl_rfq'
      AND conrelid = 'public.rfq_vendor_links'::regclass
      AND confrelid = 'public.mkt_rfqs'::regclass
    LIMIT 1
  `);

  if (wrongFk.rows.length > 0) {
    await db.execute(sql`
      ALTER TABLE public.rfq_vendor_links
        DROP CONSTRAINT fk_rfq_vl_rfq
    `);
    logger.info(
      "[Phase3aRfqVendorLinksFix] dropped incorrect fk_rfq_vl_rfq (rfq_vendor_links.rfq_id → mkt_rfqs)"
    );

    // Postcondition: confirm the drop actually took effect before declaring success.
    const stillPresent = await db.execute(sql`
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'fk_rfq_vl_rfq'
        AND conrelid = 'public.rfq_vendor_links'::regclass
        AND confrelid = 'public.mkt_rfqs'::regclass
      LIMIT 1
    `);
    if (stillPresent.rows.length > 0) {
      throw new Error("fk_rfq_vl_rfq still present after DROP CONSTRAINT — aborting so runWithRetry can retry");
    }
  } else {
    logger.info(
      "[Phase3aRfqVendorLinksFix] fk_rfq_vl_rfq already absent or already corrected — no-op"
    );
  }

  // 2. Sanity guard: confirm the correct FK (→ logistic_order_rfqs) is present and
  //    validated. We never (re)create it here — if it's missing, that's a data
  //    integrity issue outside this patch's scope and must be investigated
  //    manually rather than silently patched.
  const correctFk = await db.execute(sql`
    SELECT convalidated
    FROM pg_constraint
    WHERE conrelid = 'public.rfq_vendor_links'::regclass
      AND confrelid = 'public.logistic_order_rfqs'::regclass
      AND contype = 'f'
    LIMIT 1
  `);
  if (correctFk.rows.length === 0) {
    logger.warn(
      "[Phase3aRfqVendorLinksFix] WARNING: no FK from rfq_vendor_links.rfq_id to logistic_order_rfqs found — manual investigation required"
    );
  } else if ((correctFk.rows[0] as { convalidated?: boolean }).convalidated === false) {
    logger.warn(
      "[Phase3aRfqVendorLinksFix] WARNING: rfq_vendor_links → logistic_order_rfqs FK exists but is NOT VALID — manual investigation required"
    );
  }

  logger.info("[Phase3aRfqVendorLinksFix] ok — rfq_vendor_links FK ambiguity resolved (logistic-only, confirmed by usage audit)");
}
