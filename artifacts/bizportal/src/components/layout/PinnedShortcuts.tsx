import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Pin, PinOff, Plus, X, GripVertical } from "lucide-react";
import {
  ShoppingCart, DollarSign, Truck, Package, Receipt, BarChart2,
  Users, FileText, LayoutDashboard, Send, Plane, Anchor,
  PackageCheck, TrendingUp, Settings, BookOpen,
  Bot, Database, Trophy, Warehouse, CreditCard, Calendar,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePinnedPages } from "@/hooks/usePinnedPages";

export interface PinnableItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: string;
}

const PINNABLE_PAGES: PinnableItem[] = [
  { group: "Dashboard",     label: "Dashboard",          href: "/dashboard",                      icon: LayoutDashboard },
  { group: "Logistics",     label: "Semua Shipment",      href: "/logistics/freight",              icon: Truck },
  { group: "Logistics",     label: "Air Freight",         href: "/logistics/air-freight",          icon: Plane },
  { group: "Logistics",     label: "Ocean Freight",       href: "/logistics/ocean-freight",        icon: Anchor },
  { group: "Logistics",     label: "Trucking",            href: "/logistics/trucking",             icon: Truck },
  { group: "Logistics",     label: "RFQ & Quote",         href: "/logistics/rfq",                  icon: Send },
  { group: "Logistics",     label: "Vendor Fulfillment",  href: "/logistics/vendor-fulfillment",   icon: PackageCheck },
  { group: "Logistics",     label: "Profitability",       href: "/logistics/profitability",        icon: TrendingUp },
  { group: "Sales",         label: "Sales Orders",        href: "/sales/orders",                   icon: ShoppingCart },
  { group: "Sales",         label: "Quotations",          href: "/sales/quotations",               icon: FileText },
  { group: "Sales",         label: "Invoice",             href: "/sales/invoices",                 icon: Receipt },
  { group: "Sales",         label: "Customers",           href: "/sales/customers",                icon: Users },
  { group: "Purchase",      label: "Purchase Orders",     href: "/purchase/orders",                icon: Package },
  { group: "Purchase",      label: "Vendors",             href: "/purchase/vendors",               icon: Warehouse },
  { group: "Purchase",      label: "Vendor Invoice",      href: "/purchase/vendor-invoices",       icon: FileText },
  { group: "Purchase",      label: "RFQ",                 href: "/purchase/rfq",                   icon: Send },
  { group: "Accounting",    label: "Akuntansi",           href: "/accounting/dashboard",           icon: DollarSign },
  { group: "Accounting",    label: "Jurnal",              href: "/accounting/journals",            icon: BookOpen },
  { group: "Accounting",    label: "Pembayaran",          href: "/accounting/payments",            icon: CreditCard },
  { group: "Accounting",    label: "Profit & Loss",       href: "/accounting/reports/profit-loss", icon: TrendingUp },
  { group: "Expense",       label: "Daftar Expense",      href: "/expense",                        icon: Receipt },
  { group: "Expense",       label: "Kasbon",              href: "/expense/kasbon",                 icon: DollarSign },
  { group: "Expense",       label: "Anggaran",            href: "/expense/budget",                 icon: BarChart2 },
  { group: "Laporan",       label: "Sales Report",        href: "/reports/sales",                  icon: BarChart2 },
  { group: "Laporan",       label: "Purchase Report",     href: "/reports/purchase",               icon: BarChart2 },
  { group: "Laporan",       label: "AR Aging",            href: "/reports/ar-aging",               icon: BarChart2 },
  { group: "Sport Center",  label: "SC Dashboard",        href: "/sport-center/dashboard",         icon: LayoutDashboard },
  { group: "Sport Center",  label: "Bookings",            href: "/sport-center/bookings",          icon: Calendar },
  { group: "Sport Center",  label: "Members",             href: "/sport-center/members",           icon: Users },
  { group: "Tenant",        label: "Tenant Dashboard",    href: "/tenant/dashboard",               icon: LayoutDashboard },
  { group: "Tenant",        label: "Daftar Tenant",       href: "/tenant/tenants",                 icon: Users },
  { group: "AI",            label: "AI Center",           href: "/ai-center",                      icon: Bot },
  { group: "Lainnya",       label: "Master Data",         href: "/master-data",                    icon: Database },
  { group: "Lainnya",       label: "Executive",           href: "/executive",                      icon: Trophy },
  { group: "Lainnya",       label: "Settings",            href: "/settings",                       icon: Settings },
];

const GROUPS = [...new Set(PINNABLE_PAGES.map((p) => p.group))];

