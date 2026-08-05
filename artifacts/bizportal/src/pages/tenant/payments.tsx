import { useState } from "react";
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
import { Link } from "wouter";
import { Plus, Search, CheckCircle2, RefreshCw, ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

type Payment = {
  id: number; payment_number: string; tenant_booking_id: number; order_number: string;
  business_name: string; amount: number; method: string; status: string; paid_at: string | null; notes: string | null;
};
type BookingOpt = { id: number; order_number: string; business_name: string; total_price: number | null; price: number };

const METHOD_LABEL: Record<string, string> = { cash: "Tunai", transfer: "Transfer", qris: "QRIS", card: "Kartu", other: "Lainnya" };

export default function TenantPayments() {
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ tenant_booking_id: "", amount: "", method: "transfer", notes: "" });

  const { data, isLoading } = useQuery<{ data: Payment[]; total: number }>({
    queryKey: ["tenant-payments", activeCompanyId, statusFilter, search],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (search) qs.set("search", search);
      const r = await fetch(`/api/tenant/payments?${qs}`, { credentials: "include" });
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: bookings } = useQuery<{ data: BookingOpt[] }>({
    queryKey: ["tenant-booking-options", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/tenant/bookings${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/tenant/payments", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Pembayaran dicatat" });
      setShowDialog(false); setForm({ tenant_booking_id: "", amount: "", method: "transfer", notes: "" });
      qc.invalidateQueries({ queryKey: ["tenant-payments"] });
      qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/payments/${id}/confirm`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Pembayaran dikonfirmasi & dijurnal" });
      qc.invalidateQueries({ queryKey: ["tenant-payments"] });
      qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const rows = data?.data ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <PageHeader
          title="Pembayaran Sewa"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Billing & Finance", href: "/tenant/workspace/billing-finance" }, { label: "Pembayaran" }]}
          favoriteEnabled
          actions={
            <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
              <Plus className="h-4 w-4" /> Catat Pembayaran
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
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Terkonfirmasi</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["No. Pembayaran", "No. Penyewaan", "Penyewa", "Metode", "Tgl Bayar", "Status", "Jumlah", ""].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">Belum ada pembayaran</td></tr>
                ) : rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{p.payment_number}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{p.order_number}</td>
                    <td className="py-2.5 px-3 text-foreground whitespace-nowrap">{p.business_name}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className="bg-blue-900/30 text-blue-300 border-blue-700 text-xs">{METHOD_LABEL[p.method] ?? p.method}</Badge>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDateTime(p.paid_at)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className={p.status === "confirmed"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs"
                        : "bg-yellow-900/30 text-yellow-300 border-yellow-700 text-xs"}>
                        {p.status === "confirmed" ? "Terkonfirmasi" : "Pending"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-foreground text-right whitespace-nowrap">{idr(Number(p.amount))}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right">
                      {p.status !== "confirmed" && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300"
                          disabled={confirmMutation.isPending}
                          onClick={() => confirmMutation.mutate(p.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Konfirmasi
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Catat Pembayaran Sewa</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Penyewaan *</Label>
                <Select value={form.tenant_booking_id} onValueChange={(v) => {
                  const b = (bookings?.data ?? []).find((x) => String(x.id) === v);
                  setForm((p) => ({ ...p, tenant_booking_id: v, amount: b ? String(b.total_price ?? b.price ?? "") : p.amount }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Pilih penyewaan" /></SelectTrigger>
                  <SelectContent>
                    {(bookings?.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.order_number} — {b.business_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Jumlah (IDR) *</Label>
                <Input type="number" min={0} value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Metode</Label>
                <Select value={form.method} onValueChange={(v) => setForm((p) => ({ ...p, method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transfer">Transfer Bank</SelectItem>
                    <SelectItem value="cash">Tunai</SelectItem>
                    <SelectItem value="qris">QRIS</SelectItem>
                    <SelectItem value="card">Kartu</SelectItem>
                    <SelectItem value="other">Lainnya</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Catatan</Label>
                <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <p className="text-xs text-muted-foreground">Pembayaran dicatat sebagai <b>Pending</b>. Klik "Konfirmasi" untuk membuat jurnal pendapatan sewa.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button disabled={!form.tenant_booking_id || !form.amount || createMutation.isPending}
                onClick={() => createMutation.mutate({
                  company_id: activeCompanyId,
                  tenant_booking_id: Number(form.tenant_booking_id),
                  amount: Number(form.amount),
                  method: form.method,
                  notes: form.notes,
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
