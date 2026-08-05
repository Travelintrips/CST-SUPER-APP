import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Plus, Search, Send, CheckCircle2, Printer, XCircle, Zap, AlertCircle, FileText, ChevronLeft, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type Invoice = {
  id: number;
  invoice_number: string;
  company_id: number;
  tenant_id: number;
  booking_id: number | null;
  unit_id: number | null;
  invoice_date: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  penalty_amount: number;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  status: string;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  business_name: string;
  owner_name: string;
  tenant_phone: string | null;
  tenant_email: string | null;
  order_number: string | null;
  eff_unit_code: string | null;
  unit_code?: string | null;
  unit_name: string | null;
  unit_area: string | null;
  rent_amount?: number | null;
  service_charge_amount?: number | null;
  electricity_charge_amount?: number | null;
  water_charge_amount?: number | null;
  other_charge_amount?: number | null;
};

type BookingOpt = {
  id: number; order_number: string; business_name: string;
  total_price: number | null; price: number; tenant_id: number;
  start_date: string | null; end_date: string | null;
};
type TenantOpt = { id: number; business_name: string; owner_name: string };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", sent: "Terkirim", unpaid: "Belum Lunas",
  partial: "Sebagian", paid: "Lunas", overdue: "Jatuh Tempo", cancelled: "Dibatalkan",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-zinc-800/60 text-zinc-300 border-zinc-600",
  sent: "bg-blue-900/30 text-blue-300 border-blue-700",
  unpaid: "bg-yellow-900/30 text-yellow-300 border-yellow-700",
  partial: "bg-orange-900/30 text-orange-300 border-orange-700",
  paid: "bg-emerald-900/30 text-emerald-300 border-emerald-700",
  overdue: "bg-red-900/40 text-red-300 border-red-700",
  cancelled: "bg-zinc-900/40 text-zinc-500 border-zinc-700",
};

type FormState = {
  tenant_id: string; booking_id: string;
  subtotal: string; tax_amount: string; discount_amount: string; penalty_amount: string;
  invoice_date: string; period_start: string; period_end: string; due_date: string;
  status: string; notes: string;
};
const EMPTY_FORM: FormState = {
  tenant_id: "", booking_id: "",
  subtotal: "", tax_amount: "0", discount_amount: "0", penalty_amount: "0",
  invoice_date: new Date().toISOString().slice(0, 10),
  period_start: "", period_end: "", due_date: "", status: "draft", notes: "",
};

type GenForm = { bookingId: string; periodStart: string; periodEnd: string; dueDate: string; notes: string };
const EMPTY_GEN: GenForm = { bookingId: "", periodStart: "", periodEnd: "", dueDate: "", notes: "" };

function isOverdue(inv: Invoice) {
  return inv.due_date && new Date(inv.due_date) < new Date() && !["paid", "cancelled"].includes(inv.status);
}

