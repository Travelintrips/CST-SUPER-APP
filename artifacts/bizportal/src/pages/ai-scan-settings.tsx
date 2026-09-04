import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ScanLine, Save, Loader2, CheckCircle2, Info, X, Plus, RotateCcw, FileSearch, FlaskConical, ChevronDown, ChevronUp, Scissors, CheckCircle, Upload, FileText } from "lucide-react";
import { Link } from "wouter";

type DocGroup = "sales" | "freight" | "customs";

interface FieldDef {
  key: string;
  label: string;
  description: string;
}

interface FieldsResponse {
  fields: Record<DocGroup, FieldDef[]>;
  enabled: Record<DocGroup, Record<string, boolean>>;
}

type EnabledState = Record<DocGroup, Record<string, boolean>>;

const GROUP_LABELS: Record<DocGroup, string> = {
  sales: "Sales / Purchase",
  freight: "Freight / Pengiriman",
  customs: "Bea Cukai",
};

const GROUP_DESCRIPTIONS: Record<DocGroup, string> = {
  sales: "Invoice, Quotation, Purchase Order, dan dokumen transaksi jual-beli",
  freight: "Bill of Lading, Air Waybill, Delivery Order, dan dokumen pengiriman",
  customs: "PIB, PEB, SPPB, NPE, dan dokumen kepabeanan Indonesia",
};

