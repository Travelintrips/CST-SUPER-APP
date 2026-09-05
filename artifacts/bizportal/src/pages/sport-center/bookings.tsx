import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, QrCode, CheckCircle2, XCircle, RefreshCw, Activity, DollarSign, ArrowLeft, CloudUpload, Database } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  pending_payment: "Menunggu Bayar",
  confirmed: "Konfirmasi",
  checked_in: "Check-In",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-900/40 text-yellow-300 border-yellow-600",
  pending_payment: "bg-orange-900/40 text-orange-300 border-orange-600",
  confirmed: "bg-blue-900/40 text-blue-300 border-blue-600",
  checked_in: "bg-purple-900/40 text-purple-300 border-purple-600",
  completed: "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  cancelled: "bg-red-900/40 text-red-300 border-red-600",
};
const PAY_COLOR: Record<string, string> = {
  pending:         "bg-orange-900/30 text-orange-300 border-orange-700",
  pending_payment: "bg-amber-900/30 text-amber-300 border-amber-700",
  unpaid:          "bg-red-900/30 text-red-300 border-red-700",
  paid:            "bg-emerald-900/30 text-emerald-300 border-emerald-700",
  partial:         "bg-yellow-900/30 text-yellow-300 border-yellow-700",
};
const PAY_LABEL: Record<string, string> = {
  pending:         "Belum Bayar",
  pending_payment: "Menunggu Bayar",
  unpaid:          "Belum Bayar",
  paid:            "Lunas",
  partial:         "Sebagian",
};

type Booking = Record<string, unknown>;
type Facility = { id: number; name: string; price_per_hour: number };

