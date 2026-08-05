import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Download, RefreshCw, CheckCircle, FileText, AlertCircle, Wifi, WifiOff, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const API = "/api/accounting";

function formatRp(n: number) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

const TX_TYPE_LABEL: Record<string, string> = {
  logistic_order: "Logistik",
  sales_order: "Penjualan",
  purchase_order: "Pembelian",
  expense: "Pengeluaran",
  other: "Lainnya",
};

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "destructive" },
  paid: { label: "Dibayar", variant: "default" },
  reported: { label: "Dilaporkan", variant: "secondary" },
};

interface TaxTx {
  id: number;
  transactionType: string;
  transactionRef: string | null;
  taxName: string;
  taxRate: number;
  cutType: string;
  baseAmount: number;
  taxAmount: number;
  status: string;
  period: string;
  createdAt: string;
}

interface ReportRow {
  period: string;
  taxName: string;
  taxRate: string;
  cutType: string;
  transactionType: string;
  status: string;
  count: number;
  totalBase: number;
  totalTax: number;
}

interface Summary {
  totalPPN: number;
  totalPPh: number;
  totalTax: number;
  pending: number;
  paid: number;
  reported: number;
}

function useTaxSse(period: string, companyId?: number) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function stopPolling() {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }

    function startFallbackPolling() {
      stopPolling();
      pollRef.current = setInterval(() => {
        qc.invalidateQueries({ queryKey: ["tax-report", period] });
        qc.invalidateQueries({ queryKey: ["tax-transactions", period] });
      }, 30_000);
    }

    function connect() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      const params = new URLSearchParams();
      if (companyId) params.set("companyId", String(companyId));
      const es = new EventSource(`${API}/tax-stream?${params}`, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        stopPolling();
      };

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "tax_update") {
            const affectsCurrent = !data.period || data.period === period;
            if (affectsCurrent) {
              qc.invalidateQueries({ queryKey: ["tax-report", period] });
              qc.invalidateQueries({ queryKey: ["tax-transactions", period] });
            }
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        startFallbackPolling();
        retryTimer = setTimeout(connect, 15_000);
      };
    }

    connect();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      stopPolling();
      setConnected(false);
    };
  }, [companyId, period, qc]);

  return connected;
}

