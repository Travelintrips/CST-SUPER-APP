import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  retryAction?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Terjadi kesalahan",
  message = "Gagal memuat data. Silakan coba lagi.",
  retryAction,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {message && (
          <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
        )}
      </div>
      {retryAction && (
        <Button size="sm" variant="outline" onClick={retryAction}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Coba Lagi
        </Button>
      )}
    </div>
  );
}
