import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useGetLogisticOrder, useUpdateLogisticOrderStatus, getGetLogisticOrderQueryKey } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { STATUS_OPTIONS, STATUS_COLORS, OrderStatus } from "@/lib/services-data";
import { ArrowLeft, Package, Ship, User, MapPin, Calendar, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAndStoreProfile } from "@/lib/auth";

export default function AdminOrderDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const id = parseInt(params.id || "0");

  useEffect(() => {
    if (!supabase) { setLocation("/login"); return; }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setLocation("/login"); return; }
      const profile = await fetchAndStoreProfile();
      if (!profile || profile.role !== "admin") { setLocation("/dashboard"); return; }
    });
  }, [setLocation]);

  // Real-time: invalidasi order ini saat status berubah
  useEffect(() => {
    if (!id) return;
    const es = new EventSource("/api/ecommerce/events");
    es.addEventListener("logistic_order_status_changed", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.orderId === id) {
          qc.invalidateQueries({ queryKey: getGetLogisticOrderQueryKey(id) });
        }
      } catch { }
    });
    return () => es.close();
  }, [id, qc]);

  const { data: order, isLoading, refetch } = useGetLogisticOrder(id, {
    query: { enabled: !!id, queryKey: getGetLogisticOrderQueryKey(id) },
  });

  const updateStatus = useUpdateLogisticOrderStatus();

  function handleStatusChange(status: string) {
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          toast({ title: `Status diperbarui: ${status}` });
          refetch();
        },
        onError: () => toast({ title: "Gagal memperbarui status", variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Memuat data pesanan...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Pesanan tidak ditemukan.</p>
          <Button onClick={() => setLocation("/logistic-admin")}>Kembali ke Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation("/logistic-admin")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-semibold text-foreground flex-1">Detail Pesanan</span>
          <span className="font-mono text-sm text-muted-foreground">{order.orderNumber}</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Header Card */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Nomor Pesanan</p>
              <p className="text-2xl font-bold font-mono text-foreground">{order.orderNumber}</p>
              <p className="text-xs text-muted-foreground mt-1">Dibuat: {formatDate(order.createdAt)}</p>
            </div>
            <div className="flex flex-col sm:items-end gap-2">
              <Badge className={`self-start sm:self-auto ${STATUS_COLORS[order.status as OrderStatus] || "bg-gray-100 text-gray-800"} text-sm px-3 py-1`}>
                {order.status}
              </Badge>
              <div className="flex items-center gap-2">
                <Select value={order.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-48 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {updateStatus.isPending && (
                  <span className="text-xs text-muted-foreground">Menyimpan...</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Customer Info */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <User className="w-4 h-4 text-accent" /> Data Pemesan
            </h3>
            <div className="space-y-2">
              {[
                { label: "Perusahaan", value: order.companyName },
                { label: "PIC", value: order.customerName },
                { label: "Email", value: order.email },
                { label: "Telepon", value: order.phone },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{label}</span>
                  <span className="text-sm text-foreground text-right break-all">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Shipment Info */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <Ship className="w-4 h-4 text-accent" /> Data Pengiriman
            </h3>
            <div className="space-y-2">
              {[
                { label: "Tipe", value: order.shipmentType },
                { label: "Origin", value: order.origin },
                { label: "Destination", value: order.destination },
                { label: "Komoditi", value: order.commodity || "-" },
                { label: "Required Date", value: order.requiredDate ? new Date(order.requiredDate).toLocaleDateString("id-ID") : "-" },
                { label: "Gross Weight", value: order.grossWeight ? `${order.grossWeight} kg` : "-" },
                { label: "Volume", value: order.volumeCbm ? `${order.volumeCbm} CBM` : "-" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{label}</span>
                  <span className="text-sm text-foreground text-right">{value}</span>
                </div>
              ))}
            </div>
            {order.cargoDescription && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Deskripsi Kargo</p>
                <p className="text-sm text-foreground bg-muted/40 rounded p-2">{order.cargoDescription}</p>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-accent" /> Catatan
            </h3>
            <p className="text-sm text-foreground bg-muted/30 rounded p-3">{order.notes}</p>
          </div>
        )}

        {/* Order Items */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground text-sm flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-accent" /> Rincian Pesanan
          </h3>

          {/* Commodity */}
          {(order.commodity || order.cargoDescription) && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Barang / Komoditi</p>
              {order.commodity && <p className="text-sm font-semibold text-foreground">{order.commodity}</p>}
              {order.cargoDescription && <p className="text-xs text-muted-foreground">{order.cargoDescription}</p>}
            </div>
          )}

          <div className="space-y-3">
            {order.items.map((item: any) => (
              <div key={item.id} className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1 mb-1">
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                      {item.itemSource === "vendor_catalog_item" && (
                        <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200">Vendor Marketplace</Badge>
                      )}
                      {item.serviceType && (
                        <Badge variant="secondary" className="text-xs">{item.serviceType}</Badge>
                      )}
                    </div>
                    <p className="font-semibold text-foreground text-sm">{item.serviceName}</p>
                    <p className="text-xs text-muted-foreground">Tipe: {item.calculatorType}</p>
                  </div>
                  <span className="font-bold text-accent text-sm flex-shrink-0">{formatCurrency(item.subtotal)}</span>
                </div>
                {item.itemSource === "vendor_catalog_item" && !!item.priceSnapshot && typeof item.priceSnapshot === "object" && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs bg-blue-50 rounded px-2 py-1.5">
                    {!!(item.priceSnapshot as Record<string, unknown>).vendorName && (
                      <span><span className="text-muted-foreground">Vendor: </span><span className="font-medium">{String((item.priceSnapshot as Record<string, unknown>).vendorName)}</span></span>
                    )}
                    {!!(item.priceSnapshot as Record<string, unknown>).itemName && (
                      <span><span className="text-muted-foreground">Item: </span><span className="font-medium">{String((item.priceSnapshot as Record<string, unknown>).itemName)}</span></span>
                    )}
                    {(item.priceSnapshot as Record<string, unknown>).priceBase != null && (
                      <span><span className="text-muted-foreground">Harga Dasar: </span><span className="font-medium">{formatCurrency(Number((item.priceSnapshot as Record<string, unknown>).priceBase))}</span></span>
                    )}
                    {(item.priceSnapshot as Record<string, unknown>).markupPct != null && (
                      <span><span className="text-muted-foreground">Markup: </span><span className="font-medium">{String((item.priceSnapshot as Record<string, unknown>).markupPct)}%</span></span>
                    )}
                  </div>
                )}
                {typeof item.inputData === "object" && item.inputData !== null && Object.keys(item.inputData as Record<string, unknown>).length > 0 && (
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
                    {Object.entries(item.inputData as Record<string, unknown>)
                      .filter(([, v]) => v !== undefined && v !== null && v !== "")
                      .map(([k, v]) => (
                        <div key={k} className="text-xs">
                          <span className="text-muted-foreground">{k}: </span>
                          <span className="text-foreground font-medium">{String(v)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <Separator className="my-4" />
          <div className="space-y-1.5 max-w-xs ml-auto">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">PPN {order.subtotal > 0 && Math.round(order.tax / order.subtotal * 1000) === 11 ? "1,1%" : "11%"}</span>
              <span>{formatCurrency(order.tax)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold">
              <span className="text-foreground">Total Estimasi</span>
              <span className="text-accent text-lg">{formatCurrency(order.grandTotal)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground italic mt-3">
            Ini adalah estimasi harga. Penawaran final dikonfirmasi melalui quotation resmi.
          </p>
        </div>
      </div>
    </div>
  );
}
