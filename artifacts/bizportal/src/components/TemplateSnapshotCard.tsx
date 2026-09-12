import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, FileText, Package, ClipboardList, Settings2 } from "lucide-react";

interface ProductTemplate {
  label?: string;
  category?: string;
  version?: string;
  packagingInstructions?: string;
  requiredDocuments?: Array<{ key: string; label: string; required?: boolean }>;
  checklist?: Array<{ key: string; label: string }>;
  customFields?: Array<{ key: string; label: string; type?: string; unit?: string; options?: string[] }>;
}

interface Props {
  templateSnapshot: Record<string, unknown> | null | undefined;
  className?: string;
}

export function TemplateSnapshotCard({ templateSnapshot, className }: Props) {
  if (!templateSnapshot) return null;

  const tpl = templateSnapshot as ProductTemplate;

  const hasDocs = Array.isArray(tpl.requiredDocuments) && tpl.requiredDocuments.length > 0;
  const hasChecklist = Array.isArray(tpl.checklist) && tpl.checklist.length > 0;
  const hasFields = Array.isArray(tpl.customFields) && tpl.customFields.length > 0;
  const hasPacking = typeof tpl.packagingInstructions === "string" && tpl.packagingInstructions.trim().length > 0;

  if (!tpl.label && !hasDocs && !hasChecklist && !hasFields && !hasPacking) return null;

  return (
    <Card className={`border-violet-200/60 bg-violet-50/20 ${className ?? ""}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Package className="h-4 w-4 text-violet-600" />
          <span className="text-violet-800">Template Produk</span>
          {tpl.label && (
            <Badge variant="outline" className="text-xs border-violet-300 text-violet-700 bg-violet-50">
              {tpl.label}
            </Badge>
          )}
          {tpl.version && (
            <span className="text-xs text-muted-foreground">v{tpl.version}</span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        {hasDocs && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="h-3.5 w-3.5 text-violet-600" />
              <span className="text-xs font-semibold text-violet-800 uppercase tracking-wide">Dokumen Wajib</span>
            </div>
            <ul className="space-y-1">
              {(tpl.requiredDocuments ?? []).map((d) => (
                <li key={d.key} className="flex items-center gap-2 text-sm text-foreground/80">
                  {d.required !== false ? (
                    <Circle className="h-3.5 w-3.5 text-violet-400 flex-shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
                  )}
                  <span>{d.label}</span>
                  {d.required !== false && (
                    <span className="text-[10px] text-red-500 font-medium">wajib</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasChecklist && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <ClipboardList className="h-3.5 w-3.5 text-violet-600" />
              <span className="text-xs font-semibold text-violet-800 uppercase tracking-wide">Checklist Persiapan</span>
            </div>
            <ul className="space-y-1">
              {(tpl.checklist ?? []).map((c) => (
                <li key={c.key} className="flex items-center gap-2 text-sm text-foreground/80">
                  <CheckCircle2 className="h-3.5 w-3.5 text-violet-300 flex-shrink-0" />
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasFields && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Settings2 className="h-3.5 w-3.5 text-violet-600" />
              <span className="text-xs font-semibold text-violet-800 uppercase tracking-wide">Spesifikasi Komoditi</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {(tpl.customFields ?? []).map((f) => (
                <div key={f.key} className="text-sm text-foreground/80">
                  <span className="text-muted-foreground text-xs">{f.label}</span>
                  {f.unit && <span className="text-xs text-muted-foreground/60 ml-1">({f.unit})</span>}
                  {Array.isArray(f.options) && f.options.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {f.options.map((o) => (
                        <Badge key={o} variant="secondary" className="text-[10px] py-0">{o}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {hasPacking && (
          <div>
            <span className="text-xs font-semibold text-violet-800 uppercase tracking-wide">Instruksi Pengemasan</span>
            <p className="text-sm text-foreground/80 mt-1 whitespace-pre-wrap">{tpl.packagingInstructions}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
