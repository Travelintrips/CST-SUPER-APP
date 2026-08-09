import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Building2, FileText, CheckCircle2, XCircle,
  Eye, Pencil, Trash2, Zap, RefreshCw, ChevronLeft,
} from "lucide-react";
import { Link } from "wouter";

const idr = (n: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(Number(n));

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const MONTHS = [
  { v: 1, l: "Januari" }, { v: 2, l: "Februari" }, { v: 3, l: "Maret" },
  { v: 4, l: "April" }, { v: 5, l: "Mei" }, { v: 6, l: "Juni" },
  { v: 7, l: "Juli" }, { v: 8, l: "Agustus" }, { v: 9, l: "September" },
  { v: 10, l: "Oktober" }, { v: 11, l: "November" }, { v: 12, l: "Desember" },
];

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  unpaid:    { label: "Belum Lunas", variant: "destructive" },
  paid:      { label: "Lunas",       variant: "default" },
  cancelled: { label: "Dibatalkan",  variant: "outline" },
};

type Client = {
  id: number; name: string; pic_name: string | null; pic_phone: string | null;
  pic_email: string | null; address: string | null; notes: string | null;
};

type Invoice = {
  id: number; invoice_number: string; client_id: number; client_name: string;
  pic_name: string | null; pic_phone: string | null; pic_email: string | null;
  period_month: number; period_year: number; subtotal: number; tax_rate: number;
  tax_amount: number; grand_total: number; status: string; notes: string | null;
  paid_at: string | null; created_at: string; item_count: number;
};

type InvoiceItem = {
  id: number; booking_number: string | null; customer_name: string | null;
  facility_name: string | null; booking_date: string | null; duration_hours: number;
  subtotal: number; tax_amount: number; total: number;
};

type InvoiceDetail = { invoice: Invoice & { client_address: string | null }; items: InvoiceItem[] };

type UnbilledBooking = {
  id: number; booking_number: string; customer_name: string;
  facility_name_resolved: string; booking_date: string;
  start_time: string; end_time: string; duration_hours: number; total_amount: number;
};

const now = new Date();

