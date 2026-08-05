import { useRef } from "react";
import { Bell, Package, Ship, ShoppingBag, CheckCheck, Trash2, FileText, RefreshCw, Container, Layers, BellOff, BellRing, AlertTriangle, ClipboardList, ShoppingCart, MessageSquare, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOrderNotificationsContext } from "@/contexts/OrderNotificationsContext";
import type { OrderNotification } from "@/hooks/useOrderNotifications";

function typeLabel(type: OrderNotification["type"]) {
  if (type === "logistic") return "Order Logistik Baru";
  if (type === "logistic_status") return "Update Status Logistik";
  if (type === "portal_sales") return "Order Portal";
  if (type === "sales_update") return "Update Sales Order";
  if (type === "sales_new") return "Sales Baru";
  if (type === "freight_new") return "Freight Shipment Baru";
  if (type === "freight_status") return "Update Status Shipment";
  if (type === "freight_stage") return "Update Stage Shipment";
  if (type === "purchase_rfq") return "RFQ Pembelian Baru";
  if (type === "purchase_po") return "Purchase Order Dikonfirmasi";
  if (type === "vendor_quote") return "Penawaran Vendor Masuk";
  if (type === "vendor_po_accepted") return "Vendor Konfirmasi PO";
  if (type === "sport_booking") return "Booking Sport Centre Baru";
  return "Order Produk";
}

function typeIcon(type: OrderNotification["type"]) {
  if (type === "logistic") return <Ship size={14} className="text-blue-500 shrink-0" />;
  if (type === "logistic_status") return <RefreshCw size={14} className="text-cyan-500 shrink-0" />;
  if (type === "portal_sales") return <ShoppingBag size={14} className="text-purple-500 shrink-0" />;
  if (type === "sales_update") return <FileText size={14} className="text-orange-500 shrink-0" />;
  if (type === "sales_new") return <ClipboardList size={14} className="text-emerald-500 shrink-0" />;
  if (type === "freight_new") return <Container size={14} className="text-indigo-500 shrink-0" />;
  if (type === "freight_status") return <RefreshCw size={14} className="text-violet-500 shrink-0" />;
  if (type === "freight_stage") return <Layers size={14} className="text-teal-500 shrink-0" />;
  if (type === "purchase_rfq") return <ShoppingCart size={14} className="text-amber-500 shrink-0" />;
  if (type === "purchase_po") return <ShoppingCart size={14} className="text-green-600 shrink-0" />;
  if (type === "vendor_quote") return <MessageSquare size={14} className="text-sky-500 shrink-0" />;
  if (type === "vendor_po_accepted") return <CheckCheck size={14} className="text-green-600 shrink-0" />;
  if (type === "sport_booking") return <Dumbbell size={14} className="text-pink-500 shrink-0" />;
  return <Package size={14} className="text-green-500 shrink-0" />;
}

function orderHref(n: OrderNotification) {
  if (n.type === "logistic" || n.type === "logistic_status") return `/logistics/portal-orders/${n.orderId}`;
  if (n.type === "portal_sales") return `/logistics/portal-orders`;
  if (n.type === "sales_update" || n.type === "sales_new") return `/sales/documents/${n.orderId}`;
  if (n.type === "freight_new" || n.type === "freight_status" || n.type === "freight_stage") return `/logistics/freight/${n.orderId}`;
  if (n.type === "purchase_rfq" || n.type === "purchase_po") return `/purchase/documents/${n.orderId}`;
  if (n.type === "vendor_quote") return `/logistics/portal-orders/${n.orderId}`;
  if (n.type === "vendor_po_accepted") return `/purchase/orders/${n.orderId}`;
  if (n.type === "sport_booking") return `/sport-center/bookings`;
  return `/portal-product-orders`;
}

function formatRupiah(amount: number) {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

function timeAgo(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} mnt lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  return `${Math.floor(hrs / 24)} hari lalu`;
}

