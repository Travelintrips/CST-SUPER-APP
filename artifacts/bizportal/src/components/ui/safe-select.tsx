import * as React from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * SafeSelect — Radix-crash-proof Select wrapper.
 *
 * Rules enforced:
 *  - value is NEVER "" (empty string) — Radix crashes on that
 *  - null / undefined / "" → sentinel "__safe_none__" internally
 *  - onValueChange receives string | null (null = "none selected")
 *  - loading={true} renders Skeleton instead of broken Select
 */

const SENTINEL = "__safe_none__"

function toInternal(v: string | null | undefined): string {
  return v == null || v === "" ? SENTINEL : v
}

function toExternal(v: string): string | null {
  return v === SENTINEL ? null : v
}

export interface SafeSelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SafeSelectProps {
  value: string | null | undefined
  onValueChange: (value: string | null) => void
  options: SafeSelectOption[]
  placeholder?: string
  /** Label shown for the "none" option. Pass null to omit. */
  noneLabel?: string | null
  /** Show Skeleton while async data is loading */
  loading?: boolean
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
  "aria-label"?: string
}

export function SafeSelect({
  value,
  onValueChange,
  options,
  placeholder = "Pilih...",
  noneLabel = "— Pilih —",
  loading = false,
  disabled = false,
  triggerClassName,
  contentClassName,
  "aria-label": ariaLabel,
}: SafeSelectProps) {
  if (loading) {
    return <Skeleton className={cn("h-9 w-full rounded-md", triggerClassName)} />
  }

  return (
    <Select
      value={toInternal(value)}
      onValueChange={(v) => onValueChange(toExternal(v))}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {noneLabel !== null && (
          <SelectItem value={SENTINEL}>{noneLabel}</SelectItem>
        )}
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
