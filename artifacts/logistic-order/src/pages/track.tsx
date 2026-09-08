import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { SectionTitle } from "@/components/SectionTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Search, Package, Ship, AlertCircle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { STATUS_COLORS, OrderStatus } from "@/lib/services-data";
import { useLanguage } from "@/contexts/LanguageContext";

type TrackOrder = {
  id: number;
  orderNumber: string;
  companyName: string;
  customerName: string;
  shipmentType: string;
  commodity?: string | null;
  origin?: string | null;
  destination?: string | null;
  status: string;
  createdAt: string;
  subtotal: number;
  tax: number;
  grandTotal: number;
  items: Array<{
    id: number;
    category: string;
    serviceName: string;
    subtotal: number;
    inputData?: unknown;
  }>;
};

export default function TrackPage() {
  const [, setLocation] = useLocation();
  const [input, setInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [verifiedPhoneLast4, setVerifiedPhoneLast4] = useState("");
  const [needsPhoneVerification, setNeedsPhoneVerification] = useState(false);
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const { t } = useLanguage();

  // Read ?order= from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get("order");
    if (o) {
      setInput(o);
      setSearchTerm(o);
    }
  }, []);

  useEffect(() => {
    if (!searchTerm) return;
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);
    setNeedsPhoneVerification(false);
    setOrder(null);
    const query = verifiedPhoneLast4 ? `?phone=${encodeURIComponent(verifiedPhoneLast4)}` : "";
    fetch(`/api/logistic/orders/track/${encodeURIComponent(searchTerm)}${query}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 403 && body.requiresPhoneVerification) {
            setNeedsPhoneVerification(true);
          }
          throw new Error(body.message ?? "Order tidak ditemukan");
        }
        return body as TrackOrder;
      })
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch(() => {
        if (!cancelled) setIsError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchTerm, verifiedPhoneLast4]);

  function handleSearch() {
    const trimmed = input.trim().toUpperCase();
    if (!trimmed) return;
    setPhoneInput("");
    setVerifiedPhoneLast4("");
    setSearchTerm(trimmed);
  }

  function handlePhoneVerification() {
    const trimmed = phoneInput.replace(/\D/g, "").slice(-4);
    if (trimmed.length !== 4) return;
    setVerifiedPhoneLast4(trimmed);
  }

  return (
    <div className="bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <SectionTitle
          title={t("track.title")}
          subtitle={t("track.subtitle")}
        />

        <div className="flex gap-2">
          <Input
            placeholder={t("track.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="font-mono uppercase"
          />
          <Button onClick={handleSearch} disabled={isLoading}>
            <Search className="w-4 h-4 mr-1" />
            {isLoading ? t("track.searching") : t("track.search")}
          </Button>
        </div>

        {needsPhoneVerification && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2 text-amber-800">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{t("track.phoneVerification", "Verifikasi diperlukan")}</p>
                <p className="text-xs mt-1">
                  {t("track.phoneVerificationDesc", "Masukkan 4 digit terakhir nomor HP yang digunakan saat booking.")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                maxLength={4}
                placeholder="1234"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && handlePhoneVerification()}
              />
              <Button onClick={handlePhoneVerification} disabled={phoneInput.replace(/\D/g, "").length !== 4}>
                {t("track.verify", "Verifikasi")}
              </Button>
            </div>
          </div>
        )}

        {isError && (
          <div className="text-center py-10 text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium text-foreground">{t("track.notFound")}</p>
            <p className="text-sm mt-1">{t("track.notFoundDesc")}</p>
          </div>
        )}

        {order && (
          <div className="space-y-4">
            {/* Status */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                    {t("track.orderNumber")}
                  </p>
                  <p className="text-xl font-bold font-mono text-foreground">
                    {order.orderNumber}
                  </p>
                </div>
                <Badge
                  className={
                    STATUS_COLORS[order.status as OrderStatus] ||
                    "bg-gray-100 text-gray-800"
                  }
                >
                  {order.status}
                </Badge>
              </div>
              <Separator className="mb-4" />
              {(() => {
                const firstItem = order.items?.[0];
                const inputData = (firstItem?.inputData ?? {}) as Record<string, unknown>;
                const str = (v: unknown) => (v ? String(v) : "");
                const origin =
                  str(order.origin) ||
                  str(inputData.pickupCity) ||
                  str(inputData.originAirport) ||
                  str(inputData.originPort);
                const destination =
                  str(order.destination) ||
                  str(inputData.destCity) ||
                  str(inputData.destinationAirport) ||
                  str(inputData.destinationPort);
                return (
                  <div className="grid grid-cols-2 gap-y-2 text-sm">
                    <span className="text-muted-foreground">{t("track.company")}</span>
                    <span className="font-medium text-foreground text-right">{order.companyName}</span>
                    <span className="text-muted-foreground">{t("track.pic")}</span>
                    <span className="font-medium text-foreground text-right">{order.customerName}</span>
                    <span className="text-muted-foreground">{t("track.shipmentType")}</span>
                    <span className="font-medium text-foreground text-right">{order.shipmentType}</span>
                    <span className="text-muted-foreground">{t("track.goodsCategory")}</span>
                    <span className="font-medium text-foreground text-right">
                      {str(order.commodity) || str(inputData.cargo_category) || "-"}
                    </span>
                    {origin && (
                      <>
                        <span className="text-muted-foreground">{t("track.origin")}</span>
                        <span className="font-medium text-foreground text-right">{origin}</span>
                      </>
                    )}
                    {destination && (
                      <>
                        <span className="text-muted-foreground">{t("track.destination")}</span>
                        <span className="font-medium text-foreground text-right">{destination}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">{t("track.createdAt")}</span>
                    <span className="font-medium text-foreground text-right">{formatDate(order.createdAt)}</span>
                  </div>
                );
              })()}
            </div>

            {/* Items */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold text-foreground text-sm mb-3">
                {t("track.services")} ({order.items.length})
              </h3>
              <div className="space-y-2">
                {order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-3"
                  >
                    <div>
                      <Badge variant="outline" className="text-xs mr-1">{item.category}</Badge>
                      <span className="text-sm text-foreground">{item.serviceName}</span>
                    </div>
                    <span className="text-sm font-bold text-accent flex-shrink-0">
                      {formatCurrency(item.subtotal)}
                    </span>
                  </div>
                ))}
              </div>
              <Separator className="mt-3 mb-3" />
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("track.subtotal")}</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("track.ppn")}{" "}
                    {order.subtotal > 0 &&
                    Math.round((order.tax / order.subtotal) * 1000) === 11
                      ? "1,1%"
                      : "11%"}
                  </span>
                  <span>{formatCurrency(order.tax)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>{t("track.totalEstimate")}</span>
                  <span className="text-accent">{formatCurrency(order.grandTotal)}</span>
                </div>
              </div>
            </div>

            <div className="bg-muted/40 rounded-lg p-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">{t("track.info")}</p>
              <p>{t("track.infoDesc")}</p>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLocation("/book")}
            >
              <Ship className="w-4 h-4 mr-2" /> {t("track.newOrder")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
