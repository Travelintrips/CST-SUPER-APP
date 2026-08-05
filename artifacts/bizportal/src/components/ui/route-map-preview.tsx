import { useState, useEffect } from "react";
import { MapPin, Route, Clock, Loader2, Navigation } from "lucide-react";

interface Props {
  origin: string;
  destination: string;
  onDistanceFetched?: (km: number | null) => void;
}

const GMAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? "";

export function RouteMapPreview({ origin, destination, onDistanceFetched }: Props) {
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationText, setDurationText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isReady = origin.trim().length > 3 && destination.trim().length > 3;

  useEffect(() => {
    if (!isReady) {
      setDistanceKm(null);
      setDurationText(null);
      return;
    }
    const timer = setTimeout(() => {
      const controller = new AbortController();
      setLoading(true);
      const params = new URLSearchParams({
        origin: origin.trim(),
        destination: destination.trim(),
      });
      fetch(`/api/places/distance?${params.toString()}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => {
          setDistanceKm(d.distanceKm ?? null);
          setDurationText(d.durationText ?? null);
          onDistanceFetched?.(d.distanceKm ?? null);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      return () => controller.abort();
    }, 600);
    return () => clearTimeout(timer);
  }, [origin, destination, isReady]);

  if (!isReady) return null;

  const embedUrl = GMAPS_KEY
    ? `https://www.google.com/maps/embed/v1/directions?key=${GMAPS_KEY}&origin=${encodeURIComponent(origin.trim())}&destination=${encodeURIComponent(destination.trim())}&mode=driving&language=id`
    : null;

  const mapsLink = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin.trim())}&destination=${encodeURIComponent(destination.trim())}&travelmode=driving`;

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-muted/20 mt-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-background/80 border-b border-border text-sm flex-wrap">
        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="truncate max-w-[180px] text-muted-foreground">{origin.trim()}</span>
        <Navigation className="h-3 w-3 text-muted-foreground shrink-0" />
        <MapPin className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="truncate max-w-[180px] text-muted-foreground">{destination.trim()}</span>
        <span className="ml-auto flex items-center gap-2 flex-wrap">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {!loading && distanceKm != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-semibold">
              <Route className="h-3 w-3" />
              {distanceKm.toLocaleString("id-ID")} km
            </span>
          )}
          {!loading && durationText && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs">
              <Clock className="h-3 w-3" />
              {durationText}
            </span>
          )}
          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Navigation className="h-3 w-3" />
            Buka Maps
          </a>
        </span>
      </div>
      {embedUrl ? (
        <iframe
          title="Peta Rute"
          width="100%"
          height="260"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          src={embedUrl}
          className="block"
        />
      ) : (
        <a
          href={mapsLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 h-20 text-sm text-primary hover:underline"
        >
          <Navigation className="h-4 w-4" />
          Buka rute di Google Maps
        </a>
      )}
    </div>
  );
}
