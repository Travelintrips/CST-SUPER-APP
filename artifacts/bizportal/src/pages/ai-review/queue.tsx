import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileSearch,
  RefreshCw,
  AlertTriangle,
  Clock,
  Users,
  CheckCircle2,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Search,
  Calendar,
} from "lucide-react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  aiReviewApi,
  AIReviewFilters,
  AIReviewCase,
  AIReviewStatus,
  AIReviewPriority,
  AIReviewQueue,
  AIRiskLevel,
  STATUS_LABELS,
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  QUEUE_LABELS,
  RISK_LEVEL_COLORS,
  maskAccountNumber,
  confidencePct,
} from "@/lib/ai-review-api";

// ── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZES = [10, 25, 50];

function SlaIndicator({ sla }: { sla?: AIReviewCase["sla"] }) {
  if (!sla) return <span className="text-muted-foreground text-xs">—</span>;
  const color =
    sla.slaStatus === "OVERDUE"
      ? "text-red-600"
      : sla.slaStatus === "AT_RISK"
      ? "text-orange-600"
      : "text-green-600";
  const label =
    sla.slaStatus === "OVERDUE"
      ? "Terlambat"
      : sla.slaStatus === "AT_RISK"
      ? "Berisiko"
      : sla.slaStatus === "COMPLETED"
      ? "Selesai"
      : "Tepat Waktu";
  return (
    <span className={`text-xs font-medium ${color}`}>
      {label}
      {sla.hoursRemaining != null && sla.slaStatus !== "OVERDUE" && sla.slaStatus !== "COMPLETED" && (
        <span className="ml-1 text-muted-foreground font-normal">
          ({Math.round(sla.hoursRemaining)}j)
        </span>
      )}
    </span>
  );
}

function directionLabel(direction?: string): string {
  if (direction === "DEBIT") return "Debit";
  if (direction === "CREDIT") return "Kredit";
  return direction ?? "—";
}

