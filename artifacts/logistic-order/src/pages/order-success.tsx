import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, Ship, Search, ArrowRight, Clock,
  Truck, Wind, Package, FileCheck, Copy, Check,
  MapPin, Bell,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { LogisticOrderDetail } from "@workspace/api-client-react";
import { useLanguage } from "@/contexts/LanguageContext";

type EtaType = "truck" | "air" | "sea" | "customs" | "default";

function getEtaType(shipmentType: string | null | undefined): EtaType {
  const s = (shipmentType ?? "").toLowerCase();
  if (s.includes("truck") || s.includes("truk") || s.includes("darat")) return "truck";
  if (s.includes("air") || s.includes("udara") || s.includes("pesawat")) return "air";
  if (s.includes("sea") || s.includes("laut") || s.includes("ocean") || s.includes("fcl") || s.includes("lcl")) return "sea";
  if (s.includes("ppjk") || s.includes("custom") || s.includes("pabean")) return "customs";
  return "default";
}

function getEtaIcon(type: EtaType): React.ReactNode {
  switch (type) {
    case "truck":   return <Truck className="w-4 h-4" />;
    case "air":     return <Wind className="w-4 h-4" />;
    case "sea":     return <Ship className="w-4 h-4" />;
    case "customs": return <FileCheck className="w-4 h-4" />;
    default:        return <Package className="w-4 h-4" />;
  }
}

function getEtaColorClass(type: EtaType): string {
  switch (type) {
    case "truck":   return "text-sky-700 bg-sky-50 border-sky-200";
    case "air":     return "text-violet-700 bg-violet-50 border-violet-200";
    case "sea":     return "text-blue-700 bg-blue-50 border-blue-200";
    case "customs": return "text-amber-700 bg-amber-50 border-amber-200";
    default:        return "text-slate-700 bg-slate-50 border-slate-200";
  }
}

// ── Copy hook ─────────────────────────────────────────────────────────────────
function useCopy(timeout = 1800) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
    });
  }, [timeout]);
  return { copied, copy };
}

