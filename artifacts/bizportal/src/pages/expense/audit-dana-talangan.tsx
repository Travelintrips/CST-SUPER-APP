import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Tipe Masalah ──────────────────────────────────────────────────────────────
const MASALAH_ORDER = [
  "OK",
  "Transaksi belum memiliki COA",
  "Sumber Dana kosong",
  "Sumber Dana tidak ditemukan",
  "Master Sumber Dana belum memiliki COA",
  "COA transaksi berbeda dengan Master",
  "COA tidak ditemukan",
] as const;

type Masalah = (typeof MASALAH_ORDER)[number];

const MASALAH_META: Record<Masalah, { label: string; color: string; bg: string }> = {
  "OK": { label: "OK", color: "text-emerald-400", bg: "bg-emerald-400/10" },
  "Transaksi belum memiliki COA": { label: "Belum punya COA", color: "text-red-400", bg: "bg-red-400/10" },
  "Sumber Dana kosong": { label: "Sumber Dana kosong", color: "text-red-400", bg: "bg-red-400/10" },
  "Sumber Dana tidak ditemukan": { label: "Sumber Dana hilang", color: "text-orange-400", bg: "bg-orange-400/10" },
  "Master Sumber Dana belum memiliki COA": { label: "Mapping COA kosong", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  "COA transaksi berbeda dengan Master": { label: "COA berbeda", color: "text-orange-400", bg: "bg-orange-400/10" },
  "COA tidak ditemukan": { label: "COA hilang", color: "text-red-400", bg: "bg-red-400/10" },
};

function masalahBadge(m: string) {
  const meta = MASALAH_META[m as Masalah];
  if (!meta) return <Badge variant="outline">{m}</Badge>;
  if (m === "OK") return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", meta.bg, meta.color)}>
      <CheckCircle2 size={11} /> OK
    </span>
  );
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", meta.bg, meta.color)}>
      <AlertTriangle size={11} /> {meta.label}
    </span>
  );
}

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