export function PinnedShortcuts() {
  const [location] = useLocation();
  const { pins, isPinned, togglePin, removePin, setPins } = usePinnedPages();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const pinnedItems = pins
    .map((href) => PINNABLE_PAGES.find((p) => p.href === href))
    .filter(Boolean) as PinnableItem[];

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...pins];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(dropIdx, 0, moved);
    setPins(next);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const filteredPages = PINNABLE_PAGES.filter((p) =>
    !search || p.label.toLowerCase().includes(search.toLowerCase()) || p.group.toLowerCase().includes(search.toLowerCase())
  );

  const filteredGroups = GROUPS.filter((g) => filteredPages.some((p) => p.group === g));

  if (pins.length === 0 && !pickerOpen) {
    return (
      <div className="hidden lg:flex h-8 items-center px-6 border-b border-border bg-background/80">
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400 hover:text-amber-300 border border-dashed border-amber-500/40 hover:border-amber-400/70 rounded-md px-2.5 py-1 transition-colors bg-amber-500/5 hover:bg-amber-500/10"
        >
          <Pin className="h-3 w-3" />
          <span>Pin shortcut favorit...</span>
        </button>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex h-9 items-center gap-1 px-4 border-b border-border bg-background/80 relative">
      {pinnedItems.map(({ label, href, icon: Icon }, idx) => {
        const isActive = location === href || location.startsWith(`${href}/`);
        const isDragging = editMode && dragIdx === idx;
        const isDragOver = editMode && dragOverIdx === idx && dragIdx !== idx;
        return (
          <div
            key={href}
            draggable={editMode}
            onDragStart={editMode ? (e) => handleDragStart(e, idx) : undefined}
            onDragOver={editMode ? (e) => handleDragOver(e, idx) : undefined}
            onDrop={editMode ? (e) => handleDrop(e, idx) : undefined}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
            className={cn(
              "flex items-center gap-1 group transition-all duration-100",
              isDragging && "opacity-40 scale-95",
              isDragOver && "border-l-2 border-primary pl-1",
            )}
          >
            {editMode && (
              <GripVertical className="h-3 w-3 text-muted-foreground/40 cursor-grab shrink-0" />
            )}
            {editMode ? (
              <span className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-default select-none",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground bg-muted/50",
              )}>
                <Icon className="h-3 w-3 shrink-0" />
                <span>{label}</span>
                <button
                  onClick={() => removePin(href)}
                  aria-label={`Hapus pin ${label}`}
                  className="ml-0.5 rounded text-muted-foreground/60 hover:text-destructive transition-colors"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ) : (
              <Link href={href}>
                <span className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}>
                  <Icon className="h-3 w-3 shrink-0" />
                  <span>{label}</span>
                </span>
              </Link>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-1 ml-auto shrink-0">
        {pinnedItems.length > 1 && (
          <button
            onClick={() => { setEditMode((v) => !v); setPickerOpen(false); }}
            aria-label={editMode ? "Selesai mengedit pin" : "Atur urutan / hapus pin"}
            className={cn(
              "flex items-center justify-center rounded-md p-1 transition-colors",
              editMode
                ? "text-primary bg-primary/10"
                : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50",
            )}
            title={editMode ? "Selesai mengedit" : "Atur urutan / hapus pin"}
          >
            <PinOff className="h-3 w-3" />
          </button>
        )}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => { setPickerOpen((v) => !v); setEditMode(false); }}
            aria-label="Tambah / hapus pin"
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors",
              pickerOpen
                ? "text-primary bg-primary/10"
                : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50",
            )}
            title="Tambah / hapus pin"
          >
            <Plus className="h-3 w-3" />
          </button>

          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
                <div className="px-3 pt-3 pb-2 border-b border-border">
                  <p className="text-xs font-semibold text-foreground mb-2">Pin Shortcut</p>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Cari halaman..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {filteredGroups.map((group) => (
                    <div key={group}>
                      <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{group}</p>
                      {filteredPages.filter((p) => p.group === group).map(({ label, href, icon: Icon }) => {
                        const pinned = isPinned(href);
                        return (
                          <button
                            key={href}
                            onClick={() => togglePin(href)}
                            className={cn(
                              "flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors",
                              pinned
                                ? "text-primary bg-primary/5 hover:bg-primary/10"
                                : "text-foreground hover:bg-muted/60",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="flex-1 text-left">{label}</span>
                            {pinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {filteredGroups.length === 0 && (
                    <p className="px-3 py-4 text-xs text-muted-foreground text-center">Tidak ada hasil</p>
                  )}
                </div>
                {pins.length > 0 && (
                  <div className="border-t border-border px-3 py-2 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">{pins.length} pin aktif</span>
                    <button
                      onClick={() => { setPins([]); setPickerOpen(false); }}
                      className="text-[10px] text-destructive hover:text-destructive/80 transition-colors"
                    >
                      Hapus semua
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
