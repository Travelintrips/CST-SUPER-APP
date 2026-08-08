import { Router } from "express";
import { db, pool, accountingPaymentsTable, getCircuitBreakerStatus } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/requireAdmin.js";
import { resolveCompanyId } from "../../lib/resolveCompany.js";
import { assertCompanyAccess } from "../../lib/assertCompanyAccess.js";
import { handleSportCenterSse, broadcastSportCenterEvent } from "./broadcast.js";
import { normalizePaymentMethod, resolvePaymentDestination, postSportCenterBooking, postSportCenterBookingReversal, postSportCenterRefund, postSportCenterMembershipPayment, postSportCenterBookingRefundDirect, postSportCenterExpenseEntry, postEntry, resolveSportCenterBookingAccountId, resolveCostCenterId, postSportCenterPaymentAtomic, type DbClient as SportDbClient } from "../../lib/accounting.js";
import { ensureAccountingSettings } from "../../lib/accountingSeed.js";
import { syncFacilityUpsert, syncFacilityDelete, syncAllFacilities, syncBookingUpsert, syncAllBookings, getLastSyncLogs, pullLegacyBookingsFromSupabase, syncPaymentsToAccounting, pullPaymentsFromSupabase, pullFacilitiesFromSupabase, runDailyPaymentSync } from "./supabaseSync.js";
import { saveAndBroadcast } from "../../lib/notificationStore.js";

// ─── [DB SOURCE CHECK] ────────────────────────────────────────────────────────
// Logged once at module load. Confirms which table is the read source for each
// primary endpoint. All tables are in the SAME Supabase instance; distinction
// is between the canonical sport_center schema vs the public mirror tables.
{
  const rawUrl = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL ?? "NOT SET";
  const maskedUrl = rawUrl.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
  console.log(
    `[DB SOURCE CHECK]\n` +
    `  BOOKINGS_SOURCE  = sport_center.sport_bookings  (Supabase cross-schema — GET /bookings)\n` +
    `  PAYMENTS_SOURCE  = sport_center.sport_payments  (Supabase cross-schema — GET /payments)\n` +
    `  MIRROR_WRITE     = public.sport_bookings + public.sport_payments  (POST/PATCH writes, dashboard, reports, accounting)\n` +
    `  SUPABASE_URL     = ${maskedUrl}`
  );
}
// ─────────────────────────────────────────────────────────────────────────────

async function insertAccountingPaymentForSportCenter(args: {
  companyId: number;
  paymentNumber: string;
  amount: number;
  method: string;
  partnerName: string;
  ref: string;
  memo: string;
  paymentMethod?: string | null;
  sourceDocId: number;
  date?: string;
  createdById?: string | null;
  /** Optional transaction client — pass to keep this insert atomic with caller's tx */
  client?: SportDbClient;
}): Promise<void> {
  const q = args.client ?? db;
  try {
    // Idempotency: skip if accounting_payment already exists for this sourceDocId
    const existing = await q.execute(sql`
      SELECT id FROM accounting_payments
      WHERE source_type = 'sport_center' AND source_doc_id = ${args.sourceDocId}
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      console.log(`[sport-center] insertAccountingPaymentForSportCenter: already exists for source_doc_id=${args.sourceDocId} — skip`);
      return;
    }

    // Resolve journal — THROW (not silent return) so missing config surfaces as a real error.
    const settings = await ensureAccountingSettings(args.companyId);
    const destination = resolvePaymentDestination(args.paymentMethod ?? args.method, settings);
    const { paymentMethod, journalId } = destination;
    if (!journalId) {
      throw new Error(
        `JOURNAL_MISSING: Tidak ada jurnal Kas/Bank untuk company_id=${args.companyId} method=${args.method}. ` +
        `cashJournalId=${settings.cashJournalId} bankJournalId=${settings.bankJournalId}. ` +
        `Konfigurasi di Accounting → Settings → Cash Journal atau Bank Journal.`
      );
    }
    const payDate = args.date ?? new Date().toISOString().split("T")[0]!;
    const year = payDate.slice(0, 4);
    const cntRes = await q.execute(sql`
      SELECT CAST(COUNT(*) AS int) AS seq FROM accounting_payments
      WHERE company_id = ${args.companyId}
    `);
    const seq = Number((cntRes.rows[0] as any)?.seq ?? 0);
    const paySeq = (seq + 1).toString().padStart(4, "0");
    const acctPayNumber = `PAY/${year}/${paySeq}`;
    await q.insert(accountingPaymentsTable).values({
      companyId: args.companyId,
      paymentNumber: acctPayNumber,
      paymentType: "inbound",
      status: "posted",
      amount: String(Math.round(args.amount * 100) / 100),
      journalId,
      partnerName: args.partnerName || null,
      date: payDate,
      ref: args.ref || null,
      memo: args.memo || null,
       paymentMethod,
      entryId: null,
      sourceType: "sport_center",
      sourceDocId: args.sourceDocId,
      createdById: args.createdById ?? null,
    });
    console.log(`[sport-center] accounting_payment created: ${acctPayNumber} amount=${args.amount} source_doc_id=${args.sourceDocId}`);
  } catch (err) {
    console.error("[sport-center] insertAccountingPaymentForSportCenter failed:", err);
    // Re-throw so the caller (transaction or route handler) can roll back or surface 422/500.
    throw err;
  }
}

const router = Router();

router.use((_req, _res, next) => next());

function pad(n: number, len = 6) {
  return String(n).padStart(len, "0");
}

async function nextBookingNumber(companyId?: number): Promise<string> {
  const res = await db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${companyId ?? null}::int IS NULL OR company_id = ${companyId ?? null})`);
  const cnt = Number((res.rows[0] as any).cnt) + 1;
  const today = new Date();
  return `BK/${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}/${pad(cnt)}`;
}

async function nextMemberNumber(companyId?: number): Promise<string> {
  const res = await db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_members WHERE (${companyId ?? null}::int IS NULL OR company_id = ${companyId ?? null})`);
  return `MBR-${pad(Number((res.rows[0] as any).cnt) + 1, 5)}`;
}

async function nextPaymentNumber(companyId?: number): Promise<string> {
  const res = await db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_payments WHERE (${companyId ?? null}::int IS NULL OR company_id = ${companyId ?? null})`);
  return `PAY/${new Date().getFullYear()}/${pad(Number((res.rows[0] as any).cnt) + 1)}`;
}

// Pastikan booking yang sudah 'paid' punya record di sport_payments (+ jurnal akuntansi).
// Dipakai oleh PATCH /bookings/:id dan legacy sync push-bookings agar booking lunas
// selalu muncul di daftar Pembayaran.
//
// Idempotency (partial-state safe):
//  - sport_payments row exists AND accounting_payments row exists → fully done, skip.
//  - sport_payments row exists BUT accounting_payments is missing → backfill accounting only.
//  - Neither exists → create both inside the provided tx client (atomic with caller).
//
// @param client — pass the caller's transaction so all writes commit/rollback together.
//                 Defaults to global db for legacy callers (push-bookings sync).
async function ensurePaymentForPaidBooking(
  row: Record<string, unknown>,
  createdById: string | null,
  client: SportDbClient = db,
): Promise<void> {
  const id = Number(row.id);
  if (!id) return;

  const bCompanyId = row.company_id != null ? Number(row.company_id) : null;
  const bTotalAmount = Number(row.total_amount ?? 0);
  const bookingDateStr = String(row.booking_date ?? new Date().toISOString().slice(0, 10));
  const bookingCodeStr = String(row.booking_number ?? `BK-${id}`);

  // ── Check existing sport_payments row ────────────────────────────────────
  const existingPayment = await client.execute(sql`
    SELECT id FROM sport_payments WHERE booking_id = ${id} LIMIT 1
  `);
  const existingSportPayId = Number((existingPayment.rows[0] as Record<string, unknown> | undefined)?.id ?? 0);

  let sportPaymentId: number;
  let paymentNumber: string;
  // These hold the values to use for the accounting insert — either from the
  // existing sport_payments row (backfill path) or the booking defaults (new path).
  let acctAmount = bTotalAmount;
  const bookingPaymentMethod = normalizePaymentMethod(
    row.payment_method != null
      ? String(row.payment_method)
      : row.method != null
        ? String(row.method)
        : null,
  ) ?? "cash";
  let acctMethod = bookingPaymentMethod;
  let acctDate   = bookingDateStr;

  let createdPayRow: Record<string, unknown> | null = null;

  if (existingSportPayId) {
    // sport_payments row already exists — check if accounting_payments is also present.
    const existingAcct = await client.execute(sql`
      SELECT id FROM accounting_payments
      WHERE source_type = 'sport_center' AND source_doc_id = ${existingSportPayId}
      LIMIT 1
    `);
    if (existingAcct.rows.length > 0) {
      // Fully done (both records present) — idempotent skip.
      console.log(`[sport-center] ensurePaymentForPaidBooking: already complete for booking_id=${id} — skip`);
      return;
    }
    // Partial state: sport_payment exists but accounting_payment is missing.
    // Backfill accounting only — use the existing sport_payments row as the source
    // of truth (amount, method, payment_number, date) so the accounting record
    // mirrors the actual payment that was already recorded.
    sportPaymentId = existingSportPayId;
    const spRow = await client.execute(sql`
      SELECT payment_number, amount, method, paid_at FROM sport_payments WHERE id = ${existingSportPayId} LIMIT 1
    `);
    const spData = (spRow.rows[0] as Record<string, unknown> | undefined) ?? {};
    paymentNumber = String(spData["payment_number"] ?? `PAY-${id}`);
    acctAmount = spData["amount"] != null ? Number(spData["amount"]) : bTotalAmount;
    acctMethod = normalizePaymentMethod(spData["method"] != null ? String(spData["method"]) : null) ?? "cash";
    acctDate   = spData["paid_at"] != null ? String(spData["paid_at"]).slice(0, 10) : bookingDateStr;
    console.log(`[sport-center] ensurePaymentForPaidBooking: backfilling missing accounting for sport_payment_id=${sportPaymentId} amount=${acctAmount} method=${acctMethod}`);
  } else {
    // Neither record exists — INSERT sport_payments inside the caller's transaction.
    paymentNumber = await nextPaymentNumber(bCompanyId ?? undefined);
    const payR = await client.execute(sql`
      INSERT INTO sport_payments
        (company_id, booking_id, payment_number, amount, method, status,
         paid_at, notes, source, payment_type)
      VALUES
        (${bCompanyId}, ${id}, ${paymentNumber}, ${bTotalAmount}, ${bookingPaymentMethod}, 'paid',
         NOW(), 'Auto-created (paid booking)', 'SPORT_CENTER', 'booking')
      RETURNING *
    `);
    sportPaymentId = Number((payR.rows[0] as Record<string, unknown>)?.id ?? 0);
    createdPayRow = payR.rows[0] as Record<string, unknown>;
    // acctAmount/acctMethod/acctDate remain at booking-level defaults (already set above)
  }

  // ── Insert accounting_payments (THROWS on missing journal — rolls back caller's tx) ──
  // Side effects (audit, broadcast, journal entry, tax) are deferred to AFTER this
  // succeeds so a JOURNAL_MISSING failure leaves no false artifacts.
  if (sportPaymentId) {
    await insertAccountingPaymentForSportCenter({
      companyId: bCompanyId ?? 1,
      paymentNumber,
      amount: acctAmount,
      method: acctMethod,
      partnerName: String(row.customer_name ?? ""),
      ref: bookingCodeStr,
      memo: 'Auto-created (paid booking)',
      paymentMethod: acctMethod,
      sourceDocId: sportPaymentId,
      date: acctDate,
      createdById,
      client,
    });
  }

  // ── Side effects: only reached after all DB writes committed (or will commit) ──
  if (createdPayRow) {
    // Audit log — fire-and-forget, uses global db (non-critical, outside tx intentionally)
    db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (
        ${bCompanyId}, 'payment', ${createdPayRow.id ?? null},
        'PAYMENT_AUTO_CREATED', ${createdById},
        ${JSON.stringify(createdPayRow)}::jsonb
      )
    `).catch((e: unknown) => console.error('[sport-center] audit log (ensurePayment) failed:', e));

    broadcastSportCenterEvent(
      { module: "sport-center", entity: "payment", action: "created", data: createdPayRow, timestamp: new Date().toISOString() },
      bCompanyId as number | undefined,
    );

    // Journal entry — fire-and-forget
    postSportCenterBooking({
      bookingId: id,
      bookingCode: bookingCodeStr,
      customerName: String(row.customer_name ?? ""),
      facilityName: String(row.facility_name ?? ""),
      date: bookingDateStr,
       totalPrice: bTotalAmount,
       paymentMethod: acctMethod,
      createdById,
      companyId: bCompanyId,
    }).catch((err: unknown) => console.error('[sport-center] postSportCenterBooking (ensurePayment) failed:', err));

    // Tax engine — fire-and-forget
    import("../../lib/taxAutoService.js").then(({ recordTransactionTax }) => {
      const dppForTax = Math.round(bTotalAmount * 100 / 111 * 100) / 100;
      void recordTransactionTax({
        companyId: bCompanyId ?? 1,
        transactionType: "sport_center",
        transactionId: id,
        transactionRef: String(row.booking_number ?? id),
        baseAmount: dppForTax,
      });
    }).catch(() => {/* ignore */});
  }
}

async function nextPrSeq(): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `PR/${year}/%`;
  const res = await db.execute(sql`SELECT COALESCE(MAX(CAST(SPLIT_PART(pr_number, '/', 3) AS int)), 0) AS seq FROM purchase_requests WHERE pr_number LIKE ${pattern}`);
  const seq = (Number((res.rows[0] as any).seq ?? 0) + 1).toString().padStart(5, "0");
  return `PR/${year}/${seq}`;
}

async function nextRefundNumber(companyId?: number): Promise<string> {
  const res = await db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_refunds WHERE (${companyId ?? null}::int IS NULL OR company_id = ${companyId ?? null})`);
  return `RF/${new Date().getFullYear()}/${pad(Number((res.rows[0] as any).cnt) + 1)}`;
}

router.get("/events", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  handleSportCenterSse(req, res);
});

router.get("/dashboard", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    const cId = companyId ?? null;

    const [
      totals, todayRes, pendingPayRes, membersRes, byStatus, topFacilities, recentBookings,
      monthRev, totalRev, promoUsedRes, promoDiscountRes, cancelledRes, totalRefundsRes,
      totalRefundAmountRes, expiredMembersRes, membershipRevRes, membershipPayCountRes,
    ] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId})`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND booking_date = CURRENT_DATE`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND payment_status = 'unpaid' AND status NOT IN ('cancelled','completed')`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_members WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND status = 'active'`),
      db.execute(sql`SELECT status, COUNT(*) AS count FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) GROUP BY status ORDER BY count DESC`),
      db.execute(sql`SELECT facility_name, COUNT(*) AS bookings, COALESCE(SUM(total_amount),0) AS revenue FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND status != 'cancelled' GROUP BY facility_name ORDER BY bookings DESC LIMIT 5`),
      db.execute(sql`SELECT * FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) ORDER BY created_at DESC LIMIT 10`),
      db.execute(sql`SELECT COALESCE(SUM(total_amount),0) AS revenue FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND status != 'cancelled' AND booking_date >= date_trunc('month', CURRENT_DATE)`),
      db.execute(sql`SELECT COALESCE(SUM(total_amount),0) AS revenue FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND status != 'cancelled'`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND promo_id IS NOT NULL AND status != 'cancelled'`),
      db.execute(sql`SELECT COALESCE(SUM(discount_amount),0) AS total FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND promo_id IS NOT NULL AND status != 'cancelled'`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND status = 'cancelled'`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_refunds WHERE (${cId}::int IS NULL OR company_id = ${cId})`),
      db.execute(sql`SELECT COALESCE(SUM(refund_amount),0) AS total FROM sport_refunds WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND status = 'paid'`),
      // Membership: expired members
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_members WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND (status = 'expired' OR (end_date IS NOT NULL AND end_date < CURRENT_DATE AND status != 'active'))`),
      // Membership: total revenue dari sport_payments
      db.execute(sql`SELECT COALESCE(SUM(amount),0) AS revenue FROM sport_payments WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND payment_type = 'membership' AND status = 'paid'`),
      // Membership: jumlah transaksi
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_payments WHERE (${cId}::int IS NULL OR company_id = ${cId}) AND payment_type = 'membership' AND status = 'paid'`),
    ]);

    const bookingRevenue = Number((totalRev.rows[0] as any).revenue);
    const membershipRevenue = Number((membershipRevRes.rows[0] as any).revenue);
    res.json({
      totalBookings: Number((totals.rows[0] as any).cnt),
      todayBookings: Number((todayRes.rows[0] as any).cnt),
      pendingPayment: Number((pendingPayRes.rows[0] as any).cnt),
      activeMembers: Number((membersRes.rows[0] as any).cnt),
      totalMembers: Number((membersRes.rows[0] as any).cnt),
      expiredMembers: Number((expiredMembersRes.rows[0] as any).cnt),
      byStatus: byStatus.rows,
      topFacilities: topFacilities.rows,
      recentBookings: recentBookings.rows,
      monthRevenue: Number((monthRev.rows[0] as any).revenue),
      bookingRevenue,
      membershipRevenue,
      membershipPayments: Number((membershipPayCountRes.rows[0] as any).cnt),
      totalRevenue: bookingRevenue + membershipRevenue,
      totalPromoUsed: Number((promoUsedRes.rows[0] as any).cnt),
      totalPromoDiscount: Number((promoDiscountRes.rows[0] as any).total),
      cancelledBookings: Number((cancelledRes.rows[0] as any).cnt),
      totalRefunds: Number((totalRefundsRes.rows[0] as any).cnt),
      totalRefundAmount: Number((totalRefundAmountRes.rows[0] as any).total),
    });
  } catch {
    res.status(500).json({ error: "Gagal memuat dashboard" });
  }
});

// ── FASE 6D-B: KPI LIVE ───────────────────────────────────────────────────────
router.get("/kpi-live", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const costCenterId = req.query.costCenterId ? Number(req.query.costCenterId) : null;

    // Terima parameter date opsional (format YYYY-MM-DD), default ke CURRENT_DATE
    const rawDate = req.query.date as string | undefined;
    const isValidDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
    const targetDate = isValidDate ? rawDate : null;

    const [
      revenueTodayRes,
      bookingsTodayRes,
      activeBookingsNowRes,
      checkinsTodayRes,
      membersActiveRes,
      refundsTodayRes,
      occupancyTodayRes,
      facilityCountRes,
      netProfitTodayRes,
    ] = await Promise.all([
      // Revenue dari accounting_entries (booking + membership)
      db.execute(sql`
        SELECT COALESCE(SUM(total_debit), 0) AS amount
        FROM accounting_entries
        WHERE source IN ('sport_center_booking','sport_center_membership')
          AND status = 'posted'
          AND date = COALESCE(${targetDate}::date, CURRENT_DATE)
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
      `),
      // Booking (bukan cancelled)
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_bookings
        WHERE booking_date = COALESCE(${targetDate}::date, CURRENT_DATE)
          AND status != 'cancelled'
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Booking aktif (confirmed atau checked_in)
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_bookings
        WHERE booking_date = COALESCE(${targetDate}::date, CURRENT_DATE)
          AND status IN ('confirmed','checked_in')
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Check-in
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_bookings
        WHERE DATE(checked_in_at) = COALESCE(${targetDate}::date, CURRENT_DATE)
          AND status = 'checked_in'
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Member aktif
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_members
        WHERE status = 'active'
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Refund (amount)
      db.execute(sql`
        SELECT COALESCE(SUM(refund_amount), 0) AS amount
        FROM sport_refunds
        WHERE DATE(created_at) = COALESCE(${targetDate}::date, CURRENT_DATE)
          AND status IN ('pending','paid')
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Occupancy: total jam terpakai dari booking
      db.execute(sql`
        SELECT COALESCE(SUM(duration_hours), 0) AS occupied_hours
        FROM sport_bookings
        WHERE booking_date = COALESCE(${targetDate}::date, CURRENT_DATE)
          AND status NOT IN ('cancelled')
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Jumlah fasilitas aktif
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_facilities
        WHERE is_active = TRUE
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Net profit: revenue - refund (dari accounting)
      db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN source IN ('sport_center_booking','sport_center_membership') THEN total_debit ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN source IN ('sport_center_refund','sport_center_booking_refund','sport_center_booking_reversal') THEN total_debit ELSE 0 END), 0) AS net
        FROM accounting_entries
        WHERE date = COALESCE(${targetDate}::date, CURRENT_DATE)
          AND status = 'posted'
          AND source IN ('sport_center_booking','sport_center_membership','sport_center_refund','sport_center_booking_refund','sport_center_booking_reversal')
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
      `),
    ]);

    const revenueToday = Number((revenueTodayRes.rows[0] as any).amount ?? 0);
    const refundsToday = Number((refundsTodayRes.rows[0] as any).amount ?? 0);
    const occupiedHoursToday = Number((occupancyTodayRes.rows[0] as any).occupied_hours ?? 0);
    const facilityCount = Number((facilityCountRes.rows[0] as any).cnt ?? 1);
    // available_hours = jumlah fasilitas × 14 jam operasional/hari
    const availableHoursToday = Math.max(facilityCount * 14, 1);
    const occupancyToday = Math.min(100, Math.round((occupiedHoursToday / availableHoursToday) * 100));

    res.json({
      revenue_today: revenueToday,
      bookings_today: Number((bookingsTodayRes.rows[0] as any).cnt ?? 0),
      active_bookings_now: Number((activeBookingsNowRes.rows[0] as any).cnt ?? 0),
      occupancy_today: occupancyToday,
      occupied_hours_today: occupiedHoursToday,
      available_hours_today: availableHoursToday,
      checkins_today: Number((checkinsTodayRes.rows[0] as any).cnt ?? 0),
      members_active: Number((membersActiveRes.rows[0] as any).cnt ?? 0),
      refunds_today: refundsToday,
      net_profit_today: Number((netProfitTodayRes.rows[0] as any).net ?? 0),
    });
  } catch (err) {
    console.error("[sport-center] GET /kpi-live error:", err);
    res.status(500).json({ error: "Gagal memuat KPI live" });
  }
});

// ── FASE 6D-C: REAL OCCUPANCY PER FACILITY ───────────────────────────────────
router.get("/occupancy", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const dateParam = req.query.date ? String(req.query.date) : null;

    const rows = await db.execute(sql`
      SELECT
        b.facility_id,
        b.facility_name,
        COALESCE(SUM(b.duration_hours), 0)                                     AS occupied_hours,
        COALESCE(MAX(f.capacity), 1) * 14                                      AS available_hours,
        LEAST(100, ROUND(
          COALESCE(SUM(b.duration_hours), 0)::numeric /
          GREATEST(COALESCE(MAX(f.capacity), 1) * 14, 1) * 100
        ))                                                                      AS occupancy_percent
      FROM sport_bookings b
      LEFT JOIN sport_facilities f ON f.id = b.facility_id
      WHERE b.status NOT IN ('cancelled')
        AND b.booking_date = COALESCE(${dateParam}::date, CURRENT_DATE)
        AND (${cId}::int IS NULL OR b.company_id = ${cId})
      GROUP BY b.facility_id, b.facility_name
      ORDER BY occupancy_percent DESC
    `);

    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /occupancy error:", err);
    res.status(500).json({ error: "Gagal memuat occupancy" });
  }
});

// ── FASE 6D-F: HEATMAP JAM RAMAI ─────────────────────────────────────────────
router.get("/heatmap", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : null;

    // Hitung booking count per jam mulai (dari start_time)
    const rows = await db.execute(sql`
      SELECT
        LPAD(EXTRACT(HOUR FROM start_time::time)::int::text, 2, '0') || ':00' AS hour,
        COUNT(*) AS booking_count
      FROM sport_bookings
      WHERE status NOT IN ('cancelled')
        AND start_time IS NOT NULL
        AND (${cId}::int IS NULL OR company_id = ${cId})
        AND (${from}::date IS NULL OR booking_date >= ${from}::date)
        AND (${to}::date IS NULL OR booking_date <= ${to}::date)
        AND (${facilityId}::int IS NULL OR facility_id = ${facilityId})
      GROUP BY EXTRACT(HOUR FROM start_time::time)
      ORDER BY EXTRACT(HOUR FROM start_time::time)
    `);

    // Isi jam kosong agar output lengkap 06:00–22:00
    const hourMap = new Map<string, number>();
    for (const r of rows.rows as any[]) {
      hourMap.set(String(r.hour), Number(r.booking_count));
    }
    const heatmap = [];
    for (let h = 6; h <= 22; h++) {
      const label = `${String(h).padStart(2, "0")}:00`;
      heatmap.push({ hour: label, booking_count: hourMap.get(label) ?? 0 });
    }

    res.json(heatmap);
  } catch (err) {
    console.error("[sport-center] GET /heatmap error:", err);
    res.status(500).json({ error: "Gagal memuat heatmap" });
  }
});

router.get("/facilities", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const raw = req.query.companyId;
    const parsed = raw ? Number(raw) : NaN;
    // companyId=0 (consolidated) or "all" or NaN → fetch semua company
    const cId = (!isNaN(parsed) && parsed > 0) ? parsed : null;
    const result = cId
      ? await db.execute(sql`SELECT * FROM sport_facilities WHERE company_id = ${cId} ORDER BY sort_order ASC, id ASC`)
      : await db.execute(sql`SELECT * FROM sport_facilities ORDER BY sort_order ASC, id ASC`);
    res.json(result.rows);
  } catch (err) {
    console.error("[sport-center] GET /facilities error:", err);
    res.status(500).json({ error: "Gagal memuat fasilitas" });
  }
});

router.get("/facilities/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    const r = await db.execute(sql`SELECT * FROM sport_facilities WHERE id = ${id}`);
    if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const row = r.rows[0] as Record<string, unknown>;
    // IDOR guard
    const cId = resolveCompanyId(req);
    if (!await assertCompanyAccess(row["company_id"] as number | null, cId, req, res, { resourceType: "sport_facility", resourceId: id })) return;
    res.json(row);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.post("/facilities", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { name, type = "court", description, capacity = 1, price_per_hour = 0, is_active = true, sort_order = 0, image_url, company_id } = req.body;
    if (!name) return res.status(400).json({ error: "Nama wajib diisi" });
    const r = await db.execute(sql`
      INSERT INTO sport_facilities (company_id, name, type, description, capacity, price_per_hour, is_active, sort_order, image_url)
      VALUES (${company_id ?? null}, ${name}, ${type}, ${description ?? null}, ${capacity}, ${price_per_hour}, ${is_active}, ${sort_order}, ${image_url ?? null})
      RETURNING *
    `);
    const row = r.rows[0] as Record<string, unknown>;
    broadcastSportCenterEvent({ module: "sport-center", entity: "facility", action: "created", data: row, timestamp: new Date().toISOString() }, company_id);
    void syncFacilityUpsert(row as any);
    res.status(201).json(row);
  } catch {
    res.status(500).json({ error: "Gagal membuat fasilitas" });
  }
});

router.patch("/facilities/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard: fetch resource first
    const lookup = await db.execute(sql`SELECT company_id FROM sport_facilities WHERE id = ${id}`);
    if (!lookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cId = resolveCompanyId(req);
    if (!await assertCompanyAccess((lookup.rows[0] as any).company_id as number | null, cId, req, res, { resourceType: "sport_facility", resourceId: id })) return;
    const { name, type, description, capacity, price_per_hour, is_active, sort_order, image_url } = req.body;
    const r = await db.execute(sql`
      UPDATE sport_facilities SET
        name = COALESCE(${name ?? null}, name),
        type = COALESCE(${type ?? null}, type),
        description = COALESCE(${description ?? null}, description),
        capacity = COALESCE(${capacity ?? null}::int, capacity),
        price_per_hour = COALESCE(${price_per_hour ?? null}::numeric, price_per_hour),
        is_active = COALESCE(${is_active ?? null}::boolean, is_active),
        sort_order = COALESCE(${sort_order ?? null}::int, sort_order),
        image_url = COALESCE(${image_url ?? null}, image_url),
        updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const row = r.rows[0] as Record<string, unknown>;
    broadcastSportCenterEvent({ module: "sport-center", entity: "facility", action: "updated", data: row, timestamp: new Date().toISOString() });
    void syncFacilityUpsert(row as any);
    res.json(row);
  } catch {
    res.status(500).json({ error: "Gagal memperbarui" });
  }
});

router.delete("/facilities/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    const lookup = await db.execute(sql`SELECT id, name, company_id FROM sport_facilities WHERE id = ${id}`);
    const existing = lookup.rows[0] as { id: number; name: string; company_id: number | null } | undefined;
    if (!existing) return res.status(404).json({ error: "Tidak ditemukan" });
    // IDOR guard
    const cId = resolveCompanyId(req);
    if (!await assertCompanyAccess(existing.company_id, cId, req, res, { resourceType: "sport_facility", resourceId: id })) return;
    await db.execute(sql`DELETE FROM sport_facilities WHERE id = ${id}`);
    broadcastSportCenterEvent({ module: "sport-center", entity: "facility", action: "deleted", data: { id: String(req.params.id) }, timestamp: new Date().toISOString() });
    if (existing) void syncFacilityDelete(existing.id, existing.name);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Gagal menghapus" });
  }
});

router.post("/facilities/resync-all", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const includeBookings = req.query.include === "bookings" || req.body?.include === "bookings";
    const startedAt = new Date().toISOString();

    const facilityResult = await syncAllFacilities();
    let bookingResult: { synced: number; errors: number; total: number } | null = null;

    if (includeBookings) {
      bookingResult = await syncAllBookings();
    }

    res.json({
      success: true,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      facilities: facilityResult,
      ...(bookingResult ? { bookings: bookingResult } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Resync gagal", detail: err?.message });
  }
});

router.post("/facilities/pull-from-supabase", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const result = await pullFacilitiesFromSupabase();
    res.json({ success: true, ...result, completed_at: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "Pull fasilitas gagal", detail: err?.message });
  }
});

router.post("/sync/bookings", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const result = await syncAllBookings();
    res.json({ success: true, ...result, completed_at: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "Booking resync gagal", detail: err?.message });
  }
});

router.post("/sync/pull-legacy", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const result = await pullLegacyBookingsFromSupabase();
    res.json({ success: true, ...result, completed_at: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "Pull legacy bookings gagal", detail: err?.message });
  }
});

router.post("/sync/incremental", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { triggerIncrementalSync } = await import("./incrementalSyncWorker.js");
    const result = await triggerIncrementalSync();
    res.json({ success: true, ...result, completed_at: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "Incremental sync gagal", detail: err?.message });
  }
});

// Update payment_status di local DB dari frontend (anon Supabase client)
router.post("/sync/update-payment-status", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows } = req.body as {
      rows: Array<{ booking_number: string; payment_status: string }>;
    };
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json({ success: true, updated: 0 });
    }
    let updated = 0;
    for (const row of rows) {
      if (!row.booking_number || !row.payment_status) continue;
      const ps = row.payment_status.toLowerCase();
      const mapped = ps === "paid" ? "paid" : ps === "partial" ? "partial" : ps === "free" ? "paid" : null;
      if (!mapped) continue;
      const r = await db.execute(sql`
        UPDATE sport_bookings
        SET payment_status = ${mapped}, updated_at = NOW()
        WHERE booking_number = ${row.booking_number}
          AND payment_status != ${mapped}
      `);
      if ((r.rowCount ?? 0) > 0) updated++;
    }
    res.json({ success: true, updated });
  } catch (err: any) {
    res.status(500).json({ error: "Update payment status gagal", detail: err?.message });
  }
});

// Push booking dari frontend (Supabase anon) ke local PostgreSQL
router.post("/sync/push-bookings", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { bookings, companyId } = req.body as {
      bookings: Array<{
        booking_code?: string | null;
        customer_name?: string | null;
        customer_phone?: string | null;
        customer_email?: string | null;
        facility_name?: string | null;
        date?: string | null;
        start_time?: string | null;
        end_time?: string | null;
        total_hours?: number | null;
        total_price?: number | null;
        status?: string | null;
        payment_status?: string | null;
        notes?: string | null;
        created_at?: string | null;
      }>;
      companyId?: number;
    };
    if (!Array.isArray(bookings) || bookings.length === 0) {
      return res.json({ success: true, pushed: 0, errors: 0, total: 0 });
    }
    const cId = companyId ?? 1;
    let pushed = 0;
    let errors = 0;
    for (const row of bookings) {
      try {
        const bookingNumber = row.booking_code ?? `LEGACY-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const facilityName = row.facility_name ?? "Unknown";
        const bookingDate = row.date;
        if (!bookingDate) { errors++; continue; }
        const startTime = (row.start_time ?? "").slice(0, 5) || "00:00";
        const endTime   = (row.end_time   ?? "").slice(0, 5) || "01:00";
        const durationHours = Number(row.total_hours ?? 1);
        const totalAmount   = Number(row.total_price ?? 0);
        const rawStatus     = row.status ?? "pending";
        const mappedStatus  = rawStatus === "confirmed" ? "confirmed"
          : rawStatus === "cancelled" ? "cancelled"
          : rawStatus === "completed" ? "completed"
          : "pending";
        const paymentStatus = row.payment_status ?? "unpaid";
        const existing = await db.execute(sql`SELECT id FROM sport_bookings WHERE booking_number = ${bookingNumber} LIMIT 1`);
        if (existing.rows.length > 0) {
          await db.execute(sql`
            UPDATE sport_bookings SET
              customer_name   = ${row.customer_name ?? ""},
              customer_phone  = ${row.customer_phone ?? null},
              facility_name   = ${facilityName},
              booking_date    = ${bookingDate}::DATE,
              start_time      = ${startTime}::TIME,
              end_time        = ${endTime}::TIME,
              duration_hours  = ${durationHours},
              base_amount     = ${totalAmount},
              total_amount    = ${totalAmount},
              status          = ${mappedStatus},
              payment_status  = ${paymentStatus},
              notes           = ${row.notes ?? null},
              updated_at      = NOW()
            WHERE booking_number = ${bookingNumber}
          `);
        } else {
          await db.execute(sql`
            INSERT INTO sport_bookings
              (company_id, booking_number, customer_name, customer_phone,
               facility_name, booking_date, start_time, end_time,
               duration_hours, base_amount, total_amount,
               status, payment_status, notes, created_at, updated_at)
            VALUES
              (${cId}, ${bookingNumber}, ${row.customer_name ?? ""}, ${row.customer_phone ?? null},
               ${facilityName}, ${bookingDate}::DATE, ${startTime}::TIME, ${endTime}::TIME,
               ${durationHours}, ${totalAmount}, ${totalAmount},
               ${mappedStatus}, ${paymentStatus}, ${row.notes ?? null},
               ${row.created_at ?? new Date().toISOString()}::TIMESTAMPTZ, NOW())
          `);
        }
        // Legacy booking yang sudah lunas harus tetap muncul di daftar Pembayaran:
        // buat sport_payments + jurnal jika belum ada (idempoten).
        if (paymentStatus === 'paid') {
          const br = await db.execute(sql`
            SELECT id, company_id, total_amount, tax_amount, booking_number,
                   customer_name, facility_name, booking_date
            FROM sport_bookings WHERE booking_number = ${bookingNumber} LIMIT 1
          `);
          if (br.rows.length) {
            await ensurePaymentForPaidBooking(br.rows[0] as Record<string, unknown>, null);
          }
        }
        pushed++;
      } catch (err) {
        console.error("[sport-center] push-bookings row error:", err);
        errors++;
      }
    }
    // Invalidate dashboard after push
    broadcastSportCenterEvent({ module: "sport-center", entity: "booking", action: "synced" as any, data: { pushed, errors }, timestamp: new Date().toISOString() });
    res.json({ success: true, pushed, errors, total: bookings.length });
  } catch (err: any) {
    res.status(500).json({ error: "Push bookings gagal", detail: err?.message });
  }
});

