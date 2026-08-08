import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { normalizePaymentMethod } from "../../lib/accounting.js";

const PREFIX = "[SportIncrementalSync]";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
const LOOKBACK_BUFFER_MS = 60 * 1000;   // 1 menit lookback buffer untuk menangani clock skew

let isRunning = false;
let lastBookingSyncAt: Date | null = null;
let lastPaymentSyncAt: Date | null = null;

async function getSupabaseClient() {
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    return getSportCenterSupabaseClient() as any;
  } catch {
    return null;
  }
}

/**
 * Tarik booking baru/diupdate dari sport_center.sport_bookings sejak lastSyncAt,
 * upsert ke public.sport_bookings.
 */
async function syncNewBookings(client: any, sinceAt: Date): Promise<number> {
  const sinceIso = new Date(sinceAt.getTime() - LOOKBACK_BUFFER_MS).toISOString();

  const { data, error } = await client
    .schema("sport_center")
    .from("sport_bookings")
    .select("id, order_number, customer_name, customer_phone, customer_email, facility_id, booking_date, start_time, end_time, duration_hours, total_price, grand_total, billing_status, status, notes, created_at, updated_at")
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: true });

  if (error) {
    logger.warn({ error: error.message }, `${PREFIX} fetch booking gagal`);
    return 0;
  }

  const rows = (data ?? []) as Array<{
    id: number;
    order_number: string | null;
    customer_name: string;
    customer_phone?: string | null;
    customer_email?: string | null;
    facility_id?: number | null;
    booking_date: string;
    start_time: string;
    end_time: string;
    duration_hours?: number | null;
    total_price?: number | null;
    grand_total?: number | null;
    status?: string | null;
    billing_status?: string | null;
    notes?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>;

  if (rows.length === 0) return 0;

  // Fetch facility names sekali untuk semua booking
  const facilityIds = [...new Set(rows.map(r => r.facility_id).filter(Boolean) as number[])];
  const facilityMap: Record<number, string> = {};
  if (facilityIds.length > 0) {
    try {
      const { data: facData } = await client
        .schema("sport_center")
        .from("sport_facilities")
        .select("id, name")
        .in("id", facilityIds);
      for (const f of (facData ?? [])) facilityMap[f.id] = f.name;
    } catch { /* non-fatal */ }
  }

  let synced = 0;
  for (const row of rows) {
    const bookingNumber = row.order_number ?? `SC-${row.id}`;
    const facilityName = (row.facility_id ? facilityMap[row.facility_id] : null) ?? "Unknown";
    const startTime = row.start_time?.slice(0, 5) ?? "00:00";
    const endTime = row.end_time?.slice(0, 5) ?? "01:00";
    const durationHours = Number(row.duration_hours ?? 1);
    const totalAmount = Number(row.grand_total ?? row.total_price ?? 0);
    const rawStatus = row.status ?? "pending";
    const mappedStatus = rawStatus === "confirmed" ? "confirmed"
      : rawStatus === "cancelled" ? "cancelled"
      : rawStatus === "completed" ? "completed"
      : "pending";
    const rawBilling = (row.billing_status ?? "").toLowerCase();
    const paymentStatus = rawBilling === "paid" || rawBilling === "free" ? "paid"
      : rawBilling === "partial" ? "partial"
      : "unpaid";

    try {
      await db.execute(sql`
        INSERT INTO sport_bookings
          (company_id, booking_number, customer_name, customer_phone, customer_email,
           facility_name, booking_date, start_time, end_time,
           duration_hours, base_amount, total_amount,
           status, payment_status, notes, sc_booking_id, created_at, updated_at)
        VALUES
          (1, ${bookingNumber}, ${row.customer_name}, ${row.customer_phone ?? null}, ${row.customer_email ?? null},
           ${facilityName}, ${row.booking_date}::DATE, ${startTime}::TIME, ${endTime}::TIME,
           ${durationHours}, ${totalAmount}, ${totalAmount},
           ${mappedStatus}, ${paymentStatus}, ${row.notes ?? null},
           ${row.id}, ${row.created_at ?? new Date().toISOString()}::TIMESTAMPTZ, NOW())
        ON CONFLICT (booking_number) DO UPDATE SET
          customer_name   = EXCLUDED.customer_name,
          customer_phone  = EXCLUDED.customer_phone,
          customer_email  = EXCLUDED.customer_email,
          facility_name   = EXCLUDED.facility_name,
          booking_date    = EXCLUDED.booking_date,
          start_time      = EXCLUDED.start_time,
          end_time        = EXCLUDED.end_time,
          duration_hours  = EXCLUDED.duration_hours,
          base_amount     = EXCLUDED.base_amount,
          total_amount    = EXCLUDED.total_amount,
          status          = EXCLUDED.status,
          payment_status  = CASE
            WHEN sport_bookings.payment_status = 'paid' THEN 'paid'
            ELSE EXCLUDED.payment_status
          END,
          notes           = EXCLUDED.notes,
          sc_booking_id   = EXCLUDED.sc_booking_id,
          updated_at      = NOW()
      `);
      synced++;
    } catch (err) {
      logger.warn({ err, bookingNumber }, `${PREFIX} upsert booking gagal`);
    }
  }

  logger.info({ synced, total: rows.length, sinceIso }, `${PREFIX} booking sync selesai`);
  return synced;
}

