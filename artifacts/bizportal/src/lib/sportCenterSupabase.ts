/**
 * fetchSportCenterData — baca langsung dari schema sport_center di Supabase.
 *
 * Schema: sport_center
 * Tabel utama:
 *   bookings   — id, order_number, customer_name, customer_phone, facility_id,
 *                booking_date, start_time, end_time, duration_hours, total_price,
 *                billing_status (=payment_status), status, grand_total, created_at
 *   facilities — id, name, category, price_per_hour, is_active
 *   payments   — id, booking_id, amount, payment_method, status, confirmed_at
 */
import { supabase } from "./supabaseClient";

export interface SupabaseBooking {
  booking_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  facility_name: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  payment_status: string | null;
  total_price: number | null;
  created_at: string | null;
}

export interface SupabaseService {
  id: number;
  name: string | null;
  category: string | null;
  price_per_hour: number | null;
  is_active: boolean | null;
}

export interface SupabaseFacility {
  id: number;
  name: string | null;
  usage_count: number | null;
  revenue_total: number | null;
}

export interface SportCenterSupabaseData {
  totalBookings: number;
  pendingPayment: number;
  uniqueCustomers: number;
  activeServices: number;
  totalRevenue: number;
  monthRevenue: number;
  byStatus: { status: string; count: string }[];
  topFacilities: { facility_name: string; bookings: string; revenue: string }[];
  recentBookings: Record<string, unknown>[];
}

export class SportCenterFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SportCenterFetchError";
  }
}

type ScBookingRow = {
  id: number;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  facility_id: number | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_hours: number | null;
  total_price: number | null;
  billing_status: string | null;
  status: string | null;
  grand_total: number | null;
  created_at: string | null;
};

type ScFacilityRow = {
  id: number;
  name: string | null;
  category: string | null;
  price_per_hour: number | null;
  is_active: boolean | null;
};

export async function fetchSportCenterData(): Promise<SportCenterSupabaseData> {
  if (!supabase) {
    throw new SportCenterFetchError("Supabase tidak dikonfigurasi (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing)");
  }

  const sc = (supabase as any).schema("sport_center");
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [bookingsRes, facilitiesRes] = await Promise.all([
    sc.from("bookings")
      .select("id, order_number, customer_name, customer_phone, facility_id, booking_date, start_time, end_time, duration_hours, total_price, billing_status, status, grand_total, created_at")
      .order("created_at", { ascending: false }),
    sc.from("facilities")
      .select("id, name, category, price_per_hour, is_active"),
  ]);

  const allFailed = bookingsRes.error && facilitiesRes.error;
  if (allFailed) {
    const errMsg = bookingsRes.error?.message ?? "Gagal memuat data dari Supabase sport_center";
    console.error("[sportCenterSupabase] semua fetch gagal:", errMsg);
    throw new SportCenterFetchError(`Gagal memuat data dari Supabase: ${errMsg}`);
  }

  if (bookingsRes.error)   console.error("[sportCenterSupabase] bookings error:", bookingsRes.error.message);
  if (facilitiesRes.error) console.error("[sportCenterSupabase] facilities error:", facilitiesRes.error.message);

  const rawBookings: ScBookingRow[]  = (bookingsRes.data  ?? []) as ScBookingRow[];
  const facilities:  ScFacilityRow[] = (facilitiesRes.data ?? []) as ScFacilityRow[];

  const facilityMap: Record<number, string> = {};
  for (const f of facilities) {
    if (f.id) facilityMap[f.id] = f.name ?? `Fasilitas ${f.id}`;
  }

  const bookings: SupabaseBooking[] = rawBookings.map((b) => ({
    booking_code:   b.order_number,
    customer_name:  b.customer_name,
    customer_phone: b.customer_phone,
    facility_name:  b.facility_id ? (facilityMap[b.facility_id] ?? `Fasilitas ${b.facility_id}`) : null,
    date:           b.booking_date,
    start_time:     b.start_time,
    end_time:       b.end_time,
    status:         b.status,
    payment_status: b.billing_status,
    total_price:    b.grand_total ?? b.total_price,
    created_at:     b.created_at,
  }));

  const totalBookings = bookings.length;

  const pendingPayment = bookings.filter((b) =>
    ["pending", "pending_payment", "menunggu_pembayaran"].includes(b.status?.toLowerCase() ?? ""),
  ).length;

  const uniqueCustomers = new Set(
    bookings.map((b) => b.customer_phone?.trim() ?? b.customer_name?.trim() ?? "").filter(Boolean),
  ).size;

  const activeServices = facilities.filter((f) => f.is_active === true).length;

  const totalRevenue  = bookings.reduce((sum, b) => sum + Number(b.total_price ?? 0), 0);
  const monthRevenue  = bookings
    .filter((b) => b.date != null && b.date >= monthStart)
    .reduce((sum, b) => sum + Number(b.total_price ?? 0), 0);

  const statusMap: Record<string, number> = {};
  for (const b of bookings) {
    const s = b.status ?? "unknown";
    statusMap[s] = (statusMap[s] ?? 0) + 1;
  }
  const byStatus = Object.entries(statusMap)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ status, count: String(count) }));

  const fMap: Record<string, { count: number; revenue: number }> = {};
  for (const b of bookings) {
    const name = b.facility_name?.trim() ?? "Unknown";
    if (!fMap[name]) fMap[name] = { count: 0, revenue: 0 };
    fMap[name].count  += 1;
    fMap[name].revenue += Number(b.total_price ?? 0);
  }
  const topFacilities = Object.entries(fMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, data]) => ({
      facility_name: name,
      bookings: String(data.count),
      revenue:  String(data.revenue),
    }));

  const recentBookings: Record<string, unknown>[] = bookings.slice(0, 20).map((b) => ({
    id:             b.booking_code ?? "-",
    booking_number: b.booking_code ?? "-",
    customer_name:  b.customer_name ?? "-",
    facility_name:  b.facility_name ?? "-",
    booking_date:   b.date ?? "-",
    status:         b.status ?? "-",
    payment_status: b.payment_status ?? "unpaid",
    total_amount:   Number(b.total_price ?? 0),
  }));

  console.log("[sportCenterSupabase] ✅ Fetch dari sport_center schema sukses:", {
    totalBookings,
    totalRevenue,
    monthRevenue,
    pendingPayment,
    uniqueCustomers,
    activeServices,
  });

  return {
    totalBookings,
    pendingPayment,
    uniqueCustomers,
    activeServices,
    totalRevenue,
    monthRevenue,
    byStatus,
    topFacilities,
    recentBookings,
  };
}

