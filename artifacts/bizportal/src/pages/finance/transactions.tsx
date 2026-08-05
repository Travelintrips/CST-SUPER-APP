import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Link, useLocation } from "wouter";
import { ArrowLeft, FileText, ChevronRight, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker } from "@/components/ui/date-picker";

const idrShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${new Intl.NumberFormat("id-ID").format(abs)}`;
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

interface Entry {
  id: number;
  number: string;
  date: string;
  description: string;
  status: "draft" | "posted" | "void";
  totalDebit: number;
  totalCredit: number;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  posted: "bg-emerald-500/15 text-emerald-400 border-emerald-700/30",
  draft:  "bg-amber-500/15 text-amber-400 border-amber-700/30",
  void:   "bg-zinc-700/30 text-zinc-400 border-zinc-600/30",
};

const PAGE_SIZE = 25;

export default function FinanceTransactionsPage() {
  const { activeCompanyId, isConsolidated } = useCompany();
  const [, navigate] = useLocation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [rev, setRev] = useState(0);

  const qp = useMemo(() => {
    const p = new URLSearchParams();
    if (!isConsolidated && activeCompanyId) p.set("company", String(activeCompanyId));
    if (from) p.set("from", new Date(from).toISOString());
    if (to) p.set("to", new Date(to + "T23:59:59").toISOString());
    if (status !== "all") p.set("status", status);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String((page - 1) * PAGE_SIZE));
    return p.toString();
  }, [activeCompanyId, isConsolidated, from, to, status, page]);

  const { data: entries, isLoading } = useQuery<Entry[]>({
    queryKey: ["finance-tx", qp, rev],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/entries?${qp}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const rows = entries ?? [];
  const hasMore = rows.length === PAGE_SIZE;

  return (
    <AppShell>
      <div className="space-y-5 p-6 max-w-6xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/finance/cfo-overview">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Transaksi Keuangan
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">Semua jurnal entry akuntansi</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRev((x) => x + 1)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[130px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Dari</Label>
              <DatePicker value={from} onChange={(v) => { setFrom(v); setPage(1); }} />
            </div>
            <div className="flex-1 min-w-[130px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Sampai</Label>
              <DatePicker value={to} onChange={(v) => { setTo(v); setPage(1); }} />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs text-muted-foreground border-b border-white/8">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">No. Jurnal</th>
                  <th className="text-left px-3 py-3 font-medium">Tanggal</th>
                  <th className="text-left px-3 py-3 font-medium">Keterangan</th>
                  <th className="text-right px-3 py-3 font-medium">Debit</th>
                  <th className="text-center px-3 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-5 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                      <td />
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center text-muted-foreground text-sm">
                      Tidak ada jurnal ditemukan
                    </td>
                  </tr>
                ) : (
                  rows.map((e) => (
                    <tr
                      key={e.id}
                      className="hover:bg-white/5 transition-colors duration-150 cursor-pointer group"
                      onClick={() => navigate(`/finance/journal-entry/${e.id}`)}
                    >
                      <td className="px-5 py-3 font-mono text-xs text-primary">{e.number}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(e.date)}
                      </td>
                      <td className="px-3 py-3 max-w-xs">
                        <span className="truncate block" title={e.description}>
                          {e.description || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-medium">
                        {idrShort(e.totalDebit ?? 0)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${STATUS_STYLE[e.status] ?? ""}`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {(page > 1 || hasMore) && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline" size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Sebelumnya
            </Button>
            <span className="text-xs text-muted-foreground">Halaman {page}</span>
            <Button
              variant="outline" size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
            >
              Berikutnya
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