router.get("/bookings", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const status = (req.query.status as string) ?? null;
    const paymentStatus = (req.query.payment_status as string) ?? null;
    const date = (req.query.date as string) ?? null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 10)));
    const offset = (page - 1) * limit;

    // SOURCE OF TRUTH: sport_center.sport_bookings + sport_center.sport_payments (cross-schema, same Supabase instance).
    // payment_status dihitung dari actual payment records — bukan dari billing_status saja.
    console.log(`[SportCenter→Supabase] GET /bookings page=${page} limit=${limit} status=${status} payment_status=${paymentStatus} date=${date}`);
    try {
      const [dataRes, countRes] = await Promise.all([
        db.execute(sql`
          WITH bps AS (
            SELECT
              b.id              AS sc_booking_id,
              b.order_number    AS booking_number,
              b.customer_name,
              b.customer_phone,
              b.customer_email,
              COALESCE(f.name, '') AS facility_name,
              b.facility_id,
              b.booking_date,
              b.start_time::text  AS start_time,
              b.end_time::text    AS end_time,
              COALESCE(b.duration_hours, 0) AS duration_hours,
              COALESCE(b.grand_total, b.total_price, 0) AS total_amount,
              b.status,
              b.billing_status,
              b.notes,
              b.created_at,
              b.updated_at,
              CASE
                -- Prioritas 1: ada payment confirmed di sport_center.sport_payments (canonical)
                WHEN EXISTS(
                  SELECT 1 FROM sport_center.sport_payments p
                  WHERE p.booking_id = b.id
                    AND p.status::text NOT IN ('pending','cancelled','canceled','refunded','failed','expired')
                ) THEN 'paid'
                -- Prioritas 2: billing_status dari aplikasi SC asli
                WHEN lower(b.billing_status::text) IN ('paid','free') THEN 'paid'
                WHEN lower(b.billing_status::text) = 'partial'        THEN 'partial'
                -- Prioritas 3: BizPortal payment via public.sport_payments (sc_booking_id link)
                -- Mencakup payment yang dibuat via POST /payments BizPortal untuk booking canonical ini
                WHEN EXISTS(
                  SELECT 1
                  FROM public.sport_bookings sb
                  JOIN public.sport_payments sp ON sp.booking_id = sb.id
                  WHERE sb.sc_booking_id = b.id
                    AND sp.status = 'paid'
                    AND sp.payment_number NOT LIKE 'SCPAY-%'
                ) THEN 'paid'
                ELSE 'unpaid'
              END AS payment_status
            FROM sport_center.sport_bookings b
            LEFT JOIN sport_center.sport_facilities f ON f.id = b.facility_id
          )
          SELECT * FROM bps
          WHERE (${status}::text IS NULL OR status = ${status})
            AND (${paymentStatus}::text IS NULL OR payment_status = ${paymentStatus})
            AND (${date}::date IS NULL OR booking_date = ${date}::date)
          ORDER BY booking_date DESC, start_time DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM (
            SELECT b.id,
              CASE
                WHEN EXISTS(
                  SELECT 1 FROM sport_center.sport_payments p
                  WHERE p.booking_id = b.id
                    AND p.status::text NOT IN ('pending','cancelled','canceled','refunded','failed','expired')
                ) THEN 'paid'
                WHEN lower(b.billing_status::text) IN ('paid','free') THEN 'paid'
                WHEN lower(b.billing_status::text) = 'partial'        THEN 'partial'
                WHEN EXISTS(
                  SELECT 1
                  FROM public.sport_bookings sb
                  JOIN public.sport_payments sp ON sp.booking_id = sb.id
                  WHERE sb.sc_booking_id = b.id
                    AND sp.status = 'paid'
                    AND sp.payment_number NOT LIKE 'SCPAY-%'
                ) THEN 'paid'
                ELSE 'unpaid'
              END AS payment_status,
              b.status, b.booking_date
            FROM sport_center.sport_bookings b
          ) sub
          WHERE (${status}::text IS NULL OR status = ${status})
            AND (${paymentStatus}::text IS NULL OR payment_status = ${paymentStatus})
            AND (${date}::date IS NULL OR booking_date = ${date}::date)
        `),
      ]);
      const rows = dataRes.rows;
      console.log(`[SportCenter→Supabase] GET /bookings → ${rows.length} rows dari sport_center.sport_bookings`);
      return res.json({ data: rows, total: Number((countRes.rows[0] as any).cnt) });
    } catch (err: any) {
      console.error("[sport-center] GET /bookings cross-schema error:", err?.message, "— fallback ke local sport_bookings");
      try {
        const [fbData, fbCount] = await Promise.all([
          db.execute(sql`
            SELECT
              pub.sc_booking_id,
              pub.booking_number,
              pub.customer_name,
              pub.customer_phone,
              pub.customer_email,
              pub.facility_name,
              NULL::int       AS facility_id,
              pub.booking_date,
              pub.start_time::text,
              pub.end_time::text,
              pub.duration_hours,
              pub.total_amount,
              pub.status,
              NULL::text      AS billing_status,
              pub.notes,
              pub.created_at,
              pub.updated_at,
              pub.payment_status
            FROM sport_bookings pub
            WHERE pub.sc_booking_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM sport_center.sport_bookings sc WHERE sc.id = pub.sc_booking_id)
              AND (${status}::text IS NULL OR pub.status = ${status})
              AND (${paymentStatus}::text IS NULL OR pub.payment_status = ${paymentStatus})
              AND (${date}::date IS NULL OR pub.booking_date = ${date}::date)
            ORDER BY pub.booking_date DESC, pub.start_time DESC
            LIMIT ${limit} OFFSET ${offset}
          `),
          db.execute(sql`
            SELECT COUNT(*) AS cnt FROM sport_bookings pub
            WHERE pub.sc_booking_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM sport_center.sport_bookings sc WHERE sc.id = pub.sc_booking_id)
              AND (${status}::text IS NULL OR pub.status = ${status})
              AND (${paymentStatus}::text IS NULL OR pub.payment_status = ${paymentStatus})
              AND (${date}::date IS NULL OR pub.booking_date = ${date}::date)
          `),
        ]);
        console.log(`[sport-center] GET /bookings fallback local → ${fbData.rows.length} rows`);
        return res.json({ data: fbData.rows, total: Number((fbCount.rows[0] as any).cnt), _source: "local_fallback" });
      } catch (fbErr: any) {
        console.error("[sport-center] GET /bookings fallback local error:", fbErr?.message);
        return res.json({ data: [], total: 0 });
      }
    }
  } catch (err: any) {
    console.error("[sport-center] GET /bookings error:", err?.message);
    res.status(500).json({ error: "Gagal" });
  }
});

router.post("/bookings", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const {
      company_id, customer_id, customer_name, customer_phone, facility_id, facility_name,
      booking_date, start_time, end_time, duration_hours = 1, base_amount = 0,
      notes,
    } = req.body;
    if (!customer_name || !facility_name || !booking_date || !start_time || !end_time) {
      return res.status(400).json({ error: "Field wajib tidak lengkap" });
    }

    // Ambil customer_email dari request atau lookup dari sport_customers
    let customerEmail: string | null = req.body.customer_email ?? null;
    if (!customerEmail && customer_id) {
      const custRes = await db.execute(sql`SELECT email FROM sport_customers WHERE id = ${customer_id} LIMIT 1`);
      customerEmail = (custRes.rows[0] as Record<string, unknown>)?.email as string ?? null;
    }

    // Validasi dan hitung promo
    let resolvedPromoId: number | null = null;
    let resolvedPromoCode: string | null = req.body.promo_code ?? null;
    let resolvedDiscount = Number(req.body.discount_amount ?? 0);
    const inputPromoCode: string | null = req.body.promo_code ?? null;

    if (inputPromoCode) {
      const cId = company_id ?? null;
      const promoRes = await db.execute(sql`
        SELECT * FROM sport_promos
        WHERE code = ${inputPromoCode}
          AND is_active = TRUE
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (valid_from IS NULL OR valid_from <= NOW())
          AND (valid_until IS NULL OR valid_until >= NOW())
        LIMIT 1
      `);
      if (!promoRes.rows.length) {
        return res.status(400).json({ error: "Kode promo tidak valid atau sudah kadaluarsa" });
      }
      const promo = promoRes.rows[0] as Record<string, unknown>;
      if (promo.max_uses != null && Number(promo.used_count) >= Number(promo.max_uses)) {
        return res.status(400).json({ error: "Kuota promo sudah habis" });
      }
      if (promo.min_amount != null && Number(base_amount) < Number(promo.min_amount)) {
        return res.status(400).json({ error: `Minimum transaksi untuk promo ini adalah ${promo.min_amount}` });
      }
      const dtype = String(promo.discount_type);
      const dval = Number(promo.discount_value);
      resolvedDiscount = dtype === "fixed"
        ? Math.min(dval, Number(base_amount))
        : Math.min(Number(base_amount) * dval / 100, Number(base_amount));
      resolvedDiscount = Math.round(resolvedDiscount * 100) / 100;
      resolvedPromoId = Number(promo.id);
      resolvedPromoCode = String(promo.code);
    }

    const resolvedTotal = Math.max(0, Number(base_amount) - resolvedDiscount);

    // PPN 11% jika apply_tax = true
    // CATATAN: harga fasilitas (price_per_hour) sudah INKLUSIF PPN.
    // Gunakan formula ekstraksi PPN inklusif: PPN = total × rate / (100 + rate)
    // Bukan formula eksklusif (total × rate / 100) yang akan double-count PPN.
    const applyTax = Boolean(req.body.apply_tax ?? false);
    const TAX_RATE = 11;
    const taxRate   = applyTax ? TAX_RATE : 0;
    const taxAmount = applyTax ? Math.round(resolvedTotal * TAX_RATE / (100 + TAX_RATE) * 100) / 100 : 0;

    // Auto-upsert customer ke sport_customers (by name+phone per company)
    let resolvedCustomerId: number | null = customer_id ?? null;
    if (!resolvedCustomerId && customer_name) {
      const cIdForCustomer = company_id ?? null;
      const existingCust = await db.execute(sql`
        SELECT id FROM sport_customers
        WHERE (${cIdForCustomer}::int IS NULL OR company_id = ${cIdForCustomer})
          AND LOWER(name) = LOWER(${customer_name})
          AND (${customer_phone ?? null}::text IS NULL OR phone = ${customer_phone ?? null})
        LIMIT 1
      `);
      if (existingCust.rows.length > 0) {
        resolvedCustomerId = (existingCust.rows[0] as any).id as number;
      } else {
        const newCust = await db.execute(sql`
          INSERT INTO sport_customers (company_id, name, phone, email)
          VALUES (${cIdForCustomer}, ${customer_name}, ${customer_phone ?? null}, ${customerEmail ?? null})
          RETURNING id
        `);
        resolvedCustomerId = (newCust.rows[0] as any).id as number;
      }
    }

    const bookingNumber = await nextBookingNumber(company_id);
    const r = await db.execute(sql`
      INSERT INTO sport_bookings
        (company_id, booking_number, customer_id, customer_name, customer_email, customer_phone, facility_id, facility_name,
         booking_date, start_time, end_time, duration_hours, base_amount, discount_amount, total_amount,
         tax_rate, tax_amount,
         promo_id, promo_code, notes, status, payment_status)
      VALUES
        (${company_id ?? null}, ${bookingNumber}, ${resolvedCustomerId}, ${customer_name}, ${customerEmail ?? null}, ${customer_phone ?? null},
         ${facility_id ?? null}, ${facility_name}, ${booking_date}, ${start_time}, ${end_time},
         ${duration_hours}, ${base_amount}, ${resolvedDiscount}, ${resolvedTotal},
         ${taxRate}, ${taxAmount},
         ${resolvedPromoId}, ${resolvedPromoCode}, ${notes ?? null}, 'pending', 'unpaid')
      RETURNING *
    `);

    // Increment used_count jika promo dipakai
    if (resolvedPromoId) {
      await db.execute(sql`UPDATE sport_promos SET used_count = used_count + 1, updated_at = NOW() WHERE id = ${resolvedPromoId}`);
    }

    const row = r.rows[0] as Record<string, unknown>;
    broadcastSportCenterEvent({ module: "sport-center", entity: "booking", action: "created", data: row, timestamp: new Date().toISOString() }, company_id);
    void syncBookingUpsert(row as any);

    void saveAndBroadcast("new_sport_booking", {
      type: "sport_booking",
      orderId: row.id as number,
      orderNumber: row.booking_number as string,
      customerName: row.customer_name as string,
      companyName: null,
      facilityName: row.facility_name as string,
      bookingDate: row.booking_date as string,
      startTime: row.start_time as string,
      endTime: row.end_time as string,
      grandTotal: Number(row.total_amount ?? 0),
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(row);
  } catch {
    res.status(500).json({ error: "Gagal membuat booking" });
  }
});

router.patch("/bookings/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const bkLookup = await db.execute(sql`SELECT company_id FROM sport_bookings WHERE id = ${id}`);
    if (!bkLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdBk = resolveCompanyId(req);
    if (!await assertCompanyAccess((bkLookup.rows[0] as any).company_id as number | null, cIdBk, req, res, { resourceType: "sport_booking", resourceId: id })) return;
    const { status, payment_status, notes } = req.body;
    const createdById = (req.user as { id: string } | undefined)?.id ?? null;

    let row: Record<string, unknown>;

    if (payment_status === 'paid') {
      // ── Atomic path: booking UPDATE + sport_payments + accounting_payments ──
      // All three commit or all three roll back together, so a JOURNAL_MISSING throw
      // leaves the DB unchanged rather than persisting a partial paid booking.
      row = await db.transaction(async (tx) => {
        const txClient = tx as unknown as SportDbClient;
        const r = await txClient.execute(sql`
          UPDATE sport_bookings SET
            status = COALESCE(${status ?? null}, status),
            payment_status = 'paid',
            notes = COALESCE(${notes ?? null}, notes),
            updated_at = NOW()
          WHERE id = ${id} RETURNING *
        `);
        if (!r.rows.length) throw new Error("NOT_FOUND");
        const txRow = r.rows[0] as Record<string, unknown>;
        await ensurePaymentForPaidBooking(txRow, createdById, txClient);
        return txRow;
      });
    } else {
      // ── Non-payment update: no accounting involved, no transaction needed ──
      const r = await db.execute(sql`
        UPDATE sport_bookings SET
          status = COALESCE(${status ?? null}, status),
          payment_status = COALESCE(${payment_status ?? null}, payment_status),
          notes = COALESCE(${notes ?? null}, notes),
          updated_at = NOW()
        WHERE id = ${id} RETURNING *
      `);
      if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
      row = r.rows[0] as Record<string, unknown>;
    }

    broadcastSportCenterEvent({ module: "sport-center", entity: "booking", action: "updated", data: row, timestamp: new Date().toISOString() });
    void syncBookingUpsert(row as any);
    res.json(row);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    if (detail === "NOT_FOUND") return res.status(404).json({ error: "Tidak ditemukan" });
    const isConfigError = detail.startsWith("JOURNAL_MISSING:") || detail.startsWith("COA_MISSING:");
    res.status(isConfigError ? 422 : 500).json({
      error: isConfigError ? "Konfigurasi akuntansi belum lengkap" : "Gagal memperbarui",
      ...(isConfigError ? { detail } : {}),
    });
  }
});

router.post("/bookings/:id/checkin", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const ciLookup = await db.execute(sql`SELECT company_id FROM sport_bookings WHERE id = ${id}`);
    if (!ciLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdCi = resolveCompanyId(req);
    if (!await assertCompanyAccess((ciLookup.rows[0] as any).company_id as number | null, cIdCi, req, res, { resourceType: "sport_booking", resourceId: id })) return;
    const r = await db.execute(sql`
      UPDATE sport_bookings SET status = 'checked_in', checked_in_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND status IN ('pending','confirmed') RETURNING *
    `);
    if (!r.rows.length) return res.status(400).json({ error: "Booking tidak dapat di-check-in" });
    const row = r.rows[0] as Record<string, unknown>;
    broadcastSportCenterEvent({ module: "sport-center", entity: "booking", action: "checkin", data: row, timestamp: new Date().toISOString() });
    void syncBookingUpsert(row as any);
    res.json(row);
  } catch {
    res.status(500).json({ error: "Gagal check-in" });
  }
});

router.post("/bookings/:id/cancel", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(String(req.params.id));
    const { cancel_reason } = req.body;
    const createdById = (req.user as { id: string } | undefined)?.id ?? null;

    // Fetch booking
    const bookingRes = await db.execute(sql`SELECT * FROM sport_bookings WHERE id = ${id} LIMIT 1`);
    if (!bookingRes.rows.length) return res.status(404).json({ error: "Booking tidak ditemukan" });
    const booking = bookingRes.rows[0] as Record<string, unknown>;
    // IDOR guard
    const cIdCancel = resolveCompanyId(req);
    if (!await assertCompanyAccess(booking["company_id"] as number | null, cIdCancel, req, res, { resourceType: "sport_booking", resourceId: id })) return;

    if (booking.status === "cancelled") return res.status(400).json({ error: "Booking sudah dibatalkan" });
    if (booking.status === "completed") return res.status(400).json({ error: "Booking yang sudah selesai tidak dapat dibatalkan" });

    // Update status booking
    const updated = await db.execute(sql`
      UPDATE sport_bookings
      SET status = 'cancelled', cancelled_at = NOW(), cancelled_reason = ${cancel_reason ?? null}, updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `);
    const row = updated.rows[0] as Record<string, unknown>;

    // Cari total pembayaran yang sudah diposting ke jurnal
    const paidRes = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS total FROM sport_payments
      WHERE booking_id = ${id} AND status = 'paid'
    `);
    const amountPaid = Number((paidRes.rows[0] as any).total);

    // Reversal jurnal jika ada pembayaran yang sudah terposting
    let amountReversed = 0;
    if (amountPaid > 0) {
      amountReversed = amountPaid;
      postSportCenterBookingReversal({
        bookingId: id,
        bookingCode: String(booking.booking_number ?? booking.booking_code ?? `BK-${id}`),
        customerName: String(booking.customer_name ?? ""),
        facilityName: String(booking.facility_name ?? ""),
        companyId: booking.company_id != null ? Number(booking.company_id) : null,
      }).catch(() => {});
      // Void PPN Keluaran di transaction_taxes agar laporan pajak tidak over-count
      if (booking.company_id != null) {
        import("../../lib/taxAutoService.js").then(({ reverseTransactionTax }) => {
          void reverseTransactionTax({
            companyId: Number(booking.company_id),
            transactionType: "sport_center",
            transactionId: id,
          });
        }).catch(() => {});
      }
    }

    // Audit log
    await db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (
        ${booking.company_id ?? null},
        'booking',
        ${id},
        'BOOKING_CANCELLED',
        ${createdById},
        ${JSON.stringify({ reason: cancel_reason ?? null, amount_reversed: amountReversed })}::jsonb
      )
    `);

    // Hapus accounting_payments terkait booking ini agar tidak muncul di BizPortal
    try {
      const cancelSpRes = await db.execute(sql`SELECT id FROM sport_payments WHERE booking_id = ${id}`);
      const cancelSpIds = (cancelSpRes.rows as any[]).map((r) => r.id as number);
      if (cancelSpIds.length > 0) {
        await db.execute(sql.raw(
          `DELETE FROM accounting_payments WHERE source_type = 'sport_center' AND source_doc_id = ANY(ARRAY[${cancelSpIds.join(",")}]::int[])`
        ));
      }
    } catch (cancelCleanupErr) {
      // Non-fatal: pembatalan tetap berhasil, tapi log warning untuk investigasi
      console.warn("[sport-center] POST /bookings/:id/cancel accounting_payments cleanup warning:", cancelCleanupErr);
    }

    broadcastSportCenterEvent({ module: "sport-center", entity: "booking", action: "cancelled" as any, data: row, timestamp: new Date().toISOString() }, booking.company_id as number | undefined);
    void syncBookingUpsert(row as any);
    res.json({ ...row, amount_reversed: amountReversed });
  } catch {
    res.status(500).json({ error: "Gagal membatalkan booking" });
  }
});

router.get("/customers", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const search = (req.query.search as string) ?? null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = 50;
    const offset = (page - 1) * limit;
    const searchLike = search ? `%${search}%` : null;

    const [dataRes, countRes] = await Promise.all([
      db.execute(sql`
        SELECT * FROM sport_customers
        WHERE (${cId}::int IS NULL OR company_id = ${cId})
          AND (${searchLike}::text IS NULL OR name ILIKE ${searchLike} OR phone ILIKE ${searchLike})
        ORDER BY name ASC LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM sport_customers
        WHERE (${cId}::int IS NULL OR company_id = ${cId})
          AND (${searchLike}::text IS NULL OR name ILIKE ${searchLike} OR phone ILIKE ${searchLike})
      `),
    ]);

    res.json({ data: dataRes.rows, total: Number((countRes.rows[0] as any).cnt) });
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.post("/customers", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { company_id, name, email, phone, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: "Nama wajib" });
    const r = await db.execute(sql`
      INSERT INTO sport_customers (company_id, name, email, phone, address, notes)
      VALUES (${company_id ?? null}, ${name}, ${email ?? null}, ${phone ?? null}, ${address ?? null}, ${notes ?? null})
      RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.patch("/customers/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const scCustId = Number(req.params.id);
    // IDOR guard
    const scCustLookup = await db.execute(sql`SELECT company_id FROM sport_customers WHERE id = ${scCustId}`);
    if (!scCustLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdScCust = resolveCompanyId(req);
    if (!await assertCompanyAccess((scCustLookup.rows[0] as any).company_id as number | null, cIdScCust, req, res, { resourceType: "sport_customer", resourceId: scCustId })) return;
    const { name, email, phone, address, notes } = req.body;
    const r = await db.execute(sql`
      UPDATE sport_customers SET
        name = COALESCE(${name ?? null}, name),
        email = COALESCE(${email ?? null}, email),
        phone = COALESCE(${phone ?? null}, phone),
        address = COALESCE(${address ?? null}, address),
        notes = COALESCE(${notes ?? null}, notes),
        updated_at = NOW()
      WHERE id = ${scCustId} RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.delete("/customers/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const scDelId = Number(req.params.id);
    // IDOR guard
    const scDelLookup = await db.execute(sql`SELECT company_id, name FROM sport_customers WHERE id = ${scDelId}`);
    if (!scDelLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdScDel = resolveCompanyId(req);
    if (!await assertCompanyAccess((scDelLookup.rows[0] as any).company_id as number | null, cIdScDel, req, res, { resourceType: "sport_customer", resourceId: scDelId })) return;

    const customerName = (scDelLookup.rows[0] as any).name as string | null;
    const customerCompanyId = (scDelLookup.rows[0] as any).company_id as number | null;

    // ── Cascade ke accounting: hapus semua record terkait customer ini ──────
    let accountingCleanupWarning: string | undefined;
    try {
      // 1. Ambil sport_payments IDs & booking IDs milik customer ini
      const [spDirect, bkRes] = await Promise.all([
        db.execute(sql`SELECT id FROM sport_payments WHERE customer_id = ${scDelId}`),
        db.execute(sql`SELECT id FROM sport_bookings WHERE customer_id = ${scDelId}`),
      ]);
      const bkIds = (bkRes.rows as any[]).map((r) => r.id as number);
      const spDirIds = (spDirect.rows as any[]).map((r) => r.id as number);

      let spIds = [...spDirIds];
      if (bkIds.length > 0) {
        const spViaBk = await db.execute(sql`SELECT id FROM sport_payments WHERE booking_id = ANY(${bkIds}::int[])`);
        const extraIds = (spViaBk.rows as any[]).map((r) => r.id as number).filter((id) => !spIds.includes(id));
        spIds = spIds.concat(extraIds);
      }

      // 2a. Hapus accounting_payments via source_doc_id (PAY/ entries dari public.sport_payments)
      if (spIds.length > 0) {
        await db.execute(sql.raw(
          `DELETE FROM accounting_payments WHERE source_type = 'sport_center' AND source_doc_id = ANY(ARRAY[${spIds.join(",")}]::int[])`
        ));
      }

      // 2b. Hapus SCPAY entries (dari canonical sport_center schema) via parameterized query
      //     Difilter strict: payment_number LIKE 'SCPAY%' + partner_name + company_id
      if (customerName && customerCompanyId) {
        await db.execute(sql`
          DELETE FROM accounting_payments
          WHERE source_type = 'sport_center'
            AND company_id = ${customerCompanyId}
            AND payment_number LIKE ${'SCPAY%'}
            AND partner_name = ${customerName}
        `);
      }

      // 3. Void accounting_entries untuk booking customer ini
      //    (source='sport_center_booking'|'sport_center_booking_reversal' → source_id=booking_id)
      //    Void bukan delete — karena ada DB trigger trg_block_posted_delete yang blok hard delete
      if (bkIds.length > 0) {
        await db.execute(sql`
          UPDATE accounting_entries
          SET status = 'voided', voided_at = NOW()
          WHERE source IN ('sport_center_booking', 'sport_center_booking_reversal')
            AND source_id = ANY(${bkIds}::int[])
            AND status = 'posted'
        `);
        // Draft entries boleh langsung dihapus (tidak ada trigger blok untuk draft)
        await db.execute(sql.raw(`
          DELETE FROM accounting_entries
          WHERE source IN ('sport_center_booking', 'sport_center_booking_reversal')
            AND source_id = ANY(ARRAY[${bkIds.join(",")}]::int[])
            AND status = 'draft'
        `)).catch(() => {}); // best-effort: draft mungkin sudah tidak ada
      }

      // 4. Void accounting_entries untuk membership customer ini
      //    (source='sport_center_membership' → source_id=sport_payment_id, bukan booking_id)
      if (spIds.length > 0) {
        await db.execute(sql`
          UPDATE accounting_entries
          SET status = 'voided', voided_at = NOW()
          WHERE source = 'sport_center_membership'
            AND source_id = ANY(${spIds}::int[])
            AND status = 'posted'
        `);
        await db.execute(sql.raw(`
          DELETE FROM accounting_entries
          WHERE source = 'sport_center_membership'
            AND source_id = ANY(ARRAY[${spIds.join(",")}]::int[])
            AND status = 'draft'
        `)).catch(() => {}); // best-effort: draft mungkin sudah tidak ada
      }

      console.log(`[sport-center] DELETE /customers/${scDelId}: accounting cascade selesai. spIds=${spIds.length} bkIds=${bkIds.length}`);
    } catch (cleanupErr) {
      // Accounting cleanup gagal — catat warning tapi customer tetap dihapus
      const msg = (cleanupErr as Error)?.message ?? String(cleanupErr);
      accountingCleanupWarning = `Accounting cleanup partial failure: ${msg}`;
      console.error("[sport-center] DELETE /customers/:id accounting cleanup error:", cleanupErr);
    }

    await db.execute(sql`DELETE FROM sport_customers WHERE id = ${scDelId}`);
    res.json({ success: true, ...(accountingCleanupWarning ? { warning: accountingCleanupWarning } : {}) });
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.get("/members", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const memberType = (req.query.memberType as string) ?? null;
    const status = (req.query.status as string) ?? null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = 50;
    const offset = (page - 1) * limit;

    // Sumber data: sport_center.sport_memberships (gym) + sport_center.ap_members (aqua park)
    // Filter member_type: 'gym' → hanya sport_memberships, 'ap' → hanya ap_members, null/'all' → keduanya
    const includeGym = !memberType || memberType === "gym";
    const includeAp  = !memberType || memberType === "ap";

    // Bangun query UNION ALL — selalu pakai WHERE false untuk branch yang tidak dipilih
    // agar SQL tetap valid tanpa concatenation dinamis
    const gymStatus = status;
    const apStatusActive = status === "active" ? true : status === "inactive" ? false : null;

    const [dataRes, countRes] = await Promise.all([
      db.execute(sql`
        SELECT * FROM (
          SELECT
            'sm-' || id::text AS id,
            id AS source_id,
            'sport_memberships' AS source_table,
            name, email, phone,
            'gym'::text AS member_type,
            'GYM-' || LPAD(id::text, 4, '0') AS member_number,
            start_date, end_date, status::text AS status, notes,
            total_price, payment_method, months,
            created_at,
            CASE
              WHEN start_date IS NOT NULL AND end_date IS NOT NULL
              THEN (
                (EXTRACT(YEAR FROM end_date::date) - EXTRACT(YEAR FROM start_date::date)) * 12
                + (EXTRACT(MONTH FROM end_date::date) - EXTRACT(MONTH FROM start_date::date))
                + 1
              )::int
              ELSE months
            END AS duration_months
          FROM sport_center.sport_memberships
          WHERE ${includeGym}
            AND (${gymStatus}::text IS NULL OR status::text = ${gymStatus})
          UNION ALL
          SELECT
            'ap-' || id::text AS id,
            id AS source_id,
            'ap_members' AS source_table,
            name, email, phone,
            'ap'::text AS member_type,
            'AP-' || LPAD(id::text, 4, '0') AS member_number,
            NULL::text AS start_date, NULL::text AS end_date,
            CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
            NULL::text AS notes, NULL::numeric AS total_price, NULL::text AS payment_method,
            NULL::int AS months, created_at, NULL::int AS duration_months
          FROM sport_center.ap_members
          WHERE ${includeAp}
            AND (${apStatusActive}::boolean IS NULL OR is_active = ${apStatusActive})
        ) combined
        ORDER BY created_at DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT (
          (SELECT COUNT(*) FROM sport_center.sport_memberships
           WHERE ${includeGym}
             AND (${gymStatus}::text IS NULL OR status::text = ${gymStatus}))
          +
          (SELECT COUNT(*) FROM sport_center.ap_members
           WHERE ${includeAp}
             AND (${apStatusActive}::boolean IS NULL OR is_active = ${apStatusActive}))
        ) AS cnt
      `),
    ]);

    const data = (dataRes.rows as any[]).map((m) => ({
      ...m,
      duration: m.duration_months != null ? `${m.duration_months} bulan` : null,
    }));
    res.json({ data, total: Number((countRes.rows[0] as any).cnt) });
  } catch (e) {
    console.error("GET /members error:", e);
    res.status(500).json({ error: "Gagal" });
  }
});

router.post("/members", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { name, email, phone, start_date, end_date, notes, months, total_price, payment_method, status = "active" } = req.body;
    if (!name || !start_date) return res.status(400).json({ error: "Nama dan tanggal mulai wajib" });
    const r = await db.execute(sql`
      INSERT INTO sport_center.sport_memberships (name, email, phone, start_date, end_date, months, total_price, payment_method, status, notes)
      VALUES (${name}, ${email ?? null}, ${phone ?? null}, ${start_date}, ${end_date ?? null},
              ${months ?? null}, ${total_price ?? null}, ${payment_method ?? null}, ${status}::sport_center.membership_status, ${notes ?? null})
      RETURNING *
    `);
    const row = r.rows[0] as Record<string, unknown>;
    broadcastSportCenterEvent({ module: "sport-center", entity: "member", action: "created", data: row, timestamp: new Date().toISOString() });
    res.status(201).json(row);
  } catch (e) {
    console.error("POST /members error:", e);
    res.status(500).json({ error: "Gagal" });
  }
});

