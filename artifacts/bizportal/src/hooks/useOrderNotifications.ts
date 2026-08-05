import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  getListLogisticOrdersQueryKey,
  getGetLogisticOrderQueryKey,
  getListFreightShipmentsQueryKey,
  getGetFreightShipmentQueryKey,
  getListSalesDocumentsQueryKey,
  getGetSalesDocumentQueryKey,
  getListPurchaseDocumentsQueryKey,
  getListOrdersQueryKey,
  getListLogisticOrderRfqsQueryKey,
  getListLogisticOrderQuotesQueryKey,
} from "@workspace/api-client-react";

function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const timings = [0, 0.15, 0.3, 0.45];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + timings[i]);
      gain.gain.setValueAtTime(0, now + timings[i]);
      gain.gain.linearRampToValueAtTime(0.18, now + timings[i] + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + timings[i] + 0.5);
      osc.start(now + timings[i]);
      osc.stop(now + timings[i] + 0.55);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch {
    // AudioContext not supported or blocked — silently skip
  }
}

const NOTIF_TITLES: Record<string, string> = {
  logistic: "🚢 Order Logistik Baru",
  portal_sales: "🛍️ Order Portal",
  product: "📦 Order Produk",
  sales_update: "📄 Update Sales Order",
  sales_new: "📋 Sales Baru",
  logistic_status: "🔄 Update Status Logistik",
  freight_new: "🚢 Freight Shipment Baru",
  freight_status: "🔄 Update Status Shipment",
  freight_stage: "📋 Update Stage Shipment",
  purchase_rfq: "📥 RFQ Pembelian Baru",
  purchase_po: "✅ Purchase Order Dikonfirmasi",
  vendor_quote: "💬 Penawaran Vendor Masuk",
  vendor_po_accepted: "✅ Vendor Konfirmasi PO",
  sport_booking: "🏋️ Booking Sport Centre Baru",
};

function showBrowserNotification(notification: OrderNotification) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const title = NOTIF_TITLES[notification.type] ?? "🔔 Notifikasi Baru";
  const body = `${notification.orderNumber} — ${notification.customerName}${
    notification.companyName ? ` (${notification.companyName})` : ""
  }`;
  try {
    new Notification(title, {
      body,
      icon: "/bizportal/icon-192.png",
      tag: notification.id,
      requireInteraction: false,
    });
  } catch {
    // Notification API not available in this context
  }
}

export interface GeofenceAlertItem {
  id: string;
  driverId: number;
  driverName: string;
  jobId: number;
  jobNumber: string;
  deviationKm: number;
  thresholdKm: number;
  lat: number;
  lng: number;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  triggeredAt: string;
}

export interface GeofenceResolvedNotice {
  id: string;
  driverName: string;
  jobNumber: string;
  at: string;
}

export interface OrderNotification {
  id: string;
  dbId?: number | null;
  type: "logistic" | "portal_sales" | "product" | "sales_update" | "logistic_status"
      | "freight_new" | "freight_status" | "freight_stage"
      | "sport_booking" | "ecommerce"
      | "sales_new" | "purchase_rfq" | "purchase_po" | "vendor_quote"
      | "vendor_po_accepted";
  orderId: number;
  orderNumber: string;
  customerName: string;
  companyName: string | null;
  shipmentType?: string;
  origin?: string;
  destination?: string;
  grandTotal?: number;
  itemCount?: number;
  status?: string;
  actionLabel?: string;
  stageType?: string;
  stageStatus?: string;
  vendorName?: string;
  commodity?: string;
  transportMode?: string;
  facilityName?: string;
  bookingDate?: string;
  startTime?: string;
  endTime?: string;
  docKind?: string;
  rfqNumber?: string;
  vendorPrice?: number;
  quotePosition?: number;
  createdAt: string;
  readAt: number | null;
}

const MAX_NOTIFICATIONS = 50;
const POLL_INTERVAL_MS = 60_000;

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const FREIGHT_TYPES: OrderNotification["type"][] = ["freight_new", "freight_status", "freight_stage"];

