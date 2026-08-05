import { DatePicker } from "@/components/ui/date-picker";
import { useState, useCallback } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, TrendingDown, ChevronDown, ChevronRight, Calendar, RotateCcw } from "lucide-react";

const idr = (n: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";
const fmtMonth = (d: string) => d ? new Date(d).toLocaleDateString("id-ID", { month: "long", year: "numeric" }) : "-";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

const METHOD_LABEL: Record<string, string> = {
  straight_line: "Garis Lurus",
  declining_balance: "Saldo Menurun",
};

export default function AssetDepreciationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const cq = activeCompanyId ? `?company=${activeCompanyId}` : "";

  const { data: assets = [], isLoading } = useQuery<any[]>({
    queryKey: ["fixed-assets", activeCompanyId],
    queryFn: () => apiFetch(`/api/fixed-assets${cq}`),
  });

  // Per-asset detail cache (includes depreciationRecords)
  const [details, setDetails] = useState<Record<number, any>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchDetail = useCallback(async (id: number) => {
    if (details[id]) return;
    const d = await apiFetch(`/api/fixed-assets/${id}`);
    setDetails((prev) => ({ ...prev, [id]: d }));
  }, [details]);

  const toggle = async (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      await fetchDetail(id);
    }
    setExpanded(next);
  };

  // Depreciate action
  const today = new Date().toISOString().slice(0, 10);
  const [depDate, setDepDate] = useState(today.slice(0, 7) + "-01");
  const [depNotes, setDepNotes] = useState("");
  const [depAssetId, setDepAssetId] = useState<number | null>(null);

  const deprMut = useMutation({
    mutationFn: ({ id, periodDate, notes }: { id: number; periodDate: string; notes: string }) =>
      apiFetch(`/api/fixed-assets/${id}/depreciate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodDate, notes }),
      }),
    onSuccess: (d: any, vars) => {
      toast({ title: `✓ Penyusutan ${idr(d.depreciationAmount)} berhasil dicatat.` });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      // refresh detail
      setDetails((prev) => {
        const copy = { ...prev };
        delete copy[vars.id];
        return copy;
      });
      fetchDetail(vars.id);
      setDepAssetId(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const activeAssets = assets.filter((a: any) => a.is_active);
  const totalCost = activeAssets.reduce((s: number, a: any) => s + Number(a.purchase_price), 0);
  const totalAccum = activeAssets.reduce((s: number, a: any) => s + Number(a.accumulated_depreciation), 0);
  const totalBook  = activeAssets.reduce((s: number, a: any) => s + Number(a.book_value), 0);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/expense">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Kembali"><ArrowLeft size={15} /></Button>
          </Link>
          <div className="flex items-center gap-2">
            <TrendingDown size={20} className="text-orange-400" />
            <div>
              <h1 className="text-xl font-bold">Penyusutan Aset Tetap</h1>
              <p className="text-sm text-muted-foreground">DR Beban Penyusutan · CR Akumulasi Depresiasi</p>
            </div>
          </div>
        </div>

        {/* Summary */}
        {!isLoading && activeAssets.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Harga Perolehan</p>
                <p className="text-xl font-bold">{idr(totalCost)}</p>
                <p className="text-xs text-muted-foreground mt-1">{activeAssets.length} aset aktif</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Akum. Depresiasi</p>
                <p className="text-xl font-bold text-orange-400">{idr(totalAccum)}</p>
                <p className="text-xs text-muted-foreground mt-1">{pct(totalAccum, totalCost)}% tersusutkan</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Nilai Buku</p>
                <p className="text-xl font-bold text-sky-400">{idr(totalBook)}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Asset list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-muted-foreground" size={24} />
          </div>
        ) : assets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <TrendingDown size={32} className="opacity-30" />
              <p className="text-sm">Belum ada aset tetap.</p>
              <Link href="/expense/fixed-assets">
                <Button variant="outline" size="sm">Buka Halaman Aset Tetap</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {assets.map((asset: any) => {
              const isOpen = expanded.has(asset.id);
              const detail = details[asset.id];
              const price = Number(asset.purchase_price);
              const accum = Number(asset.accumulated_depreciation);
              const book  = Number(asset.book_value);
              const salvage = Number(asset.salvage_value);
              const depPct = pct(accum, price - salvage);
              const isFullyDep = book <= salvage + 1;

              return (
                <Card key={asset.id} className={!asset.is_active ? "opacity-50" : ""}>
                  <Collapsible open={isOpen}>
                    <CollapsibleTrigger asChild>
                      <button
                        className="w-full text-left"
                        onClick={() => toggle(asset.id)}
                      >
                        <CardHeader className="pb-3 cursor-pointer hover:bg-muted/20 rounded-t-lg transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {isOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{asset.asset_name}</span>
                                  <Badge variant="outline" className="text-xs">{asset.asset_number}</Badge>
                                  {!asset.is_active && <Badge variant="outline" className="text-xs text-muted-foreground">Non-Aktif</Badge>}
                                  {isFullyDep && <Badge variant="outline" className="text-xs bg-emerald-900/30 text-emerald-300 border-emerald-600">Lunas Susut</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {asset.asset_type} · {METHOD_LABEL[asset.depreciation_method] ?? asset.depreciation_method} · {asset.useful_life_months} bln · Beli: {fmtDate(asset.purchase_date)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right space-y-1 mr-2">
                              <p className="text-sm font-mono text-sky-400">{idr(book)}</p>
                              <p className="text-xs text-muted-foreground">Nilai Buku</p>
                            </div>
                          </div>
                          <div className="px-6 pb-1">
                            <Progress value={depPct} className="h-1.5" />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                              <span>Akum: {idr(accum)}</span>
                              <span>{depPct}%</span>
                              <span>Perolehan: {idr(price)}</span>
                            </div>
                          </div>
                        </CardHeader>
                      </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <CardContent className="border-t pt-4 space-y-4">
                        {/* Depreciate action */}
                        {asset.is_active && !isFullyDep && (
                          <div className="bg-muted/20 rounded-lg p-4">
                            {depAssetId === asset.id ? (
                              <div className="space-y-3">
                                <p className="text-sm font-medium">Catat Penyusutan Periode</p>
                                <div className="flex gap-3 items-end">
                                  <div className="space-y-1.5 flex-1">
                                    <Label className="text-xs">Tanggal Periode</Label>
                                    <DatePicker value={depDate} onChange={(v) => setDepDate(v)} className="h-8 text-sm" />
                                  </div>
                                  <div className="space-y-1.5 flex-1">
                                    <Label className="text-xs">Catatan (opsional)</Label>
                                    <Input value={depNotes} onChange={(e) => setDepNotes(e.target.value)} placeholder="Periode penyusutan..." className="h-8 text-sm" />
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => deprMut.mutate({ id: asset.id, periodDate: depDate, notes: depNotes })}
                                    disabled={deprMut.isPending}
                                  >
                                    {deprMut.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : <RotateCcw size={13} className="mr-1" />}
                                    Proses
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => setDepAssetId(null)}>Batal</Button>
                                </div>
                              </div>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => setDepAssetId(asset.id)}>
                                <Calendar size={13} className="mr-1.5" /> Catat Penyusutan Bulan Ini
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Depreciation records */}
                        {!detail ? (
                          <div className="flex items-center gap-2 text-muted-foreground py-4">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="text-sm">Memuat riwayat penyusutan...</span>
                          </div>
                        ) : detail.depreciationRecords?.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">Belum ada riwayat penyusutan.</p>
                        ) : (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2 font-medium">Riwayat Penyusutan ({detail.depreciationRecords?.length} periode)</p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Periode</TableHead>
                                  <TableHead className="text-right">Penyusutan</TableHead>
                                  <TableHead className="text-right">Akum. Setelah</TableHead>
                                  <TableHead className="text-right">Nilai Buku</TableHead>
                                  <TableHead>Catatan</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detail.depreciationRecords?.map((r: any) => (
                                  <TableRow key={r.id}>
                                    <TableCell className="text-sm">{fmtMonth(r.period_date)}</TableCell>
                                    <TableCell className="text-right font-mono text-sm text-orange-400">{idr(r.depreciation_amount)}</TableCell>
                                    <TableCell className="text-right font-mono text-sm">{idr(r.accumulated_after)}</TableCell>
                                    <TableCell className="text-right font-mono text-sm text-sky-400">{idr(r.book_value_after)}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{r.notes ?? "—"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        )}

        {assets.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Untuk menambah aset baru, buka halaman{" "}
            <Link href="/expense/fixed-assets" className="text-primary underline">Aset Tetap</Link>.
          </p>
        )}
      </div>
    </AppShell>
  );
}