router.patch("/members/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const membPatchId = Number(req.params.id);
    const { name, email, phone, start_date, end_date, status, notes, months, total_price, payment_method } = req.body;
    const r = await db.execute(sql`
      UPDATE sport_center.sport_memberships SET
        name = COALESCE(${name ?? null}, name),
        email = COALESCE(${email ?? null}, email),
        phone = COALESCE(${phone ?? null}, phone),
        start_date = COALESCE(${start_date ?? null}, start_date),
        end_date = COALESCE(${end_date ?? null}, end_date),
        status = COALESCE(${status ?? null}::sport_center.membership_status, status),
        notes = COALESCE(${notes ?? null}, notes),
        months = COALESCE(${months ?? null}, months),
        total_price = COALESCE(${total_price ?? null}, total_price),
        payment_method = COALESCE(${payment_method ?? null}, payment_method),
        updated_at = NOW()
      WHERE id = ${membPatchId} RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const row = r.rows[0] as Record<string, unknown>;
    broadcastSportCenterEvent({ module: "sport-center", entity: "member", action: "updated", data: row, timestamp: new Date().toISOString() });
    res.json(row);
  } catch (e) {
    console.error("PATCH /members/:id error:", e);
    res.status(500).json({ error: "Gagal" });
  }
});

router.delete("/members/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const membDelId = Number(req.params.id);
    // Cek record ada di sport_center.sport_memberships
    const membDelLookup = await db.execute(sql`SELECT id FROM sport_center.sport_memberships WHERE id = ${membDelId}`);
    if (!membDelLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });

    await db.execute(sql`DELETE FROM sport_center.sport_memberships WHERE id = ${membDelId}`);
    broadcastSportCenterEvent({ module: "sport-center", entity: "member", action: "deleted", data: { id: membDelId }, timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (e) {
    console.error("DELETE /members/:id error:", e);
    res.status(500).json({ error: "Gagal" });
  }
});

// ── MEMBERSHIP PAYMENT ────────────────────────────────────────────────────────

router.post("/members/:id/payment", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const memberId = Number(String(req.params.id));
    if (isNaN(memberId)) return res.status(400).json({ error: "ID member tidak valid" });

    const { amount, payment_method = "cash", notes } = req.body as {
      amount: unknown;
      payment_method?: string;
      notes?: string;
    };
    const normalizedPaymentMethod = normalizePaymentMethod(payment_method) ?? "cash";

    // Validasi amount
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount wajib diisi dan harus lebih dari 0" });
    }

    // Cek member
    const memberRes = await db.execute(sql`
      SELECT * FROM sport_members WHERE id = ${memberId} LIMIT 1
    `);
    if (!memberRes.rows.length) return res.status(404).json({ error: "Member tidak ditemukan" });
    const member = memberRes.rows[0] as Record<string, unknown>;
    // IDOR guard
    const cIdMembPay = resolveCompanyId(req);
    if (!await assertCompanyAccess(member["company_id"] as number | null, cIdMembPay, req, res, { resourceType: "sport_member", resourceId: memberId })) return;

    if (member.status !== "active") {
      return res.status(400).json({ error: `Member tidak aktif (status: ${member.status})` });
    }
    if (!member.company_id) {
      return res.status(400).json({ error: "company_id member tidak tersedia" });
    }

    const companyId = Number(member.company_id);
    const paymentNumber = await nextPaymentNumber(companyId);
    const actorId = (req.user as { id: string } | undefined)?.id ?? null;

    // Atomic transaction: INSERT sport_payments + accounting (THROWS on missing COA/journal).
    let payment: Record<string, unknown>;
    let membershipAcctResult: { entryId: number; paymentId: number; skipped: boolean };
    try {
      const txResult = await db.transaction(async (tx) => {
        const payRes = await tx.execute(sql`
          INSERT INTO sport_payments
            (company_id, payment_number, payment_type, member_id, customer_id, amount, method, status, paid_at, notes, created_by)
          VALUES
            (${companyId}, ${paymentNumber}, 'membership', ${memberId},
             ${member.customer_id ?? null}, ${amt}, ${normalizedPaymentMethod}, 'paid', NOW(),
             ${notes ?? null}, ${actorId})
          RETURNING *
        `);
        const row = payRes.rows[0] as Record<string, unknown>;

        const acct = await postSportCenterPaymentAtomic(tx as unknown as SportDbClient, {
          paymentId:    Number(row.id),
          paymentNumber,
          type:         "membership",
          sourceId:     Number(row.id),   // membership idempotency = sport_payments.id
          sourceRef:    String(member.member_number ?? paymentNumber),
          customerName: String(member.name ?? ""),
          memberNumber: String(member.member_number ?? `MBR-${memberId}`),
          amount:       amt,
           method:       normalizedPaymentMethod,
          date:         new Date().toISOString().slice(0, 10),
          companyId,
          createdById:  actorId,
        });

        return { row, acct };
      });

      payment            = txResult.row;
      membershipAcctResult = txResult.acct;
    } catch (txErr: unknown) {
      const detail = txErr instanceof Error ? txErr.message : String(txErr);
      console.error("[sport-center] membership payment transaction failed:", detail);
      const isConfigError = detail.startsWith("COA_MISSING:") || detail.startsWith("JOURNAL_MISSING:");
      return res.status(isConfigError ? 422 : 500).json({
        error: isConfigError ? "Konfigurasi akuntansi belum lengkap" : "Gagal memproses pembayaran membership",
        detail,
        posting_status: "failed",
      });
    }

    // Audit log — fire-and-forget, outside transaction
    db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (
        ${companyId}, 'member', ${memberId},
        'MEMBERSHIP_PAYMENT_CREATED', ${actorId},
        ${JSON.stringify({ member_id: memberId, amount: amt, payment_method: normalizedPaymentMethod, payment_number: paymentNumber, entry_id: membershipAcctResult.entryId })}::jsonb
      )
    `).catch((err: unknown) => console.error("[sport-center] audit log (membership) failed:", err));

    broadcastSportCenterEvent(
      { module: "sport-center", entity: "payment", action: "created", data: payment, timestamp: new Date().toISOString() },
      companyId,
    );
    res.status(201).json(payment);
  } catch (err) {
    console.error("[membership payment]", err);
    res.status(500).json({ error: "Gagal memproses pembayaran membership" });
  }
});

