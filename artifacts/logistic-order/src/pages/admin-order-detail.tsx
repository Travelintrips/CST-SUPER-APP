import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useGetLogisticOrder, useUpdateLogisticOrderStatus, getGetLogisticOrderQueryKey } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { STATUS_OPTIONS, STATUS_COLORS, OrderStatus } from "@/lib/services-data";
import { ArrowLeft, Package, Ship, User, FileText } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export default function AdminOrderDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useLanguage();
  const id = parseInt(params.id || "0");

  const { data: order, isLoading, refetch } = useGetLogisticOrder(id, {
    query: { enabled: !!id, queryKey: getGetLogisticOrderQueryKey(id) },
  });

  const updateStatus = useUpdateLogisticOrderStatus();

  function handleStatusChange(status: string) {
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          toast({ title: `${t("admin.detail.orderNumber")}: ${status}` });
          refetch();
        },
        onError: () => toast({ title: t("admin.detail.statusFailed"), variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">{t("admin.detail.loading")}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">{t("admin.detail.notFound")}</p>
          <Button onClick={() => setLocation("/admin")}>{t("admin.detail.backToDashboard")}</Button>
        </div>
      </div>
    );
  }

  const customerFields = [
    { label: t("admin.detail.company"),     value: order.companyName },
    { label: t("admin.detail.pic"),         value: order.customerName },
    { label: t("admin.detail.email"),       value: order.email },
    { label: t("admin.detail.phone"),       value: order.phone },
  ];

  const shipmentFields = [
    { label: t("admin.detail.type"),        value: order.shipmentType },
    { label: t("admin.detail.origin"),      value: order.origin },
    { label: t("admin.detail.destination"), value: order.destination },
    { label: t("admin.detail.commodity"),   value: order.commodity || "-" },
    { label: t("admin.detail.requiredDate"),value: order.requiredDate ? new Date(order.requiredDate).toLocaleDateString("id-ID") : "-" },
    { label: t("admin.detail.grossWeight"), value: order.grossWeight ? `${order.grossWeight} kg` : "-" },
    { label: t("admin.detail.volume"),      value: order.volumeCbm ? `${order.volumeCbm} CBM` : "-" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation("/admin")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-semibold text-foreground flex-1">{t("admin.detail.title")}</span>
          <span className="font-mono text-sm text-muted-foreground">{order.orderNumber}</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Header Card */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                {t("admin.detail.orderNumber")}
              </p>
              <p className="text-2xl font-bold font-mono text-foreground">{order.orderNumber}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDate(order.createdAt)}
              </p>
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
                  <span className="text-xs text-muted-foreground">{t("admin.detail.saving")}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Customer Info */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <User className="w-4 h-4 text-accent" /> {t("admin.detail.customer")}
            </h3>
            <div className="space-y-2">
              {customerFields.map(({ label, value }) => (
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
              <Ship className="w-4 h-4 text-accent" /> {t("admin.detail.shipment")}
            </h3>
            <div className="space-y-2">
              {shipmentFields.map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{label}</span>
                  <span className="text-sm text-foreground text-right">{value}</span>
                </div>
              ))}
            </div>
            {order.cargoDescription && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("admin.detail.cargoDesc")}</p>
                <p className="text-sm text-foreground bg-muted/40 rounded p-2">{order.cargoDescription}</p>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-accent" /> {t("admin.detail.notes")}
            </h3>
            <p className="text-sm text-foreground bg-muted/30 rounded p-3">{order.notes}</p>
          </div>
        )}

        {/* Order Items */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground text-sm flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-accent" /> {t("admin.detail.services")} ({order.items.length})
          </h3>
          <div className="space-y-3">
            {order.items.map((item) => (
              <div key={item.id} className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1 mb-1">
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                      {item.itemSource === "vendor_catalog_item" && (
                        <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200">
                          {t("admin.detail.vendorMarketplace")}
                        </Badge>
                      )}
                      {item.serviceType && (
                        <Badge variant="secondary" className="text-xs">{item.serviceType}</Badge>
                      )}
                    </div>
                    <p className="font-semibold text-foreground text-sm">{item.serviceName}</p>
                    <p className="text-xs text-muted-foreground">{item.calculatorType}</p>
                  </div>
                  <span className="font-bold text-accent text-sm flex-shrink-0">{formatCurrency(item.subtotal)}</span>
                </div>
                {item.itemSource === "vendor_catalog_item" && !!item.priceSnapshot && typeof item.priceSnapshot === "object" && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs bg-blue-50 rounded px-2 py-1.5">
                    {!!(item.priceSnapshot as Record<string, unknown>).vendorName && (
                      <span>
                        <span className="text-muted-foreground">{t("admin.detail.vendor")}: </span>
                        <span className="font-medium">{String((item.priceSnapshot as Record<string, unknown>).vendorName)}</span>
                      </span>
                    )}
                    {!!(item.priceSnapshot as Record<string, unknown>).itemName && (
                      <span>
                        <span className="text-muted-foreground">{t("admin.detail.item")}: </span>
                        <span className="font-medium">{String((item.priceSnapshot as Record<string, unknown>).itemName)}</span>
                      </span>
                    )}
                    {(item.priceSnapshot as Record<string, unknown>).priceBase != null && (
                      <span>
                        <span className="text-muted-foreground">{t("admin.detail.priceBase")}: </span>
                        <span className="font-medium">{formatCurrency(Number((item.priceSnapshot as Record<string, unknown>).priceBase))}</span>
                      </span>
                    )}
                    {(item.priceSnapshot as Record<string, unknown>).markupPct != null && (
                      <span>
                        <span className="text-muted-foreground">{t("admin.detail.markup")}: </span>
                        <span className="font-medium">{String((item.priceSnapshot as Record<string, unknown>).markupPct)}%</span>
                      </span>
                    )}
                  </div>
                )}
                {!!item.inputData && typeof item.inputData === "object" && Object.keys(item.inputData as Record<string, unknown>).length > 0 && (
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
              <span className="text-muted-foreground">{t("admin.detail.subtotal")}</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {t("admin.detail.ppn")} {order.subtotal > 0 && Math.round(order.tax / order.subtotal * 1000) === 11 ? "1,1%" : "11%"}
              </span>
              <span>{formatCurrency(order.tax)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold">
              <span className="text-foreground">{t("admin.detail.totalEstimate")}</span>
              <span className="text-accent text-lg">{formatCurrency(order.grandTotal)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground italic mt-3">
            {t("admin.detail.priceNote")}
          </p>
        </div>
      </div>
    </div>
  );
}
