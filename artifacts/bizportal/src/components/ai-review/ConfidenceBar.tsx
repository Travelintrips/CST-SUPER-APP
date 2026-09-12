/**
 * ConfidenceBar — visual bar showing a confidence percentage.
 * Used in the AI review detail page for intent/COA confidence breakdown.
 */

interface ConfidenceBarProps {
  /** Confidence value — either 0-1 or 0-100. Normalised automatically. */
  value: number;
  /** Optional label displayed to the left of the bar. */
  label?: string;
  className?: string;
}

export function ConfidenceBar({ value, label, className }: ConfidenceBarProps) {
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  const color =
    pct >= 90
      ? "bg-green-500"
      : pct >= 75
      ? "bg-blue-500"
      : pct >= 60
      ? "bg-yellow-500"
      : "bg-red-500";

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {label && (
        <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
      )}
      <div className="flex-1 bg-muted rounded-full h-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`h-2 rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono w-10 text-right">{pct}%</span>
    </div>
  );
}
