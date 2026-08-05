import { useState, useCallback } from "react";
import { Link } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Loader2, Package, TrendingDown, Trash2, ChevronsRight, AlertCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtIDR = (raw: string) => { const d = raw.replace(/\D/g, ""); return d ? Number(d).toLocaleString("id-ID") : ""; };
const parseIDR = (v: string) => { const n = Number(v.replace(/\D/g, "")); return isNaN(n) ? 0 : n; };

const ASSET_TYPES: Record<string, string> = {
  equipment: "Peralatan", vehicle: "Kendaraan", building: "Bangunan", land: "Tanah", other: "Lainnya",
};
const DEPR_LABELS: Record<string, string> = {
  straight_line: "Garis Lurus", declining_balance: "Saldo Menurun",
};

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

export default function FixedAssetsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const cq = activeCompanyId ? `?company=${activeCompanyId}` : "";

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["fixed-assets", activeCompanyId],
    queryFn: () => apiFetch(`/api/fixed-assets${activeCompanyId ? `?company=${activeCompanyId}` : ""}`),
  });

  const [selected, setSelected] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const fetchDetail = useCallback(async (id: number) => {
    setDetail(await apiFetch(`/api/fixed-assets/${id}`));
  }, []);
  const openDetail = async (row: any) => { setSelected(row); await fetchDetail(row.id); };

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7) + "-01";

  // Fetch akun Kas/Bank dari COA untuk dropdown sumber pembayaran
  const { data: paymentAccounts = [] } = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: ["fixed-assets-payment-accounts", activeCompanyId],
    queryFn: () => apiFetch(`/api/fixed-assets/payment-accounts${cq}`),
  });

  const [showForm, setShowForm] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetType, setAssetType] = useState("equipment");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [priceRaw, setPriceRaw] = useState("");
  const [usefulLife, setUsefulLife] = useState("60");
  const [salvageRaw, setSalvageRaw] = useState("");
  const [deprMethod, setDeprMethod] = useState("straight_line");
  const [pm, setPm] = useState("bank");
  const [paymentAccountId, setPaymentAccountId] = useState<string>("");
  const [taxRelated, setTaxRelated] = useState(false);
  const [notes, setNotes] = useState("");

  // Filter state
  const [filterSearch, setFilterSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterMethod, setFilterMethod] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const hasFilter = filterSearch !== "" || filterType !== "all" || filterMethod !== "all" || filterStatus !== "all";
  const resetFilters = () => { setFilterSearch(""); setFilterType("all"); setFilterMethod("all"); setFilterStatus("all"); };

  const filtered = (list as any[]).filter((r) => {
    if (filterSearch && !r.asset_name?.toLowerCase().includes(filterSearch.toLowerCase()) && !r.asset_number?.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    if (filterType !== "all" && r.asset_type !== filterType) return false;
    if (filterMethod !== "all" && r.depreciation_method !== filterMethod) return false;
    if (filterStatus === "active" && !r.is_active) return false;
    if (filterStatus === "inactive" && r.is_active) return false;
    return true;
  });

  // Set default paymentAccountId ke akun pertama saat data tersedia
  const selectedPaymentAccount = paymentAccounts.find((a) => String(a.id) === paymentAccountId);

  const createMut = useMutation({
    mutationFn: (body: object) => apiFetch(`/api/fixed-assets${cq}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: (d) => {
      toast({ title: `✓ ${d.asset_number} — ${d.asset_name} berhasil dicatat.` });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      setShowForm(false); setAssetName(""); setPriceRaw(""); setSalvageRaw(""); setNotes(""); setPurchaseDate(today); setPaymentAccountId("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    const price = parseIDR(priceRaw);
    if (!assetName.trim()) { toast({ title: "Nama aset wajib diisi.", variant: "destructive" }); return; }
    if (price <= 0) { toast({ title: "Harga beli harus lebih dari 0.", variant: "destructive" }); return; }
    if (!paymentAccountId) { toast({ title: "Pilih sumber pembayaran.", variant: "destructive" }); return; }
    createMut.mutate({
      assetName, assetType, purchaseDate, purchasePrice: price,
      usefulLifeMonths: parseInt(usefulLife) || 60,
      salvageValue: parseIDR(salvageRaw), depreciationMethod: deprMethod,
      paymentMethod: pm, paymentAccountId: parseInt(paymentAccountId), taxRelated, notes,
    });
  };

  // ── Depreciate ────────────────────────────────────────────────────────────
  const [deprPeriod, setDeprPeriod] = useState(thisMonth);

  const deprMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/api/fixed-assets/${id}/depreciate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: async (d) => {
      toast({ title: `✓ Penyusutan ${idr(d.depreciationAmount)} periode ${deprPeriod.slice(0, 7)} dicatat.` });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      setSelected(d.asset); await fetchDetail(d.asset.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/fixed-assets/${id}/deactivate`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: "Aset dinonaktifkan." });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      setSelected(null); setDetail(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/fixed-assets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Aset dihapus." });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      setSelected(null); setDetail(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const totalBookValue = (list as any[]).filter((r) => r.is_active)
    .reduce((s, r) => s + parseFloat(r.book_value ?? 0), 0);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2">
              <Package size={20} className="text-teal-400" />
              <div>
                <h1 className="text-xl font-bold">Aset Tetap & Penyusutan</h1>
                <p className="text-sm text-muted-foreground">DR Aset Tetap · CR Kas/Bank (perolehan)</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {totalBookValue > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total Nilai Buku</p>
                <p className="font-mono text-teal-400 font-semibold">{idr(totalBookValue)}</p>
              </div>
            )}
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus size={14} className="mr-1" /> Tambah Aset
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        {!showForm && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari nama/no. aset..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                {Object.entries(ASSET_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterMethod} onValueChange={setFilterMethod}>
              <SelectTrigger className="h-8 text-sm w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Metode</SelectItem>
                <SelectItem value="straight_line">Garis Lurus</SelectItem>
                <SelectItem value="declining_balance">Saldo Menurun</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-sm w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
            {hasFilter && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground" onClick={resetFilters}>
                <X size={12} /> Reset
              </Button>
            )}
            {!isLoading && (
              <span className="text-xs text-muted-foreground ml-auto">
                {filtered.length} dari {list.length} aset
              </span>
            )}
          </div>
        )}

        {showForm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">Form Aset Tetap Baru</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                  <Label>Nama Aset <span className="text-destructive">*</span></Label>
                  <Input placeholder="Contoh: Toyota Avanza 2024..." value={assetName} onChange={(e) => setAssetName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Jenis Aset</Label>
                  <Select value={assetType} onValueChange={setAssetType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ASSET_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Harga Beli (IDR) <span className="text-destructive">*</span></Label>
                  <Input placeholder="0" className="font-mono" value={priceRaw} onChange={(e) => setPriceRaw(fmtIDR(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Nilai Residu (IDR)</Label>
                  <Input placeholder="0" className="font-mono" value={salvageRaw} onChange={(e) => setSalvageRaw(fmtIDR(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tanggal Beli</Label>
                  <DatePicker value={purchaseDate} onChange={(v) => setPurchaseDate(v)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Masa Manfaat (bulan)</Label>
                  <Input type="number" placeholder="60" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Metode Penyusutan</Label>
                  <Select value={deprMethod} onValueChange={setDeprMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Garis Lurus</SelectItem>
                      <SelectItem value="declining_balance">Saldo Menurun</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Sumber Pembayaran</Label>
                  <Select value={paymentAccountId} onValueChange={(v) => {
                    setPaymentAccountId(v);
                    const acc = paymentAccounts.find((a) => String(a.id) === v);
                    if (acc) setPm(acc.code.startsWith("1-1010") ? "cash" : "bank");
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder={paymentAccounts.length === 0 ? "Memuat akun..." : "Pilih akun Kas/Bank"} />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{acc.code}</span>
                          {acc.name}
                        </SelectItem>
                      ))}
                      {paymentAccounts.length === 0 && (
                        <SelectItem value="__none" disabled>Tidak ada akun Kas/Bank di COA</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="taxRel" checked={taxRelated} onChange={(e) => setTaxRelated(e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="taxRel" className="font-normal">Aset terkait pajak (SPT)</Label>
                <Input className="flex-1 h-8 text-sm" placeholder="Keterangan (opsional)..." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {parseIDR(priceRaw) > 0 && (
                <div className="space-y-1.5">
                  <div className="rounded-md bg-muted/40 border px-4 py-2 text-xs text-muted-foreground">
                    Jurnal: <strong>DR Aset Tetap</strong> {idr(parseIDR(priceRaw))} · <strong>CR {selectedPaymentAccount ? `${selectedPaymentAccount.code} — ${selectedPaymentAccount.name}` : (pm === "cash" ? "Kas" : "Bank")}</strong> {idr(parseIDR(priceRaw))}
                  </div>
                  {parseInt(usefulLife) > 0 && (
                    <div className="rounded-md bg-muted/40 border px-4 py-2 text-xs text-muted-foreground">
                      Estimasi penyusutan/bulan (GL): <strong>{idr(Math.round((parseIDR(priceRaw) - parseIDR(salvageRaw)) / parseInt(usefulLife)))}</strong>
                      {" "}({DEPR_LABELS[deprMethod]}, {usefulLife} bulan)
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={createMut.isPending}>
                  {createMut.isPending ? <><Loader2 size={14} className="mr-1 animate-spin" />Menyimpan...</> : "Simpan Aset"}
                </Button>
                <Button variant="ghost" onClick={() => setShowForm(false)}>Batal</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Aset</TableHead>
                  <TableHead>Nama Aset</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead className="text-right">Harga Beli</TableHead>
                  <TableHead className="text-right">Akm. Depr.</TableHead>
                  <TableHead className="text-right">Nilai Buku</TableHead>
                  <TableHead>Depr.</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Memuat...</TableCell></TableRow>}
                {!isLoading && list.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Belum ada aset tetap.</TableCell></TableRow>}
                {!isLoading && list.length > 0 && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Tidak ada aset yang cocok dengan filter.</TableCell></TableRow>
                )}
                {filtered.map((row) => {
                  const deprPct = parseFloat(row.purchase_price) > 0
                    ? (parseFloat(row.accumulated_depreciation) / parseFloat(row.purchase_price)) * 100 : 0;
                  return (
                    <TableRow key={row.id} className={cn("cursor-pointer hover:bg-muted/50", !row.is_active && "opacity-50")} onClick={() => openDetail(row)}>
                      <TableCell className="font-mono text-xs text-primary">{row.asset_number}</TableCell>
                      <TableCell className="text-sm font-medium">{row.asset_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{ASSET_TYPES[row.asset_type] ?? row.asset_type}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{DEPR_LABELS[row.depreciation_method] ?? row.depreciation_method}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{idr(row.purchase_price)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-orange-400">{idr(row.accumulated_depreciation)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-teal-400">{idr(row.book_value)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 min-w-[80px]">
                          <Progress value={Math.min(100, deprPct)} className="h-1.5 flex-1" />
                          <span className="text-[10px] text-muted-foreground">{Math.round(deprPct)}%</span>
                        </div>
                      </TableCell>
                      <TableCell><ChevronsRight size={14} className="text-muted-foreground" /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setDetail(null); } }}>
        <SheetContent className="w-[440px] sm:w-[540px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.asset_number}</SheetTitle>
                <SheetDescription>{selected.asset_name} · {ASSET_TYPES[selected.asset_type]}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Harga Beli</span>
                    <span className="font-mono font-semibold">{idr(selected.purchase_price)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Akm. Penyusutan</span>
                    <span className="font-mono text-orange-400">{idr(selected.accumulated_depreciation)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold">
                    <span>Nilai Buku</span>
                    <span className="font-mono text-teal-400">{idr(selected.book_value)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 text-xs text-muted-foreground">
                    <div>Metode: {DEPR_LABELS[selected.depreciation_method]}</div>
                    <div>Masa Manfaat: {selected.useful_life_months} bln</div>
                    <div>Nilai Residu: {idr(selected.salvage_value)}</div>
                    <div>Tgl Beli: {selected.purchase_date}</div>
                  </div>
                  {!selected.is_active && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                      <AlertCircle size={12} /> Aset nonaktif
                    </div>
                  )}
                </div>

                {/* Depreciation records */}
                <div>
                  <p className="text-sm font-medium mb-2">Riwayat Penyusutan</p>
                  {!detail?.depreciationRecords?.length ? (
                    <p className="text-xs text-muted-foreground">Belum ada penyusutan.</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {detail.depreciationRecords.map((r: any) => (
                        <div key={r.id} className="flex justify-between items-center rounded border px-3 py-2 text-xs">
                          <div className="text-muted-foreground">{r.period_date?.slice(0, 7)}</div>
                          <div className="text-right">
                            <div className="font-mono text-orange-400">{idr(r.depreciation_amount)}</div>
                            <div className="text-muted-foreground text-[10px]">Buku: {idr(r.book_value_after)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Run depreciation */}
                {selected.is_active && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2"><TrendingDown size={14} className="text-primary" />Jalankan Penyusutan</p>
                    <div className="flex gap-3 items-end">
                      <div className="flex-1 space-y-1.5">
                        <Label className="text-xs">Periode</Label>
                        <div className="flex gap-1.5">
                          <Select
                            value={deprPeriod ? deprPeriod.slice(5, 7) : ""}
                            onValueChange={(m) => {
                              const y = deprPeriod ? deprPeriod.slice(0, 4) : String(new Date().getFullYear());
                              setDeprPeriod(`${y}-${m}-01`);
                            }}
                          >
                            <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Bulan" /></SelectTrigger>
                            <SelectContent>
                              {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m, i) => (
                                <SelectItem key={m} value={m}>{["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][i]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={deprPeriod ? deprPeriod.slice(0, 4) : ""}
                            onValueChange={(y) => {
                              const m = deprPeriod ? deprPeriod.slice(5, 7) : "01";
                              setDeprPeriod(`${y}-${m}-01`);
                            }}
                          >
                            <SelectTrigger className="h-8 text-sm w-[80px]"><SelectValue placeholder="Tahun" /></SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 8 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map((y) => (
                                <SelectItem key={y} value={y}>{y}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => deprMut.mutate({ id: selected.id, body: { periodDate: deprPeriod } })} disabled={deprMut.isPending}>
                        {deprMut.isPending ? <Loader2 size={13} className="animate-spin" /> : "Hitung"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Jurnal: DR Beban Penyusutan · CR Akumulasi Depresiasi
                    </p>
                  </div>
                )}

                <div className="border-t pt-4 flex gap-2">
                  {selected.is_active && (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => deactivateMut.mutate(selected.id)} disabled={deactivateMut.isPending}>
                      Nonaktifkan Aset
                    </Button>
                  )}
                  {!detail?.depreciationRecords?.length && (
                    <Button variant="destructive" size="sm" className="flex-1" onClick={() => deleteMut.mutate(selected.id)} disabled={deleteMut.isPending}>
                      <Trash2 size={13} className="mr-1" /> Hapus
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