router.get("/pricing-rules", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : null;
    const r = await db.execute(sql`
      SELECT pr.*, sf.name AS facility_name FROM sport_pricing_rules pr
      LEFT JOIN sport_facilities sf ON pr.facility_id = sf.id
      WHERE (${cId}::int IS NULL OR pr.company_id = ${cId})
        AND (${facilityId}::int IS NULL OR pr.facility_id = ${facilityId})
      ORDER BY pr.facility_id ASC, pr.time_start ASC
    `);
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.post("/pricing-rules", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { company_id, facility_id, name, day_type = "all", time_start, time_end, price_per_hour, is_active = true } = req.body;
    if (!facility_id || !name || price_per_hour === undefined) return res.status(400).json({ error: "Field wajib tidak lengkap" });
    const r = await db.execute(sql`
      INSERT INTO sport_pricing_rules (company_id, facility_id, name, day_type, time_start, time_end, price_per_hour, is_active)
      VALUES (${company_id ?? null}, ${facility_id}, ${name}, ${day_type}, ${time_start ?? null}, ${time_end ?? null}, ${price_per_hour}, ${is_active})
      RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.patch("/pricing-rules/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const prId = Number(req.params.id);
    // IDOR guard
    const prLookup = await db.execute(sql`SELECT company_id FROM sport_pricing_rules WHERE id = ${prId}`);
    if (!prLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdPr = resolveCompanyId(req);
    if (!await assertCompanyAccess((prLookup.rows[0] as any).company_id as number | null, cIdPr, req, res, { resourceType: "sport_pricing_rule", resourceId: prId })) return;
    const { name, day_type, time_start, time_end, price_per_hour, is_active } = req.body;
    const r = await db.execute(sql`
      UPDATE sport_pricing_rules SET
        name = COALESCE(${name ?? null}, name),
        day_type = COALESCE(${day_type ?? null}, day_type),
        time_start = COALESCE(${time_start ?? null}::time, time_start),
        time_end = COALESCE(${time_end ?? null}::time, time_end),
        price_per_hour = COALESCE(${price_per_hour ?? null}::numeric, price_per_hour),
        is_active = COALESCE(${is_active ?? null}::boolean, is_active),
        updated_at = NOW()
      WHERE id = ${prId} RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.delete("/pricing-rules/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    await db.execute(sql`DELETE FROM sport_pricing_rules WHERE id = ${Number(String(req.params.id))}`);
    const prDelId = Number(req.params.id);
    // IDOR guard
    const prDelLookup = await db.execute(sql`SELECT company_id FROM sport_pricing_rules WHERE id = ${prDelId}`);
    if (!prDelLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdPrDel = resolveCompanyId(req);
    if (!await assertCompanyAccess((prDelLookup.rows[0] as any).company_id as number | null, cIdPrDel, req, res, { resourceType: "sport_pricing_rule", resourceId: prDelId })) return;
    await db.execute(sql`DELETE FROM sport_pricing_rules WHERE id = ${prDelId}`);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

// ── PROMO ────────────────────────────────────────────────────────────────────

router.get("/promos", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const result = await db.execute(sql`
      SELECT * FROM sport_promos
      WHERE (${cId}::int IS NULL OR company_id = ${cId})
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.post("/promos", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const {
      company_id, code, name, description,
      discount_type = "percentage", discount_value,
      min_amount = 0, max_uses, valid_from, valid_until, is_active = true,
    } = req.body;
    if (!code || !name || discount_value == null) {
      return res.status(400).json({ error: "code, name, dan discount_value wajib" });
    }
    if (!["percentage", "percent", "fixed"].includes(discount_type)) {
      return res.status(400).json({ error: "discount_type harus 'percentage' atau 'fixed'" });
    }
    if (Number(discount_value) < 0) {
      return res.status(400).json({ error: "discount_value tidak boleh negatif" });
    }
    if (discount_type !== "fixed" && Number(discount_value) > 100) {
      return res.status(400).json({ error: "discount_value persentase tidak boleh melebihi 100" });
    }
    // Normalisasi: simpan sebagai 'percent' agar konsisten dengan schema default
    const dtype = discount_type === "fixed" ? "fixed" : "percent";
    // Cek keunikan code per company
    const cId = company_id ?? null;
    const dupCheck = await db.execute(sql`
      SELECT id FROM sport_promos WHERE code = ${code} AND (${cId}::int IS NULL OR company_id = ${cId}) LIMIT 1
    `);
    if (dupCheck.rows.length) {
      return res.status(409).json({ error: "Kode promo sudah digunakan" });
    }
    const r = await db.execute(sql`
      INSERT INTO sport_promos (company_id, code, name, description, discount_type, discount_value, min_amount, max_uses, valid_from, valid_until, is_active)
      VALUES (${cId}, ${code}, ${name}, ${description ?? null}, ${dtype}, ${Number(discount_value)}, ${Number(min_amount)}, ${max_uses ?? null}, ${valid_from ?? null}, ${valid_until ?? null}, ${is_active})
      RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal membuat promo" });
  }
});

router.patch("/promos/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const promoLookup = await db.execute(sql`SELECT company_id FROM sport_promos WHERE id = ${id}`);
    if (!promoLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdPromo = resolveCompanyId(req);
    if (!await assertCompanyAccess((promoLookup.rows[0] as any).company_id as number | null, cIdPromo, req, res, { resourceType: "sport_promo", resourceId: id })) return;
    const { code, name, description, discount_type, discount_value, min_amount, max_uses, valid_from, valid_until, is_active } = req.body;
    if (discount_type != null && !["percentage", "percent", "fixed"].includes(discount_type)) {
      return res.status(400).json({ error: "discount_type harus 'percentage' atau 'fixed'" });
    }
    const dtype = discount_type === "fixed" ? "fixed" : discount_type != null ? "percent" : null;
    const r = await db.execute(sql`
      UPDATE sport_promos SET
        code         = COALESCE(${code ?? null}, code),
        name         = COALESCE(${name ?? null}, name),
        description  = COALESCE(${description ?? null}, description),
        discount_type  = COALESCE(${dtype}, discount_type),
        discount_value = COALESCE(${discount_value ?? null}::numeric, discount_value),
        min_amount   = COALESCE(${min_amount ?? null}::numeric, min_amount),
        max_uses     = COALESCE(${max_uses ?? null}::int, max_uses),
        valid_from   = COALESCE(${valid_from ?? null}::timestamptz, valid_from),
        valid_until  = COALESCE(${valid_until ?? null}::timestamptz, valid_until),
        is_active    = COALESCE(${is_active ?? null}::boolean, is_active),
        updated_at   = NOW()
      WHERE id = ${id} RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal memperbarui promo" });
  }
});

router.delete("/promos/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const promoDelLookup = await db.execute(sql`SELECT company_id FROM sport_promos WHERE id = ${id}`);
    if (!promoDelLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdPromoDel = resolveCompanyId(req);
    if (!await assertCompanyAccess((promoDelLookup.rows[0] as any).company_id as number | null, cIdPromoDel, req, res, { resourceType: "sport_promo", resourceId: id })) return;
    // Soft delete jika sudah dipakai di booking, hard delete jika belum
    const usedRes = await db.execute(sql`SELECT id FROM sport_bookings WHERE promo_id = ${id} LIMIT 1`);
    if (usedRes.rows.length) {
      await db.execute(sql`UPDATE sport_promos SET is_active = FALSE, updated_at = NOW() WHERE id = ${id}`);
      res.json({ success: true, note: "Promo dinonaktifkan karena sudah dipakai di booking" });
    } else {
      await db.execute(sql`DELETE FROM sport_promos WHERE id = ${id}`);
      res.json({ success: true });
    }
  } catch {
    res.status(500).json({ error: "Gagal menghapus promo" });
  }
});

router.get("/payments", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = 50;
    const offset = (page - 1) * limit;

    const statusFilter = req.query.status ? String(req.query.status) : null;
    const dateFrom = req.query.date_from ? String(req.query.date_from) : null;
    const dateTo   = req.query.date_to   ? String(req.query.date_to)   : null;
    const search   = req.query.search    ? String(req.query.search).trim() : null;
    const searchPattern = search ? `%${search}%` : null;

    // PAYMENT SOURCE: UNION dari dua sumber:
    //   1. sport_center.sport_payments (canonical — dari aplikasi Sport Center asli)
    //   2. public.sport_payments WHERE payment_number NOT LIKE 'SCPAY-%' (BizPortal-created, belum ada di canonical)
    // Payments dengan prefix SCPAY- di public.sport_payments adalah mirror dari sport_center.sport_payments → tidak di-UNION ulang.
    console.log(`[PAYMENT SOURCE] GET /payments page=${page} status=${statusFilter} dateFrom=${dateFrom} dateTo=${dateTo} search=${search ?? '-'}`);
    const [dataRes, countRes, revenueRes] = await Promise.all([
      db.execute(sql`
        WITH
        sc_pay AS (
          -- Sumber 1: canonical sport_center.sport_payments
          -- Semua field di-cast ke text/numeric/timestamptz agar UNION type-safe
          SELECT
            p.id::int                                      AS id,
            ('SCPAY-' || p.id::text)::text                AS payment_number,
            mirror.id::int                                 AS local_payment_id,
            p.booking_id::int                              AS sc_booking_id,
            b.order_number::text                           AS booking_number,
            b.customer_name::text                          AS customer_name,
            b.booking_date::date                           AS booking_date,
            COALESCE(f.name, '')::text                     AS facility_name,
            p.amount::numeric                              AS amount,
            p.payment_method::text                         AS method,
            COALESCE(local_b.tax_rate, 0)::numeric          AS tax_rate,
            COALESCE(local_b.tax_amount, 0)::numeric       AS tax_amount,
            COALESCE(mirror.mdr_rate, 0)::numeric          AS mdr_rate,
            COALESCE(mirror.mdr_amount, 0)::numeric        AS mdr_amount,
            GREATEST(0, p.amount - COALESCE(mirror.mdr_amount, 0))::numeric AS net_amount,
            mirror.settlement_reference::text              AS settlement_reference,
            mirror.settlement_date::date                   AS settlement_date,
            COALESCE(mirror.settlement_status, 'unsettled')::text AS settlement_status,
            COALESCE(mirror.mdr_posting_status, 'unposted')::text AS mdr_posting_status,
            mirror.mdr_accounting_entry_id::int             AS mdr_accounting_entry_id,
            mirror.mdr_posting_error::text                  AS mdr_posting_error,
            CASE
              WHEN lower(p.status::text) IN ('confirmed','paid','settlement','capture') THEN 'paid'
              ELSE 'pending'
            END::text                                      AS status,
            p.status::text                                 AS raw_status,
            COALESCE(p.confirmed_at, p.created_at)::timestamptz AS paid_at,
            p.created_at::timestamptz                      AS created_at,
            'canonical'::text                              AS source,
            NULL::integer                                  AS bank_account_id,
            NULL::text                                     AS bank_account_name
          FROM sport_center.sport_payments p
          LEFT JOIN sport_center.sport_bookings  b ON b.id = p.booking_id
          LEFT JOIN sport_center.sport_facilities f ON f.id = b.facility_id
          LEFT JOIN public.sport_payments mirror ON mirror.payment_number = ('SCPAY-' || p.id::text)
          LEFT JOIN public.sport_bookings local_b ON local_b.sc_booking_id = p.booking_id
        ),
        bz_pay AS (
          -- Sumber 2: BizPortal-created payments (bukan mirror dari sport_center)
          -- payment_number NOT LIKE 'SCPAY-%' = dibuat via POST /payments BizPortal
          SELECT
            sp.id::int                                     AS id,
            sp.payment_number::text,
            sp.id::int                                     AS local_payment_id,
            sb.sc_booking_id::int,
            sb.booking_number::text                        AS booking_number,
            sb.customer_name::text                         AS customer_name,
            sb.booking_date::date                          AS booking_date,
            COALESCE(sf.name, sb.facility_name, '')::text  AS facility_name,
            sp.amount::numeric                             AS amount,
            sp.method::text                                AS method,
            COALESCE(sb.tax_rate, 0)::numeric               AS tax_rate,
            COALESCE(sb.tax_amount, 0)::numeric             AS tax_amount,
            COALESCE(sp.mdr_rate, 0)::numeric               AS mdr_rate,
            COALESCE(sp.mdr_amount, 0)::numeric             AS mdr_amount,
            GREATEST(0, sp.amount - COALESCE(sp.mdr_amount, 0))::numeric AS net_amount,
            sp.settlement_reference::text                   AS settlement_reference,
            sp.settlement_date::date                        AS settlement_date,
            COALESCE(sp.settlement_status, 'unsettled')::text AS settlement_status,
            COALESCE(sp.mdr_posting_status, 'unposted')::text AS mdr_posting_status,
            sp.mdr_accounting_entry_id::int                 AS mdr_accounting_entry_id,
            sp.mdr_posting_error::text                      AS mdr_posting_error,
            sp.status::text                                AS status,
            sp.status::text                                AS raw_status,
            COALESCE(sp.paid_at, sp.created_at)::timestamptz AS paid_at,
            sp.created_at::timestamptz                     AS created_at,
            'bizportal_mirror'::text                       AS source,
            sp.bank_account_id::integer                    AS bank_account_id,
            cba.name::text                                 AS bank_account_name
          FROM public.sport_payments sp
          LEFT JOIN public.sport_bookings  sb ON sb.id = sp.booking_id
          LEFT JOIN public.sport_facilities sf ON sf.id = sb.facility_id
          LEFT JOIN public.company_bank_accounts cba ON cba.id = sp.bank_account_id
          WHERE sp.payment_number NOT LIKE 'SCPAY-%'
        ),
        combined AS (
          SELECT * FROM sc_pay
          UNION ALL
          SELECT * FROM bz_pay
        )
        SELECT * FROM combined
        WHERE (${statusFilter}::text IS NULL OR status = ${statusFilter})
          AND (${dateFrom}::date IS NULL OR paid_at::date >= ${dateFrom}::date)
          AND (${dateTo}::date   IS NULL OR paid_at::date <= ${dateTo}::date)
          AND (${searchPattern}::text IS NULL
               OR booking_number ILIKE ${searchPattern}
               OR customer_name  ILIKE ${searchPattern}
               OR payment_number ILIKE ${searchPattern}
               OR facility_name  ILIKE ${searchPattern})
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM (
          SELECT
            CASE WHEN lower(p.status::text) IN ('confirmed','paid','settlement','capture') THEN 'paid' ELSE 'pending' END::text AS status,
            COALESCE(p.confirmed_at, p.created_at)::timestamptz AS paid_at,
            b.order_number::text AS booking_number,
            b.customer_name::text AS customer_name,
            COALESCE(f.name,'')::text AS facility_name
          FROM sport_center.sport_payments p
          LEFT JOIN sport_center.sport_bookings  b ON b.id = p.booking_id
          LEFT JOIN sport_center.sport_facilities f ON f.id = b.facility_id
          UNION ALL
          SELECT
            sp.status::text,
            COALESCE(sp.paid_at, sp.created_at)::timestamptz,
            sb.booking_number::text,
            sb.customer_name::text,
            COALESCE(sf.name, sb.facility_name,'')::text
          FROM public.sport_payments sp
          LEFT JOIN public.sport_bookings  sb ON sb.id = sp.booking_id
          LEFT JOIN public.sport_facilities sf ON sf.id = sb.facility_id
          WHERE sp.payment_number NOT LIKE 'SCPAY-%'
        ) u
        WHERE (${statusFilter}::text IS NULL OR status = ${statusFilter})
          AND (${dateFrom}::date IS NULL OR paid_at::date >= ${dateFrom}::date)
          AND (${dateTo}::date   IS NULL OR paid_at::date <= ${dateTo}::date)
          AND (${searchPattern}::text IS NULL
               OR booking_number ILIKE ${searchPattern}
               OR customer_name  ILIKE ${searchPattern}
               OR facility_name  ILIKE ${searchPattern})
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(amount), 0) AS total_revenue FROM (
          SELECT
            CASE WHEN lower(p.status::text) IN ('confirmed','paid','settlement','capture') THEN 'paid' ELSE 'pending' END::text AS status,
            p.amount::numeric AS amount,
            COALESCE(p.confirmed_at, p.created_at)::timestamptz AS paid_at,
            b.order_number::text AS booking_number,
            b.customer_name::text AS customer_name,
            COALESCE(f.name,'')::text AS facility_name
          FROM sport_center.sport_payments p
          LEFT JOIN sport_center.sport_bookings  b ON b.id = p.booking_id
          LEFT JOIN sport_center.sport_facilities f ON f.id = b.facility_id
          UNION ALL
          SELECT
            sp.status::text,
            sp.amount::numeric,
            COALESCE(sp.paid_at, sp.created_at)::timestamptz,
            sb.booking_number::text,
            sb.customer_name::text,
            COALESCE(sf.name, sb.facility_name,'')::text
          FROM public.sport_payments sp
          LEFT JOIN public.sport_bookings  sb ON sb.id = sp.booking_id
          LEFT JOIN public.sport_facilities sf ON sf.id = sb.facility_id
          WHERE sp.payment_number NOT LIKE 'SCPAY-%'
        ) u
        WHERE status = 'paid'
          AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
          AND (${dateFrom}::date IS NULL OR paid_at::date >= ${dateFrom}::date)
          AND (${dateTo}::date   IS NULL OR paid_at::date <= ${dateTo}::date)
          AND (${searchPattern}::text IS NULL
               OR booking_number ILIKE ${searchPattern}
               OR customer_name  ILIKE ${searchPattern}
               OR facility_name  ILIKE ${searchPattern})
      `),
    ]);
    const rows = dataRes.rows as Array<Record<string, unknown>>;
    const canonicalCount = rows.filter(r => r.source === 'canonical').length;
    const bizportalCount = rows.filter(r => r.source === 'bizportal_mirror').length;
    console.log(`[PAYMENT SOURCE] → ${rows.length} total | canonical=${canonicalCount} bizportal_mirror=${bizportalCount}`);
    if (bizportalCount > 0) {
      console.log(`[PAYMENT UNION FALLBACK] ${bizportalCount} BizPortal payment(s) disertakan dari public.sport_payments`);
    }
    res.json({
      data: rows,
      total: Number((countRes.rows[0] as any).cnt),
      totalRevenue: Number((revenueRes.rows[0] as any).total_revenue ?? 0),
    });
  } catch (err: any) {
    console.error("[sport-center] GET /payments error:", err?.message);
    res.status(500).json({ error: "Gagal" });
  }
});

router.post("/payments", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const {
      booking_id,
      notes,
      payment_date,
    } = req.body;
    // Terima amount ATAU total_amount (alias)
    const amount = req.body.amount ?? req.body.total_amount;
    // Terima payment_method ATAU method (alias), default cash
    const finalMethod: string = normalizePaymentMethod(req.body.payment_method ?? req.body.method) ?? "cash";
    // Rekening bank tujuan (wajib untuk metode non-tunai agar rekonsiliasi bank berfungsi)
    const bankAccountId: number | null =
      req.body.bank_account_id != null ? Number(req.body.bank_account_id) : null;

    if (!booking_id || !amount) {
      return res.status(400).json({ error: "booking_id dan amount wajib" });
    }

    // 1. Fetch booking DULU agar company_id benar (bukan dari req.body)
    const bookingRes = await db.execute(sql`
      SELECT id, booking_number, customer_name, customer_email, customer_phone,
             facility_id, facility_name, booking_date, start_time, end_time,
             duration_hours, base_amount, total_amount, tax_rate, tax_amount,
             status, payment_status, company_id, notes
      FROM sport_bookings WHERE id = ${booking_id} LIMIT 1
    `);
    if (!bookingRes.rows.length) {
      return res.status(404).json({ error: "Booking tidak ditemukan" });
    }
    const b = bookingRes.rows[0] as Record<string, unknown>;
    const bCompanyId: number = b.company_id != null ? Number(b.company_id) : 1;
    const bTaxRate = Number(b.tax_rate ?? 0);
    const bTaxAmount = Number(b.tax_amount ?? 0);
    const bTotalAmount = Number(b.total_amount ?? amount);
    const bBookingDate = String(b.booking_date ?? new Date().toISOString().slice(0, 10));
    const bCode = String(b.booking_number ?? "");
    const bCustomer = String(b.customer_name ?? "");
    const bFacility = String(b.facility_name ?? "");
    const createdById = (req.user as { id: string } | undefined)?.id ?? null;

    // Validasi payment_date — gunakan sebagai tanggal efektif accounting jika valid
    const isValidDate = payment_date && /^\d{4}-\d{2}-\d{2}$/.test(payment_date);
    const paidAt = isValidDate ? `${payment_date}T00:00:00Z` : null; // null → NOW() di SQL
    const effectiveDate = isValidDate ? (payment_date as string) : bBookingDate;
    // Tanggal untuk accounting: payment_date jika valid, atau hari ini — BUKAN booking_date
    // Ini penting agar KPI revenue_today dan Finance → Payments menampilkan data yang benar
    const paymentAccountingDate: string = isValidDate ? (payment_date as string) : new Date().toISOString().slice(0, 10);

    // 2. Generate payment number dengan company_id yang benar
    const paymentNumber = await nextPaymentNumber(bCompanyId);

    // 3–5. Atomic transaction: INSERT sport_payments + UPDATE sport_bookings + accounting.
    // All three commit/roll back together — no split-brain possible.
    let payRow: Record<string, unknown>;
    let accountingResult: { entryId: number; paymentId: number; skipped: boolean };
    try {
      const txResult = await db.transaction(async (tx) => {
        // 3. Insert sport_payments
        const r = await tx.execute(sql`
          INSERT INTO sport_payments
            (company_id, booking_id, payment_number, amount, method, status,
             paid_at, notes, source, payment_type, bank_account_id, tax_rate, tax_amount)
          VALUES
            (${bCompanyId}, ${booking_id}, ${paymentNumber}, ${amount}, ${finalMethod},
             'paid', COALESCE(${paidAt}::timestamptz, NOW()), ${notes ?? null},
             'SPORT_CENTER', 'booking', ${bankAccountId}, ${bTaxRate}, ${bTaxAmount})
          RETURNING *
        `);
        const row = r.rows[0] as Record<string, unknown>;

        // 4. Update sport_bookings.payment_status = 'paid'
        await tx.execute(sql`
          UPDATE sport_bookings
          SET payment_status = 'paid', updated_at = NOW()
          WHERE id = ${booking_id}
        `);

        // 5. Post journal + accounting_payments atomically (THROWS on missing COA/journal)
        const acct = await postSportCenterPaymentAtomic(tx as unknown as SportDbClient, {
          paymentId:    Number(row.id),
          paymentNumber,
          type:         "booking",
          sourceId:     Number(booking_id),
          sourceRef:    bCode,
          customerName: bCustomer,
          facilityName: bFacility,
          amount:       bTotalAmount,
          method:       finalMethod,
          date:         paymentAccountingDate,
          companyId:    bCompanyId,
          createdById,
        });

        return { row, acct };
      });

      payRow = txResult.row;
      accountingResult = txResult.acct;
    } catch (txErr: unknown) {
      const detail = txErr instanceof Error ? txErr.message : String(txErr);
      console.error("[sport-center] POST /payments transaction failed:", detail);
      const isConfigError = detail.startsWith("COA_MISSING:") || detail.startsWith("JOURNAL_MISSING:");
      return res.status(isConfigError ? 422 : 500).json({
        error: isConfigError ? "Konfigurasi akuntansi belum lengkap" : "Gagal mencatat pembayaran",
        detail,
        posting_status: "failed",
      });
    }

    // 6. Supabase sync — fire-and-forget, outside transaction
    void syncBookingUpsert({
      id: Number(b.id),
      booking_number: bCode,
      customer_name: bCustomer,
      customer_email: b.customer_email as string | null,
      customer_phone: b.customer_phone as string | null,
      facility_id: b.facility_id != null ? Number(b.facility_id) : null,
      facility_name: bFacility,
      booking_date: bBookingDate,
      start_time: String(b.start_time ?? ""),
      end_time: String(b.end_time ?? ""),
      duration_hours: b.duration_hours != null ? Number(b.duration_hours) : undefined,
      base_amount: b.base_amount != null ? Number(b.base_amount) : undefined,
      total_amount: bTotalAmount,
      status: String(b.status ?? "confirmed"),
      payment_status: "paid",
      notes: b.notes as string | null,
      company_id: bCompanyId,
    });

    // 7. Tax Engine hook — DPP = total × 100/111 (inklusif PPN 11%) — fire-and-forget
    import("../../lib/taxAutoService.js").then(({ recordTransactionTax }) => {
      const dppForTax = Math.round(bTotalAmount * 100 / 111 * 100) / 100;
      void recordTransactionTax({
        companyId: bCompanyId ?? 1,
        transactionType: "sport_center",
        transactionId: Number(booking_id),
        transactionRef: bCode,
        baseAmount: dppForTax,
      });
    }).catch(() => {/* ignore */});

    // 8. Audit log — fire-and-forget
    db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (
        ${bCompanyId}, 'payment', ${payRow.id ?? null},
        'PAYMENT_CREATED', ${createdById},
        ${JSON.stringify({
          booking_id,
          amount: Number(amount),
          method: finalMethod,
          payment_number: paymentNumber,
          source: 'SPORT_CENTER',
          payment_date: effectiveDate,
          entry_id: accountingResult.entryId,
          acct_payment_id: accountingResult.paymentId,
        })}::jsonb
      )
    `).catch((err: unknown) => console.error('[sport-center] audit log failed:', err));

    broadcastSportCenterEvent(
      { module: "sport-center", entity: "payment", action: "created", data: payRow, timestamp: new Date().toISOString() },
      bCompanyId,
    );
    res.status(201).json(payRow);
  } catch (err) {
    console.error('[sport-center] POST /payments error:', err);
    res.status(500).json({ error: "Gagal mencatat pembayaran" });
  }
});

// ── EDIT PAYMENT (update method + bank_account_id saja, amount tidak boleh diubah) ────
router.patch("/payments/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    // Ambil data payment sekarang
    const existing = await db.execute(sql`
      SELECT id, company_id, method, bank_account_id,
             amount, mdr_rate, mdr_amount, mdr_posting_status
      FROM sport_payments
      WHERE id = ${id}
      LIMIT 1
    `);
    if (!existing.rows.length) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    const row = existing.rows[0] as Record<string, unknown>;

    // Validasi akses company
    const reqCompanyId = resolveCompanyId(req);
    if (!await assertCompanyAccess(
      row.company_id != null ? Number(row.company_id) : null,
      reqCompanyId, req, res,
      { resourceType: "sport_payment", resourceId: id },
    )) return;

    const newMethod: string | undefined = req.body.method != null
      ? (normalizePaymentMethod(String(req.body.method)) ?? "cash")
      : undefined;
    const newBankAccountId: number | null =
      req.body.bank_account_id != null
        ? (req.body.bank_account_id === "" ? null : Number(req.body.bank_account_id))
        : undefined as unknown as null;
    const newMdrRate: number | undefined = req.body.mdr_rate != null && req.body.mdr_rate !== ""
      ? Number(req.body.mdr_rate) : undefined;
    const newMdrAmount: number | undefined = req.body.mdr_amount != null && req.body.mdr_amount !== ""
      ? Number(req.body.mdr_amount) : undefined;
    const newSettlementReference: string | undefined =
      req.body.settlement_reference != null ? String(req.body.settlement_reference).trim() : undefined;
    const newSettlementDate: string | null | undefined =
      req.body.settlement_date != null
        ? (req.body.settlement_date === "" ? null : String(req.body.settlement_date))
        : undefined;
    const newSettlementStatus: string | undefined =
      req.body.settlement_status != null ? String(req.body.settlement_status) : undefined;

    if (newMdrRate !== undefined && (!Number.isFinite(newMdrRate) || newMdrRate < 0 || newMdrRate > 100)) {
      return res.status(400).json({ error: "mdr_rate harus antara 0 dan 100" });
    }
    if (newMdrAmount !== undefined && (!Number.isFinite(newMdrAmount) || newMdrAmount < 0 || newMdrAmount > Number(row.amount))) {
      return res.status(400).json({ error: "mdr_amount tidak valid" });
    }
    if ((newMdrRate !== undefined || newMdrAmount !== undefined)
      && String(row.mdr_posting_status ?? "unposted") === "posted") {
      return res.status(409).json({ error: "MDR sudah diposting dan tidak dapat diubah; buat jurnal pembalik terlebih dahulu" });
    }

    // Bangun SET clause dinamis
    const sets: string[] = ["updated_at = NOW()"];
    if (newMethod !== undefined)       sets.push(`method = '${newMethod.replace(/'/g, "''")}'`);
    if (newBankAccountId !== undefined) sets.push(`bank_account_id = ${newBankAccountId ?? "NULL"}`);
    if (newMdrRate !== undefined)       sets.push(`mdr_rate = ${newMdrRate}`);
    if (newMdrAmount !== undefined) {
      sets.push(`mdr_amount = ${newMdrAmount}`);
      sets.push(`net_amount = GREATEST(0, amount - ${newMdrAmount})`);
      sets.push(`mdr_posting_status = 'unposted'`);
      sets.push(`mdr_posting_error = NULL`);
      sets.push(`mdr_accounting_entry_id = NULL`);
      sets.push(`mdr_posted_at = NULL`);
    }
    if (newSettlementReference !== undefined) {
      sets.push(`settlement_reference = '${newSettlementReference.replace(/'/g, "''")}'`);
    }
    if (newSettlementDate !== undefined) {
      sets.push(`settlement_date = ${newSettlementDate == null ? "NULL" : `'${newSettlementDate.replace(/'/g, "''")}'::date`}`);
    }
    if (newSettlementStatus !== undefined) {
      if (!["unsettled", "settled", "partial", "exception"].includes(newSettlementStatus)) {
        return res.status(400).json({ error: "settlement_status tidak valid" });
      }
      sets.push(`settlement_status = '${newSettlementStatus}'`);
    }

    if (sets.length === 1) return res.status(400).json({ error: "Tidak ada field yang diubah" });

    const updated = await db.execute(sql.raw(`
      UPDATE sport_payments SET ${sets.join(", ")}
      WHERE id = ${id}
      RETURNING id, payment_number, method, bank_account_id, amount, status, paid_at, notes,
                tax_rate, tax_amount, mdr_rate, mdr_amount, net_amount,
                settlement_reference, settlement_date, settlement_status,
                mdr_posting_status, mdr_accounting_entry_id, mdr_posting_error
    `));

    // Audit log
    db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (
        ${row.company_id != null ? Number(row.company_id) : null},
        'payment', ${id}, 'PAYMENT_UPDATED',
        ${(req.user as { id: string } | undefined)?.id ?? null},
        ${JSON.stringify({ method: newMethod, bank_account_id: newBankAccountId })}::jsonb
      )
    `).catch(() => {});

    res.json(updated.rows[0]);
  } catch (err: any) {
    console.error("[sport-center] PATCH /payments/:id error:", err?.message);
    res.status(500).json({ error: "Gagal menyimpan perubahan" });
  }
});

// ── POST MDR JOURNAL (QRIS settlement adjustment) ───────────────────────────
// Gross payment remains unchanged. This entry reduces bank by MDR:
// Debit  5-3050 Biaya MDR
// Credit Bank QRIS
router.post("/payments/:id/mdr/post", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID tidak valid" });

  try {
    const paymentRes = await db.execute(sql`
      SELECT sp.id, sp.company_id, sp.payment_number, sp.amount, sp.method,
             sp.mdr_amount, sp.mdr_posting_status, sp.mdr_accounting_entry_id,
             sp.settlement_date, sp.booking_id, sb.booking_number, sb.customer_name
      FROM sport_payments sp
      LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
      WHERE sp.id = ${id}
      LIMIT 1
    `);
    if (!paymentRes.rows.length) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    const p = paymentRes.rows[0] as Record<string, unknown>;

    const reqCompanyId = resolveCompanyId(req);
    if (!await assertCompanyAccess(
      p.company_id != null ? Number(p.company_id) : null,
      reqCompanyId, req, res,
      { resourceType: "sport_payment_mdr", resourceId: id },
    )) return;

    const mdrAmount = Number(p.mdr_amount ?? 0);
    if (String(p.method ?? "").toLowerCase() !== "qris") {
      return res.status(400).json({ error: "Jurnal MDR hanya dapat dibuat untuk payment QRIS" });
    }
    if (!Number.isFinite(mdrAmount) || mdrAmount <= 0) {
      return res.status(400).json({ error: "Isi MDR terlebih dahulu sebelum posting jurnal" });
    }
    if (String(p.mdr_posting_status ?? "unposted") === "posted") {
      return res.json({ ok: true, skipped: true, entryId: p.mdr_accounting_entry_id });
    }

    const companyId = p.company_id != null ? Number(p.company_id) : 1;
    const settings = await ensureAccountingSettings(companyId);
    const journalId = settings.bankJournalId ?? settings.cashJournalId;
    const journalCode = settings.bankJournalId ? "BNK" : "CSH";
    if (!journalId) {
      return res.status(422).json({ error: "Jurnal Bank/Kas belum dikonfigurasi" });
    }

    const expenseRes = await db.execute(sql`
      SELECT id
      FROM chart_of_accounts
      WHERE code LIKE '5-3050%'
        AND (company_id = ${companyId} OR company_id IS NULL)
      ORDER BY CASE WHEN company_id = ${companyId} THEN 0 ELSE 1 END, id
      LIMIT 1
    `);
    const expenseAccountId = Number((expenseRes.rows[0] as Record<string, unknown> | undefined)?.id ?? 0);
    const bankAccountId = settings.defaultBankAccountId ?? settings.defaultCashAccountId;
    if (!expenseAccountId || !bankAccountId) {
      return res.status(422).json({ error: "COA biaya MDR atau akun Bank belum dikonfigurasi" });
    }

    const settlementDate = String(p.settlement_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const entry = await postEntry({
      journalId,
      date: new Date(settlementDate),
      ref: `${String(p.payment_number)}-MDR`,
      description: `Biaya MDR QRIS ${String(p.booking_number ?? p.payment_number)}`,
      source: "sport_center_qris_mdr",
      sourceId: id,
      companyId,
      costCenterId: await resolveCostCenterId("SPORT_CENTER", companyId),
      expenseCategory: "EXP-MDR",
      lines: [
        {
          accountId: expenseAccountId,
          debit: mdrAmount,
          credit: 0,
          description: `Biaya MDR QRIS ${String(p.payment_number)}`,
        },
        {
          accountId: bankAccountId,
          debit: 0,
          credit: mdrAmount,
          description: `Pengurang settlement bank QRIS ${String(p.payment_number)}`,
        },
      ],
    }, journalCode);

    await db.execute(sql`
      UPDATE sport_payments
      SET mdr_posting_status = 'posted',
          mdr_accounting_entry_id = ${entry.id},
          mdr_posted_at = NOW(),
          mdr_posting_error = NULL,
          updated_at = NOW()
      WHERE id = ${id}
    `);
    res.json({ ok: true, entryId: entry.id, mdrAmount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db.execute(sql`
      UPDATE sport_payments
      SET mdr_posting_status = 'failed', mdr_posting_error = ${message.slice(0, 1000)}, updated_at = NOW()
      WHERE id = ${id}
    `).catch(() => {});
    console.error("[sport-center] POST /payments/:id/mdr/post error:", message);
    res.status(500).json({ error: "Gagal posting jurnal MDR", detail: message });
  }
});

// ── REVENUE TRANSACTIONS (untuk expandable card di dashboard) ────────────────
router.get("/revenue-transactions", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const todayStr = new Date().toISOString().slice(0, 10);
    const date = (req.query.date as string | undefined) ?? todayStr;
    const from = (req.query.from as string | undefined) ?? date;
    const to   = (req.query.to   as string | undefined) ?? date;

    const rows = await db.execute(sql`
      SELECT
        ae.id           AS entry_id,
        ae.date         AS payment_date,
        ae.total_debit  AS amount,
        ae.ref,
        ae.source,
        ae.source_id    AS booking_id,
        b.booking_number,
        b.customer_name,
        b.facility_name,
        b.booking_date,
        b.start_time,
        b.end_time,
        b.status,
        b.payment_status,
        b.total_amount
      FROM accounting_entries ae
      LEFT JOIN sport_bookings b ON b.id = ae.source_id
      WHERE ae.source = 'sport_center_booking'
        AND ae.status  = 'posted'
        AND ae.date   >= ${from}::date
        AND ae.date   <= ${to}::date
        AND (${cId}::int IS NULL OR ae.company_id = ${cId})
      ORDER BY ae.date DESC, ae.id DESC
      LIMIT 500
    `);

    const total = rows.rows.reduce((s, r) => s + Number((r as any).amount ?? 0), 0);
    res.json({ data: rows.rows, total, date, from, to });
  } catch (err) {
    console.error("[sport-center] GET /revenue-transactions error:", err);
    res.status(500).json({ error: "Gagal memuat transaksi revenue" });
  }
});

router.get("/reports", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const from = (req.query.from as string) ?? null;
    const to = (req.query.to as string) ?? null;

    const [revenueByDay, revenueByFacility, bookingsByStatus, bookingRevRes, membershipRevReportRes] = await Promise.all([
      db.execute(sql`
        SELECT booking_date, COUNT(*) AS bookings, COALESCE(SUM(total_amount),0) AS revenue
        FROM sport_bookings
        WHERE status != 'cancelled'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${from}::date IS NULL OR booking_date >= ${from}::date)
          AND (${to}::date IS NULL OR booking_date <= ${to}::date)
        GROUP BY booking_date ORDER BY booking_date DESC LIMIT 30
      `),
      db.execute(sql`
        SELECT facility_name, COUNT(*) AS bookings, COALESCE(SUM(total_amount),0) AS revenue
        FROM sport_bookings
        WHERE status != 'cancelled'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${from}::date IS NULL OR booking_date >= ${from}::date)
          AND (${to}::date IS NULL OR booking_date <= ${to}::date)
        GROUP BY facility_name ORDER BY revenue DESC
      `),
      db.execute(sql`
        SELECT status, COUNT(*) AS count FROM sport_bookings
        WHERE (${cId}::int IS NULL OR company_id = ${cId})
        GROUP BY status
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(total_amount),0) AS revenue FROM sport_bookings
        WHERE status != 'cancelled'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${from}::date IS NULL OR booking_date >= ${from}::date)
          AND (${to}::date IS NULL OR booking_date <= ${to}::date)
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(amount),0) AS revenue FROM sport_payments
        WHERE payment_type = 'membership' AND status = 'paid'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${from}::date IS NULL OR paid_at::date >= ${from}::date)
          AND (${to}::date IS NULL OR paid_at::date <= ${to}::date)
      `),
    ]);

    const bookingRevenue = Number((bookingRevRes.rows[0] as any).revenue);
    const membershipRevenue = Number((membershipRevReportRes.rows[0] as any).revenue);
    res.json({
      revenueByDay: revenueByDay.rows,
      revenueByFacility: revenueByFacility.rows,
      bookingsByStatus: bookingsByStatus.rows,
      bookingRevenue,
      membershipRevenue,
      grandTotalRevenue: bookingRevenue + membershipRevenue,
    });
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

// ── GET /reports/revenue — data dari accounting_entries (konsisten dengan KPI Live) ──
router.get("/reports/revenue", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const from = (req.query.from as string) ?? null;
    const to = (req.query.to as string) ?? null;

    const [monthlyRes, byFacilityRes, byMethodRes, transactionsRes] = await Promise.all([
      // Monthly: dari accounting_entries (konsisten dengan KPI Live)
      db.execute(sql`
        SELECT
          TO_CHAR(ae.date, 'YYYY-MM') AS month,
          COALESCE(SUM(ae.total_debit), 0) AS revenue,
          COUNT(*) AS transactions
        FROM accounting_entries ae
        WHERE ae.source IN ('sport_center_booking', 'sport_center_membership')
          AND ae.status = 'posted'
          AND (${cId}::int IS NULL OR ae.company_id = ${cId})
          AND (${from}::date IS NULL OR ae.date >= ${from}::date)
          AND (${to}::date IS NULL OR ae.date <= ${to}::date)
        GROUP BY TO_CHAR(ae.date, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT 24
      `),
      // Revenue per fasilitas: dari sport_payments JOIN sport_bookings JOIN sport_facilities
      db.execute(sql`
        SELECT
          COALESCE(f.name, sb.facility_name, 'Lainnya') AS facility_name,
          COUNT(sp.id) AS bookings,
          COALESCE(SUM(sp.amount), 0) AS revenue
        FROM sport_payments sp
        JOIN sport_bookings sb ON sb.id = sp.booking_id
        LEFT JOIN sport_facilities f ON f.id = sb.facility_id
        WHERE sp.status = 'paid'
          AND sp.source = 'SPORT_CENTER'
          AND (${cId}::int IS NULL OR sp.company_id = ${cId})
          AND (${from}::date IS NULL OR sp.paid_at::date >= ${from}::date)
          AND (${to}::date IS NULL OR sp.paid_at::date <= ${to}::date)
        GROUP BY COALESCE(f.name, sb.facility_name, 'Lainnya')
        ORDER BY revenue DESC
      `),
      // Revenue per metode pembayaran
      db.execute(sql`
        SELECT
          COALESCE(sp.method, 'cash') AS method,
          COUNT(sp.id) AS transactions,
          COALESCE(SUM(sp.amount), 0) AS total
        FROM sport_payments sp
        WHERE sp.status = 'paid'
          AND sp.source = 'SPORT_CENTER'
          AND (${cId}::int IS NULL OR sp.company_id = ${cId})
          AND (${from}::date IS NULL OR sp.paid_at::date >= ${from}::date)
          AND (${to}::date IS NULL OR sp.paid_at::date <= ${to}::date)
        GROUP BY sp.method
        ORDER BY total DESC
      `),
      // Transaksi detail: sport_payments JOIN sport_bookings JOIN sport_facilities
      db.execute(sql`
        SELECT
          sp.id,
          sp.payment_number,
          sp.booking_id,
          sp.amount,
          sp.method AS payment_method,
          sp.paid_at,
          sp.payment_type,
          sp.status AS payment_status,
          COALESCE(f.name, sb.facility_name, 'Lainnya') AS facility_name,
          COALESCE(sb.customer_name, '') AS customer_name,
          sb.booking_number,
          sb.booking_date,
          sb.start_time,
          sb.end_time,
          sb.payment_status AS booking_payment_status
        FROM sport_payments sp
        LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
        LEFT JOIN sport_facilities f ON f.id = sb.facility_id
        WHERE sp.status = 'paid'
          AND sp.source = 'SPORT_CENTER'
          AND (${cId}::int IS NULL OR sp.company_id = ${cId})
          AND (${from}::date IS NULL OR sp.paid_at::date >= ${from}::date)
          AND (${to}::date IS NULL OR sp.paid_at::date <= ${to}::date)
        ORDER BY sp.paid_at DESC
        LIMIT 500
      `),
    ]);

    res.json({
      monthly: monthlyRes.rows,
      byFacility: byFacilityRes.rows,
      byMethod: byMethodRes.rows,
      transactions: transactionsRes.rows,
    });
  } catch (err) {
    console.error('[sport-center] GET /reports/revenue error:', err);
    res.status(500).json({ error: "Gagal memuat laporan revenue" });
  }
});

// ── REFUNDS ──────────────────────────────────────────────────────────────────

router.get("/refunds", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const statusFilter = req.query.status ? String(req.query.status) : null;
    const bookingId = req.query.bookingId ? Number(req.query.bookingId) : null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = (page - 1) * limit;

    const rows = await db.execute(sql`
      SELECT r.*,
             b.booking_number, b.facility_name, b.booking_date,
             c.name AS customer_name_detail
      FROM sport_refunds r
      LEFT JOIN sport_bookings b ON b.id = r.booking_id
      LEFT JOIN sport_customers c ON c.id = r.customer_id
      WHERE (${cId}::int IS NULL OR r.company_id = ${cId})
        AND (${statusFilter}::text IS NULL OR r.status = ${statusFilter})
        AND (${bookingId}::int IS NULL OR r.booking_id = ${bookingId})
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const totalRes = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM sport_refunds r
      WHERE (${cId}::int IS NULL OR r.company_id = ${cId})
        AND (${statusFilter}::text IS NULL OR r.status = ${statusFilter})
        AND (${bookingId}::int IS NULL OR r.booking_id = ${bookingId})
    `);
    res.json({ data: rows.rows, total: Number((totalRes.rows[0] as any).cnt), page, limit });
  } catch {
    res.status(500).json({ error: "Gagal memuat refund" });
  }
});

router.post("/refunds", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { company_id, booking_id, payment_id, refund_amount, refund_reason } = req.body;
    const actorId = (req.user as { id: string } | undefined)?.id ?? null;

    if (!booking_id || !refund_amount) {
      return res.status(400).json({ error: "booking_id dan refund_amount wajib" });
    }
    const amt = Number(refund_amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "refund_amount harus berupa angka positif" });
    }

    // Validasi: booking harus dalam status cancelled
    const bookingRes = await db.execute(sql`SELECT * FROM sport_bookings WHERE id = ${Number(booking_id)} LIMIT 1`);
    if (!bookingRes.rows.length) return res.status(404).json({ error: "Booking tidak ditemukan" });
    const booking = bookingRes.rows[0] as Record<string, unknown>;
    if (booking.status !== "cancelled") {
      return res.status(400).json({ error: "Refund hanya dapat dibuat untuk booking yang sudah dibatalkan" });
    }

    // Validasi: total refund tidak boleh melebihi total pembayaran
    const paidRes = await db.execute(sql`
      SELECT COALESCE(SUM(amount),0) AS total_paid FROM sport_payments
      WHERE booking_id = ${Number(booking_id)} AND status = 'paid'
    `);
    const totalPaid = Number((paidRes.rows[0] as any).total_paid);

    const existingRefundRes = await db.execute(sql`
      SELECT COALESCE(SUM(refund_amount),0) AS already_refunded FROM sport_refunds
      WHERE booking_id = ${Number(booking_id)} AND status != 'rejected'
    `);
    const alreadyRefunded = Number((existingRefundRes.rows[0] as any).already_refunded);

    if (alreadyRefunded + amt > totalPaid) {
      return res.status(400).json({
        error: `Total refund (${alreadyRefunded + amt}) melebihi total pembayaran (${totalPaid})`,
      });
    }

    // Dapatkan customer_id dari booking jika tidak disediakan
    const custId = req.body.customer_id ?? booking.customer_id ?? null;
    const cmpId = company_id ?? booking.company_id ?? null;
    const refundNumber = await nextRefundNumber(cmpId ? Number(cmpId) : undefined);

    const r = await db.execute(sql`
      INSERT INTO sport_refunds (company_id, booking_id, payment_id, customer_id, refund_number, refund_amount, refund_reason, status, processed_by)
      VALUES (
        ${cmpId ?? null},
        ${Number(booking_id)},
        ${payment_id ?? null},
        ${custId ?? null},
        ${refundNumber},
        ${amt},
        ${refund_reason ?? null},
        'pending',
        ${actorId}
      )
      RETURNING *
    `);
    const refund = r.rows[0] as Record<string, unknown>;

    await db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (
        ${cmpId ?? null}, 'refund', ${refund.id},
        'REFUND_CREATED', ${actorId},
        ${JSON.stringify({ refund_number: refundNumber, booking_id, refund_amount: amt, reason: refund_reason ?? null })}::jsonb
      )
    `);

    broadcastSportCenterEvent({ module: "sport-center", entity: "refund" as any, action: "created", data: refund, timestamp: new Date().toISOString() }, cmpId ? Number(cmpId) : undefined);
    res.status(201).json(refund);
  } catch (err: any) {
    if (String(err?.message ?? "").includes("unique")) return res.status(409).json({ error: "Refund sudah ada" });
    res.status(500).json({ error: "Gagal membuat refund" });
  }
});

router.get("/refunds/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const refId = Number(req.params.id);
    const r = await db.execute(sql`
      SELECT r.*,
             b.booking_number, b.facility_name, b.booking_date, b.customer_name,
             c.name AS customer_name_detail
      FROM sport_refunds r
      LEFT JOIN sport_bookings b ON b.id = r.booking_id
      LEFT JOIN sport_customers c ON c.id = r.customer_id
      WHERE r.id = ${Number(String(req.params.id))}
      WHERE r.id = ${refId}
      LIMIT 1
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Refund tidak ditemukan" });
    // IDOR guard
    const cIdRef = resolveCompanyId(req);
    if (!await assertCompanyAccess((r.rows[0] as any).company_id as number | null, cIdRef, req, res, { resourceType: "sport_refund", resourceId: refId })) return;
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

router.patch("/refunds/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(String(req.params.id));
    const { status } = req.body;
    const actorId = (req.user as { id: string } | undefined)?.id ?? null;

    const allowed = ["approved", "paid", "rejected"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: "status harus salah satu: approved, paid, rejected" });
    }

    const cur = await db.execute(sql`SELECT * FROM sport_refunds WHERE id = ${id} LIMIT 1`);
    if (!cur.rows.length) return res.status(404).json({ error: "Refund tidak ditemukan" });
    const refund = cur.rows[0] as Record<string, unknown>;
    // IDOR guard
    const cIdRefPatch = resolveCompanyId(req);
    if (!await assertCompanyAccess(refund["company_id"] as number | null, cIdRefPatch, req, res, { resourceType: "sport_refund", resourceId: id })) return;

    // Validasi transisi status
    const transitions: Record<string, string[]> = {
      pending: ["approved", "rejected"],
      approved: ["paid", "rejected"],
    };
    const current = String(refund.status ?? "pending");
    if (current === "paid" || current === "rejected") {
      return res.status(400).json({ error: `Refund dengan status '${current}' tidak dapat diubah` });
    }
    if (!(transitions[current] ?? []).includes(status)) {
      return res.status(400).json({ error: `Transisi status '${current}' → '${status}' tidak valid` });
    }

    const r = await db.execute(sql`
      UPDATE sport_refunds SET status = ${status}, processed_by = ${actorId}, updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `);
    const updated = r.rows[0] as Record<string, unknown>;

    const actionMap: Record<string, string> = { approved: "REFUND_APPROVED", paid: "REFUND_PAID", rejected: "REFUND_REJECTED" };
    await db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (
        ${updated.company_id ?? null}, 'refund', ${id},
        ${actionMap[status]}, ${actorId},
        ${JSON.stringify({ old_status: current, new_status: status })}::jsonb
      )
    `);

    // Post jurnal akuntansi saat status → paid
    if (status === "paid") {
      const bookingRes = await db.execute(sql`SELECT * FROM sport_bookings WHERE id = ${updated.booking_id} LIMIT 1`);
      const booking = (bookingRes.rows[0] ?? {}) as Record<string, unknown>;
      postSportCenterRefund({
        refundId: id,
        refundNumber: String(updated.refund_number ?? `RF-${id}`),
        bookingCode: String(booking.booking_number ?? booking.booking_code ?? `BK-${updated.booking_id}`),
        customerName: String(booking.customer_name ?? ""),
        amount: Number(updated.refund_amount),
        companyId: updated.company_id != null ? Number(updated.company_id) : null,
      }).catch(() => {});
      // Void PPN Keluaran di transaction_taxes agar laporan pajak tidak over-count
      if (updated.company_id != null && updated.booking_id != null) {
        import("../../lib/taxAutoService.js").then(({ reverseTransactionTax }) => {
          void reverseTransactionTax({
            companyId: Number(updated.company_id),
            transactionType: "sport_center",
            transactionId: Number(updated.booking_id),
          });
        }).catch(() => {});
      }
    }

    broadcastSportCenterEvent({ module: "sport-center", entity: "refund" as any, action: "updated", data: updated, timestamp: new Date().toISOString() }, updated.company_id as number | undefined);
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Gagal mengubah status refund" });
  }
});

// ── REFUND SHORTCUT (POST /bookings/:id/refund) ───────────────────────────────
// Endpoint satu langkah: cancel booking (jika belum) → buat refund → posting jurnal