export default function AiScanSettingsPage() {
  const { toast } = useToast();

  // ── Field whitelist ────────────────────────────────────────────────────────
  const [registry, setRegistry] = useState<Record<DocGroup, FieldDef[]> | null>(null);
  const [enabled, setEnabled] = useState<EnabledState>({ sales: {}, freight: {}, customs: {} });
  const [saved, setSaved] = useState<EnabledState>({ sales: {}, freight: {}, customs: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Boilerplate headers ────────────────────────────────────────────────────
  const [bpPhrases, setBpPhrases] = useState<string[]>([]);
  const [bpDefaults, setBpDefaults] = useState<string[]>([]);
  const [bpIsCustom, setBpIsCustom] = useState(false);
  const [bpSaved, setBpSaved] = useState<string[]>([]);
  const [bpLoading, setBpLoading] = useState(true);
  const [bpSaving, setBpSaving] = useState(false);
  const [newPhrase, setNewPhrase] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Boilerplate test panel ─────────────────────────────────────────────────
  const [testOpen, setTestOpen] = useState(false);
  const [testText, setTestText] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const testResult = useMemo(() => {
    if (!testText.trim() || bpPhrases.length === 0) return null;
    // Replicate cleanPdfText logic client-side (same algorithm as server)
    let text = testText.replace(/\n{3,}/g, "\n\n");
    text = text.replace(/^[-_.=*]{5,}\s*$/gm, "").trim();
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].trim().toLowerCase();
      const hit = bpPhrases.find(
        (h) =>
          lower === h ||
          lower.startsWith(h + ":") ||
          lower.startsWith(h + " ") ||
          lower.startsWith(h + ".") ||
          lower.startsWith(h + "-"),
      );
      if (hit) return { matchedPhrase: hit, lineIndex: i, lines };
    }
    return { matchedPhrase: null, lineIndex: -1, lines };
  }, [testText, bpPhrases]);

  const loadFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scan-document/fields", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as FieldsResponse;
      setRegistry(data.fields);
      setEnabled(data.enabled);
      setSaved(JSON.parse(JSON.stringify(data.enabled)) as EnabledState);
    } catch {
      toast({ title: "Gagal memuat pengaturan", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadBoilerplate = useCallback(async () => {
    setBpLoading(true);
    try {
      const res = await fetch("/api/scan-document/boilerplate-headers", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json() as { phrases: string[]; isCustom: boolean; defaults: string[] };
      setBpPhrases(data.phrases);
      setBpSaved(data.phrases);
      setBpIsCustom(data.isCustom);
      setBpDefaults(data.defaults);
    } catch {
      toast({ title: "Gagal memuat daftar boilerplate", variant: "destructive" });
    } finally {
      setBpLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadFields();
    void loadBoilerplate();
  }, [loadBoilerplate, loadFields]);

  async function handleSaveFields() {
    setSaving(true);
    try {
      const res = await fetch("/api/scan-document/fields", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(enabled),
      });
      if (!res.ok) throw new Error();
      setSaved(JSON.parse(JSON.stringify(enabled)) as EnabledState);
      toast({ title: "Pengaturan berhasil disimpan" });
    } catch {
      toast({ title: "Gagal menyimpan", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBoilerplate(phrasesToSave: string[]) {
    setBpSaving(true);
    try {
      const res = await fetch("/api/scan-document/boilerplate-headers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrases: phrasesToSave }),
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as { phrases: string[]; isCustom: boolean };
      setBpPhrases(data.phrases);
      setBpSaved(data.phrases);
      setBpIsCustom(data.isCustom);
      toast({ title: "Frasa boilerplate disimpan" });
    } catch {
      toast({ title: "Gagal menyimpan frasa", variant: "destructive" });
    } finally {
      setBpSaving(false);
    }
  }

  function handleAddPhrase() {
    const trimmed = newPhrase.trim().toLowerCase();
    if (!trimmed) return;
    if (bpPhrases.includes(trimmed)) {
      toast({ title: "Frasa sudah ada dalam daftar", variant: "destructive" });
      return;
    }
    setBpPhrases((prev) => [...prev, trimmed]);
    setNewPhrase("");
    inputRef.current?.focus();
  }

  function handleRemovePhrase(phrase: string) {
    setBpPhrases((prev) => prev.filter((p) => p !== phrase));
  }

  function handleResetBoilerplate() {
    setBpPhrases(bpDefaults);
  }

  async function handlePdfUpload(file: File) {
    setPdfLoading(true);
    setPdfFileName(file.name);
    setTestText("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/scan-document/extract-text", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      const data = await res.json() as { text: string; pages?: number; charCount: number };
      setTestText(data.text);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Gagal mengekstrak teks PDF",
        variant: "destructive",
      });
      setPdfFileName(null);
    } finally {
      setPdfLoading(false);
    }
  }

  function toggleField(group: DocGroup, key: string, value: boolean) {
    setEnabled((prev) => ({
      ...prev,
      [group]: { ...prev[group], [key]: value },
    }));
  }

  function selectAll(group: DocGroup, fields: FieldDef[]) {
    const all: Record<string, boolean> = {};
    for (const f of fields) all[f.key] = true;
    setEnabled((prev) => ({ ...prev, [group]: all }));
  }

  function clearAll(group: DocGroup, fields: FieldDef[]) {
    const none: Record<string, boolean> = {};
    for (const f of fields) none[f.key] = false;
    setEnabled((prev) => ({ ...prev, [group]: none }));
  }

  function isGroupDirty(group: DocGroup): boolean {
    const cur = enabled[group];
    const sav = saved[group];
    const keys = registry?.[group]?.map((f) => f.key) ?? [];
    return keys.some((k) => {
      const curVal = cur[k] !== false;
      const savVal = sav[k] !== false;
      return curVal !== savVal;
    });
  }

  const isDirtyFields = (["sales", "freight", "customs"] as DocGroup[]).some(isGroupDirty);
  const isDirtyBp = JSON.stringify(bpPhrases) !== JSON.stringify(bpSaved);

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <ScanLine className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-xl font-semibold text-gray-900">Pengaturan Scan Dokumen</h1>
            <p className="text-sm text-gray-500">
              Pilih field mana yang diekstrak AI saat memindai dokumen
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-4 bg-violet-50 border border-violet-100 rounded-xl text-sm text-violet-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-violet-500" />
          <div className="space-y-1">
            <p className="font-semibold">Cara kerja whitelist field:</p>
            <ul className="list-disc list-inside space-y-0.5 text-violet-700">
              <li>Hanya field yang dicentang yang dikirim ke AI — field tidak aktif tidak diekstrak</li>
              <li>Menonaktifkan field yang tidak perlu mengurangi penggunaan token AI</li>
              <li>Default: semua field aktif (tidak ada perubahan pada perilaku scan yang sudah ada)</li>
              <li>Perubahan berlaku untuk scan berikutnya secara langsung</li>
            </ul>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <Tabs defaultValue="sales">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="sales" className="relative">
                Sales/Purchase
                {isGroupDirty("sales") && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </TabsTrigger>
              <TabsTrigger value="freight" className="relative">
                Freight/Pengiriman
                {isGroupDirty("freight") && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </TabsTrigger>
              <TabsTrigger value="customs" className="relative">
                Bea Cukai
                {isGroupDirty("customs") && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </TabsTrigger>
            </TabsList>

            {(["sales", "freight", "customs"] as DocGroup[]).map((group) => {
              const fields = registry?.[group] ?? [];
              const groupEnabled = enabled[group] ?? {};
              const allChecked = fields.every((f) => groupEnabled[f.key] !== false);
              const checkedCount = fields.filter((f) => groupEnabled[f.key] !== false).length;

              return (
                <TabsContent key={group} value={group} className="mt-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <CardTitle className="text-base">{GROUP_LABELS[group]}</CardTitle>
                          <CardDescription className="mt-0.5">
                            {GROUP_DESCRIPTIONS[group]}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-500">
                            {checkedCount}/{fields.length} aktif
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => allChecked ? clearAll(group, fields) : selectAll(group, fields)}
                          >
                            {allChecked ? "Hapus Semua" : "Pilih Semua"}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1">
                        {fields.map((field) => {
                          const checked = groupEnabled[field.key] !== false;
                          return (
                            <label
                              key={field.key}
                              className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(val) =>
                                  toggleField(group, field.key, val === true)
                                }
                                className="mt-0.5 shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium leading-tight ${checked ? "text-gray-900" : "text-gray-400"}`}>
                                  {field.label}
                                </p>
                                <p className={`text-xs mt-0.5 leading-snug ${checked ? "text-gray-500" : "text-gray-300"}`}>
                                  {field.description}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              );
            })}
          </Tabs>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            {!isDirtyFields && !loading && (
              <div className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Tersimpan
              </div>
            )}
            {isDirtyFields && (
              <span className="text-xs text-amber-600 font-medium">Ada perubahan belum disimpan</span>
            )}
          </div>
          <Button
            onClick={handleSaveFields}
            disabled={!isDirtyFields || saving || loading}
            className="gap-2 bg-violet-600 hover:bg-violet-500"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Simpan Pengaturan
          </Button>
        </div>

        {/* ── Boilerplate Headers Card ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <FileSearch className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Pemotong Boilerplate</CardTitle>
                  <CardDescription>
                    Frasa header yang memicu pemotongan teks PDF saat scan. Teks setelah frasa ini dianggap syarat &amp; ketentuan dan tidak dikirim ke AI.
                  </CardDescription>
                </div>
              </div>
              {!isDirtyBp && !bpLoading && (
                <div className="flex items-center gap-1.5 text-xs text-green-600 shrink-0">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {bpIsCustom ? "Custom" : "Default"}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {bpLoading ? (
              <div className="flex items-center justify-center h-24">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                {!bpIsCustom && !isDirtyBp && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                    <span>Menggunakan daftar bawaan sistem. Tambah atau hapus frasa untuk membuat daftar kustom.</span>
                  </div>
                )}

                {/* Phrase chips */}
                <div className="flex flex-wrap gap-2 min-h-[48px] p-3 bg-gray-50 border rounded-lg">
                  {bpPhrases.length === 0 ? (
                    <span className="text-xs text-gray-400 self-center">Tidak ada frasa — akan menggunakan daftar bawaan saat disimpan.</span>
                  ) : (
                    bpPhrases.map((phrase) => (
                      <Badge
                        key={phrase}
                        variant="secondary"
                        className="gap-1.5 pr-1 text-xs font-normal bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        {phrase}
                        <button
                          type="button"
                          onClick={() => handleRemovePhrase(phrase)}
                          className="rounded-full hover:bg-gray-200 p-0.5 transition-colors"
                          aria-label={`Hapus "${phrase}"`}
                        >
                          <X className="h-3 w-3 text-gray-500" />
                        </button>
                      </Badge>
                    ))
                  )}
                </div>

                {/* Add phrase input */}
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={newPhrase}
                    onChange={(e) => setNewPhrase(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddPhrase(); }
                    }}
                    placeholder="Tambah frasa baru, mis: notice to shipper"
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddPhrase}
                    disabled={!newPhrase.trim()}
                    className="gap-1.5 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah
                  </Button>
                </div>

                {/* Test panel */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setTestOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm text-gray-700 font-medium"
                  >
                    <span className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-violet-500" />
                      Uji Coba Frasa
                      <span className="text-xs font-normal text-gray-400">— upload PDF atau tempel teks untuk melihat di mana pemotongan terjadi</span>
                    </span>
                    {testOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </button>

                  {testOpen && (
                    <div className="p-3 space-y-3 border-t bg-white">
                      {/* PDF upload row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          ref={pdfInputRef}
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handlePdfUpload(f);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs h-8 shrink-0"
                          disabled={pdfLoading}
                          onClick={() => pdfInputRef.current?.click()}
                        >
                          {pdfLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          {pdfLoading ? "Mengekstrak teks..." : "Upload PDF"}
                        </Button>
                        {pdfFileName ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-50 border border-violet-200 rounded-md text-xs text-violet-700 min-w-0">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                            <span className="truncate max-w-[220px]">{pdfFileName}</span>
                            <button
                              type="button"
                              onClick={() => { setTestText(""); setPdfFileName(null); }}
                              className="rounded-full hover:bg-violet-200 p-0.5 transition-colors shrink-0 ml-0.5"
                              aria-label="Hapus teks dari PDF"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">atau tempel teks di kotak bawah</span>
                        )}
                      </div>

                      <Textarea
                        value={testText}
                        onChange={(e) => { setTestText(e.target.value); if (pdfFileName) setPdfFileName(null); }}
                        placeholder={"Tempel teks PDF di sini...\n\nCth:\nSHIPPER: PT EXAMPLE\nCONSIGNEE: PT TUJUAN\n\nTERMS AND CONDITIONS\nAll shipments are subject to..."}
                        className="text-xs font-mono resize-none h-36"
                      />

                      {testText.trim() && testResult && (
                        <div className="space-y-2">
                          {testResult.matchedPhrase ? (
                            <>
                              <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                                <Scissors className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                <span>
                                  Frasa <span className="font-semibold">"{testResult.matchedPhrase}"</span> cocok di baris {testResult.lineIndex + 1} — mulai dari baris ini tidak akan dikirim ke AI.
                                </span>
                              </div>
                              <div className="rounded-md border text-xs font-mono overflow-hidden">
                                <div className="max-h-52 overflow-y-auto">
                                  {testResult.lines.map((line, i) => {
                                    const isMatch = i === testResult.lineIndex;
                                    const isDropped = i >= testResult.lineIndex;
                                    return (
                                      <div
                                        key={i}
                                        className={`flex items-start gap-2 px-2.5 py-0.5 ${
                                          isMatch
                                            ? "bg-amber-100 border-l-2 border-amber-400"
                                            : isDropped
                                            ? "bg-gray-50"
                                            : "bg-white text-gray-700"
                                        }`}
                                      >
                                        <span className="shrink-0 w-8 text-right text-gray-300 select-none pt-0.5">
                                          {i + 1}
                                        </span>
                                        <span className={`break-all line-through ${isMatch ? "text-amber-700 font-semibold" : "text-gray-300"}`}>
                                          {line || <span className="opacity-30">&nbsp;</span>}
                                        </span>
                                        {isMatch && (
                                          <span className="ml-auto shrink-0 text-amber-600 font-bold pl-2">✂</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 py-1.5">
                              <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
                              Tidak ada frasa yang cocok — seluruh teks akan dikirim ke AI.
                            </div>
                          )}
                        </div>
                      )}

                      {testText.trim() && bpPhrases.length === 0 && (
                        <p className="text-xs text-gray-400 italic">Tambah frasa di atas untuk menguji pencocokan.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetBoilerplate}
                    disabled={bpSaving}
                    className="gap-2 text-gray-600"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset ke Default
                  </Button>

                  <div className="flex items-center gap-3">
                    {isDirtyBp && (
                      <span className="text-xs text-amber-600 font-medium">Ada perubahan belum disimpan</span>
                    )}
                    <Button
                      onClick={() => void handleSaveBoilerplate(bpPhrases)}
                      disabled={!isDirtyBp || bpSaving}
                      className="gap-2 bg-violet-600 hover:bg-violet-500"
                    >
                      {bpSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Simpan Frasa
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
