import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { notifySyncError } from "./sportSyncNotifier.js";
import { postSportCenterBooking } from "../../lib/accounting.js";

const PREFIX = "[SportSync]";

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.warn(`${PREFIX} attempt ${i + 1} gagal, retry dalam ${delayMs * (i + 1)}ms...`, err);
        await sleep(delayMs * (i + 1));
      }
    }
  }
  throw lastErr;
}

export interface FacilityRow {
  id: number;
  name: string;
  type?: string;
  description?: string | null;
  capacity?: number;
  price_per_hour?: number;
  is_active?: boolean;
  sort_order?: number;
  image_url?: string | null;
  company_id?: number | null;
}

export interface BookingRow {
  id: number;
  booking_number: string;
  customer_name: string;
  customer_id?: number | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  facility_id?: number | null;
  facility_name: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_hours?: number;
  base_amount?: number;
  total_amount?: number;
  status: string;
  payment_status?: string;
  notes?: string | null;
  company_id?: number | null;
  checked_in_at?: string | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

function facilityCode(id: number) {
  return `facility_${id}`;
}

async function writeSyncLog(opts: {
  entity: "facility" | "booking";
  action: "upsert" | "delete" | "resync";
  entityId: number | null;
  status: "ok" | "error";
  detail?: string;
  companyId?: number | null;
}) {
  try {
    await db.execute(sql`
      INSERT INTO sport_sync_logs (entity, action, entity_id, status, detail, company_id)
      VALUES (${opts.entity}, ${opts.action}, ${opts.entityId ?? null}, ${opts.status}, ${opts.detail ?? null}, ${opts.companyId ?? null})
    `);
  } catch {
  }
}

function getSupabaseClient() {
  try {
    const { getSportCenterSupabaseClient } = require("../../lib/supabaseAdminSportCenter.js");
    return getSportCenterSupabaseClient() as import("@supabase/supabase-js").SupabaseClient | null;
  } catch {
    return null;
  }
}

async function syncToServicesViaClient(row: FacilityRow): Promise<void> {
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  const code = facilityCode(row.id);
  const payload = {
    code,
    name: row.name,
    category: row.type ?? "court",
    description: row.description ?? null,
    price_per_hour: Math.round(Number(row.price_per_hour ?? 0)),
    capacity: Number(row.capacity ?? 1),
    is_active: row.is_active ?? true,
    sort_order: row.sort_order ?? 0,
    image_url: row.image_url ?? null,
    updated_at: new Date().toISOString(),
  };

  if (client) {
    await retry(async () => {
      // sport_center_services may not have a UNIQUE constraint on code — use manual select-update-insert
      const { data: existing } = await (client as any)
        .from("sport_center_services").select("id").eq("code", code).maybeSingle();
      if (existing) {
        const { error } = await (client as any)
          .from("sport_center_services").update(payload).eq("code", code);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await (client as any)
          .from("sport_center_services").insert(payload);
        if (error) throw new Error(error.message);
      }
    });
  } else {
    await retry(async () => {
      await db.execute(sql`
        INSERT INTO sport_center_services (code, name, category, description, price_per_hour, capacity, is_active, sort_order, image_url, updated_at)
        VALUES (${payload.code}, ${payload.name}, ${payload.category}, ${payload.description}, ${payload.price_per_hour}, ${payload.capacity}, ${payload.is_active}, ${payload.sort_order}, ${payload.image_url}, NOW())
        ON CONFLICT (code) DO UPDATE SET
          name           = EXCLUDED.name,
          category       = EXCLUDED.category,
          description    = EXCLUDED.description,
          price_per_hour = EXCLUDED.price_per_hour,
          capacity       = EXCLUDED.capacity,
          is_active      = EXCLUDED.is_active,
          sort_order     = EXCLUDED.sort_order,
          image_url      = EXCLUDED.image_url,
          updated_at     = NOW()
      `);
    });
  }
  console.log(`${PREFIX} sport_center_services upsert OK → code=${code} name="${row.name}"`);
}

async function syncToFacilitiesViaClient(row: FacilityRow): Promise<void> {
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  if (!client) {
    console.warn(`${PREFIX} syncToFacilitiesViaClient: client tidak tersedia, skip`);
    return;
  }

  const payload = {
    name: row.name,
    category: row.type ?? "court",
    description: row.description ?? null,
    price_per_hour: Math.round(Number(row.price_per_hour ?? 0)),
    updated_at: new Date().toISOString(),
  };

  await retry(async () => {
    // sport_center.sport_facilities may not have a UNIQUE constraint on name — use manual select-update-insert
    const { data: existing } = await (client as any)
      .schema("sport_center").from("sport_facilities").select("id").eq("name", row.name).maybeSingle();
    if (existing) {
      const { error } = await (client as any)
        .schema("sport_center").from("sport_facilities").update(payload).eq("name", row.name);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (client as any)
        .schema("sport_center").from("sport_facilities").insert(payload);
      if (error) throw new Error(error.message);
    }
  });
  console.log(`${PREFIX} sport_center.sport_facilities upsert OK → name="${row.name}"`);
}

export async function syncFacilityUpsert(row: FacilityRow): Promise<void> {
  const ops = [syncToServicesViaClient(row), syncToFacilitiesViaClient(row)];
  const results = await Promise.allSettled(ops);
  const hasError = results.some(r => r.status === "rejected");
  const errorMessages: string[] = [];
  for (const r of results) {
    if (r.status === "rejected") {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(`${PREFIX} facility upsert gagal setelah retry:`, r.reason);
      errorMessages.push(msg);
    }
  }
  void writeSyncLog({
    entity: "facility",
    action: "upsert",
    entityId: row.id,
    status: hasError ? "error" : "ok",
    detail: hasError ? errorMessages[0] ?? "partial failure" : undefined,
    companyId: row.company_id,
  });
  if (hasError) {
    void notifySyncError([{
      entity: "facility",
      entityId: row.id,
      entityName: row.name,
      action: "upsert",
      error: errorMessages.join("; "),
    }]);
  }
}

export async function syncFacilityDelete(id: number, name: string, companyId?: number | null): Promise<void> {
  const code = facilityCode(id);
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  const ops = [
    retry(async () => {
      if (client) {
        const { error } = await (client as any)
          .from("sport_center_services")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("code", code);
        if (error) throw new Error(error.message);
      } else {
        await db.execute(sql`UPDATE sport_center_services SET is_active = false, updated_at = NOW() WHERE code = ${code}`);
      }
      console.log(`${PREFIX} sport_center_services soft-delete OK → code=${code}`);
    }),
    retry(async () => {
      if (client) {
        // Must use sport_center schema — NOT public.sport_center_facilities
        const { error } = await (client as any)
          .schema("sport_center").from("sport_facilities")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("name", name);
        if (error) throw new Error(error.message);
      } else {
        await db.execute(sql`UPDATE sport_facilities SET is_active = false, updated_at = NOW() WHERE name = ${name}`);
      }
      console.log(`${PREFIX} sport_facilities soft-delete OK → name="${name}"`);
    }),
  ];

  const results = await Promise.allSettled(ops);
  const hasError = results.some(r => r.status === "rejected");
  const errorMessages: string[] = [];
  for (const r of results) {
    if (r.status === "rejected") {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(`${PREFIX} facility delete sync gagal:`, r.reason);
      errorMessages.push(msg);
    }
  }
  void writeSyncLog({
    entity: "facility", action: "delete", entityId: id,
    status: hasError ? "error" : "ok",
    detail: hasError ? errorMessages[0] ?? "delete failure" : undefined,
    companyId,
  });
  if (hasError) {
    void notifySyncError([{
      entity: "facility",
      entityId: id,
      entityName: name,
      action: "delete",
      error: errorMessages.join("; "),
    }]);
  }
}

// Cache facility name → id di Supabase agar tidak perlu fetch tiap booking
// Valid enum values for sport_center.sport_bookings.status in Supabase (does NOT include "pending")
const SC_VALID_BOOKING_STATUSES = new Set(["confirmed", "cancelled", "completed"]);

/** Map local booking status → Supabase booking_status enum.
 *  Returns null if the status should not be sent (avoids invalid enum error). */
function toScBookingStatus(localStatus: string | null | undefined): string | null {
  const s = (localStatus ?? "").toLowerCase();
  if (SC_VALID_BOOKING_STATUSES.has(s)) return s;
  // "pending" and any unknown local status → don't override Supabase status
  return null;
}

let _facilityIdCache: Map<string, number> | null = null;
let _facilityIdCacheExpiry = 0;

async function getFacilityIdMap(client: import("@supabase/supabase-js").SupabaseClient | null): Promise<Map<string, number>> {
  const now = Date.now();
  if (_facilityIdCache && now < _facilityIdCacheExpiry) return _facilityIdCache;
  const map = new Map<string, number>();
  try {
    if (client) {
      // Must query sport_center.sport_facilities (same schema as bookings FK target), NOT public.sport_center_facilities
      const { data } = await (client as any)
        .schema("sport_center")
        .from("sport_facilities")
        .select("id, name")
        .limit(200);
      for (const r of (data ?? [])) {
        map.set((r.name as string).trim().toLowerCase(), r.id as number);
      }
    } else {
      // fallback: lookup dari local DB
      const res = await db.execute(sql`SELECT id, name FROM sport_facilities ORDER BY id`);
      for (const r of res.rows as { id: number; name: string }[]) {
        map.set(r.name.trim().toLowerCase(), r.id);
      }
    }
  } catch { /* biarkan map kosong jika gagal */ }
  _facilityIdCache = map;
  _facilityIdCacheExpiry = now + 5 * 60 * 1000; // cache 5 menit
  return map;
}

export async function syncBookingUpsert(row: BookingRow): Promise<void> {
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  const facilityMap = await getFacilityIdMap(client);
  const facilityId = facilityMap.get((row.facility_name ?? "").trim().toLowerCase()) ?? null;

  const payload: Record<string, unknown> = {
    booking_code: row.booking_number,
    customer_name: row.customer_name,
    customer_email: row.customer_email ?? "",   // Supabase column is NOT NULL; use empty string as fallback
    customer_phone: row.customer_phone ?? null,
    facility_name: row.facility_name,
    date: row.booking_date,
    start_time: row.start_time,
    end_time: row.end_time,
    total_hours: Number(row.duration_hours ?? 1),
    total_price: Number(row.total_amount ?? 0),
    status: row.status,
    payment_status: row.payment_status ?? "unpaid",
    notes: row.notes ?? null,
    updated_at: new Date().toISOString(),
  };
  if (facilityId !== null) payload.facility_id = facilityId;

  try {
    await retry(async () => {
      if (client) {
        // Target: sport_center.sport_bookings (schema asli) — manual select-update-insert karena constraint unknown
        const scPayload: Record<string, unknown> = {
          order_number: row.booking_number,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone ?? null,
          updated_at: new Date().toISOString(),
        };
        // Only send status if it's a valid Supabase booking_status enum value ("pending" is NOT valid)
        const scStatus = toScBookingStatus(row.status);
        if (scStatus !== null) scPayload.status = scStatus;
        // billing_status is an enum in SC; only set for confirmed payment states to avoid invalid enum error
        if (row.payment_status === "paid") scPayload.billing_status = "paid";
        else if (row.payment_status === "partial") scPayload.billing_status = "partial";
        if (facilityId !== null) scPayload.facility_id = facilityId;
        const { data: existing } = await (client as any)
          .schema("sport_center").from("sport_bookings").select("id").eq("order_number", row.booking_number).maybeSingle();
        if (existing) {
          const { error } = await (client as any)
            .schema("sport_center").from("sport_bookings").update(scPayload).eq("order_number", row.booking_number);
          if (error) throw new Error(error.message);
        }
        // If not found in Supabase, skip insert (bookings originate from the SC app, not BizPortal)
      } else {
        // Supabase client unavailable — data already in sport_bookings (local canonical table). Skip legacy mirror.
        console.log(`${PREFIX} booking sync skip (no Supabase client) → order_number=${row.booking_number}`);
      }
      console.log(`${PREFIX} sport_center.sport_bookings sync OK → order_number=${row.booking_number} status=${row.status}`);
    });
    void writeSyncLog({ entity: "booking", action: "upsert", entityId: row.id, status: "ok", companyId: row.company_id });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} booking upsert gagal:`, err);
    void writeSyncLog({ entity: "booking", action: "upsert", entityId: row.id, status: "error", detail: errMsg, companyId: row.company_id });
    void notifySyncError([{
      entity: "booking",
      entityId: row.id,
      entityName: `${row.booking_number} — ${row.customer_name} (${row.facility_name})`,
      action: "upsert",
      error: errMsg,
    }]);
  }
}

export async function syncAllFacilities(): Promise<{ synced: number; errors: number; total: number }> {
  const result = await db.execute(sql`SELECT * FROM sport_facilities ORDER BY id ASC`);
  const rows = result.rows as unknown as FacilityRow[];
  let synced = 0;
  let errors = 0;
  const failedEntries: import("./sportSyncNotifier.js").SyncErrorEntry[] = [];

  for (const row of rows) {
    const ops = [syncToServicesViaClient(row), syncToFacilitiesViaClient(row)];
    const results = await Promise.allSettled(ops);
    const rowHasError = results.some(r => r.status === "rejected");
    const rowErrors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map(r => r.reason instanceof Error ? r.reason.message : String(r.reason));

    if (rowHasError) {
      errors++;
      failedEntries.push({
        entity: "facility",
        entityId: row.id,
        entityName: row.name,
        action: "resync",
        error: rowErrors.join("; "),
      });
      void writeSyncLog({
        entity: "facility", action: "upsert", entityId: row.id,
        status: "error", detail: rowErrors[0] ?? "sync failure", companyId: row.company_id,
      });
    } else {
      synced++;
    }
  }

  console.log(`${PREFIX} full facility sync: ${synced} OK, ${errors} gagal dari ${rows.length} total`);
  void writeSyncLog({
    entity: "facility", action: "resync", entityId: null,
    status: errors === 0 ? "ok" : "error",
    detail: `${synced}/${rows.length} OK${errors > 0 ? ` — ${errors} gagal` : ""}`,
  });

  // Kirim satu notifikasi WA untuk semua kegagalan (aggregate, dedup via Fonnte)
  if (failedEntries.length > 0) {
    void notifySyncError(failedEntries);
  }

  return { synced, errors, total: rows.length };
}

export async function syncAllBookings(): Promise<{ synced: number; errors: number; total: number }> {
  const result = await db.execute(sql`SELECT * FROM sport_bookings ORDER BY id ASC`);
  const rows = result.rows as unknown as BookingRow[];
  let synced = 0;
  let errors = 0;
  const failedEntries: import("./sportSyncNotifier.js").SyncErrorEntry[] = [];

  // ambil client dan facility map sekali di luar loop
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }
  const facilityMap = await getFacilityIdMap(client);

  for (const row of rows) {
    const facilityId = facilityMap.get((row.facility_name ?? "").trim().toLowerCase()) ?? null;

    const payload: Record<string, unknown> = {
      booking_code: row.booking_number,
      customer_name: row.customer_name,
      customer_email: row.customer_email ?? "",   // Supabase column is NOT NULL; use empty string as fallback
      customer_phone: row.customer_phone ?? null,
      facility_name: row.facility_name,
      date: row.booking_date,
      start_time: row.start_time,
      end_time: row.end_time,
      total_hours: Number(row.duration_hours ?? 1),
      total_price: Number(row.total_amount ?? 0),
      status: row.status,
      payment_status: row.payment_status ?? "unpaid",
      notes: row.notes ?? null,
      updated_at: new Date().toISOString(),
    };
    if (facilityId !== null) payload.facility_id = facilityId;

    try {
      await retry(async () => {
        if (client) {
          // Target: sport_center.sport_bookings — manual update only (bookings originate from SC app)
          const scPayload: Record<string, unknown> = {
            order_number: row.booking_number,
            customer_name: row.customer_name,
            customer_phone: row.customer_phone ?? null,
            updated_at: new Date().toISOString(),
          };
          // Only send status if it's a valid Supabase booking_status enum value ("pending" is NOT valid)
          const scStatus = toScBookingStatus(row.status);
          if (scStatus !== null) scPayload.status = scStatus;
          if (row.payment_status === "paid") scPayload.billing_status = "paid";
          else if (row.payment_status === "partial") scPayload.billing_status = "partial";
          if (facilityId !== null) scPayload.facility_id = facilityId;
          const { data: existing } = await (client as any)
            .schema("sport_center").from("sport_bookings").select("id").eq("order_number", row.booking_number).maybeSingle();
          if (existing) {
            const { error } = await (client as any)
              .schema("sport_center").from("sport_bookings").update(scPayload).eq("order_number", row.booking_number);
            if (error) throw new Error(error.message);
          }
        } else {
          // Supabase client unavailable — data already in sport_bookings (local canonical table). Skip legacy mirror.
          console.log(`${PREFIX} bulk booking sync skip (no Supabase client) → order_number=${row.booking_number}`);
        }
      });
      void writeSyncLog({ entity: "booking", action: "upsert", entityId: row.id, status: "ok", companyId: row.company_id });
      synced++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`${PREFIX} bulk booking upsert gagal id=${row.id}:`, err);
      void writeSyncLog({ entity: "booking", action: "upsert", entityId: row.id, status: "error", detail: errMsg, companyId: row.company_id });
      errors++;
      failedEntries.push({
        entity: "booking",
        entityId: row.id,
        entityName: `${row.booking_number} — ${row.customer_name} (${row.facility_name})`,
        action: "resync",
        error: errMsg,
      });
    }
  }

  console.log(`${PREFIX} full booking sync: ${synced} OK, ${errors} gagal dari ${rows.length} total`);
  void writeSyncLog({
    entity: "booking", action: "resync", entityId: null,
    status: errors === 0 ? "ok" : "error",
    detail: `${synced}/${rows.length} OK${errors > 0 ? ` — ${errors} gagal` : ""}`,
  });

  if (failedEntries.length > 0) {
    void notifySyncError(failedEntries);
  }

  return { synced, errors, total: rows.length };
}

/**
 * syncPaymentsToAccounting
 * Sinkronisasi payment paid di public.sport_payments → accounting_payments + accounting_entries.
 * Menggunakan postSportCenterBooking (canonical path) untuk membuat journal entry,
 * sehingga tidak ada manual INSERT ke accounting_entries yang bisa bypass trigger guard.
 */
export async function syncPaymentsToAccounting(companyId = 1): Promise<{ synced: number; skipped: number; errors: number }> {
  // Baca dari local mirror (public.sport_payments + public.sport_bookings)
  // — tidak perlu koneksi Supabase, sudah di-mirror oleh pullPaymentsFromSupabase / incrementalSyncWorker
  const paidRes = await db.execute(sql`
    SELECT
      sp.id          AS sp_id,
      sp.payment_number,
      sp.booking_id  AS local_booking_id,
      sp.amount,
      sp.method,
      sp.paid_at,
      sp.created_at  AS sp_created_at,
      sb.booking_number,
      sb.customer_name,
      sb.facility_name,
      sb.booking_date,
      sb.company_id  AS bk_company_id,
      sb.total_amount AS booking_total_amount
    FROM sport_payments sp
    JOIN sport_bookings sb ON sb.id = sp.booking_id
    WHERE sp.status = 'paid'
      AND (sb.company_id = ${companyId} OR sb.company_id IS NULL)
  `).catch(() => ({ rows: [] }));

  const rows = paidRes.rows as Array<{
    sp_id: number;
    payment_number: string;
    local_booking_id: number;
    amount: string;
    method: string | null;
    paid_at: string | null;
    sp_created_at: string | null;
    booking_number: string;
    customer_name: string;
    facility_name: string | null;
    booking_date: string | null;
    bk_company_id: number | null;
    booking_total_amount: string | null;
  }>;

  if (rows.length === 0) {
    return { synced: 0, skipped: 0, errors: 0 };
  }

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  const settingsRes = await db.execute(sql`
    SELECT cash_journal_id, bank_journal_id FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
  `).catch(() => ({ rows: [] }));
  const settings = settingsRes.rows[0] as any;

  for (const row of rows) {
    try {
      // Idempoten: cek apakah accounting_payments sudah ada untuk payment ini
      const existing = await db.execute(sql`
        SELECT id, entry_id FROM accounting_payments
        WHERE source_type = 'sport_center'
          AND (source_doc_id = ${row.sp_id} OR ref = ${row.booking_number})
        LIMIT 1
      `);

      if (existing.rows.length > 0) {
        const existingRow = existing.rows[0] as any;
        // Jika entry_id belum terhubung, coba link sekarang
        if (!existingRow.entry_id) {
          const entryRes = await db.execute(sql`
            SELECT id FROM accounting_entries
            WHERE source = 'sport_center_booking' AND source_id = ${row.local_booking_id}
            LIMIT 1
          `).catch(() => ({ rows: [] }));
          if (entryRes.rows.length > 0) {
            const entryId = Number((entryRes.rows[0] as any).id);
            await db.execute(sql`UPDATE accounting_payments SET entry_id = ${entryId} WHERE id = ${existingRow.id}`).catch(() => {});
          }
        }
        skipped++;
        continue;
      }

      // ── Langkah 1: Pastikan journal entry ada via canonical path ──────────────
      const payDate = (row.paid_at ?? row.sp_created_at ?? row.booking_date ?? new Date().toISOString()).slice(0, 10);
      const bookingDate = row.booking_date ?? payDate;

      try {
        await postSportCenterBooking({
          bookingId: row.local_booking_id,
          bookingCode: row.booking_number,
          customerName: row.customer_name ?? "Customer",
          facilityName: row.facility_name ?? "Sport Center",
          date: bookingDate,
          // Gunakan total_amount dari booking (harga fasilitas) — bukan sp.amount
          // yang bisa berbeda jika pembayaran dicatat dengan PPN ditambahkan di luar
          totalPrice: Number(row.booking_total_amount ?? row.amount),
          companyId: row.bk_company_id ?? companyId,
        });
      } catch (postErr) {
        console.warn(`${PREFIX} syncPaymentsToAccounting: postSportCenterBooking gagal booking_id=${row.local_booking_id}:`, postErr);
      }

      // ── Langkah 2: Ambil entry_id yang baru dibuat / sudah ada ───────────────
      const entryRes = await db.execute(sql`
        SELECT id FROM accounting_entries
        WHERE source = 'sport_center_booking' AND source_id = ${row.local_booking_id}
        LIMIT 1
      `).catch(() => ({ rows: [] }));
      const entryId = entryRes.rows.length > 0 ? Number((entryRes.rows[0] as any).id) : null;

      // ── Langkah 3: Buat accounting_payments ──────────────────────────────────
      const year = payDate.slice(0, 4);
      const cntRes = await db.execute(sql`SELECT CAST(COUNT(*) AS int) AS seq FROM accounting_payments WHERE company_id = ${companyId}`);
      const seq = Number((cntRes.rows[0] as any)?.seq ?? 0);
      const acctPayNumber = `SCPAY/${year}/${(seq + 1).toString().padStart(4, "0")}`;

      const isCash = ["cash", "tunai", "cash on hand"].includes((row.method ?? "").toLowerCase());
      const journalId = isCash
        ? (settings?.cash_journal_id ?? settings?.bank_journal_id ?? null)
        : (settings?.bank_journal_id ?? settings?.cash_journal_id ?? null);

      const insertRes = await db.execute(sql`
        INSERT INTO accounting_payments
          (company_id, payment_number, payment_type, status, amount, journal_id,
           partner_name, date, ref, memo, source_type, source_doc_id, entry_id)
        VALUES
          (${companyId}, ${acctPayNumber}, 'inbound', 'posted', ${String(Number(row.amount))},
           ${journalId ?? null}, ${row.customer_name ?? "Customer"}, ${payDate}::date,
           ${row.booking_number}, ${'Sport Center: ' + row.booking_number},
           'sport_center', ${row.sp_id}, ${entryId})
        ON CONFLICT DO NOTHING
        RETURNING id
      `);

      if ((insertRes.rows[0] as any)?.id) {
        console.log(`${PREFIX} syncPaymentsToAccounting OK → ${row.payment_number} (${row.booking_number}) Rp${row.amount}`);
        synced++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`${PREFIX} syncPaymentsToAccounting gagal sp_id=${row.sp_id}:`, err);
      errors++;
    }
  }

  console.log(`${PREFIX} syncPaymentsToAccounting selesai: synced=${synced} skipped=${skipped} errors=${errors}`);
  void writeSyncLog({
    entity: "booking",
    action: "resync",
    entityId: null,
    status: errors === 0 ? "ok" : "error",
    detail: `accounting sync: ${synced} synced, ${skipped} skipped, ${errors} errors`,
  });

  return { synced, skipped, errors };
}

/**
 * pullPaymentsFromSupabase
 * Tarik sport_center.sport_payments (Supabase) → sport_payments (lokal BizPortal).
 * Idempoten: cek via payment_number = 'SCPAY-{sc_payment_id}'.
 * Status mapping: confirmed/paid → 'paid', lainnya → 'pending'.
 */
export async function pullPaymentsFromSupabase(companyId = 1): Promise<{ pulled: number; deleted: number; skipped: number; errors: number; total: number }> {
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  if (!client) {
    console.warn(`${PREFIX} pullPayments: Supabase client tidak tersedia`);
    return { pulled: 0, deleted: 0, skipped: 0, errors: 0, total: 0 };
  }

  const [paymentsRes, bookingsRes] = await Promise.all([
    (client as any).schema("sport_center").from("sport_payments")
      .select("id, booking_id, amount, payment_method, status, confirmed_at, created_at"),
    (client as any).schema("sport_center").from("sport_bookings")
      .select("id, order_number, grand_total, total_price, booking_date"),
  ]);

  if (paymentsRes.error) {
    console.error(`${PREFIX} pullPayments: fetch payments gagal`, paymentsRes.error.message);
    return { pulled: 0, deleted: 0, skipped: 0, errors: 1, total: 0 };
  }

  const allPayments = (paymentsRes.data ?? []) as Array<{
    id: number; booking_id: number; amount: number;
    payment_method: string | null; status: string | null;
    confirmed_at: string | null; created_at: string | null;
  }>;

  const PAID_STATUSES = new Set(["confirmed", "paid", "settlement", "capture", "success", "complete", "lunas"]);
  const UNPAID_STATUSES = new Set(["pending", "cancelled", "canceled", "refunded", "failed", "expired"]);
  if (allPayments.length > 0) {
    const statusCounts: Record<string, number> = {};
    for (const p of allPayments) {
      const s = p.status ?? "null";
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }
    console.log(`${PREFIX} pullPayments: status breakdown →`, JSON.stringify(statusCounts));
  }
  const scPayments = allPayments;

  const scBookings = (bookingsRes.data ?? []) as Array<{
    id: number; order_number: string | null; grand_total: number | null; total_price: number | null; booking_date: string | null;
  }>;

  // map sc booking id → order_number
  const scBkMap: Record<number, string> = {};
  for (const b of scBookings) {
    if (b.id && b.order_number) scBkMap[b.id] = b.order_number;
  }

  let pulled = 0;
  let skipped = 0;
  let errors = 0;

  for (const pay of scPayments) {
    try {
      const scPaymentNumber = `SCPAY-${pay.id}`;

      // Cek apakah payment sudah ada — jika ada, UPDATE status/amount dari Supabase (jangan skip)
      const existingRes = await db.execute(sql`
        SELECT id, booking_id, status, method
        FROM sport_payments
        WHERE payment_number = ${scPaymentNumber}
        LIMIT 1
      `);
      if (existingRes.rows.length > 0) {
        const existingRow = existingRes.rows[0] as any;
        const existingBookingId = existingRow.booking_id;
        const existingStatus = existingRow.status;
        const existingMethod = existingRow.method;
        const statusRaw2 = pay.status?.toLowerCase() ?? "";
        const mappedStatus2 = PAID_STATUSES.has(statusRaw2) ? "paid" : (UNPAID_STATUSES.has(statusRaw2) ? "pending" : "paid");
        const mappedMethod2 = String(pay.payment_method ?? "cash").trim().toLowerCase() || "cash";

        // Selalu update payment record dari Supabase (status terbaru menimpa)
        if (existingStatus !== mappedStatus2) {
          console.log(`${PREFIX} pullPayments [KONFLIK STATUS] ${scPaymentNumber}: local=${existingStatus} supabase=${mappedStatus2} → update ke ${mappedStatus2}`);
        }
        if (String(existingMethod ?? "").toLowerCase() !== mappedMethod2) {
          console.log(`${PREFIX} pullPayments [KONFLIK METHOD] ${scPaymentNumber}: local=${existingMethod ?? "-"} supabase=${mappedMethod2} → update ke ${mappedMethod2}`);
        }
        await db.execute(sql`
          UPDATE sport_payments SET
            status   = ${mappedStatus2},
            amount   = ${String(Number(pay.amount))},
            method   = ${mappedMethod2}
          WHERE payment_number = ${scPaymentNumber}
        `);

        // Pastikan booking payment_status ikut terupdate
        // Jika existingBookingId null (insert lama tanpa booking link), resolve dulu via order_number / sc_booking_id
        let resolvedBookingId: number | null = existingBookingId ?? null;
        if (!resolvedBookingId && pay.booking_id) {
          const orderNumber = scBkMap[pay.booking_id];
          if (orderNumber) {
            const bkRes = await db.execute(sql`SELECT id FROM sport_bookings WHERE booking_number = ${orderNumber} LIMIT 1`).catch(() => ({ rows: [] }));
            if (bkRes.rows.length > 0) resolvedBookingId = Number((bkRes.rows[0] as any).id);
          }
          if (!resolvedBookingId) {
            const bkRes2 = await db.execute(sql`SELECT id FROM sport_bookings WHERE sc_booking_id = ${pay.booking_id} LIMIT 1`).catch(() => ({ rows: [] }));
            if (bkRes2.rows.length > 0) resolvedBookingId = Number((bkRes2.rows[0] as any).id);
          }
          if (resolvedBookingId) {
            console.log(`${PREFIX} pullPayments [FIX NULL BOOKING_ID] ${scPaymentNumber}: resolved booking_id=${resolvedBookingId}`);
            await db.execute(sql`UPDATE sport_payments SET booking_id = ${resolvedBookingId} WHERE payment_number = ${scPaymentNumber}`);
          }
        }
        if (resolvedBookingId && mappedStatus2 === "paid") {
          const bkBefore = await db.execute(sql`SELECT payment_status FROM sport_bookings WHERE id = ${resolvedBookingId} LIMIT 1`).catch(() => ({ rows: [] }));
          const prevStatus = (bkBefore.rows[0] as any)?.payment_status;
          if (prevStatus !== "paid") {
            console.log(`${PREFIX} pullPayments [KONFLIK BOOKING] booking_id=${resolvedBookingId}: payment_status=${prevStatus} → paid (dari Supabase)`);
            await db.execute(sql`
              UPDATE sport_bookings SET payment_status = 'paid', updated_at = NOW()
              WHERE id = ${resolvedBookingId}
            `);
          }
        }
        skipped++;
        continue;
      }

      // resolve local booking_id: coba via order_number dulu, fallback via sc_booking_id
      const orderNumber = scBkMap[pay.booking_id];
      let localBookingId: number | null = null;

      if (orderNumber) {
        const bkRes = await db.execute(sql`
          SELECT id FROM sport_bookings WHERE booking_number = ${orderNumber} LIMIT 1
        `);
        if (bkRes.rows.length > 0) localBookingId = Number((bkRes.rows[0] as any).id);
      }

      if (!localBookingId && pay.booking_id) {
        // Fallback: cari via sc_booking_id — hanya jika kolom sudah ada di DB
        try {
          const bkRes2 = await db.execute(sql`
            SELECT id FROM sport_bookings WHERE sc_booking_id = ${pay.booking_id} LIMIT 1
          `);
          if (bkRes2.rows.length > 0) localBookingId = Number((bkRes2.rows[0] as any).id);
        } catch { /* sc_booking_id belum ada — skip fallback ini */ }
      }

      if (!localBookingId) {
        // Booking belum ada di lokal — skip, akan retry setelah pull bookings
        console.warn(`${PREFIX} pullPayments: booking ${orderNumber ?? pay.booking_id} belum ada lokal, skip pay.id=${pay.id}`);
        skipped++;
        continue;
      }

      const statusRaw = pay.status?.toLowerCase() ?? "";
      const mappedStatus = PAID_STATUSES.has(statusRaw) ? "paid" : (UNPAID_STATUSES.has(statusRaw) ? "pending" : "paid");
      const paidAt = pay.confirmed_at ?? pay.created_at ?? new Date().toISOString();
      const method = pay.payment_method ?? "cash";

      await db.execute(sql`
        INSERT INTO sport_payments
          (company_id, booking_id, payment_number, amount, method, status,
           paid_at, source, payment_type)
        VALUES
          (${companyId}, ${localBookingId}, ${scPaymentNumber}, ${String(Number(pay.amount))},
           ${method}, ${mappedStatus}, ${paidAt}::TIMESTAMPTZ,
           'SPORT_CENTER_SUPABASE', 'booking')
      `);

      // Update payment_status di sport_bookings jika status = paid
      if (mappedStatus === "paid") {
        await db.execute(sql`
          UPDATE sport_bookings SET payment_status = 'paid', updated_at = NOW()
          WHERE id = ${localBookingId} AND payment_status != 'paid'
        `);

        // Buat jurnal akuntansi (accounting_entries) jika belum ada
        const bkInfoRes = await db.execute(sql`
          SELECT booking_number, customer_name, facility_name, booking_date, company_id, total_amount
          FROM sport_bookings WHERE id = ${localBookingId} LIMIT 1
        `).catch(() => ({ rows: [] }));
        const bkInfo = bkInfoRes.rows[0] as any;
        // Gunakan total_amount dari booking (harga fasilitas) — bukan pay.amount
        // agar jurnal tidak mengandung PPN yang sudah ditambahkan di luar.
        const journalAmount = bkInfo?.total_amount != null
          ? Number(bkInfo.total_amount)
          : Number(pay.amount);
        postSportCenterBooking({
          bookingId: localBookingId,
          bookingCode: orderNumber ?? bkInfo?.booking_number ?? scPaymentNumber,
          customerName: bkInfo?.customer_name ?? "Customer",
          facilityName: bkInfo?.facility_name ?? "Sport Center",
          date: (paidAt ?? new Date().toISOString()).slice(0, 10),
          totalPrice: journalAmount,
          companyId: bkInfo?.company_id ?? companyId,
        }).catch((err: unknown) => console.error(`${PREFIX} postSportCenterBooking gagal pay.id=${pay.id}:`, err));
      }

      console.log(`${PREFIX} pullPayments OK → ${scPaymentNumber} (local_booking=${localBookingId}) Rp${pay.amount}`);
      pulled++;
    } catch (err) {
      console.error(`${PREFIX} pullPayments gagal pay.id=${pay.id}:`, err);
      errors++;
    }
  }

  // ── Deletion sync: hapus local SCPAY payments yang sudah didelete dari Supabase ──
  let paymentDeleted = 0;
  if (scPayments.length > 0) {
    try {
      const supabasePayNumbers = new Set(scPayments.map(p => `SCPAY-${p.id}`));
      const localRes = await db.execute(sql`
        SELECT id, payment_number FROM sport_payments WHERE payment_number LIKE 'SCPAY-%'
      `).catch(() => ({ rows: [] as any[] }));
      const toDeletePay = (localRes.rows as any[]).filter(
        row => !supabasePayNumbers.has(String(row.payment_number))
      );
      for (const pay of toDeletePay) {
        const payId = Number(pay.id);
        await db.execute(sql`DELETE FROM accounting_payments WHERE source_type = 'sport_center' AND source_doc_id = ${payId}`).catch(() => {});
        await db.execute(sql`DELETE FROM sport_payments WHERE id = ${payId}`).catch(() => {});
        console.log(`${PREFIX} pullPayments [DELETE] ${pay.payment_number} → dihapus dari BizPortal (sudah tidak ada di Supabase)`);
        paymentDeleted++;
      }
      if (paymentDeleted > 0) {
        console.log(`${PREFIX} pullPayments: ${paymentDeleted} payment dihapus (sudah tidak ada di Supabase Sport Center)`);
      }
    } catch (err) {
      console.error(`${PREFIX} pullPayments deletion sync gagal (non-fatal):`, err);
    }
  }

  console.log(`${PREFIX} pullPayments selesai: pulled=${pulled} deleted=${paymentDeleted} skipped=${skipped} errors=${errors} total=${scPayments.length}`);
  void writeSyncLog({
    entity: "booking",
    action: "resync",
    entityId: null,
    status: errors === 0 ? "ok" : "error",
    detail: `payment pull: ${pulled} pulled, ${paymentDeleted} deleted, ${skipped} skipped, ${errors} errors`,
  });

  return { pulled, deleted: paymentDeleted, skipped, errors, total: scPayments.length };
}

export async function getLastSyncLogs(limit = 20): Promise<unknown[]> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM sport_sync_logs ORDER BY created_at DESC LIMIT ${limit}
    `);
    return result.rows;
  } catch {
    return [];
  }
}

