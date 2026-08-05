import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

export type PriceRole = "customer" | "vendor" | "admin";

interface Props {
  role: PriceRole;
  basePrice?: number;
  sellingPrice?: number;
  qty?: number;
  unit?: string;
  currency?: string;
  ppnRate?: number;
}

function fmtIDR(n: number) {
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

function fmt(n: number, currency: string) {
  return currency === "IDR" ? fmtIDR(n) : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " " + currency;
}

export function TemplatePriceBreakdown({
  role,
  basePrice = 0,
  sellingPrice,
  qty = 1,
  unit = "Ls",
  currency = "IDR",
  ppnRate = 0.11,
}: Props) {
  const subtotalBase = qty * basePrice;
  const ppnBase = Math.round(subtotalBase * ppnRate * 100) / 100;
  const totalBase = subtotalBase + ppnBase;

  const subtotalSell = sellingPrice != null ? qty * sellingPrice : null;
  const ppnSell = subtotalSell != null ? Math.round(subtotalSell * ppnRate * 100) / 100 : null;
  const totalSell = subtotalSell != null && ppnSell != null ? subtotalSell + ppnSell : null;

  const margin = subtotalSell != null && subtotalBase > 0 ? subtotalSell - subtotalBase : null;
  const marginPct =
    margin != null && subtotalBase > 0 ? ((margin / subtotalBase) * 100).toFixed(1) : null;

  const ppnLabel = `PPN ${Math.round(ppnRate * 100)}%`;

  if (role === "vendor" && subtotalBase <= 0) return null;
  if (role === "customer" && !subtotalSell) return null;
  if (role === "admin" && subtotalBase <= 0) return null;

  return (
    <div className="mt-3 pl-2 border-l-2 border-primary/30 space-y-1.5">
      <p className="text-xs font-medium text-primary/80 flex items-center gap-1">
        <TrendingUp className="h-3 w-3" />
        {role === "vendor" ? "Harga Dasar" : role === "customer" ? "Harga Jual" : "Analisa Harga"}
      </p>

      {role === "vendor" && (
        <div className="rounded bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>{qty} {unit} × {fmt(basePrice, currency)}</span>
            <span>{fmt(subtotalBase, currency)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground/70">
            <span>{ppnLabel}</span>
            <span>{fmt(ppnBase, currency)}</span>
          </div>
          <div className="flex justify-between font-semibold text-indigo-700 border-t border-indigo-100 pt-1">
            <span>Total</span>
            <span>{fmt(totalBase, currency)}</span>
          </div>
        </div>
      )}

      {role === "customer" && subtotalSell != null && ppnSell != null && totalSell != null && (
        <div className="rounded bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>{qty} {unit} × {fmt(sellingPrice!, currency)}</span>
            <span>{fmt(subtotalSell, currency)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground/70">
            <span>{ppnLabel}</span>
            <span>{fmt(ppnSell, currency)}</span>
          </div>
          <div className="flex justify-between font-semibold text-emerald-700 border-t border-emerald-100 pt-1">
            <span>Total</span>
            <span>{fmt(totalSell, currency)}</span>
          </div>
        </div>
      )}

      {role === "admin" && (
        <div className="space-y-1.5">
          <div className="rounded bg-orange-50 border border-orange-100 px-3 py-2 text-xs space-y-1">
            <p className="font-medium text-orange-700">Harga Dasar (Vendor)</p>
            <div className="flex justify-between text-muted-foreground">
              <span>{qty} {unit} × {fmt(basePrice, currency)}</span>
              <span>{fmt(subtotalBase, currency)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground/70">
              <span>{ppnLabel}</span>
              <span>{fmt(ppnBase, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold text-orange-700 border-t border-orange-100 pt-1">
              <span>Total Dasar</span>
              <span>{fmt(totalBase, currency)}</span>
            </div>
          </div>
          {subtotalSell != null && ppnSell != null && totalSell != null && (
            <div className="rounded bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs space-y-1">
              <p className="font-medium text-emerald-700">Harga Jual (Customer)</p>
              <div className="flex justify-between text-muted-foreground">
                <span>{qty} {unit} × {fmt(sellingPrice!, currency)}</span>
                <span>{fmt(subtotalSell, currency)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground/70">
                <span>{ppnLabel}</span>
                <span>{fmt(ppnSell, currency)}</span>
              </div>
              <div className="flex justify-between font-semibold text-emerald-700 border-t border-emerald-100 pt-1">
                <span>Total Jual</span>
                <span>{fmt(totalSell, currency)}</span>
              </div>
            </div>
          )}
          {margin != null && marginPct != null && (
            <div className="flex items-center justify-between rounded bg-blue-50 border border-blue-100 px-3 py-1.5">
              <span className="text-xs font-medium text-blue-700 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Margin
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-800">{fmt(margin, currency)}</span>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-600 border-blue-200">
                  {marginPct}%
                </Badge>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
