import { Loader2, CheckCircle2, XCircle } from "lucide-react";

interface CodeCheckIndicatorProps {
  checking: boolean;
  taken: boolean | null;
  takenMsg?: string;
  availableMsg?: string;
}

export function CodeCheckIndicator({
  checking,
  taken,
  takenMsg = "Kode sudah dipakai",
  availableMsg = "Kode tersedia",
}: CodeCheckIndicatorProps) {
  if (checking) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Memeriksa...
      </span>
    );
  }
  if (taken === true) {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive mt-1">
        <XCircle className="h-3.5 w-3.5" />
        {takenMsg}
      </span>
    );
  }
  if (taken === false) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-500 mt-1">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {availableMsg}
      </span>
    );
  }
  return null;
}
