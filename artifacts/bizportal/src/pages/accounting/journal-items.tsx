import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useListAccountingEntryLines, useListJournals, useListAccounts,
  getListAccountingEntryLinesQueryKey,
} from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, List, TrendingUp, TrendingDown, Printer, Download } from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  sales_invoice: "Faktur Jual",
  purchase_bill: "Tagihan Beli",
  sales_payment: "Bayar Masuk",
  purchase_payment: "Bayar Keluar",

  ecommerce_order: "E-Commerce",
  stock_received: "Stok Masuk",
  manual_payment: "Bayar Manual",
};

export default function JournalItemsPage() {
  const { activeCompanyId, isConsolidated } = useCompany();
  const [filter, setFilter] = useState<{
    journalId?: number;
    accountId?: number;
    from?: string;
    to?: string;
  }>({});

  const params = useMemo(() => ({
    ...(filter.journalId ? { journalId: filter.journalId } : {}),
    ...(filter.accountId ? { accountId: filter.accountId } : {}),
    ...(filter.from ? { from: new Date(filter.from).toISOString() } : {}),
    ...(filter.to ? { to: new Date(filter.to + "T23:59:59").toISOString() } : {}),
    company: (isConsolidated ? "all" : activeCompanyId) as unknown as number,
  }), [filter, activeCompanyId, isConsolidated]);

  const { data: lines, isLoading } = useListAccountingEntryLines(params, {
    query: { queryKey: getListAccountingEntryLinesQueryKey(params) },
  });
  const { data: journals } = useListJournals();
  const { data: accounts } = useListAccounts();

  const accLabel = (id: number) => {
    const a = accounts?.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : `#${id}`;
  };
  const journalLabel = (id: number) => {
    const j = journals?.find((x) => x.id === id);
    return j ? j.code : `#${id}`;
  };

  const totalDebit = (lines ?? []).reduce((s, l) => s + l.debit, 0);
  const totalCredit = (lines ?? []).reduce((s, l) => s + l.credit, 0);

  const rows = lines ?? [];
  const headers = ["No. Entry", "Tanggal", "Jurnal", "Sumber", "Referensi", "Akun", "Deskripsi Baris", "Debit", "Kredit"];
  const xlsxRows = () => rows.map((line) => [
    line.entryNumber,
    new Date(line.entryDate).toLocaleDateString("id-ID"),
    journalLabel(line.journalId),
    SOURCE_LABELS[line.entrySource] ?? line.entrySource,
    line.ref ?? "",
    accLabel(line.accountId),
    line.description ?? "",
    line.debit || "",
    line.credit || "",
  ]);

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/accounting/journals"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              <List className="h-6 w-6" />
              Jurnal Items
            </h1>
            <p className="text-sm text-muted-foreground">
              Daftar baris debit/kredit dari semua jurnal entry — terhubung ke entri induk
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => printWindow("Jurnal Items", headers, xlsxRows(), [7, 8])} disabled={rows.length === 0}>
              <Printer className="h-4 w-4 mr-1.5" />Print Preview
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportXlsx("Jurnal_Items", headers, xlsxRows())} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-1.5" />Export XLSX
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Baris</p>
              <p className="text-2xl font-bold">{rows.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <TrendingDown className="h-5 w-5 text-blue-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Total Debit</p>
                <p className="text-xl font-bold font-mono">{idr(totalDebit)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-emerald-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Total Kredit</p>
                <p className="text-xl font-bold font-mono">{idr(totalCredit)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div>
                <Label className="text-xs mb-1.5 block">Jurnal</Label>
                <Select
                  value={filter.journalId ? String(filter.journalId) : "all"}
                  onValueChange={(v) => setFilter({ ...filter, journalId: v === "all" ? undefined : parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Jurnal</SelectItem>
                    {(journals ?? []).map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>{j.code} — {j.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Akun</Label>
                <Select
                  value={filter.accountId ? String(filter.accountId) : "all"}
                  onValueChange={(v) => setFilter({ ...filter, accountId: v === "all" ? undefined : parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Akun</SelectItem>
                    {(accounts ?? []).filter((a) => a.isActive).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Dari</Label>
                <DatePicker
                  value={filter.from ?? ""}
                  onChange={(v) => setFilter({ ...filter, from: v || undefined })}
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Sampai</Label>
                <DatePicker
                  value={filter.to ?? ""}
                  onChange={(v) => setFilter({ ...filter, to: v || undefined })}
                />
              </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">No. Entry</TableHead>
                    <TableHead className="whitespace-nowrap">Tanggal</TableHead>
                    <TableHead className="whitespace-nowrap">Jurnal</TableHead>
                    <TableHead className="whitespace-nowrap">Sumber</TableHead>
                    <TableHead className="whitespace-nowrap">Referensi</TableHead>
                    <TableHead>Akun</TableHead>
                    <TableHead>Deskripsi Baris</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Debit</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Kredit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        Memuat data...
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        Tidak ada item jurnal
                      </TableCell>
                    </TableRow>
                  ) : rows.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link
                          href={`/accounting/entries/${line.entryId}`}
                          className="text-indigo-600 hover:underline font-mono text-xs font-semibold"
                        >
                          {line.entryNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(line.entryDate).toLocaleDateString("id-ID")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{journalLabel(line.journalId)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {SOURCE_LABELS[line.entrySource] ?? line.entrySource}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {line.ref ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {accLabel(line.accountId)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {line.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {line.debit > 0 ? (
                          <span className="text-blue-700 font-semibold">{idr(line.debit)}</span>
                        ) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {line.credit > 0 ? (
                          <span className="text-emerald-700 font-semibold">{idr(line.credit)}</span>
                        ) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length > 0 && (
                    <TableRow className="font-bold bg-muted/30 border-t-2">
                      <TableCell colSpan={7} className="text-right text-sm">Total</TableCell>
                      <TableCell className="text-right font-mono text-blue-700">{idr(totalDebit)}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-700">{idr(totalCredit)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {rows.length >= 1000 && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Menampilkan 1.000 baris pertama — gunakan filter untuk mempersempit hasil
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
