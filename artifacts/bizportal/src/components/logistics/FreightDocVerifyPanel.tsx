import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, Upload, FileText, X, Plus, Loader2,
  CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp,
  ExternalLink,
} from "lucide-react";

const DOC_LABELS = [
  "MAWB", "HAWB", "BL", "Sea Waybill", "Invoice",
  "Packing List", "PIB", "PEB", "SPPB", "NPE", "Delivery Order", "Other",
] as const;
type DocLabel = typeof DOC_LABELS[number];

interface DocSlot { label: DocLabel; file: File | null }
interface Discrepancy {
  field: string; severity: "ok" | "warning" | "critical";
  description: string; values: Record<string, string | number | null>;
}
interface VerifyResult {
  verdict: "ok" | "warning" | "critical";
  summary: string;
  discrepancies: Discrepancy[];
  docs: Array<{ label: string; data: Record<string, unknown> }>;
}

const VERDICT = {
  ok:       { Icon: CheckCircle2, label: "Semua Sesuai",        card: "border-green-200 bg-green-50",  text: "text-green-700",  badge: "bg-green-100 text-green-800 border-green-200" },
  warning:  { Icon: AlertTriangle, label: "Perlu Perhatian",     card: "border-yellow-200 bg-yellow-50", text: "text-yellow-700", badge: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  critical: { Icon: XCircle,       label: "Ada Ketidaksesuaian", card: "border-red-200 bg-red-50",     text: "text-red-700",    badge: "bg-red-100 text-red-800 border-red-200" },
};
const SEV_CLS = {
  ok:       "bg-green-100 text-green-700 border border-green-200",
  warning:  "bg-yellow-100 text-yellow-700 border border-yellow-200",
  critical: "bg-red-100 text-red-700 border border-red-200",
};
const FIELD_LABEL: Record<string, string> = {
  grossWeight: "Berat Kotor (kg)", netWeight: "Berat Bersih (kg)", pieces: "Jumlah Pieces",
  cbm: "Volume (CBM)", shipperName: "Shipper", consigneeName: "Consignee",
  hsCode: "HS Code", commodity: "Komoditi", awbNumber: "No. AWB",
  blNumber: "No. B/L", containerNo: "No. Container", origin: "Asal",
  destination: "Tujuan", invoiceValue: "Nilai Invoice", currency: "Mata Uang",
};
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("id-ID");
  return String(v);
}

