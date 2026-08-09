import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { syncPaymentsToAccounting } from "./supabaseSync.js";
import { validateSportPaymentMirror } from "./sportPaymentValidation.js";

const PREFIX = "[SportIncrementalSync]";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
const LOOKBACK_BUFFER_MS = 60 * 1000;   // 1 menit lookback buffer untuk menangani clock skew

/**
 * Fallback tanpa Supabase client: query sport_center schema langsung via
 * SECURITY DEFINER function yang di-install oleh migration trigger setup.
 * Tidak membutuhkan service role key — cukup koneksi DB biasa.
 */
async function syncUnmirroredViaDbFunction(): Promise<number> {
  let synced = 0;
  try {
    const unmirroredRes = await db.execute(sql`
      SELECT sc_payment_id, sc_booking_id, amount, payment_method, confirmed_at, created_at
      FROM sport_center.get_unmirrored_confirmed_payments()
    `).catch(() => ({ rows: [] as unknown[] }));

    const rows = unmirroredRes.rows as Array<{
      sc_payment_id: number;
      sc_booking_id: number | null;
      amount: string | number;
      payment_method: string | null;
      confirmed_at: string | null;
      created_at: string | null;
    }>;

    if (rows.length === 0) return 0;

    logger.info({ count: rows.length }, `${PREFIX} [dbFallback] confirmed payments tanpa mirror ditemukan`);

    for (const row of rows) {
      const scPaymentNumber = `SCPAY-SC-${row.sc_payment_id}`;
      try {
        // Resolve local booking_id dari sc_booking_id
        let localBookingId: number | null = null;
        if (row.sc_booking_id != null) {
          const localByScId = await db.execute(sql`
            SELECT id FROM sport_bookings WHERE sc_booking_id = ${row.sc_booking_id} LIMIT 1
          `).catch(() => ({ rows: [] }));
          if (localByScId.rows.length > 0) {
            localBookingId = Number((localByScId.rows[0] as any).id);
          }
        }

        const paidAt   = row.confirmed_at ?? row.created_at ?? new Date().toISOString();
        const method   = row.payment_method ?? "Transfer Bank";
        const amount   = Number(row.amount ?? 0);

        await db.execute(sql`
          INSERT INTO sport_payments
            (company_id, booking_id, payment_number, amount, method, status, paid_at,
             payment_type, source, posting_status, created_at, updated_at)
          VALUES
            (1, ${localBookingId}, ${scPaymentNumber}, ${amount},
             ${method}, 'paid', ${paidAt}::timestamptz,
             'full_payment', 'SPORT_CENTER_SUPABASE', 'unposted',
             ${row.created_at ?? new Date().toISOString()}::timestamptz, NOW())
          ON CONFLICT (payment_number) DO NOTHING
        `);

        logger.info(
          { scPaymentId: row.sc_payment_id, amount, method, localBookingId },
          `${PREFIX} [dbFallback] mirror dibuat untuk confirmed payment`,
        );
        synced++;
      } catch (err) {
        logger.warn({ err, scPaymentNumber }, `${PREFIX} [dbFallback] gagal insert mirror`);
      }
    }
  } catch (err) {
    // DB function belum tersedia (runtime DB lama / migration belum jalan) — skip
    logger.debug({ err: (err as Error)?.message }, `${PREFIX} [dbFallback] get_unmirrored_confirmed_payments tidak tersedia`);
  }
  return synced;
}

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
 * Trigger PostgreSQL di sport_center.sport_payments adalah pemilik mirror
 * public.sport_payments. Worker ini hanya memverifikasi mirror trigger dan
 * melengkapi booking_id mirror bila masih kosong; worker tidak boleh
 * INSERT/UPDATE metadata payment mirror karena dapat menimpa hasil trigger
 * atau payment yang sudah diposting/failed.
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

  let synced = 0;

  for (const pay of payments) {
    const scPaymentNumber = `SCPAY-SC-${pay.id}`;

    try {
      // The trigger uses this exact idempotency key. Missing mirrors are
      // intentionally not inserted here; the source must be updated/replayed
      // so PostgreSQL can execute the trigger.
       const mirrorRes = await db.execute(sql`
         SELECT id, booking_id, amount
         FROM sport_payments
         WHERE payment_number = ${scPaymentNumber}
         ORDER BY id ASC
       `);
       const mirrorRows = mirrorRes.rows as Array<{
        id?: number;
        booking_id?: number | null;
         amount?: number | string | null;
      } | undefined;
       const mirror = mirrorRows[0];

       if (mirrorRows.length > 1) {
         const error = `duplicate payment mirrors for ${scPaymentNumber} (${mirrorRows.length})`;
         for (const duplicate of mirrorRows) {
           if (duplicate?.id == null) continue;
           await db.execute(sql`
             UPDATE sport_payments
             SET posting_status = 'manual_review',
                 posting_error = ${error},
                 updated_at = NOW()
             WHERE id = ${Number(duplicate.id)}
           `).catch(() => {});
         }
         logger.warn(
           { sportCenterPaymentId: pay.id, mirrorCount: mirrorRows.length },
           `${PREFIX} duplicate payment mirrors — posting diblokir`,
         );
         synced++;
         continue;
       }

      // ── Resolve local booking_id (shared by mirror-create and booking_id-backfill) ──
       const resolveLocalBooking = async (): Promise<{
         id: number | null;
         duplicateCount: number;
         bookingNumber: string | null;
       }> => {
         if (pay.booking_id == null) return { id: null, duplicateCount: 0, bookingNumber: null };
        const bookingOrder = await client
          .schema("sport_center")
          .from("sport_bookings")
          .select("order_number")
          .eq("id", pay.booking_id)
          .maybeSingle();
        const orderNumber = bookingOrder.data?.order_number ?? null;
         if (orderNumber) {
          const r = await db.execute(sql`
             SELECT id, booking_number
             FROM sport_bookings
             WHERE booking_number = ${orderNumber}
             ORDER BY id ASC
          `).catch(() => ({ rows: [] }));
           if (r.rows.length > 0) {
             return {
               id: Number((r.rows[0] as any).id),
               duplicateCount: r.rows.length,
               bookingNumber: String((r.rows[0] as any).booking_number ?? orderNumber),
             };
           }
        }
        const r2 = await db.execute(sql`
           SELECT id, booking_number
           FROM sport_bookings
           WHERE sc_booking_id = ${pay.booking_id}
           ORDER BY id ASC
        `).catch(() => ({ rows: [] }));
         return {
           id: r2.rows.length > 0 ? Number((r2.rows[0] as any).id) : null,
           duplicateCount: r2.rows.length,
           bookingNumber: r2.rows.length > 0
             ? String((r2.rows[0] as any).booking_number ?? "")
             : null,
         };
      };

      if (!mirror) {
        if (pay.status !== "confirmed") {
          // Belum confirmed → trigger belum seharusnya fire; expected untuk pending payments.
          logger.debug(
            { sportCenterPaymentId: pay.id, paymentNumber: scPaymentNumber, sourceStatus: pay.status },
            `${PREFIX} payment belum confirmed, mirror belum diperlukan`,
          );
          continue;
        }

        // Payment confirmed tapi mirror belum ada → trigger tidak aktif saat dikonfirmasi
        // (misal QRIS yang dikonfirmasi sebelum trigger diinstall). Insert mirror manual.
        logger.info(
          { sportCenterPaymentId: pay.id, paymentNumber: scPaymentNumber },
          `${PREFIX} payment confirmed tanpa mirror → insert mirror manual`,
        );
         const localBooking = await resolveLocalBooking();
         if (localBooking.duplicateCount > 1) {
           logger.warn(
             { sportCenterPaymentId: pay.id, duplicateBookingCount: localBooking.duplicateCount },
             `${PREFIX} duplicate local booking mirrors — mirror tidak dibuat`,
           );
           continue;
         }
         const localBookingId = localBooking.id;
        const paidAt   = pay.confirmed_at ?? pay.created_at ?? new Date().toISOString();
        const method   = pay.payment_method ?? "Transfer Bank";

        await db.execute(sql`
          INSERT INTO sport_payments
            (company_id, booking_id, payment_number, amount, method, status, paid_at,
             payment_type, source, posting_status, created_at, updated_at)
          VALUES
            (1, ${localBookingId}, ${scPaymentNumber}, ${pay.amount},
             ${method}, 'paid', ${paidAt}::timestamptz,
             'full_payment', 'SPORT_CENTER_SUPABASE', 'unposted',
             ${pay.created_at ?? new Date().toISOString()}::timestamptz, NOW())
          ON CONFLICT (payment_number) DO NOTHING
        `);
         synced++;
        continue;
      }

      if (mirror.booking_id == null && pay.booking_id != null) {
         const localBooking = await resolveLocalBooking();

         if (localBooking.duplicateCount > 1) {
           const error = `duplicate local booking mirrors for Sport Center booking ${pay.booking_id} (${localBooking.duplicateCount})`;
           await db.execute(sql`
             UPDATE sport_payments
             SET posting_status = 'manual_review',
                 posting_error = ${error},
                 updated_at = NOW()
             WHERE id = ${Number(mirror.id)}
           `).catch(() => {});
           logger.warn(
             { sportCenterPaymentId: pay.id, duplicateBookingCount: localBooking.duplicateCount },
             `${PREFIX} duplicate local booking mirrors — posting diblokir`,
           );
           synced++;
           continue;
         }

         if (localBooking.id) {
          await db.execute(sql`
             UPDATE sport_payments
             SET booking_id = ${localBooking.id}
            WHERE id = ${Number(mirror.id)}
              AND booking_id IS NULL
          `);
        } else {
          logger.warn(
            { sportCenterPaymentId: pay.id, paymentNumber: scPaymentNumber },
            `${PREFIX} booking lokal belum tersedia; mirror dipertahankan tanpa posting`,
          );
          continue;
        }
      }

       const mirrorEvidenceRes = await db.execute(sql`
         SELECT
           sp.id AS mirror_payment_id,
           sp.amount AS mirror_amount,
           sp.booking_id AS mirror_booking_id,
           sb.sc_booking_id AS mirror_source_booking_id,
           sb.booking_number AS mirror_booking_number,
           COUNT(*) OVER (
             PARTITION BY sb.sc_booking_id
           ) AS duplicate_booking_mirror_count
         FROM sport_payments sp
         LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
         WHERE sp.id = ${Number(mirror.id)}
       `).catch(() => ({ rows: [] }));
       const mirrorEvidence = mirrorEvidenceRes.rows[0] as any;
       const mirrorValidation = validateSportPaymentMirror({
         sourcePaymentId: pay.id,
         mirrorPaymentId: Number(mirror.id),
         sourceAmount: pay.amount,
         mirrorAmount: mirrorEvidence?.mirror_amount,
         sourceBookingId: pay.booking_id,
         sourceBookingNumber: (await client
           .schema("sport_center")
           .from("sport_bookings")
           .select("order_number")
           .eq("id", pay.booking_id)
           .maybeSingle()).data?.order_number ?? null,
         mirrorBookingId: mirrorEvidence?.mirror_booking_id,
         mirrorSourceBookingId: mirrorEvidence?.mirror_source_booking_id,
         mirrorBookingNumber: mirrorEvidence?.mirror_booking_number,
         duplicateBookingMirrorCount: Number(mirrorEvidence?.duplicate_booking_mirror_count ?? 0),
       });
       if (!mirrorValidation.ok) {
         await db.execute(sql`
           UPDATE sport_payments
           SET posting_status = ${mirrorValidation.state},
               posting_error = ${mirrorValidation.error.slice(0, 1000)},
               updated_at = NOW()
           WHERE id = ${Number(mirror.id)}
         `).catch(() => {});
         logger.warn(
           { sportCenterPaymentId: pay.id, error: mirrorValidation.error },
           `${PREFIX} mirror validation failed`,
         );
       }

      // Patch method jika sport_center payment adalah QRIS tapi mirror belum reflect itu.
      // Hanya update jika posting_status masih unposted/failed (belum diposting ke jurnal).
      if (
        pay.payment_method &&
        String(pay.payment_method).toLowerCase().includes("qris")
      ) {
        await db.execute(sql`
          UPDATE sport_payments
          SET method     = ${pay.payment_method},
              updated_at = NOW()
          WHERE id       = ${Number(mirror.id)}
            AND LOWER(COALESCE(method, '')) NOT LIKE '%qris%'
            AND posting_status IN ('unposted', 'failed')
        `).catch(() => {/* non-fatal */});
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

    let bookingSynced = 0;
    let paymentSynced = 0;

    if (client) {
      const now = new Date();
      const bookingSince = lastBookingSyncAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const paymentSince = lastPaymentSyncAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);

      [bookingSynced, paymentSynced] = await Promise.all([
        syncNewBookings(client, bookingSince),
        syncNewPayments(client, paymentSince),
      ]);

      lastBookingSyncAt = now;
      lastPaymentSyncAt = now;
    } else {
      // Supabase client tidak tersedia → gunakan DB function sebagai fallback.
      // Fungsi sport_center.get_unmirrored_confirmed_payments() adalah SECURITY DEFINER
      // sehingga bisa query cross-schema tanpa service role key.
      paymentSynced = await syncUnmirroredViaDbFunction();
    }

    let accountingSynced = 0;
    if (paymentSynced > 0) {
      const accounting = await syncPaymentsToAccounting(1);
      accountingSynced = accounting.synced;

      // Setelah payment baru tersedia di public.sport_payments, regenerasi
      // QRIS batch candidates agar cocokkan batch settlement (QRTRAVELI).
      try {
        const { generateQrisCandidates } = await import("../../lib/reconciliation/qrisCandidateService.js");
        const qrisResult = await generateQrisCandidates({ companyId: 1, dryRun: false });
        if (qrisResult.generated > 0) {
          logger.info(
            { generated: qrisResult.generated },
            `${PREFIX} QRIS batch candidates diperbarui setelah payment sync`,
          );
        }
      } catch (qrisErr) {
        logger.debug({ err: (qrisErr as Error)?.message }, `${PREFIX} QRIS candidate regen skip`);
      }
    }

    if (bookingSynced > 0 || paymentSynced > 0 || accountingSynced > 0) {
      logger.info(
        { bookingSynced, paymentSynced, accountingSynced },
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

  let bookingSynced = 0;
  let paymentSynced = 0;

  if (client) {
    // Force full 24-jam lookback saat trigger manual
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    [bookingSynced, paymentSynced] = await Promise.all([
      syncNewBookings(client, since),
      syncNewPayments(client, since),
    ]);
  } else {
    // Fallback: cari confirmed payments tanpa mirror via DB function cross-schema
    paymentSynced = await syncUnmirroredViaDbFunction();
  }

  if (paymentSynced > 0) {
    await syncPaymentsToAccounting(1);
    // Regenerasi QRIS batch candidates setelah payment baru tersedia
    try {
      const { generateQrisCandidates } = await import("../../lib/reconciliation/qrisCandidateService.js");
      await generateQrisCandidates({ companyId: 1, dryRun: false });
    } catch {/* non-fatal */}
  }

  lastBookingSyncAt = new Date();
  lastPaymentSyncAt = new Date();

  return { bookingSynced, paymentSynced };
}
