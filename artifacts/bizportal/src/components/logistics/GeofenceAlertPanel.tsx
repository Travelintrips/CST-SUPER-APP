import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, MapPin, Navigation, X, CheckCheck, Loader2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";

export interface GeofenceAlert {
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
  resolvedAt: string | null;
}

interface ResolvedNotice {
  id: string;
  driverName: string;
  jobNumber: string;
  at: string;
}

async function apiFetch(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

async function resolveAlertApi(id: string) {
  const res = await fetch(`/api/drivers/geofence-alerts/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("resolve failed");
  return res.json();
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}d lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`;
  return `${Math.floor(diff / 3600)}j lalu`;
}

interface Props {
  onAlertCountChange?: (count: number) => void;
}

export default function GeofenceAlertPanel({ onAlertCountChange }: Props) {
  const [alerts, setAlerts] = useState<Map<string, GeofenceAlert>>(new Map());
  const [resolved, setResolved] = useState<ResolvedNotice[]>([]);

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveAlertApi(id),
  });

  const { data: initialAlerts = [] } = useQuery<GeofenceAlert[]>({
    queryKey: ["geofence-alerts"],
    queryFn: () => apiFetch("/api/drivers/geofence-alerts"),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!initialAlerts.length) return;
    setAlerts((prev) => {
      const next = new Map(prev);
      for (const a of initialAlerts) next.set(a.id, a);
      return next;
    });
  }, [initialAlerts]);

  useEffect(() => {
    function onAlert(e: Event) {
      const alert = (e as CustomEvent).detail as GeofenceAlert;
      setAlerts((prev) => new Map(prev).set(alert.id, alert));
    }
    function onUpdate(e: Event) {
      const alert = (e as CustomEvent).detail as GeofenceAlert;
      setAlerts((prev) => new Map(prev).set(alert.id, alert));
    }
    function onResolved(e: Event) {
      const data = (e as CustomEvent).detail as { id: string; driverName: string; jobNumber: string };
      setAlerts((prev) => { const next = new Map(prev); next.delete(data.id); return next; });
      setResolved((prev) => [
        { id: data.id, driverName: data.driverName, jobNumber: data.jobNumber, at: new Date().toISOString() },
        ...prev.slice(0, 4),
      ]);
    }
    window.addEventListener("geofence_alert", onAlert);
    window.addEventListener("geofence_alert_update", onUpdate);
    window.addEventListener("geofence_resolved", onResolved);
    return () => {
      window.removeEventListener("geofence_alert", onAlert);
      window.removeEventListener("geofence_alert_update", onUpdate);
      window.removeEventListener("geofence_resolved", onResolved);
    };
  }, []);

  useEffect(() => {
    onAlertCountChange?.(alerts.size);
  }, [alerts.size, onAlertCountChange]);

  function dismissResolved(id: string) {
    setResolved((prev) => prev.filter((r) => r.id !== id));
  }

  const alertList = [...alerts.values()].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  const hasAny = alertList.length > 0 || resolved.length > 0;

  if (!hasAny) return null;

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </div>
          <CardTitle className="text-base text-destructive">Geofence Alert</CardTitle>
          {alertList.length > 0 && (
            <Badge className="bg-destructive text-destructive-foreground ml-auto animate-pulse">
              {alertList.length} aktif
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {alertList.map((alert) => (
          <div key={alert.id} className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">
                    {alert.driverName}{" "}
                    <span className="font-mono text-xs text-muted-foreground">#{alert.jobNumber}</span>
                  </p>
                  <p className="text-xs text-destructive font-medium">
                    Menyimpang {alert.deviationKm.toFixed(1)} km dari rute (batas {alert.thresholdKm} km)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{timeAgo(alert.triggeredAt)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400"
                  disabled={resolveMutation.isPending}
                  onClick={() => resolveMutation.mutate(alert.id)}
                >
                  {resolveMutation.isPending && resolveMutation.variables === alert.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3 h-3" />
                  )}
                  Tandai Selesai
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="flex items-start gap-1">
                <Navigation className="w-3 h-3 mt-0.5 shrink-0 text-blue-500" />
                <span className="line-clamp-2">{alert.pickupAddress ?? "—"}</span>
              </div>
              <div className="flex items-start gap-1">
                <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />
                <span className="line-clamp-2">{alert.deliveryAddress ?? "—"}</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Posisi driver: {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)}
            </div>
          </div>
        ))}

        {resolved.map((r) => (
          <div key={r.id} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-700">
                  {r.driverName} — kembali ke rute
                </p>
                <p className="text-xs text-muted-foreground">Job #{r.jobNumber} · {timeAgo(r.at)}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => dismissResolved(r.id)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
