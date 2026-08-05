import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/ui/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Globe, Plus, RefreshCw, Search, Loader2, ChevronRight, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { BackButton } from "@/components/ui/back-button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PpjkOrder {
  id: number; orderNumber: string;
  customerName: string; customerEmail: string | null; customerPhone: string | null; customerCompany: string | null; customerNpwp: string | null;
  tradeType: string; commodity: string | null; hsCode: string | null;
  origin: string | null; destination: string | null;
  portOfEntry: string | null; kantorPabean: string | null;
  jenisPelayanan: string | null; status: string; customsStatus: string | null;
  nomorAju: string | null; nomorPib: string | null; nomorPeb: string | null; nomorSppb: string | null; tanggalAju: string | null;
  nilaiPabean: string | null; beaMasuk: string | null; ppnImpor: string | null; pphImpor: string | null; totalTagihanPabean: string | null;
  serviceFee: string | null; ppnServiceFee: string | null; totalServiceFee: string | null;
  vendorName: string | null; notes: string | null; adminNotes: string | null;
  createdAt: string; updatedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft:      "Draft",
  confirmed:  "Terkonfirmasi",
  processing: "Sedang Diproses",
  submitted:  "Dokumen Terkirim ke BC",
  examining:  "Pemeriksaan Bea Cukai",
  approved:   "Disetujui / SPPB Terbit",
  completed:  "Selesai",
  cancelled:  "Dibatalkan",
  on_hold:    "Ditahan",
};
const STATUS_COLORS: Record<string, string> = {
  draft:      "bg-gray-100 text-gray-700",
  confirmed:  "bg-teal-100 text-teal-700",
  processing: "bg-blue-100 text-blue-700",
  submitted:  "bg-indigo-100 text-indigo-700",
  examining:  "bg-amber-100 text-amber-700",
  approved:   "bg-green-100 text-green-700",
  completed:  "bg-emerald-100 text-emerald-700",
  cancelled:  "bg-red-100 text-red-700",
  on_hold:    "bg-orange-100 text-orange-700",
};
const CUSTOMS_STATUS_LABELS: Record<string, string> = {
  pending:      "Menunggu",
  aju_filed:    "Nomor Aju Terdaftar",
  jalur_hijau:  "Jalur Hijau",
  jalur_merah:  "Jalur Merah",
  jalur_kuning: "Jalur Kuning",
  sppb_issued:  "SPPB Terbit",
  paid:         "Bea & Pajak Dibayar",
  released:     "Barang Dikeluarkan",
  draft:        "Draft",
  submitted:    "Diajukan",
  processing:   "Diproses",
  approved:     "Disetujui",
  rejected:     "Ditolak",
  completed:    "Selesai",
};
const CUSTOMS_STATUS_COLORS: Record<string, string> = {
  pending:      "bg-gray-100 text-gray-600",
  aju_filed:    "bg-sky-100 text-sky-700",
  jalur_hijau:  "bg-green-100 text-green-700",
  jalur_merah:  "bg-red-100 text-red-700",
  jalur_kuning: "bg-yellow-100 text-yellow-700",
  sppb_issued:  "bg-emerald-100 text-emerald-700",
  paid:         "bg-teal-100 text-teal-700",
  released:     "bg-green-200 text-green-800",
  draft:        "bg-gray-100 text-gray-600",
  submitted:    "bg-blue-100 text-blue-700",
  processing:   "bg-yellow-100 text-yellow-700",
  approved:     "bg-green-100 text-green-700",
  rejected:     "bg-red-100 text-red-700",
  completed:    "bg-emerald-100 text-emerald-700",
};

const IDR = (n: string | null) =>
  n == null ? "—" : `Rp ${Number(n).toLocaleString("id-ID")}`;

// ─── New Order Form ───────────────────────────────────────────────────────────

function emptyForm() {
  return {
    customerName: "", customerEmail: "", customerPhone: "", customerCompany: "", customerNpwp: "",
    tradeType: "import",
    commodity: "", hsCode: "", origin: "", destination: "",
    portOfEntry: "", kantorPabean: "", jenisPelayanan: "",
    vendorName: "", notes: "", adminNotes: "",
  };
}

function NewOrderDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState(emptyForm);
  const f = (k: keyof ReturnType<typeof emptyForm>, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/ppjk/orders", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Gagal");
      return r.json();
    },
    onSuccess: (data) => {
      toast.success(`PPJK Order ${data.orderNumber} dibuat`);
      onCreated(data.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Buat PPJK Order Baru</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
            Order PPJK dapat dibuat tanpa shipment — sebagai layanan kepabeanan mandiri.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2"><Label>Nama Importir / Eksportir *</Label><Input value={form.customerName} onChange={(e) => f("customerName", e.target.value)} placeholder="PT. Maju Bersama" /></div>
            <div className="space-y-1.5"><Label>Nama Perusahaan</Label><Input value={form.customerCompany} onChange={(e) => f("customerCompany", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>NPWP</Label><Input value={form.customerNpwp} onChange={(e) => f("customerNpwp", e.target.value)} placeholder="00.000.000.0-000.000" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.customerEmail} onChange={(e) => f("customerEmail", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Telepon</Label><Input value={form.customerPhone} onChange={(e) => f("customerPhone", e.target.value)} /></div>
          </div>

          <div className="border-t pt-4 grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Jenis Layanan</Label>
              <Select value={form.tradeType} onValueChange={(v) => f("tradeType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="import">Import</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                  <SelectItem value="transit">Transit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Jenis Pelayanan</Label>
              <Select value={form.jenisPelayanan} onValueChange={(v) => f("jenisPelayanan", v)}>
                <SelectTrigger><SelectValue placeholder="Pilih jenis..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customs_clearance">Customs Clearance</SelectItem>
                  <SelectItem value="customs_import">PIB — Impor</SelectItem>
                  <SelectItem value="customs_export">PEB — Ekspor</SelectItem>
                  <SelectItem value="customs_transit">Transit</SelectItem>
                  <SelectItem value="full_service">Full Service PPJK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Komoditi</Label><Input value={form.commodity} onChange={(e) => f("commodity", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>HS Code</Label><Input value={form.hsCode} onChange={(e) => f("hsCode", e.target.value)} placeholder="0000.00.00" /></div>
            <div className="space-y-1.5"><Label>Origin / Asal</Label><Input value={form.origin} onChange={(e) => f("origin", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Destination / Tujuan</Label><Input value={form.destination} onChange={(e) => f("destination", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Port of Entry</Label><Input value={form.portOfEntry} onChange={(e) => f("portOfEntry", e.target.value)} placeholder="CGK, TPS, dll." /></div>
            <div className="space-y-1.5"><Label>Kantor Pabean</Label><Input value={form.kantorPabean} onChange={(e) => f("kantorPabean", e.target.value)} /></div>
          </div>

          <div className="border-t pt-4 grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2"><Label>Vendor PPJK (jika ada)</Label><Input value={form.vendorName} onChange={(e) => f("vendorName", e.target.value)} placeholder="Nama perusahaan PPJK yang menangani" /></div>
            <div className="space-y-1.5 col-span-2"><Label>Catatan</Label><Textarea value={form.notes} onChange={(e) => f("notes", e.target.value)} rows={2} className="resize-none" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={() => mutation.mutate(form as any)} disabled={mutation.isPending || !form.customerName}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            Buat Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stats Card ───────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["confirmed", "processing", "submitted", "examining", "approved", "on_hold"]);

function StatsBar({ orders }: { orders: PpjkOrder[] }) {
  const counts = {
    total:     orders.length,
    active:    orders.filter((o) => ACTIVE_STATUSES.has(o.status)).length,
    draft:     orders.filter((o) => o.status === "draft").length,
    completed: orders.filter((o) => o.status === "completed").length,
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[
        { label: "Total PPJK",     value: counts.total,     color: "bg-slate-50 border-slate-200 text-slate-700" },
        { label: "Aktif / Proses", value: counts.active,    color: "bg-blue-50 border-blue-200 text-blue-700" },
        { label: "Draft",          value: counts.draft,     color: "bg-gray-50 border-gray-200 text-gray-600" },
        { label: "Selesai",        value: counts.completed, color: "bg-green-50 border-green-200 text-green-700" },
      ].map((s) => (
        <Card key={s.label} className={`border ${s.color}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold mt-1">{s.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PpjkPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ orders: PpjkOrder[]; total: number }>({
    queryKey: ["ppjk-orders", statusFilter, tradeFilter, search],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "200" });
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (tradeFilter !== "all") p.set("tradeType", tradeFilter);
      if (search) p.set("q", search);
      const r = await fetch(`/api/ppjk/orders?${p}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    refetchInterval: 30000,
  });

  const orders = data?.orders ?? [];

  function handleCreated(id: number) {
    setNewOrderOpen(false);
    qc.invalidateQueries({ queryKey: ["ppjk-orders"] });
    navigate(`/logistics/ppjk/${id}`);
  }

  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="p-6 space-y-5 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="w-6 h-6 text-blue-600" /> PPJK — Kepabeanan
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pengusaha Pengurusan Jasa Kepabeanan — manajemen PIB, PEB, dan dokumen bea cukai
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
            <Button size="sm" onClick={() => setNewOrderOpen(true)} className="gap-1.5">
              <Plus className="w-4 h-4" /> Buat PPJK Order
            </Button>
          </div>
        </div>

        {/* Stats */}
        <StatsBar orders={orders} />

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-48">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <Input placeholder="Cari nama, nomor order, nomor aju..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-8"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={tradeFilter} onValueChange={setTradeFilter}>
                <SelectTrigger className="w-32 h-8"><SelectValue placeholder="Trade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="import">Import</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                  <SelectItem value="transit">Transit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Daftar PPJK Orders ({orders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <QueryState loading={isLoading} skeletonRows={4}>
              {orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Globe className="w-10 h-10 mb-3 opacity-25" />
                  <p className="text-sm font-medium">Belum ada PPJK order</p>
                  <p className="text-xs mt-1">Buat order PPJK baru sebagai layanan mandiri</p>
                  <Button size="sm" className="mt-4 gap-1.5" onClick={() => setNewOrderOpen(true)}>
                    <Plus className="w-4 h-4" /> Buat Order Pertama
                  </Button>
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {["No. Order","Customer","Jenis","Komoditi","Origin → Dest","Status","Customs","Nomor Aju","Service Fee","Dibuat",""].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map((o) => (
                      <tr
                        key={o.id}
                        className="hover:bg-muted/20 cursor-pointer transition-colors"
                        onClick={() => navigate(`/logistics/ppjk/${o.id}`)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Lihat order PPJK ${o.orderNumber}`}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/logistics/ppjk/${o.id}`); } }}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{o.orderNumber}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-sm">{o.customerName}</p>
                          {o.customerCompany && <p className="text-xs text-muted-foreground">{o.customerCompany}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs capitalize">{o.tradeType}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-32 truncate">{o.commodity || "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {o.origin || "—"} → {o.destination || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-700"}`}>
                            {STATUS_LABELS[o.status] ?? o.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {o.customsStatus ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CUSTOMS_STATUS_COLORS[o.customsStatus] ?? "bg-gray-100 text-gray-600"}`}>
                              {CUSTOMS_STATUS_LABELS[o.customsStatus] ?? o.customsStatus}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{o.nomorAju || "—"}</td>
                        <td className="px-4 py-3 text-xs font-medium">{IDR(o.totalServiceFee)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(o.createdAt), { addSuffix: true, locale: idLocale })}
                        </td>
                        <td className="px-4 py-3">
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </QueryState>
          </CardContent>
        </Card>
      </div>

      <NewOrderDialog open={newOrderOpen} onOpenChange={setNewOrderOpen} onCreated={handleCreated} />
    </AppShell>
  );
}