function dbRowToNotif(row: Record<string, unknown>): OrderNotification {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: generateId(),
    dbId: row.id as number,
    type: (row.type as OrderNotification["type"]) ?? "product",
    orderId: (row.order_id as number) ?? 0,
    orderNumber: (row.order_number as string) ?? "",
    customerName: (row.customer_name as string) ?? "",
    companyName: (row.company_name as string | null) ?? null,
    // payload fields
    shipmentType: payload.shipmentType as string | undefined,
    origin: payload.origin as string | undefined,
    destination: payload.destination as string | undefined,
    grandTotal: payload.grandTotal as number | undefined,
    itemCount: payload.itemCount as number | undefined,
    status: payload.status as string | undefined,
    actionLabel: payload.actionLabel as string | undefined,
    stageType: payload.stageType as string | undefined,
    stageStatus: payload.stageStatus as string | undefined,
    vendorName: payload.vendorName as string | undefined,
    commodity: payload.commodity as string | undefined,
    transportMode: payload.transportMode as string | undefined,
    facilityName: payload.facilityName as string | undefined,
    bookingDate: payload.bookingDate as string | undefined,
    startTime: payload.startTime as string | undefined,
    endTime: payload.endTime as string | undefined,
    docKind: payload.docKind as string | undefined,
    rfqNumber: payload.rfqNumber as string | undefined,
    vendorPrice: payload.vendorPrice as number | undefined,
    quotePosition: payload.quotePosition as number | undefined,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    readAt: row.read_at ? new Date(row.read_at as string).getTime() : null,
  };
}

