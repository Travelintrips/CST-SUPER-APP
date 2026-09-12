import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Droplets, Printer, Download, TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, Waves, CalendarDays, ChevronRight } from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { Link } from "wouter";
import { BackButton } from "@/components/ui/back-button";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const idrShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${new Intl.NumberFormat("id-ID").format(abs)}`;
};

function CfKpiCard({ label, value, sub, positive, icon: Icon }: {
  label: string; value: string; sub?: string; positive: boolean | null; icon: React.ElementType;
}) {
  const colorClass = positive === null
    ? "text-slate-300 border-slate-700"
    : positive
      ? "text-emerald-400 border-emerald-800"
      : "text-rose-400 border-rose-800";
  const bgClass = positive === null ? "bg-slate-800/60" : positive ? "bg-emerald-950/60" : "bg-rose-950/60";
  return (
    <div className={`rounded-xl border ${colorClass} ${bgClass} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${colorClass.split(" ")[0]}`} />
        <span className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</span>
      </div>
      <p className={`text-xl font-bold font-mono ${colorClass.split(" ")[0]}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-1">{sub}</p>}
      {positive !== null && (
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold mt-1.5 ${positive ? "text-emerald-400" : "text-rose-400"}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {positive ? "Positif" : "Negatif"}
        </span>
      )}
    </div>
  );
}

interface CashFlowData {
  from: string | null;
  to: string | null;
  openingBalance: number;
  totalInflow: number;
  totalOutflow: number;
  netChange: number;
  operatingNet: number;
  investingNet: number;
  financingNet: number;
  unclassifiedNet: number;
  closingBalance: number;
}

function FlowRow({ label, amount, indent = false, bold = false, border = false }: {
  label: string; amount: number; indent?: boolean; bold?: boolean; border?: boolean;
}) {
  const color = amount > 0 ? "text-emerald-400" : amount < 0 ? "text-rose-400" : "text-muted-foreground";
  return (
    <div className={`flex justify-between items-center py-2 ${indent ? "pl-6" : ""} ${border ? "border-t mt-1 pt-3" : ""}`}>
      <span className={`text-sm ${bold ? "font-semibold" : ""}`}>{label}</span>
      <span className={`text-sm font-mono ${bold ? "font-bold" : ""} ${bold ? color : "text-foreground"}`}>
        {idr(amount)}
      </span>
    </div>
  );
}

