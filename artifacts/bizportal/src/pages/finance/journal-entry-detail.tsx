import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useRoute } from "wouter";
import { ArrowLeft, FileText, Calendar, Hash, User, AlertTriangle, CheckCircle2, Clock, Link2 } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n));

async function apiFetch<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
}

interface EntryLine {
  id: number;
  accountId: number;
  accountCode?: string;
  accountName?: string;
  description: string | null;
  debit: number;
  credit: number;
  costCenterId: number | null;
}

interface EntryDetail {
  id: number;
  entryNumber: string;
  date: string;
  ref: string | null;
  description: string | null;
  status: string;
  journalId: number;
  companyId: number | null;
  costCenterId: number | null;
  createdAt?: string;
  updatedAt?: string;
  postedAt?: string;
  createdBy?: string;
  totalDebit?: number;
  totalCredit?: number;
  lines: EntryLine[];
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    posted:    { label: "Posted",    variant: "default" },
    draft:     { label: "Draft",     variant: "secondary" },
    void:      { label: "Void",      variant: "destructive" },
    cancelled: { label: "Dibatalkan", variant: "destructive" },
  };
  const m = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="p-1.5 rounded-md bg-muted/50 shrink-0 mt-0.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function JournalEntryDetailPage() {
  const [, params] = useRoute("/finance/journal-entry/:id");
  const id = params?.id ? Number(params.id) : null;

  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    setLoading(true);
    apiFetch<EntryDetail>(`/api/accounting/entries/${id}`)
      .then(setEntry)
      .catch(() => setError("Jurnal tidak ditemukan"))
      .finally(() => setLoading(false));
  }, [id]);

  const lines = entry?.lines ?? [];
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("id-ID", {
    day: "2-digit", month: "long", year: "numeric"
  }) : "—";
  const fmtTs = (d?: string) => d ? new Date(d).toLocaleString("id-ID") : "—";

  return (
    <AppShell>
      <div className="space-y-5 p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8"
              onClick={() => window.history.back()}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Kembali
            </Button>
            <div className="w-px h-5 bg-border" />
            <div>
              <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                {loading ? "Memuat..." : entry?.entryNumber ?? `Journal Entry #${id}`}
              </h1>
              <p className="text-xs text-muted-foreground">
                {entry ? fmtDate(entry.date) : ""}
              </p>
            </div>
          </div>
          {entry && (
            <div className="flex items-center gap-2">
              <StatusBadge status={entry.status} />
              <Link href={`/accounting/entries/${entry.id}`}>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
                  <Link2 className="h-3.5 w-3.5" />
                  Buka di Akuntansi
                </Button>
              </Link>
            </div>
          )}
        </div>

        {loading && <div className="h-64 bg-muted/20 rounded-xl animate-pulse" />}
        {error && (
          <Card className="border-red-800/50 bg-red-950/40">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <p className="text-red-400">{error}</p>
            </CardContent>
          </Card>
        )}

        {entry && !loading && (
          <>
            {/* Meta Info */}
            <Card>
              <CardContent className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                  <InfoItem icon={Hash} label="No. Jurnal" value={entry.entryNumber} />
                  <InfoItem icon={Calendar} label="Tanggal" value={fmtDate(entry.date)} />
                  <InfoItem icon={FileText} label="Referensi" value={entry.ref ?? "—"} />
                  <InfoItem icon={FileText} label="Keterangan" value={entry.description ?? "—"} />
                </div>
                {entry.description && (
                  <div className="mt-4 p-3 bg-muted/30 rounded-md">
                    <p className="text-xs text-muted-foreground mb-1">Deskripsi</p>
                    <p className="text-sm text-foreground">{entry.description}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Balance Check */}
            <div className={`flex items-center gap-3 p-3 rounded-lg border ${isBalanced ? "bg-green-950/40 border-green-800/50" : "bg-red-950/40 border-red-800/50"}`}>
              {isBalanced
                ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                : <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />}
              <p className={`text-sm font-medium ${isBalanced ? "text-green-300" : "text-red-300"}`}>
                {isBalanced ? "Jurnal seimbang" : `Jurnal tidak seimbang! Selisih: Rp ${idr(Math.abs(totalDebit - totalCredit))}`}
              </p>
              <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                <span>Total Debit: <strong className="text-green-400">Rp {idr(totalDebit)}</strong></span>
                <span>Total Kredit: <strong className="text-red-400">Rp {idr(totalCredit)}</strong></span>
              </div>
            </div>

            {/* Entry Lines */}
            <Card>
              <CardHeader className="py-3 px-5">
                <CardTitle className="text-sm font-semibold">Baris Jurnal ({lines.length} baris)</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left px-5 py-2.5 font-medium">#</th>
                        <th className="text-left px-3 py-2.5 font-medium">Akun</th>
                        <th className="text-left px-3 py-2.5 font-medium">Deskripsi</th>
                        <th className="text-right px-3 py-2.5 font-medium">Debit</th>
                        <th className="text-right px-5 py-2.5 font-medium">Kredit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lines.map((line, i) => {
                        const txParams = new URLSearchParams({
                          accountId: String(line.accountId),
                          accountName: line.accountName ?? `Akun ${line.accountId}`,
                          accountCode: line.accountCode ?? "",
                          startDate: entry.date,
                          endDate: entry.date,
                          company: String(entry.companyId ?? 1),
                        });
                        return (
                          <tr key={line.id} className="hover:bg-white/5 transition-colors duration-150 group">
                            <td className="px-5 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-2.5">
                              <Link href={`/finance/transactions/detail?${txParams}`}>
                                <div className="flex items-center gap-1.5 group/acc cursor-pointer">
                                  {line.accountCode && (
                                    <span className="font-mono text-xs text-muted-foreground">{line.accountCode}</span>
                                  )}
                                  <span className="text-foreground group-hover/acc:text-blue-400 transition-colors">
                                    {line.accountName ?? `Account #${line.accountId}`}
                                  </span>
                                </div>
                              </Link>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground max-w-xs truncate text-xs">
                              {line.description ?? "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium text-green-400">
                              {Number(line.debit) > 0 ? `Rp ${idr(Number(line.debit))}` : "—"}
                            </td>
                            <td className="px-5 py-2.5 text-right font-medium text-red-400">
                              {Number(line.credit) > 0 ? `Rp ${idr(Number(line.credit))}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold text-sm border-t-2 border-border">
                      <tr>
                        <td colSpan={3} className="px-5 py-2.5 text-foreground">Total</td>
                        <td className="px-3 py-2.5 text-right text-green-400">Rp {idr(totalDebit)}</td>
                        <td className="px-5 py-2.5 text-right text-red-400">Rp {idr(totalCredit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Audit Trail */}
            <Card>
              <CardHeader className="py-3 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Audit Trail
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-foreground">Dibuat</p>
                      <p className="text-xs text-muted-foreground">{fmtTs(entry.createdAt)}</p>
                      {entry.createdBy && <p className="text-xs text-muted-foreground">oleh {entry.createdBy}</p>}
                    </div>
                  </div>
                  {entry.postedAt && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-foreground">Diposting</p>
                        <p className="text-xs text-muted-foreground">{fmtTs(entry.postedAt)}</p>
                      </div>
                    </div>
                  )}
                  {entry.updatedAt && entry.updatedAt !== entry.createdAt && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-foreground">Terakhir Diubah</p>
                        <p className="text-xs text-muted-foreground">{fmtTs(entry.updatedAt)}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${entry.status === "posted" ? "bg-green-500" : entry.status === "void" ? "bg-red-500" : "bg-amber-400"}`} />
                    <div>
                      <p className="text-xs font-medium text-foreground">Status Saat Ini</p>
                      <StatusBadge status={entry.status} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
