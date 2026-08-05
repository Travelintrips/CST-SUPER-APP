import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, Package, Truck, Receipt, DollarSign, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Sales Order",       href: "/sales/orders/new",    icon: ShoppingCart, color: "bg-emerald-500/10 text-emerald-600" },
  { label: "Purchase Request",  href: "/purchase/pr/new",     icon: Package,      color: "bg-amber-500/10 text-amber-600"  },
  { label: "Shipment",          href: "/logistics/freight/new", icon: Truck,      color: "bg-cyan-500/10 text-cyan-600"    },
  { label: "Invoice",           href: "/sales/invoices/new",  icon: Receipt,      color: "bg-blue-500/10 text-blue-600"    },
  { label: "Expense",           href: "/expense/new",         icon: DollarSign,   color: "bg-rose-500/10 text-rose-600"    },
];

export function QuickCreateWidget() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
            <Plus className="h-3.5 w-3.5 text-primary" />
          </div>
          <CardTitle className="text-sm font-semibold">Quick Create</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "group flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card px-2 py-3 text-center cursor-pointer",
                  "transition-all hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm",
                )}
              >
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", item.color)}>
                  <item.icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-medium text-foreground leading-tight">{item.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
