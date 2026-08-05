import { useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, RefreshCw, Navigation, AlertTriangle } from "lucide-react";

// Guard: only run once (DriverMap.tsx may have already done this)
if (!(L.Icon.Default as unknown as Record<string, unknown>).__patched__) {
  delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
  (L.Icon.Default as unknown as Record<string, unknown>).__patched__ = true;
}

type GpsPoint = {
  id: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  checkpointType: string | null;
  updatedAt: string;
};

type LocationsResponse = {
  locations: GpsPoint[];
  total: number;
};

type GeofenceAlert = {
  id: number;
  order_id: number;
  actor_name: string | null;
  notes: string | null;
  created_at: string;
};

type GeofenceAlertsResponse = {
  alerts: GeofenceAlert[];
};

const CHECKPOINT_LABELS: Record<string, string> = {
  order_task: "Update dari Mini Form",
  driver_app: "Driver App",
  pickup: "Pickup",
  delivery: "Delivery",
  checkpoint: "Checkpoint",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function makePointIcon(index: number, isFirst: boolean, isLast: boolean) {
  const bg = isFirst ? "#22c55e" : isLast ? "#3b82f6" : "#94a3b8";
  const label = isFirst ? "🟢" : isLast ? "📍" : String(index + 1);
  const size = isFirst || isLast ? 32 : 24;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${bg};
      border:2px solid #fff;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${isFirst || isLast ? 14 : 10}px;
      font-weight:600;color:#fff;
      box-shadow:0 2px 6px rgba(0,0,0,.3);
    ">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

interface GpsTrackingPanelProps {
  orderId: number;
  orderNumber: string;
}

export default function GpsTrackingPanel({ orderId, orderNumber }: GpsTrackingPanelProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<LocationsResponse>({
    queryKey: ["order-gps", orderId],
    queryFn: () => fetch(`/api/logistic/orders/${orderId}/locations`).then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const { data: alertsData, refetch: refetchAlerts } = useQuery<GeofenceAlertsResponse>({
    queryKey: ["order-geofence-alerts", orderId],
    queryFn: () => fetch(`/api/logistic/orders/${orderId}/geofence-alerts`).then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const locations = data?.locations ?? [];
  const alerts = alertsData?.alerts ?? [];
  const hasAlerts = alerts.length > 0;

  const THIRTY_MIN_MS = 30 * 60 * 1000;
  const recentAlert = alerts.find(a => Date.now() - new Date(a.created_at).getTime() < THIRTY_MIN_MS);

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    const map = L.map(mapRef.current, {
      center: [-6.2088, 106.8456],
      zoom: 10,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    leafletRef.current = map;
    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }

    if (locations.length === 0) return;

    const latLngs: [number, number][] = locations.map(p => [p.lat, p.lng]);

    if (locations.length > 1) {
      polylineRef.current = L.polyline(latLngs, {
        color: "#3b82f6",
        weight: 3,
        opacity: 0.7,
        dashArray: "6 4",
      }).addTo(map);
    }

    locations.forEach((pt, i) => {
      const isFirst = i === 0;
      const isLast = i === locations.length - 1;
      const icon = makePointIcon(i, isFirst, isLast);
      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;min-width:160px">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">
            ${isFirst ? "🟢 Titik Pertama" : isLast ? "📍 Titik Terakhir" : `Titik #${i + 1}`}
          </div>
          <div style="font-size:11px;color:#555;margin-bottom:2px">
            ${CHECKPOINT_LABELS[pt.checkpointType ?? ""] ?? pt.checkpointType ?? "GPS Update"}
          </div>
          <div style="font-size:11px;color:#888;margin-bottom:2px">
            ${fmtTime(pt.updatedAt)}
          </div>
          <div style="font-size:10px;color:#bbb">
            ${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}
          </div>
          ${pt.accuracy != null ? `<div style="font-size:10px;color:#bbb">Akurasi: ±${Math.round(pt.accuracy)}m</div>` : ""}
          ${pt.speed != null ? `<div style="font-size:10px;color:#bbb">Kecepatan: ${pt.speed} km/h</div>` : ""}
          <a href="https://maps.google.com/?q=${pt.lat},${pt.lng}" target="_blank"
            style="font-size:11px;color:#3b82f6;display:block;margin-top:6px">
            Buka di Google Maps ↗
          </a>
        </div>`;
      const marker = L.marker([pt.lat, pt.lng], { icon })
        .addTo(map)
        .bindPopup(popupHtml);
      markersRef.current.push(marker);
    });

    try {
      map.fitBounds(latLngs, { padding: [40, 40], maxZoom: 15 });
    } catch {}
  }, [locations]);

  const handleFitBounds = useCallback(() => {
    const map = leafletRef.current;
    if (!map || locations.length === 0) return;
    const latLngs: [number, number][] = locations.map(p => [p.lat, p.lng]);
    try { map.fitBounds(latLngs, { padding: [40, 40], maxZoom: 15 }); } catch {}
  }, [locations]);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-emerald-500" />
            Pelacakan GPS — {orderNumber}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {hasAlerts && (
              <Badge className="bg-red-50 text-red-700 border-red-200 gap-1">
                <AlertTriangle className="w-3 h-3" />
                {alerts.length} geofence alert
              </Badge>
            )}
            {locations.length > 0 && (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
                <Navigation className="w-3 h-3" />
                {locations.length} titik
              </Badge>
            )}
            {lastUpdated && (
              <span className="text-xs text-slate-400">Diperbarui {lastUpdated}</span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { void refetch(); void refetchAlerts(); }} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            {locations.length > 1 && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleFitBounds}>
                Fit Peta
              </Button>
            )}
          </div>
        </div>

        {recentAlert && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-red-700">Geofence Alert Aktif</p>
              <p className="text-xs text-red-600">{recentAlert.notes}</p>
              <p className="text-xs text-red-400 mt-0.5">{fmtTime(recentAlert.created_at)}</p>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Memuat data GPS...</span>
          </div>
        ) : locations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2 px-4">
            <MapPin className="w-10 h-10 opacity-20" />
            <p className="text-sm font-medium">Belum ada data GPS untuk order ini</p>
            <p className="text-xs text-center opacity-70">
              Data GPS akan muncul saat vendor atau driver mengirim lokasi melalui Task Link.
            </p>
          </div>
        ) : (
          <div>
            <div ref={mapRef} style={{ height: "360px", width: "100%" }} />
            <div className="border-t border-slate-100">
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Timeline Lokasi ({locations.length} titik)
                </p>
                <div className="relative pl-4 max-h-56 overflow-y-auto pr-1">
                  <div className="absolute left-1 top-0 bottom-0 w-0.5 bg-slate-100" />
                  <div className="space-y-3">
                    {[...locations].reverse().map((pt, ri) => {
                      const i = locations.length - 1 - ri;
                      const isFirst = i === 0;
                      const isLast = i === locations.length - 1;
                      return (
                        <div key={pt.id} className="relative">
                          <div className={`absolute -left-[13px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${isLast ? "bg-blue-500" : isFirst ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <div className="pl-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-slate-700">
                                {isFirst ? "🟢 Pertama" : isLast ? "📍 Terbaru" : `#${i + 1}`}
                              </span>
                              {pt.checkpointType && (
                                <Badge className="text-xs h-4 bg-slate-100 text-slate-600 border-0">
                                  {CHECKPOINT_LABELS[pt.checkpointType] ?? pt.checkpointType}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {fmtTime(pt.updatedAt)}
                              {pt.accuracy != null && ` · ±${Math.round(pt.accuracy)}m`}
                              {pt.speed != null && ` · ${pt.speed} km/h`}
                            </p>
                            <a
                              href={`https://maps.google.com/?q=${pt.lat},${pt.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline"
                            >
                              {pt.lat.toFixed(5)}, {pt.lng.toFixed(5)} ↗
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {hasAlerts && (
              <div className="border-t border-red-100 bg-red-50/40">
                <div className="px-4 py-3">
                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Riwayat Geofence Alert ({alerts.length})
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {alerts.map(a => (
                      <div key={a.id} className="text-xs bg-white border border-red-100 rounded-md px-2.5 py-1.5">
                        <p className="text-red-700 font-medium">{a.notes}</p>
                        <p className="text-slate-400 mt-0.5">{fmtTime(a.created_at)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
