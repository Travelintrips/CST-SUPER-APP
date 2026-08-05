import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Send, Loader2, AlertCircle, BarChart2, Package,
  Store, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Step1416Panel } from "./logistics-rfq-step14-16";

const idr = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const TAX_RATE = 0.11;

interface CatalogItem {
  id: number;
  type: string;
  name: string;
  unit: string | null;
  priceBase: number;
  isCommodityTag: boolean;
}

interface VendorData {
  id: number;
  name: string;
  phone: string | null;
  serviceType: string | null;
  hasMatchingCatalog: boolean;
  matchedCatalogItems: CatalogItem[];
  alreadyBlasted: boolean;
}

interface OrderItem {
  id: number;
  serviceName: string;
  subtotal: number;
  inputData: Record<string, unknown>;
  calculatorType: string;
}

interface RfqDetailData {
  rfqId: number;
  rfqNumber: string;
  rfqStatus: string;
  responseDeadline: string | null;
  order: {
    id: number;
    orderNumber: string;
    customerName: string;
    status: string;
    orderType: string;
    subtotal: number;
    tax: number;
    grandTotal: number;
  };
  orderItems: OrderItem[];
  vendors: VendorData[];
  vendorStats: { total: number; waiting: number; answered: number; rejected: number };
}

function getQtyUnit(item: OrderItem): { qty: number | null; unit: string | null } {
  const d = item.inputData as Record<string, unknown>;
  const qty = typeof d.qty === "number" ? d.qty : typeof d.quantity === "number" ? d.quantity : null;
  const unit = typeof d.unit === "string" ? d.unit : null;
  return { qty, unit };
}