export default function TaxReportPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod());
  const [tab, setTab] = useState<"summary" | "detail">("summary");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState("all");

  const periods = useMemo(() => generatePeriods(), []);

  const sseConnected = useTaxSse(period);

  const reportQuery = useQuery<{ rows: ReportRow[]; summary: Summary }>({
    queryKey: ["tax-report", period],
    queryFn: () =>
      fetch(`${API}/tax-report?period=${period}`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const txQuery = useQuery<{ data: TaxTx[]; total: number }>({
    queryKey: ["tax-transactions", period, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ period, limit: "200" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      return fetch(`${API}/tax-transactions?${params}`, { credentials: "include" }).then((r) => r.json());
    },
    enabled: tab === "detail",
    refetchInterval: tab === "detail" ? 30_000 : false,
    staleTime: 20_000,
  });

  const markMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: string }) =>
      fetch(`${API}/tax-transactions/bulk-mark`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast.success("Status diperbarui");
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["tax-transactions"] });
      qc.invalidateQueries({ queryKey: ["tax-report"] });
    },
    onError: () => toast.error("Gagal memperbarui status"),
  });

  function toggleId(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const rows = txQuery.data?.data ?? [];
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  }

  function handleExport() {
    window.open(`${API}/tax-report/export?period=${period}`, "_blank");
  }

  const summary = reportQuery.data?.summary;
  const reportRows = reportQuery.data?.rows ?? [];
  const txRows = txQuery.data?.data ?? [];
  const selArr = Array.from(selectedIds);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="text-2xl font-bold">Laporan Pajak / SPT</h1>
          <p className="text-muted-foreground text-sm">Otomasi pajak per transaksi — PPN & PPh</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {sseConnected ? (
              <><Wifi className="w-3.5 h-3.5 text-green-500" /> <span className="text-green-600">Live</span></>
            ) : (
              <><WifiOff className="w-3.5 h-3.5 text-orange-400" /> <span className="text-orange-500">Polling 30s</span></>
            )}
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["tax-report"] }); qc.invalidateQueries({ queryKey: ["tax-transactions"] }); }}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Total PPN", value: summary.totalPPN, color: "text-blue-600" },
            { label: "Total PPh", value: summary.totalPPh, color: "text-purple-600" },
            { label: "Total Pajak", value: summary.totalTax, color: "text-gray-900 font-bold" },
            { label: "Pending", value: summary.pending, color: "text-red-500" },
            { label: "Dibayar", value: summary.paid, color: "text-green-600" },
            { label: "Dilaporkan", value: summary.reported, color: "text-blue-500" },
          ].map((s) => (
            <Card key={s.label} className="border">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-sm font-semibold mt-1 ${s.color}`}>{formatRp(s.value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b pb-0">
        {(["summary", "detail"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "summary" ? "Ringkasan" : "Detail Transaksi"}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className="space-y-3">
          {reportQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {reportRows.length === 0 && !reportQuery.isLoading && (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>Tidak ada data pajak untuk periode {period}</p>
              <p className="text-xs mt-1">Data akan muncul otomatis saat transaksi selesai</p>
            </div>
          )}
          <div className="overflow-auto rounded-lg border">
            {reportRows.length > 0 && (
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {["Nama Pajak", "Jenis Transaksi", "Cara Potong", "Tarif", "Jumlah Tx", "DPP", "Pajak", "Status"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reportRows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{r.taxName}</td>
                      <td className="px-3 py-2">{TX_TYPE_LABEL[r.transactionType] ?? r.transactionType}</td>
                      <td className="px-3 py-2">
                        <Badge variant={r.cutType === "withholding" ? "destructive" : "secondary"} className="text-xs">
                          {r.cutType === "withholding" ? "Dipotong" : "Self-Borne"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{Number(r.taxRate).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-center">{r.count}</td>
                      <td className="px-3 py-2 text-right">{formatRp(Number(r.totalBase))}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatRp(Number(r.totalTax))}</td>
                      <td className="px-3 py-2">
                        <Badge variant={(STATUS_BADGE[r.status] ?? STATUS_BADGE.pending).variant} className="text-xs">
                          {(STATUS_BADGE[r.status] ?? STATUS_BADGE.pending).label}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 font-semibold">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                    <td className="px-3 py-2 text-center">{reportRows.reduce((a, r) => a + r.count, 0)}</td>
                    <td className="px-3 py-2 text-right">{formatRp(reportRows.reduce((a, r) => a + Number(r.totalBase), 0))}</td>
                    <td className="px-3 py-2 text-right">{formatRp(reportRows.reduce((a, r) => a + Number(r.totalTax), 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "detail" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Dibayar</SelectItem>
                <SelectItem value="reported">Dilaporkan</SelectItem>
              </SelectContent>
            </Select>
            {selArr.length > 0 && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  onClick={() => markMutation.mutate({ ids: selArr, status: "paid" })}>
                  <CheckCircle className="w-4 h-4 mr-1" /> Tandai Dibayar ({selArr.length})
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => markMutation.mutate({ ids: selArr, status: "reported" })}>
                  <FileText className="w-4 h-4 mr-1" /> Tandai Dilaporkan ({selArr.length})
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => markMutation.mutate({ ids: selArr, status: "pending" })}>
                  Reset ke Pending
                </Button>
              </div>
            )}
          </div>

          {txQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {txRows.length === 0 && !txQuery.isLoading && (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>Tidak ada transaksi pajak</p>
            </div>
          )}

          {txRows.length > 0 && (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2">
                      <Checkbox
                        checked={selectedIds.size === txRows.length && txRows.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    {["Referensi", "Jenis", "Pajak", "Cara Potong", "DPP", "Pajak", "Status", "Tanggal"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {txRows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleId(r.id)} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.transactionRef ?? `#${r.id}`}</td>
                      <td className="px-3 py-2">{TX_TYPE_LABEL[r.transactionType] ?? r.transactionType}</td>
                      <td className="px-3 py-2 text-xs">{r.taxName}</td>
                      <td className="px-3 py-2">
                        <Badge variant={r.cutType === "withholding" ? "destructive" : "secondary"} className="text-xs">
                          {r.cutType === "withholding" ? "Dipotong" : "Self-Borne"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">{formatRp(r.baseAmount)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatRp(r.taxAmount)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={(STATUS_BADGE[r.status] ?? STATUS_BADGE.pending).variant} className="text-xs">
                          {(STATUS_BADGE[r.status] ?? STATUS_BADGE.pending).label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.createdAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 font-semibold">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right">Total</td>
                    <td className="px-3 py-2 text-right">{formatRp(txRows.reduce((a, r) => a + r.baseAmount, 0))}</td>
                    <td className="px-3 py-2 text-right">{formatRp(txRows.reduce((a, r) => a + r.taxAmount, 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