export default function AuditDanaTalanganPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const cq = activeCompanyId ? `company=${activeCompanyId}` : "";

  const [filterMasalah, setFilterMasalah] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const queryStr = useMemo(() => {
    const p = new URLSearchParams();
    if (cq) p.set("company", String(activeCompanyId));
    if (filterMasalah !== "all") p.set("masalah", filterMasalah);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", "300");
    return p.toString();
  }, [activeCompanyId, filterMasalah, from, to]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["audit-dana-talangan", queryStr],
    queryFn: () => apiFetch(`/api/audit/dana-talangan?${queryStr}`),
    staleTime: 60_000,
  });

  const summary: { masalah: string; jumlah: string }[] = data?.summary ?? [];
  const rows: any[] = data?.rows ?? [];
  const total: number = data?.total ?? 0;

  const totalMasalah = summary.filter((s) => s.masalah !== "OK").reduce((a, s) => a + Number(s.jumlah), 0);
  const totalOk = summary.find((s) => s.masalah === "OK")?.jumlah ?? 0;

  // ── Fix Bulk ─────────────────────────────────────────────────────────────────
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);

  const dryRunMut = useMutation({
    mutationFn: () => apiFetch("/api/audit/dana-talangan/fix-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: activeCompanyId, dryRun: true }),
    }),
    onSuccess: (d) => setDryRunResult(d),
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const fixMut = useMutation({
    mutationFn: () => apiFetch("/api/audit/dana-talangan/fix-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: activeCompanyId, dryRun: false }),
    }),
    onSuccess: (d) => {
      toast({ title: `✓ ${d.fixed} transaksi berhasil diperbaiki.` });
      setDryRunResult(null);
      qc.invalidateQueries({ queryKey: ["audit-dana-talangan"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/expense/talangan">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2">
              <ShieldAlert size={20} className="text-amber-400" />
              <div>
                <h1 className="text-xl font-bold">Audit COA Dana Talangan</h1>
                <p className="text-sm text-muted-foreground">View: <code className="text-xs font-mono bg-muted px-1 rounded">audit_dana_talangan_coa</code></p>
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={13} className={cn("mr-1", isLoading && "animate-spin")} /> Refresh
          </Button>
        </div>

        {/* Ringkasan kartu */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-emerald-950/30 border-emerald-800/40">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Transaksi OK</p>
              <p className="text-2xl font-bold text-emerald-400">{totalOk}</p>
            </CardContent>
          </Card>
          <Card className="bg-red-950/30 border-red-800/40">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Bermasalah</p>
              <p className="text-2xl font-bold text-red-400">{totalMasalah}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Transaksi</p>
              <p className="text-2xl font-bold">{total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Ditampilkan</p>
              <p className="text-2xl font-bold">{rows.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabel Ringkasan Masalah */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ringkasan per Jenis Masalah</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Masalah</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead className="text-right w-24">Filter</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.length === 0 && isLoading && (
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Memuat...</TableCell></TableRow>
                )}
                {summary.map((s) => (
                  <TableRow key={s.masalah} className={cn(s.masalah !== "OK" && Number(s.jumlah) > 0 && "bg-red-950/10")}>
                    <TableCell>{masalahBadge(s.masalah)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{Number(s.jumlah).toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost" size="sm" className="h-6 text-xs"
                        onClick={() => setFilterMasalah(filterMasalah === s.masalah ? "all" : s.masalah)}
                      >
                        {filterMasalah === s.masalah ? "× Hapus" : "Filter"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Panel Perbaikan Massal */}
        <Card className="border-amber-800/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench size={14} className="text-amber-400" /> Perbaikan Massal Otomatis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Memperbaiki transaksi dengan masalah <strong>"COA transaksi berbeda dengan Master"</strong> dan <strong>"Transaksi belum memiliki COA"</strong> yang <strong>belum punya jurnal</strong> (entry_id kosong).
              Transaksi yang sudah punya jurnal harus diperbaiki manual via Void + Re-post.
            </p>

            {dryRunResult && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium">Hasil Dry Run</p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Bisa diperbaiki</p>
                    <p className="text-xl font-bold text-amber-400">{dryRunResult.fixable}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">COA berbeda</p>
                    <p className="text-xl font-bold">{dryRunResult.breakdown?.coaBerbeda ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">COA null</p>
                    <p className="text-xl font-bold">{dryRunResult.breakdown?.coaNull ?? 0}</p>
                  </div>
                </div>
                {dryRunResult.preview?.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">No. Talangan</TableHead>
                          <TableHead className="text-xs">COA Lama</TableHead>
                          <TableHead className="text-xs">COA Baru</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dryRunResult.preview.map((r: any) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs font-mono">{r.advance_number}</TableCell>
                            <TableCell className="text-xs text-red-400">{r.coa_lama ?? "(null)"}</TableCell>
                            <TableCell className="text-xs text-emerald-400">{r.coa_baru_code} — {r.coa_baru_name}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => dryRunMut.mutate()} disabled={dryRunMut.isPending}>
                {dryRunMut.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
                Cek Dry Run
              </Button>
              {dryRunResult && dryRunResult.fixable > 0 && (
                <Button size="sm" className="bg-amber-600 hover:bg-amber-500" onClick={() => fixMut.mutate()} disabled={fixMut.isPending}>
                  {fixMut.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Wrench size={13} className="mr-1" />}
                  Eksekusi Perbaikan ({dryRunResult.fixable})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Filter detail */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterMasalah} onValueChange={setFilterMasalah}>
            <SelectTrigger className="h-8 text-sm w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Masalah</SelectItem>
              {MASALAH_ORDER.map((m) => <SelectItem key={m} value={m}>{MASALAH_META[m].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm" />
          <span className="text-muted-foreground text-xs">s/d</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm" />
          {(filterMasalah !== "all" || from || to) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs"
              onClick={() => { setFilterMasalah("all"); setFrom(""); setTo(""); }}>
              × Reset Filter
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{rows.length} baris ditampilkan</span>
        </div>

        {/* Tabel Detail */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Talangan</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Sumber Dana</TableHead>
                    <TableHead>COA Transaksi</TableHead>
                    <TableHead>COA Master (1-1033)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Masalah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Memuat data...</TableCell></TableRow>
                  )}
                  {!isLoading && rows.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Tidak ada data.</TableCell></TableRow>
                  )}
                  {rows.map((row) => (
                    <TableRow key={row.id} className={cn(row.masalah !== "OK" && "bg-red-950/5")}>
                      <TableCell className="font-mono text-xs text-primary whitespace-nowrap">{row.no_talangan}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{row.tanggal}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate" title={row.sumber_dana ?? "-"}>
                        {row.sumber_dana ?? <span className="text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.coa_transaksi_code
                          ? <span className="font-mono">{row.coa_transaksi_code}</span>
                          : row.coa_id_transaksi
                            ? <span className="text-red-400 font-mono">id:{row.coa_id_transaksi} (hilang)</span>
                            : <span className="text-muted-foreground italic">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.coa_master_code
                          ? <span className="font-mono text-muted-foreground">{row.coa_master_code}</span>
                          : <span className="text-muted-foreground italic">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.status}</Badge>
                      </TableCell>
                      <TableCell>{masalahBadge(row.masalah)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* SQL View info */}
        <div className="rounded-md border bg-muted/20 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Query Ringkasan SQL</p>
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">{`SELECT masalah, COUNT(*) AS jumlah
FROM audit_dana_talangan_coa
GROUP BY masalah
ORDER BY
  CASE masalah
    WHEN 'OK'                                   THEN 0
    WHEN 'Transaksi belum memiliki COA'          THEN 1
    WHEN 'Sumber Dana kosong'                    THEN 2
    WHEN 'Sumber Dana tidak ditemukan'           THEN 3
    WHEN 'Master Sumber Dana belum memiliki COA' THEN 4
    WHEN 'COA transaksi berbeda dengan Master'   THEN 5
    WHEN 'COA tidak ditemukan'                   THEN 6
  END;`}</pre>
        </div>
      </div>
    </AppShell>
  );
}
