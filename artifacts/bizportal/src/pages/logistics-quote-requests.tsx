import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  FileText, Search, RefreshCw, Eye, Clock, CheckCircle2,
  XCircle, Loader2, Phone, Mail, MapPin, Package, DollarSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QuoteRequest {
  id: number;
  name: string;
  email: string | null;
  whatsapp: string;
  service: string;
  origin: string;
  destination: string;
  weight: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  incoterms: string | null;
  insurance: boolean;
  express: boolean;
  estimatedTotal: string | null;
  estimatedCbm: string | null;
  estimatedChargeableWeight: string | null;
  status: string;
  notes: string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const SERVICE_LABELS: Record<string, string> = {
  seaFreight: "Sea Freight",
  airFreight: "Air Freight",
  customs: "Bea Cukai",
  domestic: "Domestik/Trucking",
  warehousing: "Gudang/Warehousing",
  projectCargo: "Project Cargo",
};

const STATUS_OPTIONS = [
  { value: "new", label: "Baru", color: "bg-blue-500/10 text-blue-700 border-blue-500/20" },
  { value: "in_progress", label: "Diproses", color: "bg-amber-500/10 text-amber-700 border-amber-500/20" },
  { value: "quoted", label: "Penawaran Terkirim", color: "bg-purple-500/10 text-purple-700 border-purple-500/20" },
  { value: "won", label: "Deal", color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" },
  { value: "lost", label: "Tidak Jadi", color: "bg-red-500/10 text-red-700 border-red-500/20" },
];

function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
  return (
    <Badge variant="outline" className={`text-xs font-medium ${opt.color}`}>
      {opt.label}
    </Badge>
  );
}

function fmtCurrency(val: string | null | undefined) {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(val: string) {
  return new Date(val).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

export default function LogisticsQuoteRequestsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<QuoteRequest | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editHandledBy, setEditHandledBy] = useState("");

  const { data, isLoading, refetch } = useQuery<{ items: QuoteRequest[]; total: number }>({
    queryKey: ["quote-requests", statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      return apiFetch(`/api/portal/quote-requests?${params}`);
    },
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch(`/api/portal/quote-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote-requests"] });
      setSelected(null);
      toast({ title: "Berhasil disimpan", description: "Data permintaan penawaran diperbarui." });
    },
    onError: () => {
      toast({ title: "Gagal menyimpan", variant: "destructive" });
    },
  });

  const items = data?.items ?? [];
  const filtered = items.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [r.name, r.email, r.whatsapp, r.origin, r.destination, r.service]
      .some((v) => v?.toLowerCase().includes(q));
  });

  const counts = STATUS_OPTIONS.reduce((acc, s) => {
    acc[s.value] = items.filter((r) => r.status === s.value).length;
    return acc;
  }, {} as Record<string, number>);

  function openDetail(r: QuoteRequest) {
    setSelected(r);
    setEditStatus(r.status);
    setEditNotes(r.notes ?? "");
    setEditHandledBy(r.handledBy ?? "");
  }

  function handleSave() {
    if (!selected) return;
    updateMutation.mutate({
      id: selected.id,
      body: { status: editStatus, notes: editNotes, handledBy: editHandledBy },
    });
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="w-6 h-6 text-primary" />
              Request Quote dari Kalkulator
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Semua permintaan penawaran yang masuk dari website publik
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Status summary pills */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
          >
            Semua ({items.length})
          </button>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
            >
              {s.label} ({counts[s.value] ?? 0})
            </button>
          ))}
        </div>

        {/* Search & table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Cari nama, WA, rute..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <span className="text-sm text-muted-foreground ml-auto">
                {filtered.length} permintaan
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Pemohon</TableHead>
                  <TableHead>Layanan</TableHead>
                  <TableHead>Rute</TableHead>
                  <TableHead className="text-right">Estimasi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                  : filtered.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-14">
                        Belum ada permintaan penawaran yang masuk.
                      </TableCell>
                    </TableRow>
                  )
                  : filtered.map((r, i) => (
                    <TableRow key={r.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => openDetail(r)}>
                      <TableCell className="text-muted-foreground text-xs font-mono">{i + 1}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{r.name}</p>
                          <p className="text-xs text-muted-foreground">{r.whatsapp}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{SERVICE_LABELS[r.service] ?? r.service}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{r.origin} → {r.destination}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">
                        {fmtCurrency(r.estimatedTotal)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Detail Request Quote #{selected?.id}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              {/* Contact */}
              <div className="rounded-lg border p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Kontak Pemohon</p>
                <div className="flex items-center gap-2 text-sm">
                  <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{selected.name}</span>
                </div>
                {selected.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>{selected.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={`https://wa.me/${selected.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {selected.whatsapp}
                  </a>
                </div>
              </div>

              {/* Shipment details */}
              <div className="rounded-lg border p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Detail Pengiriman</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-muted-foreground">Layanan</span>
                  <span className="font-medium">{SERVICE_LABELS[selected.service] ?? selected.service}</span>
                  <span className="text-muted-foreground">Asal</span>
                  <span>{selected.origin}</span>
                  <span className="text-muted-foreground">Tujuan</span>
                  <span>{selected.destination}</span>
                  {selected.weight && <><span className="text-muted-foreground">Berat</span><span>{selected.weight} kg</span></>}
                  {selected.length && selected.width && selected.height && (
                    <><span className="text-muted-foreground">Dimensi</span><span>{selected.length} × {selected.width} × {selected.height} cm</span></>
                  )}
                  {selected.incoterms && <><span className="text-muted-foreground">Incoterms</span><span>{selected.incoterms}</span></>}
                  {selected.insurance && <><span className="text-muted-foreground">Asuransi</span><span>✅ Ya</span></>}
                  {selected.express && <><span className="text-muted-foreground">Express</span><span>⚡ Ya</span></>}
                </div>
              </div>

              {/* Estimate */}
              {selected.estimatedTotal && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-4 space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Estimasi Biaya</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {selected.estimatedChargeableWeight && <><span className="text-muted-foreground">Chargeable</span><span>{selected.estimatedChargeableWeight} kg</span></>}
                    {selected.estimatedCbm && <><span className="text-muted-foreground">Volume</span><span>{selected.estimatedCbm} CBM</span></>}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-blue-200 dark:border-blue-800">
                    <span className="text-sm font-semibold text-blue-700">Total Estimasi</span>
                    <span className="text-lg font-bold text-blue-900 dark:text-blue-200 font-mono">{fmtCurrency(selected.estimatedTotal)}</span>
                  </div>
                </div>
              )}

              {/* Status management */}
              <div className="rounded-lg border p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tindak Lanjut Tim Internal</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Status</Label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ditangani Oleh</Label>
                  <Input
                    value={editHandledBy}
                    onChange={(e) => setEditHandledBy(e.target.value)}
                    placeholder="Nama staf yang menangani..."
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Catatan Internal</Label>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Catatan tindak lanjut, negosiasi, dll..."
                    rows={3}
                    className="resize-none"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Masuk: {fmtDate(selected.createdAt)}
                {selected.handledBy && ` · Ditangani: ${selected.handledBy}`}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