/**
 * Tarik payment baru/diupdate dari sport_center.sport_payments sejak lastSyncAt,
 * upsert ke public.sport_payments dan update payment_status booking terkait.
 */
async function syncNewPayments(client: any, sinceAt: Date): Promise<number> {
  const sinceIso = new Date(sinceAt.getTime() - LOOKBACK_BUFFER_MS).toISOString();

  const { data, error } = await client
    .schema("sport_center")
    .from("sport_payments")
    .select("id, booking_id, amount, payment_method, status, confirmed_at, created_at, updated_at")
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: true });

  if (error) {
    logger.warn({ error: error.message }, `${PREFIX} fetch payment gagal`);
    return 0;
  }

  // Settlement columns were added after the original Sport Center schema.
  // Keep this best-effort so an older source schema still syncs core payments.
  const settlementMeta = new Map<number, any>();
  const settlementMetaRes = await client
    .schema("sport_center")
    .from("sport_payments")
    .select("id, mdr_rate, mdr_amount, tax_withheld_amount, other_fee_amount, settlement_reference, settlement_date, settlement_status");
  if (!settlementMetaRes.error) {
    for (const row of (settlementMetaRes.data ?? []) as any[]) {
      settlementMeta.set(Number(row.id), row);
    }
  }

  const payments = (data ?? []) as Array<{
    id: number;
    booking_id: number | null;
    amount: number;
    payment_method: string | null;
    status: string | null;
    confirmed_at: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;

  if (payments.length === 0) return 0;

  const PAID_STATUSES = new Set(["confirmed", "paid", "settlement", "capture", "success", "complete", "lunas"]);
  let synced = 0;

  for (const pay of payments) {
    const scPaymentNumber = `SCPAY-${pay.id}`;
    const paymentMethod = normalizePaymentMethod(pay.payment_method) ?? "cash";
    const statusRaw = pay.status?.toLowerCase() ?? "";
    const mappedStatus = PAID_STATUSES.has(statusRaw) ? "paid" : "pending";
    const payDate = (pay.confirmed_at ?? pay.created_at ?? new Date().toISOString()).split("T")[0]!;
    const meta = settlementMeta.get(Number(pay.id)) ?? {};

    try {
      // Resolve local booking_id via sc_booking_id link
      let localBookingId: number | null = null;
      if (pay.booking_id) {
        const bkRes = await db.execute(sql`
          SELECT id FROM sport_bookings WHERE sc_booking_id = ${pay.booking_id} LIMIT 1
        `).catch(() => ({ rows: [] }));
        if (bkRes.rows.length > 0) localBookingId = Number((bkRes.rows[0] as any).id);
      }

      await db.execute(sql`
        INSERT INTO sport_payments
        (booking_id, payment_number, amount, method, status, paid_at, created_at, updated_at,
         mdr_rate, mdr_amount, tax_withheld_amount, other_fee_amount, net_amount,
         settlement_reference, settlement_date, settlement_status)
        VALUES
          (${localBookingId}, ${scPaymentNumber}, ${String(Number(pay.amount))},
            ${paymentMethod}, ${mappedStatus},
           ${payDate}::DATE,
           ${pay.created_at ?? new Date().toISOString()}::TIMESTAMPTZ, NOW(),
           ${meta.mdr_rate ?? 0}, ${meta.mdr_amount ?? 0},
           ${meta.tax_withheld_amount ?? 0}, ${meta.other_fee_amount ?? 0},
           GREATEST(
             0::numeric,
             ${Number(pay.amount)}::numeric
             - ${Number(meta.mdr_amount ?? 0)}::numeric
             - ${Number(meta.tax_withheld_amount ?? 0)}::numeric
             - ${Number(meta.other_fee_amount ?? 0)}::numeric
           ),
           ${meta.settlement_reference ?? null}, ${meta.settlement_date ?? null}::date,
           ${meta.settlement_status ?? "unsettled"})
        ON CONFLICT (payment_number) DO UPDATE SET
          status     = EXCLUDED.status,
          amount     = EXCLUDED.amount,
          method     = EXCLUDED.method,
          mdr_rate   = EXCLUDED.mdr_rate,
          mdr_amount = EXCLUDED.mdr_amount,
          tax_withheld_amount = EXCLUDED.tax_withheld_amount,
          other_fee_amount = EXCLUDED.other_fee_amount,
          net_amount = EXCLUDED.net_amount,
          settlement_reference = EXCLUDED.settlement_reference,
          settlement_date = EXCLUDED.settlement_date,
          settlement_status = EXCLUDED.settlement_status,
          booking_id = COALESCE(sport_payments.booking_id, EXCLUDED.booking_id),
          updated_at = NOW()
      `);

      // Propagate source method changes to Accounting Hub, including records
      // that were created before this incremental sync ran.
      await db.execute(sql`
        UPDATE accounting_payments ap
        SET payment_method = ${paymentMethod}
        WHERE ap.source_type = 'sport_center'
          AND ap.source_doc_id = (
            SELECT id FROM sport_payments
            WHERE payment_number = ${scPaymentNumber}
            LIMIT 1
          )
      `).catch(() => {});
      // Update booking payment_status jika sekarang paid
      if (mappedStatus === "paid" && localBookingId) {
        await db.execute(sql`
          UPDATE sport_bookings
          SET payment_status = 'paid', updated_at = NOW()
          WHERE id = ${localBookingId} AND payment_status != 'paid'
        `);
      }

      synced++;
    } catch (err) {
      logger.warn({ err, scPaymentNumber }, `${PREFIX} upsert payment gagal`);
    }
  }

  logger.info({ synced, total: payments.length, sinceIso }, `${PREFIX} payment sync selesai`);
  return synced;
}