export function emptySupabaseData(): SportCenterSupabaseData {
  return {
    totalBookings: 0, pendingPayment: 0, uniqueCustomers: 0, activeServices: 0,
    totalRevenue: 0, monthRevenue: 0, byStatus: [], topFacilities: [], recentBookings: [],
  };
}

export async function fetchAllBookingsFromSportCenter(): Promise<SupabaseBooking[]> {
  if (!supabase) return [];
  const sc = (supabase as any).schema("sport_center");
  const [bookingsRes, facilitiesRes] = await Promise.all([
    sc.from("bookings")
      .select("id, order_number, customer_name, customer_phone, facility_id, booking_date, start_time, end_time, duration_hours, total_price, billing_status, status, grand_total, created_at")
      .order("created_at", { ascending: false }),
    sc.from("facilities").select("id, name"),
  ]);

  if (bookingsRes.error) {
    console.error("[sportCenterSupabase] fetchAllBookings error:", bookingsRes.error.message);
    return [];
  }

  const rawBookings: ScBookingRow[]  = (bookingsRes.data  ?? []) as ScBookingRow[];
  const facs: { id: number; name: string | null }[] = (facilitiesRes.data ?? []) as { id: number; name: string | null }[];
  const facilityMap: Record<number, string> = {};
  for (const f of facs) { if (f.id) facilityMap[f.id] = f.name ?? `Fasilitas ${f.id}`; }

  return rawBookings.map((b) => ({
    booking_code:   b.order_number,
    customer_name:  b.customer_name,
    customer_phone: b.customer_phone,
    facility_name:  b.facility_id ? (facilityMap[b.facility_id] ?? `Fasilitas ${b.facility_id}`) : null,
    date:           b.booking_date,
    start_time:     b.start_time,
    end_time:       b.end_time,
    status:         b.status,
    payment_status: b.billing_status,
    total_price:    b.grand_total ?? b.total_price,
    created_at:     b.created_at,
  }));
}
