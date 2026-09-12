import * as React from "react"
import { AlertTriangle, Inbox } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * QueryState — standardises loading / error / empty / data states.
 *
 * Usage:
 *   <QueryState loading={isLoading} error={error} empty={!data?.length}>
 *     {data.map(...)}
 *   </QueryState>
 */

interface QueryStateProps {
  loading?: boolean
  error?: Error | null | unknown
  empty?: boolean
  emptyMessage?: string
  emptyIcon?: React.ReactNode
  /** Number of skeleton rows shown while loading */
  skeletonRows?: number
  skeletonRowClassName?: string
  className?: string
  children: React.ReactNode
}

export function QueryState({
  loading = false,
  error = null,
  empty = false,
  emptyMessage = "Tidak ada data",
  emptyIcon,
  skeletonRows = 4,
  skeletonRowClassName,
  className,
  children,
}: QueryStateProps) {
  if (loading) {
    return (
      <div className={cn("space-y-2", className)}>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} className={cn("h-10 w-full rounded-md", skeletonRowClassName)} />
        ))}
      </div>
    )
  }

  if (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "Terjadi kesalahan saat memuat data. Coba muat ulang halaman."
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4",
          className,
        )}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
        <p className="text-sm text-destructive">{msg}</p>
      </div>
    )
  }

  if (empty) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground",
          className,
        )}
      >
        {emptyIcon ?? <Inbox className="h-10 w-10 opacity-30" />}
        <p className="text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return <>{children}</>
}

/**
 * InlineQueryState — compact variant for use inside table cells or cards.
 */
interface InlineQueryStateProps {
  loading?: boolean
  error?: unknown
  children: React.ReactNode
  skeletonClassName?: string
}

export function InlineQueryState({
  loading = false,
  error = null,
  children,
  skeletonClassName,
}: InlineQueryStateProps) {
  if (loading) return <Skeleton className={cn("h-5 w-24 rounded", skeletonClassName)} />
  if (error) return <span className="text-xs text-destructive">Error</span>
  return <>{children}</>
}