// ── Timeline component ────────────────────────────────────────────────────────
function OrderTimeline() {
  const { t } = useLanguage();

  const ORDER_STEPS = [
    { key: "received", labelKey: "success.timeline.received", descKey: "success.timeline.received.desc" },
    { key: "review",   labelKey: "success.timeline.review",   descKey: "success.timeline.review.desc" },
    { key: "vendor",   labelKey: "success.timeline.vendor",   descKey: "success.timeline.vendor.desc" },
    { key: "shipping", labelKey: "success.timeline.shipping", descKey: "success.timeline.shipping.desc" },
    { key: "done",     labelKey: "success.timeline.done",     descKey: "success.timeline.done.desc" },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="font-semibold text-foreground text-sm mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" /> {t("success.timeline.title")}
      </h3>
      <div className="relative">
        {ORDER_STEPS.map((step, idx) => {
          const isDone = idx === 0;
          const isCurrent = idx === 1;
          return (
            <div key={step.key} className="flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border-2 ${
                  isDone
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : isCurrent
                    ? "bg-primary border-primary text-primary-foreground animate-pulse"
                    : "bg-muted border-border text-muted-foreground"
                }`}>
                  {isDone
                    ? <Check className="w-3.5 h-3.5" />
                    : <span className="text-[10px] font-bold">{idx + 1}</span>
                  }
                </div>
                {idx < ORDER_STEPS.length - 1 && (
                  <div className={`w-px flex-1 mt-1 ${isDone ? "bg-emerald-300" : "bg-border"}`} />
                )}
              </div>
              <div className="pb-1 min-w-0 flex-1">
                <p className={`text-sm font-semibold leading-tight ${
                  isDone ? "text-emerald-700" : isCurrent ? "text-primary" : "text-muted-foreground"
                }`}>
                  {t(step.labelKey)}
                  {isCurrent && (
                    <Badge className="ml-2 text-[9px] bg-primary/10 text-primary border-primary/20 py-0">
                      {t("success.timeline.current")}
                    </Badge>
                  )}
                </p>
                <p className={`text-xs mt-0.5 leading-relaxed ${
                  isDone || isCurrent ? "text-muted-foreground" : "text-muted-foreground/50"
                }`}>
                  {t(step.descKey)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function OrderSuccessPage() {
  const [order, setOrder] = useState<LogisticOrderDetail | null>(null);
  const [, setLocation] = useLocation();
  const { copied, copy } = useCopy();
  const { t, locale } = useLanguage();

  useEffect(() => {
    try {
      const stored = localStorage.getItem("last_order");
      if (stored) setOrder(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  if (!order) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">{t("success.notFound")}</p>
          <Button onClick={() => setLocation("/book")}>{t("success.newOrder")}</Button>
        </div>
      </div>
    );
  }

  const etaType = getEtaType(order.shipmentType);
  const etaColorClass = getEtaColorClass(etaType);
  const etaIcon = getEtaIcon(etaType);
  const etaLabel = t(`success.eta.${etaType}`);
  const trackingUrl = `/track?order=${encodeURIComponent(order.orderNumber)}`;

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero ── */}
      <div className="bg-primary text-primary-foreground">
        <div className="max-w-2xl mx-auto px-4 pt-10 pb-8 text-center">
          <div className="w-16 h-16 rounded-full bg-white/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-1">{t("success.title")}</h1>
          <p className="text-primary-foreground/75 text-sm max-w-sm mx-auto">
            {t("success.subtitle")}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-4 pb-10 space-y-5">

        {/* ── Order Number + Copy ── */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-widest text-center">
            {t("success.orderNumber")}
          </p>
          <div className="flex items-center justify-center gap-3">
            <p className="text-2xl font-bold text-foreground tracking-widest font-mono">
              {order.orderNumber}
            </p>
            <button
              onClick={() => copy(order.orderNumber)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
              title={t("success.copy")}
            >
              {copied
                ? <><Check className="w-3.5 h-3.5 text-emerald-500" /> {t("success.copied")}</>
                : <><Copy className="w-3.5 h-3.5" /> {t("success.copy")}</>
              }
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {t("success.save")}
          </p>
        </div>

        {/* ── ETA Card ── */}
        <div className={`rounded-2xl border p-4 flex items-start gap-4 ${etaColorClass}`}>
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${etaColorClass} shrink-0`}>
            {etaIcon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-0.5">
              {t("success.eta.label")}
            </p>
            <p className="text-base font-bold leading-tight">{etaLabel}</p>
            <p className="text-xs opacity-70 mt-0.5">
              {order.shipmentType
                ? `${t("success.eta.label")}: ${order.shipmentType}`
                : t("success.eta.confirmed")}
            </p>
          </div>
          {order.requiredDate && (
            <div className="text-right shrink-0">
              <p className="text-[10px] opacity-60 uppercase tracking-wide">{t("success.requiredDate")}</p>
              <p className="text-sm font-bold">
                {new Date(order.requiredDate).toLocaleDateString(locale, {
                  day: "numeric", month: "short", year: "numeric",
                })}
              </p>
            </div>
          )}
        </div>

        {/* ── Tracking CTA ── */}
        <div className="bg-card border-2 border-primary/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t("success.tracking.title")}</p>
              <p className="text-xs text-muted-foreground truncate">
                <span className="font-mono font-bold">{order.orderNumber}</span>
              </p>
            </div>
          </div>
          <Button
            className="shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground gap-2 font-semibold"
            onClick={() => setLocation(trackingUrl)}
          >
            <Search className="w-4 h-4" /> {t("success.trackNow")}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>

        {/* ── Notification banner ── */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Bell className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <span className="font-semibold">{t("success.notifAuto")} </span>
            {order.email}
            {order.phone ? ` · WhatsApp ${order.phone}` : ""}
          </p>
        </div>

        {/* ── Route summary ── */}
        {(order.origin || order.destination) && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {t("success.detail.title")}
            </p>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">{t("success.from")}</p>
                <p className="text-sm font-bold text-foreground">{order.origin ?? "—"}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">{t("success.to")}</p>
                <p className="text-sm font-bold text-foreground">{order.destination ?? "—"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-2 text-sm pt-3 border-t border-border">
              <span className="text-muted-foreground">{t("success.company")}</span>
              <span className="font-medium text-foreground text-right">{order.companyName}</span>
              <span className="text-muted-foreground">{t("success.pic")}</span>
              <span className="font-medium text-foreground text-right">{order.customerName}</span>
              <span className="text-muted-foreground">{t("success.serviceType")}</span>
              <span className="font-medium text-foreground text-right">{order.shipmentType}</span>
            </div>
          </div>
        )}

        {/* ── Order Progress Timeline ── */}
        <OrderTimeline />

        {/* ── Order Items ── */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground text-sm mb-3">
            {t("success.services")} ({order.items.length})
          </h3>
          <div className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                <div>
                  <Badge variant="outline" className="text-xs mr-2">{item.category}</Badge>
                  <span className="text-sm font-medium text-foreground">{item.serviceName}</span>
                </div>
                <span className="text-sm font-bold text-primary flex-shrink-0">
                  {item.subtotal > 0 ? formatCurrency(item.subtotal) : "—"}
                </span>
              </div>
            ))}
          </div>
          <Separator className="my-3" />
          {order.grandTotal > 0 ? (
            <>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("success.subtotal")}</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("success.ppn")} {order.subtotal > 0 && Math.round(order.tax / order.subtotal * 1000) === 11 ? "1,1%" : "11%"}
                  </span>
                  <span>{formatCurrency(order.tax)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>{t("success.totalEstimate")}</span>
                  <span className="text-primary">{formatCurrency(order.grandTotal)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground italic mt-3">
                {t("success.priceNote")}
              </p>
            </>
          ) : (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
              <p className="font-semibold">{t("success.vendorPrice")}</p>
              <p className="mt-0.5">{t("success.vendorPriceDesc")}</p>
            </div>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setLocation(trackingUrl)}
          >
            <Search className="w-4 h-4 mr-2" /> {t("success.trackOrder")}
          </Button>
          <Button
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setLocation("/book")}
          >
            <Ship className="w-4 h-4 mr-2" /> {t("success.newOrder")}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>

      </div>
    </div>
  );
}
