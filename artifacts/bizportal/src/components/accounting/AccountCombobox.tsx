import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Account {
  id: number;
  code: string;
  name: string;
  isActive?: boolean | null;
}

interface AccountComboboxProps {
  accounts: Account[];
  value: number | null | undefined;
  onChange: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function AccountCombobox({
  accounts,
  value,
  onChange,
  placeholder = "Pilih akun",
  disabled,
  "data-testid": testId,
}: AccountComboboxProps) {
  const [open, setOpen] = useState(false);

  const activeAccounts = accounts.filter((a) => a.isActive !== false);
  const selected = activeAccounts.find((a) => a.id === value);

  return (
    <Popover open={disabled ? false : open} onOpenChange={(o) => { if (!disabled) setOpen(o); }} modal={true}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal h-9 text-sm"
          data-testid={testId}
        >
          <span className="truncate">
            {selected ? `${selected.code} ${selected.name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[360px] p-0"
        align="start"
        side="bottom"
        avoidCollisions={true}
      >
        <Command>
          <CommandInput placeholder="Cari kode atau nama akun..." />
          <CommandList>
            <CommandEmpty>Akun tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              {activeAccounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.code} ${a.name}`}
                  onSelect={() => {
                    onChange(a.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === a.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="font-mono text-xs mr-2 text-muted-foreground">
                    {a.code}
                  </span>
                  {a.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
