import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  actionClick?: () => void;
  className?: string;
}

export function EmptyState({
  title = "Tidak ada data",
  description,
  icon,
  actionLabel,
  actionHref,
  actionClick,
  className,
}: EmptyStateProps) {
  const [, navigate] = useLocation();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed py-16 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-6 w-6 opacity-50" />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actionLabel && (actionHref || actionClick) && (
        <Button
          size="sm"
          variant="outline"
          onClick={actionHref ? () => navigate(actionHref!) : actionClick}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
