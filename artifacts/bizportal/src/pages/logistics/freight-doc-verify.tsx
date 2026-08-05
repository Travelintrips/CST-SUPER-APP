import { useState, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft, Upload, FileText, CheckCircle2, AlertTriangle, XCircle,
  Loader2, Plus, X, ShieldCheck, History, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { id } from "date-fns/locale";

const DOC_LABELS = [
  "MAWB", "HAWB", "BL", "Sea Waybill", "Invoice",
  "Packing List", "PIB", "PEB", "SPPB", "NPE", "Delivery Order", "Other",
] as const;

type DocLabel = typeof DOC_LABELS[number];

interface DocSlot {
  label: DocLabel;
  file: File | null;
}

interface Discrepancy {
  field: string;
  severity: "ok" | "warning" | "critical";
  description: string;
  values: Record<string, string | number | null>;
}

interface VerifyResult {
  id: number | null;
  docs: Array<{ label: string; data: Record<string, unknown> }>;
  verdict: "ok" | "warning" | "critical";
  summary: string;
  discrepancies: Discrepancy[];
}

interface HistoryItem {
  id: number;
  created_at: string;
  shipment_ref: string | null;
  doc_labels: string[];
  verdict: "ok" | "warning" | "critical";
  ai_summary: string;
}

const VERDICT_CONFIG = {
  ok: {
    icon: CheckCircle2,
    label: "Semua Sesuai",
    badge: "bg-green-100 text-green-800 border-green-200",
    card: "border-green-200 bg-green-50",
    text: "text-green-700",
  },
  warning: {
    icon: AlertTriangle,
    label: "Perlu Perhatian",
    badge: "bg-yellow-100 text-yellow-800 border-yellow-200",
    card: "border-yellow-200 bg-yellow-50",
    text: "text-yellow-700",
  },
  critical: {
    icon: XCircle,
    label: "Ada Ketidaksesuaian",
    badge: "bg-red-100 text-red-800 border-red-200",
    card: "border-red-200 bg-red-50",
    text: "text-red-700",
  },
};

const SEV_CONFIG = {
  ok: { label: "OK", cls: "bg-green-100 text-green-700 border-green-200" },
  warning: { label: "Peringatan", cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  critical: { label: "Kritis", cls: "bg-red-100 text-red-700 border-red-200" },
};

const FIELD_LABEL: Record<string, string> = {
  grossWeight: "Berat Kotor (kg)", netWeight: "Berat Bersih (kg)", pieces: "Jumlah Pieces",
  cbm: "Volume (CBM)", shipperName: "Shipper", consigneeName: "Consignee",
  hsCode: "HS Code", commodity: "Komoditi", awbNumber: "No. AWB",
  blNumber: "No. B/L", containerNo: "No. Container", origin: "Asal",
  destination: "Tujuan", invoiceValue: "Nilai Invoice", currency: "Mata Uang",
};

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("id-ID");
  return String(v);
}

function DocSlotCard({
  slot,
  index,
  onChange,
  onRemove,
}: {
  slot: DocSlot;
  index: number;
  onChange: (i: number, label: DocLabel, file: File | null) => void;
  onRemove: (i: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border rounded-xl p-4 bg-white flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">Dokumen {index + 1}</span>
        <button onClick={() => onRemove(index)} className="text-slate-400 hover:text-red-500 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Select value={slot.label} onValueChange={(v) => onChange(index, v as DocLabel, slot.file)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Pilih tipe dokumen" />
        </SelectTrigger>
        <SelectContent>
          {DOC_LABELS.map((l) => (
            <SelectItem key={l} value={l}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {slot.file ? (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <FileText className="h-4 w-4 text-blue-600 shrink-0" />
          <span className="text-xs text-blue-700 truncate flex-1">{slot.file.name}</span>
          <button
            onClick={() => { onChange(index, slot.label, null); if (inputRef.current) inputRef.current.value = ""; }}
            className="text-blue-400 hover:text-red-500 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-3 text-sm text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors justify-center"
        >
          <Upload className="h-4 w-4" />
          Pilih file (PDF / Gambar)
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onChange(index, slot.label, f);
        }}
      />
    </div>
  );
}

function DiscrepancyRow({ d }: { d: Discrepancy }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEV_CONFIG[d.severity];
  const fieldLabel = FIELD_LABEL[d.field] ?? d.field;

  return (
    <div className={`rounded-lg border p-3 ${d.severity === "critical" ? "border-red-200 bg-red-50" : d.severity === "warning" ? "border-yellow-200 bg-yellow-50" : "border-green-200 bg-green-50"}`}>
      <div className="flex items-start gap-3">
        <Badge className={`text-xs border shrink-0 mt-0.5 ${sev.cls}`}>{sev.label}</Badge>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-800">{fieldLabel}</span>
            <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-600 shrink-0">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">{d.description}</p>
          {expanded && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {Object.entries(d.values).map(([docLabel, val]) => (
                <div key={docLabel} className="rounded bg-white/70 border px-2 py-1.5">
                  <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{docLabel}</div>
                  <div className="text-xs text-slate-800 font-mono mt-0.5">{formatVal(val)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocDataCard({ doc }: { doc: { label: string; data: Record<string, unknown> } }) {
  const [expanded, setExpanded] = useState(false);
  const fields = Object.entries(doc.data).filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <span className="font-medium text-sm text-slate-800">{doc.label}</span>
          <span className="text-xs text-slate-500">({fields.length} field terekstrak)</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="border-t px-4 py-3 grid grid-cols-2 gap-2">
          {fields.map(([key, val]) => (
            <div key={key} className="rounded bg-slate-50 px-2 py-1.5">
              <div className="text-[10px] text-slate-500 font-medium">{FIELD_LABEL[key] ?? key}</div>
              <div className="text-xs text-slate-800 font-mono mt-0.5 break-all">{formatVal(val)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FreightDocVerifyPage() {
  const { toast } = useToast();
  const [slots, setSlots] = useState<DocSlot[]>([
    { label: "MAWB", file: null },
    { label: "Invoice", file: null },
  ]);
  const [shipmentRef, setShipmentRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: historyData } = useQuery<{ items: HistoryItem[] }>({
    queryKey: ["freight-doc-verify-history"],
    queryFn: async () => {
      const res = await fetch("/api/freight/cross-doc-verify/history?limit=10", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal ambil histori");
      return res.json();
    },
    enabled: showHistory,
  });

  function addSlot() {
    if (slots.length >= 5) return;
    setSlots((prev) => [...prev, { label: "Packing List", file: null }]);
  }

  function updateSlot(i: number, label: DocLabel, file: File | null) {
    setSlots((prev) => prev.map((s, idx) => idx === i ? { label, file } : s));
  }

  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleVerify() {
    const filledSlots = slots.filter((s) => s.file !== null);
    if (filledSlots.length === 0) {
      toast({ title: "Upload minimal 1 dokumen", variant: "destructive" });
      return;
    }
    if (filledSlots.length < 2) {
      toast({ title: "Untuk cross-check, upload minimal 2 dokumen", variant: "destructive" });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      filledSlots.forEach((slot, i) => {
        formData.append(`doc${i}`, slot.file!);
        formData.append(`label${i}`, slot.label);
      });
      if (shipmentRef) formData.append("shipmentRef", shipmentRef);

      const res = await fetch("/api/freight/cross-doc-verify", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Gagal verifikasi" }));
        throw new Error(err.message ?? "Gagal verifikasi");
      }

      const data = (await res.json()) as VerifyResult;
      setResult(data);
    } catch (err) {
      toast({
        title: "Gagal memverifikasi dokumen",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const criticalCount = result?.discrepancies.filter((d) => d.severity === "critical").length ?? 0;
  const warningCount = result?.discrepancies.filter((d) => d.severity === "warning").length ?? 0;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/logistics">
            <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              <h1 className="text-xl font-bold text-slate-900">Cross-Document Verification</h1>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              AI membandingkan data antar dokumen (MAWB, BL, Invoice, Packing List) untuk mendeteksi ketidaksesuaian
            </p>
          </div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <History className="h-4 w-4" />
            Histori
          </button>
        </div>

        {/* Histori panel */}
        {showHistory && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Histori Verifikasi Terbaru</CardTitle>
            </CardHeader>
            <CardContent>
              {!historyData ? (
                <div className="text-center py-6 text-slate-400 text-sm">Memuat...</div>
              ) : historyData.items.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">Belum ada histori</div>
              ) : (
                <div className="space-y-2">
                  {historyData.items.map((item) => {
                    const vc = VERDICT_CONFIG[item.verdict ?? "ok"];
                    const VIcon = vc.icon;
                    return (
                      <div key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 ${vc.card}`}>
                        <VIcon className={`h-4 w-4 mt-0.5 shrink-0 ${vc.text}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs border ${vc.badge}`}>{vc.label}</Badge>
                            {item.shipment_ref && (
                              <span className="text-xs text-slate-500 font-mono">{item.shipment_ref}</span>
                            )}
                            <span className="text-xs text-slate-400 ml-auto">
                              {format(new Date(item.created_at), "d MMM yyyy HH:mm", { locale: id })}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 mt-1">
                            {item.doc_labels?.join(", ")}
                          </div>
                          {item.ai_summary && (
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.ai_summary}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Upload */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Upload Dokumen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-slate-500">Referensi Shipment (opsional)</Label>
                  <Input
                    placeholder="Misal: SHP-2026-001 atau AWB 081-12345678"
                    value={shipmentRef}
                    onChange={(e) => setShipmentRef(e.target.value)}
                    className="mt-1 h-8 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  {slots.map((slot, i) => (
                    <DocSlotCard
                      key={i}
                      slot={slot}
                      index={i}
                      onChange={updateSlot}
                      onRemove={removeSlot}
                    />
                  ))}
                </div>

                {slots.length < 5 && (
                  <button
                    onClick={addSlot}
                    className="w-full flex items-center gap-1.5 justify-center rounded-lg border-2 border-dashed border-slate-200 py-2 text-sm text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Tambah dokumen ({slots.length}/5)
                  </button>
                )}

                <Button
                  onClick={handleVerify}
                  disabled={loading || slots.filter((s) => s.file).length < 2}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      AI sedang menganalisis...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4 mr-2" />
                      Mulai Verifikasi ({slots.filter((s) => s.file).length} dokumen)
                    </>
                  )}
                </Button>
                <p className="text-xs text-slate-400 text-center">
                  Upload minimal 2 dokumen untuk cross-checking
                </p>
              </CardContent>
            </Card>

            {/* Panduan */}
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold text-blue-800 mb-2">Dokumen yang direkomendasikan</h3>
                <ul className="space-y-1 text-xs text-blue-700">
                  <li>• <strong>MAWB/BL</strong> — sebagai dokumen utama pengiriman</li>
                  <li>• <strong>Invoice</strong> — verifikasi nilai & komoditi</li>
                  <li>• <strong>Packing List</strong> — verifikasi berat & jumlah</li>
                  <li>• <strong>PIB/PEB</strong> — verifikasi data kepabeanan</li>
                </ul>
                <h3 className="text-sm font-semibold text-blue-800 mb-2 mt-3">Yang dicek AI</h3>
                <ul className="space-y-1 text-xs text-blue-700">
                  <li>• Berat kotor & bersih antar dokumen</li>
                  <li>• Jumlah pieces / koli</li>
                  <li>• HS Code & komoditi</li>
                  <li>• Nama shipper & consignee</li>
                  <li>• Nomor AWB/BL & container</li>
                  <li>• Volume (CBM)</li>
                  <li>• Nilai invoice vs nilai pabean</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Right: Result */}
          <div className="space-y-4">
            {loading && (
              <Card className="border-blue-200">
                <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                  <p className="text-sm font-medium text-slate-700">AI mengekstrak & membandingkan dokumen...</p>
                  <p className="text-xs text-slate-400 text-center max-w-xs">
                    Proses ini membutuhkan waktu 10–30 detik tergantung jumlah & ukuran dokumen
                  </p>
                </CardContent>
              </Card>
            )}

            {result && !loading && (() => {
              const vc = VERDICT_CONFIG[result.verdict ?? "ok"];
              const VIcon = vc.icon;
              return (
                <div className="space-y-4">
                  {/* Verdict card */}
                  <div className={`rounded-xl border-2 p-5 ${vc.card}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <VIcon className={`h-7 w-7 ${vc.text}`} />
                      <div>
                        <h2 className={`text-lg font-bold ${vc.text}`}>{vc.label}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                          {criticalCount > 0 && (
                            <Badge className="bg-red-100 text-red-700 border border-red-200 text-xs">
                              {criticalCount} Kritis
                            </Badge>
                          )}
                          {warningCount > 0 && (
                            <Badge className="bg-yellow-100 text-yellow-700 border border-yellow-200 text-xs">
                              {warningCount} Peringatan
                            </Badge>
                          )}
                          {result.discrepancies.filter((d) => d.severity === "ok").length > 0 && (
                            <Badge className="bg-green-100 text-green-700 border border-green-200 text-xs">
                              {result.discrepancies.filter((d) => d.severity === "ok").length} Sesuai
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{result.summary}</p>
                  </div>

                  {/* Discrepancies */}
                  {result.discrepancies.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-slate-400" />
                        Detail Pemeriksaan
                      </h3>
                      {[...result.discrepancies]
                        .sort((a, b) => {
                          const order = { critical: 0, warning: 1, ok: 2 };
                          return order[a.severity] - order[b.severity];
                        })
                        .map((d, i) => (
                          <DiscrepancyRow key={i} d={d} />
                        ))}
                    </div>
                  )}

                  {/* Extracted data per doc */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-slate-400" />
                      Data Terekstrak per Dokumen
                    </h3>
                    {result.docs.map((doc, i) => (
                      <DocDataCard key={i} doc={doc} />
                    ))}
                  </div>
                </div>
              );
            })()}

            {!result && !loading && (
              <Card className="border-dashed border-slate-200">
                <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <ShieldCheck className="h-12 w-12 opacity-30" />
                  <p className="text-sm text-center">
                    Upload minimal 2 dokumen dan klik <strong>Mulai Verifikasi</strong> untuk memulai analisis AI
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
