import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X, Save, Eye, Sparkles, History, BookOpen, GitMerge, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/ui/back-button";

const CANONICAL_COLUMNS = [
  "Date", "Description", "Debit", "Credit", "Balance",
  "ERP_CATEGORY", "ENTITY_TYPE", "ENTITY_NAME", "BUSINESS_UNIT",
  "COMPANY", "TAX_TYPE", "PAYMENT_METHOD", "SOURCE_ACCOUNT",
  "PL_FLAG", "ACCOUNTING_CLASS", "UNIQUE_KEY",
] as const;

type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

interface PreviewResult {
  filename: string;
  headers: string[];
  total_rows: number;
  sheets?: { index: number; name: string }[];
  /** Semua baris (maks 20.000) — dipakai untuk POST /save */
  all_rows: Record<string, unknown>[];
  /** 100 baris pertama — hanya untuk tampilan preview tabel */
  preview_rows: Record<string, unknown>[];
  /** true jika file melewati 20.000 baris */
  truncated?: boolean;
  auto_mapping: Record<string, string>;
  canonical_columns: string[];
  /** Sheet yang benar-benar di-parse oleh backend */
  selected_sheet_index?: number;
  /** Sheet terbaik yang terdeteksi otomatis */
  suggested_sheet_index?: number;
  /** true jika sheet ini merupakan sheet mutasi yang valid */
  sheet_valid?: boolean;
  /** Pesan error jika sheet tidak valid */
  sheet_error?: string | null;
}

type Step = "upload" | "mapping" | "saved";

const MAPPING_STORAGE_KEY = "biz_bank_import_last_mapping";

function loadSavedMapping(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistMapping(mapping: Record<string, string>) {
  try {
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mapping));
  } catch { /* ignore */ }
}

interface Company { id: number; name: string; }