function notifDescription(n: OrderNotification): string {
  if (n.type === "logistic") {
    return `${n.shipmentType ?? ""} · ${n.origin ?? ""} → ${n.destination ?? ""}`;
  }
  if (n.type === "logistic_status") {
    return `Status: ${n.status ?? ""}`;
  }
  if (n.type === "sales_update") {
    const total = n.grandTotal != null ? ` · ${formatRupiah(n.grandTotal)}` : "";
    return `${n.actionLabel ?? ""}${total}`;
  }
  if (n.type === "freight_new") {
    const route = n.origin && n.destination ? ` · ${n.origin} → ${n.destination}` : "";
    return `${n.commodity ?? ""}${route}`;
  }
  if (n.type === "freight_status") {
    const route = n.origin && n.destination ? ` · ${n.origin} → ${n.destination}` : "";
    return `Status: ${n.status ?? ""}${route}`;
  }
  if (n.type === "freight_stage") {
    const vendor = n.vendorName ? ` · ${n.vendorName}` : "";
    return `${n.stageType ?? ""}: ${n.stageStatus ?? ""}${vendor}`;
  }
  if (n.type === "sales_new") {
    const kind = n.docKind === "order" ? "Sales Order" : "Sales Quotation";
    const total = n.grandTotal != null ? ` · ${formatRupiah(n.grandTotal)}` : "";
    return `${kind}${total}`;
  }
  if (n.type === "purchase_rfq") {
    const total = n.grandTotal != null ? ` · ${formatRupiah(n.grandTotal)}` : "";
    return `Request for Quotation${total}`;
  }
  if (n.type === "purchase_po") {
    const total = n.grandTotal != null ? ` · ${formatRupiah(n.grandTotal)}` : "";
    return `Purchase Order${total}`;
  }
  if (n.type === "vendor_quote") {
    const pos = n.quotePosition ? ` · Vendor ke-${n.quotePosition}` : "";
    const price = n.vendorPrice != null ? ` · ${formatRupiah(n.vendorPrice)}` : "";
    return `${n.rfqNumber ?? ""}${pos}${price}`;
  }
  if (n.type === "vendor_po_accepted") {
    const total = n.grandTotal != null ? ` · ${formatRupiah(n.grandTotal)}` : "";
    return `PO dikonfirmasi vendor${total}`;
  }
  if (n.type === "sport_booking") {
    const facility = n.facilityName ? `${n.facilityName} · ` : "";
    const date = n.bookingDate ?? "";
    const time = n.startTime && n.endTime ? ` · ${n.startTime}–${n.endTime}` : "";
    const total = n.grandTotal != null ? ` · ${formatRupiah(n.grandTotal)}` : "";
    return `${facility}${date}${time}${total}`;
  }
  return `${n.itemCount ?? 1} item · ${formatRupiah(n.grandTotal ?? 0)}`;
}

