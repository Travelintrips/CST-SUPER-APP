import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  ArrowLeft, Clock, ExternalLink, Search, XCircle, CalendarDays,
  AlertTriangle, CheckCircle2, RefreshCw,
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

const METHOD_LABEL: Record<string, string> = {
  cash: "Tunai", transfer: "Transfer Bank", qris: "QRIS", card: "Kartu", other: "Lainnya",
};

type Payment = {
  id: number;
  payment_number: string;
  booking_id: number | null;
  booking_number: string | null;
  customer_name: string | null;
  booking_date: string | null;
  amount: number;
  method: string;
  status: string;
  raw_status: string | null;
  paid_at: string | null;
  facility_name: string | null;
  source: string;
};

export default function SportCenterPendingConfirmation() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();

  // Default: QRIS filter untuk rekonsiliasi
  const [methodFilter, setMethodFilter] = useState("qris");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchQuery); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data, isLoading, refetch, isFetching } = useQuery<{ data: Payment[]; total: number; totalRevenue: number }>({
    queryKey: ["sport-pending-confirm", activeCompanyId, methodFilter, dateFrom, dateTo, debouncedSearch, page],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      qs.set("status", "pending");
      if (methodFilter !== "all") qs.set("method", methodFilter);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      if (debouncedSearch) qs.set("search", debouncedSearch);
      qs.set("page", String(page));
      const r = await fetch(`/api/sport-center/payments?${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  const hasFilter = methodFilter !== "all" || dateFrom || dateTo || searchQuery;

  const resetFilters = () => {
    setMethodFilter("qris");
    setDateFrom("");
    setDateTo("");
    setSearchQuery("");
    setPage(1);
  };

  return (
    <AppShell>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 shrink-0 mt-0.5"
            onClick={() => navigate("/sport-center/payments")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-400" />
              <h1 className="text-xl font-bold text-foreground">
                Pembayaran Menunggu Konfirmasi
              </h1>
              {total > 0 && (
                <Badge className="bg-yellow-900/40 text-yellow-300 border-yellow-600 text-xs">
                  {total} pending
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pembayaran sport center yang belum dikonfirmasi operator — harus dikonfirmasi agar rekonsiliasi bank bisa diselesaikan
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Info callout */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-sm">
            <p className="font-medium text-amber-200">Apa yang harus dilakukan operator?</p>
            <p className="text-muted-foreground">
              Pembayaran di bawah berasal dari aplikasi Sport Center dengan status <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">pending</span>.
              Operator perlu membuka aplikasi Sport Center dan mengkonfirmasi pembayaran tersebut (ubah status ke <em>confirmed</em>/<em>paid</em>).
              Setelah dikonfirmasi, data akan otomatis tersinkronisasi ke sistem rekonsiliasi.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-muted-foreground text-xs">
                Setelah konfirmasi, refresh halaman ini untuk memperbarui daftar.
              </span>
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-border/60 bg-yellow-900/10">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Transaksi Pending</p>
              <p className="text-2xl font-bold text-yellow-400 mt-1">{total}</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-muted/10">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Nilai (halaman ini)</p>
              <p className="text-xl font-bold text-foreground mt-1">{idr(totalAmount)}</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-muted/10">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Filter Metode</p>
              <p className="text-xl font-bold text-sky-300 mt-1">
                {methodFilter === "all" ? "Semua" : METHOD_LABEL[methodFilter] ?? methodFilter}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filter bar */}
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
                className="h-8 text-xs pl-7 w-52"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Method filter */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Metode Pembayaran</Label>
            <Select value={methodFilter} onValueChange={(v) => { setMethodFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Metode</SelectItem>
                <SelectItem value="qris">QRIS</SelectItem>
                <SelectItem value="transfer">Transfer Bank</SelectItem>
                <SelectItem value="cash">Tunai</SelectItem>
                <SelectItem value="card">Kartu</SelectItem>
                <SelectItem value="other">Lainnya</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date from */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> Dari Tanggal
            </Label>
            <DatePicker value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(1); }} className="h-8 text-xs w-36" />
          </div>

          {/* Date to */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> Sampai Tanggal
            </Label>
            <DatePicker value={dateTo} onChange={(v) => { setDateTo(v); setPage(1); }} className="h-8 text-xs w-36" />
          </div>

          {/* Reset */}
          {hasFilter && (
            <Button
              variant="ghost" size="sm"
              className="h-8 gap-1 text-xs text-muted-foreground"
              onClick={resetFilters}
            >
              <XCircle className="h-3.5 w-3.5" /> Reset Filter
            </Button>
          )}

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs border-sky-700 text-sky-300 hover:bg-sky-900/20"
              onClick={() => navigate("/sport-center/payments")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Lihat Semua Pembayaran
            </Button>
          </div>
        </div>

        {/* Table */}
        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {[
                    "No. Pembayaran", "No. Booking", "Pelanggan",
                    "Fasilitas", "Tgl Booking", "Dibuat",
                    "Metode", "Status Raw", "Nilai",
                  ].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 opacity-50" />
                      Memuat data…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                      <p className="text-foreground font-medium">
                        {methodFilter !== "all"
                          ? `Tidak ada pembayaran ${METHOD_LABEL[methodFilter] ?? methodFilter} yang pending`
                          : "Tidak ada pembayaran pending"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Semua pembayaran sudah dikonfirmasi atau tidak ada transaksi sesuai filter.
                      </p>
                    </td>
                  </tr>
                ) : rows.map((p) => (
                  <tr key={`${p.source}-${p.id}`} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {p.payment_number}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {p.booking_number ?? "—"}
                    </td>
                    <td className="py-2.5 px-3 text-foreground whitespace-nowrap">
                      {p.customer_name ?? "—"}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">
                      {p.facility_name ?? "—"}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">
                      {fmtDate(p.booking_date)}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">
                      {fmtDateTime(p.paid_at)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className={
                        p.method === "qris"
                          ? "bg-purple-900/30 text-purple-300 border-purple-700 text-xs"
                          : p.method === "transfer"
                          ? "bg-blue-900/30 text-blue-300 border-blue-700 text-xs"
                          : "bg-muted/30 text-muted-foreground border-border text-xs"
                      }>
                        {METHOD_LABEL[p.method] ?? p.method}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="font-mono text-xs text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-1.5 py-0.5">
                        {p.raw_status ?? "pending"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-foreground text-right whitespace-nowrap">
                      {idr(Number(p.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {total > 50 && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-xs text-muted-foreground self-center">Hal. {page} · {total} transaksi</span>
            <Button variant="outline" size="sm" disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}

        {/* Footer nav */}
        <div className="flex items-center gap-3 pt-2 border-t border-border/30">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={() => navigate("/accounting/smart-bank-recon")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke Rekonsiliasi Bank
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={() => navigate("/sport-center/payments")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Semua Pembayaran Sport Center
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
