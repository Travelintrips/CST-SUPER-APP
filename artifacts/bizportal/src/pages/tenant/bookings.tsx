import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { Plus, Search, Trash2, RefreshCw, Zap, ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type Booking = {
  id: number; order_number: string; tenant_id: number; business_name: string; owner_name: string;
  booking_type: string; requested_area: string | null; start_date: string | null; end_date: string | null;
  payment_period_type: string; total_price: number | null; price: number; payment_status: string; status: string;
};

const emptyForm = {
  tenant_id: "", booking_type: "rental", requested_area: "", payment_period_type: "monthly",
  start_date: "", end_date: "", total_price: "", description: "",
};

export default function TenantBookings() {
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery<{ data: Booking[]; total: number }>({
    queryKey: ["tenant-bookings", activeCompanyId, statusFilter, search],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (search) qs.set("search", search);
      const r = await fetch(`/api/tenant/bookings?${qs}`, { credentials: "include" });
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: tenants } = useQuery<{ data: { id: number; business_name: string }[] }>({
    queryKey: ["tenant-options", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/tenant/tenants${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/tenant/bookings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Penyewaan dibuat" });
      setShowDialog(false); setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ["tenant-bookings"] });
      qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/bookings/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Penyewaan dihapus" }); qc.invalidateQueries({ queryKey: ["tenant-bookings"] }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const genInvoiceMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      const r = await fetch(`/api/tenant/invoices/generate-from-booking/${bookingId}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const json = await r.json();
      if (!r.ok && r.status !== 409) throw new Error(json.error ?? "Gagal");
      return { ...json, httpStatus: r.status };
    },
    onSuccess: (data: any) => {
      if (data.httpStatus === 409) {
        toast({ title: `Invoice sudah ada: ${data.invoice_number}` });
      } else {
        toast({ title: `Invoice ${data.invoice_number} dibuat` });
        qc.invalidateQueries({ queryKey: ["tenant-invoices"] });
        qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
      }
      navigate("/tenant/invoices");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const rows = data?.data ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <PageHeader
          title="Penyewaan"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Tenant Management", href: "/tenant/workspace/tenant-management" }, { label: "Penyewaan" }]}
          favoriteEnabled
          actions={
            <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
              <Plus className="h-4 w-4" /> Buat Penyewaan
            </Button>
          }
        />

        <div className="flex flex-wrap items-end gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input placeholder="Cari no. / penyewa…" className="h-8 text-xs pl-7 w-64"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="paid">Lunas</SelectItem>
              <SelectItem value="unpaid">Belum Lunas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["No.", "Penyewa", "Area", "Periode", "Mulai", "Selesai", "Status Bayar", "Nilai", ""].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">Belum ada penyewaan</td></tr>
                ) : rows.map((b) => (
                  <tr key={b.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{b.order_number}<span className="block text-[10px]">ID: {b.id}</span></td>
                    <td className="py-2.5 px-3 text-foreground whitespace-nowrap">{b.business_name}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{b.requested_area ?? "—"}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{b.payment_period_type === "yearly" ? "Tahunan" : "Bulanan"}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(b.start_date)}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(b.end_date)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className={b.payment_status === "paid"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs"
                        : "bg-yellow-900/30 text-yellow-300 border-yellow-700 text-xs"}>
                        {b.payment_status === "paid" ? "Lunas" : "Belum Lunas"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-foreground text-right whitespace-nowrap">{idr(Number(b.total_price ?? b.price ?? 0))}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-violet-400 hover:text-violet-300"
                          disabled={genInvoiceMutation.isPending}
                          onClick={() => genInvoiceMutation.mutate(b.id)}>
                          <Zap className="h-3.5 w-3.5" /> Invoice
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-red-400 hover:text-red-300"
                          onClick={() => { if (confirm(`Hapus penyewaan ${b.order_number}?`)) deleteMutation.mutate(b.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Buat Penyewaan</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Penyewa *</Label>
                <Select value={form.tenant_id} onValueChange={(v) => setForm((p) => ({ ...p, tenant_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Pilih penyewa" /></SelectTrigger>
                  <SelectContent>
                    {(tenants?.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.business_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Area / Lokasi</Label>
                <Input value={form.requested_area} onChange={(e) => setForm((p) => ({ ...p, requested_area: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Periode Pembayaran</Label>
                <Select value={form.payment_period_type} onValueChange={(v) => setForm((p) => ({ ...p, payment_period_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Bulanan</SelectItem>
                    <SelectItem value="yearly">Tahunan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Mulai</Label>
                  <DatePicker value={form.start_date} onChange={(v) => setForm((p) => ({ ...p, start_date: v }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Selesai</Label>
                  <DatePicker value={form.end_date} onChange={(v) => setForm((p) => ({ ...p, end_date: v }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nilai Sewa (IDR) *</Label>
                <Input type="number" min={0} value={form.total_price} onChange={(e) => setForm((p) => ({ ...p, total_price: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Deskripsi</Label>
                <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button disabled={!form.tenant_id || !form.total_price || createMutation.isPending}
                onClick={() => createMutation.mutate({
                  company_id: activeCompanyId,
                  tenant_id: Number(form.tenant_id),
                  booking_type: form.booking_type,
                  requested_area: form.requested_area,
                  payment_period_type: form.payment_period_type,
                  start_date: form.start_date || null,
                  end_date: form.end_date || null,
                  total_price: Number(form.total_price),
                  price: Number(form.total_price),
                  description: form.description,
                })}>
                {createMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
