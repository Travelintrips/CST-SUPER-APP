import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import {
  getListLogisticOrdersQueryKey,
  getListLogisticOrderRfqsQueryKey,
  getListLogisticOrderQuotesQueryKey,
  getListFreightShipmentsQueryKey,
  getListSalesDocumentsQueryKey,
  getListPurchaseDocumentsQueryKey,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";

export interface AlertPayload {
  id: number;
  alertType: string;
  entityType: string;
  entityId?: number | null;
  entityRef?: string | null;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  createdAt: string;
}

interface InvalidationPayload {
  scope: string;
  entityId?: number;
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: "🚨 Kritis",
  warning: "⚠️ Peringatan",
  info: "ℹ️ Info",
};

// ── Module-level event emitter ─────────────────────────────────────────────────
type InvalidationListener = (scope: string, entityId?: number) => void;
type ConnectionListener = (connected: boolean) => void;

const _invalidationListeners = new Set<InvalidationListener>();
const _connectionListeners = new Set<ConnectionListener>();
let _isConnected = false;

function _setConnected(v: boolean) {
  if (_isConnected === v) return;
  _isConnected = v;
  _connectionListeners.forEach((fn) => fn(v));
}

function _emitInvalidation(scope: string, entityId?: number) {
  _invalidationListeners.forEach((fn) => fn(scope, entityId));
}

/** Subscribe to invalidation events from the SSE stream.
 *  Returns an unsubscribe function. */
export function subscribeToInvalidation(fn: InvalidationListener): () => void {
  _invalidationListeners.add(fn);
  return () => _invalidationListeners.delete(fn);
}

/** Subscribe to SSE connection state changes.
 *  Immediately calls fn with the current state, then on every change. */
export function subscribeToConnection(fn: ConnectionListener): () => void {
  _connectionListeners.add(fn);
  fn(_isConnected);
  return () => _connectionListeners.delete(fn);
}

// ── Query invalidation ─────────────────────────────────────────────────────────
function invalidateByScope(
  qc: ReturnType<typeof useQueryClient>,
  scope: string,
  entityId?: number,
) {
  switch (scope) {
    case "rfq":
      void qc.invalidateQueries({ queryKey: (getListLogisticOrderRfqsQueryKey as (id?: number) => readonly unknown[])() });
      void qc.invalidateQueries({ queryKey: (getListLogisticOrderQuotesQueryKey as (id?: number) => readonly unknown[])() });
      void qc.invalidateQueries({ queryKey: ["vendor-offers"] });
      if (entityId != null) {
        void qc.invalidateQueries({ queryKey: ["vendor-offers", entityId] });
      }
      break;
    case "logistic_orders":
      void qc.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
      void qc.invalidateQueries({ queryKey: ["logistics-dashboard-kpi"] });
      void qc.invalidateQueries({ queryKey: ["logistics-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["operational-dashboard"] });
      if (entityId != null) {
        void qc.invalidateQueries({ queryKey: ["logistic-order", entityId] });
      }
      break;
    case "sales_documents":
      void qc.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
      break;
    case "freight_shipments":
      void qc.invalidateQueries({ queryKey: getListFreightShipmentsQueryKey() });
      break;
    case "approvals":
      void qc.invalidateQueries({ queryKey: ["approvals"] });
      void qc.invalidateQueries({ queryKey: ["approval-stats"] });
      break;
    case "purchase_documents":
      void qc.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
      break;
    case "orders":
      void qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      break;
    default:
      break;
  }
  _emitInvalidation(scope, entityId);
}

let _invalidationToastTimer: ReturnType<typeof setTimeout> | null = null;
const _pendingScopes = new Set<string>();

function scheduleInvalidationToast(
  toastFn: typeof toast,
  scope: string,
) {
  _pendingScopes.add(scope);
  if (_invalidationToastTimer) return;
  _invalidationToastTimer = setTimeout(() => {
    _invalidationToastTimer = null;
    const scopes = Array.from(_pendingScopes);
    _pendingScopes.clear();

    const SCOPE_LABELS: Record<string, string> = {
      rfq: "RFQ",
      logistic_orders: "Order Logistik",
      sales_documents: "Sales Order",
      freight_shipments: "Freight",
      approvals: "Approval",
      purchase_documents: "Purchase",
      orders: "Order",
    };
    const labels = scopes.map((s) => SCOPE_LABELS[s] ?? s).join(", ");
    toastFn({
      title: "Data diperbarui",
      description: `${labels} telah diperbarui oleh admin lain.`,
      duration: 3000,
    });
  }, 800);
}

export function useAlertWebSocket() {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    destroyedRef.current = false;

    function connect() {
      if (destroyedRef.current) return;

      const es = new EventSource("/api/alerts/stream");
      esRef.current = es;

      es.onopen = () => {
        _setConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            alert?: AlertPayload;
            scope?: string;
            entityId?: number;
          };

          if (msg.type === "connected") {
            _setConnected(true);
            return;
          }

          if (msg.type === "new_alert" && msg.alert) {
            const alert = msg.alert;
            qc.invalidateQueries({ queryKey: ["intelligence-alerts"] });
            qc.invalidateQueries({ queryKey: ["intelligence-alerts-summary"] });

            const label = SEVERITY_LABELS[alert.severity] ?? alert.severity;
            toast({
              title: `${label}: ${alert.title}`,
              description: alert.message,
              variant: alert.severity === "critical" ? "destructive" : "default",
            });
            return;
          }

          if (msg.type === "invalidate" && msg.scope) {
            const { scope, entityId } = msg as InvalidationPayload;
            invalidateByScope(qc, scope, entityId);
            scheduleInvalidationToast(toast, scope);
            return;
          }
        } catch {
        }
      };

      es.onerror = () => {
        _setConnected(false);
        es.close();
        esRef.current = null;
        if (!destroyedRef.current) {
          reconnectTimer.current = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      destroyedRef.current = true;
      _setConnected(false);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [qc]);
}
