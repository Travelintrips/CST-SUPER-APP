import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackButton } from "@/components/ui/back-button";
import {
  MessageSquarePlus, Search, RefreshCw, Phone, Mail, Building2,
  Package, MapPin, ClipboardList, User, CheckCircle2, Clock,
  XCircle, ArrowRight, Pencil, Trash2, AlertTriangle,
} from "lucide-react";

type QuickQuote = {
  id: number;
  quoteNumber: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string;
  serviceCategory: string;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  weightKg: string | null;
  volume: string | null;
  description: string | null;
  status: string;
  adminNotes: string | null;
  assignedTo: string | null;
  contactedAt: string | null;
  createdAt: string;
};

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const STATUS_OPTIONS = ["new", "contacted", "converted", "closed"] as const;

const STATUS_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new:       { label: "Baru",       color: "bg-sky-100 text-sky-700 border-sky-200",      icon: Clock },
  contacted: { label: "Dihubungi",  color: "bg-amber-100 text-amber-700 border-amber-200", icon: Phone },
  converted: { label: "Konversi",   color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  closed:    { label: "Ditutup",    color: "bg-slate-100 text-slate-500 border-slate-200", icon: XCircle },
};

const SERVICE_LABELS: Record<string, string> = {
  sea_freight: "Sea Freight",
  air_freight: "Air Freight",
  trucking: "Trucking",
  ppjk: "Bea Cukai (PPJK)",
  customs_clearance: "Customs Clearance",
  warehousing: "Warehousing",
  bundled: "Paket Borongan",
  other: "Lainnya",
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: "bg-slate-100 text-slate-500 border-slate-200", icon: ClipboardList };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${m.color}`}>
      <Icon className="h-3 w-3" />{m.label}
    </span>
  );
}

function DetailModal({ quote, onClose, onSaved }: { quote: QuickQuote; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(quote.status);
  const [adminNotes, setAdminNotes] = useState(quote.adminNotes ?? "");
  const [assignedTo, setAssignedTo] = useState(quote.assignedTo ?? "");

  const saveMut = useMutation({
    mutationFn: () => apiFetch(`/api/portal/admin/quick-quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, adminNotes, assignedTo }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portal-quick-quotes"] }); onSaved(); onClose(); },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-sky-600" />
            {quote.quoteNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg p-3 border">
              <p className="text-[11px] text-slate-400 mb-1 uppercase font-semibold">Kontak</p>
              <p className="font-semibold">{quote.name}</p>
              {quote.company && <p className="text-slate-500 text-xs">{quote.company}</p>}
              <p className="text-slate-600 text-xs mt-1">{quote.phone}</p>
              {quote.email && <p className="text-slate-500 text-xs">{quote.email}</p>}
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border">
              <p className="text-[11px] text-slate-400 mb-1 uppercase font-semibold">Layanan</p>
              <p className="font-semibold">{SERVICE_LABELS[quote.serviceCategory] ?? quote.serviceCategory}</p>
              {quote.origin && <p className="text-xs text-slate-500 mt-1">Dari: {quote.origin}</p>}
              {quote.destination && <p className="text-xs text-slate-500">Ke: {quote.destination}</p>}
              {quote.weightKg && <p className="text-xs text-slate-500">Berat: {quote.weightKg} kg</p>}
              {quote.volume && <p className="text-xs text-slate-500">Volume: {quote.volume}</p>}
              {quote.commodity && <p className="text-xs text-slate-500">Komoditi: {quote.commodity}</p>}
            </div>
          </div>

          {quote.description && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-[11px] text-amber-600 font-semibold uppercase mb-1">Keterangan</p>
              <p className="text-slate-700 text-xs leading-relaxed whitespace-pre-wrap">{quote.description}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-500 uppercase">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-500 uppercase">Ditangani Oleh</label>
            <Input
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Nama staff..."
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-500 uppercase">Catatan Admin</label>
            <Textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Catatan internal..."
              className="text-xs min-h-[80px]"
            />
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
            <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PortalQuickQuotesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<QuickQuote | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search.trim()) params.set("search", search.trim());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["portal-quick-quotes", params.toString()],
    queryFn: () => apiFetch<{ items: QuickQuote[]; total: number }>(`/api/portal/admin/quick-quotes?${params}`),
    refetchInterval: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/portal/admin/quick-quotes/${id}`, { method: "DELETE" }),
    onSuccess: () => { setDeleteId(null); qc.invalidateQueries({ queryKey: ["portal-quick-quotes"] }); },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const counts = items.reduce((acc, q) => { acc[q.status] = (acc[q.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <AppShell>
      <BackButton />
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <MessageSquarePlus className="h-6 w-6 text-sky-600" />
              Quick Quote Leads
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">{total} permintaan masuk dari portal</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-4 gap-3">
          {STATUS_OPTIONS.map((s) => {
            const m = STATUS_META[s];
            const Icon = m.icon;
            const cnt = counts[s] ?? 0;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                className={`p-3 rounded-xl border text-left transition-all hover:shadow-md ${statusFilter === s ? "ring-2 ring-sky-500 shadow-md" : ""} bg-white`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4 text-slate-500" />
                  <span className="text-[12px] text-slate-500 font-medium">{m.label}</span>
                </div>
                <p className="text-2xl font-black text-slate-800">{cnt}</p>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama, telepon, perusahaan..."
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40 h-9 text-sm">
                  <SelectValue placeholder="Semua status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-slate-400 text-sm">Memuat data...</div>
            ) : items.length === 0 ? (
              <div className="py-20 text-center">
                <MessageSquarePlus className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">Belum ada quick quote masuk</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-[11px] font-semibold">No. Quote</TableHead>
                    <TableHead className="text-[11px] font-semibold">Kontak</TableHead>
                    <TableHead className="text-[11px] font-semibold">Layanan</TableHead>
                    <TableHead className="text-[11px] font-semibold">Rute</TableHead>
                    <TableHead className="text-[11px] font-semibold">Status</TableHead>
                    <TableHead className="text-[11px] font-semibold">Ditangani</TableHead>
                    <TableHead className="text-[11px] font-semibold">Masuk</TableHead>
                    <TableHead className="text-[11px] font-semibold w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((q) => (
                    <TableRow key={q.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(q)}>
                      <TableCell className="font-mono text-[12px] text-sky-700 font-semibold">{q.quoteNumber}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-[13px]">{q.name}</p>
                          {q.company && <p className="text-xs text-slate-400">{q.company}</p>}
                          <p className="text-xs text-slate-500">{q.phone}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[11px] font-medium">
                          {SERVICE_LABELS[q.serviceCategory] ?? q.serviceCategory}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {q.origin || q.destination
                          ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{[q.origin, q.destination].filter(Boolean).join(" → ")}</span>
                          : <span className="text-slate-300">—</span>
                        }
                      </TableCell>
                      <TableCell><StatusBadge status={q.status} /></TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {q.assignedTo ?? <span className="text-slate-300">Belum</span>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {new Date(q.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(q)}>
                            <Pencil className="h-3.5 w-3.5 text-slate-500" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => setDeleteId(q.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <DetailModal quote={selected} onClose={() => setSelected(null)} onSaved={() => setSelected(null)} />
      )}

      {deleteId !== null && (
        <Dialog open onOpenChange={() => setDeleteId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="h-5 w-5" />Hapus Quick Quote</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600">Data permintaan ini akan dihapus permanen. Lanjutkan?</p>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>Batal</Button>
              <Button variant="destructive" size="sm" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(deleteId)}>
                {deleteMut.isPending ? "Menghapus..." : "Hapus"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}
