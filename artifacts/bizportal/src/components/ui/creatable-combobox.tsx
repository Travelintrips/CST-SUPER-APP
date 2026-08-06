/**
 * CreatableCombobox
 * Searchable dropdown with optional "Add new" action.
 * Styled for the dark BizPortal theme (bg-slate-800 / border-slate-600).
 */

import { useState, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface CreatableComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  /** If true, show "Tambah baru: <query>" button when no exact match */
  onAddNew?: (query: string) => void;
  addNewLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function CreatableCombobox({
  value,
  onChange,
  options,
  placeholder = "Pilih…",
  searchPlaceholder = "Cari…",
  emptyText = "Tidak ditemukan.",
  loading = false,
  onAddNew,
  addNewLabel,
  disabled = false,
  className,
}: CreatableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value ?? "";

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()) ||
    o.value.toLowerCase().includes(query.toLowerCase())
  );

  const exactMatch = options.some(
    (o) =>
      o.value.toLowerCase() === query.toLowerCase() ||
      o.label.toLowerCase() === query.toLowerCase()
  );

  const showAddNew = onAddNew && query.trim().length > 0 && !exactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white shadow-sm",
            "hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-500",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-slate-400",
            className
          )}
        >
          <span className="truncate font-mono text-xs">
            {value ? selectedLabel : placeholder}
          </span>
          {loading ? (
            <Loader2 size={14} className="ml-2 shrink-0 animate-spin text-slate-400" />
          ) : (
            <ChevronsUpDown size={14} className="ml-2 shrink-0 text-slate-400" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 bg-slate-800 border-slate-600 text-white"
        align="start"
        style={{ minWidth: 200 }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            className="text-white placeholder:text-slate-400 border-slate-600"
          />
          <CommandList>
            {filtered.length === 0 && !showAddNew && (
              <CommandEmpty className="text-slate-400 text-sm py-4">{emptyText}</CommandEmpty>
            )}

            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onChange(opt.value === value ? "" : opt.value);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="text-white data-[selected=true]:bg-slate-700 cursor-pointer font-mono text-xs"
                  >
                    <Check
                      size={14}
                      className={cn(
                        "mr-2 shrink-0",
                        value === opt.value ? "opacity-100 text-orange-400" : "opacity-0"
                      )}
                    />
                    {opt.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showAddNew && (
              <>
                {filtered.length > 0 && <CommandSeparator className="bg-slate-700" />}
                <CommandGroup>
                  <CommandItem
                    value={`__add__${query}`}
                    onSelect={() => {
                      onAddNew!(query.trim());
                      setQuery("");
                      setOpen(false);
                    }}
                    className="text-orange-400 data-[selected=true]:bg-slate-700 cursor-pointer text-xs"
                  >
                    <Plus size={14} className="mr-2 shrink-0" />
                    {addNewLabel
                      ? `${addNewLabel}: "${query.trim()}"`
                      : `Tambah baru: "${query.trim()}"`}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>

        {/* Clear button */}
        {value && (
          <div className="border-t border-slate-700 p-1">
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="w-full text-xs text-slate-400 hover:text-white py-1 rounded hover:bg-slate-700 transition-colors"
            >
              Hapus pilihan
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