router.post("/bookings/:id/refund", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(String(req.params.id));
    const { refund_amount, refund_reason } = req.body;
    const actorId = (req.user as { id: string } | undefined)?.id ?? null;

    if (!refund_amount) return res.status(400).json({ error: "refund_amount wajib" });
    const amt = Number(refund_amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "refund_amount harus angka positif" });

    const bookingRes = await db.execute(sql`SELECT * FROM sport_bookings WHERE id = ${id} LIMIT 1`);
    if (!bookingRes.rows.length) return res.status(404).json({ error: "Booking tidak ditemukan" });
    const booking = bookingRes.rows[0] as Record<string, unknown>;
    if (booking.status === "completed") return res.status(400).json({ error: "Booking selesai tidak dapat di-refund" });

    // Cancel booking jika belum cancelled
    if (booking.status !== "cancelled") {
      await db.execute(sql`
        UPDATE sport_bookings
        SET status = 'cancelled', cancelled_at = NOW(), cancelled_reason = ${refund_reason ?? 'Refund'}, updated_at = NOW()
        WHERE id = ${id}
      `);
    }

    // Update payment_status → refunded
    await db.execute(sql`
      UPDATE sport_bookings SET payment_status = 'refunded', updated_at = NOW() WHERE id = ${id}
    `);

    // Buat record refund
    const cmpId = booking.company_id ?? null;
    const refundNumber = await nextRefundNumber(cmpId ? Number(cmpId) : undefined);
    const paidRes = await db.execute(sql`
      SELECT COALESCE(SUM(amount),0) AS total_paid FROM sport_payments
      WHERE booking_id = ${id} AND status = 'paid'
    `);
    const totalPaid = Number((paidRes.rows[0] as any).total_paid);
    const refundAmt = Math.min(amt, totalPaid > 0 ? totalPaid : amt);

    const rr = await db.execute(sql`
      INSERT INTO sport_refunds (company_id, booking_id, customer_id, refund_number, refund_amount, refund_reason, status, processed_by)
      VALUES (${cmpId ?? null}, ${id}, ${booking.customer_id ?? null}, ${refundNumber}, ${refundAmt}, ${refund_reason ?? null}, 'paid', ${actorId})
      RETURNING *
    `);
    const refund = rr.rows[0] as Record<string, unknown>;

    // Post jurnal accounting — source: sport_center_booking_refund
    postSportCenterBookingRefundDirect({
      bookingId: id,
      bookingCode: String(booking.booking_number ?? `BK-${id}`),
      customerName: String(booking.customer_name ?? ""),
      amount: refundAmt,
      companyId: cmpId != null ? Number(cmpId) : null,
    }).catch(() => {});
    // Void PPN Keluaran di transaction_taxes agar laporan pajak tidak over-count
    if (cmpId != null) {
      import("../../lib/taxAutoService.js").then(({ reverseTransactionTax }) => {
        void reverseTransactionTax({
          companyId: Number(cmpId),
          transactionType: "sport_center",
          transactionId: id,
        });
      }).catch(() => {});
    }

    await db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (${cmpId ?? null}, 'booking', ${id}, 'BOOKING_REFUNDED', ${actorId},
        ${JSON.stringify({ refund_number: refundNumber, amount: refundAmt, reason: refund_reason ?? null })}::jsonb)
    `);

    broadcastSportCenterEvent({ module: "sport-center", entity: "booking", action: "refunded" as any, data: { booking_id: id, refund }, timestamp: new Date().toISOString() }, cmpId as number | undefined);
    res.status(201).json({ booking_id: id, refund_number: refundNumber, refund_amount: refundAmt, payment_status: "refunded", refund });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("unique")) return res.status(409).json({ error: "Refund sudah ada untuk booking ini" });
    res.status(500).json({ error: "Gagal memproses refund" });
  }
});

// ── MAINTENANCE REQUEST — FASE 4: buat PR nyata di modul Purchase ─────────────

router.post("/facilities/:id/request-maintenance", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const facilityId = Number(String(req.params.id));
    if (isNaN(facilityId)) return res.status(400).json({ error: "ID fasilitas tidak valid" });

    const { item, quantity = 1, vendor, notes, company_id, estimated_cost = 0, unit = "pcs" } = req.body;
    if (!item) return res.status(400).json({ error: "item wajib diisi" });

    const facilityRes = await db.execute(sql`SELECT * FROM sport_facilities WHERE id = ${facilityId} LIMIT 1`);
    if (!facilityRes.rows.length) return res.status(404).json({ error: "Fasilitas tidak ditemukan" });
    const facility = facilityRes.rows[0] as Record<string, unknown>;
    // IDOR guard
    const cIdRm = resolveCompanyId(req);
    if (!await assertCompanyAccess(facility["company_id"] as number | null, cIdRm, req, res, { resourceType: "sport_facility", resourceId: facilityId })) return;

    const cmpId = Number(company_id ?? facility.company_id ?? 1);
    const actorId = (req.user as { id: string } | undefined)?.id ?? null;
    const actorName = (req.user as { name?: string; email?: string } | undefined)?.name
      ?? (req.user as { name?: string; email?: string } | undefined)?.email
      ?? "Sport Center Admin";

    // Buat Purchase Request nyata di modul Purchase
    const prNumber = await nextPrSeq();
    const prNotes = `[SPORT_CENTER] Fasilitas: ${facility.name ?? facilityId} | ${notes ?? ""}`.trim();
    const prRes = await db.execute(sql`
      INSERT INTO purchase_requests
        (pr_number, company_id, status, requested_by, department, notes, created_by, created_at, updated_at)
      VALUES
        (${prNumber}, ${cmpId}, 'draft', ${actorName}, 'SPORT_CENTER', ${prNotes}, ${actorId}, NOW(), NOW())
      RETURNING *
    `);
    const pr = prRes.rows[0] as Record<string, unknown>;

    // Insert line PR
    await db.execute(sql`
      INSERT INTO purchase_request_lines
        (pr_id, name, description, quantity, unit, estimated_cost, notes, product_category)
      VALUES
        (${pr.id}, ${item}, ${`Maintenance fasilitas: ${facility.name ?? facilityId}`},
         ${Number(quantity)}, ${unit}, ${Number(estimated_cost).toFixed(2)},
         ${notes ?? null}, 'SPORT_CENTER_MAINTENANCE')
    `);

    // Simpan maintenance request dengan link ke PR
    const r = await db.execute(sql`
      INSERT INTO sport_maintenance_requests
        (company_id, facility_id, facility_name, item, quantity, vendor, notes,
         source, cost_center, request_type, status, requested_by,
         purchase_request_id, purchase_request_number, estimated_cost, unit)
      VALUES
        (${cmpId}, ${facilityId}, ${facility.name ?? null},
         ${item}, ${Number(quantity)}, ${vendor ?? null}, ${notes ?? null},
         'SPORT_CENTER', 'SPORT_CENTER', 'maintenance', 'submitted', ${actorId},
         ${pr.id}, ${prNumber}, ${Number(estimated_cost).toFixed(2)}, ${unit})
      RETURNING *
    `);
    const maint = r.rows[0] as Record<string, unknown>;

    await db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (${cmpId}, 'facility', ${facilityId}, 'MAINTENANCE_REQUESTED', ${actorId},
        ${JSON.stringify({
          item, quantity, vendor: vendor ?? null, notes: notes ?? null,
          source: "SPORT_CENTER", cost_center: "SPORT_CENTER",
          maintenance_id: maint.id, purchase_request_id: pr.id, purchase_request_number: prNumber,
        })}::jsonb)
    `);

    res.status(201).json({
      maintenance_request: maint,
      purchase_request: {
        id: pr.id,
        pr_number: prNumber,
        company_id: cmpId,
        department: "SPORT_CENTER",
        cost_center: "SPORT_CENTER",
        source: "SPORT_CENTER",
        status: "draft",
        notes: prNotes,
      },
    });
  } catch (err: any) {
    console.error("[sport-center] request-maintenance error:", err);
    res.status(500).json({ error: "Gagal membuat maintenance request" });
  }
});

// ── PURCHASE REQUEST OPERASIONAL — FASE 4 ─────────────────────────────────────

router.post("/facilities/:id/purchase-request", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const facilityId = Number(String(req.params.id));
    if (isNaN(facilityId)) return res.status(400).json({ error: "ID fasilitas tidak valid" });

    const { items, notes, company_id, request_type = "operational" } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items wajib diisi (array)" });
    }

    const facilityRes = await db.execute(sql`SELECT * FROM sport_facilities WHERE id = ${facilityId} LIMIT 1`);
    if (!facilityRes.rows.length) return res.status(404).json({ error: "Fasilitas tidak ditemukan" });
    const facility = facilityRes.rows[0] as Record<string, unknown>;
    // IDOR guard
    const cIdPrOp = resolveCompanyId(req);
    if (!await assertCompanyAccess(facility["company_id"] as number | null, cIdPrOp, req, res, { resourceType: "sport_facility", resourceId: facilityId })) return;

    const cmpId = Number(company_id ?? facility.company_id ?? 1);
    const actorId = (req.user as { id: string } | undefined)?.id ?? null;
    const actorName = (req.user as { name?: string; email?: string } | undefined)?.name
      ?? (req.user as { name?: string; email?: string } | undefined)?.email
      ?? "Sport Center Admin";

    // Validasi setiap item
    for (const it of items as Record<string, unknown>[]) {
      if (!it.item && !it.name) return res.status(400).json({ error: "Setiap item wajib memiliki field 'item' atau 'name'" });
    }

    // Buat Purchase Request
    const prNumber = await nextPrSeq();
    const prNotes = `[SPORT_CENTER] Fasilitas: ${facility.name ?? facilityId} | Tipe: ${request_type} | ${notes ?? ""}`.trim();
    const prRes = await db.execute(sql`
      INSERT INTO purchase_requests
        (pr_number, company_id, status, requested_by, department, notes, created_by, created_at, updated_at)
      VALUES
        (${prNumber}, ${cmpId}, 'draft', ${actorName}, 'SPORT_CENTER', ${prNotes}, ${actorId}, NOW(), NOW())
      RETURNING *
    `);
    const pr = prRes.rows[0] as Record<string, unknown>;

    // Insert lines PR
    const maintIds: number[] = [];
    for (const it of items as Record<string, unknown>[]) {
      const itemName = String(it.item ?? it.name ?? "");
      const qty = Number(it.quantity ?? 1);
      const unit = String(it.unit ?? "pcs");
      const estCost = Number(it.estimated_cost ?? 0);
      const itemNotes = it.notes ? String(it.notes) : null;

      await db.execute(sql`
        INSERT INTO purchase_request_lines
          (pr_id, name, description, quantity, unit, estimated_cost, notes, product_category)
        VALUES
          (${pr.id}, ${itemName}, ${`Operasional fasilitas: ${facility.name ?? facilityId}`},
           ${qty}, ${unit}, ${estCost.toFixed(2)}, ${itemNotes}, 'SPORT_CENTER_OPERATIONAL')
      `);

      // Catat ke sport_maintenance_requests per item
      const smr = await db.execute(sql`
        INSERT INTO sport_maintenance_requests
          (company_id, facility_id, facility_name, item, quantity, vendor, notes,
           source, cost_center, request_type, status, requested_by,
           purchase_request_id, purchase_request_number, estimated_cost, unit)
        VALUES
          (${cmpId}, ${facilityId}, ${facility.name ?? null},
           ${itemName}, ${qty}, ${it.vendor ? String(it.vendor) : null}, ${itemNotes},
           'SPORT_CENTER', 'SPORT_CENTER', ${request_type}, 'submitted', ${actorId},
           ${pr.id}, ${prNumber}, ${estCost.toFixed(2)}, ${unit})
        RETURNING id
      `);
      maintIds.push(Number((smr.rows[0] as any).id));
    }

    await db.execute(sql`
      INSERT INTO sport_audit_logs (company_id, entity_type, entity_id, action, actor, new_data)
      VALUES (${cmpId}, 'facility', ${facilityId}, 'PURCHASE_REQUEST_CREATED', ${actorId},
        ${JSON.stringify({
          purchase_request_id: pr.id, purchase_request_number: prNumber,
          source: "SPORT_CENTER", cost_center: "SPORT_CENTER",
          request_type, item_count: (items as unknown[]).length,
          maintenance_ids: maintIds,
        })}::jsonb)
    `);

    res.status(201).json({
      purchase_request: {
        id: pr.id,
        pr_number: prNumber,
        company_id: cmpId,
        department: "SPORT_CENTER",
        cost_center: "SPORT_CENTER",
        source: "SPORT_CENTER",
        request_type,
        status: "draft",
        notes: prNotes,
        item_count: (items as unknown[]).length,
      },
      maintenance_request_ids: maintIds,
    });
  } catch (err: any) {
    console.error("[sport-center] purchase-request error:", err);
    res.status(500).json({ error: "Gagal membuat purchase request" });
  }
});

router.get("/facilities/:id/maintenance-requests", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const facilityId = Number(String(req.params.id));
    const r = await db.execute(sql`
      SELECT * FROM sport_maintenance_requests WHERE facility_id = ${facilityId} ORDER BY created_at DESC
    `);
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Gagal memuat maintenance requests" });
  }
});

// ── LIST SEMUA PURCHASE REQUESTS SPORT CENTER ──────────────────────────────────

router.get("/purchase-requests", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : null;
    const requestType = req.query.request_type ? String(req.query.request_type) : null;
    const status = req.query.status ? String(req.query.status) : null;

    const r = await db.execute(sql`
      SELECT
        smr.*,
        pr.status         AS pr_status,
        pr.pr_number      AS pr_number_ref,
        pr.department     AS pr_department,
        pr.notes          AS pr_notes,
        pr.created_at     AS pr_created_at
      FROM sport_maintenance_requests smr
      LEFT JOIN purchase_requests pr ON pr.id = smr.purchase_request_id
      WHERE smr.source = 'SPORT_CENTER'
        AND (${cId}::int IS NULL        OR smr.company_id = ${cId})
        AND (${facilityId}::int IS NULL OR smr.facility_id = ${facilityId})
        AND (${requestType} IS NULL     OR smr.request_type = ${requestType})
        AND (${status} IS NULL          OR smr.status = ${status})
      ORDER BY smr.created_at DESC
    `);
    res.json(r.rows);
  } catch (err: any) {
    console.error("[sport-center] GET /purchase-requests error:", err);
    res.status(500).json({ error: "Gagal memuat purchase requests" });
  }
});

// Inline migrations: add reminder_days + wa_template columns if not exists
(async () => {
  try {
    await db.execute(sql`ALTER TABLE sport_settings ADD COLUMN IF NOT EXISTS reminder_days TEXT NOT NULL DEFAULT '4,1'`);
  } catch {}
  try {
    await db.execute(sql`
      ALTER TABLE sport_settings ADD COLUMN IF NOT EXISTS wa_template TEXT NOT NULL DEFAULT
        E'Halo *{{name}}*! 👋\n\nKami ingin menginformasikan bahwa masa keanggotaan Anda di *{{center_name}}* akan berakhir *{{days_label}}* ({{end_date}}).\n\nSegera perpanjang keanggotaan Anda agar tetap dapat menikmati fasilitas kami tanpa gangguan.\n\nUntuk informasi perpanjangan, silakan hubungi kami atau kunjungi langsung Sport Center.\n\nTerima kasih atas kepercayaan Anda! 🏆'
    `);
  } catch {}
})();

router.get("/settings", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const r = await db.execute(sql`SELECT * FROM sport_settings WHERE (${cId}::int IS NULL OR company_id = ${cId}) LIMIT 1`);
    res.json(r.rows[0] ?? null);
  } catch {
    res.status(500).json({ error: "Gagal" });
  }
});

const DEFAULT_WA_TEMPLATE =
  "Halo *{{name}}*! 👋\n\n" +
  "Kami ingin menginformasikan bahwa masa keanggotaan Anda di *{{center_name}}* akan berakhir *{{days_label}}* ({{end_date}}).\n\n" +
  "Segera perpanjang keanggotaan Anda agar tetap dapat menikmati fasilitas kami tanpa gangguan.\n\n" +
  "Untuk informasi perpanjangan, silakan hubungi kami atau kunjungi langsung Sport Center.\n\n" +
  "Terima kasih atas kepercayaan Anda! 🏆";

async function upsertSettings(body: Record<string, unknown>) {
  const { company_id, center_name, address, phone, open_time, close_time,
          booking_advance_days, min_booking_hours, cancellation_hours, reminder_days, wa_template } = body;
  const reminderDaysStr = Array.isArray(reminder_days)
    ? (reminder_days as number[]).filter((d) => Number.isInteger(d) && d >= 1 && d <= 90).join(",")
    : typeof reminder_days === "string" ? reminder_days : "4,1";
  const waTemplateStr = typeof wa_template === "string" && wa_template.trim()
    ? wa_template.trim()
    : DEFAULT_WA_TEMPLATE;
  return db.execute(sql`
    INSERT INTO sport_settings (company_id, center_name, address, phone, open_time, close_time,
      booking_advance_days, min_booking_hours, cancellation_hours, reminder_days, wa_template)
    VALUES (${company_id ?? null}, ${center_name ?? "Sport Center"}, ${address ?? null}, ${phone ?? null},
            ${open_time ?? "06:00"}::time, ${close_time ?? "22:00"}::time,
            ${booking_advance_days ?? 30}, ${min_booking_hours ?? 1}, ${cancellation_hours ?? 2},
            ${reminderDaysStr}, ${waTemplateStr})
    ON CONFLICT (company_id) DO UPDATE SET
      center_name = EXCLUDED.center_name,
      address = EXCLUDED.address,
      phone = EXCLUDED.phone,
      open_time = EXCLUDED.open_time,
      close_time = EXCLUDED.close_time,
      booking_advance_days = EXCLUDED.booking_advance_days,
      min_booking_hours = EXCLUDED.min_booking_hours,
      cancellation_hours = EXCLUDED.cancellation_hours,
      reminder_days = EXCLUDED.reminder_days,
      wa_template = EXCLUDED.wa_template,
      updated_at = NOW()
    RETURNING *
  `);
}

router.post("/settings", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const r = await upsertSettings(req.body);
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal menyimpan settings" });
  }
});

router.put("/settings", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const r = await upsertSettings(req.body);
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Gagal menyimpan settings" });
  }
});

// ── PROFITABILITY DASHBOARD ────────────────────────────────────────────────

router.get("/profitability", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.company_id ? Number(req.query.company_id) : (req.query.companyId ? Number(req.query.companyId) : null);
    const costCenterId = req.query.cost_center_id ? Number(req.query.cost_center_id) : null;
    const from = (req.query.from as string) ?? null;
    const to = (req.query.to as string) ?? null;
    const facilityId = req.query.facility_id ? Number(req.query.facility_id) : null;

    const [
      revenueBookingRes,
      revenueMembershipRes,
      refundRes,
      opExpenseRes,
      bookingsCountRes,
      activeMembersRes,
      revenueByMonthRes,
      facilityBookingRes,
      facilityExpenseRes,
      expenseByCategoryRes,
      facilityOccupancyRes,
    ] = await Promise.all([
      // Revenue Booking dari accounting_entries
      db.execute(sql`
        SELECT COALESCE(SUM(total_debit), 0) AS amount
        FROM accounting_entries
        WHERE source = 'sport_center_booking'
          AND status = 'posted'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
          AND (${from}::date IS NULL OR date >= ${from}::date)
          AND (${to}::date IS NULL OR date <= ${to}::date)
      `),
      // Revenue Membership dari accounting_entries
      db.execute(sql`
        SELECT COALESCE(SUM(total_debit), 0) AS amount
        FROM accounting_entries
        WHERE source = 'sport_center_membership'
          AND status = 'posted'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
          AND (${from}::date IS NULL OR date >= ${from}::date)
          AND (${to}::date IS NULL OR date <= ${to}::date)
      `),
      // Refund dari accounting_entries
      db.execute(sql`
        SELECT COALESCE(SUM(total_debit), 0) AS amount
        FROM accounting_entries
        WHERE source IN ('sport_center_refund', 'sport_center_booking_refund', 'sport_center_booking_reversal')
          AND status = 'posted'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
          AND (${from}::date IS NULL OR date >= ${from}::date)
          AND (${to}::date IS NULL OR date <= ${to}::date)
      `),
      // Operational Expense
      db.execute(sql`
        SELECT COALESCE(SUM(total_debit), 0) AS amount
        FROM accounting_entries
        WHERE source = 'sport_center_operational_expense'
          AND status = 'posted'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
          AND (${from}::date IS NULL OR date >= ${from}::date)
          AND (${to}::date IS NULL OR date <= ${to}::date)
      `),
      // Bookings count (active/completed)
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_bookings
        WHERE status NOT IN ('cancelled')
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${from}::date IS NULL OR booking_date >= ${from}::date)
          AND (${to}::date IS NULL OR booking_date <= ${to}::date)
      `),
      // Active members
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_members
        WHERE status = 'active'
          AND (${cId}::int IS NULL OR company_id = ${cId})
      `),
      // Revenue per bulan (booking + membership + expense) dari accounting_entries
      db.execute(sql`
        SELECT
          TO_CHAR(date, 'YYYY-MM') AS month,
          COALESCE(SUM(CASE WHEN source = 'sport_center_booking' THEN total_debit ELSE 0 END), 0) AS booking_revenue,
          COALESCE(SUM(CASE WHEN source = 'sport_center_membership' THEN total_debit ELSE 0 END), 0) AS membership_revenue,
          COALESCE(SUM(CASE WHEN source = 'sport_center_operational_expense' THEN total_debit ELSE 0 END), 0) AS expense,
          COALESCE(SUM(CASE WHEN source IN ('sport_center_refund','sport_center_booking_refund','sport_center_booking_reversal') THEN total_debit ELSE 0 END), 0) AS refund
        FROM accounting_entries
        WHERE source IN ('sport_center_booking','sport_center_membership','sport_center_operational_expense','sport_center_refund','sport_center_booking_refund','sport_center_booking_reversal')
          AND status = 'posted'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
          AND (${from}::date IS NULL OR date >= ${from}::date)
          AND (${to}::date IS NULL OR date <= ${to}::date)
        GROUP BY TO_CHAR(date, 'YYYY-MM')
        ORDER BY month ASC
      `),
      // Facility booking revenue + refund (dari booking join accounting)
      db.execute(sql`
        SELECT
          b.facility_id,
          b.facility_name,
          COUNT(DISTINCT b.id) AS bookings_count,
          COALESCE(MAX(f.capacity), 1) AS capacity,
          COALESCE(SUM(CASE WHEN ae.source = 'sport_center_booking' AND ae.status = 'posted' THEN ae.total_debit ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN ae.source IN ('sport_center_refund','sport_center_booking_refund','sport_center_booking_reversal') AND ae.status = 'posted' THEN ae.total_debit ELSE 0 END), 0) AS refund
        FROM sport_bookings b
        LEFT JOIN accounting_entries ae ON ae.source_id = b.id
          AND ae.source IN ('sport_center_booking','sport_center_refund','sport_center_booking_refund','sport_center_booking_reversal')
        LEFT JOIN sport_facilities f ON f.id = b.facility_id
        WHERE b.status NOT IN ('cancelled')
          AND (${cId}::int IS NULL OR b.company_id = ${cId})
          AND (${from}::date IS NULL OR b.booking_date >= ${from}::date)
          AND (${to}::date IS NULL OR b.booking_date <= ${to}::date)
          AND (${facilityId}::int IS NULL OR b.facility_id = ${facilityId})
        GROUP BY b.facility_id, b.facility_name
      `),
      // Expense per facility dari accounting_entries.facility_id
      db.execute(sql`
        SELECT
          ae.facility_id,
          COALESCE(SUM(ae.total_debit), 0) AS expense
        FROM accounting_entries ae
        WHERE ae.source = 'sport_center_operational_expense'
          AND ae.status = 'posted'
          AND (${cId}::int IS NULL OR ae.company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR ae.cost_center_id = ${costCenterId})
          AND (${from}::date IS NULL OR ae.date >= ${from}::date)
          AND (${to}::date IS NULL OR ae.date <= ${to}::date)
          AND ae.facility_id IS NOT NULL
        GROUP BY ae.facility_id
      `),
      // Expense per category (Expense Category Breakdown)
      db.execute(sql`
        SELECT
          COALESCE(expense_category, 'other') AS category,
          COALESCE(SUM(total_debit), 0) AS amount
        FROM accounting_entries
        WHERE source = 'sport_center_operational_expense'
          AND status = 'posted'
          AND (${cId}::int IS NULL OR company_id = ${cId})
          AND (${costCenterId}::int IS NULL OR cost_center_id = ${costCenterId})
          AND (${from}::date IS NULL OR date >= ${from}::date)
          AND (${to}::date IS NULL OR date <= ${to}::date)
        GROUP BY COALESCE(expense_category, 'other')
        ORDER BY amount DESC
      `),
      // FASE 6D-C: Occupied hours per facility (jam aktual dari booking)
      db.execute(sql`
        SELECT
          b.facility_id,
          COALESCE(SUM(b.duration_hours), 0)  AS occupied_hours,
          COALESCE(MAX(f.capacity), 1)         AS capacity
        FROM sport_bookings b
        LEFT JOIN sport_facilities f ON f.id = b.facility_id
        WHERE b.status NOT IN ('cancelled')
          AND (${cId}::int IS NULL OR b.company_id = ${cId})
          AND (${from}::date IS NULL OR b.booking_date >= ${from}::date)
          AND (${to}::date IS NULL OR b.booking_date <= ${to}::date)
          AND (${facilityId}::int IS NULL OR b.facility_id = ${facilityId})
        GROUP BY b.facility_id
      `),
    ]);

    const revenueBooking = Number((revenueBookingRes.rows[0] as any)?.amount ?? 0);
    const revenueMembership = Number((revenueMembershipRes.rows[0] as any)?.amount ?? 0);
    const refundAmount = Number((refundRes.rows[0] as any)?.amount ?? 0);
    const operationalExpense = Number((opExpenseRes.rows[0] as any)?.amount ?? 0);
    const totalRevenue = revenueBooking + revenueMembership;
    const netRevenue = totalRevenue - refundAmount;
    const netProfit = netRevenue - operationalExpense;
    const profitMarginPct = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 10000) / 100 : 0;

    const bookingsCount = Number((bookingsCountRes.rows[0] as any)?.cnt ?? 0);

    // Break-even analysis
    const monthSet = new Set((revenueByMonthRes.rows as any[]).map(r => r.month));
    const monthCount = Math.max(monthSet.size, 1);
    const monthlyExpense = operationalExpense / monthCount;
    const avgBookingValue = bookingsCount > 0 ? revenueBooking / bookingsCount : 0;
    const breakEvenBookings = avgBookingValue > 0 ? Math.ceil(monthlyExpense / avgBookingValue) : null;

    // Merge facility revenue + expense
    const expenseByFacility = new Map<number, number>();
    for (const r of facilityExpenseRes.rows as any[]) {
      if (r.facility_id != null) expenseByFacility.set(Number(r.facility_id), Number(r.expense ?? 0));
    }

    // FASE 6D-C: Real occupancy per facility (jam aktual)
    interface OccupancyRow { facility_id: number | null; occupied_hours: number; capacity: number }
    const occupancyByFacility = new Map<number, OccupancyRow>();
    for (const r of facilityOccupancyRes.rows as any[]) {
      if (r.facility_id != null) {
        occupancyByFacility.set(Number(r.facility_id), {
          facility_id: Number(r.facility_id),
          occupied_hours: Number(r.occupied_hours ?? 0),
          capacity: Number(r.capacity ?? 1),
        });
      }
    }
    // Hitung jumlah hari dalam periode untuk available_hours
    const periodDays = (from && to)
      ? Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1)
      : 30;

    const facilityProfitability = (facilityBookingRes.rows as any[]).map(r => {
      const fid = r.facility_id != null ? Number(r.facility_id) : null;
      const rev = Number(r.revenue ?? 0);
      const ref = Number(r.refund ?? 0);
      const exp = fid != null ? (expenseByFacility.get(fid) ?? 0) : 0;
      const cnt = Number(r.bookings_count ?? 0);
      const profit = rev - ref - exp;

      // FASE 6D-C: Occupancy berbasis jam aktual
      const occ = fid != null ? occupancyByFacility.get(fid) : undefined;
      const occupiedHours = occ?.occupied_hours ?? 0;
      const cap = occ?.capacity ?? Number(r.capacity ?? 1);
      // available_hours = kapasitas fasilitas × 14 jam/hari × jumlah hari periode
      const availableHours = Math.max(cap * 14 * periodDays, 1);
      const occupancyPct = Math.min(100, Math.round((occupiedHours / availableHours) * 100));

      return {
        facility_id: fid,
        facility_name: r.facility_name,
        bookings_count: cnt,
        revenue: rev,
        refund: ref,
        expense: exp,
        net_revenue: rev - ref,
        net_profit: profit,
        occupied_hours: occupiedHours,
        available_hours: availableHours,
        occupancy_pct: occupancyPct,
      };
    }).sort((a, b) => b.net_profit - a.net_profit);

    const top5Facilities = facilityProfitability.slice(0, 5);
    const bottom5Facilities = [...facilityProfitability].sort((a, b) => a.net_profit - b.net_profit).slice(0, 5);

    const revenueByMonth = (revenueByMonthRes.rows as any[]).map(r => ({
      month: r.month,
      booking_revenue: Number(r.booking_revenue ?? 0),
      membership_revenue: Number(r.membership_revenue ?? 0),
      total_revenue: Number(r.booking_revenue ?? 0) + Number(r.membership_revenue ?? 0),
      expense: Number(r.expense ?? 0),
      refund: Number(r.refund ?? 0),
      net_profit: Number(r.booking_revenue ?? 0) + Number(r.membership_revenue ?? 0) - Number(r.refund ?? 0) - Number(r.expense ?? 0),
    }));

    const expenseByCategory = (expenseByCategoryRes.rows as any[]).map(r => ({
      category: String(r.category ?? "other"),
      amount: Number(r.amount ?? 0),
    }));

    res.json({
      // KPI
      revenue_booking: revenueBooking,
      revenue_membership: revenueMembership,
      total_revenue: totalRevenue,
      refund_amount: refundAmount,
      net_revenue: netRevenue,
      operational_expense: operationalExpense,
      gross_profit: netRevenue,           // alias: gross = revenue - refund
      net_profit: netProfit,
      profit_margin_pct: profitMarginPct,
      bookings_count: bookingsCount,
      active_members: Number((activeMembersRes.rows[0] as any)?.cnt ?? 0),
      // Break-even
      break_even: {
        monthly_expense: Math.round(monthlyExpense),
        avg_booking_value: Math.round(avgBookingValue),
        break_even_bookings: breakEvenBookings,
      },
      // Facility
      top_facilities: top5Facilities,
      bottom_facilities: bottom5Facilities,
      facility_profitability: facilityProfitability,
      // Time series
      revenue_by_month: revenueByMonth,
      // Category breakdown
      expense_by_category: expenseByCategory,
    });
  } catch (err) {
    console.error("[sport-center] GET /profitability error:", err);
    res.status(500).json({ error: "Gagal memuat data profitabilitas" });
  }
});

// ── FASE 6C: EXPENSE GROUPING ────────────────────────────────────────────────

router.get("/expense-grouping", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : null;
    const category = req.query.category ? String(req.query.category) : null;

    const rows = await db.execute(sql`
      SELECT
        ae.facility_id,
        sf.name                          AS facility_name,
        ae.expense_category              AS category,
        TO_CHAR(ae.date, 'YYYY-MM')      AS month,
        COALESCE(SUM(ae.total_debit), 0) AS total_amount,
        COUNT(*)                         AS entry_count
      FROM accounting_entries ae
      LEFT JOIN sport_facilities sf ON sf.id = ae.facility_id
      WHERE ae.source = 'sport_center_operational_expense'
        AND ae.status = 'posted'
        AND (${cId}::int IS NULL        OR ae.company_id    = ${cId})
        AND (${from}::date IS NULL       OR ae.date         >= ${from}::date)
        AND (${to}::date IS NULL         OR ae.date         <= ${to}::date)
        AND (${facilityId}::int IS NULL  OR ae.facility_id  = ${facilityId})
        AND (${category}::text IS NULL   OR ae.expense_category = ${category})
      GROUP BY ae.facility_id, sf.name, ae.expense_category, TO_CHAR(ae.date, 'YYYY-MM')
      ORDER BY month ASC, total_amount DESC
    `);

    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /expense-grouping error:", err);
    res.status(500).json({ error: "Gagal memuat expense grouping" });
  }
});

// ── FASE 6C: RECURRING EXPENSES CRUD ─────────────────────────────────────────

