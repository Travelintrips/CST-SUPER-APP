import { useState } from "react";
import { useLocation } from "wouter";
import { Plus, ShoppingBag, ClipboardList, Truck, Receipt } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuickCreateItem {
  label: string;
  href: string;
  icon: React.ElementType;
  description: string;
}

const QUICK_CREATE_ITEMS: QuickCreateItem[] = [
  {
    label: "Sales Order",
    href: "/sales/orders/new",
    icon: ShoppingBag,
    description: "Buat order penjualan baru",
  },
  {
    label: "Purchase Request",
    href: "/purchase/pr/new",
    icon: ClipboardList,
    description: "Ajukan permintaan pembelian",
  },
  {
    label: "Shipment",
    href: "/logistics/freight/new",
    icon: Truck,
    description: "Buat pengiriman / freight baru",
  },
  {
    label: "Expense",
    href: "/expense/new",
    icon: Receipt,
    description: "Catat pengeluaran baru",
  },
];

interface Props {
  compact?: boolean;
}

export function QuickCreate({ compact = false }: Props) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className={cn(
            "gap-1.5 h-8 text-xs font-medium",
            compact && "w-8 p-0",
          )}
          aria-label="Buat baru"
        >
          <Plus size={14} className="shrink-0" />
          {!compact && <span className="hidden sm:inline">Buat Baru</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
          Buat dokumen baru
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {QUICK_CREATE_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.href}
            onClick={() => { navigate(item.href); setOpen(false); }}
            className="gap-2.5 cursor-pointer"
          >
            <item.icon size={14} className="shrink-0 text-muted-foreground" />
            <div className="flex flex-col min-w-0">
              <span className="text-sm leading-snug">{item.label}</span>
              <span className="text-[10px] text-muted-foreground leading-snug truncate">
                {item.description}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