export default function SportCenterCompanyInvoices() {
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const cId = typeof activeCompanyId === "number" && activeCompanyId > 0 ? activeCompanyId : null;

  const [tab, setTab] = useState<"invoices" | "clients">("invoices");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Clients query ───────────────────────────────────────────────────────────
  const { data: clients = [] } = useQuery<Client[]>({
    enabled: cId != null,
    queryKey: ["sc-company-clients", cId],
    queryFn: async () => {
      const r = await fetch(`/api/sport-center/company-clients?companyId=${cId}`, { credentials: "include" });
      return r.json();
    },
  });

  // ── Invoices query ──────────────────────────────────────────────────────────
  const { data: invoiceData, isLoading: invLoading } = useQuery<{ data: Invoice[]; total: number }>({
    enabled: cId != null,
    queryKey: ["sc-company-invoices", cId, statusFilter, debouncedSearch],
    queryFn: async () => {
      const qs = new URLSearchParams({ companyId: String(cId) });
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const r = await fetch(`/api/sport-center/company-invoices?${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  // ── Invoice detail ──────────────────────────────────────────────────────────
  const [detailId, setDetailId] = useState<number | null>(null);
  const { data: detail } = useQuery<InvoiceDetail>({
    queryKey: ["sc-company-invoice-detail", detailId],
    queryFn: async () => {
      const r = await fetch(`/api/sport-center/company-invoices/${detailId}`, { credentials: "include" });
      return r.json();
    },
    enabled: detailId !== null,
  });

  // ── Generate invoice state ──────────────────────────────────────────────────
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState({
    client_id: "",
    period_month: String(now.getMonth() + 1),
    period_year: String(now.getFullYear()),
    tax_rate: "",
    notes: "",
  });
  const [unbilledBookings, setUnbilledBookings] = useState<UnbilledBooking[]>([]);
  const [selectedBookingIds, setSelectedBookingIds] = useState<number[]>([]);
  const [unbilledLoading, setUnbilledLoading] = useState(false);

  const loadUnbilled = async () => {
    if (!genForm.client_id) return;
    setUnbilledLoading(true);
    try {
      const qs = new URLSearchParams({
        companyId: String(cId),
        clientId: genForm.client_id,
        month: genForm.period_month,
        year: genForm.period_year,
      });
      const r = await fetch(`/api/sport-center/company-invoices/bookings-unbilled?${qs}`, { credentials: "include" });
      const data = await r.json();
      setUnbilledBookings(Array.isArray(data) ? data : []);
      setSelectedBookingIds(Array.isArray(data) ? data.map((b: UnbilledBooking) => b.id) : []);
    } finally {
      setUnbilledLoading(false);
    }
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (cId == null) throw new Error("Pilih perusahaan terlebih dahulu");
      const r = await fetch("/api/sport-center/company-invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...genForm,
          company_id: cId,
          client_id: Number(genForm.client_id),
          period_month: Number(genForm.period_month),
          period_year: Number(genForm.period_year),
          ...(genForm.tax_rate.trim() ? { tax_rate: Number(genForm.tax_rate) } : {}),
          booking_ids: selectedBookingIds.length ? selectedBookingIds : undefined,
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Invoice dibuat", description: `${data.invoice.invoice_number} — ${data.itemCount} sesi` });
      qc.invalidateQueries({ queryKey: ["sc-company-invoices"] });
      setShowGenerate(false);
      setUnbilledBookings([]);
      setSelectedBookingIds([]);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/company-invoices/${id}/mark-paid`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice ditandai lunas" });
      qc.invalidateQueries({ queryKey: ["sc-company-invoices"] });
      qc.invalidateQueries({ queryKey: ["sc-company-invoice-detail", detailId] });
    },
    onError: () => toast({ title: "Gagal", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/company-invoices/${id}/cancel`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice dibatalkan" });
      qc.invalidateQueries({ queryKey: ["sc-company-invoices"] });
      setDetailId(null);
    },
    onError: () => toast({ title: "Gagal", variant: "destructive" }),
  });

  // ── Client form ─────────────────────────────────────────────────────────────
  const [showClientForm, setShowClientForm] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [clientForm, setClientForm] = useState({ name: "", pic_name: "", pic_phone: "", pic_email: "", address: "", notes: "" });

  const openClientForm = (c?: Client) => {
    setEditClient(c ?? null);
    setClientForm(c ? { name: c.name, pic_name: c.pic_name ?? "", pic_phone: c.pic_phone ?? "", pic_email: c.pic_email ?? "", address: c.address ?? "", notes: c.notes ?? "" } : { name: "", pic_name: "", pic_phone: "", pic_email: "", address: "", notes: "" });
    setShowClientForm(true);
  };

  const clientMutation = useMutation({
    mutationFn: async () => {
      const url = editClient ? `/api/sport-center/company-clients/${editClient.id}` : "/api/sport-center/company-clients";
      const method = editClient ? "PUT" : "POST";
      const r = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ...clientForm, company_id: cId }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editClient ? "Klien diperbarui" : "Klien ditambahkan" });
      qc.invalidateQueries({ queryKey: ["sc-company-clients"] });
      setShowClientForm(false);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/sport-center/company-clients/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => { toast({ title: "Klien dihapus" }); qc.invalidateQueries({ queryKey: ["sc-company-clients"] }); },
    onError: () => toast({ title: "Gagal", variant: "destructive" }),
  });

  const invoices = invoiceData?.data ?? [];
  const totalInvoices = invoiceData?.total ?? 0;
  const totalUnpaid = invoices.filter(i => i.status === "unpaid").reduce((s, i) => s + Number(i.grand_total), 0);
  const totalPaid   = invoices.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.grand_total), 0);

  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <Link href="/tenant/workspace/sport-center">
          <button className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" />
            Kembali
          </button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Tagihan Perusahaan</h1>
            <p className="text-muted-foreground text-sm">Invoice bulanan untuk customer perusahaan</p>
          </div>
          <Button onClick={() => setShowGenerate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Generate Invoice
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Total Invoice</p>
              <p className="text-2xl font-bold">{totalInvoices}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Belum Lunas</p>
              <p className="text-2xl font-bold text-destructive">{idr(totalUnpaid)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Sudah Lunas</p>
              <p className="text-2xl font-bold text-green-500">{idr(totalPaid)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          {(["invoices", "clients"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`pb-2 px-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t === "invoices" ? "Daftar Invoice" : "Klien Perusahaan"}
            </button>
          ))}
        </div>

        {/* ── TAB: INVOICES ── */}
        {tab === "invoices" && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Cari invoice / perusahaan…" className="pl-9" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="unpaid">Belum Lunas</SelectItem>
                  <SelectItem value="paid">Lunas</SelectItem>
                  <SelectItem value="cancelled">Dibatalkan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Invoice</TableHead>
                    <TableHead>Perusahaan</TableHead>
                    <TableHead>Periode</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat…</TableCell></TableRow>
                  ) : invoices.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada invoice</TableCell></TableRow>
                  ) : invoices.map(inv => {
                    const sb = STATUS_BADGE[inv.status] ?? { label: inv.status, variant: "secondary" as const };
                    const monthName = MONTHS.find(m => m.v === Number(inv.period_month))?.l ?? inv.period_month;
                    return (
                      <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDetailId(inv.id)}>
                        <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                        <TableCell>
                          <div className="font-medium">{inv.client_name}</div>
                          {inv.pic_name && <div className="text-xs text-muted-foreground">{inv.pic_name}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{monthName} {inv.period_year}</TableCell>
                        <TableCell className="text-right font-medium">{idr(inv.grand_total)}</TableCell>
                        <TableCell><Badge variant={sb.variant}>{sb.label}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(inv.created_at)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setDetailId(inv.id); }}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* ── TAB: CLIENTS ── */}
        {tab === "clients" && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button onClick={() => openClientForm()} className="gap-2">
                <Plus className="w-4 h-4" /> Tambah Klien
              </Button>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Perusahaan</TableHead>
                    <TableHead>PIC</TableHead>
                    <TableHead>Telepon</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Belum ada klien perusahaan</TableCell></TableRow>
                  ) : clients.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.pic_name ?? "—"}</TableCell>
                      <TableCell>{c.pic_phone ?? "—"}</TableCell>
                      <TableCell>{c.pic_email ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openClientForm(c)}><Pencil className="w-4 h-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteClientMutation.mutate(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* ── Dialog: Generate Invoice ── */}
      <Dialog open={showGenerate} onOpenChange={v => { setShowGenerate(v); if (!v) { setUnbilledBookings([]); setSelectedBookingIds([]); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Generate Tagihan Perusahaan</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <Label>Klien Perusahaan *</Label>
                <Select value={genForm.client_id} onValueChange={v => { setGenForm(f => ({ ...f, client_id: v })); setUnbilledBookings([]); }}>
                  <SelectTrigger><SelectValue placeholder="Pilih klien…" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {clients.length === 0 && <p className="text-xs text-muted-foreground">Tambahkan klien di tab "Klien Perusahaan" terlebih dahulu.</p>}
              </div>
              <div className="space-y-1">
                <Label>Bulan *</Label>
                <Select value={genForm.period_month} onValueChange={v => { setGenForm(f => ({ ...f, period_month: v })); setUnbilledBookings([]); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map(m => <SelectItem key={m.v} value={String(m.v)}>{m.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Tahun *</Label>
                <Select value={genForm.period_year} onValueChange={v => { setGenForm(f => ({ ...f, period_year: v })); setUnbilledBookings([]); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>PPN (%)</Label>
                <Input type="number" value={genForm.tax_rate} onChange={e => setGenForm(f => ({ ...f, tax_rate: e.target.value }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Catatan</Label>
                <Textarea value={genForm.notes} onChange={e => setGenForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
            </div>

            {/* Load unbilled bookings */}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-2"
                onClick={loadUnbilled} disabled={!genForm.client_id || unbilledLoading}>
                <RefreshCw className={`w-4 h-4 ${unbilledLoading ? "animate-spin" : ""}`} />
                Cek Booking Belum Ditagih
              </Button>
              {unbilledBookings.length > 0 && (
                <span className="text-sm text-muted-foreground">{unbilledBookings.length} sesi ditemukan</span>
              )}
            </div>

            {/* Booking list */}
            {unbilledBookings.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-3 py-2 text-xs font-medium flex items-center justify-between">
                  <span>Pilih sesi yang akan ditagih</span>
                  <button className="text-primary hover:underline" onClick={() => {
                    if (selectedBookingIds.length === unbilledBookings.length) setSelectedBookingIds([]);
                    else setSelectedBookingIds(unbilledBookings.map(b => b.id));
                  }}>
                    {selectedBookingIds.length === unbilledBookings.length ? "Batal semua" : "Pilih semua"}
                  </button>
                </div>
                <div className="divide-y max-h-48 overflow-y-auto">
                  {unbilledBookings.map(b => {
                    const checked = selectedBookingIds.includes(b.id);
                    return (
                      <label key={b.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                        <input type="checkbox" checked={checked}
                          onChange={() => setSelectedBookingIds(prev =>
                            checked ? prev.filter(id => id !== b.id) : [...prev, b.id]
                          )} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{b.booking_number} — {b.customer_name}</div>
                          <div className="text-xs text-muted-foreground">{b.facility_name_resolved} • {fmtDate(b.booking_date)}</div>
                        </div>
                        <div className="text-sm font-medium shrink-0">{idr(b.total_amount)}</div>
                      </label>
                    );
                  })}
                </div>
                {selectedBookingIds.length > 0 && (
                  <div className="bg-muted/50 px-3 py-2 text-sm font-medium text-right">
                    Subtotal terpilih: {idr(
                      unbilledBookings.filter(b => selectedBookingIds.includes(b.id))
                        .reduce((s, b) => s + Number(b.total_amount), 0)
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerate(false)}>Batal</Button>
            <Button onClick={() => generateMutation.mutate()}
              disabled={!genForm.client_id || generateMutation.isPending || (unbilledBookings.length > 0 && selectedBookingIds.length === 0)}
              className="gap-2">
              <Zap className="w-4 h-4" />
              {generateMutation.isPending ? "Membuat…" : "Generate Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Invoice Detail ── */}
      <Dialog open={detailId !== null} onOpenChange={v => { if (!v) setDetailId(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detail ? (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <DialogTitle className="text-lg font-mono">{detail.invoice.invoice_number}</DialogTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">{detail.invoice.client_name}</p>
                  </div>
                  <Badge variant={STATUS_BADGE[detail.invoice.status]?.variant ?? "secondary"}>
                    {STATUS_BADGE[detail.invoice.status]?.label ?? detail.invoice.status}
                  </Badge>
                </div>
              </DialogHeader>

              {/* Info klien */}
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p className="font-medium">Informasi PIC</p>
                {detail.invoice.pic_name && <p className="text-muted-foreground">👤 {detail.invoice.pic_name}</p>}
                {detail.invoice.pic_phone && <p className="text-muted-foreground">📞 {detail.invoice.pic_phone}</p>}
                {detail.invoice.pic_email && <p className="text-muted-foreground">✉️ {detail.invoice.pic_email}</p>}
                {detail.invoice.client_address && <p className="text-muted-foreground">📍 {detail.invoice.client_address}</p>}
                <p className="text-muted-foreground">Periode: {MONTHS.find(m => m.v === Number(detail.invoice.period_month))?.l} {detail.invoice.period_year}</p>
              </div>

              {/* Items */}
              <div>
                <p className="text-sm font-medium mb-2">Detail Pemakaian ({detail.items.length} sesi)</p>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>No. Booking</TableHead>
                        <TableHead>Fasilitas</TableHead>
                        <TableHead>Tanggal</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead className="text-right">PPN</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.items.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">{item.booking_number ?? "—"}</TableCell>
                          <TableCell className="text-sm">{item.facility_name ?? "—"}</TableCell>
                          <TableCell className="text-sm">{fmtDate(item.booking_date)}</TableCell>
                          <TableCell className="text-right text-sm">{idr(item.subtotal)}</TableCell>
                          <TableCell className="text-right text-sm">{idr(item.tax_amount)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{idr(item.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Totals */}
              <div className="rounded-lg bg-muted/50 p-4 space-y-1 text-sm">
                <div className="flex justify-between"><span>DPP (Subtotal)</span><span>{idr(detail.invoice.subtotal)}</span></div>
                <div className="flex justify-between"><span>PPN {detail.invoice.tax_rate}%</span><span>{idr(detail.invoice.tax_amount)}</span></div>
                <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
                  <span>Grand Total</span><span className="text-primary">{idr(detail.invoice.grand_total)}</span>
                </div>
              </div>

              {detail.invoice.notes && (
                <p className="text-sm text-muted-foreground italic">Catatan: {detail.invoice.notes}</p>
              )}

              <DialogFooter className="gap-2 flex-wrap">
                {detail.invoice.status === "unpaid" && (
                  <>
                    <Button variant="outline" className="gap-2 text-destructive hover:text-destructive"
                      onClick={() => cancelMutation.mutate(detail.invoice.id)} disabled={cancelMutation.isPending}>
                      <XCircle className="w-4 h-4" /> Batalkan
                    </Button>
                    <Button className="gap-2"
                      onClick={() => markPaidMutation.mutate(detail.invoice.id)} disabled={markPaidMutation.isPending}>
                      <CheckCircle2 className="w-4 h-4" />
                      {markPaidMutation.isPending ? "Memproses…" : "Tandal Lunas"}
                    </Button>
                  </>
                )}
                {detail.invoice.status === "paid" && (
                  <p className="text-sm text-green-600 font-medium">✅ Lunas pada {fmtDate(detail.invoice.paid_at)}</p>
                )}
              </DialogFooter>
            </>
          ) : (
            <div className="py-8 text-center text-muted-foreground">Memuat…</div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Client Form ── */}
      <Dialog open={showClientForm} onOpenChange={setShowClientForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editClient ? "Edit Klien" : "Tambah Klien Perusahaan"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nama Perusahaan *</Label>
              <Input value={clientForm.name} onChange={e => setClientForm(f => ({ ...f, name: e.target.value }))} placeholder="PT JAS AIRPORT" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nama PIC</Label>
                <Input value={clientForm.pic_name} onChange={e => setClientForm(f => ({ ...f, pic_name: e.target.value }))} placeholder="Nama contact person" />
              </div>
              <div className="space-y-1">
                <Label>No. HP / WA PIC</Label>
                <Input value={clientForm.pic_phone} onChange={e => setClientForm(f => ({ ...f, pic_phone: e.target.value }))} placeholder="08xxxxxxxxx" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Email PIC</Label>
              <Input type="email" value={clientForm.pic_email} onChange={e => setClientForm(f => ({ ...f, pic_email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Alamat</Label>
              <Textarea value={clientForm.address} onChange={e => setClientForm(f => ({ ...f, address: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-1">
              <Label>Catatan</Label>
              <Input value={clientForm.notes} onChange={e => setClientForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClientForm(false)}>Batal</Button>
            <Button onClick={() => clientMutation.mutate()} disabled={!clientForm.name || clientMutation.isPending}>
              {clientMutation.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