router.get("/recurring-expenses", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : null;
    const rows = await db.execute(sql`
      SELECT re.*, sf.name AS facility_name
      FROM recurring_expenses re
      LEFT JOIN sport_facilities sf ON sf.id = re.facility_id
      WHERE (${cId}::int IS NULL       OR re.company_id  = ${cId})
        AND (${facilityId}::int IS NULL OR re.facility_id = ${facilityId})
      ORDER BY re.is_active DESC, re.next_run ASC NULLS LAST, re.name ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /recurring-expenses error:", err);
    res.status(500).json({ error: "Gagal memuat recurring expenses" });
  }
});

router.post("/recurring-expenses", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const {
      company_id, facility_id, name, description, amount,
      frequency = "monthly", next_run, is_active = true, category,
    } = req.body as Record<string, unknown>;

    if (!name) return res.status(400).json({ error: "name wajib diisi" });
    if (amount === undefined || amount === null) return res.status(400).json({ error: "amount wajib diisi" });

    // Validasi: Sport Center expense wajib punya facility_id
    if (!facility_id) {
      return res.status(400).json({ error: "facility_id wajib diisi untuk recurring expense Sport Center" });
    }

    const r = await db.execute(sql`
      INSERT INTO recurring_expenses
        (company_id, facility_id, name, description, amount, frequency, next_run, is_active, category)
      VALUES
        (${company_id ?? 1}, ${facility_id}, ${name}, ${description ?? null},
         ${String(amount)}, ${frequency}, ${next_run ?? null}, ${is_active}, ${category ?? null})
      RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error("[sport-center] POST /recurring-expenses error:", err);
    res.status(500).json({ error: "Gagal membuat recurring expense" });
  }
});

router.put("/recurring-expenses/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const reLookup = await db.execute(sql`SELECT company_id FROM recurring_expenses WHERE id = ${id}`);
    if (!reLookup.rows.length) return res.status(404).json({ error: "Not found" });
    const cIdRe = resolveCompanyId(req);
    if (!await assertCompanyAccess((reLookup.rows[0] as any).company_id as number | null, cIdRe, req, res, { resourceType: "sport_recurring_expense", resourceId: id })) return;
    const {
      name, description, amount, frequency, next_run, is_active, facility_id, category,
    } = req.body as Record<string, unknown>;

    const r = await db.execute(sql`
      UPDATE recurring_expenses SET
        name        = COALESCE(${name ?? null}, name),
        description = COALESCE(${description ?? null}, description),
        amount      = COALESCE(${amount !== undefined ? String(amount) : null}, amount::text)::numeric,
        frequency   = COALESCE(${frequency ?? null}, frequency),
        next_run    = COALESCE(${next_run ?? null}, next_run),
        is_active   = COALESCE(${is_active ?? null}, is_active),
        facility_id = COALESCE(${facility_id ?? null}, facility_id),
        category    = COALESCE(${category ?? null}, category),
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[sport-center] PUT /recurring-expenses/:id error:", err);
    res.status(500).json({ error: "Gagal update recurring expense" });
  }
});

router.delete("/recurring-expenses/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const reDelLookup = await db.execute(sql`SELECT company_id FROM recurring_expenses WHERE id = ${id}`);
    if (!reDelLookup.rows.length) return res.status(404).json({ error: "Not found" });
    const cIdReDel = resolveCompanyId(req);
    if (!await assertCompanyAccess((reDelLookup.rows[0] as any).company_id as number | null, cIdReDel, req, res, { resourceType: "sport_recurring_expense", resourceId: id })) return;
    await db.execute(sql`DELETE FROM recurring_expenses WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[sport-center] DELETE /recurring-expenses/:id error:", err);
    res.status(500).json({ error: "Gagal hapus recurring expense" });
  }
});

// ── SPORT EXPENSES CRUD ───────────────────────────────────────────────────────

/**
 * GET /api/sport-center/expenses
 * List semua sport expenses dengan filter opsional.
 */
router.get("/expenses", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const category = req.query.category ? String(req.query.category) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const rows = await db.execute(sql`
      SELECT se.*, sf.name AS facility_name
      FROM sport_expenses se
      LEFT JOIN sport_facilities sf ON sf.id = se.facility_id
      WHERE (${cId}::int IS NULL          OR se.company_id  = ${cId})
        AND (${facilityId}::int IS NULL   OR se.facility_id = ${facilityId})
        AND (${status}::text IS NULL      OR se.status      = ${status})
        AND (${category}::text IS NULL    OR se.category    = ${category})
        AND (${from}::date IS NULL        OR se.date       >= ${from}::date)
        AND (${to}::date IS NULL          OR se.date       <= ${to}::date)
      ORDER BY se.date DESC, se.id DESC
    `);

    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /expenses error:", err);
    res.status(500).json({ error: "Gagal memuat sport expenses" });
  }
});

/**
 * GET /api/sport-center/expenses/summary
 * Ringkasan total expense per kategori & fasilitas dalam rentang tanggal.
 */
router.get("/expenses/summary", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : null;

    const rows = await db.execute(sql`
      SELECT
        se.facility_id,
        sf.name                          AS facility_name,
        se.category,
        TO_CHAR(se.date, 'YYYY-MM')      AS month,
        COALESCE(SUM(se.amount), 0)      AS total_amount,
        COUNT(*)                         AS expense_count
      FROM sport_expenses se
      LEFT JOIN sport_facilities sf ON sf.id = se.facility_id
      WHERE se.status != 'void'
        AND (${cId}::int IS NULL          OR se.company_id  = ${cId})
        AND (${from}::date IS NULL        OR se.date       >= ${from}::date)
        AND (${to}::date IS NULL          OR se.date       <= ${to}::date)
        AND (${facilityId}::int IS NULL   OR se.facility_id = ${facilityId})
      GROUP BY se.facility_id, sf.name, se.category, TO_CHAR(se.date, 'YYYY-MM')
      ORDER BY month ASC, total_amount DESC
    `);

    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /expenses/summary error:", err);
    res.status(500).json({ error: "Gagal memuat ringkasan expenses" });
  }
});

/**
 * GET /api/sport-center/expenses/:id
 */
router.get("/expenses/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(String(req.params.id));
    const rows = await db.execute(sql`
      SELECT se.*, sf.name AS facility_name
      FROM sport_expenses se
      LEFT JOIN sport_facilities sf ON sf.id = se.facility_id
      WHERE se.id = ${id}
      LIMIT 1
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found" });
    // IDOR guard
    const cIdExpGet = resolveCompanyId(req);
    if (!await assertCompanyAccess((rows.rows[0] as any).company_id as number | null, cIdExpGet, req, res, { resourceType: "sport_expense", resourceId: id })) return;
    res.json(rows.rows[0]);
  } catch (err) {
    console.error("[sport-center] GET /expenses/:id error:", err);
    res.status(500).json({ error: "Gagal memuat sport expense" });
  }
});

/**
 * POST /api/sport-center/expenses
 * Buat expense baru (status draft atau langsung posted).
 * Jika status = 'posted', otomatis buat journal entry accounting.
 */
router.post("/expenses", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const {
      company_id, facility_id, date, category, description,
      amount, payment_method = "cash", status = "draft", notes,
    } = req.body as Record<string, unknown>;

    if (!date) return res.status(400).json({ error: "date wajib diisi" });
    if (!category) return res.status(400).json({ error: "category wajib diisi" });
    if (amount === undefined || amount === null) return res.status(400).json({ error: "amount wajib diisi" });
    if (!facility_id) return res.status(400).json({ error: "facility_id wajib diisi" });

    const companyId = company_id ? Number(company_id) : 1;
    const createdBy = (req as unknown as Record<string, unknown>).user
      ? String((req as unknown as Record<string, unknown>).user)
      : null;

    // Generate expense_number: SC-EXP/YYYY/NNNNNN
    const year = new Date(String(date)).getFullYear();
    const seqRow = await db.execute(sql`
      SELECT COALESCE(MAX(CAST(SPLIT_PART(expense_number, '/', 3) AS INTEGER)), 0) + 1 AS next_seq
      FROM sport_expenses
      WHERE expense_number LIKE ${'SC-EXP/' + year + '/%'}
    `);
    const seq = String((seqRow.rows[0] as Record<string, unknown>)?.next_seq ?? 1).padStart(6, "0");
    const expenseNumber = `SC-EXP/${year}/${seq}`;

    const r = await db.execute(sql`
      INSERT INTO sport_expenses
        (company_id, facility_id, expense_number, date, category, description,
         amount, payment_method, status, notes, created_by)
      VALUES
        (${companyId}, ${facility_id ?? null}, ${expenseNumber}, ${String(date)},
         ${String(category)}, ${description ?? null},
         ${String(amount)}, ${String(payment_method)}, 'draft', ${notes ?? null}, ${createdBy})
      RETURNING *
    `);
    const expense = r.rows[0] as Record<string, unknown>;

    // Auto-post jika status = 'posted'
    if (status === "posted") {
      const entryId = await postSportCenterExpenseEntry({
        expenseId: Number(expense.id),
        expenseNumber,
        facilityId: facility_id ? Number(facility_id) : null,
        category: String(category),
        description: description ? String(description) : null,
        amount: Number(amount),
        paymentMethod: String(payment_method) as "cash" | "transfer" | "hutang",
        date: String(date),
        companyId,
      });

      await db.execute(sql`
        UPDATE sport_expenses
        SET status = 'posted', entry_id = ${entryId ?? null}, updated_at = NOW()
        WHERE id = ${expense.id}
      `);
      expense.status = "posted";
      expense.entry_id = entryId;
    }

    res.status(201).json(expense);
  } catch (err) {
    console.error("[sport-center] POST /expenses error:", err);
    res.status(500).json({ error: "Gagal membuat sport expense" });
  }
});

/**
 * PUT /api/sport-center/expenses/:id
 * Update expense (hanya boleh jika status masih draft).
 */
router.put("/expenses/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(String(req.params.id));
    const {
      facility_id, date, category, description,
      amount, payment_method, notes,
    } = req.body as Record<string, unknown>;

    const check = await db.execute(sql`SELECT status, company_id FROM sport_expenses WHERE id = ${id} LIMIT 1`);
    if (!check.rows.length) return res.status(404).json({ error: "Not found" });
    // IDOR guard
    const cIdExpPut = resolveCompanyId(req);
    if (!await assertCompanyAccess((check.rows[0] as any).company_id as number | null, cIdExpPut, req, res, { resourceType: "sport_expense", resourceId: id })) return;
    if ((check.rows[0] as Record<string, unknown>).status !== "draft") {
      return res.status(400).json({ error: "Hanya expense berstatus draft yang bisa diubah" });
    }

    const r = await db.execute(sql`
      UPDATE sport_expenses SET
        facility_id    = COALESCE(${facility_id ?? null}, facility_id),
        date           = COALESCE(${date ?? null}, date),
        category       = COALESCE(${category ?? null}, category),
        description    = COALESCE(${description ?? null}, description),
        amount         = COALESCE(${amount !== undefined ? String(amount) : null}, amount::text)::numeric,
        payment_method = COALESCE(${payment_method ?? null}, payment_method),
        notes          = COALESCE(${notes ?? null}, notes),
        updated_at     = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[sport-center] PUT /expenses/:id error:", err);
    res.status(500).json({ error: "Gagal update sport expense" });
  }
});

/**
 * PATCH /api/sport-center/expenses/:id/post
 * Post expense draft → buat journal entry accounting.
 */
router.patch("/expenses/:id/post", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(String(req.params.id));
    const rows = await db.execute(sql`SELECT * FROM sport_expenses WHERE id = ${id} LIMIT 1`);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found" });
    const exp = rows.rows[0] as Record<string, unknown>;
    // IDOR guard
    const cIdExpPost = resolveCompanyId(req);
    if (!await assertCompanyAccess(exp["company_id"] as number | null, cIdExpPost, req, res, { resourceType: "sport_expense", resourceId: id })) return;

    if (exp.status === "posted") return res.status(400).json({ error: "Expense sudah diposting" });
    if (exp.status === "void") return res.status(400).json({ error: "Expense sudah divoid" });

    const entryId = await postSportCenterExpenseEntry({
      expenseId: id,
      expenseNumber: String(exp.expense_number),
      facilityId: exp.facility_id ? Number(exp.facility_id) : null,
      category: String(exp.category),
      description: exp.description ? String(exp.description) : null,
      amount: Number(exp.amount),
      paymentMethod: String(exp.payment_method) as "cash" | "transfer" | "hutang",
      date: String(exp.date),
      companyId: exp.company_id ? Number(exp.company_id) : null,
    });

    await db.execute(sql`
      UPDATE sport_expenses
      SET status = 'posted', entry_id = ${entryId ?? null}, updated_at = NOW()
      WHERE id = ${id}
    `);

    res.json({ ok: true, entry_id: entryId, expense_number: exp.expense_number });
  } catch (err) {
    console.error("[sport-center] PATCH /expenses/:id/post error:", err);
    res.status(500).json({ error: "Gagal mem-posting sport expense" });
  }
});

/**
 * PATCH /api/sport-center/expenses/:id/void
 * Void expense yang sudah diposting.
 */
router.patch("/expenses/:id/void", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    const rows = await db.execute(sql`SELECT status, company_id FROM sport_expenses WHERE id = ${id} LIMIT 1`);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found" });
    // IDOR guard
    const cIdExpVoid = resolveCompanyId(req);
    if (!await assertCompanyAccess((rows.rows[0] as any).company_id as number | null, cIdExpVoid, req, res, { resourceType: "sport_expense", resourceId: id })) return;
    if ((rows.rows[0] as Record<string, unknown>).status === "void") {
      return res.status(400).json({ error: "Expense sudah divoid" });
    }

    await db.execute(sql`
      UPDATE sport_expenses SET status = 'void', updated_at = NOW() WHERE id = ${id}
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[sport-center] PATCH /expenses/:id/void error:", err);
    res.status(500).json({ error: "Gagal void sport expense" });
  }
});

/**
 * DELETE /api/sport-center/expenses/:id
 * Hapus expense (hanya jika masih draft).
 */
router.delete("/expenses/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    const check = await db.execute(sql`SELECT status, company_id FROM sport_expenses WHERE id = ${id} LIMIT 1`);
    if (!check.rows.length) return res.status(404).json({ error: "Not found" });
    // IDOR guard
    const cIdExpDel = resolveCompanyId(req);
    if (!await assertCompanyAccess((check.rows[0] as any).company_id as number | null, cIdExpDel, req, res, { resourceType: "sport_expense", resourceId: id })) return;
    if ((check.rows[0] as Record<string, unknown>).status !== "draft") {
      return res.status(400).json({ error: "Hanya expense berstatus draft yang bisa dihapus" });
    }
    await db.execute(sql`DELETE FROM sport_expenses WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[sport-center] DELETE /expenses/:id error:", err);
    res.status(500).json({ error: "Gagal hapus sport expense" });
  }
});

// ── MEMBER REMINDER WA ────────────────────────────────────────────────────────

/**
 * POST /api/sport-center/member-reminders/run
 * Trigger manual pengiriman reminder WA ke member yang akan expired.
 */
router.post("/member-reminders/run", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { runMemberReminders } = await import("./memberReminderWorker.js");
    const daysAhead = req.body?.daysAhead;
    let reminders;
    if (daysAhead !== undefined) {
      const d = Number(daysAhead);
      if (isNaN(d) || d < 1 || d > 90) {
        return res.status(400).json({ error: "daysAhead harus antara 1–90" });
      }
      reminders = [{ daysAhead: d, reminderType: `${d}days`, label: `${d} hari lagi` }];
    }
    const result = await runMemberReminders(reminders);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sport-center] POST /member-reminders/run error:", err);
    res.status(500).json({ error: "Gagal menjalankan reminder" });
  }
});

/**
 * POST /api/sport-center/member-reminders/test-wa
 * Kirim test WA ke nomor HP tertentu menggunakan template yang sedang aktif.
 */
router.post("/member-reminders/test-wa", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { phone, template, center_name, days_label, end_date, company_id } = req.body as Record<string, string | undefined>;
    if (!phone?.trim()) {
      return res.status(400).json({ error: "Nomor HP wajib diisi" });
    }

    const { getWaTemplate } = await import("./memberReminderWorker.js");
    const cId = company_id ? Number(company_id) : null;
    const { template: dbTemplate, centerName: dbCenterName } = await getWaTemplate(cId);

    const useTemplate   = template?.trim()     || dbTemplate;
    const useCenterName = center_name?.trim()  || dbCenterName;
    const useDaysLabel  = days_label?.trim()   || "4 hari lagi";
    const useEndDate    = end_date?.trim()      || new Intl.DateTimeFormat("id-ID", {
      day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta",
    }).format(new Date(Date.now() + 4 * 86400_000));

    const message = useTemplate
      .replace(/\{\{name\}\}/g,        "Test Member")
      .replace(/\{\{end_date\}\}/g,    useEndDate)
      .replace(/\{\{days_label\}\}/g,  useDaysLabel)
      .replace(/\{\{center_name\}\}/g, useCenterName);

    const { sendViaService } = await import("../../lib/waTransport.js");
    await sendViaService(phone.trim(), message, {
      context: "sport_member_reminder_test",
      refType:  "test",
      refId:    `test_${Date.now()}`,
    });

    res.json({ ok: true, phone: phone.trim(), message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sport-center] POST /member-reminders/test-wa error:", err);
    res.status(500).json({ error: msg || "Gagal kirim test WA" });
  }
});

/**
 * GET /api/sport-center/member-reminders/logs
 * Ambil log reminder WA member terbaru.
 */
router.get("/member-reminders/logs", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { getMemberReminderLogs } = await import("./memberReminderWorker.js");
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const logs = await getMemberReminderLogs(limit);
    res.json(logs);
  } catch (err) {
    console.error("[sport-center] GET /member-reminders/logs error:", err);
    res.status(500).json({ error: "Gagal memuat log" });
  }
});

/**
 * GET /api/sport-center/member-reminders/upcoming
 * Daftar member yang akan menerima reminder dalam N hari ke depan.
 */
router.get("/member-reminders/upcoming", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const rows = await db.execute(sql`
      SELECT
        m.id,
        m.name,
        m.phone,
        m.email,
        m.member_number,
        m.member_type,
        m.end_date,
        m.status,
        (m.end_date::date - CURRENT_DATE) AS days_remaining
      FROM sport_members m
      WHERE m.status = 'active'
        AND m.end_date IS NOT NULL
        AND m.end_date::date >= CURRENT_DATE
        AND m.end_date::date <= (CURRENT_DATE + ${days} * INTERVAL '1 day')::date
        AND (${cId}::int IS NULL OR m.company_id = ${cId})
      ORDER BY m.end_date ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /member-reminders/upcoming error:", err);
    res.status(500).json({ error: "Gagal memuat data" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TAGIHAN PERUSAHAAN — Company Clients & Invoices
// ═══════════════════════════════════════════════════════════════════════════

async function nextCompanyInvoiceNumber(companyId: number, year: number, month: number): Promise<string> {
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, "0");
  const res = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM sport_company_invoices
    WHERE company_id = ${companyId}
      AND period_year = ${year}
      AND period_month = ${month}
  `);
  const seq = Number((res.rows[0] as any).cnt) + 1;
  return `INV-${year}${mm}-${String(seq).padStart(4, "0")}`;
}

// ── Company Clients ──────────────────────────────────────────────────────────

router.get("/company-clients", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : 1;
    const rows = await db.execute(sql`
      SELECT * FROM sport_company_clients
      WHERE company_id = ${cId} AND is_active = TRUE
      ORDER BY name ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /company-clients error:", err);
    res.status(500).json({ error: "Gagal memuat data" });
  }
});

router.post("/company-clients", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { name, pic_name, pic_phone, pic_email, address, notes, company_id } = req.body;
    if (!name) return res.status(400).json({ error: "Nama perusahaan wajib diisi" });
    const cId = company_id ? Number(company_id) : 1;
    const r = await db.execute(sql`
      INSERT INTO sport_company_clients (company_id, name, pic_name, pic_phone, pic_email, address, notes)
      VALUES (${cId}, ${name}, ${pic_name ?? null}, ${pic_phone ?? null}, ${pic_email ?? null}, ${address ?? null}, ${notes ?? null})
      RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error("[sport-center] POST /company-clients error:", err);
    res.status(500).json({ error: "Gagal menyimpan data" });
  }
});

router.put("/company-clients/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const ccLookup = await db.execute(sql`SELECT company_id FROM sport_company_clients WHERE id = ${id}`);
    if (!ccLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdCc = resolveCompanyId(req);
    if (!await assertCompanyAccess((ccLookup.rows[0] as any).company_id as number | null, cIdCc, req, res, { resourceType: "sport_company_client", resourceId: id })) return;
    const { name, pic_name, pic_phone, pic_email, address, notes } = req.body;
    const r = await db.execute(sql`
      UPDATE sport_company_clients
      SET name      = ${name ?? null},
          pic_name  = ${pic_name ?? null},
          pic_phone = ${pic_phone ?? null},
          pic_email = ${pic_email ?? null},
          address   = ${address ?? null},
          notes     = ${notes ?? null},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[sport-center] PUT /company-clients/:id error:", err);
    res.status(500).json({ error: "Gagal memperbarui data" });
  }
});

router.delete("/company-clients/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const ccDelLookup = await db.execute(sql`SELECT company_id FROM sport_company_clients WHERE id = ${id}`);
    if (!ccDelLookup.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const cIdCcDel = resolveCompanyId(req);
    if (!await assertCompanyAccess((ccDelLookup.rows[0] as any).company_id as number | null, cIdCcDel, req, res, { resourceType: "sport_company_client", resourceId: id })) return;
    await db.execute(sql`UPDATE sport_company_clients SET is_active = FALSE, updated_at = NOW() WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[sport-center] DELETE /company-clients/:id error:", err);
    res.status(500).json({ error: "Gagal menghapus data" });
  }
});

// ── Company Invoices ─────────────────────────────────────────────────────────

router.get("/company-invoices", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : 1;
    const statusFilter = req.query.status ? String(req.query.status) : null;
    const clientId = req.query.clientId ? Number(req.query.clientId) : null;
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = 50;
    const offset = (page - 1) * limit;

    const [dataRes, countRes] = await Promise.all([
      db.execute(sql`
        SELECT i.*, c.name AS client_name, c.pic_name, c.pic_phone, c.pic_email,
               (SELECT COUNT(*) FROM sport_company_invoice_items WHERE invoice_id = i.id) AS item_count
        FROM sport_company_invoices i
        JOIN sport_company_clients c ON c.id = i.client_id
        WHERE i.company_id = ${cId}
          AND (${statusFilter}::text IS NULL OR i.status = ${statusFilter})
          AND (${clientId}::int IS NULL OR i.client_id = ${clientId})
          AND (${search}::text IS NULL OR i.invoice_number ILIKE ${search} OR c.name ILIKE ${search})
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM sport_company_invoices i
        JOIN sport_company_clients c ON c.id = i.client_id
        WHERE i.company_id = ${cId}
          AND (${statusFilter}::text IS NULL OR i.status = ${statusFilter})
          AND (${clientId}::int IS NULL OR i.client_id = ${clientId})
          AND (${search}::text IS NULL OR i.invoice_number ILIKE ${search} OR c.name ILIKE ${search})
      `),
    ]);
    res.json({ data: dataRes.rows, total: Number((countRes.rows[0] as any).cnt) });
  } catch (err) {
    console.error("[sport-center] GET /company-invoices error:", err);
    res.status(500).json({ error: "Gagal memuat data" });
  }
});

router.get("/company-invoices/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(String(req.params.id));
    const [invRes, itemsRes] = await Promise.all([
      db.execute(sql`
        SELECT i.*, c.name AS client_name, c.pic_name, c.pic_phone, c.pic_email, c.address AS client_address
        FROM sport_company_invoices i
        JOIN sport_company_clients c ON c.id = i.client_id
        WHERE i.id = ${id}
      `),
      db.execute(sql`
        SELECT * FROM sport_company_invoice_items WHERE invoice_id = ${id} ORDER BY booking_date ASC, id ASC
      `),
    ]);
    if (!invRes.rows.length) return res.status(404).json({ error: "Invoice tidak ditemukan" });
    // IDOR guard
    const cIdInv = resolveCompanyId(req);
    if (!await assertCompanyAccess((invRes.rows[0] as any).company_id as number | null, cIdInv, req, res, { resourceType: "sport_company_invoice", resourceId: id })) return;
    res.json({ invoice: invRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    console.error("[sport-center] GET /company-invoices/:id error:", err);
    res.status(500).json({ error: "Gagal memuat detail invoice" });
  }
});

/**
 * POST /api/sport-center/company-invoices/generate
 * Generate invoice dari booking yang belum ditagih untuk satu klien perusahaan dalam periode tertentu.
 */
router.post("/company-invoices/generate", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { client_id, period_month, period_year, tax_rate, notes, company_id, booking_ids } = req.body;
    if (!client_id || !period_month || !period_year) {
      return res.status(400).json({ error: "client_id, period_month, period_year wajib diisi" });
    }
    const cId = company_id ? Number(company_id) : 1;
    const month = Number(period_month);
    const year = Number(period_year);
    const taxRate = Number(tax_rate ?? 11);

    // Cek klien
    const clientRes = await db.execute(sql`SELECT * FROM sport_company_clients WHERE id = ${Number(client_id)} AND company_id = ${cId}`);
    if (!clientRes.rows.length) return res.status(404).json({ error: "Klien tidak ditemukan" });
    const client = clientRes.rows[0] as any;

    // Ambil bookings yang akan ditagih
    let bookingsRes;
    if (booking_ids && Array.isArray(booking_ids) && booking_ids.length > 0) {
      const ids = booking_ids.map(Number);
      bookingsRes = await db.execute(sql`
        SELECT sb.*, COALESCE(sf.name, sb.facility_name) AS facility_name_resolved
        FROM sport_bookings sb
        LEFT JOIN sport_facilities sf ON sf.id = sb.facility_id
        WHERE sb.id = ANY(${ids}::int[])
          AND (sb.company_id = ${cId} OR sb.company_id IS NULL)
      `);
    } else {
      // Ambil semua booking bulan tersebut yang belum ditagih, atas nama klien
      bookingsRes = await db.execute(sql`
        SELECT sb.*, COALESCE(sf.name, sb.facility_name) AS facility_name_resolved
        FROM sport_bookings sb
        LEFT JOIN sport_facilities sf ON sf.id = sb.facility_id
        WHERE (sb.company_id = ${cId} OR sb.company_id IS NULL)
          AND EXTRACT(MONTH FROM sb.booking_date) = ${month}
          AND EXTRACT(YEAR  FROM sb.booking_date) = ${year}
          AND sb.status NOT IN ('cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM sport_company_invoice_items scii
            JOIN sport_company_invoices sci ON sci.id = scii.invoice_id
            WHERE scii.booking_id = sb.id AND sci.status != 'cancelled'
          )
          AND (
            LOWER(sb.customer_name) = LOWER(${client.name})
            OR sb.customer_phone = ${client.pic_phone ?? ''}
          )
        ORDER BY sb.booking_date ASC
      `);
    }

    const bookings = bookingsRes.rows as any[];
    if (!bookings.length) {
      return res.status(400).json({ error: "Tidak ada booking yang bisa ditagih untuk periode ini" });
    }

    const invoiceNumber = await nextCompanyInvoiceNumber(cId, year, month);

    // Hitung total — harga booking sudah INKLUSIF PPN.
    // Ekstrak DPP dan PPN per booking agar tidak double-count PPN.
    // Formula inklusif: PPN = gross × rate / (100 + rate), DPP = gross - PPN
    let subtotal = 0;   // DPP (sum of base-before-tax per booking)
    let taxAmount = 0;  // Total PPN (sum of extracted PPN per booking)
    const bookingLineAmounts = bookings.map((b: any) => {
      const bGross = Number(b.total_amount ?? b.base_amount ?? 0);
      const bTax   = taxRate > 0 ? Math.round(bGross * taxRate / (100 + taxRate)) : 0;
      const bDpp   = bGross - bTax;
      subtotal  += bDpp;
      taxAmount += bTax;
      return { b, bGross, bTax, bDpp };
    });
    const grandTotal = subtotal + taxAmount; // = sum(bGross)

    // Insert invoice
    const invR = await db.execute(sql`
      INSERT INTO sport_company_invoices
        (company_id, client_id, invoice_number, period_month, period_year, subtotal, tax_rate, tax_amount, grand_total, notes, status)
      VALUES
        (${cId}, ${Number(client_id)}, ${invoiceNumber}, ${month}, ${year}, ${subtotal}, ${taxRate}, ${taxAmount}, ${grandTotal}, ${notes ?? null}, 'unpaid')
      RETURNING *
    `);
    const invoice = invR.rows[0] as any;

    // Insert items — simpan DPP per booking (bukan gross)
    for (const { b, bGross, bTax, bDpp } of bookingLineAmounts) {
      await db.execute(sql`
        INSERT INTO sport_company_invoice_items
          (invoice_id, booking_id, booking_number, customer_name, facility_name, booking_date, duration_hours, subtotal, tax_amount, total)
        VALUES
          (${invoice.id}, ${b.id}, ${b.booking_number}, ${b.customer_name}, ${(b.facility_name_resolved ?? b.facility_name)}, ${b.booking_date}, ${Number(b.duration_hours ?? 1)}, ${bDpp}, ${bTax}, ${bGross})
      `);
    }

    res.status(201).json({ invoice, itemCount: bookings.length });
  } catch (err) {
    console.error("[sport-center] POST /company-invoices/generate error:", err);
    res.status(500).json({ error: "Gagal membuat invoice" });
  }
});

router.post("/company-invoices/:id/mark-paid", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const mpLookup = await db.execute(sql`SELECT company_id FROM sport_company_invoices WHERE id = ${id}`);
    if (!mpLookup.rows.length) return res.status(404).json({ error: "Invoice tidak ditemukan" });
    const cIdMp = resolveCompanyId(req);
    if (!await assertCompanyAccess((mpLookup.rows[0] as any).company_id as number | null, cIdMp, req, res, { resourceType: "sport_company_invoice", resourceId: id })) return;
    const r = await db.execute(sql`
      UPDATE sport_company_invoices
      SET status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Invoice tidak ditemukan" });
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[sport-center] POST /company-invoices/:id/mark-paid error:", err);
    res.status(500).json({ error: "Gagal memperbarui status" });
  }
});

/**
 * GET /api/sport-center/sync/logs
 * Ambil riwayat sync log + ringkasan (last facility/booking sync, local counts).
 */
router.get("/sync/logs", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : null;
    const limit = Math.min(50, Number(req.query.limit ?? 20));

    const [logsRes, localBk, localPay, localFac] = await Promise.all([
      db.execute(sql`
        SELECT id, entity, action, entity_id, status, detail, created_at
        FROM sport_sync_logs
        ORDER BY created_at DESC
        LIMIT ${limit}
      `),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${cId}::int IS NULL OR company_id = ${cId})`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_payments WHERE (${cId}::int IS NULL OR company_id = ${cId})`),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_facilities WHERE (${cId}::int IS NULL OR company_id = ${cId})`),
    ]);

    // Last sync per entity
    const lastFacRes = await db.execute(sql`
      SELECT id, entity, action, status, detail, created_at
      FROM sport_sync_logs WHERE entity = 'facility'
      ORDER BY created_at DESC LIMIT 1
    `);
    const lastBkRes = await db.execute(sql`
      SELECT id, entity, action, status, detail, created_at
      FROM sport_sync_logs WHERE entity = 'booking'
      ORDER BY created_at DESC LIMIT 1
    `);

    res.json({
      ok: true,
      recent_logs: logsRes.rows,
      last_facility_sync: lastFacRes.rows[0] ?? null,
      last_booking_sync: lastBkRes.rows[0] ?? null,
      local: {
        bookings:   Number((localBk.rows[0]  as any).cnt),
        payments:   Number((localPay.rows[0] as any).cnt),
        facilities: Number((localFac.rows[0] as any).cnt),
      },
    });
  } catch (err) {
    console.error("[sport-center] sync/logs error:", err);
    res.status(500).json({ error: "Gagal ambil log" });
  }
});

/**
 * GET /api/sport-center/sync/status
 * Cek koneksi ke Supabase sport_center + hitung data lokal vs Supabase.
 * Juga sertakan status circuit breaker DB lokal.
 */
