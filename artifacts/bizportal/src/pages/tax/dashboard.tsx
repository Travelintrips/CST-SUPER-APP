import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, AlertCircle, FileText,
  Users, Receipt, RefreshCw, ArrowRight, CheckCircle2,
  Pencil, User, Building2, Check, X,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { BackButton } from "@/components/ui/back-button";

function formatRp(n: number) {
  return "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID");
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function generatePeriods() {
  const periods: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}
const PERIODS = generatePeriods();

interface DashboardData {
  period: string;
  ppnKeluaran: number;
  ppnMasukan: number;
  ppnKurangBayar: number;
  pphRows: { taxName: string; total: number; count: number }[];
  pendingCount: number;
  noNpwpCount: number;
  noInvoiceCount: number;
}

interface TaxItem {
  id: number;
  transaction_type: string;
  transaction_id: number;
  transaction_ref: string | null;
  tax_name: string;
  tax_amount: number;
  base_amount: number;
  direction: string;
  partner_name: string | null;
  npwp: string | null;
  faktur_pajak_number?: string | null;
  bukti_potong_number?: string | null;
  period: string;
  status: string;
  created_at: string;
}

type DrawerType = "pending" | "npwp" | "faktur" | null;

/* ── Inline edit dialog untuk NPWP / Faktur ─────────────────────────── */
function EditDialog({
  open, item, onClose, onSaved,
}: {
  open: boolean;
  item: TaxItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    npwp: item?.npwp ?? "",
    fakturPajakNumber: item?.faktur_pajak_number ?? "",
    buktiPotongNumber: item?.bukti_potong_number ?? "",
  });

  const mut = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const r = await fetch(`/api/tax/transactions/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          npwp: form.npwp || null,
          fakturPajakNumber: form.fakturPajakNumber || null,
          buktiPotongNumber: form.buktiPotongNumber || null,
        }),
      });
      if (!r.ok) throw new Error("Gagal menyimpan");
    },
    onSuccess: () => { toast.success("Data diperbarui"); onSaved(); onClose(); },
    onError: () => toast.error("Gagal menyimpan perubahan"),
  });

  if (!item) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Data Kepatuhan Pajak</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Referensi Transaksi</Label>
            <p className="text-sm font-medium mt-0.5">{item.transaction_ref ?? `#${item.transaction_id}`} — {item.tax_name}</p>
          </div>
          <div>
            <Label>NPWP / NIK Mitra</Label>
            <Input
              placeholder="xx.xxx.xxx.x-xxx.xxx"
              value={form.npwp}
              onChange={(e) => setForm((f) => ({ ...f, npwp: e.target.value }))}
              className="mt-1"
            />
          </div>
          {(item.direction === "output" || !item.direction) && (
            <div>
              <Label>Nomor Faktur Pajak</Label>
              <Input
                placeholder="xxx-xx.xxxxxxxx"
                value={form.fakturPajakNumber}
                onChange={(e) => setForm((f) => ({ ...f, fakturPajakNumber: e.target.value }))}
                className="mt-1"
              />
            </div>
          )}
          {item.direction === "withholding" && (
            <div>
              <Label>Nomor Bukti Potong</Label>
              <Input
                placeholder="Nomor bukti potong"
                value={form.buktiPotongNumber}
                onChange={(e) => setForm((f) => ({ ...f, buktiPotongNumber: e.target.value }))}
                className="mt-1"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Row card dalam drawer ───────────────────────────────────────────── */
function ItemRow({
  item, type, onReview, onEdit,
}: {
  item: TaxItem;
  type: DrawerType;
  onReview: (item: TaxItem) => void;
  onEdit: (item: TaxItem) => void;
}) {
  const name = item.partner_name;
  const isCompany = name && (name.includes("PT") || name.includes("CV") || name.includes("UD") || name.includes("Tbk"));

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border bg-card hover:bg-muted/30 transition-colors">
      <div className="mt-0.5 shrink-0 p-2 rounded-lg bg-muted">
        {isCompany
          ? <Building2 className="h-4 w-4 text-blue-600" />
          : <User className="h-4 w-4 text-slate-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{name ?? <span className="italic text-muted-foreground">Tanpa nama mitra</span>}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
          <span className="text-xs text-muted-foreground font-mono">{item.transaction_ref ?? `#${item.transaction_id}`}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{item.period}</span>
        </div>
        {type === "npwp" && (
          <div className="mt-1">
            {item.npwp
              ? <span className="text-xs text-green-700 font-mono bg-green-50 px-1.5 py-0.5 rounded">{item.npwp}</span>
              : <Badge className="bg-red-100 text-red-700 text-[10px] font-medium">Tanpa NPWP</Badge>}
          </div>
        )}
        {type === "faktur" && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.direction === "output" && (
              item.faktur_pajak_number
                ? <span className="text-xs text-green-700 font-mono bg-green-50 px-1.5 py-0.5 rounded">{item.faktur_pajak_number}</span>
                : <Badge className="bg-red-100 text-red-700 text-[10px]">Tanpa No. Faktur</Badge>
            )}
            {item.direction === "withholding" && (
              item.bukti_potong_number
                ? <span className="text-xs text-green-700 font-mono bg-green-50 px-1.5 py-0.5 rounded">{item.bukti_potong_number}</span>
                : <Badge className="bg-orange-100 text-orange-700 text-[10px]">Tanpa Bukti Potong</Badge>
            )}
          </div>
        )}
        {type === "pending" && (
          <div className="mt-1">
            <Badge className="bg-orange-100 text-orange-700 text-[10px]">Belum Direview</Badge>
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <div>
            <p className="text-xs text-muted-foreground">Pajak</p>
            <p className="text-sm font-bold text-rose-600">{formatRp(Number(item.tax_amount))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">DPP</p>
            <p className="text-xs text-muted-foreground">{formatRp(Number(item.base_amount))}</p>
          </div>
          <div className="flex gap-1.5">
            {type === "pending" && (
              <Button
                size="sm"
                className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                onClick={() => onReview(item)}
              >
                <Check className="h-3 w-3 mr-1" />
                Selesaikan
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onEdit(item)}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Konten dalam drawer berdasarkan type ───────────────────────────── */
function DrawerContent({
  type, period, companyId, onSaved,
}: {
  type: DrawerType;
  period: string;
  companyId: number | null | undefined;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [editItem, setEditItem] = useState<TaxItem | null>(null);

  const params = new URLSearchParams({ limit: "100" });
  if (period) params.set("period", period);
  if (companyId) params.set("companyId", String(companyId));

  /* Pending */
  const pendingParams = new URLSearchParams({ status: "pending", limit: "100" });
  if (period) pendingParams.set("period", period);
  if (companyId) pendingParams.set("companyId", String(companyId));

  const { data: pendingData, isLoading: pendingLoading, refetch: refetchPending } = useQuery<{ data: TaxItem[]; total: number }>({
    queryKey: ["drawer-pending", companyId, period],
    queryFn: () => fetch(`/api/tax/transactions?${pendingParams}`, { credentials: "include" }).then(r => r.json()),
    enabled: type === "pending",
  });

  /* Tanpa NPWP */
  const { data: npwpData, isLoading: npwpLoading, refetch: refetchNpwp } = useQuery<{ items: TaxItem[]; total: number }>({
    queryKey: ["drawer-npwp", companyId, period],
    queryFn: () => fetch(`/api/tax/npwp-missing?${params}`, { credentials: "include" }).then(r => r.json()),
    enabled: type === "npwp",
  });

  /* Tanpa Faktur */
  const { data: fakturData, isLoading: fakturLoading, refetch: refetchFaktur } = useQuery<{
    ppnOutputMissingFaktur: TaxItem[];
    pphWithholdingMissingBukti: TaxItem[];
    total: number;
  }>({
    queryKey: ["drawer-faktur", companyId, period],
    queryFn: () => fetch(`/api/tax/faktur-missing?${params}`, { credentials: "include" }).then(r => r.json()),
    enabled: type === "faktur",
  });

  const [bulkConfirm, setBulkConfirm] = useState(false);

  /* Mutasi: selesaikan review satu item (ubah status pending → paid) */
  const reviewMut = useMutation({
    mutationFn: async (item: TaxItem) => {
      const r = await fetch(`/api/tax/transactions/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "paid" }),
      });
      if (!r.ok) throw new Error("Gagal");
    },
    onSuccess: () => {
      toast.success("Transaksi ditandai selesai");
      refetchPending();
      onSaved();
    },
    onError: () => toast.error("Gagal menyelesaikan review"),
  });

  /* Mutasi: selesaikan SEMUA item pending sekaligus */
  const bulkReviewMut = useMutation({
    mutationFn: async (items: TaxItem[]) => {
      const results = await Promise.allSettled(
        items.map((item) =>
          fetch(`/api/tax/transactions/${item.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ status: "paid" }),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) throw new Error(`${failed} transaksi gagal diupdate`);
    },
    onSuccess: () => {
      toast.success("Semua transaksi berhasil diselesaikan");
      setBulkConfirm(false);
      refetchPending();
      onSaved();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Gagal menyelesaikan semua review");
      refetchPending();
    },
  });

  function handleSaved() {
    if (type === "npwp") refetchNpwp();
    if (type === "faktur") refetchFaktur();
    if (type === "pending") refetchPending();
    onSaved();
  }

  const isLoading = pendingLoading || npwpLoading || fakturLoading;

  /* Susun daftar item sesuai type */
  let items: TaxItem[] = [];
  let sections: { label: string; items: TaxItem[] }[] = [];
  if (type === "pending") items = pendingData?.data ?? [];
  if (type === "npwp") items = npwpData?.items ?? [];
  if (type === "faktur") {
    sections = [
      { label: "PPN Output — Tanpa Nomor Faktur", items: fakturData?.ppnOutputMissingFaktur ?? [] },
      { label: "PPh Withholding — Tanpa Bukti Potong", items: fakturData?.pphWithholdingMissingBukti ?? [] },
    ];
  }

  const totalItems = type === "faktur"
    ? sections.reduce((s, sec) => s + sec.items.length, 0)
    : items.length;

  return (
    <div className="flex flex-col h-full">
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="space-y-3 w-full px-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        </div>
      ) : totalItems === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7 text-green-500" />
          </div>
          <p className="font-semibold text-green-700">Semua beres!</p>
          <p className="text-sm text-muted-foreground">Tidak ada item yang perlu ditangani untuk periode ini.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {/* Bulk action bar — hanya untuk tab pending */}
          {type === "pending" && items.length > 0 && (
            <div className={`rounded-xl border p-3 transition-all ${bulkConfirm ? "bg-green-50 border-green-300" : "bg-muted/40 border-border"}`}>
              {bulkConfirm ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-green-800">
                    Tandai {items.length} transaksi sebagai selesai?
                  </p>
                  <p className="text-xs text-green-700">
                    Semua transaksi pending akan diubah statusnya menjadi <strong>paid</strong>. Tindakan ini tidak bisa dibatalkan.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => bulkReviewMut.mutate(items)}
                      disabled={bulkReviewMut.isPending}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      {bulkReviewMut.isPending ? `Memproses ${items.length} item...` : `Ya, Selesaikan Semua (${items.length})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setBulkConfirm(false)}
                      disabled={bulkReviewMut.isPending}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Batal
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{items.length}</span> transaksi belum direview
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800"
                    onClick={() => setBulkConfirm(true)}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Selesaikan Semua
                  </Button>
                </div>
              )}
            </div>
          )}

          {type === "faktur" ? (
            sections.map((sec) => sec.items.length > 0 && (
              <div key={sec.label}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{sec.label} ({sec.items.length})</p>
                <div className="space-y-2">
                  {sec.items.map(item => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      type={type}
                      onReview={reviewMut.mutate}
                      onEdit={setEditItem}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-2">
              {items.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  type={type}
                  onReview={reviewMut.mutate}
                  onEdit={setEditItem}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <EditDialog
        open={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}

/* ── Stat card klikable ─────────────────────────────────────────────── */
function StatCard({
  title, value, sub, icon, colorClass, href, badge, onClick,
}: {
  title: string; value: string; sub?: string; icon: React.ReactNode;
  colorClass: string; href?: string; badge?: string; onClick?: () => void;
}) {
  const inner = (
    <Card className={`relative overflow-hidden transition-all ${onClick || href ? "hover:shadow-md hover:ring-1 hover:ring-ring cursor-pointer" : ""}`}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`p-3 rounded-xl shrink-0 ${colorClass}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-medium truncate">{title}</p>
          <p className="text-2xl font-bold tabular-nums leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        {badge && <Badge variant="secondary" className="shrink-0 text-xs">{badge}</Badge>}
        {(href || onClick) && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href} className="block">{inner}</Link>;
  if (onClick) return <div onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onClick()} className="block">{inner}</div>;
  return inner;
}

const DRAWER_META: Record<string, { title: string; description: string }> = {
  pending: {
    title: "Belum Direview",
    description: "Transaksi pajak dengan status pending — klik Selesaikan untuk menandai sudah direview",
  },
  npwp: {
    title: "Tanpa NPWP",
    description: "Daftar customer/vendor yang belum memiliki NPWP/NIK pada transaksi pajak",
  },
  faktur: {
    title: "Tanpa Nomor Faktur",
    description: "PPN Output yang belum ada nomor faktur pajak dan PPh yang belum ada bukti potong",
  },
};

/* ── Halaman utama ───────────────────────────────────────────────────── */
export default function TaxDashboardPage() {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(PERIODS[0]);
  const [drawerType, setDrawerType] = useState<DrawerType>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<DashboardData>({
    queryKey: ["tax-dashboard", selectedCompanyId, period],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));
      const r = await fetch(`/api/tax/dashboard?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data");
      return r.json();
    },
  });

  function openDrawer(type: DrawerType) {
    setDrawerType(type);
  }

  function handleDrawerSaved() {
    qc.invalidateQueries({ queryKey: ["tax-dashboard", selectedCompanyId, period] });
  }

  const drawerMeta = drawerType ? DRAWER_META[drawerType] : null;

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <PageHeader
          title="Dashboard Pajak"
          description="Ringkasan kewajiban pajak perusahaan"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Pajak" }]}
          favoriteEnabled
          actions={
            <div className="flex items-center gap-2">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5"><div className="h-20 bg-muted animate-pulse rounded-lg" /></CardContent></Card>
            ))}
          </div>
        ) : data ? (
          <>
            {/* PPN */}
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">PPN</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                  title="PPN Keluaran"
                  value={formatRp(data.ppnKeluaran)}
                  sub="Pajak atas penjualan/jasa"
                  icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
                  colorClass="bg-blue-50"
                  href="/tax/ppn"
                />
                <StatCard
                  title="PPN Masukan"
                  value={formatRp(data.ppnMasukan)}
                  sub="Pajak atas pembelian"
                  icon={<TrendingDown className="h-5 w-5 text-violet-600" />}
                  colorClass="bg-violet-50"
                  href="/tax/ppn"
                />
                <Card className={`overflow-hidden ${data.ppnKurangBayar > 0 ? "border-orange-200 bg-orange-50/50" : "border-emerald-200 bg-emerald-50/50"}`}>
                  <CardContent className="p-5">
                    <p className="text-xs font-medium text-muted-foreground">PPN Kurang/Lebih Bayar</p>
                    <p className={`text-2xl font-bold tabular-nums mt-1 ${data.ppnKurangBayar > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                      {data.ppnKurangBayar >= 0 ? "" : "+"}{formatRp(Math.abs(data.ppnKurangBayar))}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {data.ppnKurangBayar > 0 ? "Kurang bayar — perlu disetor" : data.ppnKurangBayar < 0 ? "Lebih bayar — bisa dikompensasi" : "Nihil"}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* PPh */}
            {data.pphRows.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">PPh Witholding</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {data.pphRows.map((r) => (
                    <Card key={r.taxName}>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-muted-foreground truncate">{r.taxName}</p>
                        <p className="text-xl font-bold tabular-nums">{formatRp(r.total)}</p>
                        <p className="text-xs text-muted-foreground">{r.count} transaksi</p>
                      </CardContent>
                    </Card>
                  ))}
                  <Link href="/tax/pph" className="block">
                    <Card className="h-full hover:shadow-sm transition-shadow cursor-pointer border-dashed">
                      <CardContent className="p-4 flex items-center gap-2 text-muted-foreground h-full">
                        <ArrowRight className="h-4 w-4" />
                        <span className="text-xs">Lihat detail PPh</span>
                      </CardContent>
                    </Card>
                  </Link>
                </div>
              </div>
            )}

            {/* Perhatian */}
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Perhatian</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                  title="Belum Direview"
                  value={String(data.pendingCount)}
                  sub="Klik untuk lihat daftar & selesaikan"
                  icon={<AlertCircle className="h-5 w-5 text-orange-600" />}
                  colorClass={data.pendingCount > 0 ? "bg-orange-50" : "bg-muted"}
                  href="/tax/transactions?status=pending"
                  badge={data.pendingCount > 0 ? "!" : undefined}
                  onClick={() => openDrawer("pending")}
                />
                <StatCard
                  title="Tanpa NPWP"
                  value={String(data.noNpwpCount)}
                  sub="Klik untuk lihat siapa saja & isi NPWP"
                  icon={<Users className="h-5 w-5 text-yellow-600" />}
                  colorClass={data.noNpwpCount > 0 ? "bg-yellow-50" : "bg-muted"}
                  href="/tax/transactions?filter=no_npwp"
                  onClick={() => openDrawer("npwp")}
                />
                <StatCard
                  title="Tanpa No. Faktur"
                  value={String(data.noInvoiceCount)}
                  sub="Klik untuk lihat siapa saja & isi faktur"
                  icon={<FileText className="h-5 w-5 text-red-600" />}
                  colorClass={data.noInvoiceCount > 0 ? "bg-red-50" : "bg-muted"}
                  onClick={() => openDrawer("faktur")}
                />
              </div>
            </div>

            {/* Quick links */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/tax/transactions">Transaksi Pajak</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/tax/ppn">PPN Masukan / Keluaran</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/tax/pph">PPh Witholding</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/tax/spt">SPT Masa</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/tax/rules">Master Aturan Pajak</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                const params = new URLSearchParams({ period });
                if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));
                window.open(`/api/tax/export?${params}`, "_blank");
              }}>
                Export CSV
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <Receipt className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p>Belum ada data pajak untuk periode ini</p>
          </div>
        )}
      </div>

      {/* ── Drawer Detail ──────────────────────────────────────────────── */}
      <Sheet open={!!drawerType} onOpenChange={(open) => !open && setDrawerType(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
          <SheetHeader className="px-4 pt-5 pb-3 border-b shrink-0">
            <div className="flex items-start justify-between">
              <div>
                <SheetTitle className="text-base font-semibold">
                  {drawerMeta?.title}
                </SheetTitle>
                <SheetDescription className="text-xs mt-1 leading-snug">
                  {drawerMeta?.description}
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-xs font-mono">{period}</Badge>
              <span className="text-xs text-muted-foreground">periode aktif</span>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-hidden pt-3">
            {drawerType && (
              <DrawerContent
                type={drawerType}
                period={period}
                companyId={selectedCompanyId as number | null | undefined}
                onSaved={handleDrawerSaved}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