export function NotificationBell() {
  const {
    notifications,
    dbUnreadTotal,
    unreadCount,
    markAllRead,
    clearAll,
    setOnNewOrder,
    notifPermission,
    requestNotifPermission,
    geofenceAlerts,
  } = useOrderNotificationsContext();
  const initialized = useRef(false);

  if (!initialized.current) {
    initialized.current = true;
    setOnNewOrder((n) => {
      const label = typeLabel(n.type);
      const desc = notifDescription(n);
      toast.info(`${label}`, {
        description: `${n.customerName}${n.companyName ? ` (${n.companyName})` : ""} — ${desc}`,
        duration: 8_000,
        action: {
          label: "Lihat",
          onClick: () => { window.location.href = `/bizportal${orderHref(n)}`; },
        },
      });
    });
  }

  async function handleEnableNotif() {
    const result = await requestNotifPermission();
    if (result === "granted") {
      toast.success("Notifikasi browser aktif", {
        description: "Anda akan menerima notifikasi meski sedang di tab lain.",
      });
    } else if (result === "denied") {
      toast.error("Notifikasi diblokir", {
        description: "Aktifkan notifikasi dari pengaturan browser Anda.",
      });
    }
  }

  return (
    <Popover onOpenChange={(open) => { if (open && dbUnreadTotal > 0) markAllRead(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label="Notifikasi"
        >
          <Bell size={18} className={geofenceAlerts.length > 0 ? "text-destructive" : ""} />
          {/* Order notification badge — top-right */}
          {dbUnreadTotal > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white leading-none">
              {dbUnreadTotal > 99 ? "99+" : dbUnreadTotal}
            </span>
          )}
          {/* Geofence alert badge — bottom-right, pulsing red */}
          {geofenceAlerts.length > 0 && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive animate-pulse">
              <AlertTriangle size={9} className="text-white" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Notifikasi</span>
          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
              title="Hapus semua"
            >
              <Trash2 size={12} />
              Hapus semua
            </button>
          )}
        </div>

        {/* Banner aktifkan notifikasi browser */}
        {notifPermission === "default" && (
          <div className="flex items-center gap-3 border-b border-border bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5">
            <BellRing size={15} className="text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Aktifkan notifikasi suara</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400">Muncul meski di tab lain</p>
            </div>
            <button
              onClick={handleEnableNotif}
              className="shrink-0 rounded-md bg-amber-500 hover:bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
            >
              Aktifkan
            </button>
          </div>
        )}

        {notifPermission === "denied" && (
          <div className="flex items-center gap-2 border-b border-border bg-red-50 dark:bg-red-950/20 px-4 py-2">
            <BellOff size={13} className="text-red-400 shrink-0" />
            <p className="text-[11px] text-red-600 dark:text-red-400">
              Notifikasi diblokir browser. Ubah di pengaturan situs.
            </p>
          </div>
        )}

        {/* ── Geofence Alert Section ── */}
        {geofenceAlerts.length > 0 && (
          <div className="border-b border-border">
            <div className="flex items-center gap-2 bg-destructive/5 px-4 py-2 border-b border-destructive/10">
              <AlertTriangle size={13} className="text-destructive shrink-0 animate-pulse" />
              <span className="text-xs font-semibold text-destructive flex-1">Geofence Alert Aktif</span>
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white animate-pulse">
                {geofenceAlerts.length}
              </span>
            </div>
            {geofenceAlerts.map((alert) => (
              <a
                key={alert.id}
                href="/bizportal/logistics/drivers"
                className="flex gap-2.5 px-4 py-2.5 hover:bg-destructive/5 transition-colors border-b border-destructive/10 last:border-0 cursor-pointer"
              >
                <AlertTriangle size={13} className="text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-destructive truncate">{alert.driverName}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(alert.triggeredAt)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    #{alert.jobNumber} · Menyimpang {alert.deviationKm.toFixed(1)} km dari rute
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Bell size={28} className="opacity-30" />
            <span className="text-sm">Belum ada notifikasi</span>
          </div>
        ) : (
          <ScrollArea className="max-h-[360px]">
            <div className="divide-y divide-border">
              {notifications.map((n) => (
                <a
                  key={n.id}
                  href={`/bizportal${orderHref(n)}`}
                  className={`flex gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer ${n.readAt === null ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}
                >
                  <div className="mt-0.5">{typeIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">{n.orderNumber}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {typeLabel(n.type)}
                    </p>
                    <p className="text-xs text-foreground truncate">
                      {n.customerName}{n.companyName ? ` · ${n.companyName}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {notifDescription(n)}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </ScrollArea>
        )}

        {notifications.length > 0 && (
          <div className="border-t border-border px-4 py-2 flex items-center justify-between">
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <CheckCheck size={12} />
              Tandai semua dibaca
            </button>
            <a
              href="/bizportal/notifications"
              className="text-xs text-indigo-500 hover:text-indigo-400 font-medium transition-colors"
            >
              Lihat semua →
            </a>
          </div>
        )}
        {notifications.length === 0 && (
          <div className="border-t border-border px-4 py-2 text-right">
            <a
              href="/bizportal/notifications"
              className="text-xs text-indigo-500 hover:text-indigo-400 font-medium transition-colors"
            >
              Lihat riwayat →
            </a>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
