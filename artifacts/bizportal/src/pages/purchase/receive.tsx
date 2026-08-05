import { AppShell } from "@/components/layout/AppShell";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, PackageCheck, Plus, ChevronDown, ChevronUp, Warehouse } from "lucide-react";
import { Link } from "wouter";

interface PoLine {
  id: number; product_id: number; product_name: string; sku: string; unit: string;
  qty_ordered: number; unit_cost: number; qty_already_received: number;
}
interface PendingPo {
  id: number; doc_number: string; supplier_name: string; grand_total: number;
  receive_status: string; created_at: string; lines: PoLine[] | null;
}
interface Wh { id: number; warehouse_code: string; warehouse_name: string; warehouse_type: string; }
interface WhRack { id: number; rack_code: string; rack_name: string; zone: string | null; }
interface Receipt {
  id: number; receipt_no: string; status: string; notes: string | null;
  po_number: string; supplier_name: string; warehouse_name: string;
  line_count: number; total_value: number; created_at: string; received_at: string | null;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const fmtCurr = (n: number) => "Rp " + Number(n).toLocaleString("id-ID");
const fmt = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

export default function PurchaseReceivePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expandedPo, setExpandedPo] = useState<number | null>(null);
  const [selectedPo, setSelectedPo] = useState<PendingPo | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lineInputs, setLineInputs] = useState<Record<number, { qtyReceived: string; rackId: string }>>({});

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery<Receipt[]>({
    queryKey: ["purchase-receipts"],
    queryFn: () => apiFetch("/inventory/receive"),
  });

  const { data: pendingPos = [], isLoading: poLoading } = useQuery<PendingPo[]>({
    queryKey: ["pending-pos"],
    queryFn: () => apiFetch("/inventory/receive/pending-pos"),
  });

  const { data: warehouses = [] } = useQuery<Wh[]>({
    queryKey: ["inv-warehouses"],
    queryFn: () => apiFetch("/inventory/receive/meta/warehouses"),
  });

  const { data: racks = [] } = useQuery<WhRack[]>({
    queryKey: ["inv-racks", warehouseId],
    queryFn: () => apiFetch(`/inventory/stock/racks?warehouseId=${warehouseId}`),
    enabled: !!warehouseId,
  });

  function openReceive(po: PendingPo) {
    setSelectedPo(po);
    const inputs: Record<number, { qtyReceived: string; rackId: string }> = {};
    for (const l of po.lines ?? []) {
      const remaining = Math.max(0, l.qty_ordered - l.qty_already_received);
      inputs[l.id] = { qtyReceived: String(remaining), rackId: "" };
    }
    setLineInputs(inputs);
    setWarehouseId("");
    setNotes("");
    setOpen(true);
  }

  const createMutation = useMutation({
    mutationFn: () => {
      if (!selectedPo || !warehouseId) throw new Error("PO dan Gudang wajib dipilih");
      const lines = (selectedPo.lines ?? [])
        .filter((l) => {
          const inp = lineInputs[l.id];
          return inp && Number(inp.qtyReceived) > 0;
        })
        .map((l) => ({
          poLineId: l.id,
          productId: l.product_id,
          rackId: lineInputs[l.id]?.rackId ? Number(lineInputs[l.id].rackId) : null,
          qtyOrdered: l.qty_ordered,
          qtyReceived: Number(lineInputs[l.id]?.qtyReceived ?? 0),
          unitCost: l.unit_cost,
        }));
      if (!lines.length) throw new Error("Minimal satu item harus memiliki qty diterima > 0");
      return apiFetch("/inventory/receive", {
        method: "POST",
        body: JSON.stringify({
          poId: selectedPo.id,
          warehouseId: Number(warehouseId),
          notes: notes || null,
          lines,
        }),
      });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["purchase-receipts"] });
      qc.invalidateQueries({ queryKey: ["pending-pos"] });
      qc.invalidateQueries({ queryKey: ["inv-stock"] });
      toast({ title: `GRN ${data.receipt_no} berhasil — stok gudang diperbarui` });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const productLines = selectedPo?.lines?.filter((l) => l.product_id) ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageCheck size={24} /> Purchase Receive (GRN)
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Terima barang dari Purchase Order dan catat ke stok gudang
          </p>
        </div>

        {/* Pending POs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Purchase Order Menunggu Penerimaan</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {poLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Memuat...</p>
            ) : pendingPos.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Semua PO sudah diterima</p>
            ) : (
              <div className="divide-y">
                {pendingPos.map((po) => (
                  <div key={po.id}>
                    <div
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 cursor-pointer"
                      onClick={() => setExpandedPo(expandedPo === po.id ? null : po.id)}
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <div className="font-mono text-sm font-semibold">{po.doc_number}</div>
                          <div className="text-xs text-muted-foreground">{po.supplier_name}</div>
                        </div>
                        <Badge variant={po.receive_status === "received" ? "outline" : "secondary"}>
                          {po.receive_status === "received" ? "Diterima" : "Menunggu"}
                        </Badge>
                        <span className="text-sm font-medium">{fmtCurr(po.grand_total)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); openReceive(po); }}>
                          <PackageCheck size={14} className="mr-1" /> Terima Barang
                        </Button>
                        {expandedPo === po.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </div>
                    {expandedPo === po.id && (
                      <div className="px-4 pb-3 bg-muted/20">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Produk</TableHead>
                              <TableHead>SKU</TableHead>
                              <TableHead className="text-right">Dipesan</TableHead>
                              <TableHead className="text-right">Sudah Diterima</TableHead>
                              <TableHead className="text-right">Sisa</TableHead>
                              <TableHead className="text-right">Harga Satuan</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(po.lines ?? []).filter(l => l.product_id).map((l) => {
                              const remaining = l.qty_ordered - l.qty_already_received;
                              return (
                                <TableRow key={l.id}>
                                  <TableCell className="font-medium text-sm">{l.product_name}</TableCell>
                                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                                  <TableCell className="text-right">{fmt(l.qty_ordered)} {l.unit}</TableCell>
                                  <TableCell className="text-right text-green-600">{fmt(l.qty_already_received)} {l.unit}</TableCell>
                                  <TableCell className={`text-right font-bold ${remaining <= 0 ? "text-muted-foreground line-through" : "text-orange-600"}`}>
                                    {fmt(remaining)} {l.unit}
                                  </TableCell>
                                  <TableCell className="text-right">{fmtCurr(l.unit_cost)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Receipt History */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Riwayat Penerimaan Barang</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. GRN</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Gudang</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Total Nilai</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tanggal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiptsLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
                ) : receipts.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Belum ada penerimaan barang</TableCell></TableRow>
                ) : receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm font-semibold">{r.receipt_no}</TableCell>
                    <TableCell className="font-mono text-xs">{r.po_number}</TableCell>
                    <TableCell className="text-sm">{r.supplier_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <Warehouse size={12} className="text-muted-foreground" />
                        {r.warehouse_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm">{r.line_count}</TableCell>
                    <TableCell className="text-right font-medium">{fmtCurr(r.total_value)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "posted" ? "outline" : r.status === "cancelled" ? "destructive" : "secondary"}>
                        {r.status === "posted" ? "Diposting" : r.status === "cancelled" ? "Dibatalkan" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.received_at ?? r.created_at).toLocaleDateString("id-ID")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Receive Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PackageCheck size={18} />
                Terima Barang — {selectedPo?.doc_number}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">{selectedPo?.supplier_name}</p>
            </DialogHeader>

            <div className="space-y-4">
              {/* Warehouse picker */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Gudang Penerima <span className="text-red-500">*</span></Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih gudang..." />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          [{w.warehouse_code}] {w.warehouse_name}
                          <span className="ml-1 text-xs text-muted-foreground">({w.warehouse_type})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {warehouses.length === 0 && (
                    <p className="text-xs text-orange-500">Belum ada gudang. Buat di menu Warehouse terlebih dahulu.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Catatan</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opsional..." />
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">Detail Penerimaan</Label>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Produk</TableHead>
                        <TableHead className="text-right">Dipesan</TableHead>
                        <TableHead className="text-right">Sudah Diterima</TableHead>
                        <TableHead className="text-right w-32">Qty Terima Kali Ini</TableHead>
                        <TableHead className="w-40">Rak (opsional)</TableHead>
                        <TableHead className="text-right">Harga Satuan</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productLines.map((l) => {
                        const inp = lineInputs[l.id] ?? { qtyReceived: "0", rackId: "" };
                        const remaining = Math.max(0, l.qty_ordered - l.qty_already_received);
                        const qtyNow = Number(inp.qtyReceived) || 0;
                        const lineTotal = qtyNow * l.unit_cost;
                        return (
                          <TableRow key={l.id} className={remaining <= 0 ? "opacity-50" : ""}>
                            <TableCell>
                              <div className="font-medium text-sm">{l.product_name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{l.sku} · {l.unit}</div>
                            </TableCell>
                            <TableCell className="text-right text-sm">{fmt(l.qty_ordered)}</TableCell>
                            <TableCell className="text-right text-sm text-green-600">{fmt(l.qty_already_received)}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                max={remaining}
                                step="0.001"
                                className="w-28 text-right h-8"
                                value={inp.qtyReceived}
                                disabled={remaining <= 0}
                                onChange={(e) =>
                                  setLineInputs((prev) => ({
                                    ...prev,
                                    [l.id]: { ...prev[l.id], qtyReceived: e.target.value },
                                  }))
                                }
                              />
                              <div className="text-xs text-muted-foreground mt-0.5 text-right">
                                Sisa: {fmt(remaining)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={inp.rackId || "__none__"}
                                disabled={!warehouseId || racks.length === 0}
                                onValueChange={(v) =>
                                  setLineInputs((prev) => ({
                                    ...prev,
                                    [l.id]: { ...prev[l.id], rackId: v === "__none__" ? "" : v },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Pilih rak..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— Tanpa Rak —</SelectItem>
                                  {racks.map((r) => (
                                    <SelectItem key={r.id} value={String(r.id)}>
                                      {r.rack_code} – {r.rack_name}
                                      {r.zone && <span className="text-xs text-muted-foreground"> ({r.zone})</span>}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right text-sm">{fmtCurr(l.unit_cost)}</TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {lineTotal > 0 ? fmtCurr(lineTotal) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Summary */}
              {(() => {
                const total = productLines.reduce((sum, l) => {
                  const inp = lineInputs[l.id];
                  return sum + (Number(inp?.qtyReceived ?? 0) * l.unit_cost);
                }, 0);
                return total > 0 ? (
                  <div className="flex justify-end">
                    <div className="text-right space-y-1">
                      <div className="text-sm text-muted-foreground">Total Nilai Penerimaan</div>
                      <div className="text-xl font-bold">{fmtCurr(total)}</div>
                    </div>
                  </div>
                ) : null;
              })()}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !warehouseId}
              >
                {createMutation.isPending ? "Memproses..." : "Posting Penerimaan Barang"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
