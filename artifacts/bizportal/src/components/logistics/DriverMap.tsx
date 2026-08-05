import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Map as MapIcon, Navigation, WifiOff } from "lucide-react";

if (!(L.Icon.Default as unknown as Record<string, unknown>).__patched__) {
  delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
  (L.Icon.Default as unknown as Record<string, unknown>).__patched__ = true;
}

interface DriverLocation {
  driverId: number;
  name: string;
  vehiclePlate: string | null;
  lat: number;
  lng: number;
  updatedAt: string;
  jobStatus?: string;
}

interface Driver {
  id: number;
  name: string;
  vehiclePlate: string | null;
  currentLat: string | null;
  currentLng: string | null;
  lastLocationAt: string | null;
}

interface ActiveJob {
  driverId: number;
  status: string;
  jobNumber: string;
}

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: "Ditugaskan",
  ACCEPTED: "Diterima",
  ON_THE_WAY_TO_PICKUP: "Menuju Pickup",
  ARRIVED_AT_PICKUP: "Tiba Pickup",
  PICKED_UP: "Barang Diambil",
  IN_TRANSIT: "Dalam Perjalanan",
  ARRIVED_AT_DESTINATION: "Tiba di Tujuan",
  DELIVERED: "Terkirim",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

function makeMarkerIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:36px;height:36px;
        background:${color};
        border:3px solid #fff;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
        display:flex;align-items:center;justify-content:center;
      ">
        <div style="transform:rotate(45deg);font-size:14px;">🚛</div>
      </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -38],
  });
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}d lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`;
  return `${Math.floor(diff / 3600)}j lalu`;
}

interface DriverMapProps {
  drivers: Driver[];
  activeJobByDriver: Record<number, ActiveJob>;
  sseConnected: boolean;
  geofenceAlertDriverIds?: Set<number>;
}

export default function DriverMap({ drivers, activeJobByDriver, sseConnected, geofenceAlertDriverIds = new Set() }: DriverMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const [locations, setLocations] = useState<Map<number, DriverLocation>>(() => {
    const m = new Map<number, DriverLocation>();
    for (const d of drivers) {
      if (d.currentLat && d.currentLng) {
        m.set(d.id, {
          driverId: d.id,
          name: d.name,
          vehiclePlate: d.vehiclePlate,
          lat: parseFloat(d.currentLat),
          lng: parseFloat(d.currentLng),
          updatedAt: d.lastLocationAt ?? new Date().toISOString(),
        });
      }
    }
    return m;
  });

  useEffect(() => {
    setLocations((prev) => {
      const next = new Map(prev);
      for (const d of drivers) {
        if (d.currentLat && d.currentLng) {
          const existing = next.get(d.id);
          if (!existing) {
            next.set(d.id, {
              driverId: d.id,
              name: d.name,
              vehiclePlate: d.vehiclePlate,
              lat: parseFloat(d.currentLat),
              lng: parseFloat(d.currentLng),
              updatedAt: d.lastLocationAt ?? new Date().toISOString(),
            });
          }
        }
      }
      return next;
    });
  }, [drivers]);

  useEffect(() => {
    function handleSse(e: Event) {
      const data = (e as CustomEvent).detail as DriverLocation;
      setLocations((prev) => {
        const next = new Map(prev);
        next.set(data.driverId, data);
        return next;
      });
    }
    window.addEventListener("driver_location_update", handleSse);
    return () => window.removeEventListener("driver_location_update", handleSse);
  }, []);

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

    const currentIds = new Set(locations.keys());

    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    const bounds: [number, number][] = [];
    for (const [driverId, loc] of locations) {
      const job = activeJobByDriver[driverId];
      const isOnJob = job && job.status !== "COMPLETED" && job.status !== "CANCELLED";
      const isDeviated = geofenceAlertDriverIds.has(driverId);
      const color = isDeviated ? "#ef4444" : isOnJob ? "#f97316" : "#22c55e";
      const icon = makeMarkerIcon(color);
      const popupHtml = `
        <div style="min-width:160px;font-family:system-ui,sans-serif">
          ${isDeviated ? `<div style="color:#ef4444;font-size:12px;font-weight:600;margin-bottom:6px;padding:4px 8px;background:#fef2f2;border-radius:4px">⚠️ Keluar jalur rute!</div>` : ""}
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${loc.name}</div>
          ${loc.vehiclePlate ? `<div style="color:#666;font-size:12px;margin-bottom:4px">🚛 ${loc.vehiclePlate}</div>` : ""}
          ${job && isOnJob ? `<div style="font-size:12px;color:#f97316;margin-bottom:4px">📋 ${job.jobNumber} — ${STATUS_LABELS[job.status] ?? job.status}</div>` : ""}
          <div style="font-size:11px;color:#999">⏱ ${timeAgo(loc.updatedAt)}</div>
          <div style="font-size:10px;color:#bbb;margin-top:2px">${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</div>
        </div>`;

      const existing = markersRef.current.get(driverId);
      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]);
        existing.setIcon(icon);
        existing.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([loc.lat, loc.lng], { icon })
          .addTo(map)
          .bindPopup(popupHtml);
        markersRef.current.set(driverId, marker);
      }
      bounds.push([loc.lat, loc.lng]);
    }

    if (bounds.length > 0 && markersRef.current.size === bounds.length) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } catch {}
    }
  }, [locations, activeJobByDriver]);

  const locCount = locations.size;
  const onJobCount = [...locations.keys()].filter((id) => {
    const j = activeJobByDriver[id];
    return j && j.status !== "COMPLETED" && j.status !== "CANCELLED";
  }).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">Peta Lokasi Driver</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {locCount > 0 && (
              <>
                <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/20 gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                  {onJobCount} dalam job
                </Badge>
                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1">
                  <Navigation className="w-3 h-3" />
                  {locCount} terlacak
                </Badge>
              </>
            )}
            {!sseConnected && (
              <Badge variant="outline" className="text-xs gap-1 text-amber-600 bg-amber-500/10 border-amber-500/20">
                <WifiOff className="w-3 h-3" /> Realtime terputus
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {locCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <MapIcon className="w-10 h-10 opacity-20" />
            <p className="text-sm">Belum ada driver dengan data GPS.</p>
            <p className="text-xs opacity-60">Lokasi akan muncul saat driver mengaktifkan GPS dari app.</p>
          </div>
        ) : (
          <div ref={mapRef} style={{ height: "420px", width: "100%", borderRadius: "0 0 8px 8px" }} />
        )}
      </CardContent>
    </Card>
  );
}
