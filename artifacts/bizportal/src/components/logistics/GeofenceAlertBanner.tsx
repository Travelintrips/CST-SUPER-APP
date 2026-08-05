import { AlertTriangle, CheckCircle2, X, MapPin, CheckCheck, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useOrderNotificationsContext } from "@/contexts/OrderNotificationsContext";
import type { GeofenceAlertItem } from "@/hooks/useOrderNotifications";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}d lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`;
  return `${Math.floor(diff / 3600)}j lalu`;
}

interface ResolvedNotice {
  id: string;
  driverName: string;
  jobNumber: string;
  at: string;
}

async function resolveAlertApi(id: string) {
  const res = await fetch(`/api/drivers/geofence-alerts/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("resolve failed");
  return res.json();
}

export default function GeofenceAlertBanner() {
  const { geofenceAlerts, dismissGeofenceResolved, resolvedGeofenceNotices } =
    useOrderNotificationsContext();

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveAlertApi(id),
  });

  if (geofenceAlerts.length === 0 && resolvedGeofenceNotices.length === 0) return null;

  return (
    <div className="space-y-2">
      {geofenceAlerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-destructive">
                {alert.driverName}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                #{alert.jobNumber}
              </span>
              <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                {alert.deviationKm.toFixed(1)} km di luar rute
              </span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {timeAgo(alert.triggeredAt)}
              </span>
            </div>
            {(alert.pickupAddress || alert.deliveryAddress) && (
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                {alert.pickupAddress && (
                  <span className="flex items-center gap-1 truncate max-w-[200px]">
                    <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
                    {alert.pickupAddress}
                  </span>
                )}
                {alert.deliveryAddress && (
                  <span className="flex items-center gap-1 truncate max-w-[200px]">
                    <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                    {alert.deliveryAddress}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate(alert.id)}
            >
              {resolveMutation.isPending && resolveMutation.variables === alert.id ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCheck className="w-3 h-3" />
              )}
              Selesai
            </Button>
            <Link href="/logistics/drivers">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10"
              >
                Lihat
              </Button>
            </Link>
          </div>
        </div>
      ))}

      {resolvedGeofenceNotices.map((r: ResolvedNotice) => (
        <div
          key={r.id}
          className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-medium text-emerald-700">{r.driverName}</span>
            <span className="text-muted-foreground"> kembali ke rute · </span>
            <span className="font-mono text-xs text-muted-foreground">#{r.jobNumber}</span>
            <span className="text-muted-foreground"> · {timeAgo(r.at)}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={() => dismissGeofenceResolved(r.id)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
