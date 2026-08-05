"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react"

import { cn } from "@/lib/utils"

/** Recursively flattens any React node tree into a lowercased searchable string. */
function getNodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(getNodeText).join(" ")
  if (React.isValidElement(node)) return getNodeText((node.props as any)?.children)
  return ""
}

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

type RadixSelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>

interface SelectContentProps extends RadixSelectContentProps {
  /** Set to false to hide the built-in search box (e.g. for very short static lists). */
  searchable?: boolean
  searchPlaceholder?: string
  /** Shown when the search query matches nothing. */
  emptyText?: string
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(
  (
    {
      className,
      children,
      position = "popper",
      searchable = true,
      searchPlaceholder = "Cari...",
      emptyText = "Tidak ada hasil.",
      onCloseAutoFocus,
      ...props
    },
    ref
  ) => {
    const [search, setSearch] = React.useState("")
    const inputRef = React.useRef<HTMLInputElement>(null)
    const viewportRef = React.useRef<HTMLDivElement>(null)
    const query = search.trim().toLowerCase()

    // SelectContent mounts fresh each time the popover opens (and unmounts on
    // close), so a mount-effect focus is equivalent to an "on open" focus.
    React.useEffect(() => {
      if (!searchable) return
      const id = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Walks the tree and returns { rendered, matches } where `matches` is the
    // number of SelectItem descendants that pass the query. Only the three
    // known structural primitives (Group/Label/Separator) get special
    // handling; anything else (icons, custom wrappers, plain items) is left
    // untouched so unusual page-specific markup never gets silently dropped.
    const processNode = React.useCallback(
      (node: React.ReactNode): { rendered: React.ReactNode; matches: number } => {
        if (!React.isValidElement(node)) return { rendered: node, matches: 0 }

        if (node.type === SelectItem) {
          const text = getNodeText((node.props as { children?: React.ReactNode }).children).toLowerCase()
          const isMatch = text.includes(query)
          return { rendered: isMatch ? node : null, matches: isMatch ? 1 : 0 }
        }

        if (node.type === SelectSeparator) {
          // Dividers carry no searchable text; drop while filtering so a
          // lone separator never appears between two hidden groups.
          return { rendered: null, matches: 0 }
        }

        if (node.type === SelectLabel) {
          // Always kept as-is; the enclosing group decides visibility.
          return { rendered: node, matches: 0 }
        }

        const nodeChildren = (node.props as { children?: React.ReactNode } | undefined)?.children
        if (node.type === SelectGroup || nodeChildren !== undefined) {
          // SelectGroup and any other element that nests children (Fragment,
          // page-specific wrapper divs, conditional blocks, etc.) — recurse
          // so SelectItem descendants anywhere in the tree are still counted
          // and filtered, then rebuild the wrapper with the filtered kids.
          const kidsArray = React.Children.toArray(nodeChildren)
          const processedKids = kidsArray.map((k) => processNode(k))
          const matches = processedKids.reduce((sum, p) => sum + p.matches, 0)
          // Only Group actually hides itself when empty; generic wrappers
          // (which may carry layout/styling unrelated to options) are kept
          // but with their SelectItem descendants filtered.
          if (node.type === SelectGroup && matches === 0) return { rendered: null, matches: 0 }
          return {
            rendered: React.cloneElement(node, undefined, processedKids.map((p) => p.rendered)),
            matches,
          }
        }

        // Leaf element with no children (icon, plain node, etc.) — pass
        // through untouched and don't let it affect group visibility.
        return { rendered: node, matches: 0 }
      },
      [query]
    )

    const { filtered, itemMatchCount } = React.useMemo(() => {
      if (!query) return { filtered: children, itemMatchCount: null as number | null }
      const processed = React.Children.toArray(children).map((c) => processNode(c))
      return {
        filtered: processed.map((p) => p.rendered),
        itemMatchCount: processed.reduce((sum, p) => sum + p.matches, 0),
      }
    }, [children, query, processNode])

    const hasAnyVisible = itemMatchCount === null || itemMatchCount > 0

    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className
          )}
          position={position}
          onCloseAutoFocus={(e) => {
            setSearch("")
            onCloseAutoFocus?.(e)
          }}
          {...props}
        >
          {searchable && (
            <div
              className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-popover px-2"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (search) {
                    e.preventDefault()
                    e.stopPropagation()
                    setSearch("")
                  }
                  // else: let it bubble so Radix closes the popover normally.
                  return
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  // Move focus from the input into the (roving-focus) item
                  // list instead of stopping the keystroke dead.
                  e.preventDefault()
                  const items = viewportRef.current?.querySelectorAll<HTMLElement>(
                    '[role="option"]:not([data-disabled])'
                  )
                  const target = e.key === "ArrowDown" ? items?.[0] : items?.[items.length - 1]
                  target?.focus()
                  return
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  // Harmless to bubble — nothing focused inside Radix's item
                  // list yet, so this only affects the input itself.
                  return
                }
                // Printable characters / Backspace / etc: keep them local to
                // the input so Radix's content-level typeahead search (which
                // listens on the same bubbling keydown) doesn't also react.
                e.stopPropagation()
              }}
            >
              <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                autoComplete="off"
                className="flex h-8 w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          )}
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            ref={viewportRef}
            className={cn(
              "p-1",
              position === "popper" &&
                "w-full min-w-[var(--radix-select-trigger-width)]"
            )}
          >
            {searchable && !hasAnyVisible ? (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              filtered
            )}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    )
  }
)
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
