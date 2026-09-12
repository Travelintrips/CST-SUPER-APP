import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { MapPin, Loader2 } from "lucide-react";

interface Prediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  country?: string;
}

export function GooglePlacesAutocomplete({
  value,
  onChange,
  placeholder = "Ketik alamat...",
  className,
  disabled,
  country = "id",
}: Props) {
  const [inputVal, setInputVal] = useState(value);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputVal(value);
  }, [value]);

  const fetchPredictions = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setPredictions([]); setOpen(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ input: q, country });
      const res = await fetch(`/api/places/autocomplete?${params.toString()}`);
      if (!res.ok) { setPredictions([]); return; }
      const data: { predictions: Prediction[] } = await res.json();
      setPredictions(data.predictions ?? []);
      setOpen((data.predictions ?? []).length > 0);
      setActiveIdx(-1);
    } catch {
      setPredictions([]);
    } finally {
      setLoading(false);
    }
  }, [country]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputVal(val);
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(val), 350);
  };

  const selectPrediction = (p: Prediction) => {
    setOpen(false);
    setPredictions([]);
    setInputVal(p.description);
    onChange(p.description);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, predictions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); selectPrediction(predictions[activeIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin pointer-events-none z-10" />
      )}
      <input
        type="text"
        value={inputVal}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-9 py-1 text-base shadow-sm transition-colors",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
      />
      {open && predictions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-60 overflow-y-auto text-sm">
          {predictions.map((p, i) => (
            <li
              key={p.place_id}
              onMouseDown={(e) => { e.preventDefault(); selectPrediction(p); }}
              className={cn(
                "flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-accent hover:text-accent-foreground",
                i === activeIdx && "bg-accent text-accent-foreground"
              )}
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="font-medium truncate">{p.structured_formatting?.main_text ?? p.description}</p>
                {p.structured_formatting?.secondary_text && (
                  <p className="text-xs text-muted-foreground truncate">{p.structured_formatting.secondary_text}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
