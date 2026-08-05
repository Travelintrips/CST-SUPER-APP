import React, { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useCompany } from "@/contexts/CompanyContext";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  RefreshCw, ArrowUpCircle, ArrowDownCircle, Wallet,
  Building2, Receipt, Users, CreditCard, Handshake, ChevronRight, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ForecastItem {
  category: string;
  label: string;
  amount: number;
  overdueAmount?: number;
  count?: number;
  description: string;
}

interface CashInSection {
  arOutstanding: { amount: number; count: number; overdueAmount: number };
  total: number;
  items: ForecastItem[];
}

interface CashOutSection {
  vendorInvoices: { amount: number; count: number; overdueAmount: number };
  loanRepayments: { amount: number; count: number };
  taxObligations: { amount: number; pendingAmount: number; overdueAmount: number };
  kasbonOutstanding: { amount: number; count: number };
  vendorInstallments: { amount: number; count: number };
  total: number;
  items: ForecastItem[];
}

interface ForecastPeriod {
  days: number;
  openingCash: number;
  cashIn: CashInSection;
  cashOut: CashOutSection;
  projectedClosing: number;
  isNegative: boolean;
  warning: string | null;
}

interface ForecastResponse {
  asOf: string;
  openingCash: number;
  periods: Record<string, ForecastPeriod>;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatIDR(n: number, showSign = false): string {
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(abs);
  if (showSign && n < 0) return `- Rp ${formatted}`;
  if (showSign && n > 0) return `+ Rp ${formatted}`;
  return `Rp ${formatted}`;
}

function formatIDRCompact(n: number): string {
  const abs = Math.abs(n);
  const prefix = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${prefix}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${prefix}Rp ${(abs / 1_000_000).toFixed(1)}Jt`;
  if (abs >= 1_000) return `${prefix}Rp ${(abs / 1_000).toFixed(0)}K`;
  return `${prefix}Rp ${abs.toFixed(0)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, colorClass, bgClass,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 shadow-sm">
      <div className={`rounded-lg p-2.5 ${bgClass}`}>
        <Icon className={`w-5 h-5 ${colorClass}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <p className={`text-xl font-black mt-0.5 truncate ${colorClass}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SectionRow({
  icon: Icon, label, amount, count, overdue, colorClass, bgClass,
}: {
  icon: React.ElementType;
  label: string;
  amount: number;
  count?: number;
  overdue?: number;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className={`rounded-lg p-2 ${bgClass} shrink-0`}>
        <Icon className={`w-4 h-4 ${colorClass}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        {count !== undefined && (
          <p className="text-xs text-gray-400">{count} item{count !== 1 ? "s" : ""}</p>
        )}
        {overdue !== undefined && overdue > 0 && (
          <p className="text-xs text-red-500 font-medium">
            Termasuk overdue {formatIDRCompact(overdue)}
          </p>
        )}
      </div>
      <p className={`text-sm font-bold ${colorClass} tabular-nums`}>{formatIDRCompact(amount)}</p>
    </div>
  );
}

function ProjectedClosingCard({ period }: { period: ForecastPeriod }) {
  const isNeg = period.isNegative;
  const netFlow = period.cashIn.total - period.cashOut.total;

  return (
    <div
      className={`rounded-xl border-2 p-5 ${
        isNeg
          ? "border-red-300 bg-red-50"
          : "border-emerald-300 bg-emerald-50"
      }`}
    >
      {/* Warning Banner */}
      {isNeg && period.warning && (
        <div className="flex items-start gap-2 mb-4 bg-red-100 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 font-medium leading-relaxed">{period.warning}</p>
        </div>
      )}
      {!isNeg && (
        <div className="flex items-center gap-2 mb-4 bg-emerald-100 border border-emerald-200 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-700 font-medium">
            Proyeksi saldo positif dalam {period.days} hari ke depan.
          </p>
        </div>
      )}

      {/* Equation */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Opening Cash</span>
          <span className="font-semibold text-gray-800">{formatIDR(period.openingCash)}</span>
        </div>
        <div className="flex justify-between items-center text-emerald-700">
          <span>+ Cash In</span>
          <span className="font-semibold">{formatIDR(period.cashIn.total)}</span>
        </div>
        <div className="flex justify-between items-center text-red-600">
          <span>− Cash Out</span>
          <span className="font-semibold">{formatIDR(period.cashOut.total)}</span>
        </div>
        <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between items-center">
          <span className={`font-bold text-base ${isNeg ? "text-red-700" : "text-emerald-700"}`}>
            = Projected Closing
          </span>
          <span
            className={`font-black text-xl ${isNeg ? "text-red-700" : "text-emerald-700"}`}
          >
            {isNeg ? "- " : ""}{formatIDR(Math.abs(period.projectedClosing))}
          </span>
        </div>
        {/* Net Flow indicator */}
        <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
          <span>Net Flow (In − Out)</span>
          <span className={`font-semibold ${netFlow >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {formatIDR(netFlow, true)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<string, string> = {
  "7": "7 Hari",
  "30": "30 Hari",
  "90": "90 Hari",
};

export default function CashFlowForecastPage() {
  const { activeCompanyId } = useCompany();
  const [activePeriod, setActivePeriod] = useState<"7" | "30" | "90">("30");
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchForecast = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = activeCompanyId ? `?company=${activeCompanyId}&period=${activePeriod}` : `?period=${activePeriod}`;
      const res = await fetch(`/api/accounting/cash-flow-forecast${qs}`, {
        credentials: "include",
        headers: { "x-company-id": String(activeCompanyId ?? 1) },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message ?? "Gagal memuat data forecast");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  React.useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  const period = data?.periods?.[activePeriod];

  return (
    <AppShell>
      <BackButton href="/accounting" />
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <Link href="/accounting/bank-disbursements" className="hover:text-gray-600">
                Treasury
              </Link>
              <ChevronRight className="w-3 h-3" />
              <span>Cash Flow Forecast</span>
            </div>
            <h1 className="text-2xl font-black text-gray-900">Cash Flow Forecast</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Proyeksi arus kas berdasarkan data real-time AR, AP, pinjaman, pajak, dan kasbon
              {data?.asOf && ` · Per ${data.asOf}`}
            </p>
          </div>
          <button
            onClick={fetchForecast}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors self-start"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* ── Error State ─────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold">Gagal memuat forecast</p>
              <p className="text-xs mt-0.5 opacity-75">{error}</p>
            </div>
          </div>
        )}

        {/* ── Loading Skeleton ─────────────────────────────────────────── */}
        {loading && !data && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* ── Content ─────────────────────────────────────────────────── */}
        {data && (
          <>
            {/* Period Selector */}
            <div className="flex gap-2">
              {(["7", "30", "90"] as const).map((p) => {
                const fp = data.periods[p];
                const isNeg = fp?.isNegative;
                return (
                  <button
                    key={p}
                    onClick={() => setActivePeriod(p)}
                    className={`relative flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                      activePeriod === p
                        ? "bg-gray-900 text-white border-gray-900 shadow-md"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                    {isNeg && (
                      <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Alert: any period negative */}
            {(["7", "30", "90"] as const).some((p) => data.periods[p]?.isNegative) && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-bold text-amber-800">Peringatan Likuiditas</p>
                  <p className="text-amber-700 mt-0.5 text-xs">
                    Satu atau lebih periode forecast menunjukkan proyeksi saldo negatif. Tinjau
                    segera dan ambil tindakan seperti percepatan penagihan AR, negosiasi tenor
                    hutang, atau injeksi modal.
                  </p>
                </div>
              </div>
            )}

            {period && (
              <>
                {/* ── KPI Cards ──────────────────────────────────────────── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiCard
                    label="Opening Cash"
                    value={formatIDRCompact(period.openingCash)}
                    sub="Saldo kas & bank saat ini"
                    icon={Wallet}
                    colorClass="text-gray-700"
                    bgClass="bg-gray-100"
                  />
                  <KpiCard
                    label={`Cash In (${PERIOD_LABELS[activePeriod]})`}
                    value={formatIDRCompact(period.cashIn.total)}
                    sub={`${period.cashIn.arOutstanding.count} invoice AR`}
                    icon={ArrowUpCircle}
                    colorClass="text-emerald-700"
                    bgClass="bg-emerald-100"
                  />
                  <KpiCard
                    label={`Cash Out (${PERIOD_LABELS[activePeriod]})`}
                    value={formatIDRCompact(period.cashOut.total)}
                    sub={`${period.cashOut.vendorInvoices.count} invoice vendor`}
                    icon={ArrowDownCircle}
                    colorClass="text-red-600"
                    bgClass="bg-red-100"
                  />
                  <KpiCard
                    label="Projected Closing"
                    value={formatIDRCompact(period.projectedClosing)}
                    sub={period.isNegative ? "⚠️ DEFISIT" : "Aman"}
                    icon={period.isNegative ? TrendingDown : TrendingUp}
                    colorClass={period.isNegative ? "text-red-600" : "text-emerald-700"}
                    bgClass={period.isNegative ? "bg-red-100" : "bg-emerald-100"}
                  />
                </div>

                {/* ── Main Grid ──────────────────────────────────────────── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Cash In */}
                  <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                      <ArrowUpCircle className="w-4 h-4 text-emerald-600" />
                      <h2 className="font-black text-gray-900 text-sm">Cash In</h2>
                      <span className="ml-auto text-sm font-black text-emerald-700">
                        {formatIDRCompact(period.cashIn.total)}
                      </span>
                    </div>
                    <div className="px-5 pb-2">
                      <SectionRow
                        icon={Users}
                        label="AR Outstanding"
                        amount={period.cashIn.arOutstanding.amount}
                        count={period.cashIn.arOutstanding.count}
                        overdue={period.cashIn.arOutstanding.overdueAmount}
                        colorClass="text-emerald-700"
                        bgClass="bg-emerald-50"
                      />
                      {period.cashIn.total === 0 && (
                        <p className="text-xs text-gray-400 py-4 text-center">
                          Tidak ada piutang jatuh tempo dalam {PERIOD_LABELS[activePeriod]}
                        </p>
                      )}
                    </div>
                    <div className="px-5 py-3 bg-emerald-50 border-t border-emerald-100 rounded-b-xl">
                      <div className="flex justify-between text-xs font-bold text-emerald-800">
                        <span>Total Masuk</span>
                        <span>{formatIDR(period.cashIn.total)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Cash Out */}
                  <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                      <ArrowDownCircle className="w-4 h-4 text-red-500" />
                      <h2 className="font-black text-gray-900 text-sm">Cash Out</h2>
                      <span className="ml-auto text-sm font-black text-red-600">
                        {formatIDRCompact(period.cashOut.total)}
                      </span>
                    </div>
                    <div className="px-5 pb-2">
                      <SectionRow
                        icon={Building2}
                        label="Vendor Invoice"
                        amount={period.cashOut.vendorInvoices.amount}
                        count={period.cashOut.vendorInvoices.count}
                        overdue={period.cashOut.vendorInvoices.overdueAmount}
                        colorClass="text-red-600"
                        bgClass="bg-red-50"
                      />
                      {period.cashOut.loanRepayments.amount > 0 && (
                        <SectionRow
                          icon={CreditCard}
                          label="Angsuran Pinjaman"
                          amount={period.cashOut.loanRepayments.amount}
                          count={period.cashOut.loanRepayments.count}
                          colorClass="text-orange-600"
                          bgClass="bg-orange-50"
                        />
                      )}
                      {period.cashOut.taxObligations.amount > 0 && (
                        <SectionRow
                          icon={Receipt}
                          label="Kewajiban Pajak"
                          amount={period.cashOut.taxObligations.amount}
                          overdue={period.cashOut.taxObligations.overdueAmount}
                          colorClass="text-amber-700"
                          bgClass="bg-amber-50"
                        />
                      )}
                      {period.cashOut.kasbonOutstanding.amount > 0 && (
                        <SectionRow
                          icon={Users}
                          label="Kasbon Karyawan"
                          amount={period.cashOut.kasbonOutstanding.amount}
                          count={period.cashOut.kasbonOutstanding.count}
                          colorClass="text-purple-700"
                          bgClass="bg-purple-50"
                        />
                      )}
                      {period.cashOut.vendorInstallments.amount > 0 && (
                        <SectionRow
                          icon={Handshake}
                          label="Cicilan Vendor"
                          amount={period.cashOut.vendorInstallments.amount}
                          count={period.cashOut.vendorInstallments.count}
                          colorClass="text-indigo-700"
                          bgClass="bg-indigo-50"
                        />
                      )}
                    </div>
                    <div className="px-5 py-3 bg-red-50 border-t border-red-100 rounded-b-xl">
                      <div className="flex justify-between text-xs font-bold text-red-800">
                        <span>Total Keluar</span>
                        <span>{formatIDR(period.cashOut.total)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Projected Closing */}
                  <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp className="w-4 h-4 text-gray-600" />
                      <h2 className="font-black text-gray-900 text-sm">Proyeksi Akhir</h2>
                    </div>
                    <ProjectedClosingCard period={period} />
                  </div>
                </div>

                {/* ── Breakdown Table ─────────────────────────────────────── */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h2 className="font-black text-gray-900 text-sm">
                      Rincian Komponen — {PERIOD_LABELS[activePeriod]}
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">
                            Komponen
                          </th>
                          <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">
                            Kategori
                          </th>
                          <th className="px-5 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wide">
                            Jumlah
                          </th>
                          <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide hidden md:table-cell">
                            Keterangan
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {/* Opening */}
                        <tr className="bg-gray-50">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Wallet className="w-4 h-4 text-gray-500" />
                              <span className="font-bold text-gray-700">Opening Cash</span>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-medium">
                              Saldo Awal
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-gray-800 tabular-nums">
                            {formatIDR(period.openingCash)}
                          </td>
                          <td className="px-5 py-3 hidden md:table-cell text-gray-400 text-xs">
                            Saldo kas & bank per hari ini
                          </td>
                        </tr>

                        {/* Cash In items */}
                        {period.cashIn.items.map((item) => (
                          <tr key={item.category} className="hover:bg-emerald-50/50">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <ArrowUpCircle className="w-4 h-4 text-emerald-500" />
                                <span className="font-semibold text-gray-700">{item.label}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <span className="bg-emerald-50 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-medium">
                                Cash In
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right font-bold text-emerald-700 tabular-nums">
                              + {formatIDR(item.amount)}
                            </td>
                            <td className="px-5 py-3 hidden md:table-cell text-gray-400 text-xs">
                              {item.description}
                            </td>
                          </tr>
                        ))}

                        {/* Cash Out items */}
                        {period.cashOut.items.map((item) => (
                          <tr key={item.category} className="hover:bg-red-50/50">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <ArrowDownCircle className="w-4 h-4 text-red-400" />
                                <span className="font-semibold text-gray-700">{item.label}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <span className="bg-red-50 text-red-600 text-xs px-2 py-0.5 rounded-full font-medium">
                                Cash Out
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right font-bold text-red-600 tabular-nums">
                              − {formatIDR(item.amount)}
                            </td>
                            <td className="px-5 py-3 hidden md:table-cell text-gray-400 text-xs">
                              {item.description}
                            </td>
                          </tr>
                        ))}

                        {/* Projected Closing */}
                        <tr
                          className={`border-t-2 ${
                            period.isNegative
                              ? "border-red-200 bg-red-50"
                              : "border-emerald-200 bg-emerald-50"
                          }`}
                        >
                          <td className="px-5 py-4" colSpan={2}>
                            <div className="flex items-center gap-2">
                              {period.isNegative ? (
                                <TrendingDown className="w-4 h-4 text-red-600" />
                              ) : (
                                <TrendingUp className="w-4 h-4 text-emerald-600" />
                              )}
                              <span
                                className={`font-black text-base ${
                                  period.isNegative ? "text-red-700" : "text-emerald-700"
                                }`}
                              >
                                Projected Closing Cash
                              </span>
                              {period.isNegative && (
                                <span className="text-xs bg-red-200 text-red-700 px-2 py-0.5 rounded-full font-bold">
                                  DEFISIT
                                </span>
                              )}
                            </div>
                          </td>
                          <td
                            className={`px-5 py-4 text-right font-black text-xl tabular-nums ${
                              period.isNegative ? "text-red-700" : "text-emerald-700"
                            }`}
                          >
                            {period.isNegative && "−"}{formatIDR(Math.abs(period.projectedClosing))}
                          </td>
                          <td className="px-5 py-4 hidden md:table-cell text-xs text-gray-500">
                            Opening + Cash In − Cash Out
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Assumptions Note ─────────────────────────────────────── */}
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1">
                  <p className="font-bold text-blue-800">Catatan Asumsi Forecast</p>
                  <ul className="space-y-0.5 text-blue-600">
                    <li>• Opening Cash dihitung dari saldo akun Kas & Bank di buku besar (status posted).</li>
                    <li>• AR Outstanding: piutang pelanggan jatuh tempo dalam {PERIOD_LABELS[activePeriod]}, termasuk yang overdue (tanggal lewat).</li>
                    <li>• Vendor Invoice: hutang vendor jatuh tempo dalam {PERIOD_LABELS[activePeriod]}, termasuk overdue.</li>
                    <li>• Angsuran Pinjaman: estimasi proporsional dari outstanding pinjaman bank aktif (outstanding ÷ tenor).</li>
                    <li>• Kewajiban Pajak: total pajak dengan status 'pending' untuk periode yang jatuh dalam window forecast.</li>
                    {activePeriod !== "7" && (
                      <li>• Kasbon Karyawan: total kasbon aktif belum dipertanggungjawabkan (dimasukkan ke forecast ≥30 hari).</li>
                    )}
                    {activePeriod === "90" && (
                      <li>• Cicilan Vendor: sisa cicilan vendor aktif (dimasukkan ke forecast 90 hari).</li>
                    )}
                    <li>• Forecast ini bersifat proyeksi indikatif dan tidak memperhitungkan transaksi baru yang belum tercatat.</li>
                  </ul>
                </div>

                {/* ── Quick Actions ─────────────────────────────────────────── */}
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/accounting/bank-disbursements"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    <Wallet className="w-4 h-4" />
                    Treasury Dashboard
                  </Link>
                  <Link
                    href="/reports/ar-aging"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    <Users className="w-4 h-4" />
                    AR Aging Report
                  </Link>
                  <Link
                    href="/reports/ap-aging"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    <Building2 className="w-4 h-4" />
                    AP Aging Report
                  </Link>
                  <Link
                    href="/accounting/reports/cash-flow"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    <TrendingUp className="w-4 h-4" />
                    Cash Flow Statement
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
