import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardList } from "lucide-react";
import type { ChecklistItem } from "@workspace/product-templates";

interface Props {
  checklist: ChecklistItem[];
  values: Record<string, boolean>;
  onChange: (key: string, checked: boolean) => void;
  disabled?: boolean;
}

export function TemplateChecklistRenderer({ checklist, values, onChange, disabled }: Props) {
  if (!checklist.length) return null;

  return (
    <div className="mt-3 pl-2 border-l-2 border-green-400/40 space-y-2">
      <p className="text-xs font-medium text-green-600 flex items-center gap-1">
        <ClipboardList className="h-3 w-3" /> Checklist Persiapan
      </p>
      <div className="space-y-1.5">
        {checklist.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <Checkbox
              id={`chk-${item.key}`}
              checked={values[item.key] ?? false}
              onCheckedChange={(v) => !disabled && onChange(item.key, Boolean(v))}
              disabled={disabled}
              className="h-3.5 w-3.5"
            />
            <label
              htmlFor={`chk-${item.key}`}
              className={`text-xs ${disabled ? "cursor-default" : "cursor-pointer"} select-none`}
            >
              {item.label}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