async function runIncrementalSync(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    const client = await getSupabaseClient();
    if (!client) {
      logger.debug(`${PREFIX} Supabase client tidak tersedia, skip`);
      return;
    }

    const now = new Date();
    const bookingSince = lastBookingSyncAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000); // default: 24 jam lalu
    const paymentSince = lastPaymentSyncAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [bookingSynced, paymentSynced] = await Promise.all([
      syncNewBookings(client, bookingSince),
      syncNewPayments(client, paymentSince),
    ]);

    lastBookingSyncAt = now;
    lastPaymentSyncAt = now;

    if (bookingSynced > 0 || paymentSynced > 0) {
      logger.info(
        { bookingSynced, paymentSynced },
        `${PREFIX} Incremental sync selesai — ada perubahan`
      );
    }
  } catch (err) {
    logger.warn({ err }, `${PREFIX} runIncrementalSync error (non-fatal)`);
  } finally {
    isRunning = false;
  }
}

export function startIncrementalSyncWorker(): void {
  // Jalankan sekali saat startup (dengan delay kecil agar DB siap)
  setTimeout(() => {
    void runIncrementalSync();
  }, 10_000);

  // Lanjut poll setiap 5 menit
  setInterval(() => {
    void runIncrementalSync();
  }, POLL_INTERVAL_MS);

  logger.info(
    { pollIntervalMin: POLL_INTERVAL_MS / 60_000 },
    `${PREFIX} Incremental sync worker started`
  );
}

/** Manual trigger — dipanggil dari POST /api/sport-center/sync/incremental */
export async function triggerIncrementalSync(): Promise<{ bookingSynced: number; paymentSynced: number }> {
  const client = await getSupabaseClient();
  if (!client) return { bookingSynced: 0, paymentSynced: 0 };

  // Force full 24-jam lookback saat trigger manual
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [bookingSynced, paymentSynced] = await Promise.all([
    syncNewBookings(client, since),
    syncNewPayments(client, since),
  ]);

  lastBookingSyncAt = new Date();
  lastPaymentSyncAt = new Date();

  return { bookingSynced, paymentSynced };
}