export async function pullLegacyBookingsFromSupabase(): Promise<{ pulled: number; deleted: number; errors: number; total: number }> {
  // Pastikan kolom sc_booking_id ada (self-bootstrapping, idempoten).
  // Pisah ALTER TABLE dan CREATE INDEX agar satu tidak memblokir yang lain.
  let scIdColumnExists = false;
  try {
    await db.execute(sql`ALTER TABLE sport_bookings ADD COLUMN IF NOT EXISTS sc_booking_id INTEGER`);
    scIdColumnExists = true;
  } catch { /* non-fatal — tabel belum ada atau circuit breaker */ }
  if (scIdColumnExists) {
    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sport_bookings_sc_id ON sport_bookings(sc_booking_id) WHERE sc_booking_id IS NOT NULL`);
    } catch { /* index non-fatal */ }
  }

  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  if (!client) {
    console.warn(`${PREFIX} pullLegacyBookings: Sport Center Supabase client tidak tersedia, skip`);
    return { pulled: 0, deleted: 0, errors: 0, total: 0 };
  }

  // Query sport_center schema (bukan public) — include id untuk sc_booking_id
  const { data, error } = await (client as any)
    .schema("sport_center")
    .from("sport_bookings")
    .select("id, order_number, customer_name, customer_phone, customer_email, facility_id, booking_date, start_time, end_time, duration_hours, total_price, grand_total, status, billing_status, notes, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`${PREFIX} pullLegacyBookings: fetch gagal`, error.message);
    return { pulled: 0, deleted: 0, errors: 1, total: 0 };
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
  }>;

  // Lookup facility names from sport_facilities
  let facilityMap: Record<number, string> = {};
  try {
    const facRes = await (client as any).schema("sport_center").from("sport_facilities").select("id, name");
    if (facRes.data) {
      for (const f of facRes.data) facilityMap[f.id] = f.name;
    }
  } catch { }

  let pulled = 0;
  let errors = 0;

  for (const row of rows) {
    const bookingNumber = row.order_number ?? `LEGACY-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const facilityName = (row.facility_id ? facilityMap[row.facility_id] : null) ?? "Unknown";
    const bookingDate = row.booking_date;
    const startTime = row.start_time?.slice(0, 5) ?? "00:00";
    const endTime = row.end_time?.slice(0, 5) ?? "01:00";
    const durationHours = Number(row.duration_hours ?? 1);
    // Harga fasilitas sudah INKLUSIF PPN — gunakan total_price (harga dasar fasilitas),
    // BUKAN grand_total (yang di sistem CST bisa sudah salah menambah PPN di atas harga inklusif).
    // Fallback ke grand_total hanya jika total_price null/undefined/zero.
    const rawTotalPrice = Number(row.total_price ?? 0);
    const rawGrandTotal = Number(row.grand_total ?? 0);
    const totalAmount = rawTotalPrice > 0 ? rawTotalPrice : rawGrandTotal;
    const rawStatus = row.status ?? "pending";
    const mappedStatus = rawStatus === "confirmed" ? "confirmed" : rawStatus === "cancelled" ? "cancelled" : rawStatus === "completed" ? "completed" : "pending";
    // billing_status di Supabase = payment status; map ke nilai lokal
    const rawBillingStatus = (row.billing_status ?? "").toLowerCase();
    const paymentStatus = rawBillingStatus === "paid" ? "paid"
      : rawBillingStatus === "partial" ? "partial"
      : rawBillingStatus === "free" ? "paid"
      : "unpaid";

    const scBookingId = row.id;
    try {
      // Lookup via booking_number (selalu reliable), tambah sc_booking_id jika kolom sudah ada
      const existing = await db.execute(sql`
        SELECT id FROM sport_bookings WHERE booking_number = ${bookingNumber} LIMIT 1
      `);
      if (existing.rows.length > 0) {
        // PROTECTION: jangan downgrade payment_status dari 'paid' ke 'unpaid'.
        // Prioritas: (1) ada payment confirmed di sport_center.sport_payments, (2) billing_status Supabase, (3) nilai lokal lama.
        const safePaymentStatus = sql`
          CASE
            WHEN EXISTS(
              SELECT 1 FROM sport_center.sport_payments p
              WHERE p.booking_id = ${scBookingId}
                AND p.status::text NOT IN ('pending','cancelled','canceled','refunded','failed','expired')
            ) THEN 'paid'
            WHEN payment_status = 'paid' THEN 'paid'
            ELSE ${paymentStatus}::TEXT
          END
        `;
        if (scIdColumnExists) {
          const beforeRes = await db.execute(sql`SELECT payment_status FROM sport_bookings WHERE booking_number = ${bookingNumber} LIMIT 1`).catch(() => ({ rows: [] }));
          const prevPay = (beforeRes.rows[0] as any)?.payment_status;
          if (prevPay === "paid" && paymentStatus !== "paid") {
            console.log(`${PREFIX} pullLegacy [PROTEKSI PAID] ${bookingNumber}: local=paid supabase billing_status=${row.billing_status ?? "null"} → tetap paid`);
          } else if (prevPay !== "paid" && paymentStatus === "paid") {
            console.log(`${PREFIX} pullLegacy [UPGRADE PAID] ${bookingNumber}: local=${prevPay} → paid (billing_status=${row.billing_status})`);
          }
          await db.execute(sql`
            UPDATE sport_bookings SET
              customer_name   = ${row.customer_name},
              customer_phone  = ${row.customer_phone ?? null},
              facility_name   = ${facilityName},
              booking_date    = ${bookingDate}::DATE,
              start_time      = ${startTime}::TIME,
              end_time        = ${endTime}::TIME,
              duration_hours  = ${durationHours},
              base_amount     = ${totalAmount},
              total_amount    = ${totalAmount},
              status          = ${mappedStatus},
              payment_status  = ${safePaymentStatus},
              notes           = ${row.notes ?? null},
              sc_booking_id   = ${scBookingId},
              updated_at      = NOW()
            WHERE booking_number = ${bookingNumber}
          `);
        } else {
          await db.execute(sql`
            UPDATE sport_bookings SET
              customer_name   = ${row.customer_name},
              customer_phone  = ${row.customer_phone ?? null},
              facility_name   = ${facilityName},
              booking_date    = ${bookingDate}::DATE,
              start_time      = ${startTime}::TIME,
              end_time        = ${endTime}::TIME,
              duration_hours  = ${durationHours},
              base_amount     = ${totalAmount},
              total_amount    = ${totalAmount},
              status          = ${mappedStatus},
              payment_status  = ${safePaymentStatus},
              notes           = ${row.notes ?? null},
              updated_at      = NOW()
            WHERE booking_number = ${bookingNumber}
          `);
        }
      } else if (scIdColumnExists) {
        await db.execute(sql`
          INSERT INTO sport_bookings
            (company_id, booking_number, customer_name, customer_phone,
             facility_name, booking_date, start_time, end_time,
             duration_hours, base_amount, total_amount,
             status, payment_status, notes, sc_booking_id, created_at, updated_at)
          VALUES
            (1, ${bookingNumber}, ${row.customer_name}, ${row.customer_phone ?? null},
             ${facilityName}, ${bookingDate}::DATE, ${startTime}::TIME, ${endTime}::TIME,
             ${durationHours}, ${totalAmount}, ${totalAmount},
             ${mappedStatus}, ${paymentStatus}, ${row.notes ?? null},
             ${scBookingId},
             ${row.created_at ?? new Date().toISOString()}::TIMESTAMPTZ, NOW())
        `);
      } else {
        await db.execute(sql`
          INSERT INTO sport_bookings
            (company_id, booking_number, customer_name, customer_phone,
             facility_name, booking_date, start_time, end_time,
             duration_hours, base_amount, total_amount,
             status, payment_status, notes, created_at, updated_at)
          VALUES
            (1, ${bookingNumber}, ${row.customer_name}, ${row.customer_phone ?? null},
             ${facilityName}, ${bookingDate}::DATE, ${startTime}::TIME, ${endTime}::TIME,
             ${durationHours}, ${totalAmount}, ${totalAmount},
             ${mappedStatus}, ${paymentStatus}, ${row.notes ?? null},
             ${row.created_at ?? new Date().toISOString()}::TIMESTAMPTZ, NOW())
        `);
      }
      console.log(`${PREFIX} pull legacy booking OK → ${bookingNumber} (${row.customer_name} / ${facilityName})`);
      pulled++;
    } catch (err) {
      console.error(`${PREFIX} pull legacy booking gagal → ${bookingNumber}:`, err);
      errors++;
    }
  }

  // ── Deletion sync: hapus local bookings yang sudah didelete dari Sport Center Supabase ──
  let deleted = 0;
  if (rows.length > 0 && scIdColumnExists) {
    try {
      const supabaseScIds = new Set(rows.map(r => r.id));
      const localRes = await db.execute(sql`
        SELECT id, booking_number, sc_booking_id FROM sport_bookings
        WHERE sc_booking_id IS NOT NULL
      `).catch(() => ({ rows: [] as any[] }));
      const toDelete = (localRes.rows as any[]).filter(
        row => !supabaseScIds.has(Number(row.sc_booking_id))
      );
      for (const bk of toDelete) {
        const bkId = Number(bk.id);
        // Ambil sport_payments untuk booking ini
        const payRes = await db.execute(sql`SELECT id FROM sport_payments WHERE booking_id = ${bkId}`).catch(() => ({ rows: [] as any[] }));
        for (const pay of payRes.rows as any[]) {
          const payId = Number(pay.id);
          // Hapus accounting_payments dulu
          await db.execute(sql`DELETE FROM accounting_payments WHERE source_type = 'sport_center' AND source_doc_id = ${payId}`).catch(() => {});
        }
        // Hapus sport_payments
        await db.execute(sql`DELETE FROM sport_payments WHERE booking_id = ${bkId}`).catch(() => {});
        // Hapus sport_bookings
        await db.execute(sql`DELETE FROM sport_bookings WHERE id = ${bkId}`).catch(() => {});
        console.log(`${PREFIX} pullLegacyBookings [DELETE] ${bk.booking_number} (sc_booking_id=${bk.sc_booking_id}) → dihapus dari BizPortal`);
        deleted++;
      }
      if (deleted > 0) {
        console.log(`${PREFIX} pullLegacyBookings: ${deleted} booking dihapus (sudah dihapus dari Supabase Sport Center)`);
        void writeSyncLog({
          entity: "booking",
          action: "delete",
          entityId: null,
          status: "ok",
          detail: `deletion sync: ${deleted} booking dihapus dari BizPortal (sudah tidak ada di Supabase)`,
        });
      }
    } catch (err) {
      console.error(`${PREFIX} pullLegacyBookings deletion sync gagal (non-fatal):`, err);
    }
  }

  console.log(`${PREFIX} pullLegacyBookings selesai: ${pulled} pulled, ${deleted} deleted, ${errors} errors dari ${rows.length} total`);
  return { pulled, deleted, errors, total: rows.length };
}

