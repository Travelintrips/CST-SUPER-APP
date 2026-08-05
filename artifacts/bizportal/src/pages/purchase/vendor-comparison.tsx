import { DatePicker } from "@/components/ui/date-picker";
import { useState, useMemo } from "react";
import { Link, useLocation, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, Plus, CheckCircle, Trophy, Scale, TrendingDown, Package2, Info } from "lucide-react";
import { toast } from "sonner";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const idrCompact = (n: number) => {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(2)}Jt`;
  return idr(n);
};
const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

interface LogisticsUnit { id: number; name: string; symbol: string; description: string; is_active: boolean; }

const EMPTY_VQ = { supplierName: "", deliveryDays: "", paymentTermDays: "30", notes: "", ppnRate: "11", incoterm: "", deliveryTerm: "", availability: "", validUntil: "", lines: [{ name: "", quantity: "1", unit: "pcs", unitCost: "0" }] };

// Hitung skor 0–100 untuk setiap vendor berdasarkan bobot kriteria
function scoreVendors(
  quotations: Record<string, unknown>[],
  shippingCosts: Record<number, number>,
  weights: { price: number; delivery: number; payment: number },
) {
  if (!quotations.length) return {};
  const totals = quotations.map(q => Number(q.grandTotal ?? 0) + (shippingCosts[Number(q.id)] ?? 0));
  const deliveries = quotations.map(q => Number(q.deliveryDays ?? 999));
  const payments = quotations.map(q => Number(q.paymentTermDays ?? 0));
  const minTotal = Math.min(...totals), maxTotal = Math.max(...totals);
  const minDel = Math.min(...deliveries), maxDel = Math.max(...deliveries);
  const minPay = Math.min(...payments), maxPay = Math.max(...payments);

  const scores: Record<number, { price: number; delivery: number; payment: number; total: number }> = {};
  quotations.forEach((q, i) => {
    const id = Number(q.id);
    const priceScore = maxTotal === minTotal ? 100 : Math.round((1 - (totals[i] - minTotal) / (maxTotal - minTotal)) * 100);
    const delivScore = maxDel === minDel ? 100 : Math.round((1 - (deliveries[i] - minDel) / (maxDel - minDel)) * 100);
    const payScore = maxPay === minPay ? 50 : Math.round((payments[i] - minPay) / (maxPay - minPay) * 100);
    const total = Math.round(priceScore * weights.price / 100 + delivScore * weights.delivery / 100 + payScore * weights.payment / 100);
    scores[id] = { price: priceScore, delivery: delivScore, payment: payScore, total };
  });
  return scores;
}

export default function VendorComparisonPage() {
  const { rfqId } = useParams();
  const [, navigate] = useLocation();
  const qcClient = useQueryClient();

  // ── Form tambah quotation ────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVQ, setNewVQ] = useState(EMPTY_VQ);

  // ── Logistics unit analysis controls ────────────────────────────────────
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [totalQty, setTotalQty] = useState<string>("");
  const [shippingCosts, setShippingCosts] = useState<Record<number, string>>({});
  const [weights, setWeights] = useState({ price: 60, delivery: 25, payment: 15 });
  const [showScoring, setShowScoring] = useState(false);

  // ── Data fetches ─────────────────────────────────────────────────────────
  const { data: quotations = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/purchase-workflow/vq/compare", rfqId],
    queryFn: () => fetch(`/api/purchase-workflow/vq/compare/${rfqId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!rfqId,
  });

  const { data: rfq } = useQuery({
    queryKey: ["/api/purchase/documents", rfqId],
    queryFn: () => fetch(`/api/purchase/documents/${rfqId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!rfqId,
  });

  const { data: logisticsUnits = [] } = useQuery<LogisticsUnit[]>({
    queryKey: ["/api/logistics-units"],
    queryFn: () => fetch("/api/logistics-units", { credentials: "include" }).then(r => r.json()),
  });

  // ── Derived values ───────────────────────────────────────────────────────
  const selectedUnit = logisticsUnits.find(u => u.id === selectedUnitId) ?? null;
  const qty = parseFloat(totalQty) || 0;

  const landedTotals = useMemo(() =>
    Object.fromEntries(
      (quotations as Record<string, unknown>[]).map(q => {
        const id = Number(q.id);
        const ship = parseFloat(shippingCosts[id] ?? "0") || 0;
        return [id, Number(q.grandTotal ?? 0) + ship];
      })
    ), [quotations, shippingCosts]);

  const minLanded = quotations.length ? Math.min(...Object.values(landedTotals)) : 0;
  const maxLanded = quotations.length ? Math.max(...Object.values(landedTotals)) : 0;
  const minTotal = quotations.length ? Math.min(...(quotations as Record<string, unknown>[]).map(q => Number(q.grandTotal ?? 0))) : 0;

  const scores = useMemo(() =>
    scoreVendors(
      quotations as Record<string, unknown>[],
      Object.fromEntries(Object.entries(shippingCosts).map(([k, v]) => [k, parseFloat(v) || 0])),
      weights,
    ), [quotations, shippingCosts, weights]);

  const bestScore = Object.values(scores).length ? Math.max(...Object.values(scores).map(s => s.total)) : 0;

  // ── Mutations ────────────────────────────────────────────────────────────
  const addQuoteMut = useMutation({
    mutationFn: async () => {
      const totalAmount = newVQ.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);
      const ppnPct = Number(newVQ.ppnRate) || 0;
      const taxAmount = Math.round(totalAmount * ppnPct) / 100;
      const grandTotal = totalAmount + taxAmount;
      const payload = {
        rfqId: Number(rfqId), supplierName: newVQ.supplierName,
        deliveryDays: newVQ.deliveryDays ? Number(newVQ.deliveryDays) : undefined,
        paymentTermDays: Number(newVQ.paymentTermDays), notes: newVQ.notes,
        totalAmount: String(totalAmount), taxAmount: String(taxAmount), grandTotal: String(grandTotal),
        incoterm: newVQ.incoterm || null, deliveryTerm: newVQ.deliveryTerm || null,
        availability: newVQ.availability || null,
        validUntil: newVQ.validUntil ? new Date(newVQ.validUntil).toISOString() : null,
        lines: newVQ.lines,
      };
      const r = await apiFetch("/purchase-workflow/vq", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) throw new Error();
      return r.json();
    },
    onSuccess: () => {
      toast.success("Quotation ditambahkan");
      setShowAddForm(false);
      setNewVQ(EMPTY_VQ);
      refetch();
    },
    onError: () => toast.error("Gagal"),
  });

  const selectMut = useMutation({
    mutationFn: async (vqId: number) => {
      const r = await apiFetch(`/purchase-workflow/vq/${vqId}/select`, { method: "POST" });
      if (!r.ok) throw new Error();
      return r.json();
    },
    onSuccess: (data) => {
      toast.success(`PO dibuat: ${data.poNumber}`);
      qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vq/compare", rfqId] });
      navigate(`/purchase/orders/${data.poId}`);
    },
    onError: () => toast.error("Gagal memilih quotation"),
  });

  const allItems = quotations.length > 0
    ? ((quotations[0] as Record<string, unknown>).lines as Record<string, unknown>[])?.map(l => String(l.name)) ?? []
    : [];
  const weightSum = weights.price + weights.delivery + weights.payment;

  if (isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/purchase/rfq/${rfqId}`)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <Link href="/purchase/vendors"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold">Perbandingan Vendor</h1>
            <p className="text-sm text-muted-foreground">RFQ: {(rfq as any)?.docNumber ?? `#${rfqId}`}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}><Plus className="mr-1 h-4 w-4" />Tambah Quotation</Button>
        </div>

        {/* ── Analysis Controls Panel ─────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" /> Analisis Harga per Satuan Logistik
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs">Satuan Perbandingan</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={selectedUnitId ?? ""}
                  onChange={e => setSelectedUnitId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— Tidak pakai satuan —</option>
                  {logisticsUnits.filter(u => u.is_active).map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Total Kuantitas ({selectedUnit?.symbol ?? "satuan"})</Label>
                <Input
                  type="number"
                  value={totalQty}
                  onChange={e => setTotalQty(e.target.value)}
                  placeholder={`cth. 1000 ${selectedUnit?.symbol ?? ""}`}
                  disabled={!selectedUnit}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Biaya Pengiriman (diisi per vendor di tabel)</Label>
                <div className="flex items-center gap-2 h-9">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Isi kolom "Ongkir" tiap vendor di bawah</span>
                </div>
              </div>
            </div>
            {/* Scoring weights */}
            <div className="mt-4 border-t pt-3">
              <div className="flex items-center gap-2 mb-2">
                <button
                  className="text-xs font-medium text-primary flex items-center gap-1"
                  onClick={() => setShowScoring(s => !s)}
                >
                  <TrendingDown className="h-3.5 w-3.5" />
                  Skor & Ranking Vendor {showScoring ? "▲" : "▼"}
                </button>
                {weightSum !== 100 && (
                  <span className="text-xs text-destructive">Total bobot harus 100 (sekarang {weightSum})</span>
                )}
              </div>
              {showScoring && (
                <div className="grid grid-cols-3 gap-3">
                  {(["price", "delivery", "payment"] as const).map(k => (
                    <div key={k} className="grid gap-1">
                      <Label className="text-xs capitalize">{k === "price" ? "Bobot Harga %" : k === "delivery" ? "Bobot Lead Time %" : "Bobot Term Bayar %"}</Label>
                      <Input type="number" min={0} max={100} value={weights[k]} onChange={e => setWeights(w => ({ ...w, [k]: Number(e.target.value) }))} className="h-8" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Add Form ──────────────────────────────────────────────────────── */}
        {showAddForm && (
          <Card>
            <CardHeader><CardTitle className="text-base">Tambah Quotation Vendor</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nama Vendor</Label><Input value={newVQ.supplierName} onChange={e => setNewVQ(v => ({ ...v, supplierName: e.target.value }))} /></div>
                <div><Label>Lead Time (hari)</Label><Input type="number" value={newVQ.deliveryDays} onChange={e => setNewVQ(v => ({ ...v, deliveryDays: e.target.value }))} /></div>
                <div><Label>Term Bayar (hari)</Label><Input type="number" value={newVQ.paymentTermDays} onChange={e => setNewVQ(v => ({ ...v, paymentTermDays: e.target.value }))} /></div>
                <div><Label>PPN (%)</Label><Input type="number" value={newVQ.ppnRate} onChange={e => setNewVQ(v => ({ ...v, ppnRate: e.target.value }))} placeholder="0 = tidak ada PPN" /></div>
                <div>
                  <Label>Incoterm</Label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={newVQ.incoterm} onChange={e => setNewVQ(v => ({ ...v, incoterm: e.target.value }))}>
                    <option value="">— Tidak ditentukan —</option>
                    {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div><Label>Delivery Term</Label><Input value={newVQ.deliveryTerm} onChange={e => setNewVQ(v => ({ ...v, deliveryTerm: e.target.value }))} placeholder="cth. Franco Gudang" /></div>
                <div><Label>Ketersediaan</Label><Input value={newVQ.availability} onChange={e => setNewVQ(v => ({ ...v, availability: e.target.value }))} placeholder="cth. Ready stock / indent 2 minggu" /></div>
                <div><Label>Berlaku s/d</Label><DatePicker value={newVQ.validUntil} onChange={v => setNewVQ(q => ({ ...q, validUntil: v }))} /></div>
                <div className="col-span-2"><Label>Catatan</Label><Input value={newVQ.notes} onChange={e => setNewVQ(v => ({ ...v, notes: e.target.value }))} /></div>
              </div>
              {(() => {
                const sub = newVQ.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);
                const ppn = Math.round(sub * (Number(newVQ.ppnRate) || 0)) / 100;
                return sub > 0 ? (
                  <div className="text-sm text-right text-muted-foreground space-y-0.5 border rounded p-3 bg-muted/20">
                    <div>Subtotal: <span className="font-mono font-medium text-foreground ml-2">{idr(sub)}</span></div>
                    {ppn > 0 && <div>PPN {newVQ.ppnRate}%: <span className="font-mono font-medium text-foreground ml-2">{idr(ppn)}</span></div>}
                    <div className="font-semibold border-t pt-1 mt-1">Total: <span className="font-mono font-bold text-foreground ml-2">{idr(sub + ppn)}</span></div>
                  </div>
                ) : null;
              })()}
              <div>
                <Label>Item & Harga</Label>
                <div className="space-y-1 mt-1">
                  {newVQ.lines.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <Input placeholder="Nama item" value={l.name} onChange={e => setNewVQ(v => ({ ...v, lines: v.lines.map((ll, idx) => idx === i ? { ...ll, name: e.target.value } : ll) }))} />
                      <Input type="number" placeholder="Qty" value={l.quantity} onChange={e => setNewVQ(v => ({ ...v, lines: v.lines.map((ll, idx) => idx === i ? { ...ll, quantity: e.target.value } : ll) }))} className="w-20" />
                      <Input value={l.unit} onChange={e => setNewVQ(v => ({ ...v, lines: v.lines.map((ll, idx) => idx === i ? { ...ll, unit: e.target.value } : ll) }))} className="w-20" />
                      <Input type="number" placeholder="Harga" value={l.unitCost} onChange={e => setNewVQ(v => ({ ...v, lines: v.lines.map((ll, idx) => idx === i ? { ...ll, unitCost: e.target.value } : ll) }))} className="w-32" />
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setNewVQ(v => ({ ...v, lines: [...v.lines, { name: "", quantity: "1", unit: "pcs", unitCost: "0" }] }))}><Plus className="mr-1 h-4 w-4" />Item</Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => addQuoteMut.mutate()} disabled={addQuoteMut.isPending || !newVQ.supplierName}>Simpan Quotation</Button>
                <Button variant="outline" onClick={() => { setShowAddForm(false); setNewVQ(EMPTY_VQ); }}>Batal</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Main Comparison Table ─────────────────────────────────────────── */}
        {quotations.length === 0 ? (
          <Card><CardContent className="text-center py-12 text-muted-foreground">Belum ada quotation vendor. Tambahkan quotation dari vendor.</CardContent></Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left py-3 px-4 font-medium w-52">Item / Kriteria</th>
                  {(quotations as Record<string, unknown>[]).map(q => {
                    const sc = scores[Number(q.id)];
                    const isBest = sc && sc.total === bestScore && bestScore > 0;
                    return (
                      <th key={String(q.id)} className={`text-center py-3 px-4 font-medium min-w-[180px] ${isBest ? "bg-green-50 dark:bg-green-950/30" : ""}`}>
                        <div className="flex items-center justify-center gap-1">
                          {isBest && <Trophy className="h-3.5 w-3.5 text-yellow-500" />}
                          {String(q.supplierName)}
                        </div>
                        <div className="text-xs text-muted-foreground font-normal">
                          Lead: {String(q.deliveryDays ?? "?")} hr | NET{String(q.paymentTermDays ?? 30)}
                        </div>
                        <Badge variant={q.status === "selected" ? "default" : "secondary"} className="text-xs mt-1">{String(q.status)}</Badge>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Item price rows */}
                {allItems.map((itemName, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="py-2 px-4 font-medium">{itemName}</td>
                    {(quotations as Record<string, unknown>[]).map(q => {
                      const line = (q.lines as Record<string, unknown>[])?.find(l => String(l.name) === itemName);
                      const lineQty = line ? Number(line.quantity) : 0;
                      const lineUnitCost = line ? Number(line.unitCost) : 0;
                      const lineTotal = lineQty * lineUnitCost;
                      return (
                        <td key={String(q.id)} className="py-2 px-4 text-center font-mono">
                          {line ? idr(lineUnitCost) : <span className="text-muted-foreground">-</span>}
                          {line && lineQty > 0 && (
                            <div className="text-xs text-muted-foreground">× {lineQty} {String(line.unit ?? "")}</div>
                          )}
                          {line && lineQty > 0 && lineUnitCost > 0 && (
                            <div className="text-xs font-semibold text-foreground border-t border-dashed border-muted-foreground/30 mt-1 pt-0.5">
                              = {idr(lineTotal)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {/* Subtotal */}
                <tr className="border-t bg-muted/20">
                  <td className="py-2 px-4 text-muted-foreground text-xs">Subtotal (belum PPN)</td>
                  {(quotations as Record<string, unknown>[]).map(q => (
                    <td key={String(q.id)} className="py-2 px-4 text-center font-mono text-sm text-muted-foreground">
                      {idr(Number(q.totalAmount ?? 0))}
                    </td>
                  ))}
                </tr>

                {/* PPN */}
                <tr className="border-t bg-muted/20">
                  <td className="py-2 px-4 text-muted-foreground text-xs">PPN</td>
                  {(quotations as Record<string, unknown>[]).map(q => {
                    const tax = Number(q.taxAmount ?? 0);
                    const sub = Number(q.totalAmount ?? 0);
                    const pct = sub > 0 ? Math.round(tax / sub * 100) : 0;
                    return (
                      <td key={String(q.id)} className="py-2 px-4 text-center font-mono text-sm text-muted-foreground">
                        {tax > 0 ? <>{idr(tax)} <span className="text-xs">({pct}%)</span></> : <span className="text-xs">—</span>}
                      </td>
                    );
                  })}
                </tr>

                {/* Grand Total */}
                <tr className="border-t bg-muted/30 font-bold">
                  <td className="py-3 px-4">Total (termasuk PPN)</td>
                  {(quotations as Record<string, unknown>[]).map(q => {
                    const isLowest = Number(q.grandTotal) === minTotal;
                    return (
                      <td key={String(q.id)} className={`py-3 px-4 text-center font-mono ${isLowest ? "text-green-600" : ""}`}>
                        {isLowest && <Trophy className="h-3 w-3 inline mr-1 text-green-600" />}
                        {idr(Number(q.grandTotal))}
                      </td>
                    );
                  })}
                </tr>

                {/* ── Logistics Unit section ───────────────────────────────────── */}
                {selectedUnit && (
                  <>
                    <tr className="border-t bg-blue-50/50 dark:bg-blue-950/20">
                      <td colSpan={quotations.length + 1} className="py-1.5 px-4">
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1">
                          <Package2 className="h-3.5 w-3.5" /> Analisis per Satuan: {selectedUnit.name} ({selectedUnit.symbol})
                        </span>
                      </td>
                    </tr>

                    {/* Harga per satuan (hanya dari grandTotal) */}
                    {qty > 0 && (
                      <tr className="border-t bg-blue-50/30 dark:bg-blue-950/10">
                        <td className="py-2 px-4 text-xs text-blue-700 dark:text-blue-400">
                          Harga per {selectedUnit.symbol} <span className="text-muted-foreground">(dari total)</span>
                        </td>
                        {(quotations as Record<string, unknown>[]).map(q => {
                          const perUnit = Number(q.grandTotal ?? 0) / qty;
                          const minPU = Math.min(...(quotations as Record<string, unknown>[]).map(qq => Number(qq.grandTotal ?? 0) / qty));
                          const isMin = perUnit === minPU;
                          return (
                            <td key={String(q.id)} className={`py-2 px-4 text-center font-mono text-sm ${isMin ? "text-green-600 font-semibold" : ""}`}>
                              {isMin && <TrendingDown className="h-3 w-3 inline mr-1" />}
                              {idrCompact(perUnit)}
                              <div className="text-xs text-muted-foreground font-normal">/{selectedUnit.symbol}</div>
                            </td>
                          );
                        })}
                      </tr>
                    )}

                    {/* Biaya pengiriman input per vendor */}
                    <tr className="border-t bg-blue-50/30 dark:bg-blue-950/10">
                      <td className="py-2 px-4 text-xs text-blue-700 dark:text-blue-400">
                        Ongkir / Biaya Pengiriman (IDR)
                      </td>
                      {(quotations as Record<string, unknown>[]).map(q => (
                        <td key={String(q.id)} className="py-1.5 px-4">
                          <Input
                            type="number"
                            className="h-7 text-xs text-center font-mono"
                            placeholder="0"
                            value={shippingCosts[Number(q.id)] ?? ""}
                            onChange={e => setShippingCosts(prev => ({ ...prev, [Number(q.id)]: e.target.value }))}
                          />
                        </td>
                      ))}
                    </tr>

                    {/* Ongkir per satuan */}
                    {qty > 0 && (
                      <tr className="border-t bg-blue-50/30 dark:bg-blue-950/10">
                        <td className="py-2 px-4 text-xs text-blue-700 dark:text-blue-400">
                          Ongkir per {selectedUnit.symbol}
                        </td>
                        {(quotations as Record<string, unknown>[]).map(q => {
                          const ship = parseFloat(shippingCosts[Number(q.id)] ?? "0") || 0;
                          return (
                            <td key={String(q.id)} className="py-2 px-4 text-center font-mono text-xs text-muted-foreground">
                              {ship > 0 ? <>{idrCompact(ship / qty)}/{selectedUnit.symbol}</> : <span>—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    )}

                    {/* Total Landed Cost */}
                    <tr className="border-t bg-blue-50/50 dark:bg-blue-950/20 font-semibold">
                      <td className="py-2.5 px-4 text-xs text-blue-800 dark:text-blue-300">
                        Total Landed Cost
                        <div className="font-normal text-muted-foreground">(harga + ongkir)</div>
                      </td>
                      {(quotations as Record<string, unknown>[]).map(q => {
                        const landed = landedTotals[Number(q.id)] ?? 0;
                        const isMin = landed === minLanded;
                        const savings = maxLanded - landed;
                        return (
                          <td key={String(q.id)} className={`py-2.5 px-4 text-center font-mono ${isMin ? "text-green-600" : ""}`}>
                            {isMin && <Trophy className="h-3 w-3 inline mr-1 text-green-600" />}
                            {idr(landed)}
                            {savings > 0 && (
                              <div className="text-xs font-normal text-green-600">Hemat {idrCompact(savings)}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Landed cost per satuan */}
                    {qty > 0 && (
                      <tr className="border-t bg-blue-50/50 dark:bg-blue-950/20 font-semibold">
                        <td className="py-2.5 px-4 text-xs text-blue-800 dark:text-blue-300">
                          Landed Cost per {selectedUnit.symbol}
                        </td>
                        {(quotations as Record<string, unknown>[]).map(q => {
                          const landed = landedTotals[Number(q.id)] ?? 0;
                          const perUnit = landed / qty;
                          const allPerUnit = (quotations as Record<string, unknown>[]).map(qq => (landedTotals[Number(qq.id)] ?? 0) / qty);
                          const isMin = perUnit === Math.min(...allPerUnit);
                          const savings = Math.max(...allPerUnit) - perUnit;
                          return (
                            <td key={String(q.id)} className={`py-2.5 px-4 text-center font-mono ${isMin ? "text-green-600" : ""}`}>
                              {isMin && <TrendingDown className="h-3 w-3 inline mr-1" />}
                              {idrCompact(perUnit)}
                              <div className="text-xs font-normal text-muted-foreground">/{selectedUnit.symbol}</div>
                              {savings > 0 && (
                                <div className="text-xs font-normal text-green-600">Hemat {idrCompact(savings)}/{selectedUnit.symbol}</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </>
                )}

                {/* ── Incoterm ─────────────────────────────────────────────────── */}
                <tr className="border-t bg-muted/10">
                  <td className="py-2 px-4 text-muted-foreground text-xs">Incoterm</td>
                  {(quotations as Record<string, unknown>[]).map(q => (
                    <td key={String(q.id)} className="py-2 px-4 text-center text-xs font-mono">
                      {String(q.incoterm ?? "") || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
                <tr className="border-t bg-muted/10">
                  <td className="py-2 px-4 text-muted-foreground text-xs">Delivery Term</td>
                  {(quotations as Record<string, unknown>[]).map(q => (
                    <td key={String(q.id)} className="py-2 px-4 text-center text-xs">
                      {String(q.deliveryTerm ?? "") || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
                <tr className="border-t bg-muted/10">
                  <td className="py-2 px-4 text-muted-foreground text-xs">Ketersediaan</td>
                  {(quotations as Record<string, unknown>[]).map(q => (
                    <td key={String(q.id)} className="py-2 px-4 text-center text-xs">
                      {String(q.availability ?? "") || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
                <tr className="border-t bg-muted/10">
                  <td className="py-2 px-4 text-muted-foreground text-xs">Berlaku s/d</td>
                  {(quotations as Record<string, unknown>[]).map(q => (
                    <td key={String(q.id)} className="py-2 px-4 text-center text-xs">
                      {q.validUntil ? new Date(String(q.validUntil)).toLocaleDateString("id-ID") : <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
                <tr className="border-t bg-muted/10">
                  <td className="py-2 px-4 text-muted-foreground text-xs">Catatan</td>
                  {(quotations as Record<string, unknown>[]).map(q => (
                    <td key={String(q.id)} className="py-2 px-4 text-center text-xs text-muted-foreground">
                      {String(q.notes ?? "") || "—"}
                    </td>
                  ))}
                </tr>

                {/* ── Scoring row ─────────────────────────────────────────────── */}
                {showScoring && weightSum === 100 && (
                  <>
                    <tr className="border-t bg-yellow-50/50 dark:bg-yellow-950/20">
                      <td colSpan={quotations.length + 1} className="py-1.5 px-4">
                        <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
                          Skor Vendor (bobot: Harga {weights.price}% | Lead Time {weights.delivery}% | Term Bayar {weights.payment}%)
                        </span>
                      </td>
                    </tr>
                    <tr className="border-t bg-yellow-50/30 dark:bg-yellow-950/10">
                      <td className="py-2 px-4 text-xs text-yellow-700 dark:text-yellow-400">Sub-skor Harga</td>
                      {(quotations as Record<string, unknown>[]).map(q => {
                        const sc = scores[Number(q.id)];
                        return (
                          <td key={String(q.id)} className="py-2 px-4 text-center text-xs">
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden w-full mb-1">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${sc?.price ?? 0}%` }} />
                            </div>
                            {sc?.price ?? 0}/100
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-t bg-yellow-50/30 dark:bg-yellow-950/10">
                      <td className="py-2 px-4 text-xs text-yellow-700 dark:text-yellow-400">Sub-skor Lead Time</td>
                      {(quotations as Record<string, unknown>[]).map(q => {
                        const sc = scores[Number(q.id)];
                        return (
                          <td key={String(q.id)} className="py-2 px-4 text-center text-xs">
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden w-full mb-1">
                              <div className="h-full rounded-full bg-orange-500" style={{ width: `${sc?.delivery ?? 0}%` }} />
                            </div>
                            {sc?.delivery ?? 0}/100
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-t bg-yellow-50/50 dark:bg-yellow-950/20 font-bold">
                      <td className="py-3 px-4 text-sm text-yellow-800 dark:text-yellow-300 flex items-center gap-1">
                        <Trophy className="h-4 w-4 text-yellow-500" /> Skor Total
                      </td>
                      {(quotations as Record<string, unknown>[]).map(q => {
                        const sc = scores[Number(q.id)];
                        const isBest = sc && sc.total === bestScore && bestScore > 0;
                        return (
                          <td key={String(q.id)} className={`py-3 px-4 text-center text-lg font-bold ${isBest ? "text-yellow-600" : ""}`}>
                            {isBest && <Trophy className="h-4 w-4 inline mr-1 text-yellow-500" />}
                            {sc?.total ?? 0}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}

                {/* Action row */}
                <tr className="border-t">
                  <td className="py-3 px-4" />
                  {(quotations as Record<string, unknown>[]).map(q => (
                    <td key={String(q.id)} className="py-3 px-4 text-center">
                      {q.status === "selected" ? (
                        <Badge>Terpilih</Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => selectMut.mutate(Number(q.id))}
                          disabled={selectMut.isPending || (quotations as Record<string, unknown>[]).some(qq => qq.status === "selected")}
                        >
                          <CheckCircle className="mr-1 h-4 w-4" />Pilih & Buat PO
                        </Button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Summary cards ─────────────────────────────────────────────────── */}
        {quotations.length > 1 && selectedUnit && qty > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(() => {
              const sorted = [...(quotations as Record<string, unknown>[])].sort((a, b) => (landedTotals[Number(a.id)] ?? 0) - (landedTotals[Number(b.id)] ?? 0));
              const best = sorted[0];
              const worst = sorted[sorted.length - 1];
              const bestLanded = landedTotals[Number(best.id)] ?? 0;
              const worstLanded = landedTotals[Number(worst.id)] ?? 0;
              const savings = worstLanded - bestLanded;
              return (
                <>
                  <Card className="border-green-200 dark:border-green-800">
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground mb-1">Vendor Terbaik (Landed Cost)</div>
                      <div className="font-bold text-green-700 dark:text-green-400 text-lg">{String(best.supplierName)}</div>
                      <div className="font-mono text-sm">{idrCompact(bestLanded / qty)}/{selectedUnit.symbol}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground mb-1">Potensi Penghematan</div>
                      <div className="font-bold text-xl text-primary">{idrCompact(savings)}</div>
                      <div className="text-xs text-muted-foreground">vs. vendor termahal ({String(worst.supplierName)})</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground mb-1">Selisih per {selectedUnit.symbol}</div>
                      <div className="font-bold text-xl">{idrCompact((worstLanded - bestLanded) / qty)}</div>
                      <div className="text-xs text-muted-foreground">untuk {qty.toLocaleString("id-ID")} {selectedUnit.symbol}</div>
                    </CardContent>
                  </Card>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </AppShell>
  );
}
