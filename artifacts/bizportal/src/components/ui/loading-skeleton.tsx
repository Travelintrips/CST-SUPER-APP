import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type SkeletonVariant = "table" | "cards" | "detail" | "form";

interface LoadingSkeletonProps {
  variant?: SkeletonVariant;
  count?: number;
  /** alias for count — used by some pages */
  skeletonRows?: number;
  /** extra class on each row skeleton (ignored by component, accepted for compat) */
  skeletonRowClassName?: string;
  className?: string;
}

export function LoadingSkeleton({
  variant = "table",
  count,
  skeletonRows,
  skeletonRowClassName: _skeletonRowClassName,
  className,
}: LoadingSkeletonProps) {
  const resolvedCount = skeletonRows ?? count ?? 4;
  if (variant === "table") {
    return (
      <div className={cn("space-y-2", className)}>
        <Skeleton className="h-10 w-full rounded-md" />
        {Array.from({ length: resolvedCount }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
        {Array.from({ length: resolvedCount }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className={cn("space-y-4", className)}>
        <Skeleton className="h-8 w-64 rounded-md" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: resolvedCount }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {Array.from({ length: resolvedCount }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