export function useOrderNotifications() {
  const { isAuthenticated } = useSupabaseAuth();
  const queryClient = useQueryClient();
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastFreightEventAt, setLastFreightEventAt] = useState<number | null>(null);
  const [dbUnreadTotal, setDbUnreadTotal] = useState<number>(0);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [geofenceAlertMap, setGeofenceAlertMap] = useState<Map<string, GeofenceAlertItem>>(new Map());
  const [resolvedGeofenceNotices, setResolvedGeofenceNotices] = useState<GeofenceResolvedNotice[]>([]);
  const geofenceAlertMapRef = useRef<Map<string, GeofenceAlertItem>>(new Map());
  const esRef = useRef<EventSource | null>(null);
  const onNewOrderRef = useRef<((n: OrderNotification) => void) | null>(null);
  const initializedRef = useRef(false);
  const seenDbIds = useRef(new Set<number>());

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  // Fetch active geofence alerts on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/drivers/geofence-alerts", { credentials: "include" })
      .then((r) => r.ok ? r.json() as Promise<GeofenceAlertItem[]> : [])
      .then((alerts) => {
        if (!alerts.length) return;
        const map = new Map<string, GeofenceAlertItem>();
        for (const a of alerts) map.set(a.id, a);
        geofenceAlertMapRef.current = map;
        setGeofenceAlertMap(new Map(map));
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // Fetch persisted notifications from DB on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    fetch("/api/notifications?limit=50&read=all", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.data && Array.isArray(json.data)) {
          const notifs = json.data.map(dbRowToNotif);
          for (const n of notifs) {
            if (n.dbId != null) seenDbIds.current.add(n.dbId);
          }
          setNotifications(notifs);
        }
        if (typeof json?.unreadTotal === "number") {
          setDbUnreadTotal(json.unreadTotal);
        } else if (json?.data && Array.isArray(json.data)) {
          const unread = (json.data as Record<string, unknown>[]).filter((r) => !r.read_at).length;
          setDbUnreadTotal(unread);
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // Polling setiap 60 detik — sync unread count dari DB
  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = async () => {
      try {
        const r = await fetch("/api/notifications/unread-count", { credentials: "include" });
        if (!r.ok) return;
        const { count } = await r.json() as { count: number };
        setDbUnreadTotal(count);

        // Jika DB punya lebih banyak unread dari state lokal, re-fetch daftar notifikasi
        setNotifications((prev) => {
          const localUnread = prev.filter((n) => n.readAt === null).length;
          if (count > localUnread) {
            fetch("/api/notifications?limit=50&read=all", { credentials: "include" })
              .then((res) => res.ok ? res.json() : null)
              .then((json) => {
                if (json?.data && Array.isArray(json.data)) {
                  setNotifications(json.data.map(dbRowToNotif));
                }
              })
              .catch(() => {});
          }
          return prev;
        });
      } catch {
        // jaringan gagal — abaikan, coba lagi di interval berikutnya
      }
    };

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAuthenticated]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) =>
      prev.map((n) => (n.readAt === null ? { ...n, readAt: Date.now() } : n))
    );
    setDbUnreadTotal(0);
    fetch("/api/notifications/mark-all-read", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }, []);

  const markSingleRead = useCallback((dbId: number) => {
    setNotifications((prev) => {
      const wasUnread = prev.some((n) => n.dbId === dbId && n.readAt === null);
      if (wasUnread) setDbUnreadTotal((t) => Math.max(0, t - 1));
      return prev.map((n) => (n.dbId === dbId && n.readAt === null ? { ...n, readAt: Date.now() } : n));
    });
    fetch(`/api/notifications/${dbId}/read`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setDbUnreadTotal(0);
    seenDbIds.current.clear();
  }, []);

  const setOnNewOrder = useCallback((fn: (n: OrderNotification) => void) => {
    onNewOrderRef.current = fn;
  }, []);

  const dismissGeofenceResolved = useCallback((id: string) => {
    setResolvedGeofenceNotices((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "denied" as NotificationPermission;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    return result;
  }, []);

  function pushNotification(notification: OrderNotification) {
    // Dedup: jika notifikasi dengan dbId yang sama sudah ada (SSE + polling overlap), skip
    if (notification.dbId != null && seenDbIds.current.has(notification.dbId)) return;
    if (notification.dbId != null) seenDbIds.current.add(notification.dbId);

    setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
    setDbUnreadTotal((prev) => prev + 1);
    if (FREIGHT_TYPES.includes(notification.type)) {
      setLastFreightEventAt(Date.now());
    }
    playNotificationChime();
    showBrowserNotification(notification);
    onNewOrderRef.current?.(notification);
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    let retryTimer: ReturnType<typeof setTimeout>;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const es = new EventSource("/api/drivers/events", { withCredentials: true });
      esRef.current = es;

      es.addEventListener("connected", () => {
        if (mounted) setConnected(true);
      });

      es.addEventListener("new_order", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: data.type,
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: data.companyName ?? null,
            shipmentType: data.shipmentType,
            origin: data.origin,
            destination: data.destination,
            grandTotal: data.grandTotal,
            itemCount: data.itemCount,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
        } catch { }
      });

      es.addEventListener("new_logistic_order", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "logistic",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: data.companyName ?? null,
            shipmentType: data.shipmentType,
            origin: data.origin,
            destination: data.destination,
            grandTotal: data.grandTotal,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
        } catch { }
      });

      es.addEventListener("logistic_order_status_changed", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "logistic_status",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: data.companyName ?? null,
            status: data.status,
            createdAt: data.updatedAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
          if (data.orderId) {
            queryClient.invalidateQueries({ queryKey: getGetLogisticOrderQueryKey(data.orderId) });
          }
        } catch { }
      });

      es.addEventListener("sales_order_update", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "sales_update",
            orderId: data.orderId ?? data.docId,
            orderNumber: data.orderNumber ?? data.docNumber,
            customerName: data.customerName,
            companyName: null,
            actionLabel: data.actionLabel,
            grandTotal: data.grandTotal ?? data.totalAmount,
            createdAt: data.updatedAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
          if (data.orderId ?? data.docId) {
            queryClient.invalidateQueries({ queryKey: getGetSalesDocumentQueryKey(data.orderId ?? data.docId) });
          }
        } catch { }
      });

      es.addEventListener("freight_shipment_created", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "freight_new",
            orderId: data.orderId ?? data.shipmentId,
            orderNumber: data.orderNumber ?? data.shipmentNumber,
            customerName: data.customerName ?? data.shipperName,
            companyName: data.companyName ?? data.consigneeName ?? null,
            origin: data.origin,
            destination: data.destination,
            commodity: data.commodity,
            transportMode: data.transportMode,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListFreightShipmentsQueryKey() });
        } catch { }
      });

      es.addEventListener("freight_shipment_status", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "freight_status",
            orderId: data.orderId ?? data.shipmentId,
            orderNumber: data.orderNumber ?? data.shipmentNumber,
            customerName: data.customerName ?? data.shipperName,
            companyName: data.companyName ?? data.consigneeName ?? null,
            origin: data.origin,
            destination: data.destination,
            status: data.status,
            createdAt: data.updatedAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListFreightShipmentsQueryKey() });
          if (data.shipmentId) {
            queryClient.invalidateQueries({ queryKey: getGetFreightShipmentQueryKey(data.shipmentId) });
          }
        } catch { }
      });

      es.addEventListener("freight_stage_update", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "freight_stage",
            orderId: data.orderId ?? data.shipmentId,
            orderNumber: data.orderNumber ?? data.shipmentNumber ?? `#${data.shipmentId}`,
            customerName: data.customerName ?? data.shipperName ?? "—",
            companyName: data.companyName ?? data.consigneeName ?? null,
            stageType: data.stageType,
            stageStatus: data.stageStatus,
            vendorName: data.vendorName,
            createdAt: data.updatedAt ?? new Date().toISOString(),
            readAt: null,
          });
          if (data.shipmentId) {
            queryClient.invalidateQueries({ queryKey: getGetFreightShipmentQueryKey(data.shipmentId) });
          }
        } catch { }
      });

      es.addEventListener("new_sport_booking", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "sport_booking",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: null,
            facilityName: data.facilityName,
            bookingDate: data.bookingDate,
            startTime: data.startTime,
            endTime: data.endTime,
            grandTotal: data.grandTotal,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
        } catch { }
      });

      es.addEventListener("new_ecommerce_order", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "ecommerce",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: null,
            grandTotal: data.grandTotal,
            itemCount: data.itemCount,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        } catch { }
      });

      es.addEventListener("sales_doc_created", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "sales_new",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: data.companyName ?? null,
            grandTotal: data.grandTotal,
            docKind: data.docKind,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
        } catch { }
      });

      es.addEventListener("purchase_doc_created", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: data.type === "purchase_po" ? "purchase_po" : "purchase_rfq",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: null,
            grandTotal: data.grandTotal,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
        } catch { }
      });

      es.addEventListener("purchase_doc_confirmed", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "purchase_po",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: null,
            grandTotal: data.grandTotal,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
        } catch { }
      });

      es.addEventListener("vendor_po_accepted", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "vendor_po_accepted",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: null,
            grandTotal: data.grandTotal,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          queryClient.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
        } catch { }
      });

      es.addEventListener("vendor_quote_received", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data);
          pushNotification({
            id: generateId(),
            dbId: data.dbId ?? null,
            type: "vendor_quote",
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            companyName: null,
            rfqNumber: data.rfqNumber,
            vendorPrice: data.vendorPrice,
            quotePosition: data.quotePosition,
            createdAt: data.createdAt ?? new Date().toISOString(),
            readAt: null,
          });
          if (data.orderId) {
            queryClient.invalidateQueries({ queryKey: getListLogisticOrderRfqsQueryKey(data.orderId) });
            queryClient.invalidateQueries({ queryKey: getListLogisticOrderQuotesQueryKey(data.orderId) });
            queryClient.invalidateQueries({ queryKey: getGetLogisticOrderQueryKey(data.orderId) });
            queryClient.invalidateQueries({ queryKey: ["vendor-offers", data.orderId] });
          }
        } catch { }
      });

      es.addEventListener("geofence_alert", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data) as GeofenceAlertItem;
          const isNew = !geofenceAlertMapRef.current.has(data.id);
          geofenceAlertMapRef.current = new Map(geofenceAlertMapRef.current).set(data.id, data);
          setGeofenceAlertMap(new Map(geofenceAlertMapRef.current));
          window.dispatchEvent(new CustomEvent("geofence_alert", { detail: data }));
          if (isNew) {
            toast.warning(`⚠️ Geofence Alert: ${data.driverName}`, {
              description: `Menyimpang ${data.deviationKm.toFixed(1)} km dari rute · Job #${data.jobNumber}`,
              duration: 10_000,
              action: { label: "Lihat", onClick: () => { window.location.href = "/bizportal/logistics/drivers"; } },
            });
          }
        } catch { }
      });

      es.addEventListener("geofence_alert_update", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data) as GeofenceAlertItem;
          geofenceAlertMapRef.current = new Map(geofenceAlertMapRef.current).set(data.id, data);
          setGeofenceAlertMap(new Map(geofenceAlertMapRef.current));
          window.dispatchEvent(new CustomEvent("geofence_alert_update", { detail: data }));
        } catch { }
      });

      es.addEventListener("geofence_resolved", (e: MessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(e.data) as { id: string; driverName: string; jobNumber: string };
          geofenceAlertMapRef.current.delete(data.id);
          geofenceAlertMapRef.current = new Map(geofenceAlertMapRef.current);
          setGeofenceAlertMap(new Map(geofenceAlertMapRef.current));
          setResolvedGeofenceNotices((prev) => [
            { id: data.id, driverName: data.driverName, jobNumber: data.jobNumber, at: new Date().toISOString() },
            ...prev.slice(0, 4),
          ]);
          window.dispatchEvent(new CustomEvent("geofence_resolved", { detail: data }));
        } catch { }
      });

      es.onerror = () => {
        if (!mounted) return;
        setConnected(false);
        es.close();
        esRef.current = null;
        retryTimer = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      mounted = false;
      clearTimeout(retryTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [isAuthenticated]);

  const geofenceAlerts = [...geofenceAlertMap.values()].sort(
    (a, b) => b.triggeredAt.localeCompare(a.triggeredAt)
  );

  return {
    notifications,
    unreadCount,
    dbUnreadTotal,
    connected,
    markAllRead,
    markSingleRead,
    clearAll,
    setOnNewOrder,
    lastFreightEventAt,
    notifPermission,
    requestNotifPermission,
    geofenceAlerts,
    resolvedGeofenceNotices,
    dismissGeofenceResolved,
  };
}
