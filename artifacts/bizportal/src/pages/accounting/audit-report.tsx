import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, RefreshCw, CheckCircle2, XCircle, FileText, Download, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";

function formatRp(n: number) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

type MissingJournalItem = {
  id: number;
  doc_number?: string;
  order_number?: string;
  title?: string;
  customer_name?: string;
  supplier_name?: string;
  grand_total?: number;
  amount?: number;
  total_revenue?: number;
  status: string;
  invoice_status?: string;
  bill_status?: string;
  confirmed_at?: string;
  date?: string;
  company_id: number;
  module: string;
};

type UnbalancedEntry = {
  id: number;
  entry_number: string;
  date: string;
  source: string;
  source_id: number;
  description: string;
  company_id: number;
  total_debit: number;
  total_credit: number;
  selisih: number;
};

type AuditSummary = {
  unbalancedEntries: number;
  salesMissingJournals: number;
  purchaseMissingJournals: number;
  taxMissingNpwp: number;
  taxMissingFaktur: number;
};

const MODULE_OPTIONS = [
  { value: "all", label: "Semua Modul" },
  { value: "sales", label: "Penjualan" },
  { value: "purchase", label: "Pembelian" },
  { value: "expense", label: "Pengeluaran" },
  { value: "logistic", label: "Logistik" },
];

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`rounded-lg border p-4 ${count > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
      <div className={`text-2xl font-bold ${count > 0 ? "text-red-600" : "text-green-600"}`}>{count}</div>
      <div className={`text-sm mt-1 ${count > 0 ? "text-red-700" : "text-green-700"}`}>{label}</div>
    </div>
  );
}

function MissingJournalsTab({ companyId }: { companyId: number | undefined }) {
  const [module, setModule] = useState("all");

  const params = new URLSearchParams({ module, limit: "200" });
  if (companyId) params.set("companyId", String(companyId));

  const { data, isLoading, refetch } = useQuery<{ total: number; results: Record<string, MissingJournalItem[]> }>({
    queryKey: ["audit-missing-journals", companyId, module],
    queryFn: () => fetch(`/api/accounting/audit/missing-journals?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const allItems: MissingJournalItem[] = data?.results
    ? Object.values(data.results).flat()
    : [];

  function exportCsv() {
    const rows = [["ID", "Modul", "Nomor Dokumen", "Nama", "Jumlah", "Status", "Tanggal"]];
    for (const item of allItems) {
      rows.push([
        String(item.id),
        item.module,
        item.doc_number ?? item.order_number ?? item.title ?? "-",
        item.customer_name ?? item.supplier_name ?? "-",
        String(item.grand_total ?? item.amount ?? item.total_revenue ?? 0),
        item.status,
        item.confirmed_at ?? item.date ?? "-",
      ]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `missing-journals-${module}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={module} onValueChange={setModule}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODULE_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
        {allItems.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        )}
        <Badge variant={allItems.length > 0 ? "destructive" : "secondary"}>
          {isLoading ? "..." : allItems.length} dokumen tanpa jurnal
        </Badge>
      </div>

      {allItems.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center py-12 text-green-600 gap-2">
          <CheckCircle2 className="w-10 h-10" />
          <p className="font-medium">Semua transaksi sudah memiliki jurnal akuntansi</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Modul</TableHead>
                <TableHead>No. Dokumen</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal Konfirmasi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-400">Memuat data...</TableCell></TableRow>
              ) : allItems.map((item) => (
                <TableRow key={`${item.module}-${item.id}`} className="hover:bg-red-50">
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{item.module}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {item.doc_number ?? item.order_number ?? item.title ?? `#${item.id}`}
                  </TableCell>
                  <TableCell>{item.customer_name ?? item.supplier_name ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatRp(Number(item.grand_total ?? item.amount ?? item.total_revenue ?? 0))}
                  </TableCell>
                  <TableCell>
                    <Badge className="capitalize bg-orange-100 text-orange-700">{item.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {fmtDate(item.confirmed_at ?? item.date ?? null)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function UnbalancedEntriesTab({ companyId }: { companyId: number | undefined }) {
  const params = new URLSearchParams({ limit: "100" });
  if (companyId) params.set("companyId", String(companyId));

  const { data, isLoading, refetch } = useQuery<{ total: number; items: UnbalancedEntry[] }>({
    queryKey: ["audit-unbalanced", companyId],
    queryFn: () => fetch(`/api/accounting/audit/unbalanced-entries?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
        <Badge variant={items.length > 0 ? "destructive" : "secondary"}>
          {isLoading ? "..." : items.length} jurnal tidak balance
        </Badge>
      </div>

      {items.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center py-12 text-green-600 gap-2">
          <CheckCircle2 className="w-10 h-10" />
          <p className="font-medium">Semua jurnal seimbang (Debit = Kredit)</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>No. Jurnal</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-right">Total Debit</TableHead>
                <TableHead className="text-right">Total Kredit</TableHead>
                <TableHead className="text-right text-red-600">Selisih</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-400">Memuat data...</TableCell></TableRow>
              ) : items.map((item) => (
                <TableRow key={item.id} className="hover:bg-red-50">
                  <TableCell className="font-mono text-sm">{item.entry_number}</TableCell>
                  <TableCell className="text-sm">{fmtDate(item.date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-xs">{item.source}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600 max-w-48 truncate">{item.description ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium">{formatRp(Number(item.total_debit))}</TableCell>
                  <TableCell className="text-right font-medium">{formatRp(Number(item.total_credit))}</TableCell>
                  <TableCell className="text-right font-bold text-red-600">
                    {formatRp(Number(item.selisih))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: "missing", label: "Transaksi Tanpa Jurnal" },
  { key: "unbalanced", label: "Jurnal Tidak Balance" },
];

export default function AccountingAuditReportPage() {
  const { activeCompanyId } = useCompany();
  const [activeTab, setActiveTab] = useState("missing");

  const summaryParams = new URLSearchParams();
  if (activeCompanyId) summaryParams.set("companyId", String(activeCompanyId));

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<AuditSummary>({
    queryKey: ["audit-summary", activeCompanyId],
    queryFn: () => fetch(`/api/accounting/audit/summary?${summaryParams}`, { credentials: "include" }).then((r) => r.json()),
  });

  const totalIssues = summary
    ? summary.unbalancedEntries + summary.salesMissingJournals + summary.purchaseMissingJournals
    : 0;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-orange-500" />
              Audit Akuntansi
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Deteksi transaksi tanpa jurnal, jurnal tidak balance, dan anomali data
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchSummary()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh Semua
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <SummaryCard label="Jurnal Tidak Balance" count={summary?.unbalancedEntries ?? 0} color="red" />
          <SummaryCard label="SO Tanpa Jurnal" count={summary?.salesMissingJournals ?? 0} color="orange" />
          <SummaryCard label="PO Tanpa Jurnal" count={summary?.purchaseMissingJournals ?? 0} color="orange" />
          <SummaryCard label="Pajak Tanpa NPWP" count={summary?.taxMissingNpwp ?? 0} color="yellow" />
          <SummaryCard label="Pajak Tanpa Faktur" count={summary?.taxMissingFaktur ?? 0} color="yellow" />
        </div>

        {totalIssues === 0 && !summaryLoading && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="flex items-center gap-3 py-4">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <span className="text-green-700 font-medium">Tidak ada isu akuntansi yang terdeteksi</span>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="pt-6">
            {activeTab === "missing" && <MissingJournalsTab companyId={typeof activeCompanyId === "number" ? activeCompanyId : undefined} />}
            {activeTab === "unbalanced" && <UnbalancedEntriesTab companyId={typeof activeCompanyId === "number" ? activeCompanyId : undefined} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
