import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag } from "lucide-react";
import type { ProductTemplate, DynamicFormValues } from "@workspace/product-templates";
import { isFieldVisible } from "@workspace/product-templates";

interface Props {
  template: ProductTemplate;
  values: DynamicFormValues;
  onChange: (next: DynamicFormValues) => void;
  disabled?: boolean;
}

export function TemplateFieldRenderer({ template, values, onChange, disabled }: Props) {
  if (!template.customFields.length) return null;

  function setField(key: string, val: string | number | boolean) {
    const next: DynamicFormValues = {
      ...values,
      customFieldValues: { ...values.customFieldValues, [key]: val },
    };
    if (val !== "" && val !== null && val !== undefined) {
      next.conditionalFlags = { ...next.conditionalFlags, [key]: val };
    }
    onChange(next);
  }

  return (
    <div className="mt-2 pl-2 border-l-2 border-primary/30 space-y-2">
      <p className="text-xs font-medium text-primary/80 flex items-center gap-1">
        <Tag className="h-3 w-3" /> Spesifikasi {template.label}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {template.customFields.map((f) => {
          if (!isFieldVisible(f.key, template, values)) return null;
          const strVal = String(values.customFieldValues[f.key] ?? "");
          return (
            <div key={f.key} className={`grid gap-0.5 ${f.type === "textarea" ? "col-span-2" : ""}`}>
              <Label className="text-xs text-muted-foreground">
                {f.label}
                {f.required && <span className="text-destructive ml-0.5">*</span>}
                {f.unit && <span className="ml-1 text-muted-foreground/70">({f.unit})</span>}
              </Label>
              {f.type === "select" && f.options ? (
                <Select
                  value={strVal}
                  onValueChange={(v) => setField(f.key, v)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="— pilih —" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
                      <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "textarea" ? (
                <Textarea
                  value={strVal}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  disabled={disabled}
                  rows={2}
                  className="text-xs resize-none min-h-[48px]"
                />
              ) : (
                <Input
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={strVal}
                  onChange={(e) =>
                    setField(
                      f.key,
                      f.type === "number"
                        ? e.target.value === "" ? "" : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                  placeholder={f.placeholder}
                  disabled={disabled}
                  className="h-7 text-xs"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
