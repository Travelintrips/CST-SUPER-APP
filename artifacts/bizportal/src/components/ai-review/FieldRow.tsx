/**
 * FieldRow — two-column label + value layout used in detail cards.
 */

interface FieldRowProps {
  label: string;
  value?: React.ReactNode;
}

export function FieldRow({ label, value }: FieldRowProps) {
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
      <span className="text-xs text-right flex-1">{value ?? "—"}</span>
    </div>
  );
}
