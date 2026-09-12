import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Zap, Truck, FileText, ClipboardList, FolderOpen, Bot, ShoppingBag } from "lucide-react";

interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Order Logistik",
    description: "Buat portal order baru",
    href: "/logistics/portal-orders",
    icon: Truck,
    color: "text-indigo-600",
    bg: "bg-indigo-50 hover:bg-indigo-100 border-indigo-200/60",
  },
  {
    label: "Sales Quotation",
    description: "Buat penawaran sales",
    href: "/sales/quotations",
    icon: FileText,
    color: "text-emerald-600",
    bg: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200/60",
  },
  {
    label: "Purchase Request",
    description: "Ajukan permintaan pembelian",
    href: "/purchase/pr",
    icon: ClipboardList,
    color: "text-blue-600",
    bg: "bg-blue-50 hover:bg-blue-100 border-blue-200/60",
  },
  {
    label: "Upload Dokumen",
    description: "Kelola dokumen & lampiran",
    href: "/media",
    icon: FolderOpen,
    color: "text-amber-600",
    bg: "bg-amber-50 hover:bg-amber-100 border-amber-200/60",
  },
  {
    label: "AI Chatbot",
    description: "Tanya AI asisten ERP",
    href: "/settings/ai-chatbot",
    icon: Bot,
    color: "text-purple-600",
    bg: "bg-purple-50 hover:bg-purple-100 border-purple-200/60",
  },
  {
    label: "Sales Order",
    description: "Buat order penjualan",
    href: "/sales/orders",
    icon: ShoppingBag,
    color: "text-rose-600",
    bg: "bg-rose-50 hover:bg-rose-100 border-rose-200/60",
  },
];

export function QuickActionsWidget() {
  return (
    <Card>
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href + action.label}
                href={action.href}
                className={`group flex flex-col gap-1.5 rounded-xl border px-3 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${action.bg}`}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-white/60 shadow-sm ${action.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className={`text-xs font-semibold ${action.color}`}>{action.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{action.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