export async function pullFacilitiesFromSupabase(): Promise<{ pulled: number; skipped: number; errors: number; total: number }> {
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  if (!client) {
    console.warn(`${PREFIX} pullFacilities: Sport Center Supabase client tidak tersedia, skip`);
    return { pulled: 0, skipped: 0, errors: 0, total: 0 };
  }

  const { data, error } = await (client as any)
    .schema("sport_center")
    .from("sport_facilities")
    .select("id, name, category, description, price_per_hour");

  if (error) {
    console.error(`${PREFIX} pullFacilities: fetch gagal`, error.message);
    return { pulled: 0, skipped: 0, errors: 1, total: 0 };
  }

  const rows = (data ?? []) as Array<{
    id: number;
    name: string;
    category?: string | null;
    description?: string | null;
    price_per_hour?: number | null;
  }>;

  let pulled = 0;
  let skipped = 0;
  let errors = 0;

  for (const f of rows) {
    try {
      const existing = await db.execute(sql`SELECT id FROM sport_facilities WHERE name = ${f.name} LIMIT 1`);
      if (existing.rows.length > 0) {
        // Update jika price atau category berubah
        await db.execute(sql`
          UPDATE sport_facilities SET
            type           = ${f.category ?? "court"},
            description    = COALESCE(${f.description ?? null}, description),
            price_per_hour = ${Number(f.price_per_hour ?? 0)},
            updated_at     = NOW()
          WHERE name = ${f.name}
        `);
        skipped++;
      } else {
        await db.execute(sql`
          INSERT INTO sport_facilities
            (company_id, name, type, description, price_per_hour, capacity, is_active, sort_order)
          VALUES
            (1, ${f.name}, ${f.category ?? "court"}, ${f.description ?? null},
             ${Number(f.price_per_hour ?? 0)}, 1, TRUE, 0)
        `);
        pulled++;
      }
      console.log(`${PREFIX} pullFacilities OK → "${f.name}"`);
    } catch (err) {
      console.error(`${PREFIX} pullFacilities gagal → "${f.name}":`, err);
      errors++;
    }
  }

  void writeSyncLog({
    entity: "facility", action: "resync", entityId: null,
    status: errors === 0 ? "ok" : "error",
    detail: `pull: ${pulled} new, ${skipped} updated, ${errors} errors dari ${rows.length} total`,
  });

  console.log(`${PREFIX} pullFacilities selesai: ${pulled} new, ${skipped} updated, ${errors} errors dari ${rows.length} total`);
  return { pulled, skipped, errors, total: rows.length };
}

