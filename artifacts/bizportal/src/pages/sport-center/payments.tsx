import { DatePicker } from "@/components/ui/date-picker";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Activity, DollarSign, RefreshCw, ArrowLeft,
  Eye, XCircle, CalendarDays, Search, Pencil,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtDateTime = (s: string | null | undefined) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

type Payment = {
  id: number; payment_number: string; booking_id: number | null;
  booking_number: string | null; customer_name: string | null; booking_date: string | null;
  amount: number; method: string; status: string; paid_at: string | null;
  notes: string | null; facility_name: string | null; payment_type: string | null;
  bank_account_id: number | null; bank_account_name: string | null;
  local_payment_id: number | null;
  tax_rate: number; tax_amount: number;
  mdr_rate: number; mdr_amount: number; net_amount: number;
  settlement_reference: string | null; settlement_date: string | null;
  settlement_status: "unsettled" | "settled" | "partial" | "exception" | string;
  mdr_posting_status: "unposted" | "posted" | "failed" | string;
  mdr_accounting_entry_id: number | null; mdr_posting_error: string | null;
  related_payment_count?: number;
  related_booking_numbers?: string[];
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Tunai", transfer: "Transfer Bank", qris: "QRIS", card: "Kartu", other: "Lainnya",
};

export default function SportCenterPayments() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const esRef = useRef<EventSource | null>(null);
  const [realtimeCount, setRealtimeCount] = useState(0);

  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [showDialog, setShowDialog] = useState(false);
  const [detailPayment, setDetailPayment] = useState<Payment | null>(null);
  const [form, setForm] = useState({ booking_id: "", amount: "", method: "cash", notes: "", bank_account_id: "" });

  // Edit transaksi lama
  const [editPayment, setEditPayment] = useState<Payment | null>(null);
  const [editForm, setEditForm] = useState({
    method: "cash", bank_account_id: "", mdr_rate: "", mdr_amount: "",
    settlement_reference: "", settlement_date: "", settlement_status: "unsettled",
  });

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchQuery); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Rekening bank untuk metode non-tunai
  const { data: bankAccountsData } = useQuery<{ data: Array<{ id: number; name: string; bank_name: string | null; account_number: string | null }> }>({
    queryKey: ["cash-bank-accounts", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/cash-bank/accounts${qs}`, { credentials: "include" });
      return r.json();
    },
    enabled: !!activeCompanyId,
  });
  const bankAccounts = bankAccountsData?.data ?? [];

  const { data, isLoading } = useQuery<{ data: Payment[]; total: number; totalRevenue: number }>({
    queryKey: ["sport-center-payments", activeCompanyId, statusFilter, dateFrom, dateTo, debouncedSearch, page],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      if (debouncedSearch) qs.set("search", debouncedSearch);
      qs.set("page", String(page));
      const r = await fetch(`/api/sport-center/payments?${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  useEffect(() => {
    const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    const es = new EventSource(`/api/sport-center/events${qs}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "connected") return;
        if (ev.entity === "payment") {
          qc.invalidateQueries({ queryKey: ["sport-center-payments"] });
          setRealtimeCount((c) => c + 1);
        }
      } catch {}
    };
    return () => { es.close(); };
  }, [activeCompanyId, qc]);

  const createMutation = useMutation({
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
      toast({ title: "Pembayaran dicatat" });
      setShowDialog(false);
      setForm({ booking_id: "", amount: "", method: "cash", notes: "", bank_account_id: "" });
      qc.invalidateQueries({ queryKey: ["sport-center-payments"] });
      qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => {
      const r = await fetch(`/api/sport-center/payments/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal menyimpan");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Transaksi diperbarui" });
      setEditPayment(null);
      qc.invalidateQueries({ queryKey: ["sport-center-payments"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const mdrPostMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/payments/${id}/mdr/post`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal posting jurnal MDR");
      return r.json();
    },
    onSuccess: (result) => {
      toast({ title: `Jurnal MDR berhasil diposting${result.entryId ? ` (#${result.entryId})` : ""}` });
      setEditPayment(null);
      setDetailPayment(null);
      qc.invalidateQueries({ queryKey: ["sport-center-payments"] });
      qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const totalRevenue = data?.totalRevenue ?? 0;

  const hasDateFilter = dateFrom || dateTo;
  const displayedRows = data?.data ?? [];

  const resetFilters = () => {
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearchQuery("");
    setPage(1);
  };

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/sport-center/dashboard")} className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <DollarSign className="h-6 w-6 text-green-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Pembayaran Sport Center</h1>
              <p className="text-sm text-muted-foreground">
                Total nominal: {idr(totalRevenue)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {realtimeCount > 0 && (
              <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-600 text-xs gap-1">
                <Activity className="h-3 w-3" /> Live
              </Badge>
            )}
            <Button onClick={() => setShowDialog(true)} size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> Catat Pembayaran
            </Button>
          </div>
        </div>

        {/* Summary Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-border/60 bg-emerald-900/10">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Nominal Pembayaran</p>
              <p className="text-xl font-bold text-emerald-400 mt-1">{idr(totalRevenue)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-end gap-2">
          {/* Search */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Search className="h-3 w-3" /> Cari
            </Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="No. booking / nama / fasilitas…"
                className="h-8 text-xs pl-7 w-56"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="paid">Lunas</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Gagal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date From */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> Dari Tanggal
            </Label>
            <DatePicker value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(1); }} className="h-8 text-xs w-36" />
          </div>

          {/* Date To */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> Sampai Tanggal
            </Label>
            <DatePicker value={dateTo} onChange={(v) => { setDateTo(v); setPage(1); }} className="h-8 text-xs w-36" />
          </div>

          {/* Reset */}
          {(statusFilter !== "all" || hasDateFilter || searchQuery) && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground" onClick={resetFilters}>
              <XCircle className="h-3.5 w-3.5" /> Reset Filter
            </Button>
          )}
        </div>

        {/* Table */}
        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {[
                    "No. Pembayaran", "No. Booking", "Pelanggan",
                    "Fasilitas", "Tgl Booking", "Tgl Pembayaran",
                    "Metode", "Status", "Gross", "PPN", "MDR", "Net Settlement", "",
                  ].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={13} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : displayedRows.length === 0 ? (
                  <tr><td colSpan={13} className="py-10 text-center text-muted-foreground">
                    {searchQuery ? `Tidak ada hasil untuk "${searchQuery}"` : "Belum ada pembayaran"}
                  </td></tr>
                ) : displayedRows.map((p) => (
                  <tr key={p.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{p.payment_number}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      <div>{p.booking_number ?? "—"}</div>
                      {Number(p.related_payment_count ?? 1) > 1 && (
                        <div className="mt-0.5 font-sans text-[10px] text-sky-300">
                          Recurring · {p.related_payment_count} booking
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-foreground whitespace-nowrap">{p.customer_name ?? "—"}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{p.facility_name ?? "—"}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(p.booking_date)}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDateTime(p.paid_at)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className="bg-blue-900/30 text-blue-300 border-blue-700 text-xs">
                        {METHOD_LABEL[p.method] ?? p.method}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className={
                        p.status === "paid"
                          ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs"
                          : p.status === "pending"
                          ? "bg-yellow-900/30 text-yellow-300 border-yellow-700 text-xs"
                          : "bg-red-900/30 text-red-300 border-red-700 text-xs"
                      }>
                        {p.status === "paid" ? "Lunas" : p.status === "pending" ? "Pending" : p.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-foreground text-right whitespace-nowrap">
                      {idr(Number(p.amount))}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-right whitespace-nowrap">
                      {idr(Number(p.tax_amount ?? 0))}
                    </td>
                    <td className="py-2.5 px-3 text-amber-300 text-right whitespace-nowrap">
                      {Number(p.mdr_amount ?? 0) > 0 ? idr(Number(p.mdr_amount)) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-sky-300 text-right whitespace-nowrap">
                      {idr(Number(p.net_amount ?? p.amount))}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => setDetailPayment(p)}
                        >
                          <Eye className="h-3.5 w-3.5" /> Detail
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 px-2 text-xs gap-1 text-amber-500 hover:text-amber-400"
                          disabled={p.local_payment_id == null}
                          title={p.local_payment_id == null ? "Mirror lokal belum tersedia untuk diedit" : "Edit metode dan settlement"}
                          onClick={() => {
                            if (p.local_payment_id == null) return;
                            setEditPayment(p);
                            setEditForm({
                              method: p.method ?? "cash",
                              bank_account_id: p.bank_account_id ? String(p.bank_account_id) : "",
                               mdr_rate: p.mdr_rate ? String(p.mdr_rate) : "",
                               mdr_amount: p.mdr_amount ? String(p.mdr_amount) : "",
                               settlement_reference: p.settlement_reference ?? "",
                               settlement_date: p.settlement_date?.slice(0, 10) ?? "",
                               settlement_status: p.settlement_status ?? "unsettled",
                            });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {(data?.total ?? 0) > 50 && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-xs text-muted-foreground self-center">Hal. {page}</span>
            <Button variant="outline" size="sm" disabled={page * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}

        {/* Dialog: Catat Pembayaran */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Catat Pembayaran</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">ID Booking *</Label>
                <Input
                  type="number" placeholder="Masukkan ID booking"
                  value={form.booking_id}
                  onChange={(e) => setForm((p) => ({ ...p, booking_id: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">ID booking tersedia di halaman Bookings</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Jumlah (IDR) *</Label>
                <Input
                  type="number" min={0} value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Metode Pembayaran</Label>
                <Select
                  value={form.method}
                  onValueChange={(v) => setForm((p) => ({
                    ...p,
                    method: v,
                    // Reset pilihan rekening jika ganti ke tunai
                    bank_account_id: v === "cash" ? "" : p.bank_account_id,
                  }))}
                >
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
              {form.method !== "cash" && (
                <div className="space-y-1">
                  <Label className="text-xs">Rekening Bank Tujuan</Label>
                  <Select
                    value={form.bank_account_id}
                    onValueChange={(v) => setForm((p) => ({ ...p, bank_account_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih rekening bank…" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.length === 0 ? (
                        <SelectItem value="" disabled>Belum ada rekening bank</SelectItem>
                      ) : (
                        bankAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.name}{a.bank_name ? ` — ${a.bank_name}` : ""}{a.account_number ? ` (${a.account_number})` : ""}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Wajib diisi agar bisa dicocokan saat rekonsiliasi bank.
                  </p>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Catatan</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button
                disabled={!form.booking_id || !form.amount || createMutation.isPending}
                onClick={() => createMutation.mutate({
                  company_id: activeCompanyId,
                  booking_id: Number(form.booking_id),
                  amount: Number(form.amount),
                  method: form.method,
                  notes: form.notes,
                  ...(form.bank_account_id ? { bank_account_id: Number(form.bank_account_id) } : {}),
                })}
              >
                {createMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Catat Pembayaran"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: Edit Pembayaran */}
        <Dialog open={!!editPayment} onOpenChange={(o) => { if (!o) setEditPayment(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-amber-400" />
                Edit Metode Pembayaran
              </DialogTitle>
            </DialogHeader>
            {editPayment && (
              <div className="space-y-4 py-2">
                <div className="rounded-md bg-muted/30 border border-border/40 p-3 text-sm space-y-1">
                  <p className="text-xs text-muted-foreground">Transaksi</p>
                  <p className="font-mono font-medium">{editPayment.payment_number}</p>
                  <p className="text-muted-foreground text-xs">{editPayment.customer_name ?? "—"} · {idr(Number(editPayment.amount))}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Metode Pembayaran</Label>
                  <Select
                    value={editForm.method}
                    onValueChange={(v) => setEditForm((p) => ({
                      ...p,
                      method: v,
                      bank_account_id: v === "cash" ? "" : p.bank_account_id,
                    }))}
                  >
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
                {editForm.method !== "cash" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Rekening Bank Tujuan</Label>
                    <Select
                      value={editForm.bank_account_id}
                      onValueChange={(v) => setEditForm((p) => ({ ...p, bank_account_id: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih rekening bank…" />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.length === 0 ? (
                          <SelectItem value="" disabled>Belum ada rekening bank</SelectItem>
                        ) : (
                          bankAccounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.name}{a.bank_name ? ` — ${a.bank_name}` : ""}{a.account_number ? ` (${a.account_number})` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Wajib diisi agar cocok saat rekonsiliasi bank.
                    </p>
                  </div>
                )}
                {editForm.method === "qris" && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-amber-200">Settlement QRIS</p>
                      <p className="text-xs text-muted-foreground">
                        Gross tetap mengikuti transaksi pelanggan. Isi MDR aktual dari settlement provider untuk menghitung net bank.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">MDR (%)</Label>
                        <Input
                          type="number" min={0} max={100} step="0.0001"
                          value={editForm.mdr_rate}
                          onChange={(e) => setEditForm((p) => ({ ...p, mdr_rate: e.target.value }))}
                          placeholder="Contoh: 0.7"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">MDR (IDR)</Label>
                        <Input
                          type="number" min={0} step="1"
                          value={editForm.mdr_amount}
                          onChange={(e) => setEditForm((p) => ({ ...p, mdr_amount: e.target.value }))}
                          placeholder="Nominal aktual"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reference Settlement</Label>
                      <Input
                        value={editForm.settlement_reference}
                        onChange={(e) => setEditForm((p) => ({ ...p, settlement_reference: e.target.value }))}
                        placeholder="Reference dari provider/bank"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Tanggal Settlement</Label>
                        <Input
                          type="date"
                          value={editForm.settlement_date}
                          onChange={(e) => setEditForm((p) => ({ ...p, settlement_date: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Status Settlement</Label>
                        <Select
                          value={editForm.settlement_status}
                          onValueChange={(v) => setEditForm((p) => ({ ...p, settlement_status: v }))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unsettled">Belum settle</SelectItem>
                            <SelectItem value="partial">Partial</SelectItem>
                            <SelectItem value="settled">Settled</SelectItem>
                            <SelectItem value="exception">Exception</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground border-t border-border/30 pt-2">
                      <span>Net settlement</span>
                      <span className="font-medium text-sky-300">
                        {idr(Math.max(0, Number(editPayment.amount) - (Number(editForm.mdr_amount) || 0)))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPayment(null)}>Batal</Button>
              <Button
                disabled={editMutation.isPending || !editPayment}
                onClick={() => editPayment && editMutation.mutate({
                  id: editPayment.local_payment_id ?? editPayment.id,
                  body: {
                    method: editForm.method,
                    bank_account_id: editForm.bank_account_id ? Number(editForm.bank_account_id) : null,
                    ...(editPayment.method === "qris" || editForm.method === "qris"
                      ? {
                          mdr_rate: editForm.mdr_rate === "" ? 0 : Number(editForm.mdr_rate),
                          mdr_amount: editForm.mdr_amount === "" ? 0 : Number(editForm.mdr_amount),
                          settlement_reference: editForm.settlement_reference.trim(),
                          settlement_date: editForm.settlement_date || null,
                          settlement_status: editForm.settlement_status,
                        }
                      : {}),
                  },
                })}
              >
                {editMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: Detail Pembayaran */}
        <Dialog open={!!detailPayment} onOpenChange={(o) => { if (!o) setDetailPayment(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-400" />
                Detail Pembayaran
              </DialogTitle>
            </DialogHeader>
            {detailPayment && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">No. Pembayaran</p>
                    <p className="font-mono font-medium">{detailPayment.payment_number}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge className={
                      detailPayment.status === "paid"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs mt-0.5"
                        : detailPayment.status === "pending"
                        ? "bg-yellow-900/30 text-yellow-300 border-yellow-700 text-xs mt-0.5"
                        : "bg-red-900/30 text-red-300 border-red-700 text-xs mt-0.5"
                    }>
                      {detailPayment.status === "paid" ? "Lunas" : detailPayment.status === "pending" ? "Pending" : detailPayment.status}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">No. Booking</p>
                    <p className="font-mono">{detailPayment.booking_number ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pelanggan</p>
                    <p>{detailPayment.customer_name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fasilitas</p>
                    <p>{detailPayment.facility_name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tanggal Booking</p>
                    <p>{fmtDate(detailPayment.booking_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tanggal Bayar</p>
                    <p>{fmtDateTime(detailPayment.paid_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Metode</p>
                    <p>{METHOD_LABEL[detailPayment.method] ?? detailPayment.method}</p>
                  </div>
                  {detailPayment.bank_account_id && (
                    <div>
                      <p className="text-xs text-muted-foreground">Rekening Bank</p>
                      <p>{detailPayment.bank_account_name ?? `ID #${detailPayment.bank_account_id}`}</p>
                    </div>
                  )}
                  <div className="col-span-2 border-t border-border/30 pt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Rincian Settlement</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <span className="text-muted-foreground">Gross</span>
                      <span className="text-right font-medium">{idr(Number(detailPayment.amount))}</span>
                      <span className="text-muted-foreground">PPN{Number(detailPayment.tax_rate ?? 0) > 0 ? ` (${Number(detailPayment.tax_rate)}%)` : ""}</span>
                      <span className="text-right">{idr(Number(detailPayment.tax_amount ?? 0))}</span>
                      <span className="text-muted-foreground">MDR{Number(detailPayment.mdr_rate ?? 0) > 0 ? ` (${Number(detailPayment.mdr_rate)}%)` : ""}</span>
                      <span className="text-right text-amber-300">- {idr(Number(detailPayment.mdr_amount ?? 0))}</span>
                      <span className="font-medium text-sky-300">Net settlement</span>
                      <span className="text-right text-lg font-bold text-sky-300">{idr(Number(detailPayment.net_amount ?? detailPayment.amount))}</span>
                    </div>
                  </div>
                  <div className="col-span-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/30 pt-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Status Settlement</p>
                      <Badge className="mt-1 bg-slate-800 text-slate-200 border-slate-600 text-xs">
                        {detailPayment.settlement_status === "settled" ? "Settled" : detailPayment.settlement_status === "partial" ? "Partial" : detailPayment.settlement_status === "exception" ? "Exception" : "Belum settle"}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Posting MDR</p>
                      <Badge className={`mt-1 text-xs ${
                        detailPayment.mdr_posting_status === "posted"
                          ? "bg-emerald-900/30 text-emerald-300 border-emerald-700"
                          : detailPayment.mdr_posting_status === "failed"
                          ? "bg-red-900/30 text-red-300 border-red-700"
                          : "bg-amber-900/30 text-amber-300 border-amber-700"
                      }`}>
                        {detailPayment.mdr_posting_status === "posted" ? `Posted${detailPayment.mdr_accounting_entry_id ? ` #${detailPayment.mdr_accounting_entry_id}` : ""}` : detailPayment.mdr_posting_status === "failed" ? "Gagal" : "Belum diposting"}
                      </Badge>
                    </div>
                    {detailPayment.settlement_reference && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Reference Settlement</p>
                        <p className="font-mono text-xs">{detailPayment.settlement_reference}</p>
                      </div>
                    )}
                    {detailPayment.settlement_date && (
                      <div>
                        <p className="text-xs text-muted-foreground">Tanggal Settlement</p>
                        <p>{fmtDate(detailPayment.settlement_date)}</p>
                      </div>
                    )}
                  </div>
                  {detailPayment.notes && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Catatan</p>
                      <p className="text-muted-foreground">{detailPayment.notes}</p>
                    </div>
                  )}
                </div>

                {detailPayment.method === "qris"
                  && Number(detailPayment.mdr_amount ?? 0) > 0
                  && detailPayment.mdr_posting_status !== "posted"
                  && detailPayment.local_payment_id != null && (
                  <div className="pt-2 border-t border-border/30 space-y-2">
                    {detailPayment.mdr_posting_error && (
                      <p className="text-xs text-red-300">{detailPayment.mdr_posting_error}</p>
                    )}
                    <Button
                      size="sm"
                      className="w-full gap-1 bg-amber-600 hover:bg-amber-700"
                      disabled={mdrPostMutation.isPending}
                      onClick={() => mdrPostMutation.mutate(detailPayment.local_payment_id!)}
                    >
                      {mdrPostMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Posting Jurnal Biaya MDR"}
                    </Button>
                  </div>
                )}

                {detailPayment.booking_id && (
                  <div className="pt-2 border-t border-border/30">
                    <Button
                      variant="outline" size="sm" className="gap-1 text-xs w-full"
                      onClick={() => {
                        setDetailPayment(null);
                        navigate(`/sport-center/bookings`);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" /> Lihat Booking Terkait
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