async function fetchCompanies(attempt = 0): Promise<Company[]> {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  try {
    const r = await fetch("/api/companies/list", { credentials: "include" });
    if (r.status === 401 && attempt < 3) {
      await delay(1200 * (attempt + 1));
      return fetchCompanies(attempt + 1);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows: unknown = await r.json();
    if (!Array.isArray(rows)) throw new Error("Respons tidak valid");
    return rows.map((c: any) => ({ id: c.id, name: c.name ?? c.companyName ?? String(c.id) }));
  } catch (err) {
    if (attempt < 3) {
      await delay(1200 * (attempt + 1));
      return fetchCompanies(attempt + 1);
    }
    throw err;
  }
}

export default function BankMutationImportPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [autoMappedHeaders, setAutoMappedHeaders] = useState<Set<string>>(new Set());
  const [savedFromHistory, setSavedFromHistory] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [sheetValid, setSheetValid] = useState(true);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [savedBatchId, setSavedBatchId] = useState<number | null>(null);
  const [savedResult, setSavedResult] = useState<{
    total: number; imported: number; skipped: number; skipped_keys: string[];
  } | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companiesRetryIn, setCompaniesRetryIn] = useState<number>(0);
  const [importMode, setImportMode] = useState<"HISTORICAL_IMPORT" | "RECONCILIATION_ONLY">("HISTORICAL_IMPORT");

  const reloadCompanies = useCallback(() => {
    setCompaniesLoading(true);
    setCompaniesError(null);
    setCompaniesRetryIn(0);
    fetchCompanies()
      .then(list => {
        setCompanies(list);
        if (list.length === 1) setCompanyId(String(list[0].id));
        setCompaniesLoading(false);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Gagal memuat daftar perusahaan";
        setCompaniesError(msg);
        setCompaniesLoading(false);
      });
  }, []);

  useEffect(() => { reloadCompanies(); }, [reloadCompanies]);

  useEffect(() => {
    if (!companiesError) return;
    const RETRY_AFTER = 30;
    setCompaniesRetryIn(RETRY_AFTER);
    let remaining = RETRY_AFTER;
    const tick = setInterval(() => {
      remaining -= 1;
      setCompaniesRetryIn(remaining);
      if (remaining <= 0) {
        clearInterval(tick);
        reloadCompanies();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [companiesError, reloadCompanies]);

  // ── Upload & preview ──────────────────────────────────────────────────────
  const doPreview = useCallback(async (file: File, sheetIndex: number, autoDetect = false) => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sheet_index", String(sheetIndex));
      if (autoDetect) fd.append("auto_detect", "1");
      const res = await fetch("/api/bank-mutation-import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview gagal");

      const result = data as PreviewResult;

      // Sinkronkan selected sheet index dengan apa yang benar-benar di-parse backend
      const effectiveIndex = result.selected_sheet_index ?? sheetIndex;
      setSelectedSheetIndex(effectiveIndex);

      // Update validasi sheet
      setSheetValid(result.sheet_valid !== false);
      setSheetError(result.sheet_error ?? null);

      const serverAutoMap: Record<string, string> = data.auto_mapping ?? {};
      const savedMap = loadSavedMapping();

      const merged: Record<string, string> = {};
      const fromHistory = new Set<string>();
      const fromAuto = new Set<string>();

      for (const header of result.headers) {
        if (savedMap[header]) {
          merged[header] = savedMap[header];
          fromHistory.add(header);
        }
      }
      for (const [header, canonical] of Object.entries(serverAutoMap)) {
        merged[header] = canonical;
        fromAuto.add(header);
        fromHistory.delete(header);
      }

      setPreview(result);
      setMapping(merged);
      setAutoMappedHeaders(fromAuto);
      setSavedFromHistory(fromHistory);
      setStep("mapping");
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleFile = useCallback(async (file: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      toast({ title: "Format tidak valid", description: "Hanya .xlsx, .xls, atau .csv.", variant: "destructive" });
      return;
    }
    setCurrentFile(file);
    setSelectedSheetIndex(0);
    // auto_detect=true → backend pilih sheet terbaik otomatis
    await doPreview(file, 0, true);
  }, [doPreview, toast]);

  const handleSheetChange = useCallback(async (idx: number) => {
    if (!currentFile) return;
    setSelectedSheetIndex(idx);
    // Tidak pakai auto_detect — user memilih sheet secara eksplisit
    await doPreview(currentFile, idx, false);
  }, [currentFile, doPreview]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!preview) return;

    if (!sheetValid) {
      toast({
        title: "Sheet tidak valid",
        description: sheetError ?? "Sheet yang dipilih bukan sheet mutasi. Pilih sheet data mutasi.",
        variant: "destructive",
      });
      return;
    }

    const mappedCanonicals = Object.values(mapping);
    if (!mappedCanonicals.includes("Date") || !mappedCanonicals.includes("Description")) {
      toast({
        title: "Mapping tidak lengkap",
        description: "Kolom Date dan Description wajib di-mapping.",
        variant: "destructive",
      });
      return;
    }

    if (!companyId) {
      toast({
        title: "Perusahaan belum dipilih",
        description: "Pilih perusahaan terlebih dahulu sebelum menyimpan.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/bank-mutation-import/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: preview.filename,
          column_mapping: mapping,
          rows: preview.all_rows,
          notes: notes || undefined,
          company_id: Number(companyId),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Simpan gagal");

      persistMapping(mapping);

      // Set import_mode jika RECONCILIATION_ONLY (default HISTORICAL_IMPORT sudah ter-set di DB)
      if (importMode === "RECONCILIATION_ONLY" && data.batch_id) {
        await fetch(`/api/bank-mutation-import/${data.batch_id}/mode`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ import_mode: importMode }),
        });
      }

      setSavedBatchId(data.batch_id);
      setSavedResult({
        total: data.total ?? data.row_count ?? 0,
        imported: data.imported ?? data.row_count ?? 0,
        skipped: data.skipped ?? 0,
        skipped_keys: data.skipped_keys ?? [],
      });
      setStep("saved");
      const skipMsg = data.skipped > 0 ? ` · ${data.skipped} duplikat di-skip` : "";
      toast({
        title: "Berhasil disimpan",
        description: `Batch #${data.batch_id} — ${data.imported} baris diimport${skipMsg}`,
      });
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setPreview(null);
    setMapping({});
    setAutoMappedHeaders(new Set());
    setSavedFromHistory(new Set());
    setNotes("");
    setSavedResult(null);
    setSavedBatchId(null);
    setCompanyId("");
    setCurrentFile(null);
    setSelectedSheetIndex(0);
    setSheetValid(true);
    setSheetError(null);
    setImportMode("HISTORICAL_IMPORT");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Mapping change ────────────────────────────────────────────────────────
  const setColumnMapping = (header: string, canonical: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (canonical === "__none__") {
        delete next[header];
      } else {
        for (const [k, v] of Object.entries(next)) {
          if (v === canonical && k !== header) delete next[k];
        }
        next[header] = canonical;
      }
      return next;
    });
    // Manual change — remove from auto/history badge sets
    setAutoMappedHeaders((prev) => { const s = new Set(prev); s.delete(header); return s; });
    setSavedFromHistory((prev) => { const s = new Set(prev); s.delete(header); return s; });
  };

  const hasMissingDate = !Object.values(mapping).includes("Date");
  const hasMissingDesc = !Object.values(mapping).includes("Description");
  const hasMissingCompany = !companyId;
  const hasInvalidSheet = !sheetValid;
  const autoCount = autoMappedHeaders.size;
  const historyCount = savedFromHistory.size;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <BackButton href="/accounting" />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => window.history.back()} aria-label="Kembali" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">Import Mutasi Bank</h1>
              <p className="text-muted-foreground mt-1">
                Upload file XLSX/CSV mutasi rekening bank ke staging database
              </p>
            </div>
          </div>
          {step !== "upload" && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <X className="w-4 h-4 mr-1" /> Mulai Ulang
            </Button>
          )}
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-3 text-sm">
          {(["upload", "mapping", "saved"] as Step[]).map((s, i) => {
            const labels = ["1. Upload File", "2. Mapping Kolom", "3. Tersimpan"];
            const active = step === s;
            const done =
              (s === "upload" && (step === "mapping" || step === "saved")) ||
              (s === "mapping" && step === "saved");
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="w-8 h-px bg-border" />}
                <span
                  className={
                    active
                      ? "font-semibold text-primary"
                      : done
                        ? "text-green-600 font-medium"
                        : "text-muted-foreground"
                  }
                >
                  {done ? <CheckCircle2 className="inline w-4 h-4 mr-1" /> : null}
                  {labels[i]}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── STEP 1: Upload ── */}
        {step === "upload" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" /> Upload File Mutasi Bank
              </CardTitle>
              <CardDescription>
                Format yang didukung: .xlsx, .xls, .csv · Maks 20 MB · Preview 100 baris pertama
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/30"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {loading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Membaca file…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-10 h-10 text-muted-foreground" />
                    <p className="font-medium">Drag & drop file di sini, atau klik untuk memilih</p>
                    <p className="text-sm text-muted-foreground">.xlsx, .xls, .csv</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />

              {/* Alias hint */}
              <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2">
                <p className="font-medium text-muted-foreground">Header yang dikenali otomatis:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Date", aliases: "Date, Tanggal, Tanggal Transaksi, date & time, Transaction Date" },
                    { label: "Description", aliases: "Description, Deskripsi, Keterangan, Narasi, Uraian" },
                    { label: "Debit", aliases: "Debit, debit" },
                    { label: "Credit", aliases: "Credit, Kredit, credit" },
                    { label: "Balance", aliases: "Balance, Saldo, balance" },
                  ].map(({ label, aliases }) => (
                    <div key={label} className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5">
                      <Badge variant="secondary" className="text-xs">{label}</Badge>
                      <span className="text-xs text-muted-foreground">{aliases}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 2: Mapping ── */}
        {step === "mapping" && preview && (
          <div className="space-y-4">
            {/* File info + Sheet selector */}
            <Card className={hasInvalidSheet ? "border-destructive/60" : ""}>
              <CardContent className="py-4 space-y-3">
                <div className="flex flex-wrap gap-4 items-center">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />
                  <span className="font-medium">{preview.filename}</span>
                  <Badge variant="secondary">{preview.total_rows} baris total</Badge>
                  <Badge variant="outline">{preview.headers.length} kolom</Badge>
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200">DRAFT_IMPORT</Badge>
                </div>
                {preview.sheets && preview.sheets.length > 1 && (
                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t">
                    <span className="text-sm font-medium text-muted-foreground">Pilih sheet:</span>
                    <Select
                      value={String(selectedSheetIndex)}
                      onValueChange={(v) => handleSheetChange(Number(v))}
                    >
                      <SelectTrigger className={`h-9 w-56 text-sm ${hasInvalidSheet ? "border-destructive" : ""}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {preview.sheets.map((s) => (
                          <SelectItem key={s.index} value={String(s.index)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    {!loading && sheetValid && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sheet mutasi terdeteksi
                      </span>
                    )}
                  </div>
                )}
                {/* Validasi sheet — tampil jika sheet tidak valid */}
                {hasInvalidSheet && sheetError && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="text-sm text-destructive">
                      <p className="font-medium">{sheetError}</p>
                      {preview.sheets && preview.sheets.length > 1 && (
                        <p className="text-xs mt-1 text-destructive/80">
                          Gunakan dropdown "Pilih sheet" di atas untuk memilih sheet yang berisi data mutasi.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Auto-mapping summary banner */}
            {(autoCount > 0 || historyCount > 0) && (
              <div className="rounded-lg border bg-green-50 border-green-200 p-4 flex flex-wrap gap-4 text-sm">
                {autoCount > 0 && (
                  <div className="flex items-center gap-2 text-green-800">
                    <Sparkles className="w-4 h-4 text-green-600 shrink-0" />
                    <span>
                      <strong>{autoCount} kolom</strong> terdeteksi otomatis via alias header
                    </span>
                  </div>
                )}
                {historyCount > 0 && (
                  <div className="flex items-center gap-2 text-blue-800">
                    <History className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>
                      <strong>{historyCount} kolom</strong> diisi dari mapping terakhir
                    </span>
                  </div>
                )}
                <span className="text-muted-foreground text-xs self-center">
                  Periksa dan ubah jika perlu sebelum menyimpan.
                </span>
              </div>
            )}

            {/* Column mapping */}
            <Card>
              <CardHeader>
                <CardTitle>Mapping Kolom</CardTitle>
                <CardDescription>
                  Petakan kolom dari file ke field ERP. Kolom yang tidak di-map akan tetap tersimpan di kolom <code>raw</code>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {preview.headers.map((header) => {
                    const isAuto = autoMappedHeaders.has(header);
                    const isHistory = savedFromHistory.has(header);
                    const samples = preview.preview_rows
                      .map(r => r[header])
                      .filter(v => v !== null && v !== undefined && String(v).trim() !== "")
                      .slice(0, 3)
                      .map(v => String(v).trim());
                    return (
                      <div
                        key={header}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${
                          isAuto ? "bg-green-50/60 border-green-200" :
                          isHistory ? "bg-blue-50/60 border-blue-200" :
                          "bg-muted/20"
                        }`}
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm font-medium truncate">{header}</p>
                          {isAuto && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700">
                              <Sparkles className="w-3 h-3" /> Auto-detected
                            </span>
                          )}
                          {isHistory && (
                            <span className="inline-flex items-center gap-1 text-xs text-blue-700">
                              <History className="w-3 h-3" /> Dari riwayat
                            </span>
                          )}
                          {samples.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {samples.map((s, i) => (
                                <span
                                  key={i}
                                  className="inline-block max-w-[120px] truncate rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground font-mono"
                                  title={s}
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-muted-foreground text-xs mt-1">→</span>
                        <div className="w-44 shrink-0">
                          <Select
                            value={mapping[header] ?? "__none__"}
                            onValueChange={(val) => setColumnMapping(header, val)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="— lewati —" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— lewati —</SelectItem>
                              {CANONICAL_COLUMNS.map((col) => (
                                <SelectItem key={col} value={col}>{col}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {mapping[header] ? (
                          <CheckCircle2 className={`w-4 h-4 shrink-0 mt-1 ${isAuto ? "text-green-500" : "text-primary/60"}`} />
                        ) : (
                          <div className="w-4 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Status summary */}
                <div className="mt-4 p-3 rounded-lg bg-muted/40 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-medium">
                    Ter-map: {Object.keys(mapping).length} / {preview.headers.length} kolom
                  </span>
                  {hasInvalidSheet && (
                    <span className="text-destructive flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Sheet tidak valid
                    </span>
                  )}
                  {!hasInvalidSheet && hasMissingDate && (
                    <span className="text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> <b>Date</b> belum di-map
                    </span>
                  )}
                  {!hasInvalidSheet && hasMissingDesc && (
                    <span className="text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> <b>Description</b> belum di-map
                    </span>
                  )}
                  {!hasInvalidSheet && !hasMissingDate && !hasMissingDesc && (
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Kolom wajib sudah terpenuhi
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Company selector */}
            <Card>
              <CardContent className="py-4 space-y-2">
                <Label>
                  Perusahaan <span className="text-destructive">*</span>
                </Label>
                {companiesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memuat daftar perusahaan…
                  </div>
                ) : companiesError ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-destructive flex-1">{companiesError}</p>
                      <Button size="sm" variant="outline" onClick={reloadCompanies}>Coba lagi</Button>
                    </div>
                    {companiesRetryIn > 0 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Auto-retry dalam {companiesRetryIn}s… (database sedang pulih)
                      </p>
                    )}
                  </div>
                ) : (
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger className={hasMissingCompany ? "border-destructive" : ""}>
                      <SelectValue placeholder="Pilih perusahaan…" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {!companiesLoading && !companiesError && hasMissingCompany && (
                  <p className="text-xs text-destructive">Wajib pilih perusahaan sebelum menyimpan.</p>
                )}
              </CardContent>
            </Card>

            {/* Import Mode Selector */}
            <Card>
              <CardContent className="py-4 space-y-3">
                <Label className="flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-muted-foreground" />
                  Mode Import <span className="text-destructive">*</span>
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {([
                    {
                      value: "HISTORICAL_IMPORT" as const,
                      icon: <BookOpen className="w-4 h-4 text-blue-600" />,
                      title: "Historical Import",
                      description: "Untuk data lama. Sistem akan membuat jurnal dan masuk buku besar/laba rugi/pajak.",
                    },
                    {
                      value: "RECONCILIATION_ONLY" as const,
                      icon: <GitMerge className="w-4 h-4 text-purple-600" />,
                      title: "Reconciliation Only",
                      description: "Untuk data setelah aplikasi berjalan. Hanya mencocokkan mutasi ke transaksi existing — tidak membuat jurnal baru jika sudah matched.",
                    },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setImportMode(opt.value)}
                      className={`text-left p-4 rounded-lg border-2 transition-colors ${
                        importMode === opt.value
                          ? opt.value === "RECONCILIATION_ONLY"
                            ? "border-purple-400 bg-purple-50"
                            : "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40 bg-muted/20"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        {opt.icon}
                        <span className="font-medium text-sm">{opt.title}</span>
                        {importMode === opt.value && (
                          <CheckCircle2 className="w-4 h-4 text-primary ml-auto shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-snug">{opt.description}</p>
                    </button>
                  ))}
                </div>
                {importMode === "RECONCILIATION_ONLY" && (
                  <div className="flex items-start gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-700">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    Mode ini tidak akan membuat jurnal baru. Cocok untuk import mutasi bank periode berjalan yang transaksinya sudah ada di aplikasi.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardContent className="py-4 space-y-2">
                <Label>Catatan (opsional)</Label>
                <Textarea
                  placeholder="Misal: Mutasi BCA Juni 2025 — Acc 123-456-789"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </CardContent>
            </Card>

            {/* Preview table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Preview {Math.min(preview.preview_rows.length, 100)} Baris Pertama
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-center">#</TableHead>
                        {preview.headers.map((h) => (
                          <TableHead key={h} className="whitespace-nowrap text-xs">
                            <span className="font-semibold">{h}</span>
                            {mapping[h] && (
                              <span className={`ml-1 text-xs ${autoMappedHeaders.has(h) ? "text-green-600" : "text-primary/70"}`}>
                                →{mapping[h]}
                              </span>
                            )}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.preview_rows.slice(0, 100).map((row, i) => (
                        <TableRow key={i} className="text-xs">
                          <TableCell className="text-center text-muted-foreground">{i + 1}</TableCell>
                          {preview.headers.map((h) => (
                            <TableCell key={h} className="max-w-[180px] truncate">
                              {row[h] === null || row[h] === undefined
                                ? <span className="text-muted-foreground/50">—</span>
                                : String(row[h])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Save button */}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={handleReset} disabled={loading}>
                Batal
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading || hasInvalidSheet || hasMissingDate || hasMissingDesc || hasMissingCompany}
                className="gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Simpan ke Staging ({preview.all_rows.length} baris)
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Saved ── */}
        {step === "saved" && savedBatchId && savedResult && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="py-10 flex flex-col items-center gap-5 text-center">
              <CheckCircle2 className="w-14 h-14 text-green-500" />
              <div>
                <h2 className="text-xl font-semibold">Data Berhasil Disimpan</h2>
                <p className="text-muted-foreground mt-1">
                  Batch <span className="font-mono font-bold">#{savedBatchId}</span> tersimpan dengan status{" "}
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200">DRAFT_IMPORT</Badge>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Mapping kolom ini telah disimpan untuk upload berikutnya.
                </p>
              </div>

              <div className="flex gap-6 text-sm">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-2xl font-bold text-green-600">{savedResult.imported}</span>
                  <span className="text-muted-foreground">Diimport</span>
                </div>
                <div className="w-px bg-border" />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-2xl font-bold text-amber-500">{savedResult.skipped}</span>
                  <span className="text-muted-foreground">Di-skip (duplikat)</span>
                </div>
                <div className="w-px bg-border" />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-2xl font-bold text-foreground">{savedResult.total}</span>
                  <span className="text-muted-foreground">Total baris</span>
                </div>
              </div>

              {savedResult.skipped_keys.length > 0 && (
                <div className="w-full max-w-lg text-left">
                  <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {savedResult.skipped_keys.length} unique_key sudah ada — tidak diimport ulang
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                    {savedResult.skipped_keys.map((k) => (
                      <div key={k} className="font-mono text-xs text-amber-800 py-0.5">{k}</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={() => navigate(`/accounting/bank-mutation-import/${savedBatchId}`)}>
                  <Eye className="w-4 h-4 mr-2" /> Lihat Detail & Validasi
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  <Upload className="w-4 h-4 mr-2" /> Import File Lain
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
