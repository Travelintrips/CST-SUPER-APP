import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Wrench, ChevronDown, ChevronUp, StickyNote } from "lucide-react";

interface Props {
  instructions: string;
  notes?: string;
  onNotesChange?: (notes: string) => void;
  disabled?: boolean;
}

export function TemplateInstructionRenderer({ instructions, notes, onNotesChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  if (!instructions) return null;

  return (
    <div className="mt-3 pl-2 border-l-2 border-amber-400/40">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench className="h-3 w-3" />
        Handling &amp; Packaging
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="rounded bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800 leading-relaxed whitespace-pre-wrap">
            {instructions}
          </div>
          {!disabled && onNotesChange && (
            <div className="grid gap-0.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <StickyNote className="h-3 w-3" /> Catatan Packaging (opsional)
              </Label>
              <Textarea
                value={notes ?? ""}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Instruksi khusus..."
                rows={2}
                className="text-xs resize-none min-h-[36px]"
              />
            </div>
          )}
          {disabled && notes && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1">
              <span className="font-medium">Catatan: </span>{notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