function SlotCard({ slot, index, onChange, onRemove }: {
  slot: DocSlot; index: number;
  onChange: (i: number, label: DocLabel, file: File | null) => void;
  onRemove: (i: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="border rounded-lg p-3 bg-white flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Dok. {index + 1}</span>
        <button onClick={() => onRemove(index)} className="text-slate-300 hover:text-red-400 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Select value={slot.label} onValueChange={(v) => onChange(index, v as DocLabel, slot.file)}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{DOC_LABELS.map((l) => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}</SelectContent>
      </Select>
      {slot.file ? (
        <div className="flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1.5">
          <FileText className="h-3 w-3 text-blue-500 shrink-0" />
          <span className="text-[11px] text-blue-700 truncate flex-1">{slot.file.name}</span>
          <button onClick={() => { onChange(index, slot.label, null); if (ref.current) ref.current.value = ""; }}
            className="text-blue-300 hover:text-red-400 transition-colors"><X className="h-3 w-3" /></button>
        </div>
      ) : (
        <button onClick={() => ref.current?.click()}
          className="flex items-center gap-1 justify-center rounded border-2 border-dashed border-slate-200 py-2 text-[11px] text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
          <Upload className="h-3 w-3" /> Pilih file
        </button>
      )}
      <input ref={ref} type="file" accept=".pdf,image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => onChange(index, slot.label, e.target.files?.[0] ?? null)} />
    </div>
  );
}

function DiscRow({ d }: { d: Discrepancy }) {
  const [open, setOpen] = useState(false);
  const bg = d.severity === "critical" ? "border-red-200 bg-red-50" : d.severity === "warning" ? "border-yellow-200 bg-yellow-50" : "border-green-200 bg-green-50";
  return (
    <div className={`rounded-lg border p-2.5 ${bg}`}>
      <div className="flex items-center gap-2">
        <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${SEV_CLS[d.severity]}`}>
          {d.severity === "critical" ? "Kritis" : d.severity === "warning" ? "Peringatan" : "OK"}
        </Badge>
        <span className="text-xs font-medium text-slate-800 flex-1">{FIELD_LABEL[d.field] ?? d.field}</span>
        <button onClick={() => setOpen(!open)} className="text-slate-300 hover:text-slate-500">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mt-1">{d.description}</p>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {Object.entries(d.values).map(([doc, val]) => (
            <div key={doc} className="rounded bg-white/70 border px-2 py-1">
              <div className="text-[9px] text-slate-400 uppercase tracking-wide font-medium">{doc}</div>
              <div className="text-[11px] font-mono text-slate-800">{fmtVal(val)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  shipmentRef: string;
  defaultSlots?: Array<{ label: DocLabel }>;
}

export function FreightDocVerifyPanel({ shipmentRef, defaultSlots }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<DocSlot[]>(
    defaultSlots?.map((s) => ({ label: s.label, file: null })) ??
    [{ label: "MAWB", file: null }, { label: "Invoice", file: null }],
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  function updateSlot(i: number, label: DocLabel, file: File | null) {
    setSlots((p) => p.map((s, idx) => idx === i ? { label, file } : s));
  }
  function removeSlot(i: number) { setSlots((p) => p.filter((_, idx) => idx !== i)); }
  function addSlot() { if (slots.length < 5) setSlots((p) => [...p, { label: "Packing List", file: null }]); }

  const filledCount = slots.filter((s) => s.file).length;

  async function verify() {
    if (filledCount < 2) {
      toast({ title: "Upload minimal 2 dokumen untuk cross-checking", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      slots.filter((s) => s.file).forEach((s, i) => {
        fd.append(`doc${i}`, s.file!);
        fd.append(`label${i}`, s.label);
      });
      fd.append("shipmentRef", shipmentRef);
      const res = await fetch("/api/freight/cross-doc-verify", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Gagal"); }
      setResult(await res.json());
    } catch (err) {
      toast({ title: "Verifikasi gagal", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setLoading(false); }
  }

  const critCount = result?.discrepancies.filter((d) => d.severity === "critical").length ?? 0;
  const warnCount = result?.discrepancies.filter((d) => d.severity === "warning").length ?? 0;

  return (
    <Card className="border-slate-100">
      <CardHeader
        className="pb-2 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center justify-between gap-1.5">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-blue-500" />
            Verifikasi Dokumen AI
          </span>
          <div className="flex items-center gap-2">
            {result && (
              <Badge className={`text-[10px] px-1.5 py-0 border ${VERDICT[result.verdict].badge}`}>
                {critCount > 0 ? `${critCount} Kritis` : warnCount > 0 ? `${warnCount} Peringatan` : "Sesuai"}
              </Badge>
            )}
            {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </div>
        </CardTitle>
      </CardHeader>

      {open && (
        <CardContent className="pt-0 space-y-3">
          <p className="text-[11px] text-slate-400">
            Upload dokumen shipment ini — AI akan mendeteksi ketidaksesuaian berat, jumlah, HS Code, shipper/consignee, dll.
          </p>

          {/* Slots */}
          <div className="space-y-2">
            {slots.map((slot, i) => (
              <SlotCard key={i} slot={slot} index={i} onChange={updateSlot} onRemove={removeSlot} />
            ))}
          </div>

          {slots.length < 5 && (
            <button onClick={addSlot}
              className="w-full flex items-center gap-1 justify-center rounded border-2 border-dashed border-slate-200 py-1.5 text-[11px] text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
              <Plus className="h-3 w-3" /> Tambah dokumen ({slots.length}/5)
            </button>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={verify} disabled={loading || filledCount < 2} className="flex-1">
              {loading
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Menganalisis...</>
                : <><ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Verifikasi ({filledCount} dok)</>}
            </Button>
            <a href="/logistics/doc-verify" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-500 transition-colors whitespace-nowrap">
              <ExternalLink className="h-3 w-3" /> Buka penuh
            </a>
          </div>

          {/* Result */}
          {result && !loading && (() => {
            const vc = VERDICT[result.verdict];
            const VIcon = vc.Icon;
            return (
              <div className={`rounded-xl border-2 p-3 space-y-2 ${vc.card}`}>
                <div className="flex items-center gap-2">
                  <VIcon className={`h-5 w-5 ${vc.text} shrink-0`} />
                  <span className={`text-sm font-semibold ${vc.text}`}>{vc.label}</span>
                  <div className="flex gap-1 ml-auto flex-wrap justify-end">
                    {critCount > 0 && <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border border-red-200">{critCount} Kritis</Badge>}
                    {warnCount > 0 && <Badge className="text-[10px] px-1.5 py-0 bg-yellow-100 text-yellow-700 border border-yellow-200">{warnCount} Peringatan</Badge>}
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">{result.summary}</p>
                <div className="space-y-1.5 pt-1">
                  {[...result.discrepancies]
                    .sort((a, b) => ({ critical: 0, warning: 1, ok: 2 }[a.severity] - { critical: 0, warning: 1, ok: 2 }[b.severity]))
                    .map((d, i) => <DiscRow key={i} d={d} />)}
                </div>
              </div>
            );
          })()}
        </CardContent>
      )}
    </Card>
  );
}