export default function CashFlowPage() {
  const { activeCompanyId, isConsolidated, activeCompany } = useCompany();
  const [from, setFrom] = useState(() => new URLSearchParams(window.location.search).get("startDate") ?? "");
  const [to, setTo] = useState(() => new URLSearchParams(window.location.search).get("endDate") ?? "");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", new Date(from).toISOString());
    if (to)   p.set("to",   new Date(to + "T23:59:59").toISOString());
    if (!isConsolidated && activeCompanyId) p.set("company", String(activeCompanyId));
    return p.toString();
  }, [from, to, activeCompanyId, isConsolidated]);

  const { data, isLoading } = useQuery<CashFlowData>({
    queryKey: ["cash-flow", params],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/reports/cash-flow${params ? `?${params}` : ""}`);
      if (!res.ok) throw new Error("Gagal memuat data");
      return res.json();
    },
    enabled: !!from || !!to,
  });

  function buildExportRows() {
    if (!data) return [];
    return [
      ["Saldo Awal Kas & Bank", "", idr(data.openingBalance)],
      ["", "", ""],
      ["ARUS KAS OPERASIONAL", "", ""],
      ["  Arus Kas Bersih dari Operasional", "", idr(data.operatingNet)],
      ["", "", ""],
      ["ARUS KAS INVESTASI", "", ""],
      ["  Arus Kas Bersih dari Investasi", "", idr(data.investingNet)],
      ["", "", ""],
      ["ARUS KAS PENDANAAN", "", ""],
      ["  Arus Kas Bersih dari Pendanaan", "", idr(data.financingNet)],
      ...(data.unclassifiedNet !== 0 ? [
        ["", "", ""],
        ["Arus Kas Tidak Terklasifikasi", "", idr(data.unclassifiedNet)],
      ] : []),
      ["", "", ""],
      ["TOTAL PERUBAHAN KAS BERSIH", "", idr(data.netChange)],
      ["Total Kas Masuk", "", idr(data.totalInflow)],
      ["Total Kas Keluar", "", idr(data.totalOutflow)],
      ["", "", ""],
      ["SALDO AKHIR KAS & BANK", "", idr(data.closingBalance)],
    ] as (string | number | null)[][];
  }

  return (
    <AppShell>
      <BackButton href="/finance/workspace/financial-reports" />
      <div className="space-y-6 p-6">

        <PageHeader
          onBack={() => window.history.back()}
          title="Laporan Arus Kas"
          description="Pergerakan kas & bank dalam periode terpilih (berdasarkan akun Kas/Bank)"
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Finance", href: "/finance" },
            { label: "Laporan Keuangan", href: "/finance/workspace/financial-statements" },
            { label: "Arus Kas" },
          ]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => printWindow("Laporan Arus Kas", ["Keterangan", "", "Jumlah"], buildExportRows(), [2])}
                disabled={!data}
              >
                <Printer className="h-4 w-4 mr-1.5" />Print
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => exportXlsx("Arus_Kas", ["Keterangan", "", "Jumlah"], buildExportRows())}
                disabled={!data}
              >
                <Download className="h-4 w-4 mr-1.5" />XLSX
              </Button>
            </div>
          }
        />

        {/* Filter */}
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[140px]">
              <Label>Dari</Label>
              <DatePicker value={from} onChange={setFrom} />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label>Sampai</Label>
              <DatePicker value={to} onChange={setTo} />
            </div>
            {(!from && !to) && (
              <p className="text-sm text-muted-foreground self-end pb-1">
                Pilih rentang tanggal untuk melihat laporan
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Filter Summary ── */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 flex-wrap">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span><span className="font-medium text-foreground">Periode:</span> {from || to ? `${from || "—"} s/d ${to || "—"}` : "Pilih periode"}</span>
          {!isConsolidated && activeCompany && (
            <><span className="text-muted-foreground/40">·</span><span><span className="font-medium text-foreground">Perusahaan:</span> {activeCompany.companyName}</span></>
          )}
        </div>

        {isLoading && (
          <Card><CardContent className="p-4 text-muted-foreground text-sm">Memuat...</CardContent></Card>
        )}

        {data && !isLoading && (
          <div className="space-y-4">
            {/* ── Dark KPI Panel ── */}
            <div className="rounded-2xl bg-slate-900 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Waves className="h-4 w-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Cash Flow Summary</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <CfKpiCard
                  label="Total Kas Masuk"
                  value={idrShort(data.totalInflow)}
                  sub="Semua penerimaan kas"
                  positive={data.totalInflow > 0}
                  icon={TrendingUp}
                />
                <CfKpiCard
                  label="Total Kas Keluar"
                  value={idrShort(data.totalOutflow)}
                  sub="Semua pengeluaran kas"
                  positive={null}
                  icon={TrendingDown}
                />
                <CfKpiCard
                  label="Perubahan Kas Bersih"
                  value={idrShort(data.netChange)}
                  sub="Masuk − Keluar"
                  positive={data.netChange >= 0}
                  icon={Minus}
                />
                <CfKpiCard
                  label="Saldo Akhir Kas"
                  value={idrShort(data.closingBalance)}
                  sub={`Awal: ${idrShort(data.openingBalance)}`}
                  positive={data.closingBalance >= 0}
                  icon={Droplets}
                />
              </div>
              {/* Saldo bar */}
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs text-slate-500 w-20 shrink-0">Saldo Awal</span>
                <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${data.closingBalance >= data.openingBalance ? "bg-emerald-500" : "bg-rose-500"}`}
                    style={{ width: `${data.openingBalance > 0 ? Math.min(100, (data.closingBalance / data.openingBalance) * 100) : 50}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 w-20 text-right shrink-0">Saldo Akhir</span>
              </div>
            </div>

            {/* Saldo Awal */}
            <Card>
              <CardContent className="p-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-muted-foreground text-sm">Saldo Awal Kas &amp; Bank</span>
                  <span className="font-mono font-bold text-base">{idr(data.openingBalance)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Arus Kas Operasional */}
            <Card>
              <CardContent className="p-4">
                <div className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  Arus Kas dari Kegiatan Operasional
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Arus kas dari transaksi pendapatan, beban, dan utang/piutang operasional
                </p>
                <FlowRow label="Arus Kas Bersih Operasional" amount={data.operatingNet} bold />
              </CardContent>
            </Card>

            {/* Arus Kas Investasi */}
            <Card>
              <CardContent className="p-4">
                <div className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <Minus className="h-4 w-4 text-blue-600" />
                  Arus Kas dari Kegiatan Investasi
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Perubahan aset non-kas (pembelian/penjualan aset tetap, investasi)
                </p>
                <FlowRow label="Arus Kas Bersih Investasi" amount={data.investingNet} bold />
              </CardContent>
            </Card>

            {/* Arus Kas Pendanaan */}
            <Card>
              <CardContent className="p-4">
                <div className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-purple-600" />
                  Arus Kas dari Kegiatan Pendanaan
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Transaksi terkait ekuitas (modal, dividen, pinjaman jangka panjang)
                </p>
                <FlowRow label="Arus Kas Bersih Pendanaan" amount={data.financingNet} bold />
              </CardContent>
            </Card>

            {/* Tidak terklasifikasi (jika ada) */}
            {data.unclassifiedNet !== 0 && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="p-4">
                  <div className="font-semibold text-sm mb-1 text-amber-800">Tidak Terklasifikasi</div>
                  <p className="text-xs text-amber-700 mb-2">
                    Transaksi kas tanpa contra-account atau akun tidak dikenali sistem
                  </p>
                  <FlowRow label="Arus Kas Tidak Terklasifikasi" amount={data.unclassifiedNet} bold />
                </CardContent>
              </Card>
            )}

            {/* Ringkasan */}
            <Card className="bg-muted/30">
              <CardContent className="p-4 space-y-1">
                <div className="font-semibold text-sm mb-3">Ringkasan Pergerakan Kas</div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-700">Total Kas Masuk</span>
                  <span className="font-mono text-emerald-700">{idr(data.totalInflow)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-rose-700">Total Kas Keluar</span>
                  <span className="font-mono text-rose-700">({idr(data.totalOutflow)})</span>
                </div>
                <div className="flex justify-between text-sm font-semibold border-t pt-2 mt-2">
                  <span>Perubahan Kas Bersih</span>
                  <span className={`font-mono ${data.netChange >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {idr(data.netChange)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Saldo Akhir */}
            <Card className="border-2 border-primary/20">
              <CardContent className="p-4 flex justify-between items-center">
                <span className="text-lg font-bold">Saldo Akhir Kas &amp; Bank</span>
                <span className={`text-2xl font-bold font-mono ${data.closingBalance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {idr(data.closingBalance)}
                </span>
              </CardContent>
            </Card>

            {/* Catatan metodologi */}
            <Card className="bg-blue-50/50 border-blue-100">
              <CardContent className="p-3 text-xs text-blue-700">
                <strong>Metodologi:</strong> Laporan ini menggunakan <em>direct method</em> — mengidentifikasi semua akun Kas/Bank
                dari Chart of Accounts dan mengklasifikasikan pergerakannya berdasarkan tipe contra-account (akun lawan) di setiap
                entri jurnal. Klasifikasi: Operasional = contra pendapatan/beban/liabilitas;
                Investasi = contra aset non-kas; Pendanaan = contra ekuitas.
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