export default function SportCenterBookings() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const esRef = useRef<EventSource | null>(null);


  const [statusFilter, setStatusFilter] = useState(() =>
    new URLSearchParams(window.location.search).get("status") ?? "all"
  );

  const [paymentFilter, setPaymentFilter] = useState(() =>
    new URLSearchParams(window.location.search).get("payment") ?? "all"
  );


  const [dateFilter, setDateFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [realtimeCount, setRealtimeCount] = useState(0);
  const [payBooking, setPayBooking] = useState<Booking | null>(null);
  const [payForm, setPayForm] = useState({ method: "cash", notes: "" });
  const pushDoneRef = useRef(false);
  const syncLegacyDoneRef = useRef(false);

  const [form, setForm] = useState({
    customer_name: "", customer_phone: "", facility_id: "",
    booking_date: "", start_time: "", end_time: "", duration_hours: "1",
    base_amount: "0", total_amount: "0", notes: "",
  });

  useEffect(() => {
    pushDoneRef.current = false;
    syncLegacyDoneRef.current = false;
  }, [activeCompanyId]);

  const { data, isLoading } = useQuery<{ data: Booking[]; total: number }>({
    queryKey: ["sport-center-bookings", activeCompanyId, statusFilter, paymentFilter, dateFilter, searchText, page, pageSize],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (paymentFilter !== "all") qs.set("payment_status", paymentFilter);
      if (dateFilter) qs.set("date", dateFilter);
      if (searchText.trim()) qs.set("search", searchText.trim());
      qs.set("page", String(page));
      qs.set("limit", String(pageSize));
      try {
        const r = await fetch(`/api/sport-center/bookings?${qs}`, { credentials: "include" });
        if (!r.ok) return { data: [], total: 0 };
        return r.json();
      } catch {
        return { data: [], total: 0 };
      }
    },
  });

  const { data: facilities } = useQuery<Facility[]>({
    queryKey: ["sport-center-facilities-list", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/sport-center/facilities${qs}`, { credentials: "include" });
      const json = await r.json();
      return Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    },
  });

  // ── Supabase fallback (saat local kosong) ────────────────────────────────
  const { data: supaBookings, isLoading: supaLoading } = useQuery<Booking[]>({
    queryKey: ["sport-center-supabase-bookings-raw"],
    queryFn: async () => {
      if (!supabase) return [];
      // Query sport_center schema via schema() selector
      const scClient = (supabase as any).schema("sport_center");
      const [bookingsRes, paymentsRes, facilitiesRes] = await Promise.all([
        scClient
          .from("bookings")
          .select("id, order_number, customer_name, customer_phone, facility_id, booking_date, start_time, end_time, duration_hours, total_price, billing_status, status, grand_total, notes, created_at")
          .order("created_at", { ascending: false }),
        scClient
          .from("payments")
          .select("id, booking_id, status, amount")
          .not("status", "in", '("pending","cancelled","canceled","refunded","failed","expired")'),
        scClient.from("facilities").select("id, name"),
      ]);
      if (bookingsRes.error || !bookingsRes.data) return [];
      // Set of booking_ids yang sudah punya confirmed payment di sport_center.payments
      const paidBookingIds = new Set<number>(
        (paymentsRes.data ?? []).map((p: any) => Number(p.booking_id))
      );
      // Facility map
      const facilityMap: Record<number, string> = {};
      for (const f of (facilitiesRes.data ?? [])) facilityMap[f.id] = f.name;
      return bookingsRes.data.map((b: any) => {
        const billingPaid = ["paid", "free", "partial"].includes((b.billing_status ?? "").toLowerCase());
        const hasPaidPayment = paidBookingIds.has(Number(b.id));
        const rawBilling = (b.billing_status ?? "").toLowerCase();
        const paymentStatus = hasPaidPayment || rawBilling === "paid" || rawBilling === "free"
          ? "paid"
          : rawBilling === "partial"
          ? "partial"
          : billingPaid ? "paid" : "unpaid";
        return {
          id: b.id ?? b.order_number ?? "-",
          booking_number: b.order_number ?? "-",
          customer_name: b.customer_name ?? "-",
          customer_phone: b.customer_phone ?? "-",
          facility_name: (b.facility_id ? facilityMap[b.facility_id] : null) ?? `Fasilitas #${b.facility_id ?? "-"}`,
          booking_date: b.booking_date ?? "-",
          start_time: (b.start_time ?? "").slice(0, 5),
          end_time: (b.end_time ?? "").slice(0, 5),
          duration_hours: b.duration_hours ?? 1,
          total_amount: Number(b.grand_total ?? b.total_price ?? 0),
          status: b.status ?? "pending",
          payment_status: paymentStatus,
          notes: b.notes,
          _from_supabase: true,
        };
      });
    },
    enabled: !!supabase,
  });

  const localEmpty = !isLoading && (data?.data ?? []).length === 0;
  const showingSupabase = localEmpty && (supaBookings ?? []).length > 0;

  // ── Auto-push Supabase → local saat local kosong ──────────────────────────
  const pushMutation = useMutation({
    mutationFn: async (rows: Booking[]) => {
      const rawRows = rows.map((b) => ({
        booking_code: b.booking_number,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        facility_name: b.facility_name,
        date: b.booking_date,
        start_time: b.start_time,
        end_time: b.end_time,
        total_hours: b.duration_hours,
        total_price: b.total_amount,
        status: b.status,
        payment_status: b.payment_status,
        notes: b.notes,
        created_at: null,
      }));
      const r = await fetch("/api/sport-center/sync/push-bookings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookings: rawRows, companyId: activeCompanyId }),
      });
      if (!r.ok) throw new Error("Push gagal");
      return r.json();
    },
    onSuccess: (res) => {
      if (res.pushed > 0) {
        toast({ title: `${res.pushed} booking Supabase berhasil disinkron ke lokal` });
        qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
      }
    },
    onError: () => { /* silent — auto-push gagal tidak perlu overlay */ },
  });

  useEffect(() => {
    if (pushDoneRef.current) return;
    if (isLoading || supaLoading) return;
    if (!showingSupabase) return;
    if (!supaBookings || supaBookings.length === 0) return;
    pushDoneRef.current = true;
    pushMutation.mutate(supaBookings);
  }, [isLoading, supaLoading, showingSupabase, supaBookings, pushMutation]);

  // ── Supabase Realtime: pantau sport_center.bookings + sport_center.payments ──
  useEffect(() => {
    if (!supabase) return;

    let syncTimeout: ReturnType<typeof setTimeout> | null = null;
    const triggerSync = () => {
      if (syncTimeout) clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        setRealtimeCount((c) => c + 1);
        qc.invalidateQueries({ queryKey: ["sport-center-supabase-bookings-raw"] });
        void fetch("/api/sport-center/sync/accounting", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: activeCompanyId ?? 1 }),
        }).then((r) => {
          if (r.ok) {
            qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
          }
        }).catch(() => {});
      }, 800);
    };

    const channel = supabase
      .channel("sport-center-rt-v2")
      .on("postgres_changes", { event: "*", schema: "sport_center", table: "payments" }, triggerSync)
      .on("postgres_changes", { event: "*", schema: "sport_center", table: "bookings" }, triggerSync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[SportCenter] Realtime subscribed: sport_center.payments + sport_center.bookings");
        }
      });

    return () => {
      if (syncTimeout) clearTimeout(syncTimeout);
      void supabase?.removeChannel(channel);
    };
  }, [activeCompanyId, qc]);

  useEffect(() => {
    const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    const es = new EventSource(`/api/sport-center/events${qs}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "connected") return;
        if (ev.entity === "booking") {
          qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
          setRealtimeCount((c) => c + 1);
        }
      } catch {}
    };
    return () => { es.close(); };
  }, [activeCompanyId, qc]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/sport-center/bookings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Booking berhasil dibuat" });
      setShowCreateDialog(false);
      setForm({ customer_name: "", customer_phone: "", facility_id: "", booking_date: "", start_time: "", end_time: "", duration_hours: "1", base_amount: "0", total_amount: "0", notes: "" });
      qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const payMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/sport-center/payments", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Pembayaran berhasil dicatat" });
      setPayBooking(null);
      setPayForm({ method: "cash", notes: "" });
      qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
      qc.invalidateQueries({ queryKey: ["sport-center-payments"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const checkinMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/bookings/${id}/checkin`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal check-in");
    },
    onSuccess: () => {
      toast({ title: "Check-in berhasil" });
      qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await fetch(`/api/sport-center/bookings/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Gagal update");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sport-center-bookings"] }),
  });

  const syncLegacyMutation = useMutation({
    mutationFn: async (sourceRows?: Booking[]) => {
      // Step 1: server-side full sync (pull bookings + payments dari Supabase admin → local DB)
      let serverResult: { ok?: boolean; bookings?: any; payments?: any } = {};
      try {
        const sr = await fetch("/api/sport-center/sync/accounting", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: activeCompanyId ?? 1 }),
        });
        if (sr.ok) serverResult = await sr.json();
      } catch { /* server-side sync opsional — fallback ke frontend sync */ }

      // Step 2: frontend-based fallback — update payment_status dari supaBookings (cek payments table)
      const bookings = sourceRows ?? supaBookings ?? [];
      const rows = bookings
        .filter((b: any) => b.booking_number && b.payment_status && b.payment_status !== "unpaid")
        .map((b: any) => ({ booking_number: b.booking_number, payment_status: b.payment_status }));
      let updated = 0;
      if (rows.length > 0) {
        const r = await fetch("/api/sport-center/sync/update-payment-status", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        if (r.ok) {
          const res = await r.json();
          updated = res.updated ?? 0;
        }
      }
      return { updated, serverResult };
    },
    onSuccess: (res) => {
      const pulled = (res.serverResult?.bookings?.pulled ?? 0) + (res.serverResult?.payments?.pulled ?? 0);
      const total = res.updated + pulled;
      if (total > 0 || res.updated > 0) {
        toast({ title: `Sync selesai — ${res.updated} status diperbarui${pulled > 0 ? `, ${pulled} data ditarik dari Supabase` : ""}` });
      } else {
        toast({ title: "Sync selesai — tidak ada perubahan baru" });
      }
      qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
      qc.invalidateQueries({ queryKey: ["sport-center-supabase-bookings-raw"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // Auto-sync saat supaBookings berhasil di-fetch
  useEffect(() => {
    if (syncLegacyDoneRef.current) return;
    if (!supaBookings || supaBookings.length === 0) return;
    syncLegacyDoneRef.current = true;
    void syncLegacyMutation.mutateAsync(supaBookings).catch(() => {});
  }, [supaBookings, syncLegacyMutation]);

  const handleFacilityChange = (facilityId: string) => {
    const f = facilities?.find((x) => String(x.id) === facilityId);
    const hours = Number(form.duration_hours || 1);
    const price = f ? f.price_per_hour * hours : 0;
    setForm((p) => ({ ...p, facility_id: facilityId, base_amount: String(price), total_amount: String(price) }));
  };

  const supaFiltered: Booking[] = (supaBookings ?? []).filter((b) =>
    (!searchText || String(b.customer_name).toLowerCase().includes(searchText.toLowerCase()) || String(b.booking_number).toLowerCase().includes(searchText.toLowerCase())) &&
    (statusFilter === "all" || b.status === statusFilter) &&
    (!dateFilter || b.booking_date === dateFilter),
  );
  const supaTotal = supaFiltered.length;
  const supaStart = (page - 1) * pageSize;

  const displayRows: Booking[] = showingSupabase
    ? supaFiltered.slice(supaStart, supaStart + pageSize)
    : (data?.data ?? []).filter((b: any) =>
        !searchText ||
        String(b.customer_name).toLowerCase().includes(searchText.toLowerCase()) ||
        String(b.booking_number).toLowerCase().includes(searchText.toLowerCase()),
      );

  const totalRows = showingSupabase ? supaTotal : (data?.total ?? 0);
  const fromRow = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRow = Math.min(page * pageSize, totalRows);

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/sport-center/dashboard")} className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Bookings</h1>
              <p className="text-sm text-muted-foreground">Kelola semua booking fasilitas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {realtimeCount > 0 && (
              <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-600 text-xs gap-1">
                <Activity className="h-3 w-3" /> Live
              </Badge>
            )}
            {showingSupabase && (
              <Badge className="bg-blue-900/40 text-blue-300 border-blue-600 text-xs gap-1">
                <Database className="h-3 w-3" /> Supabase
              </Badge>
            )}
            <Button
              variant="outline" size="sm"
              className="gap-1 text-xs border-blue-700 text-blue-400 hover:bg-blue-900/30"
              onClick={() => { syncLegacyDoneRef.current = false; void (syncLegacyMutation.mutateAsync as (a?: any) => any)().catch(() => {}); }}
              disabled={syncLegacyMutation.isPending}
            >
              <RefreshCw className={`h-3 w-3 ${syncLegacyMutation.isPending ? "animate-spin" : ""}`} />
              {syncLegacyMutation.isPending ? "Syncing…" : "Sinkron Supabase"}
            </Button>
            <Button onClick={() => setShowCreateDialog(true)} size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> Buat Booking
            </Button>
          </div>
        </div>

        {showingSupabase && (
          <Alert className="border-blue-700/50 bg-blue-900/20">
            <Database className="h-4 w-4 text-blue-400" />
            <AlertDescription className="text-blue-300 text-sm">
              Data dari Supabase (lokal belum tersinkron).{" "}
              {pushMutation.isPending && <span className="text-yellow-300"><RefreshCw className="inline h-3 w-3 animate-spin mr-1" />Sedang sinkron ke lokal…</span>}
              {pushMutation.isSuccess && <span className="text-emerald-300">✓ Berhasil disinkron ke lokal</span>}
              {!pushMutation.isPending && !pushMutation.isSuccess && (
                <Button variant="link" size="sm" className="text-blue-400 p-0 h-auto text-xs"
                  onClick={() => { pushDoneRef.current = false; void pushMutation.mutateAsync(supaBookings ?? []); }}>
                  <CloudUpload className="h-3 w-3 mr-1" /> Sinkron ke lokal
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Cari nama / no. booking…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} className="pl-8" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="pending_payment">Menunggu Bayar</SelectItem>
              <SelectItem value="confirmed">Konfirmasi</SelectItem>
              <SelectItem value="checked_in">Check-In</SelectItem>
              <SelectItem value="completed">Selesai</SelectItem>
              <SelectItem value="cancelled">Dibatalkan</SelectItem>
            </SelectContent>
          </Select>
          <Select value={paymentFilter} onValueChange={(v) => { setPaymentFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Pembayaran</SelectItem>
              <SelectItem value="pending">Belum Bayar</SelectItem>
              <SelectItem value="pending_payment">Menunggu Bayar</SelectItem>
              <SelectItem value="paid">Lunas</SelectItem>
              <SelectItem value="partial">Sebagian</SelectItem>
              <SelectItem value="unpaid">Tidak Bayar</SelectItem>
            </SelectContent>
          </Select>
          <DatePicker value={dateFilter} onChange={(v) => { setDateFilter(v); setPage(1); }} className="w-40" />
          {dateFilter && (
            <Button variant="ghost" size="sm" onClick={() => setDateFilter("")}>
              <XCircle className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Tampilkan</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-[72px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">data</span>
          </div>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["No. Booking","Pelanggan","Fasilitas","Tanggal","Jam","Status","Pembayaran","Total","Aksi"].map((h) => (
                      <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(isLoading && supaLoading) ? (
                    <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                  ) : displayRows.length === 0 ? (
                    <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">Tidak ada booking</td></tr>
                  ) : displayRows.map((b: any) => (
                    <tr key={b.id} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{b.booking_number}</td>
                      <td className="py-2.5 px-3">
                        <p className="text-foreground font-medium">{b.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{b.customer_phone}</p>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">{b.facility_name}</td>
                      <td className="py-2.5 px-3 text-muted-foreground">{b.booking_date}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs">{b.start_time}–{b.end_time}</td>
                      <td className="py-2.5 px-3">
                        <Badge className={`text-xs border ${STATUS_COLOR[b.status as string] ?? ""}`}>
                          {STATUS_LABEL[b.status as string] ?? b.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge className={`text-xs border ${PAY_COLOR[b.payment_status as string] ?? "bg-muted text-muted-foreground border-border"}`}>
                          {PAY_LABEL[b.payment_status as string] ?? String(b.payment_status)}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-foreground">{idr(Number(b.total_amount))}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          {b.payment_status !== "paid" && !["cancelled"].includes(b.status as string) && (
                            <Button size="sm" variant="outline" className="text-xs h-7 px-2 gap-1 text-emerald-400 border-emerald-700 hover:bg-emerald-900/30"
                              onClick={() => { setPayBooking(b); setPayForm({ method: "cash", notes: "" }); }}>
                              <DollarSign className="h-3 w-3" /> Bayar
                            </Button>
                          )}
                          {b.status === "confirmed" && (
                            <Button size="sm" variant="outline" className="text-xs h-7 px-2 gap-1"
                              onClick={() => checkinMutation.mutate(b.id as number)}>
                              <QrCode className="h-3 w-3" /> Check-in
                            </Button>
                          )}
                          {b.status === "pending" && (
                            <Button size="sm" variant="outline" className="text-xs h-7 px-2 text-emerald-400 border-emerald-700"
                              onClick={() => statusMutation.mutate({ id: b.id as number, status: "confirmed" })}>
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
                          )}
                          {!["cancelled","completed","checked_in"].includes(b.status as string) && (
                            <Button size="sm" variant="ghost" className="text-xs h-7 px-2 text-red-400"
                              onClick={() => statusMutation.mutate({ id: b.id as number, status: "cancelled" })}>
                              <XCircle className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {totalRows === 0
              ? "Tidak ada data"
              : `Menampilkan ${fromRow}–${toRow} dari ${totalRows} data`}
          </span>
          {totalRows > pageSize && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="text-xs px-1">{page} / {Math.ceil(totalRows / pageSize)}</span>
              <Button variant="outline" size="sm" disabled={toRow >= totalRows} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>

        {/* Payment Dialog */}
        <Dialog open={!!payBooking} onOpenChange={(o) => { if (!o) { setPayBooking(null); setPayForm({ method: "cash", notes: "" }); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Catat Pembayaran Booking</DialogTitle></DialogHeader>
            {payBooking && (
              <div className="grid gap-3 py-2">
                <div className="rounded-lg bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">No. Booking</span>
                    <span className="font-mono font-medium">{payBooking.booking_number as string}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pelanggan</span>
                    <span>{payBooking.customer_name as string}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fasilitas</span>
                    <span>{payBooking.facility_name as string}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tanggal</span>
                    <span>{payBooking.booking_date as string}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-border/40 pt-1 mt-1">
                    <span>Total Tagihan</span>
                    <span className="text-emerald-400">{idr(Number(payBooking.total_amount))}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Metode Pembayaran</Label>
                  <Select value={payForm.method} onValueChange={(v) => setPayForm((p) => ({ ...p, method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Tunai</SelectItem>
                      <SelectItem value="transfer">Transfer Bank</SelectItem>
                      <SelectItem value="qris">QRIS</SelectItem>
                      <SelectItem value="card">Kartu</SelectItem>
                      <SelectItem value="other">Lainnya</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Catatan</Label>
                  <Input value={payForm.notes} onChange={(e) => setPayForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Opsional" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setPayBooking(null); setPayForm({ method: "cash", notes: "" }); }}>Batal</Button>
              <Button
                disabled={payMutation.isPending}
                className="bg-emerald-700 hover:bg-emerald-600"
                onClick={() => payBooking && payMutation.mutate({
                  company_id: payBooking.company_id ?? activeCompanyId,
                  booking_id: payBooking.id,
                  amount: payBooking.total_amount,
                  method: payForm.method,
                  notes: payForm.notes,
                })}
              >
                {payMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Konfirmasi Pembayaran"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Buat Booking Baru</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nama Pelanggan *</Label>
                  <Input value={form.customer_name} onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))} placeholder="Nama" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">No. HP</Label>
                  <Input value={form.customer_phone} onChange={(e) => setForm((p) => ({ ...p, customer_phone: e.target.value }))} placeholder="08xx" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fasilitas *</Label>
                <Select value={form.facility_id} onValueChange={handleFacilityChange}>
                  <SelectTrigger><SelectValue placeholder="Pilih fasilitas" /></SelectTrigger>
                  <SelectContent>
                    {(facilities ?? []).map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name} — {idr(f.price_per_hour)}/jam</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tanggal *</Label>
                  <DatePicker value={form.booking_date} onChange={(v) => setForm((p) => ({ ...p, booking_date: v }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Mulai *</Label>
                  <Input type="time" value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Selesai *</Label>
                  <Input type="time" value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Durasi (jam)</Label>
                  <Input type="number" min="0.5" step="0.5" value={form.duration_hours}
                    onChange={(e) => {
                      const h = Number(e.target.value);
                      const f = facilities?.find((x) => String(x.id) === form.facility_id);
                      const price = f ? f.price_per_hour * h : 0;
                      setForm((p) => ({ ...p, duration_hours: e.target.value, base_amount: String(price), total_amount: String(price) }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Total (IDR)</Label>
                  <Input type="number" value={form.total_amount} onChange={(e) => setForm((p) => ({ ...p, total_amount: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Catatan</Label>
                <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Opsional" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Batal</Button>
              <Button
                disabled={!form.customer_name || !form.facility_id || !form.booking_date || createMutation.isPending}
                onClick={() => {
                  const fac = facilities?.find((x) => String(x.id) === form.facility_id);
                  createMutation.mutate({
                    company_id: activeCompanyId,
                    customer_name: form.customer_name, customer_phone: form.customer_phone,
                    facility_id: Number(form.facility_id), facility_name: fac?.name ?? "",
                    booking_date: form.booking_date, start_time: form.start_time, end_time: form.end_time,
                    duration_hours: Number(form.duration_hours), base_amount: Number(form.base_amount),
                    total_amount: Number(form.total_amount), notes: form.notes,
                  });
                }}
              >
                {createMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Buat Booking"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