export interface DailyPaymentSyncResult {
  startedAt: string;
  completedAt: string;
  triggeredBy: "scheduler" | "manual";
  bookings: { pulled: number; deleted: number; errors: number; total: number };
  payments: { pulled: number; deleted: number; skipped: number; errors: number; total: number };
  accounting: { synced: number; skipped: number; errors: number };
  statusUpdated: number;
  auditLogId: number | null;
}

/**
 * runDailyPaymentSync
 * Orkestrasi sinkronisasi harian Sport Center:
 * 1. Pull booking terbaru dari Supabase → sport_bookings lokal
 * 2. Pull payments dari Supabase → sport_payments lokal
 * 3. Sync payments ke accounting_payments (idempoten)
 * 4. Update status booking paid yang belum terupdate
 * 5. Tulis audit log ke sport_sync_logs
 */
export async function runDailyPaymentSync(
  companyId = 1,
  triggeredBy: "scheduler" | "manual" = "scheduler"
): Promise<DailyPaymentSyncResult> {
  const startedAt = new Date().toISOString();
  console.log(`${PREFIX} [dailySync] Mulai — triggeredBy=${triggeredBy} company_id=${companyId}`);

  // ── 1. Pull bookings dari Supabase ──────────────────────────────────────────
  let bookingsResult = { pulled: 0, deleted: 0, errors: 0, total: 0 };
  try {
    bookingsResult = await pullLegacyBookingsFromSupabase();
    console.log(`${PREFIX} [dailySync] Booking pull: pulled=${bookingsResult.pulled} deleted=${bookingsResult.deleted} errors=${bookingsResult.errors} total=${bookingsResult.total}`);
  } catch (err) {
    console.error(`${PREFIX} [dailySync] pullLegacyBookingsFromSupabase gagal:`, err);
    bookingsResult.errors++;
  }

  // ── 2. Pull payments dari Supabase → sport_payments lokal ───────────────────
  let paymentsResult = { pulled: 0, deleted: 0, skipped: 0, errors: 0, total: 0 };
  try {
    paymentsResult = await pullPaymentsFromSupabase(companyId);
    console.log(`${PREFIX} [dailySync] Payment pull: pulled=${paymentsResult.pulled} deleted=${paymentsResult.deleted} skipped=${paymentsResult.skipped} errors=${paymentsResult.errors} total=${paymentsResult.total}`);
  } catch (err) {
    console.error(`${PREFIX} [dailySync] pullPaymentsFromSupabase gagal:`, err);
    paymentsResult.errors++;
  }

  // ── 3. Sync ke accounting_payments ─────────────────────────────────────────
  let accountingResult = { synced: 0, skipped: 0, errors: 0 };
  try {
    accountingResult = await syncPaymentsToAccounting(companyId);
    console.log(`${PREFIX} [dailySync] Accounting sync: synced=${accountingResult.synced} skipped=${accountingResult.skipped} errors=${accountingResult.errors}`);
  } catch (err) {
    console.error(`${PREFIX} [dailySync] syncPaymentsToAccounting gagal:`, err);
    accountingResult.errors++;
  }

  // ── 4. Update status booking paid yang belum terupdate ─────────────────────
  let statusUpdated = 0;
  try {
    // Booking yang punya sport_payment paid tapi status booking-nya belum reflect payment
    const updateRes = await db.execute(sql`
      UPDATE sport_bookings sb
      SET
        payment_status = 'paid',
        status = CASE
          WHEN sb.status NOT IN ('cancelled', 'completed', 'checked_in') THEN 'confirmed'
          ELSE sb.status
        END,
        updated_at = NOW()
      WHERE sb.company_id = ${companyId}
        AND sb.payment_status != 'paid'
        AND EXISTS (
          SELECT 1 FROM sport_payments sp
          WHERE sp.booking_id = sb.id
            AND sp.status = 'paid'
            AND sp.company_id = ${companyId}
        )
      RETURNING id
    `);
    statusUpdated = updateRes.rows.length;
    if (statusUpdated > 0) {
      console.log(`${PREFIX} [dailySync] Status booking diupdate: ${statusUpdated} booking → payment_status=paid`);
    }
  } catch (err) {
    console.error(`${PREFIX} [dailySync] Update status booking gagal:`, err);
  }

  // ── 5. Pull tenant_payments dari Sport Center Supabase → lokal DB ───────────
  let tenantPullResult = { pulled: 0, skipped: 0, errors: 0 };
  try {
    tenantPullResult = await pullTenantPaymentsFromSportCenter(companyId);
    console.log(`${PREFIX} [dailySync] Tenant pull: pulled=${tenantPullResult.pulled} skipped=${tenantPullResult.skipped} errors=${tenantPullResult.errors}`);
  } catch (err) {
    console.error(`${PREFIX} [dailySync] pullTenantPaymentsFromSportCenter gagal:`, err);
    tenantPullResult.errors++;
  }

  // ── 6. Sync tenant_payments → accounting_payments ───────────────────────────
  let tenantSyncResult = { synced: 0, skipped: 0, errors: 0 };
  try {
    tenantSyncResult = await syncTenantPaymentsFromSportCenter(companyId);
    console.log(`${PREFIX} [dailySync] Tenant sync: synced=${tenantSyncResult.synced} skipped=${tenantSyncResult.skipped} errors=${tenantSyncResult.errors}`);
  } catch (err) {
    console.error(`${PREFIX} [dailySync] syncTenantPaymentsFromSportCenter gagal:`, err);
    tenantSyncResult.errors++;
  }

  // ── 7. Tulis audit log ──────────────────────────────────────────────────────
  const completedAt = new Date().toISOString();
  const summary =
    `SYNC_SPORT_CENTER triggeredBy=${triggeredBy}: ` +
    `bookings pulled=${bookingsResult.pulled} deleted=${bookingsResult.deleted} errors=${bookingsResult.errors} | ` +
    `payments pulled=${paymentsResult.pulled} deleted=${paymentsResult.deleted} skipped=${paymentsResult.skipped} errors=${paymentsResult.errors} | ` +
    `accounting synced=${accountingResult.synced} skipped=${accountingResult.skipped} | ` +
    `tenantPulled=${tenantPullResult.pulled} tenantSynced=${tenantSyncResult.synced} | ` +
    `statusUpdated=${statusUpdated}`;

  let auditLogId: number | null = null;
  try {
    const logRes = await db.execute(sql`
      INSERT INTO sport_sync_logs
        (entity, action, entity_id, status, detail, company_id)
      VALUES
        ('booking', 'resync', NULL,
         ${bookingsResult.errors + paymentsResult.errors + accountingResult.errors + tenantPullResult.errors + tenantSyncResult.errors > 0 ? 'error' : 'ok'},
         ${summary},
         ${companyId})
      RETURNING id
    `);
    auditLogId = Number((logRes.rows[0] as any)?.id ?? null) || null;
  } catch (err) {
    console.error(`${PREFIX} [dailySync] Tulis audit log gagal (non-fatal):`, err);
  }

  const result: DailyPaymentSyncResult = {
    startedAt,
    completedAt,
    triggeredBy,
    bookings: bookingsResult,
    payments: paymentsResult,
    accounting: accountingResult,
    statusUpdated,
    auditLogId,
  };

  console.log(`${PREFIX} [dailySync] Selesai — durasi=${Date.now() - new Date(startedAt).getTime()}ms auditLogId=${auditLogId}`);
  return result;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * pullTenantPaymentsFromSportCenter
 * Copy tenant_payments (payment_status=PAID) dari Sport Center Supabase
 * public schema → BizPortal lokal tenant_payments (idempoten via payment_number TPSC-{id}).
 * ───────────────────────────────────────────────────────────────────────────── */
export async function pullTenantPaymentsFromSportCenter(
  companyId = 1,
): Promise<{ pulled: number; skipped: number; errors: number }> {
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  if (!client) {
    console.warn(`${PREFIX} pullTenantPaymentsFromSportCenter: Supabase client tidak tersedia`);
    return { pulled: 0, skipped: 0, errors: 0 };
  }

  const { data: rows, error } = await (client as any)
    .from("tenant_payments")
    .select("id, company_id, tenant_id, payment_number, amount, payment_method, notes, paid_at, created_at, status")
    .eq("payment_status", "PAID");

  if (error) {
    console.error(`${PREFIX} pullTenantPaymentsFromSportCenter: fetch gagal`, error.message);
    return { pulled: 0, skipped: 0, errors: 1 };
  }

  const payments = (rows ?? []) as Array<{
    id: number; company_id: number; tenant_id: number | null;
    payment_number: string | null; amount: number;
    payment_method: string | null; notes: string | null;
    paid_at: string | null; created_at: string; status: string | null;
  }>;

  let pulled = 0;
  let skipped = 0;
  let errors = 0;

  for (const tp of payments) {
    try {
      // Gunakan TPSC-{id} sebagai payment_number canonical agar idempoten
      const payNum = tp.payment_number?.trim() || `TPSC-${tp.id}`;

      const existingRes = await db.execute(sql`
        SELECT id FROM tenant_payments WHERE payment_number = ${payNum} LIMIT 1
      `);
      if (existingRes.rows.length > 0) { skipped++; continue; }

      const payDate = (tp.paid_at ?? tp.created_at ?? "").split("T")[0]
        ?? new Date().toISOString().split("T")[0]!;
      const amt = Math.round(Number(tp.amount) * 100) / 100;
      const method = tp.payment_method ?? "tunai";

      await db.execute(sql`
        INSERT INTO tenant_payments
          (company_id, site_id, tenant_id, payment_number, amount, method, payment_method,
           notes, status, payment_status, paid_at, created_at, updated_at, approval_status)
        VALUES
          (${companyId}, 1, ${tp.tenant_id ?? null}, ${payNum}, ${amt}, ${method}, ${method},
           ${tp.notes ?? null}, 'confirmed', 'PAID',
           ${payDate}::timestamptz, ${tp.created_at}::timestamptz, NOW(), 'approved')
        ON CONFLICT DO NOTHING
      `);
      pulled++;
      console.log(`${PREFIX} pullTenantPaymentsFromSportCenter: pulled SC id=${tp.id} → ${payNum} amt=${amt}`);
    } catch (err) {
      errors++;
      console.error(`${PREFIX} pullTenantPaymentsFromSportCenter: error id=${tp.id}`, err);
    }
  }

  return { pulled, skipped, errors };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * syncTenantPaymentsFromSportCenter
 * Sync tenant_payments (status PAID) dari Sport Center Supabase public schema
 * → accounting_payments (source_type='tenant_sc') di BizPortal.
 * Idempoten: skip jika source_doc_id sudah ada.
 * ───────────────────────────────────────────────────────────────────────────── */
export async function syncTenantPaymentsFromSportCenter(
  companyId = 1,
): Promise<{ synced: number; skipped: number; errors: number }> {
  let client: import("@supabase/supabase-js").SupabaseClient | null = null;
  try {
    const { getSportCenterSupabaseClient } = await import("../../lib/supabaseAdminSportCenter.js");
    client = getSportCenterSupabaseClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  } catch { }

  if (!client) {
    console.warn(`${PREFIX} syncTenantPaymentsFromSportCenter: Supabase client tidak tersedia`);
    return { synced: 0, skipped: 0, errors: 0 };
  }

  // Fetch dari public schema (bukan sport_center schema)
  const { data: rows, error } = await (client as any)
    .from("tenant_payments")
    .select("id, company_id, tenant_id, payment_number, amount, payment_method, notes, paid_at, created_at")
    .eq("payment_status", "PAID");

  if (error) {
    console.error(`${PREFIX} syncTenantPaymentsFromSportCenter: fetch gagal`, error.message);
    return { synced: 0, skipped: 0, errors: 1 };
  }

  const payments = rows ?? [];
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  const settingsRes = await db.execute(sql`
    SELECT cash_journal_id, bank_journal_id, default_cash_account_id, default_bank_account_id,
           sales_income_account_id
    FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
  `).catch(() => ({ rows: [] }));
  const settings = (settingsRes.rows[0] as any) ?? {};
  const journalId = settings.cash_journal_id ?? settings.bank_journal_id;
  const debitAccountId = settings.default_cash_account_id ?? settings.default_bank_account_id;
  const creditAccountId = settings.sales_income_account_id;

  if (!journalId || !debitAccountId || !creditAccountId) {
    console.warn(`${PREFIX} syncTenantPaymentsFromSportCenter: akun/jurnal akuntansi belum dikonfigurasi — skip`);
    return { synced: 0, skipped: payments.length, errors: 0 };
  }

  const journalCode = settings.cash_journal_id ? "CSH" : "BNK";

  for (const tp of payments as Array<{
    id: number; company_id: number; tenant_id: number | null;
    payment_number: string | null; amount: number;
    payment_method: string | null; notes: string | null;
    paid_at: string | null; created_at: string;
  }>) {
    try {
      const existingRes = await db.execute(sql`
        SELECT id FROM accounting_payments
        WHERE source_type = 'tenant_sc' AND source_doc_id = ${tp.id}
        LIMIT 1
      `);
      if (existingRes.rows.length > 0) { skipped++; continue; }

      const payDate = (tp.paid_at ?? tp.created_at ?? "").split("T")[0]
        ?? new Date().toISOString().split("T")[0]!;
      const year = payDate.slice(0, 4);
      const cntRes = await db.execute(sql`SELECT CAST(COUNT(*) AS int) AS seq FROM accounting_payments WHERE company_id = ${companyId}`);
      const seq = Number((cntRes.rows[0] as any)?.seq ?? 0);
      const payNum = tp.payment_number ?? `TCPAY/${year}/${(seq + 1).toString().padStart(4, "0")}`;
      const amt = Math.round(Number(tp.amount) * 100) / 100;

      // 1. Insert accounting_payments
      await db.execute(sql`
        INSERT INTO accounting_payments
          (company_id, payment_number, date, amount, source_type, source_doc_id, status,
           payment_method, partner_name, journal_id, created_at, updated_at)
        VALUES
          (${companyId}, ${payNum}, ${payDate}::date, ${amt}, 'tenant_sc', ${tp.id},
           'posted', ${tp.payment_method ?? "tunai"}, 'Tenant #' || COALESCE(${tp.tenant_id}::text, '?'),
           ${journalId}, NOW(), NOW())
        ON CONFLICT DO NOTHING
      `);

      // 2. Post journal entry via postEntry (gunakan postTenantRentPayment tidak bisa karena ID beda)
      const { postEntry } = await import("../../lib/accounting.js");
      const apRes = await db.execute(sql`
        SELECT id FROM accounting_payments
        WHERE source_type = 'tenant_sc' AND source_doc_id = ${tp.id} LIMIT 1
      `);
      const apId = Number((apRes.rows[0] as any)?.id ?? 0);

      const alreadyPosted = await db.execute(sql`
        SELECT id FROM accounting_entries
        WHERE source = 'tenant_rent_payment' AND source_id = ${tp.id} LIMIT 1
      `);
      if (alreadyPosted.rows.length === 0) {
        await postEntry(
          {
            journalId,
            date: new Date(payDate),
            ref: payNum,
            description: `Pembayaran Sewa Tenant #${tp.tenant_id ?? "?"} (${payNum})`,
            source: "tenant_rent_payment",
            sourceId: tp.id,
            createdById: null,
            companyId,
            costCenterId: null,
            lines: [
              { accountId: debitAccountId, debit: amt, credit: 0, description: `Penerimaan sewa ${payNum}` },
              { accountId: creditAccountId, debit: 0, credit: amt, description: `Pendapatan Sewa Tenant #${tp.tenant_id ?? "?"}` },
            ],
          },
          journalCode,
        );
      }

      synced++;
      console.log(`${PREFIX} syncTenantPaymentsFromSportCenter: synced tenant_payment id=${tp.id} payNum=${payNum} amt=${amt}`);
    } catch (err) {
      errors++;
      console.error(`${PREFIX} syncTenantPaymentsFromSportCenter: error id=${tp.id}`, err);
    }
  }

  return { synced, skipped, errors };
}
