import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, FileSearch, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

type ReconRow = {
  id: number;
  transaction_date: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
  accounting_class: string | null;
  erp_category: string | null;
  status: string;
  journal_entry_id: number | null;
  import_batch_id: number | null;
  entry_number: string | null;
  je_debit: string | null;
  je_credit: string | null;
  je_date: string | null;
  filename: string | null;
};

function reconStatus(row: ReconRow): "MATCHED" | "UNMATCHED" | "PARTIAL" | "DRAFT" {
  if (row.journal_entry_id) {
    const bankAmt = Math.abs(Number(row.credit || 0) - Number(row.debit || 0));
    const jeAmt   = Math.abs(Number(row.je_debit || 0) - Number(row.je_credit || 0));
    if (Math.abs(bankAmt - jeAmt) < 1) return "MATCHED";
    return "PARTIAL";
  }
  if (row.status === "DRAFT") return "DRAFT";
  return "UNMATCHED";
}

function ReconBadge({ status }: { status: ReturnType<typeof reconStatus> }) {
  if (status === "MATCHED")
    return <Badge className="bg-green-100 text-green-700 border-green-200">MATCHED</Badge>;
  if (status === "PARTIAL")
    return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">PARTIAL</Badge>;
  if (status === "UNMATCHED")
    return <Badge className="bg-red-100 text-red-700 border-red-200">UNMATCHED</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">DRAFT</Badge>;
}

function fmt(val: string | null) {
  if (!val) return "–";
  const n = Number(val);
  if (isNaN(n) || n === 0) return "–";
  return n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(val: string | null) {
  if (!val) return "–";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function BankReconPage() {
  const today = new Date().toISOString().split("T")[0]!;
  const firstDay = today.slice(0, 7) + "-01";

  const [dateFrom, setDateFrom] = useState(firstDay);
  const [dateTo, setDateTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo)   params.set("date_to", dateTo);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(`/api/bank-mutation-import/recon?${params}`);
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const statuses = rows.map(reconStatus);
  const matched   = statuses.filter(s => s === "MATCHED").length;
  const partial   = statuses.filter(s => s === "PARTIAL").length;
  const unmatched = statuses.filter(s => s === "UNMATCHED").length;
  const draft     = statuses.filter(s => s === "DRAFT").length;

  const displayed = statusFilter === "ALL"
    ? rows
    : rows.filter(r => reconStatus(r) === statusFilter);

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Rekonsiliasi Bank</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mutasi bank yang diimport vs Jurnal ERP
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border px-4 py-3">
          <div className="text-xs text-muted-foreground mb-1">MATCHED</div>
          <div className="text-2xl font-bold text-green-600">{matched}</div>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <div className="text-xs text-muted-foreground mb-1">PARTIAL</div>
          <div className="text-2xl font-bold text-yellow-600">{partial}</div>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <div className="text-xs text-muted-foreground mb-1">UNMATCHED</div>
          <div className="text-2xl font-bold text-red-600">{unmatched}</div>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <div className="text-xs text-muted-foreground mb-1">DRAFT</div>
          <div className="text-2xl font-bold text-muted-foreground">{draft}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Dari Tanggal</label>
          <DatePicker value={dateFrom} onChange={v => setDateFrom(v)} className="h-8 w-36 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Sampai Tanggal</label>
          <DatePicker value={dateTo} onChange={v => setDateTo(v)} className="h-8 w-36 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua</SelectItem>
              <SelectItem value="MATCHED">MATCHED</SelectItem>
              <SelectItem value="PARTIAL">PARTIAL</SelectItem>
              <SelectItem value="UNMATCHED">UNMATCHED</SelectItem>
              <SelectItem value="DRAFT">DRAFT</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={loadData} disabled={loading} className="h-8 gap-1.5 text-sm">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Tampilkan
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-28">Tgl Mutasi</TableHead>
              <TableHead>Deskripsi</TableHead>
              <TableHead className="text-right w-32">Debit Bank</TableHead>
              <TableHead className="text-right w-32">Credit Bank</TableHead>
              <TableHead className="w-44">Accounting Class</TableHead>
              <TableHead className="w-28">Tgl Jurnal</TableHead>
              <TableHead className="w-36">No. Jurnal</TableHead>
              <TableHead className="text-right w-32">Jumlah JE</TableHead>
              <TableHead className="w-28 text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!loading && displayed.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-10">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileSearch className="h-8 w-8 opacity-40" />
                    <span className="text-sm">Tidak ada data rekonsiliasi</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && displayed.map(row => {
              const st = reconStatus(row);
              const isUnmatched = st === "UNMATCHED";
              const isPartial   = st === "PARTIAL";
              return (
                <TableRow
                  key={row.id}
                  className={
                    isUnmatched ? "bg-red-50 hover:bg-red-100"
                    : isPartial ? "bg-yellow-50 hover:bg-yellow-100"
                    : undefined
                  }
                >
                  <TableCell className="text-sm">{fmtDate(row.transaction_date)}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate" title={row.description ?? ""}>
                    {row.description ?? "–"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {Number(row.debit || 0) > 0 ? fmt(row.debit) : "–"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {Number(row.credit || 0) > 0 ? fmt(row.credit) : "–"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.accounting_class ?? "–"}
                  </TableCell>
                  <TableCell className="text-sm">{fmtDate(row.je_date)}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {row.entry_number ?? "–"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {row.je_debit && Number(row.je_debit) > 0
                      ? fmt(row.je_debit)
                      : row.je_credit && Number(row.je_credit) > 0
                      ? fmt(row.je_credit)
                      : "–"}
                  </TableCell>
                  <TableCell className="text-center">
                    <ReconBadge status={st} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