function PrintInvoice({ inv }: { inv: Invoice }) {
  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const period = inv.period_start
      ? `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}`
      : "—";
    win.document.write(`
      <html><head><title>Invoice ${inv.invoice_number}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:24px}
        .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:2px solid #111;padding-bottom:16px}
        .company{font-size:18px;font-weight:bold}.sub{font-size:12px;color:#555}
        .inv-title{font-size:22px;font-weight:bold;margin-bottom:4px}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px}
        .label{color:#666;font-size:11px;text-transform:uppercase;margin-bottom:2px}
        .value{font-size:13px;font-weight:500}
        table{width:100%;border-collapse:collapse;margin:20px 0}
        th{background:#f0f0f0;text-align:left;padding:8px 12px;font-size:12px;border:1px solid #ddd}
        td{padding:8px 12px;border:1px solid #ddd;font-size:13px}
        .total-row td{font-weight:bold;background:#f8f8f8}
        .footer{margin-top:40px;text-align:right}
        .sbadge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:bold;
          background:${inv.status==="paid"?"#d1fae5":inv.status==="overdue"?"#fee2e2":inv.status==="partial"?"#fed7aa":"#dbeafe"};
          color:${inv.status==="paid"?"#065f46":inv.status==="overdue"?"#991b1b":inv.status==="partial"?"#9a3412":"#1e40af"}}
      </style></head><body>
      <div class="header">
        <div>
          <div class="company">BizPortal ERP</div>
          <div class="sub">Manajemen Properti &amp; Penyewaan</div>
        </div>
        <div style="text-align:right">
          <div class="inv-title">INVOICE</div>
          <div style="font-size:15px;font-weight:bold;color:#1e40af">${inv.invoice_number}</div>
          <div style="margin-top:6px"><span class="sbadge">${STATUS_LABEL[inv.status] ?? inv.status}</span></div>
        </div>
      </div>
      <div class="info-grid">
        <div>
          <div class="label">Tagihan Kepada</div>
          <div class="value">${inv.business_name}</div>
          <div style="color:#555">${inv.owner_name}</div>
          ${inv.tenant_phone ? `<div style="color:#555">${inv.tenant_phone}</div>` : ""}
          ${inv.tenant_email ? `<div style="color:#555">${inv.tenant_email}</div>` : ""}
        </div>
        <div style="text-align:right">
          <div><span class="label">Tgl. Invoice: </span><span class="value">${fmtDate(inv.invoice_date)}</span></div>
          ${inv.due_date ? `<div><span class="label">Jatuh Tempo: </span><span class="value">${fmtDate(inv.due_date)}</span></div>` : ""}
          <div><span class="label">Periode: </span><span class="value">${period}</span></div>
          ${inv.order_number ? `<div><span class="label">No. Penyewaan: </span><span class="value">${inv.order_number}</span></div>` : ""}
          ${inv.eff_unit_code ? `<div><span class="label">Unit: </span><span class="value">${inv.eff_unit_code} – ${inv.unit_name ?? ""}</span></div>` : ""}
        </div>
      </div>
      <table>
        <thead><tr><th>Keterangan</th><th style="text-align:right">Jumlah</th></tr></thead>
        <tbody>
          <tr><td>Biaya Sewa${period !== "—" ? " – " + period : ""}</td><td style="text-align:right">${idr(Number(inv.subtotal))}</td></tr>
          ${Number(inv.tax_amount)>0?`<tr><td>Pajak/PPN</td><td style="text-align:right">${idr(Number(inv.tax_amount))}</td></tr>`:""}
          ${Number(inv.discount_amount)>0?`<tr><td>Diskon</td><td style="text-align:right">-${idr(Number(inv.discount_amount))}</td></tr>`:""}
          ${Number(inv.penalty_amount)>0?`<tr><td>Denda</td><td style="text-align:right">${idr(Number(inv.penalty_amount))}</td></tr>`:""}
          <tr class="total-row"><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>${idr(Number(inv.total_amount))}</strong></td></tr>
          ${Number(inv.paid_amount)>0?`<tr><td>Sudah Dibayar</td><td style="text-align:right">-${idr(Number(inv.paid_amount))}</td></tr>`:""}
          ${Number(inv.outstanding_amount)>0?`<tr class="total-row"><td><strong>Sisa Tagihan</strong></td><td style="text-align:right"><strong>${idr(Number(inv.outstanding_amount))}</strong></td></tr>`:""}
        </tbody>
      </table>
      ${inv.notes ? `<div style="margin-top:12px;padding:10px;background:#f9f9f9;border-radius:4px;font-size:12px"><strong>Catatan:</strong> ${inv.notes}</div>` : ""}
      <div class="footer">
        <div style="margin-bottom:40px">Hormat Kami,</div>
        <div style="border-top:1px solid #999;display:inline-block;min-width:180px;text-align:center;padding-top:4px">Pengelola</div>
      </div>
      </body></html>
    `);
    win.document.close();
    win.print();
  };
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-zinc-400 hover:text-zinc-200" onClick={handlePrint}>
      <Printer className="h-3.5 w-3.5" /> Print
    </Button>
  );
}