function formatAmount(amount?: number, currency?: string): string {
  if (amount == null) return "—";
  const cur = currency ?? "IDR";
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${cur} ${amount.toLocaleString("id-ID")}`;
  }
}

// ── Summary Cards ────────────────────────────────────────────────────────────

interface SummaryStats {
  open: number;
  highRisk: number;
  overdue: number;
  unassigned: number;
  assignedToMe: number;
  dueToday: number;
}

function computeStats(items: AIReviewCase[], currentUserId?: string): SummaryStats {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  return {
    open: items.filter(i => !["CLOSED", "CANCELLED", "APPROVED", "COA_CHANGED", "REJECTED"].includes(i.status)).length,
    highRisk: items.filter(i => i.riskLevel === "HIGH" || i.riskLevel === "CRITICAL").length,
    overdue: items.filter(i => i.sla?.isOverdue).length,
    unassigned: items.filter(i => !i.assignedReviewerId).length,
    assignedToMe: currentUserId
      ? items.filter(i => i.assignedReviewerId === currentUserId).length
      : 0,
    dueToday: items.filter(i => {
      const due = i.sla?.dueAt ?? i.sla?.deadlineAt;
      if (!due) return false;
      const d = new Date(due);
      return d >= todayStart && d <= today;
    }).length,
  };
}

// ── Queue Table Row ──────────────────────────────────────────────────────────

function QueueRow({ item, onClick }: { item: AIReviewCase; onClick: () => void }) {
  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
        {item.id.slice(0, 8)}…
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {item.transactionDate
          ? format(new Date(item.transactionDate), "dd MMM yyyy", { locale: idLocale })
          : "—"}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">{item.transactionSource ?? "—"}</td>
      <td className="px-3 py-2.5 text-xs max-w-[180px] truncate">{item.description ?? "—"}</td>
      <td className="px-3 py-2.5 text-xs">{item.counterparty ?? "—"}</td>
      <td className="px-3 py-2.5 text-xs font-mono whitespace-nowrap">
        {formatAmount(item.amount, item.currency)}
      </td>
      <td className="px-3 py-2.5 text-xs">{directionLabel(item.direction)}</td>
      <td className="px-3 py-2.5 text-xs max-w-[120px] truncate">{item.detectedIntent ?? "—"}</td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {item.recommendedCoaCode ? (
          <span className="font-mono">{item.recommendedCoaCode}</span>
        ) : "—"}
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {item.intentConfidence != null ? confidencePct(item.intentConfidence) : "—"}
      </td>
      <td className="px-3 py-2.5">
        {item.riskLevel && item.riskLevel !== "NONE" ? (
          <Badge className={`text-[10px] px-1.5 py-0 border ${RISK_LEVEL_COLORS[item.riskLevel] ?? ""}`}>
            {item.riskLevel}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {item.queue ? (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 whitespace-nowrap">
            {QUEUE_LABELS[item.queue] ?? item.queue}
          </Badge>
        ) : "—"}
      </td>
      <td className="px-3 py-2.5">
        {item.priority ? (
          <Badge className={`text-[10px] px-1.5 py-0 border ${PRIORITY_COLORS[item.priority] ?? ""}`}>
            {PRIORITY_LABELS[item.priority] ?? item.priority}
          </Badge>
        ) : "—"}
      </td>
      <td className="px-3 py-2.5">
        {item.status ? (
          <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_COLORS[item.status] ?? ""}`}>
            {STATUS_LABELS[item.status] ?? item.status}
          </Badge>
        ) : "—"}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
        {item.assignedReviewerName ?? (item.assignedReviewerId ? item.assignedReviewerId.slice(0, 8) : "—")}
      </td>
      <td className="px-3 py-2.5">
        <SlaIndicator sla={item.sla} />
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
        {item.createdAt
          ? formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: idLocale })
          : "—"}
      </td>
    </tr>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AiReviewQueuePage() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AIReviewStatus | "">("");
  const [queue, setQueue] = useState<AIReviewQueue | "">("");
  const [priority, setPriority] = useState<AIReviewPriority | "">("");
  const [riskLevel, setRiskLevel] = useState<AIRiskLevel | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const filters: AIReviewFilters = {
    ...(status ? { status } : {}),
    ...(queue ? { queue } : {}),
    ...(priority ? { priority } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    ...(search ? { transactionId: search } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    page,
    limit,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ai-review-cases", filters],
    queryFn: () => aiReviewApi.listCases(filters),
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const stats = computeStats(items);

  const handleReset = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setQueue("");
    setPriority("");
    setRiskLevel("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }, []);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <FileSearch className="h-6 w-6 text-indigo-500" />
                AI Transaction Review Queue
              </h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Tinjau dan validasi rekomendasi AI untuk transaksi keuangan.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/ai/review/observability">
              <Button variant="outline" size="sm">Observabilitas</Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Kasus Terbuka", value: stats.open, icon: FileSearch, color: "bg-indigo-100 text-indigo-600" },
            { label: "Risiko Tinggi", value: stats.highRisk, icon: AlertTriangle, color: "bg-red-100 text-red-600" },
            { label: "Terlambat", value: stats.overdue, icon: Clock, color: "bg-orange-100 text-orange-600" },
            { label: "Belum Ditugaskan", value: stats.unassigned, icon: Users, color: "bg-yellow-100 text-yellow-600" },
            { label: "Ditugaskan ke Saya", value: stats.assignedToMe, icon: UserCheck, color: "bg-blue-100 text-blue-600" },
            { label: "Jatuh Tempo Hari Ini", value: stats.dueToday, icon: CheckCircle2, color: "bg-green-100 text-green-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <div className={`rounded-full p-1.5 ${color}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-lg font-bold leading-none">{value}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Search */}
              <div className="flex-1 min-w-[160px]">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Cari (ID Transaksi)</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-8 h-8 text-sm"
                    placeholder="ID transaksi..."
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                  />
                </div>
              </div>

              {/* Status */}
              <div className="w-36">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                <Select value={status || "all"} onValueChange={v => { setStatus(v === "all" ? "" : v as AIReviewStatus); setPage(1); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Semua Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    {(Object.keys(STATUS_LABELS) as AIReviewStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Queue */}
              <div className="w-40">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Antrian</label>
                <Select value={queue || "all"} onValueChange={v => { setQueue(v === "all" ? "" : v as AIReviewQueue); setPage(1); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Semua Antrian" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Antrian</SelectItem>
                    {(Object.keys(QUEUE_LABELS) as AIReviewQueue[]).map(q => (
                      <SelectItem key={q} value={q}>{QUEUE_LABELS[q]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="w-32">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Prioritas</label>
                <Select value={priority || "all"} onValueChange={v => { setPriority(v === "all" ? "" : v as AIReviewPriority); setPage(1); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Semua" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    {(Object.keys(PRIORITY_LABELS) as AIReviewPriority[]).map(p => (
                      <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Risk Level */}
              <div className="w-32">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Risiko</label>
                <Select value={riskLevel || "all"} onValueChange={v => { setRiskLevel(v === "all" ? "" : v as AIRiskLevel); setPage(1); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Semua" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    {["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"].map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date From */}
              <div className="w-36">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  <Calendar className="inline h-3 w-3 mr-1" />Dari Tanggal
                </label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                />
              </div>

              {/* Date To */}
              <div className="w-36">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  <Calendar className="inline h-3 w-3 mr-1" />Sampai Tanggal
                </label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPage(1); }}
                />
              </div>

              {/* Reset */}
              <Button variant="ghost" size="sm" className="h-8 self-end" onClick={handleReset}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Daftar Kasus
              {pagination?.total != null && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({pagination.total} total)
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Per halaman:</span>
              <Select value={String(limit)} onValueChange={v => { setLimit(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map(s => (
                    <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Memuat kasus...</p>
              </div>
            ) : error ? (
              <div className="py-12 text-center">
                <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-3" />
                <p className="text-sm text-red-600">
                  {error instanceof Error ? error.message : "Gagal memuat data."}
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                  Coba Lagi
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center">
                <FileSearch className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Tidak ada kasus ditemukan.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {[
                        "ID Kasus", "Tgl Transaksi", "Sumber", "Deskripsi", "Counterparty",
                        "Jumlah", "Arah", "Intent", "COA", "Conf%",
                        "Anomali", "Antrian", "Prioritas", "Status",
                        "Reviewer", "SLA", "Dibuat",
                      ].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <QueueRow
                        key={item.id}
                        item={item}
                        onClick={() => navigate(`/ai/review/${item.id}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Halaman {pagination.page} dari {pagination.totalPages}
                  {" "}({pagination.total} kasus)
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                    const p = Math.max(1, Math.min(page - 2, pagination.totalPages - 4)) + i;
                    return (
                      <Button
                        key={p}
                        variant={p === page ? "default" : "outline"}
                        size="sm"
                        className="h-7 w-7 p-0 text-xs"
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </Button>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account masking note */}
        <p className="text-[11px] text-muted-foreground/60">
          * Nomor rekening disamarkan — hanya 4 digit terakhir yang ditampilkan untuk keamanan.
        </p>
      </div>
    </AppShell>
  );
}

// Re-export for use in tests
export { maskAccountNumber };
