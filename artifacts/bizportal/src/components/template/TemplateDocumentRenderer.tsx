import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import type { RequiredDocument, UploadedDocumentRef } from "@workspace/product-templates";

interface Props {
  documents: RequiredDocument[];
  values: UploadedDocumentRef[];
  onChange: (docs: UploadedDocumentRef[]) => void;
  disabled?: boolean;
}

export function TemplateDocumentRenderer({ documents, values, onChange, disabled }: Props) {
  if (!documents.length) return null;

  function getRef(key: string) {
    return values.find((d) => d.key === key)?.reference ?? "";
  }

  function setRef(key: string, label: string, reference: string) {
    const docs = values.filter((d) => d.key !== key);
    if (reference.trim()) docs.push({ key, label, reference: reference.trim() });
    onChange(docs);
  }

  return (
    <div className="mt-3 pl-2 border-l-2 border-blue-400/40 space-y-2">
      <p className="text-xs font-medium text-blue-600 flex items-center gap-1">
        <FileText className="h-3 w-3" /> Dokumen Wajib
      </p>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div key={doc.key} className="grid gap-0.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              {doc.label}
              {doc.required && (
                <Badge variant="destructive" className="text-[9px] py-0 h-3.5 px-1">Wajib</Badge>
              )}
            </Label>
            {disabled ? (
              <div className="h-7 px-2 flex items-center text-xs text-muted-foreground bg-muted/30 rounded border border-input">
                {getRef(doc.key) || <span className="italic">—</span>}
              </div>
            ) : (
              <Input
                value={getRef(doc.key)}
                onChange={(e) => setRef(doc.key, doc.label, e.target.value)}
                placeholder="No. / Referensi dokumen..."
                disabled={disabled}
                className="h-7 text-xs"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