export default function TenantInvoices() {
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showGenDialog, setShowGenDialog] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [genForm, setGenForm] = useState<GenForm>(EMPTY_GEN);

  const { data, isLoading } = useQuery<{ data: Invoice[]; total: number }>({
    queryKey: ["tenant-invoices", activeCompanyId, statusFilter, search],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (search) qs.set("search", search);
      const r = await fetch(`/api/tenant/invoices?${qs}`, { credentials: "include" });
      if (!r.ok) return { data: [], total: 0 };
      const json = await r.json();
      return { data: Array.isArray(json?.data) ? json.data : [], total: json?.total ?? 0 };
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const detail = data?.data?.find((i) => i.id === detailId);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await fetch(`/api/tenant/invoices/${id}/status`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
    },
    onSuccess: (_, { status }) => {
      toast({ title: `Status diperbarui ke: ${STATUS_LABEL[status] ?? status}` });
      invalidate();
      setDetailId(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const { data: tenants } = useQuery<{ data: TenantOpt[] }>({
    queryKey: ["tenant-list-opts", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/tenant/tenants${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const { data: bookings } = useQuery<{ data: BookingOpt[] }>({
    queryKey: ["tenant-booking-options", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/tenant/bookings${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tenant-invoices"] });
    qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
  };

  function openCreate() {
    setEditInvoice(null);
    setForm(EMPTY_FORM);
    setShowDialog(true);
  }
  function openEdit(inv: Invoice) {
    setEditInvoice(inv);
    setForm({
      tenant_id: String(inv.tenant_id),
      booking_id: inv.booking_id ? String(inv.booking_id) : "",
      subtotal: String(inv.subtotal),
      tax_amount: String(inv.tax_amount),
      discount_amount: String(inv.discount_amount),
      penalty_amount: String(inv.penalty_amount),
      invoice_date: inv.invoice_date ? inv.invoice_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      period_start: inv.period_start ? inv.period_start.slice(0, 10) : "",
      period_end: inv.period_end ? inv.period_end.slice(0, 10) : "",
      due_date: inv.due_date ? inv.due_date.slice(0, 10) : "",
      status: inv.status,
      notes: inv.notes ?? "",
    });
    setShowDialog(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editInvoice ? `/api/tenant/invoices/${editInvoice.id}` : "/api/tenant/invoices";
      const method = editInvoice ? "PUT" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editInvoice ? "Invoice diperbarui" : "Invoice dibuat" });
      setShowDialog(false);
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const genMutation = useMutation({
    mutationFn: async (body: { bookingId: number; periodStart?: string; periodEnd?: string; dueDate?: string; notes?: string }) => {
      const { bookingId, ...rest } = body;
      const r = await fetch(`/api/tenant/invoices/generate-from-booking/${bookingId}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(rest),
      });
      const json = await r.json();
      if (!r.ok && r.status !== 409) throw new Error(json.error ?? "Gagal");
      return { ...json, status: r.status };
    },
    onSuccess: (data: any) => {
      if (data.status === 409) {
        toast({ title: `Invoice sudah ada: ${data.invoice_number}`, variant: "destructive" });
      } else {
        toast({ title: `Invoice ${data.invoice_number} berhasil dibuat` });
        setShowGenDialog(false);
        setGenForm(EMPTY_GEN);
        invalidate();
      }
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/invoices/${id}/send`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Invoice ditandai terkirim" }); invalidate(); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/invoices/${id}/mark-paid`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Invoice ditandai lunas" }); invalidate(); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/invoices/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Invoice dibatalkan" }); invalidate(); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  function handleSave() {
    if (!form.tenant_id || !form.subtotal) return;
    saveMutation.mutate({
      company_id: activeCompanyId,
      tenant_id: Number(form.tenant_id),
      booking_id: form.booking_id ? Number(form.booking_id) : null,
      subtotal: Number(form.subtotal),
      tax_amount: Number(form.tax_amount || 0),
      discount_amount: Number(form.discount_amount || 0),
      penalty_amount: Number(form.penalty_amount || 0),
      invoice_date: form.invoice_date || new Date().toISOString().slice(0, 10),
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      due_date: form.due_date || null,
      status: form.status,
      notes: form.notes || null,
    });
  }

  function handleGenerate() {
    if (!genForm.bookingId) return;
    genMutation.mutate({
      bookingId: Number(genForm.bookingId),
      periodStart: genForm.periodStart || undefined,
      periodEnd: genForm.periodEnd || undefined,
      dueDate: genForm.dueDate || undefined,
      notes: genForm.notes || undefined,
    });
  }

  const filteredBookings = form.tenant_id
    ? (bookings?.data ?? []).filter((b) => String(b.tenant_id) === form.tenant_id)
    : (bookings?.data ?? []);

  const rows = data?.data ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <PageHeader
          title="Invoice Tenant"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Billing & Finance", href: "/tenant/workspace/billing-finance" }, { label: "Invoice" }]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => { setGenForm(EMPTY_GEN); setShowGenDialog(true); }}>
                <Zap className="h-4 w-4" /> Generate dari Booking
              </Button>
              <Button size="sm" className="gap-1" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Buat Manual
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input placeholder="Cari no. invoice / penyewa…" className="h-8 text-xs pl-7 w-64"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Terkirim</SelectItem>
              <SelectItem value="partial">Sebagian</SelectItem>
              <SelectItem value="unpaid">Belum Lunas</SelectItem>
              <SelectItem value="paid">Lunas</SelectItem>
              <SelectItem value="overdue">Jatuh Tempo</SelectItem>
              <SelectItem value="cancelled">Dibatalkan</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["No. Invoice", "Penyewa", "Unit", "Periode", "Tgl. Invoice", "Jatuh Tempo", "Status", "Total", "Sisa", ""].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={10} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={10} className="py-10 text-center text-muted-foreground">Belum ada invoice</td></tr>
                ) : rows.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-xs text-violet-300 whitespace-nowrap cursor-pointer hover:underline"
                      onClick={() => openEdit(inv)}>
                      {inv.invoice_number}
                      {isOverdue(inv) && <AlertCircle className="inline ml-1 h-3 w-3 text-red-400" />}
                    </td>
                    <td className="py-2.5 px-3 text-foreground whitespace-nowrap">
                      <div>{inv.business_name}</div>
                      <div className="text-xs text-muted-foreground">{inv.owner_name}</div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {inv.eff_unit_code ? `${inv.eff_unit_code}${inv.unit_name ? " – " + inv.unit_name : ""}` : inv.order_number ?? "—"}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {inv.period_start ? `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(inv.invoice_date)}</td>
                    <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                      {inv.due_date
                        ? <span className={isOverdue(inv) ? "text-red-400 font-medium" : "text-muted-foreground"}>
                            {fmtDate(inv.due_date)}
                          </span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className={`${STATUS_COLOR[inv.status] ?? STATUS_COLOR.draft} text-xs`}>
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-foreground text-right whitespace-nowrap">
                      {idr(Number(inv.total_amount))}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {Number(inv.outstanding_amount) > 0
                        ? <span className="text-yellow-400 font-medium text-xs">{idr(Number(inv.outstanding_amount))}</span>
                        : <span className="text-emerald-400 text-xs">—</span>}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <PrintInvoice inv={inv} />
                        {["draft", "unpaid"].includes(inv.status) && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-blue-400 hover:text-blue-300"
                            disabled={sendMutation.isPending}
                            onClick={() => sendMutation.mutate(inv.id)}>
                            <Send className="h-3.5 w-3.5" /> Kirim
                          </Button>
                        )}
                        {!["paid", "cancelled"].includes(inv.status) && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300"
                            disabled={markPaidMutation.isPending}
                            onClick={() => markPaidMutation.mutate(inv.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Lunas
                          </Button>
                        )}
                        {inv.status !== "cancelled" && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-red-400 hover:text-red-300"
                            disabled={cancelMutation.isPending}
                            onClick={() => { if (confirm("Batalkan invoice ini?")) cancelMutation.mutate(inv.id); }}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Detail Dialog */}
        <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-orange-400" />
                {detail?.invoice_number ?? "Detail Invoice"}
              </DialogTitle>
            </DialogHeader>
            {detail && (
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <Badge className={`${STATUS_COLOR[detail.status] ?? "bg-muted"} text-xs`}>
                    {STATUS_LABEL[detail.status] ?? detail.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Tgl: {fmtDate(detail.invoice_date)}</span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div><p className="text-muted-foreground">Penyewa</p><p className="font-medium">{detail.business_name ?? `Tenant #${detail.tenant_id}`}</p></div>
                  <div><p className="text-muted-foreground">Unit</p><p>{detail.unit_code ?? "—"}</p></div>
                  <div><p className="text-muted-foreground">Periode</p><p>{detail.period_start ? `${fmtDate(detail.period_start)} – ${fmtDate(detail.period_end)}` : "—"}</p></div>
                  <div><p className="text-muted-foreground">Jatuh Tempo</p><p className={detail.status === "overdue" ? "text-red-400 font-medium" : ""}>{fmtDate(detail.due_date)}</p></div>
                </div>

                <div className="border border-border/40 rounded p-3 space-y-1.5 text-xs">
                  {[
                    ["Sewa", detail.rent_amount],
                    ["Service Charge", detail.service_charge_amount],
                    ["Listrik", detail.electricity_charge_amount],
                    ["Air", detail.water_charge_amount],
                    ["Lainnya", detail.other_charge_amount],
                  ].filter(([, v]) => Number(v) > 0).map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between">
                      <span className="text-muted-foreground">{l}</span>
                      <span>{idr(Number(v))}</span>
                    </div>
                  ))}
                  {Number(detail.discount_amount) > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Diskon</span><span>-{idr(Number(detail.discount_amount))}</span>
                    </div>
                  )}
                  {Number(detail.penalty_amount) > 0 && (
                    <div className="flex justify-between text-red-400">
                      <span>Denda</span><span>+{idr(Number(detail.penalty_amount))}</span>
                    </div>
                  )}
                  <div className="border-t border-border/40 pt-1.5 flex justify-between font-semibold">
                    <span>Total</span><span>{idr(Number(detail.total_amount))}</span>
                  </div>
                  <div className="flex justify-between text-emerald-400">
                    <span>Terbayar</span><span>{idr(Number(detail.paid_amount))}</span>
                  </div>
                  <div className="flex justify-between text-yellow-400 font-medium">
                    <span>Sisa Tagihan</span><span>{idr(Number(detail.outstanding_amount))}</span>
                  </div>
                </div>

                {detail.notes && (
                  <p className="text-xs text-muted-foreground border border-border/40 rounded p-2">{detail.notes}</p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {detail.status === "draft" && (
                    <Button size="sm" className="gap-1 text-xs" onClick={() => updateStatusMutation.mutate({ id: detail.id, status: "sent" })}
                      disabled={updateStatusMutation.isPending}>
                      Kirim Invoice
                    </Button>
                  )}
                  {["sent", "partial", "overdue"].includes(detail.status) && (
                    <Button size="sm" className="gap-1 text-xs bg-emerald-700 hover:bg-emerald-600" onClick={() => updateStatusMutation.mutate({ id: detail.id, status: "paid" })}
                      disabled={updateStatusMutation.isPending}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Tandai Lunas
                    </Button>
                  )}
                  {!["paid", "cancelled"].includes(detail.status) && (
                    <Button size="sm" variant="ghost" className="gap-1 text-xs text-red-400 hover:text-red-300"
                      onClick={() => updateStatusMutation.mutate({ id: detail.id, status: "cancelled" })}
                      disabled={updateStatusMutation.isPending}>
                      <XCircle className="h-3.5 w-3.5" /> Batalkan
                    </Button>
                  )}
                  {updateStatusMutation.isPending && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        {/* Generate dari Booking Dialog */}
        <Dialog open={showGenDialog} onOpenChange={setShowGenDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4 text-violet-400" /> Generate Invoice dari Booking</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Pilih Penyewaan *</Label>
                <Select value={genForm.bookingId} onValueChange={(v) => {
                  const bk = (bookings?.data ?? []).find(x => String(x.id) === v);
                  setGenForm(p => ({
                    ...p, bookingId: v,
                    periodStart: bk?.start_date ? bk.start_date.slice(0, 10) : p.periodStart,
                    periodEnd: bk?.end_date ? bk.end_date.slice(0, 10) : p.periodEnd,
                  }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Pilih penyewaan" /></SelectTrigger>
                  <SelectContent>
                    {(bookings?.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.order_number} — {b.business_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Periode Mulai</Label>
                  <DatePicker value={genForm.periodStart} onChange={(v) => setGenForm(p => ({ ...p, periodStart: v }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Periode Selesai</Label>
                  <DatePicker value={genForm.periodEnd} onChange={(v) => setGenForm(p => ({ ...p, periodEnd: v }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Jatuh Tempo</Label>
                <DatePicker value={genForm.dueDate} onChange={(v) => setGenForm(p => ({ ...p, dueDate: v }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Catatan</Label>
                <Textarea rows={2} value={genForm.notes}
                  onChange={(e) => setGenForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowGenDialog(false)}>Batal</Button>
              <Button disabled={!genForm.bookingId || genMutation.isPending} onClick={handleGenerate}>
                {genMutation.isPending ? "Membuat…" : "Generate Invoice"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create / Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editInvoice ? `Edit Invoice – ${editInvoice.invoice_number}` : "Buat Invoice Manual"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
              {!editInvoice && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Penyewa *</Label>
                    <Select value={form.tenant_id} onValueChange={(v) => setForm((p) => ({ ...p, tenant_id: v, booking_id: "" }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih penyewa" /></SelectTrigger>
                      <SelectContent>
                        {(tenants?.data ?? []).map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>{t.business_name} – {t.owner_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Penyewaan (opsional)</Label>
                    <Select value={form.booking_id || "none"} onValueChange={(v) => {
                      const effectiveV = v === "none" ? "" : v;
                      const bk = filteredBookings.find((x) => String(x.id) === effectiveV);
                      setForm((p) => ({ ...p, booking_id: effectiveV, subtotal: bk ? String(bk.total_price ?? bk.price ?? "") : p.subtotal }));
                    }}>
                      <SelectTrigger><SelectValue placeholder="Pilih penyewaan (opsional)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Tanpa penyewaan —</SelectItem>
                        {filteredBookings.map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>{b.order_number} — {b.business_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Subtotal (IDR) *</Label>
                  <Input type="number" min={0} value={form.subtotal}
                    onChange={(e) => setForm((p) => ({ ...p, subtotal: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Pajak/PPN (IDR)</Label>
                  <Input type="number" min={0} value={form.tax_amount}
                    onChange={(e) => setForm((p) => ({ ...p, tax_amount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Diskon (IDR)</Label>
                  <Input type="number" min={0} value={form.discount_amount}
                    onChange={(e) => setForm((p) => ({ ...p, discount_amount: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Denda (IDR)</Label>
                  <Input type="number" min={0} value={form.penalty_amount}
                    onChange={(e) => setForm((p) => ({ ...p, penalty_amount: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tgl. Invoice</Label>
                  <DatePicker value={form.invoice_date} onChange={(v) => setForm((p) => ({ ...p, invoice_date: v }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Jatuh Tempo</Label>
                  <DatePicker value={form.due_date} onChange={(v) => setForm((p) => ({ ...p, due_date: v }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Periode Mulai</Label>
                  <DatePicker value={form.period_start} onChange={(v) => setForm((p) => ({ ...p, period_start: v }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Periode Selesai</Label>
                  <DatePicker value={form.period_end} onChange={(v) => setForm((p) => ({ ...p, period_end: v }))} />
                </div>
              </div>
              {editInvoice && (
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Terkirim</SelectItem>
                      <SelectItem value="unpaid">Belum Lunas</SelectItem>
                      <SelectItem value="partial">Sebagian Lunas</SelectItem>
                      <SelectItem value="paid">Lunas</SelectItem>
                      <SelectItem value="overdue">Jatuh Tempo</SelectItem>
                      <SelectItem value="cancelled">Dibatalkan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Catatan</Label>
                <Textarea rows={2} value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button disabled={(!form.tenant_id && !editInvoice) || !form.subtotal || saveMutation.isPending}
                onClick={handleSave}>
                {saveMutation.isPending ? "Menyimpan…" : editInvoice ? "Perbarui" : "Buat Invoice"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
