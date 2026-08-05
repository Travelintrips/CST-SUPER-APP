import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

export interface SportCenterEvent {
  module: "sport-center";
  entity: "booking" | "facility" | "payment" | "dashboard" | "member" | "customer" | "promo" | "notification";
  action: "created" | "updated" | "deleted" | "checkin";
  data: Record<string, unknown>;
  timestamp: string;
}

interface Options {
  companyId?: number | null;
  onEvent?: (event: SportCenterEvent) => void;
  showToast?: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  created: "baru",
  updated: "diperbarui",
  deleted: "dihapus",
  checkin: "check-in",
};

const ENTITY_LABEL: Record<string, string> = {
  booking: "Booking",
  facility: "Fasilitas",
  payment: "Pembayaran",
  member: "Member",
  customer: "Pelanggan",
  promo: "Promo",
  notification: "Notifikasi",
  dashboard: "Dashboard",
};

export function useSportCenterEvents({ companyId, onEvent, showToast = true }: Options = {}) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);
  const companyIdRef = useRef(companyId);

  useEffect(() => {
    companyIdRef.current = companyId;
  }, [companyId]);

  const connect = useCallback(() => {
    if (destroyedRef.current) return;

    const qs = new URLSearchParams();
    if (companyIdRef.current) qs.set("companyId", String(companyIdRef.current));

    const es = new EventSource(`/api/sport-center/events?${qs}`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string } & Partial<SportCenterEvent>;

        if (msg.type === "connected") return;

        const entity = msg.entity;
        const action = msg.action;
        if (!entity || !action) return;

        const ev: SportCenterEvent = {
          module: "sport-center",
          entity,
          action,
          data: msg.data ?? {},
          timestamp: msg.timestamp ?? new Date().toISOString(),
        };

        onEvent?.(ev);

        qc.invalidateQueries({ queryKey: ["sport-center-kpi-live-main-dash"] });

        if (entity === "booking") {
          qc.invalidateQueries({ queryKey: ["sport-center-bookings"] });
          qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
        }
        if (entity === "payment") {
          qc.invalidateQueries({ queryKey: ["sport-center-payments"] });
          qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
        }
        if (entity === "member") {
          qc.invalidateQueries({ queryKey: ["sport-center-members"] });
        }

        if (showToast) {
          const entityLabel = ENTITY_LABEL[entity] ?? entity;
          const actionLabel = ACTION_LABEL[action] ?? action;

          if (entity === "booking" && action === "created") {
            const bookingNumber = String(ev.data.booking_number ?? ev.data.id ?? "");
            const customerName = String(ev.data.customer_name ?? "");
            toast({
              title: `Booking baru masuk`,
              description: [customerName, bookingNumber].filter(Boolean).join(" · ") || "Sport Center",
            });
          } else if (entity === "payment" && action === "created") {
            toast({
              title: "Pembayaran diterima",
              description: String(ev.data.booking_number ?? ev.data.id ?? "Sport Center"),
            });
          } else if (action === "checkin") {
            toast({
              title: "Check-in tercatat",
              description: String(ev.data.customer_name ?? ev.data.booking_number ?? "Sport Center"),
            });
          } else if (entity !== "dashboard") {
            toast({
              title: `${entityLabel} ${actionLabel}`,
              description: "Sport Center",
            });
          }
        }
      } catch {
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!destroyedRef.current) {
        reconnectTimer.current = setTimeout(connect, 5_000);
      }
    };
  }, [qc, onEvent, showToast]);

  useEffect(() => {
    destroyedRef.current = false;
    connect();

    return () => {
      destroyedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);
}