router.get("/sync/status", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;

  // Cek circuit breaker SEBELUM query DB agar tidak block
  const cb = getCircuitBreakerStatus();

  // Hitung data lokal — tidak throw jika DB sementara tidak tersedia (ECIRCUITBREAKER)
  const safeCount = async (query: Promise<any>): Promise<number> => {
    try { return Number((await query).rows[0]?.cnt ?? 0); } catch { return 0; }
  };
  const [localBookings, localPayments, localFacilities] = await Promise.all([
    safeCount(db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_bookings WHERE (${companyId}::int IS NULL OR company_id = ${companyId})`)),
    safeCount(db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_payments WHERE (${companyId}::int IS NULL OR company_id = ${companyId})`)),
    safeCount(db.execute(sql`SELECT COUNT(*) AS cnt FROM sport_facilities WHERE (${companyId}::int IS NULL OR company_id = ${companyId})`)),
  ]);

  // Env vars untuk Supabase — cek ketersediaan (tanpa expose nilainya)
  const isProd = !!process.env.REPLIT_DEPLOYMENT;
  const supaUrl = isProd
    ? (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "")
    : (process.env.SUPABASE_URL_DEV ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "");
  const supaKey = isProd
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
    : (process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");

  const envConfigured = !!(supaUrl && supaKey);
  const supabaseProjectLabel = supaUrl
    ? supaUrl.replace(/^https?:\/\/([^.]+).*$/, "$1")
    : "(not configured)";

  // Test koneksi Supabase sport_center + hitung data remote
  let supabaseOk = false;
  let scBookings = 0;
  let scPayments = 0;
  let scFacilities = 0;
  let supabaseError: string | null = null;

  if (!envConfigured) {
    supabaseError = `Env vars tidak dikonfigurasi — SUPABASE_URL${isProd ? "" : "_DEV"} dan SUPABASE_SERVICE_ROLE_KEY${isProd ? "" : "_DEV"} diperlukan`;
  } else {
    try {
      const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
      const client = getSportCenterSupabaseClient() as any;
      if (client) {
        const [bkRes, payRes, facRes] = await Promise.all([
          client.schema("sport_center").from("bookings").select("id", { count: "exact", head: true }),
          client.schema("sport_center").from("payments").select("id", { count: "exact", head: true }),
          client.schema("sport_center").from("facilities").select("id", { count: "exact", head: true }),
        ]);
        if (!bkRes.error) {
          supabaseOk = true;
          scBookings   = bkRes.count  ?? 0;
          scPayments   = payRes.count ?? 0;
          scFacilities = facRes.count ?? 0;
        } else {
          supabaseError = `Supabase error: ${bkRes.error.message}`;
        }
      } else {
        supabaseError = "Supabase client null (env vars tidak lengkap)";
      }
    } catch (e) {
      supabaseError = String(e instanceof Error ? e.message : e);
    }
  }

  res.json({
    ok: true,
    supabase: {
      connected: supabaseOk,
      error: supabaseError,
      bookings: scBookings,
      payments: scPayments,
      facilities: scFacilities,
      project: supabaseProjectLabel,
      envConfigured,
    },
    local: {
      bookings:   localBookings,
      payments:   localPayments,
      facilities: localFacilities,
    },
    circuitBreaker: {
      open: cb.open,
      openedAt: cb.openedAt,
      remainingCooldownSeconds: cb.remainingCooldownSeconds,
    },
  });
});

/**
 * GET /api/sport-center/sync/debug
 * Audit circuit breaker + root cause analysis. Tidak mengekspos secret.
 */