function VendorRow({
  vendor,
  orderItems,
  selected,
  onToggle,
}: {
  vendor: VendorData;
  orderItems: OrderItem[];
  selected: boolean;
  onToggle: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const firstItem = orderItems[0];
  const { qty: firstQty, unit: firstUnit } = firstItem ? getQtyUnit(firstItem) : { qty: null, unit: null };

  const matchedItem = vendor.matchedCatalogItems[0] ?? null;

  const subtotalVendor = matchedItem && firstQty != null ? matchedItem.priceBase * firstQty : null;
  const ppnVendor = subtotalVendor != null ? subtotalVendor * TAX_RATE : null;
  const grandTotalVendor = subtotalVendor != null && ppnVendor != null ? subtotalVendor + ppnVendor : null;

  const catalogBadgeLabel = matchedItem
    ? (matchedItem.isCommodityTag ? "Komoditi" : matchedItem.type === "product" ? "Produk" : "Layanan")
    : null;

  return (
    <div
      className={`border rounded-xl p-3 cursor-pointer transition-colors ${
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
      }`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{vendor.name}</span>
            {catalogBadgeLabel && (
              <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                ✓ {catalogBadgeLabel}
              </Badge>
            )}
            {vendor.alreadyBlasted && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300">
                Sudah di-blast
              </Badge>
            )}
          </div>

          {matchedItem && (
            <div className="text-xs space-y-0.5">
              <div className="flex justify-between text-muted-foreground">
                <span>Harga Dasar {firstUnit ? `/ ${firstUnit}` : ""}</span>
                <span className="font-medium text-foreground">{idr(matchedItem.priceBase)}{firstUnit ? `/${firstUnit}` : ""}</span>
              </div>
              {firstQty != null && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal ({idr(matchedItem.priceBase)} × {firstQty} {firstUnit ?? ""})</span>
                  <span className="font-medium text-foreground">{idr(subtotalVendor)}</span>
                </div>
              )}
              {ppnVendor != null && (
                <div className="flex justify-between text-muted-foreground">
                  <span>PPN 11% ({idr(subtotalVendor)} × 11%)</span>
                  <span>{idr(ppnVendor)}</span>
                </div>
              )}
              {grandTotalVendor != null && (
                <div className="flex justify-between font-semibold text-sm mt-1 pt-1 border-t border-border/60">
                  <span>Est. Grand Total</span>
                  <span>{idr(grandTotalVendor)}</span>
                </div>
              )}
            </div>
          )}

          {!matchedItem && (
            <p className="text-xs text-muted-foreground">Tidak ada item di etalase yang cocok</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {vendor.phone ? (
            <span className="text-xs font-mono text-green-700">{vendor.phone}</span>
          ) : (
            <span className="text-xs text-red-400">No WA tidak ada</span>
          )}
        </div>
      </div>

      {vendor.matchedCatalogItems.length > 1 && (
        <button
          className="mt-2 ml-8 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v); }}
        >
          {showAll ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showAll ? "Sembunyikan" : `+${vendor.matchedCatalogItems.length - 1} item lain di etalase`}
        </button>
      )}
      {showAll && vendor.matchedCatalogItems.slice(1).map((c) => (
        <div key={c.id} className="ml-8 mt-1 text-xs text-muted-foreground flex justify-between">
          <span>{c.name} ({c.unit ?? "—"})</span>
          <span>{idr(c.priceBase)}</span>
        </div>
      ))}
    </div>
  );
}

export default function LogisticsRfqDetailPage() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<number>>(new Set());
  const [deadlineHours, setDeadlineHours] = useState("48");
  const [showBlastConfirm, setShowBlastConfirm] = useState(false);
  const [showReblastConfirm, setShowReblastConfirm] = useState(false);
  const [filterMode, setFilterMode] = useState<"matched" | "all">("matched");

  const rfqNumId = Number(rfqId);

  const { data, isLoading, error } = useQuery<RfqDetailData>({
    queryKey: ["rfq-detail-v2", rfqNumId],
    queryFn: async () => {
      const r = await fetch(`/api/logistic/rfq/${rfqNumId}/detail`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat detail RFQ");
      return r.json();
    },
  });

  const blastMutation = useMutation({
    mutationFn: async () => {
      if (selectedVendorIds.size === 0) throw new Error("Pilih minimal 1 vendor");
      const r = await fetch(`/api/logistic/rfq/${rfqNumId}/blast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          vendorIds: Array.from(selectedVendorIds),
          deadlineHours: Number(deadlineHours) || 48,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message ?? "Gagal blast ke vendor");
      return result;
    },
    onSuccess: (result) => {
      toast({
        title: "Berhasil dikirim ke vendor",
        description: `${result.sentCount} vendor menerima WA`,
      });
      setShowBlastConfirm(false);
      qc.invalidateQueries({ queryKey: ["rfq-detail-v2", rfqNumId] });
      navigate(`/logistics/rfq/${rfqNumId}/comparison`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reblastAllMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/logistic/rfq/${rfqNumId}/reblast-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deadlineHours: Number(deadlineHours) || 48 }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message ?? "Gagal re-blast ke semua vendor");
      return result;
    },
    onSuccess: (result) => {
      toast({
        title: "Re-blast berhasil",
        description: `${result.sentCount} dari ${result.totalVendors} vendor menerima WA. basic_price diperbarui.`,
      });
      setShowReblastConfirm(false);
      qc.invalidateQueries({ queryKey: ["rfq-detail-v2", rfqNumId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleVendor = useCallback((id: number) => {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6 space-y-4 max-w-2xl mx-auto">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="p-6 text-center">
          <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">RFQ tidak ditemukan</p>
          <Button variant="link" onClick={() => navigate("/logistics/rfq")}>← Kembali ke daftar</Button>
        </div>
      </AppShell>
    );
  }

  const { order, orderItems, vendors, rfqStatus } = data;
  const isAdminReview = rfqStatus === "admin_review";
  const isBlasted = rfqStatus === "vendor_blasted";

  const matchedVendors = vendors.filter((v) => v.hasMatchingCatalog);
  const unmatchedVendors = vendors.filter((v) => !v.hasMatchingCatalog);
  const displayVendors = filterMode === "matched" && matchedVendors.length > 0 ? matchedVendors : vendors;

  // Produk pertama dari order item (untuk label filter)
  const firstProductName = orderItems[0]?.serviceName ?? null;

  const canBlast = isAdminReview || isBlasted;

  return (
    <AppShell>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/logistics/rfq")} className="h-8 px-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold flex items-center gap-2">
              📋 Review Order & Blast Vendor
            </h1>
            <p className="text-xs text-muted-foreground">Pilih vendor yang akan menerima RFQ untuk order ini.</p>
          </div>
          {!isAdminReview && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/logistics/rfq/${rfqNumId}/comparison`)} className="h-8 text-xs">
              <BarChart2 className="h-3.5 w-3.5 mr-1" />Lihat Comparison
            </Button>
          )}
        </div>

        {/* Order Card */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-base font-mono">{order.orderNumber}</p>
                <p className="text-sm text-muted-foreground">{order.customerName}</p>
              </div>
              <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wide shrink-0">
                {order.status}
              </Badge>
            </div>

            {orderItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Produk Dipesan
                </p>
                {orderItems.map((item) => {
                  const { qty, unit } = getQtyUnit(item);
                  return (
                    <div key={item.id} className="text-sm">
                      <div className="flex justify-between">
                        <span className="font-medium">• {item.serviceName}</span>
                        <span className="text-right">{idr(item.subtotal)}</span>
                      </div>
                      {qty != null && (
                        <div className="text-xs text-muted-foreground ml-3">
                          Quantity: {qty} {unit ?? ""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <Separator />

            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal Produk</span>
                <span>{idr(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>PPN 11%</span>
                <span>{idr(order.tax)}</span>
              </div>
              <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
                <span>Grand Total</span>
                <span>{idr(order.grandTotal)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vendor Tersedia */}
        {canBlast && (
          <Card>
            <CardHeader className="pb-2 pt-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  Vendor Tersedia ({displayVendors.length})
                </CardTitle>
                {matchedVendors.length > 0 && unmatchedVendors.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setFilterMode((m) => m === "matched" ? "all" : "matched")}
                  >
                    {filterMode === "matched" ? `Tampilkan semua (${vendors.length})` : `Filter katalog (${matchedVendors.length})`}
                  </Button>
                )}
              </div>

              {filterMode === "matched" && matchedVendors.length > 0 && firstProductName && (
                <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-1.5 text-xs dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400">
                  <span>✅</span>
                  <span>
                    Menampilkan vendor yang menjual{" "}
                    <strong>"{firstProductName}"</strong> di etalase.
                  </span>
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-2">
              {displayVendors.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>Tidak ada vendor aktif ditemukan</p>
                </div>
              ) : (
                displayVendors.map((v) => (
                  <VendorRow
                    key={v.id}
                    vendor={v}
                    orderItems={orderItems}
                    selected={selectedVendorIds.has(v.id)}
                    onToggle={() => toggleVendor(v.id)}
                  />
                ))
              )}

              {filterMode === "matched" && unmatchedVendors.length > 0 && (
                <p className="text-xs text-muted-foreground text-center pt-1">
                  +{unmatchedVendors.length} vendor lain tidak memiliki item cocok di etalase —{" "}
                  <button className="underline hover:text-foreground" onClick={() => setFilterMode("all")}>
                    Tampilkan semua
                  </button>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Batas Waktu + Blast Button */}
        {canBlast && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Batas Waktu Respons Vendor</p>
                <Select value={deadlineHours} onValueChange={setDeadlineHours}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12 jam</SelectItem>
                    <SelectItem value="24">24 jam (1 hari)</SelectItem>
                    <SelectItem value="48">48 jam (2 hari)</SelectItem>
                    <SelectItem value="72">72 jam (3 hari)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full gap-2"
                disabled={selectedVendorIds.size === 0 || blastMutation.isPending}
                onClick={() => setShowBlastConfirm(true)}
              >
                {blastMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Mengirim...</>
                  : <><Send className="h-4 w-4" />🚀 Blast RFQ ke {selectedVendorIds.size} Vendor</>
                }
              </Button>

              {isBlasted && data.vendorStats.total > 0 && (
                <>
                  <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex-1 h-px bg-border" />
                    <span className="shrink-0">atau</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <Button
                    variant="outline"
                    className="w-full gap-2 border-orange-300 text-orange-700 hover:bg-orange-50 hover:border-orange-400 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30"
                    disabled={reblastAllMutation.isPending}
                    onClick={() => setShowReblastConfirm(true)}
                  >
                    {reblastAllMutation.isPending
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Mengirim ulang...</>
                      : <><RefreshCw className="h-4 w-4" />📢 Kirim ke Semua Vendor ({data.vendorStats.total})</>
                    }
                  </Button>
                  <p className="text-[11px] text-muted-foreground text-center -mt-1">
                    Update <code className="bg-muted px-1 rounded">basic_price</code> & kirim ulang WA ke semua vendor yang sudah di-blast
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Non-blast status info */}
        {!canBlast && (
          <Card>
            <CardContent className="pt-4 text-sm text-muted-foreground text-center py-6">
              <p>Status RFQ: <strong>{rfqStatus}</strong></p>
              <Button variant="link" onClick={() => navigate(`/logistics/rfq/${rfqNumId}/comparison`)}>
                Lihat Comparison →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 14-16: Operasional pasca-approval */}
        <Step1416Panel rfqId={rfqNumId} rfqStatus={rfqStatus} />

        {/* Confirm Dialog — blast selektif */}
        <Dialog open={showBlastConfirm} onOpenChange={setShowBlastConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Konfirmasi Blast ke Vendor</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                Kirim permintaan penawaran ke{" "}
                <strong>{selectedVendorIds.size} vendor</strong> via WhatsApp.
              </p>
              <div className="bg-muted/50 rounded p-3 space-y-1 text-xs">
                <div><span className="text-muted-foreground">RFQ:</span> {data.rfqNumber}</div>
                <div><span className="text-muted-foreground">Order:</span> {order.orderNumber}</div>
                <div><span className="text-muted-foreground">Deadline:</span> {deadlineHours} jam dari sekarang</div>
                <div>
                  <span className="text-muted-foreground">Vendor:</span>{" "}
                  {Array.from(selectedVendorIds).map((id) => vendors.find((v) => v.id === id)?.name).filter(Boolean).join(", ")}
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                Setiap vendor akan mendapat link unik untuk mengisi penawaran.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBlastConfirm(false)}>Batal</Button>
              <Button onClick={() => blastMutation.mutate()} disabled={blastMutation.isPending}>
                {blastMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Ya, Blast ke Vendor
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm Dialog — re-blast semua vendor */}
        <Dialog open={showReblastConfirm} onOpenChange={setShowReblastConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Konfirmasi Kirim ke Semua Vendor</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                Re-blast ke <strong>semua {data.vendorStats.total} vendor</strong> yang sudah di-blast sebelumnya.
              </p>
              <div className="bg-orange-50 border border-orange-200 rounded p-3 space-y-1 text-xs dark:bg-orange-950/20 dark:border-orange-800">
                <div className="font-medium text-orange-800 dark:text-orange-400 mb-1">Yang akan terjadi:</div>
                <div className="text-orange-700 dark:text-orange-500">• <code className="bg-orange-100 dark:bg-orange-900/40 px-1 rounded">basic_price</code> semua vendor link akan di-recalculate & diperbarui</div>
                <div className="text-orange-700 dark:text-orange-500">• Deadline baru: <strong>{deadlineHours} jam</strong> dari sekarang</div>
                <div className="text-orange-700 dark:text-orange-500">• WA notifikasi dikirim ulang ke semua vendor</div>
                <div className="text-orange-700 dark:text-orange-500">• Respons vendor yang sudah masuk <strong>tidak</strong> dihapus</div>
              </div>
              <div className="bg-muted/50 rounded p-3 space-y-1 text-xs">
                <div><span className="text-muted-foreground">RFQ:</span> {data.rfqNumber}</div>
                <div><span className="text-muted-foreground">Order:</span> {order.orderNumber}</div>
                <div><span className="text-muted-foreground">Total Vendor:</span> {data.vendorStats.total}</div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReblastConfirm(false)}>Batal</Button>
              <Button
                className="bg-orange-600 hover:bg-orange-700 text-white"
                onClick={() => reblastAllMutation.mutate()}
                disabled={reblastAllMutation.isPending}
              >
                {reblastAllMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Ya, Kirim ke Semua Vendor
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