router.get("/sync/debug", async (req, res) => {
  // Log request masuk untuk diagnostik
  console.info("[sync/debug] request masuk", {
    authenticated: req.isAuthenticated?.(),
    isInternalSession: (req as any).isInternalSession,
    userId: (req.user as any)?.id,
    userRole: (req.user as any)?.role,
  });

  if (!await requireAdmin(req, res)) {
    console.warn("[sync/debug] auth ditolak — bukan admin atau sesi tidak valid");
    return;
  }

  console.info("[sync/debug] auth OK, mulai audit...");

  // Minimal payload — returned even if everything else fails
  const cb = getCircuitBreakerStatus();
  console.info("[sync/debug] circuit breaker", cb);

  const isProd = !!process.env.REPLIT_DEPLOYMENT;

  // Wrap semua logic dalam try-catch agar tidak pernah return 500 karena data kosong
  try {

  // ── DB & Supabase env resolution ──────────────────────────────────────────
  const supaUrl = isProd
    ? (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "")
    : (process.env.SUPABASE_URL_DEV ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "");
  const supaKey = isProd
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
    : (process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");

  const dbUrlRaw = isProd
    ? (process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL ?? "")
    : (process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL ?? "");

  const dbMasked  = dbUrlRaw  ? dbUrlRaw.replace(/\/\/[^@]+@/, "//***@").split("?")[0] : "(not set)";
  const dbMode    = isProd ? "production" : "development";
  const dbHost    = dbUrlRaw  ? (dbUrlRaw.match(/@([^:/]+)/) ?? [])[1] ?? "unknown" : "unknown";
  const supabaseProject = supaUrl ? supaUrl.replace(/^https?:\/\/([^.]+).*$/, "$1") : "(not set)";

  // ── Kategorisasi error ────────────────────────────────────────────────────
  type ErrorCategory = "database" | "auth" | "duplicate" | "validation" | "schema_mismatch" | "foreign_key" | "network" | "other";
  function categorize(msg: string | null): ErrorCategory {
    const m = (msg ?? "").toLowerCase();
    if (m.includes("ecircuitbreaker") || m.includes("cooldown") || m.includes("timeout") || m.includes("connect")) return "database";
    if (m.includes("authentication") || m.includes("unauthorized") || m.includes("jwt") || m.includes("forbidden")) return "auth";
    if (m.includes("duplicate") || m.includes("unique") || m.includes("already exists") || m.includes("conflict")) return "duplicate";
    if (m.includes("foreign key") || m.includes("violates foreign") || m.includes("fk_")) return "foreign_key";
    if (m.includes("schema") || m.includes("column") || m.includes("does not exist") || m.includes("no such")) return "schema_mismatch";
    if (m.includes("invalid") || m.includes("null value") || m.includes("not null") || m.includes("check constraint")) return "validation";
    if (m.includes("econnrefused") || m.includes("fetch") || m.includes("network") || m.includes("enotfound")) return "network";
    return "other";
  }

  type LogEntry = {
    id: number; entity: string; action: string; entity_id: number | null;
    status: string; detail: string | null; company_id: number | null; created_at: string;
    errorCategory: ErrorCategory;
  };
  type CountByCategory = Record<ErrorCategory, number>;

  let recentErrors: LogEntry[] = [];
  let lastSuccessAt: string | null = null;
  let errorsByCategory: CountByCategory = {
    database: 0, auth: 0, duplicate: 0, validation: 0, schema_mismatch: 0, foreign_key: 0, network: 0, other: 0
  };
  let firstEcbOpeningError: LogEntry | null = null;
  let dbAccessible = true;

  try {
    // Ambil 10 error terbaru
    const errRes = await db.execute(sql`
      SELECT id, entity, action, entity_id, status, detail, company_id, created_at
      FROM sport_sync_logs
      WHERE status = 'error'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    recentErrors = (errRes.rows as any[]).map(r => ({
      ...r,
      errorCategory: categorize(r.detail),
    }));

    // Hitung per kategori (semua waktu)
    const allErrRes = await db.execute(sql`
      SELECT detail FROM sport_sync_logs WHERE status = 'error'
    `);
    for (const row of allErrRes.rows as any[]) {
      const cat = categorize(row.detail);
      errorsByCategory[cat] = (errorsByCategory[cat] ?? 0) + 1;
    }

    // Cari error pertama yang bertipe database/auth (kemungkinan yang memicu CB)
    if (cb.open && cb.openedAt) {
      const cbOpenTs = new Date(cb.openedAt);
      const proximityWindow = new Date(cbOpenTs.getTime() + 60_000).toISOString();
      const cbErr = await db.execute(sql`
        SELECT id, entity, action, entity_id, status, detail, company_id, created_at
        FROM sport_sync_logs
        WHERE status = 'error'
          AND (detail ILIKE '%ECIRCUITBREAKER%' OR detail ILIKE '%authentication%' OR detail ILIKE '%timeout%' OR detail ILIKE '%connect%')
          AND created_at <= ${proximityWindow}::timestamptz
        ORDER BY created_at ASC
        LIMIT 1
      `);
      if (cbErr.rows.length > 0) {
        firstEcbOpeningError = { ...(cbErr.rows[0] as any), errorCategory: "database" };
      }
    }

    // Waktu sukses terakhir
    const okRes = await db.execute(sql`
      SELECT created_at FROM sport_sync_logs WHERE status = 'ok'
      ORDER BY created_at DESC LIMIT 1
    `);
    lastSuccessAt = (okRes.rows[0] as any)?.created_at ?? null;
  } catch (dbErr) {
    dbAccessible = false;
    console.warn("[sync/debug] DB tidak bisa diakses (mungkin circuit breaker):", dbErr);
  }

  // ── Root cause analysis ───────────────────────────────────────────────────
  let rootCause: string;
  let affectedFiles: string[] = [];
  let recommendations: string[] = [];

  if (cb.open) {
    const trigger = cb.lastTrigger;
    if (trigger?.message.includes("authentication") || trigger?.source.includes("connect")) {
      rootCause = `pgBouncer memblokir koneksi karena terlalu banyak auth failure — pertama terdeteksi via '${trigger.source}' pada ${trigger.openedAt}. Pesan asli: "${trigger.message}"`;
      affectedFiles = ["lib/db/src/index.ts", "artifacts/api-server/src/modules/sport-center/supabaseSync.ts"];
      recommendations = [
        "Tunggu hingga cooldown CB selesai (~5 menit dari waktu buka).",
        "Verifikasi SUPABASE_DATABASE_URL — pastikan credentials masih valid di Supabase dashboard.",
        "Cek apakah ada background worker yang melakukan retry loop berulang ke DB.",
        "Pertimbangkan kurangi pool.max dari 2 ke 1 untuk mengurangi tekanan auth di pgBouncer.",
      ];
    } else {
      rootCause = trigger
        ? `Circuit breaker terbuka via '${trigger.source}': "${trigger.message}"`
        : "Circuit breaker terbuka — root cause tidak tersimpan (restart server menghapus memory).";
      recommendations = ["Tunggu cooldown selesai, lalu cek log server untuk error sebelum CB terbuka."];
    }
  } else if (!supaUrl || !supaKey) {
    rootCause = `Env vars Supabase belum dikonfigurasi untuk mode ${dbMode}.`;
    affectedFiles = [];
    recommendations = [
      isProd
        ? "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY di Replit Secrets."
        : "Set SUPABASE_URL_DEV + SUPABASE_SERVICE_ROLE_KEY_DEV di Replit Secrets.",
    ];
  } else if (errorsByCategory.schema_mismatch > 0) {
    rootCause = `Schema mismatch antara tabel lokal dan Supabase sport_center (${errorsByCategory.schema_mismatch} error).`;
    affectedFiles = ["artifacts/api-server/src/modules/sport-center/supabaseSync.ts", "artifacts/api-server/src/modules/sport-center/migration.ts"];
    recommendations = ["Jalankan migration terbaru di Supabase sport_center schema.", "Periksa kolom di tabel bookings/facilities/payments Supabase."];
  } else if (errorsByCategory.auth > 0) {
    rootCause = `Auth failure ke Supabase JS client (${errorsByCategory.auth} error) — service role key kemungkinan expired atau salah project.`;
    recommendations = ["Regenerate SUPABASE_SERVICE_ROLE_KEY di Supabase dashboard.", "Pastikan project ID sesuai antara SUPABASE_URL dan service role key."];
  } else if (recentErrors.length === 0 && !dbAccessible) {
    rootCause = "DB lokal tidak dapat diakses saat audit — circuit breaker mungkin baru saja aktif.";
    recommendations = ["Tunggu 5 menit, lalu coba refresh debug."];
  } else {
    rootCause = recentErrors.length > 0
      ? `${recentErrors.length} error sync terakhir — lihat detail di bawah.`
      : "Tidak ada error sync yang ditemukan — sistem normal.";
  }

  console.info("[sync/debug] audit selesai, mengirim response");
  res.json({
    ok: true,
    env: dbMode,
    dbSource: dbMasked,
    dbHost,
    supabaseProject,
    supabaseUrlConfigured: !!supaUrl,
    supabaseKeyConfigured: !!supaKey,
    dbAccessible,
    circuitBreaker: {
      open: cb.open,
      openedAt: cb.openedAt,
      remainingCooldownSeconds: cb.remainingCooldownSeconds,
      lastTrigger: cb.lastTrigger,
    },
    lastSuccessfulSyncAt: lastSuccessAt,
    recentErrors,
    errorsByCategory,
    firstEcbOpeningError,
    rootCause,
    affectedFiles,
    recommendations,
  });

  } catch (fatalErr) {
    // Jangan pernah return 500 — kembalikan minimal payload dengan info CB
    const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error("[sync/debug] fatal error saat audit:", errMsg);
    res.json({
      ok: true,
      env: isProd ? "production" : "development",
      dbSource: "(error saat resolve)",
      dbHost: "unknown",
      supabaseProject: "(error saat resolve)",
      supabaseUrlConfigured: false,
      supabaseKeyConfigured: false,
      dbAccessible: false,
      circuitBreaker: {
        open: cb.open,
        openedAt: cb.openedAt,
        remainingCooldownSeconds: cb.remainingCooldownSeconds,
        lastTrigger: cb.lastTrigger,
      },
      lastSuccessfulSyncAt: null,
      recentErrors: [],
      errorsByCategory: { database: 0, auth: 0, duplicate: 0, validation: 0, schema_mismatch: 0, foreign_key: 0, network: 0, other: 0 },
      firstEcbOpeningError: null,
      rootCause: `Error saat audit: ${errMsg}`,
      affectedFiles: ["artifacts/api-server/src/modules/sport-center/routes.ts"],
      recommendations: ["Lihat log server untuk detail error."],
    });
  }
});

/**
 * POST /api/sport-center/sync/pull-from-supabase
 * Tarik semua booking dari sport_center schema → sport_bookings lokal (idempoten).
 */
router.post("/sync/pull-from-supabase", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const companyId = req.body?.companyId ? Number(req.body.companyId) : 1;
    const bookings = await pullLegacyBookingsFromSupabase();
    const payments = await pullPaymentsFromSupabase(companyId);
    res.json({ ok: true, bookings, payments });
  } catch (err) {
    console.error("[sport-center] sync/pull-from-supabase error:", err);
    res.status(500).json({ error: "Gagal pull dari Supabase" });
  }
});

/**
 * POST /api/sport-center/sync/accounting
 * Sinkronisasi pembayaran confirmed di sport_center → accounting_payments BizPortal.
 */
router.post("/sync/accounting", async (req, res) => {
  const adminKeyBypass = (req.query.adminKey ?? req.body?.adminKey) as string | undefined;
  const isKeyAuth = adminKeyBypass && process.env.PORTAL_ADMIN_KEY && adminKeyBypass === process.env.PORTAL_ADMIN_KEY;
  if (!isKeyAuth && !await requireAdmin(req, res)) return;
  try {
    const companyId = req.body?.companyId ? Number(req.body.companyId) : 1;
    // 1. Pull bookings dulu agar booking lokal up-to-date
    const bookings = await pullLegacyBookingsFromSupabase();
    // 2. Pull payments dari Supabase → sport_payments lokal
    const payments = await pullPaymentsFromSupabase(companyId);
    // 3. Sync confirmed payments → accounting_payments
    const accounting = await syncPaymentsToAccounting(companyId);

    // syncPaymentsToAccounting sudah handle posting JNL via postSportCenterBooking (idempoten)
    // Loop backfill terpisah dihapus untuk mencegah duplikasi JNL entry
    res.json({ ok: true, bookings, payments, accounting });
  } catch (err) {
    console.error("[sport-center] sync/accounting error:", err);
    res.status(500).json({ error: "Gagal sync akuntansi" });
  }
});

/**
 * POST /api/sport-center/accounting/deduplicate
 * Deteksi dan hapus JNL entries duplikat berdasarkan (company_id, ref) yang sama.
 * Strategi: pertahankan entry terawal (id terkecil), cancel/hapus sisanya.
 * Dry-run default (dryRun=true): hanya tampilkan apa yang akan dihapus.
 * Kirim dryRun=false untuk eksekusi nyata.
 */
router.post("/accounting/deduplicate", async (req, res) => {
  const adminKeyBypass = (req.query.adminKey ?? req.body?.adminKey) as string | undefined;
  const isKeyAuth = adminKeyBypass && process.env.PORTAL_ADMIN_KEY && adminKeyBypass === process.env.PORTAL_ADMIN_KEY;
  if (!isKeyAuth && !await requireAdmin(req, res)) return;
  try {
    const companyId = req.body?.companyId ? Number(req.body.companyId) : null;
    const dryRun = req.body?.dryRun !== false; // default dry run

    const dupRes = await db.execute(sql`
      SELECT company_id, ref, COUNT(*) AS cnt,
             MIN(id) AS keep_id,
             ARRAY_AGG(id ORDER BY id) AS all_ids
      FROM accounting_entries
      WHERE source = 'sport_center_booking'
        AND status IN ('posted', 'draft', 'pending_approval', 'approved', 'rejected')
        AND (${companyId}::int IS NULL OR company_id = ${companyId})
      GROUP BY company_id, ref
      HAVING COUNT(*) > 1
      ORDER BY company_id, ref
    `);

    const groups = dupRes.rows as Array<{
      company_id: number;
      ref: string;
      cnt: string;
      keep_id: number;
      all_ids: number[];
    }>;

    if (groups.length === 0) {
      return res.json({ ok: true, message: "Tidak ada JNL duplikat ditemukan", duplicateGroups: 0, deleted: 0, dryRun });
    }

    let deleted = 0;
    const detail: Array<{ ref: string; keepId: number; dupIds: number[] }> = [];

    for (const g of groups) {
      const keepId = Number(g.keep_id);
      const allIds: number[] = Array.isArray(g.all_ids) ? g.all_ids.map(Number) : [];
      const dupIds = allIds.filter((id) => id !== keepId);
      detail.push({ ref: g.ref, keepId, dupIds });

      if (!dryRun && dupIds.length > 0) {
        // Langkah 1: cancel posted entries via cancellation path (trigger izinkan)
        await db.execute(sql`
          UPDATE accounting_entries
          SET status = 'draft',
              cancel_reason = 'DUPLIKAT-VOID: entry duplikat dihapus via deduplicate endpoint',
              cancelled_at  = NOW()
          WHERE id = ANY(${dupIds}::int[]) AND status = 'posted'
        `).catch(() => {});
        // Langkah 2: void payments terkait
        await db.execute(sql`
          UPDATE accounting_payments
          SET status = 'voided'
          WHERE entry_id = ANY(${dupIds}::int[]) AND status = 'posted'
        `).catch(() => {});
        // Langkah 3: hapus FK lain
        await db.execute(sql`DELETE FROM gl_journal_bridge WHERE accounting_entry_id = ANY(${dupIds}::int[])`).catch(() => {});
        await db.execute(sql`UPDATE accounting_payments SET void_entry_id = NULL WHERE void_entry_id = ANY(${dupIds}::int[])`).catch(() => {});
        // Langkah 4: delete entries (sekarang draft → trigger lolos, CASCADE hapus lines)
        await db.execute(sql`DELETE FROM accounting_entries WHERE id = ANY(${dupIds}::int[])`);
        deleted += dupIds.length;
      } else {
        deleted += dupIds.length;
      }
    }

    res.json({
      ok: true,
      dryRun,
      duplicateGroups: groups.length,
      deleted,
      message: dryRun
        ? `[DRY RUN] Ditemukan ${groups.length} grup duplikat, ${deleted} entries akan dihapus. Kirim dryRun=false untuk eksekusi.`
        : `${deleted} JNL duplikat berhasil dihapus.`,
      detail,
    });
  } catch (err) {
    console.error("[sport-center] accounting/deduplicate error:", err);
    res.status(500).json({ error: "Gagal menjalankan deduplication" });
  }
});

/**
 * POST /api/sport-center/sync/run-daily
 * Trigger manual sinkronisasi harian pembayaran Sport Center.
 * Menjalankan: pull bookings → pull payments → sync accounting → update status booking.
 */
router.post("/sync/run-daily", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const companyId = req.body?.companyId ? Number(req.body.companyId) : 1;
    const result = await runDailyPaymentSync(companyId, "manual");
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sport-center] sync/run-daily error:", err);
    res.status(500).json({ error: "Gagal menjalankan sinkronisasi harian" });
  }
});

/**
 * GET /api/sport-center/sync/run-daily/status
 * Status singkat scheduler sync harian (last sync logs).
 */
router.get("/sync/run-daily/status", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const logs = await getLastSyncLogs(10);
    res.json({ ok: true, logs });
  } catch (err) {
    console.error("[sport-center] sync/run-daily/status error:", err);
    res.status(500).json({ error: "Gagal ambil status sync" });
  }
});

router.post("/company-invoices/:id/cancel", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    // IDOR guard
    const invCancelLookup = await db.execute(sql`SELECT company_id FROM sport_company_invoices WHERE id = ${id}`);
    if (!invCancelLookup.rows.length) return res.status(404).json({ error: "Invoice tidak ditemukan" });
    const cIdInvCancel = resolveCompanyId(req);
    if (!await assertCompanyAccess((invCancelLookup.rows[0] as any).company_id as number | null, cIdInvCancel, req, res, { resourceType: "sport_company_invoice", resourceId: id })) return;
    const r = await db.execute(sql`
      UPDATE sport_company_invoices
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id} AND status != 'paid'
      RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Invoice tidak ditemukan atau sudah lunas" });
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[sport-center] POST /company-invoices/:id/cancel error:", err);
    res.status(500).json({ error: "Gagal membatalkan invoice" });
  }
});

/**
 * GET /api/sport-center/company-invoices/bookings-unbilled
 * Daftar booking yang belum ditagih untuk klien tertentu dalam periode tertentu.
 */
router.get("/company-invoices/bookings-unbilled", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const cId = req.query.companyId ? Number(req.query.companyId) : 1;
    const clientId = req.query.clientId ? Number(req.query.clientId) : null;
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;

    if (!clientId) return res.status(400).json({ error: "clientId wajib" });

    // Cari nama klien
    const clientRes = await db.execute(sql`SELECT name, pic_phone FROM sport_company_clients WHERE id = ${clientId}`);
    if (!clientRes.rows.length) return res.status(404).json({ error: "Klien tidak ditemukan" });
    const client = clientRes.rows[0] as any;

    const rows = await db.execute(sql`
      SELECT sb.id, sb.booking_number, sb.customer_name, sb.facility_name,
             sb.booking_date, sb.start_time, sb.end_time, sb.duration_hours,
             sb.total_amount, sb.status, sb.payment_status,
             COALESCE(sf.name, sb.facility_name) AS facility_name_resolved
      FROM sport_bookings sb
      LEFT JOIN sport_facilities sf ON sf.id = sb.facility_id
      WHERE (sb.company_id = ${cId} OR sb.company_id IS NULL)
        AND sb.status NOT IN ('cancelled')
        AND (${month}::int IS NULL OR EXTRACT(MONTH FROM sb.booking_date) = ${month})
        AND (${year}::int  IS NULL OR EXTRACT(YEAR  FROM sb.booking_date) = ${year})
        AND NOT EXISTS (
          SELECT 1 FROM sport_company_invoice_items scii
          JOIN sport_company_invoices sci ON sci.id = scii.invoice_id
          WHERE scii.booking_id = sb.id AND sci.status != 'cancelled'
        )
        AND (
          LOWER(sb.customer_name) = LOWER(${client.name})
          OR (${client.pic_phone}::text IS NOT NULL AND sb.customer_phone = ${client.pic_phone ?? ''})
        )
      ORDER BY sb.booking_date ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    console.error("[sport-center] GET /company-invoices/bookings-unbilled error:", err);
    res.status(500).json({ error: "Gagal memuat data" });
  }
});

/**
 * POST /api/sport-center/sync/full-audit
 * Internal audit endpoint — bypass session auth via PORTAL_ADMIN_KEY.
 * Runs all 3 sync operations, captures every error, returns structured report.
 */
router.post("/sync/full-audit", async (req, res) => {
  const key = (req.query.adminKey ?? req.body?.adminKey ?? req.headers["x-admin-key"]) as string | undefined;
  const envKey = process.env.PORTAL_ADMIN_KEY;
  if (!envKey || key !== envKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const auditErrors: Array<{
    module: string;
    operation: string;
    entityId: number | null;
    entityName: string;
    errorCode: string;
    errorMessage: string;
    category: string;
    retryable: boolean;
  }> = [];

  function categorize(msg: string): string {
    const m = msg.toLowerCase();
    if (m.includes("ecircuitbreaker") || m.includes("cooldown") || m.includes("too many auth")) return "database_cb";
    if (m.includes("authentication") || m.includes("jwt") || m.includes("unauthorized") || m.includes("forbidden")) return "auth";
    if (m.includes("duplicate") || m.includes("unique") || m.includes("already exists") || m.includes("conflict")) return "duplicate";
    if (m.includes("foreign key") || m.includes("violates foreign")) return "foreign_key";
    if (m.includes("not null") || m.includes("null value") || m.includes("violates not-null")) return "validation";
    if (m.includes("does not exist") || m.includes("no such table") || m.includes("relation") || m.includes("column")) return "missing_table_or_column";
    if (m.includes("fetch") || m.includes("network") || m.includes("econnrefused") || m.includes("enotfound")) return "network";
    if (m.includes("timeout") || m.includes("timed out")) return "timeout";
    return "other";
  }

  function isRetryable(cat: string): boolean {
    return ["database_cb", "network", "timeout"].includes(cat);
  }

  const startedAt = new Date().toISOString();

  // ─── 1. Resync Fasilitas ────────────────────────────────────────────────────
  let facilityResult = { synced: 0, errors: 0, total: 0 };
  try {
    // Patch syncAllFacilities to capture per-item errors
    const facRows = await db.execute(sql`SELECT * FROM sport_facilities ORDER BY id ASC`).catch(() => ({ rows: [] as any[] }));
    const rows = facRows.rows as any[];
    facilityResult.total = rows.length;

    let client: any = null;
    try { const { getSportCenterSupabaseClient } = await import("../sport-center/supabaseSync.js" as any); client = null; } catch { }
    try { const m = await import("../../lib/supabaseAdminSportCenter.js" as any); client = m.getSportCenterSupabaseClient?.() ?? null; } catch { }

    for (const row of rows) {
      const code = `facility_${row.id}`;
      const ops = [
        // op 1: sport_center_services
        (async () => {
          const payload = { code, name: row.name, category: row.type ?? "court", description: row.description ?? null, price_per_hour: Math.round(Number(row.price_per_hour ?? 0)), capacity: Number(row.capacity ?? 1), is_active: row.is_active ?? true, sort_order: row.sort_order ?? 0, image_url: row.image_url ?? null, updated_at: new Date().toISOString() };
          if (client) {
            // Manual select-update-insert (no UNIQUE constraint on code in Supabase)
            const { data: existing } = await (client as any).from("sport_center_services").select("id").eq("code", payload.code).maybeSingle();
            if (existing) {
              const { error } = await (client as any).from("sport_center_services").update(payload).eq("code", payload.code);
              if (error) throw new Error(error.message);
            } else {
              const { error } = await (client as any).from("sport_center_services").insert(payload);
              if (error) throw new Error(error.message);
            }
          } else {
            await db.execute(sql`INSERT INTO sport_center_services (code, name, category, description, price_per_hour, capacity, is_active, sort_order, image_url, updated_at) VALUES (${payload.code},${payload.name},${payload.category},${payload.description},${payload.price_per_hour},${payload.capacity},${payload.is_active},${payload.sort_order},${payload.image_url},NOW()) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`);
          }
        })(),
        // op 2: sport_center.sport_facilities
        (async () => {
          if (!client) { throw new Error("Supabase client null — SUPABASE_URL/KEY tidak dikonfigurasi"); }
          const payload = { name: row.name, category: row.type ?? "court", description: row.description ?? null, price_per_hour: Math.round(Number(row.price_per_hour ?? 0)), updated_at: new Date().toISOString() };
          // Manual select-update-insert (no UNIQUE constraint on name in sport_center.sport_facilities)
          const { data: existing } = await (client as any).schema("sport_center").from("facilities").select("id").eq("name", row.name).maybeSingle();
          if (existing) {
            const { error } = await (client as any).schema("sport_center").from("facilities").update(payload).eq("name", row.name);
            if (error) throw new Error(error.message);
          } else {
            const { error } = await (client as any).schema("sport_center").from("facilities").insert(payload);
            if (error) throw new Error(error.message);
          }
        })(),
      ];

      const results = await Promise.allSettled(ops);
      const opNames = ["sport_center_services upsert", "sport_center.sport_facilities upsert"];
      let rowOk = true;
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        if (r.status === "rejected") {
          rowOk = false;
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          const cat = categorize(msg);
          auditErrors.push({ module: "facilities", operation: opNames[i]!, entityId: row.id, entityName: row.name, errorCode: cat.toUpperCase(), errorMessage: msg, category: cat, retryable: isRetryable(cat) });
        }
      }
      if (rowOk) facilityResult.synced++; else facilityResult.errors++;
    }
  } catch (err: any) {
    auditErrors.push({ module: "facilities", operation: "syncAllFacilities", entityId: null, entityName: "ALL", errorCode: "SYNC_FATAL", errorMessage: err?.message ?? String(err), category: categorize(err?.message ?? ""), retryable: false });
  }

  // ─── 2. Resync Booking ──────────────────────────────────────────────────────
  let bookingResult = { synced: 0, errors: 0, total: 0 };
  try {
    const bkRows = await db.execute(sql`SELECT * FROM sport_bookings ORDER BY id ASC`).catch(() => ({ rows: [] as any[] }));
    const rows = bkRows.rows as any[];
    bookingResult.total = rows.length;

    let client: any = null;
    try { const m = await import("../../lib/supabaseAdminSportCenter.js" as any); client = m.getSportCenterSupabaseClient?.() ?? null; } catch { }

    // facility map
    const facilityMap = new Map<string, number>();
    try {
      if (client) {
        // Must use sport_center schema — NOT public.sport_center_facilities
        const { data } = await (client as any).schema("sport_center").from("facilities").select("id, name").limit(200);
        for (const f of (data ?? [])) facilityMap.set((f.name as string).trim().toLowerCase(), f.id as number);
      } else {
        const res = await db.execute(sql`SELECT id, name FROM sport_facilities ORDER BY id`);
        for (const f of res.rows as any[]) facilityMap.set(f.name.trim().toLowerCase(), f.id);
      }
    } catch { }

    for (const row of rows) {
      const facilityId = facilityMap.get((row.facility_name ?? "").trim().toLowerCase()) ?? null;
      const payload: Record<string, unknown> = { booking_code: row.booking_number, customer_name: row.customer_name, customer_email: row.customer_email ?? "", customer_phone: row.customer_phone ?? null, facility_name: row.facility_name, date: row.booking_date, start_time: row.start_time, end_time: row.end_time, total_hours: Number(row.duration_hours ?? 1), total_price: Number(row.total_amount ?? 0), status: row.status, payment_status: row.payment_status ?? "unpaid", notes: row.notes ?? null, updated_at: new Date().toISOString() };
      if (facilityId !== null) payload.facility_id = facilityId;

      try {
        if (client) {
          // Target: sport_center.sport_bookings (schema asli SC) — update only, bookings originate from SC app
          const scPayload: Record<string, unknown> = {
            order_number: row.booking_number,
            customer_name: row.customer_name,
            customer_phone: row.customer_phone ?? null,
            status: row.status,
            updated_at: new Date().toISOString(),
          };
          if (row.payment_status === "paid") scPayload.billing_status = "paid";
          else if (row.payment_status === "partial") scPayload.billing_status = "partial";
          if (facilityId !== null) scPayload.facility_id = facilityId;
          const { data: existing } = await (client as any).schema("sport_center").from("bookings").select("id").eq("order_number", row.booking_number).maybeSingle();
          if (existing) {
            const { error } = await (client as any).schema("sport_center").from("bookings").update(scPayload).eq("order_number", row.booking_number);
            if (error) throw new Error(error.message);
          }
          // If not in Supabase, skip — bookings flow is SC→BizPortal, not reverse
        } else {
          // Supabase client unavailable — data already in sport_bookings (local canonical table). Skip legacy mirror.
          console.log(`[SC sync] booking sync skip (no Supabase client) → order_number=${row.booking_number}`);
        }
        bookingResult.synced++;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        const cat = categorize(msg);
        auditErrors.push({ module: "bookings", operation: "sport_center.sport_bookings update", entityId: row.id, entityName: `${row.booking_number} — ${row.customer_name}`, errorCode: cat.toUpperCase(), errorMessage: msg, category: cat, retryable: isRetryable(cat) });
        bookingResult.errors++;
      }
    }
  } catch (err: any) {
    auditErrors.push({ module: "bookings", operation: "syncAllBookings", entityId: null, entityName: "ALL", errorCode: "SYNC_FATAL", errorMessage: err?.message ?? String(err), category: categorize(err?.message ?? ""), retryable: false });
  }

  // ─── 3. Sync Akuntansi ──────────────────────────────────────────────────────
  let accountingResult = { synced: 0, skipped: 0, errors: 0 };
  try {
    let client: any = null;
    try { const m = await import("../../lib/supabaseAdminSportCenter.js" as any); client = m.getSportCenterSupabaseClient?.() ?? null; } catch { }

    if (!client) {
      auditErrors.push({ module: "accounting", operation: "pullPaymentsFromSupabase", entityId: null, entityName: "ALL", errorCode: "CLIENT_NULL", errorMessage: "Supabase client null — SUPABASE_URL/KEY tidak dikonfigurasi untuk sync akuntansi", category: "auth", retryable: false });
    } else {
      const [paymentsRes, bookingsRes] = await Promise.all([
        (client as any).schema("sport_center").from("payments").select("id, booking_id, amount, payment_method, status, confirmed_at, created_at").eq("status", "confirmed"),
        (client as any).schema("sport_center").from("bookings").select("id, order_number, grand_total, total_price, booking_date"),
      ]);
      if (paymentsRes.error) {
        auditErrors.push({ module: "accounting", operation: "fetch sport_center.sport_payments", entityId: null, entityName: "ALL", errorCode: "SUPABASE_FETCH_ERROR", errorMessage: paymentsRes.error.message, category: categorize(paymentsRes.error.message), retryable: isRetryable(categorize(paymentsRes.error.message)) });
      } else {
        const payments = paymentsRes.data ?? [];
        const bkMap: Record<number, string> = {};
        for (const b of (bookingsRes.data ?? [])) { if (b.id && b.order_number) bkMap[b.id] = b.order_number; }

        for (const pay of payments as any[]) {
          try {
            const existing = await db.execute(sql`SELECT id FROM accounting_payments WHERE source_type = 'sport_center' AND source_doc_id = ${pay.id} LIMIT 1`);
            if (existing.rows.length > 0) { accountingResult.skipped++; continue; }
            const settingsRes = await db.execute(sql`SELECT cash_journal_id, bank_journal_id FROM accounting_settings WHERE company_id = 1 LIMIT 1`);
            const settings = settingsRes.rows[0] as any;
            const destination = resolvePaymentDestination(pay.payment_method, {
              cashJournalId: settings?.cash_journal_id ?? null,
              bankJournalId: settings?.bank_journal_id ?? null,
            });
            const { paymentMethod, journalId } = destination;
            if (!journalId) {
              auditErrors.push({ module: "accounting", operation: "accounting_payments insert", entityId: pay.id, entityName: `pay.id=${pay.id}`, errorCode: "BUSINESS_RULE", errorMessage: "Tidak ada journal kas/bank di accounting_settings company_id=1", category: "other", retryable: false });
              accountingResult.errors++;
              continue;
            }
            const payDate = (pay.confirmed_at ?? pay.created_at ?? "").split("T")[0] ?? new Date().toISOString().split("T")[0]!;
            const year = payDate.slice(0, 4);
            const cntRes = await db.execute(sql`SELECT CAST(COUNT(*) AS int) AS seq FROM accounting_payments WHERE company_id = 1`);
            const seq = Number((cntRes.rows[0] as any)?.seq ?? 0);
            const acctPayNumber = `SCPAY/${year}/${(seq + 1).toString().padStart(4, "0")}`;
            const bk = bkMap[pay.booking_id] ? { order_number: bkMap[pay.booking_id], customer_name: "Customer" } : { order_number: `SC-PAY-${pay.id}`, customer_name: "Customer" };
            await db.execute(sql`INSERT INTO accounting_payments (company_id, payment_number, payment_type, status, amount, journal_id, partner_name, date, ref, memo, payment_method, source_type, source_doc_id) VALUES (1, ${acctPayNumber}, 'inbound', 'posted', ${String(Number(pay.amount))}, ${journalId}, ${bk.customer_name}, ${payDate}, ${bk.order_number}, ${'Sport Center: ' + bk.order_number}, ${paymentMethod}, 'sport_center', ${pay.id})`);
            accountingResult.synced++;
          } catch (err: any) {
            const msg = err?.message ?? String(err);
            auditErrors.push({ module: "accounting", operation: "accounting_payments insert", entityId: pay.id, entityName: `pay.id=${pay.id}`, errorCode: categorize(msg).toUpperCase(), errorMessage: msg, category: categorize(msg), retryable: isRetryable(categorize(msg)) });
            accountingResult.errors++;
          }
        }
      }
    }
  } catch (err: any) {
    auditErrors.push({ module: "accounting", operation: "syncPaymentsToAccounting", entityId: null, entityName: "ALL", errorCode: "SYNC_FATAL", errorMessage: err?.message ?? String(err), category: categorize(err?.message ?? ""), retryable: false });
  }

  // ─── Build audit report ─────────────────────────────────────────────────────
  const groupedByModule: Record<string, typeof auditErrors> = { facilities: [], bookings: [], payments: [], accounting: [] };
  const groupedByCategory: Record<string, typeof auditErrors> = {};
  for (const e of auditErrors) {
    (groupedByModule[e.module] ?? (groupedByModule[e.module] = [])).push(e);
    (groupedByCategory[e.category] ?? (groupedByCategory[e.category] = [])).push(e);
  }
  const dominantCategory = Object.entries(groupedByCategory).sort((a, b) => b[1].length - a[1].length)[0];

  res.json({
    auditAt: startedAt,
    completedAt: new Date().toISOString(),
    totalErrors: auditErrors.length,
    summary: {
      facilities: facilityResult,
      bookings: bookingResult,
      accounting: accountingResult,
    },
    groupedByModule: { facilities: groupedByModule.facilities ?? [], bookings: groupedByModule.bookings ?? [], payments: groupedByModule.payments ?? [], accounting: groupedByModule.accounting ?? [] },
    groupedByCategory,
    dominantCategory: dominantCategory ? { category: dominantCategory[0], count: dominantCategory[1].length } : null,
    errors: auditErrors,
  });
});

/**
 * GET /api/sport-center/sync/accounting-debug
 * Debug: cek isi accounting_payments sport_center + settings + journals
 */
router.get("/sync/accounting-debug", async (req, res) => {
  const key = (req.query.adminKey ?? req.headers["x-admin-key"]) as string | undefined;
  if (!key || key !== process.env.PORTAL_ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [paymentsRes, settingsRes, journalsRes, scPaymentsRes] = await Promise.all([
      db.execute(sql`SELECT id, payment_number, payment_type, status, amount, journal_id, partner_name, date, ref, memo, source_type, source_doc_id, company_id FROM accounting_payments WHERE source_type = 'sport_center' ORDER BY id DESC LIMIT 50`),
      db.execute(sql`SELECT * FROM accounting_settings LIMIT 10`),
      db.execute(sql`SELECT id, name, type, code FROM accounting_journals ORDER BY id LIMIT 50`),
      db.execute(sql`SELECT id, payment_number, payment_type, status, amount, journal_id, partner_name, date, source_type, source_doc_id, company_id FROM accounting_payments ORDER BY id DESC LIMIT 10`),
    ]);

    let scSupabasePayments: any[] = [];
    let scSupabaseError: string | null = null;
    try {
      const { getSportCenterSupabaseClient } = await import("../sport-center/supabaseSync.js" as any);
    } catch { }
    try {
      const m = await import("../../lib/supabaseAdminSportCenter.js" as any);
      const client = m.getSportCenterSupabaseClient?.();
      if (client) {
        const { data, error } = await (client as any).schema("sport_center").from("payments").select("id, booking_id, amount, payment_method, status, confirmed_at, created_at");
        if (error) scSupabaseError = error.message;
        else scSupabasePayments = data ?? [];
      } else {
        scSupabaseError = "client null";
      }
    } catch (e: any) { scSupabaseError = e?.message ?? String(e); }

    // Also check sport_payments and trace pull logic
    const [sportPaymentsRes, sportBookingsRes] = await Promise.all([
      db.execute(sql`SELECT id, booking_id, payment_number, amount, method, status, paid_at, source FROM sport_payments ORDER BY id DESC LIMIT 20`),
      db.execute(sql`SELECT id, booking_number, customer_name, payment_status FROM sport_bookings ORDER BY id DESC LIMIT 20`),
    ]);

    // Trace pullPaymentsFromSupabase for each SC payment
    const pullTrace: any[] = [];
    for (const pay of scSupabasePayments) {
      const scPayNum = `SCPAY-${pay.id}`;
      const existRes = await db.execute(sql`SELECT id FROM sport_payments WHERE payment_number = ${scPayNum} LIMIT 1`).catch(() => ({ rows: [] }));
      const alreadyIn = existRes.rows.length > 0;

      // Try to get SC booking order_number
      let scBookingOrderNumber: string | null = null;
      let localBookingId: number | null = null;
      let localBookingLookupStatus = "not_tried";
      try {
        const m2 = await import("../../lib/supabaseAdminSportCenter.js" as any);
        const c2 = m2.getSportCenterSupabaseClient?.();
        if (c2) {
          const { data: bkData } = await (c2 as any).schema("sport_center").from("bookings").select("id, order_number").eq("id", pay.booking_id).maybeSingle();
          scBookingOrderNumber = bkData?.order_number ?? null;
          if (scBookingOrderNumber) {
            const lbRes = await db.execute(sql`SELECT id FROM sport_bookings WHERE booking_number = ${scBookingOrderNumber} LIMIT 1`).catch(() => ({ rows: [] }));
            if (lbRes.rows.length > 0) {
              localBookingId = Number((lbRes.rows[0] as any).id);
              localBookingLookupStatus = "found_by_order_number";
            } else {
              localBookingLookupStatus = "not_found_by_order_number";
            }
          } else {
            localBookingLookupStatus = "sc_booking_no_order_number";
          }
        }
      } catch (e: any) { localBookingLookupStatus = `error: ${e?.message}`; }

      pullTrace.push({
        sc_payment_id: pay.id,
        sc_booking_id: pay.booking_id,
        amount: pay.amount,
        method: pay.payment_method,
        status: pay.status,
        sc_payment_number: scPayNum,
        already_in_sport_payments: alreadyIn,
        sc_booking_order_number: scBookingOrderNumber,
        local_booking_id: localBookingId,
        local_booking_lookup_status: localBookingLookupStatus,
        will_be_pulled: !alreadyIn && localBookingId !== null,
      });
    }

    res.json({
      accounting_payments_sport_center: paymentsRes.rows,
      accounting_payments_recent_all: paymentsRes.rows.length === 0 ? scPaymentsRes.rows : [],
      accounting_settings: settingsRes.rows,
      accounting_journals: journalsRes.rows,
      supabase_sc_payments: scSupabasePayments,
      supabase_sc_payments_error: scSupabaseError,
      sport_payments: sportPaymentsRes.rows,
      sport_bookings_local: sportBookingsRes.rows,
      pull_trace: pullTrace,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

// ── CLEANUP: Hapus orphaned accounting records sport center ───────────────────
// POST /api/sport-center/cleanup-orphaned-accounting
// Menghapus accounting_payments & entries sport_center yang data sumber-nya sudah tidak ada.
// PAY/ entries: source_doc_id harus ada di public.sport_payments
// SCPAY/ entries: source_doc_id harus ada di sport_center.sport_payments (canonical schema)
// accounting_entries: source_id (booking_id) harus ada di sport_bookings
router.post("/cleanup-orphaned-accounting", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const dryRun = req.body?.dryRun !== false; // default dry run untuk safety

    // PAY/ entries: orphaned jika source_doc_id tidak ada di public.sport_payments
    const orphanedPayRes = await db.execute(sql`
      SELECT ap.id, ap.payment_number, ap.partner_name, ap.amount, ap.date, ap.source_doc_id
      FROM accounting_payments ap
      WHERE ap.source_type = 'sport_center'
        AND ap.source_doc_id IS NOT NULL
        AND ap.payment_number NOT LIKE 'SCPAY%'
        AND NOT EXISTS (
          SELECT 1 FROM sport_payments sp WHERE sp.id = ap.source_doc_id
        )
      ORDER BY ap.date DESC
    `);

    // SCPAY/ entries: orphaned jika source_doc_id tidak ada di sport_center.sport_payments
    // (canonical schema dari aplikasi Sport Center terpisah)
    let orphanedScpayRows: any[] = [];
    try {
      const orphanedScpayRes = await db.execute(sql`
        SELECT ap.id, ap.payment_number, ap.partner_name, ap.amount, ap.date, ap.source_doc_id
        FROM accounting_payments ap
        WHERE ap.source_type = 'sport_center'
          AND ap.source_doc_id IS NOT NULL
          AND ap.payment_number LIKE 'SCPAY%'
          AND NOT EXISTS (
            SELECT 1 FROM sport_center.sport_payments sp WHERE sp.id = ap.source_doc_id
          )
        ORDER BY ap.date DESC
      `);
      orphanedScpayRows = orphanedScpayRes.rows as any[];
    } catch {
      // Jika sport_center schema tidak accessible → skip SCPAY cleanup untuk keamanan
      console.warn("[sport-center] cleanup-orphaned-accounting: sport_center schema tidak accessible, skip SCPAY check");
    }

    const orphanedAp = [...(orphanedPayRes.rows as any[]), ...orphanedScpayRows];

    // accounting_entries orphaned: booking_id tidak ada di sport_bookings
    const orphanedAeRes = await db.execute(sql`
      SELECT ae.id, ae.source, ae.source_id, ae.date, ae.total_debit
      FROM accounting_entries ae
      WHERE ae.source IN ('sport_center_booking', 'sport_center_booking_reversal')
        AND ae.source_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM sport_bookings sb WHERE sb.id = ae.source_id
        )
      ORDER BY ae.date DESC
    `);
    const orphanedAe = orphanedAeRes.rows as any[];

    if (dryRun) {
      return res.json({
        dryRun: true,
        message: `Dry run: ditemukan ${orphanedAp.length} accounting_payments dan ${orphanedAe.length} accounting_entries yang akan dihapus. Kirim dryRun=false untuk eksekusi.`,
        orphaned_accounting_payments: orphanedAp,
        orphaned_accounting_entries: orphanedAe,
      });
    }

    // Eksekusi hapus — pakai raw pool client agar bisa DISABLE TRIGGER
    let deletedAp = 0;
    let deletedAe = 0;

    const pgClient = await pool.connect();
    try {
      await pgClient.query("BEGIN");

      if (orphanedAp.length > 0) {
        const apIds = orphanedAp.map((r: any) => r.id as number);
        const result = await pgClient.query(
          `DELETE FROM accounting_payments WHERE id = ANY($1::int[])`,
          [apIds]
        );
        deletedAp = result.rowCount ?? apIds.length;
      }

      if (orphanedAe.length > 0) {
        const aeIds = orphanedAe.map((r: any) => r.id as number);
        // Disable delete-block trigger untuk posted entries
        await pgClient.query("ALTER TABLE accounting_entries DISABLE TRIGGER trg_block_posted_delete");
        await pgClient.query(
          `DELETE FROM gl_journal_bridge WHERE accounting_entry_id = ANY($1::int[])`,
          [aeIds]
        ).catch(() => {});
        const result = await pgClient.query(
          `DELETE FROM accounting_entries WHERE id = ANY($1::int[])`,
          [aeIds]
        );
        await pgClient.query("ALTER TABLE accounting_entries ENABLE TRIGGER trg_block_posted_delete");
        deletedAe = result.rowCount ?? aeIds.length;
      }

      await pgClient.query("COMMIT");
    } catch (txErr) {
      await pgClient.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      pgClient.release();
    }

    res.json({
      dryRun: false,
      deleted_accounting_payments: deletedAp,
      deleted_accounting_entries: deletedAe,
      message: `Berhasil menghapus ${deletedAp} accounting_payments dan ${deletedAe} accounting_entries yang orphaned.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * POST /api/sport-center/admin/fix-ppn-journals
 * Koreksi jurnal booking lama yang memakai formula PPN eksklusif (salah).
 * Harga fasilitas sudah INKLUSIF PPN — seharusnya pakai formula: PPN = total × 11/(100+11).
 *
 * Strategi: buat ADJUSTMENT ENTRY per booking (debit PPN Keluaran, kredit Pendapatan)
 * sebesar selisih antara PPN lama (salah) dan PPN baru (benar).
 * Idempoten — skip booking yang sudah ada entri koreksi.
 *
 * Query param: dry_run=true → hanya preview, tidak buat jurnal.
 */
router.post("/admin/fix-ppn-journals", async (req, res) => {
  const adminKeyBypass = (req.query.adminKey ?? req.body?.adminKey ?? req.headers["x-admin-key"]) as string | undefined;
  const isKeyAuth = adminKeyBypass && process.env.PORTAL_ADMIN_KEY && adminKeyBypass === process.env.PORTAL_ADMIN_KEY;
  if (!isKeyAuth && !await requireAdmin(req, res)) return;
  try {
    const isDryRun = req.query.dry_run === "true" || req.body?.dry_run === true;
    const companyIdFilter = req.body?.company_id ? Number(req.body.company_id) : null;
    const TAX_RATE = 11;

    // 1. Ambil semua booking yang punya tax_amount > 0
    const bookingsRes = await db.execute(sql`
      SELECT id, company_id, booking_number, booking_date, facility_name, customer_name,
             total_amount, tax_amount
      FROM sport_bookings
      WHERE tax_amount > 0
        AND (${companyIdFilter}::int IS NULL OR company_id = ${companyIdFilter})
      ORDER BY booking_date ASC
    `);

    const report: Array<{
      bookingId: number; bookingNumber: string; totalAmount: number;
      oldPpn: number; correctPpn: number; diff: number;
      status: "corrected" | "skipped_already_fixed" | "skipped_no_journal" | "skipped_no_ppn_account" | "dry_run";
    }> = [];

    for (const bRaw of bookingsRes.rows) {
      const b = bRaw as any;
      const bookingId = Number(b.id);
      const companyId = b.company_id != null ? Number(b.company_id) : 1;
      const totalAmount = Number(b.total_amount ?? 0);
      const storedTax = Number(b.tax_amount ?? 0);

      // Hitung PPN yang benar (inklusif)
      const correctPpn = Math.round(totalAmount * TAX_RATE / (100 + TAX_RATE) * 100) / 100;
      const diff = Math.round((storedTax - correctPpn) * 100) / 100; // selisih PPN (lama - benar)

      // Skip jika selisih < 1 rupiah (sudah benar / rounding noise)
      if (Math.abs(diff) < 1) {
        report.push({ bookingId, bookingNumber: String(b.booking_number), totalAmount, oldPpn: storedTax, correctPpn, diff, status: "skipped_already_fixed" });
        continue;
      }

      // Idempoten: skip jika sudah ada koreksi
      const existingCorr = await db.execute(sql`
        SELECT id FROM accounting_entries
        WHERE source = 'sport_center_ppn_correction' AND source_id = ${bookingId}
        LIMIT 1
      `);
      if (existingCorr.rows.length > 0) {
        report.push({ bookingId, bookingNumber: String(b.booking_number), totalAmount, oldPpn: storedTax, correctPpn, diff, status: "skipped_already_fixed" });
        continue;
      }

      // Cek apakah ada jurnal asli (sport_center_booking)
      const origEntry = await db.execute(sql`
        SELECT id FROM accounting_entries
        WHERE source = 'sport_center_booking' AND source_id = ${bookingId}
        LIMIT 1
      `);
      if (!origEntry.rows.length) {
        report.push({ bookingId, bookingNumber: String(b.booking_number), totalAmount, oldPpn: storedTax, correctPpn, diff, status: "skipped_no_journal" });
        continue;
      }

      // Resolve akun PPN Keluaran dan Pendapatan Sport Center
      const settings = await ensureAccountingSettings(companyId);
      const ppnAccountId = settings.ppnOutputAccountId;
      const pendapatanAccountId = await resolveSportCenterBookingAccountId(companyId, settings.salesIncomeAccountId);
      const journalId = settings.cashJournalId ?? settings.bankJournalId;
      const journalCode = settings.cashJournalId ? "CSH" : "BNK";

      if (!ppnAccountId || !pendapatanAccountId || !journalId) {
        report.push({ bookingId, bookingNumber: String(b.booking_number), totalAmount, oldPpn: storedTax, correctPpn, diff, status: "skipped_no_ppn_account" });
        continue;
      }

      if (isDryRun) {
        report.push({ bookingId, bookingNumber: String(b.booking_number), totalAmount, oldPpn: storedTax, correctPpn, diff, status: "dry_run" });
        continue;
      }

      // Buat adjustment entry:
      //   Debit  PPN Keluaran  : diff (kurangi PPN yang lebih)
      //   Credit Pendapatan    : diff (tambah DPP yang kurang)
      // diff = old_ppn - correct_ppn > 0  →  PPN terlalu besar, Pendapatan terlalu kecil
      const costCenterId = await resolveCostCenterId("SPORT_CENTER", companyId);
      const adjustAmt = Math.abs(diff);

      await postEntry(
        {
          journalId,
          date: new Date(String(b.booking_date)),
          ref: String(b.booking_number),
          description: `[KOREKSI PPN] ${b.booking_number} — ${b.facility_name ?? ""} ${b.customer_name ?? ""}: PPN inklusif diperbaiki`,
          source: "sport_center_ppn_correction",
          sourceId: bookingId,
          companyId,
          costCenterId,
          lines: [
            // Kurangi PPN Keluaran (PPN lama terlalu besar)
            {
              accountId: ppnAccountId,
              debit: diff > 0 ? adjustAmt : 0,
              credit: diff < 0 ? adjustAmt : 0,
              description: `Koreksi PPN Keluaran: ${b.booking_number}`,
            },
            // Tambah Pendapatan Sport Center (DPP lama terlalu kecil)
            {
              accountId: pendapatanAccountId,
              debit: diff < 0 ? adjustAmt : 0,
              credit: diff > 0 ? adjustAmt : 0,
              description: `Koreksi Pendapatan Sport Center: ${b.booking_number}`,
            },
          ],
        },
        journalCode,
      );

      // Update tax_amount di sport_bookings agar konsisten
      await db.execute(sql`
        UPDATE sport_bookings
        SET tax_amount = ${correctPpn}, updated_at = NOW()
        WHERE id = ${bookingId}
      `);

      report.push({ bookingId, bookingNumber: String(b.booking_number), totalAmount, oldPpn: storedTax, correctPpn, diff, status: "corrected" });
    }

    const summary = {
      total: report.length,
      corrected: report.filter(r => r.status === "corrected").length,
      skipped_already_fixed: report.filter(r => r.status === "skipped_already_fixed").length,
      skipped_no_journal: report.filter(r => r.status === "skipped_no_journal").length,
      skipped_no_ppn_account: report.filter(r => r.status === "skipped_no_ppn_account").length,
      dry_run: report.filter(r => r.status === "dry_run").length,
      isDryRun,
    };

    res.json({ summary, detail: report });
  } catch (err: any) {
    console.error("[sport-center] fix-ppn-journals error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * POST /api/sport-center/admin/fix-booking-journal-amounts
 * Koreksi semua jurnal sport_center_booking yang jumlahnya tidak sesuai
 * dengan total_amount di sport_bookings (harga fasilitas).
 *
 * Strategi: buat ADJUSTMENT ENTRY sebesar selisih (bukan replace):
 *   - Jika jurnal terlalu BESAR → Debit Pendapatan / Credit Kas (kurangi keduanya)
 *   - Jika jurnal terlalu KECIL → Debit Kas / Credit Pendapatan (tambah keduanya)
 * Idempoten — skip booking yang sudah ada entri koreksi amount.
 * Query param: dry_run=true → preview saja tanpa buat jurnal.
 */
router.post("/admin/fix-booking-journal-amounts", async (req, res) => {
  const adminKeyBypass = (req.query.adminKey ?? req.body?.adminKey ?? req.headers["x-admin-key"]) as string | undefined;
  const isKeyAuth = adminKeyBypass && process.env.PORTAL_ADMIN_KEY && adminKeyBypass === process.env.PORTAL_ADMIN_KEY;
  if (!isKeyAuth && !await requireAdmin(req, res)) return;

  try {
    const isDryRun = req.query.dry_run === "true" || req.body?.dry_run === true;
    const companyIdFilter = req.body?.company_id ? Number(req.body.company_id) : null;

    // 1. Ambil semua jurnal sport_center_booking + total_amount dari booking
    const entriesRes = await db.execute(sql`
      SELECT
        ae.id          AS entry_id,
        ae.ref,
        ae.source_id   AS booking_id,
        ae.company_id,
        ae.date,
        sb.booking_number,
        sb.facility_name,
        sb.customer_name,
        sb.booking_date,
        sb.total_amount AS correct_amount,
        ael.debit      AS journal_debit
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael
        ON ael.entry_id = ae.id AND ael.debit > 0   -- ambil baris Debit (Kas/Bank)
      JOIN sport_bookings sb
        ON sb.id = ae.source_id
      WHERE ae.source = 'sport_center_booking'
        AND ae.status  = 'posted'
        AND (${companyIdFilter}::int IS NULL OR ae.company_id = ${companyIdFilter})
      ORDER BY ae.date ASC
    `);

    type ReportRow = {
      bookingId: number;
      bookingNumber: string;
      facilityName: string;
      journalAmount: number;
      correctAmount: number;
      diff: number;
      status: "corrected" | "skipped_already_fixed" | "skipped_no_account" | "dry_run" | "error";
      note?: string;
    };

    const report: ReportRow[] = [];

    for (const raw of entriesRes.rows) {
      const r = raw as any;
      const bookingId    = Number(r.booking_id);
      const companyId    = r.company_id != null ? Number(r.company_id) : 1;
      const journalAmt   = Math.round(Number(r.journal_debit) * 100) / 100;
      const correctAmt   = Math.round(Number(r.correct_amount) * 100) / 100;
      const diff         = Math.round((journalAmt - correctAmt) * 100) / 100; // positif = jurnal terlalu besar

      if (Math.abs(diff) < 1) {
        report.push({ bookingId, bookingNumber: String(r.booking_number), facilityName: String(r.facility_name ?? ""), journalAmount: journalAmt, correctAmount: correctAmt, diff, status: "skipped_already_fixed" });
        continue;
      }

      // Idempoten: skip jika koreksi amount sudah ada
      const existCorr = await db.execute(sql`
        SELECT id FROM accounting_entries
        WHERE source = 'sport_center_amount_correction' AND source_id = ${bookingId}
        LIMIT 1
      `);
      if (existCorr.rows.length > 0) {
        report.push({ bookingId, bookingNumber: String(r.booking_number), facilityName: String(r.facility_name ?? ""), journalAmount: journalAmt, correctAmount: correctAmt, diff, status: "skipped_already_fixed", note: "koreksi sudah ada" });
        continue;
      }

      if (isDryRun) {
        report.push({ bookingId, bookingNumber: String(r.booking_number), facilityName: String(r.facility_name ?? ""), journalAmount: journalAmt, correctAmount: correctAmt, diff, status: "dry_run" });
        continue;
      }

      try {
        const settings       = await ensureAccountingSettings(companyId);
        const kasAccountId   = settings.defaultCashAccountId ?? settings.defaultBankAccountId;
        const pendapatanId   = await resolveSportCenterBookingAccountId(companyId, settings.salesIncomeAccountId);
        const journalId      = settings.cashJournalId ?? settings.bankJournalId;
        const journalCode    = settings.cashJournalId ? "CSH" : "BNK";
        const costCenterId   = await resolveCostCenterId("SPORT_CENTER", companyId);

        if (!kasAccountId || !pendapatanId || !journalId) {
          report.push({ bookingId, bookingNumber: String(r.booking_number), facilityName: String(r.facility_name ?? ""), journalAmount: journalAmt, correctAmount: correctAmt, diff, status: "skipped_no_account", note: "akun kas/pendapatan belum dikonfigurasi" });
          continue;
        }

        const adjAmt = Math.abs(diff);
        const bookingDate = String(r.booking_date ?? r.date ?? new Date().toISOString().slice(0, 10));

        // diff > 0: jurnal terlalu besar → kurangi Kas (Credit Kas) dan kurangi Pendapatan (Debit Pendapatan)
        // diff < 0: jurnal terlalu kecil → tambah Kas (Debit Kas) dan tambah Pendapatan (Credit Pendapatan)
        await postEntry(
          {
            journalId,
            date: new Date(bookingDate),
            ref: String(r.booking_number ?? r.ref ?? ""),
            description: `[KOREKSI JUMLAH] ${r.booking_number} — ${r.facility_name ?? ""} ${r.customer_name ?? ""}: jumlah jurnal disesuaikan ke harga fasilitas`,
            source: "sport_center_amount_correction",
            sourceId: bookingId,
            companyId,
            costCenterId,
            lines: [
              {
                accountId: kasAccountId,
                debit:  diff < 0 ? adjAmt : 0,
                credit: diff > 0 ? adjAmt : 0,
                description: `Koreksi Kas/Bank: ${r.booking_number}`,
              },
              {
                accountId: pendapatanId,
                debit:  diff > 0 ? adjAmt : 0,
                credit: diff < 0 ? adjAmt : 0,
                description: `Koreksi Pendapatan Sport Center: ${r.booking_number}`,
              },
            ],
          },
          journalCode,
        );

        report.push({ bookingId, bookingNumber: String(r.booking_number), facilityName: String(r.facility_name ?? ""), journalAmount: journalAmt, correctAmount: correctAmt, diff, status: "corrected" });
      } catch (innerErr: any) {
        report.push({ bookingId, bookingNumber: String(r.booking_number), facilityName: String(r.facility_name ?? ""), journalAmount: journalAmt, correctAmount: correctAmt, diff, status: "error", note: innerErr?.message });
      }
    }

    const summary = {
      total: report.length,
      corrected: report.filter(r => r.status === "corrected").length,
      already_correct: report.filter(r => r.status === "skipped_already_fixed").length,
      skipped_no_account: report.filter(r => r.status === "skipped_no_account").length,
      errors: report.filter(r => r.status === "error").length,
      dry_run: report.filter(r => r.status === "dry_run").length,
      isDryRun,
    };

    res.json({ summary, detail: report });
  } catch (err: any) {
    console.error("[sport-center] fix-booking-journal-amounts error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;