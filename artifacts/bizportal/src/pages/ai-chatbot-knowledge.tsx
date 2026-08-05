import { useState, useEffect, useRef, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Info,
  ToggleLeft,
  ToggleRight,
  X,
  Save,
  Upload,
  FileText,
  CheckSquare,
  Square,
  FileUp,
  Sparkles,
  CheckCheck,
  ListChecks, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

interface KnowledgeEntry {
  id: number;
  title: string;
  category: string;
  content: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ParsedEntry {
  title: string;
  category: string;
  content: string;
  selected: boolean;
}

const CATEGORIES = [
  { value: "umum", label: "Umum" },
  { value: "harga", label: "Harga & Tarif" },
  { value: "layanan", label: "Layanan" },
  { value: "prosedur", label: "Prosedur & SOP" },
  { value: "dokumen", label: "Dokumen & Syarat" },
  { value: "faq", label: "FAQ" },
  { value: "kebijakan", label: "Kebijakan" },
  { value: "kontak", label: "Kontak & Jam Operasional" },
];

const CATEGORY_COLORS: Record<string, string> = {
  umum: "bg-gray-100 text-gray-700",
  harga: "bg-green-100 text-green-700",
  layanan: "bg-blue-100 text-blue-700",
  prosedur: "bg-orange-100 text-orange-700",
  dokumen: "bg-purple-100 text-purple-700",
  faq: "bg-sky-100 text-sky-700",
  kebijakan: "bg-red-100 text-red-700",
  kontak: "bg-teal-100 text-teal-700",
};

interface FormState {
  title: string;
  category: string;
  content: string;
  sortOrder: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  category: "umum",
  content: "",
  sortOrder: "0",
};

type ViewMode = "list" | "import";

export default function AiChatbotKnowledgePage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Bulk select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Import state
  const [importTab, setImportTab] = useState<"file" | "paste">("file");
  const [dragOver, setDragOver] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [parsedEntries, setParsedEntries] = useState<ParsedEntry[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadEntries();
  }, []);

  async function loadEntries() {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-agent/knowledge-base", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as KnowledgeEntry[];
      setEntries(data);
    } catch {
      toast({ title: "Gagal memuat knowledge base", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setForm({
      title: entry.title,
      category: entry.category,
      content: entry.content,
      sortOrder: String(entry.sortOrder),
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.content.trim()) {
      toast({ title: "Judul dan isi tidak boleh kosong", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        category: form.category,
        content: form.content.trim(),
        sortOrder: parseInt(form.sortOrder) || 0,
      };
      const url = editingId != null ? `/api/ai-agent/knowledge-base/${editingId}` : "/api/ai-agent/knowledge-base";
      const method = editingId != null ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast({ title: editingId != null ? "Entri diperbarui" : "Entri ditambahkan" });
      cancelForm();
      await loadEntries();
    } catch {
      toast({ title: "Gagal menyimpan", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Hapus entri ini?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/ai-agent/knowledge-base/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error();
      toast({ title: "Entri dihapus" });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      toast({ title: "Gagal menghapus", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleActive(entry: KnowledgeEntry) {
    setTogglingId(entry.id);
    try {
      const res = await fetch(`/api/ai-agent/knowledge-base/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !entry.isActive }),
      });
      if (!res.ok) throw new Error();
      setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, isActive: !e.isActive } : e));
    } catch {
      toast({ title: "Gagal mengubah status", variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  }

  // ─── Bulk select handlers ─────────────────────────────────────────────────

  function toggleSelectMode() {
    setSelectMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }

  function toggleSelectEntry(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllEntries() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((e) => e.id)));
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Hapus ${selectedIds.size} entri yang dipilih? Tindakan ini tidak bisa dibatalkan.`)) return;
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/ai-agent/knowledge-base/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error();
      toast({ title: `${selectedIds.size} entri berhasil dihapus` });
      setSelectedIds(new Set());
      setSelectMode(false);
      await loadEntries();
    } catch {
      toast({ title: "Gagal menghapus entri", variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  }

  // ─── Import handlers ───────────────────────────────────────────────────────

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const ok = file.type === "application/pdf" || file.type === "text/plain" ||
        file.name.endsWith(".pdf") || file.name.endsWith(".txt");
      if (!ok) { toast({ title: "Hanya file PDF atau TXT yang didukung", variant: "destructive" }); return; }
      setImportFile(file);
      setParsedEntries([]);
    }
  }, [toast]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setParsedEntries([]);
    e.target.value = "";
  }

  async function handleAnalyze() {
    const hasFile = importTab === "file" && importFile;
    const hasText = importTab === "paste" && pasteText.trim().length > 20;
    if (!hasFile && !hasText) {
      toast({ title: "Upload file atau tempel teks terlebih dahulu", variant: "destructive" });
      return;
    }
    setAnalyzing(true);
    setParsedEntries([]);
    try {
      let res: Response;
      if (importTab === "file" && importFile) {
        const fd = new FormData();
        fd.append("file", importFile);
        res = await fetch("/api/ai-agent/knowledge-base/parse-import", {
          method: "POST",
          credentials: "include",
          body: fd,
        });
      } else {
        res = await fetch("/api/ai-agent/knowledge-base/parse-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ text: pasteText }),
        });
      }
      if (!res.ok) {
        const err = (await res.json()) as { message?: string };
        throw new Error(err.message ?? "Gagal");
      }
      const data = (await res.json()) as { entries: Array<{ title: string; category: string; content: string }> };
      if (!data.entries || data.entries.length === 0) {
        toast({ title: "AI tidak menemukan entri dalam dokumen ini", variant: "destructive" });
        return;
      }
      setParsedEntries(data.entries.map((e) => ({ ...e, selected: true })));
      toast({ title: `${data.entries.length} entri berhasil dianalisis` });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Gagal menganalisis", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleBulkImport() {
    const selected = parsedEntries.filter((e) => e.selected);
    if (selected.length === 0) {
      toast({ title: "Pilih minimal satu entri untuk diimpor", variant: "destructive" });
      return;
    }
    setBulkSaving(true);
    try {
      const res = await fetch("/api/ai-agent/knowledge-base/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entries: selected.map(({ title, category, content }) => ({ title, category, content })) }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { saved: number };
      toast({ title: `${data.saved} entri berhasil diimpor ke Knowledge Base` });
      setParsedEntries([]);
      setImportFile(null);
      setPasteText("");
      setViewMode("list");
      await loadEntries();
    } catch {
      toast({ title: "Gagal mengimpor entri", variant: "destructive" });
    } finally {
      setBulkSaving(false);
    }
  }

  function toggleParsedSelect(i: number) {
    setParsedEntries((prev) => prev.map((e, idx) => idx === i ? { ...e, selected: !e.selected } : e));
  }

  function toggleSelectAll() {
    const allSelected = parsedEntries.every((e) => e.selected);
    setParsedEntries((prev) => prev.map((e) => ({ ...e, selected: !allSelected })));
  }

  function updateParsedEntry(i: number, field: keyof Omit<ParsedEntry, "selected">, value: string) {
    setParsedEntries((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  }

  const filtered = filterCategory === "all" ? entries : entries.filter((e) => e.category === filterCategory);
  const activeCount = entries.filter((e) => e.isActive).length;
  const selectedCount = parsedEntries.filter((e) => e.selected).length;

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 transition-all text-sm";

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

              <h1 className="text-xl font-semibold text-gray-900">Knowledge Base Chatbot</h1>
              <p className="text-sm text-gray-500">SOP, FAQ, dan informasi referensi otomatis chatbot</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Button
              variant="outline"
              onClick={() => { setViewMode(viewMode === "import" ? "list" : "import"); setParsedEntries([]); if (selectMode) toggleSelectMode(); }}
              className="gap-2"
            >
              {viewMode === "import" ? <X className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
              {viewMode === "import" ? "Tutup Import" : "Import Dokumen"}
            </Button>
            {viewMode === "list" && (
              <>
                <Button
                  variant={selectMode ? "secondary" : "outline"}
                  onClick={toggleSelectMode}
                  className="gap-2"
                  disabled={entries.length === 0}
                >
                  <ListChecks className="h-4 w-4" />
                  {selectMode ? "Batal Pilih" : "Pilih"}
                </Button>
                <Button
                  onClick={openCreate}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-500"
                  disabled={showForm}
                >
                  <Plus className="h-4 w-4" />
                  Tambah Entri
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Info card */}
        <div className="flex gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
          <div className="space-y-1">
            <p className="font-semibold">Cara kerja Knowledge Base:</p>
            <ul className="list-disc list-inside space-y-0.5 text-emerald-700">
              <li>Chatbot membaca semua entri <strong>aktif</strong> sebelum menjawab pertanyaan user</li>
              <li>Tulis atau import SOP, FAQ, kebijakan, harga, atau prosedur khusus perusahaan</li>
              <li>Gunakan <strong>Import Dokumen</strong> untuk upload file PDF/TXT — AI akan memecahnya otomatis</li>
            </ul>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-gray-100 bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-800">{entries.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total Entri</p>
          </div>
          <div className="border border-emerald-100 bg-emerald-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-emerald-700">{activeCount}</p>
            <p className="text-xs text-emerald-600 mt-0.5">Aktif</p>
          </div>
          <div className="border border-gray-100 bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-400">{entries.length - activeCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">Nonaktif</p>
          </div>
        </div>

        {/* ─── IMPORT PANEL ─────────────────────────────────────────────────── */}
        {viewMode === "import" && (
          <Card className="border-violet-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileUp className="h-5 w-5 text-violet-600" />
                <CardTitle className="text-base text-gray-800">Import dari Dokumen</CardTitle>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Upload file PDF/TXT atau tempel teks — AI akan memecahnya menjadi entri knowledge base secara otomatis.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Tabs */}
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
                {(["file", "paste"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => { setImportTab(tab); setParsedEntries([]); }}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      importTab === tab ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab === "file" ? "Upload File" : "Tempel Teks"}
                  </button>
                ))}
              </div>

              {/* File upload */}
              {importTab === "file" && (
                <div>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                      dragOver
                        ? "border-violet-400 bg-violet-50"
                        : importFile
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-gray-200 hover:border-violet-300 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,text/plain,application/pdf"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    {importFile ? (
                      <div className="space-y-2">
                        <FileText className="h-8 w-8 text-emerald-500 mx-auto" />
                        <p className="text-sm font-semibold text-emerald-700">{importFile.name}</p>
                        <p className="text-xs text-emerald-600">
                          {(importFile.size / 1024).toFixed(1)} KB • Klik untuk ganti file
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="h-8 w-8 text-gray-300 mx-auto" />
                        <p className="text-sm font-medium text-gray-600">Drag & drop file di sini</p>
                        <p className="text-xs text-gray-400">atau klik untuk pilih file</p>
                        <p className="text-xs text-gray-400 mt-1">Format: PDF, TXT • Maks 10 MB</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Paste text */}
              {importTab === "paste" && (
                <div className="space-y-2">
                  <Textarea
                    value={pasteText}
                    onChange={(e) => { setPasteText(e.target.value); setParsedEntries([]); }}
                    placeholder={`Tempel isi dokumen SOP/FAQ Anda di sini...\n\nContoh:\nTarif Sea Freight\nLCL Surabaya–Jakarta: Rp 300.000/CBM\nFCL 20': Rp 3.500.000\nFCL 40': Rp 5.500.000\n\nLayanan Customs\nPIB (Pemberitahuan Impor Barang):\n- Dokumen diperlukan: Invoice, Packing List, B/L, ...\n- Estimasi proses: 3-5 hari kerja`}
                    className="min-h-[220px] text-sm font-mono resize-y"
                  />
                  <p className="text-xs text-gray-400">{pasteText.length} karakter</p>
                </div>
              )}

              {/* Analyze button */}
              {parsedEntries.length === 0 && (
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzing || (importTab === "file" ? !importFile : pasteText.trim().length < 20)}
                  className="gap-2 bg-violet-600 hover:bg-violet-500 w-full"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      AI sedang menganalisis dokumen...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Analisis dengan AI
                    </>
                  )}
                </Button>
              )}

              {/* Parsed entries review */}
              {parsedEntries.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-violet-600" />
                      <p className="text-sm font-semibold text-gray-800">
                        {parsedEntries.length} entri terdeteksi — pilih yang ingin diimpor
                      </p>
                    </div>
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 font-medium"
                    >
                      {parsedEntries.every((e) => e.selected)
                        ? <><CheckCheck className="h-3.5 w-3.5" />Batalkan semua</>
                        : <><CheckSquare className="h-3.5 w-3.5" />Pilih semua</>}
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {parsedEntries.map((entry, i) => (
                      <div
                        key={i}
                        className={`rounded-xl border p-4 transition-colors ${
                          entry.selected ? "border-violet-200 bg-violet-50/40" : "border-gray-100 bg-gray-50 opacity-50"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => toggleParsedSelect(i)}
                            className="mt-0.5 shrink-0 text-violet-600"
                          >
                            {entry.selected
                              ? <CheckSquare className="h-4 w-4" />
                              : <Square className="h-4 w-4 text-gray-400" />}
                          </button>
                          <div className="flex-1 space-y-2.5 min-w-0">
                            <div className="grid grid-cols-3 gap-2">
                              <div className="col-span-2">
                                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Judul</label>
                                <input
                                  className={inp}
                                  value={entry.title}
                                  onChange={(e) => updateParsedEntry(i, "title", e.target.value)}
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Kategori</label>
                                <Select value={entry.category} onValueChange={(v) => updateParsedEntry(i, "category", v)}>
                                  <SelectTrigger className="text-xs h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CATEGORIES.map((c) => (
                                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Isi</label>
                              <Textarea
                                value={entry.content}
                                onChange={(e) => updateParsedEntry(i, "content", e.target.value)}
                                className="text-xs font-mono min-h-[100px] resize-y"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setParsedEntries([]); }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        ← Analisis ulang
                      </button>
                    </div>
                    <Button
                      onClick={handleBulkImport}
                      disabled={bulkSaving || selectedCount === 0}
                      className="gap-2 bg-emerald-600 hover:bg-emerald-500"
                    >
                      {bulkSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCheck className="h-4 w-4" />
                      )}
                      Import {selectedCount} Entri ke Knowledge Base
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── MANUAL ENTRY FORM ─────────────────────────────────────────────── */}
        {viewMode === "list" && showForm && (
          <Card className="border-emerald-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {editingId != null ? "Edit Entri" : "Tambah Entri Baru"}
                </CardTitle>
                <button onClick={cancelForm} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Judul *</label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Contoh: Tarif Sea Freight Surabaya-Jakarta"
                    className="text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Kategori</label>
                  <Select value={form.category} onValueChange={(v) => setForm((p) => ({ ...p, category: v }))}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Isi / Konten *</label>
                <Textarea
                  value={form.content}
                  onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                  placeholder={`Contoh:\nTarif Sea Freight LCL Surabaya ke Jakarta:\n- Minimal 1 CBM: Rp 350.000/CBM\n- 1-5 CBM: Rp 300.000/CBM\nHarga sudah termasuk handling fee.`}
                  className="min-h-[180px] text-sm font-mono resize-y"
                />
                <p className="text-xs text-gray-400 mt-1">{form.content.length} karakter</p>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Urutan</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))}
                    className={`${inp} w-20`}
                    min="0"
                  />
                  <span className="text-xs text-gray-400">(kecil = prioritas lebih tinggi)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={cancelForm} disabled={saving}>Batal</Button>
                  <Button size="sm" onClick={handleSave} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-500">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Simpan
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── FILTER + LIST ─────────────────────────────────────────────────── */}
        {viewMode === "list" && (
          <>
            {/* Bulk action bar */}
            {selectMode && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggleSelectAllEntries}
                    className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
                  >
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? <CheckSquare className="h-4 w-4 text-red-600" />
                      : <Square className="h-4 w-4 text-gray-400" />}
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? "Batalkan semua"
                      : "Pilih semua"}
                  </button>
                  {selectedIds.size > 0 && (
                    <span className="text-sm text-red-700 font-semibold">
                      {selectedIds.size} entri dipilih
                    </span>
                  )}
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting || selectedIds.size === 0}
                  className="gap-2"
                >
                  {bulkDeleting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                  Hapus {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}Entri
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setFilterCategory("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filterCategory === "all"
                    ? "bg-gray-800 text-white border-gray-800"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                }`}
              >
                Semua ({entries.length})
              </button>
              {CATEGORIES.filter((c) => entries.some((e) => e.category === c.value)).map((c) => (
                <button
                  key={c.value}
                  onClick={() => setFilterCategory(c.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filterCategory === c.value
                      ? "bg-gray-800 text-white border-gray-800"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {c.label} ({entries.filter((e) => e.category === c.value).length})
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-7 w-7 animate-spin text-gray-300" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BookOpen className="h-12 w-12 text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-500">Belum ada entri</p>
                <p className="text-xs text-gray-400 mt-1">
                  Klik &quot;Tambah Entri&quot; atau &quot;Import Dokumen&quot; untuk mulai mengisi knowledge base
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((entry) => {
                  const isChecked = selectedIds.has(entry.id);
                  return (
                    <Card
                      key={entry.id}
                      className={`transition-all duration-200 ${!entry.isActive && !selectMode ? "opacity-50" : ""} ${
                        selectMode && isChecked ? "border-red-300 ring-1 ring-red-200" : ""
                      }`}
                      onClick={selectMode ? () => toggleSelectEntry(entry.id) : undefined}
                      style={selectMode ? { cursor: "pointer" } : undefined}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Checkbox (only in select mode) */}
                          {selectMode && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleSelectEntry(entry.id); }}
                              className="mt-0.5 shrink-0"
                            >
                              {isChecked
                                ? <CheckSquare className="h-4 w-4 text-red-600" />
                                : <Square className="h-4 w-4 text-gray-400" />}
                            </button>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_COLORS[entry.category] ?? "bg-gray-100 text-gray-600"}`}>
                                {CATEGORIES.find((c) => c.value === entry.category)?.label ?? entry.category}
                              </span>
                              {!entry.isActive && (
                                <span className="text-[11px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Nonaktif</span>
                              )}
                              <span className="text-[11px] text-gray-400">#{entry.sortOrder}</span>
                            </div>
                            <h3 className="text-sm font-semibold text-gray-800 truncate">{entry.title}</h3>
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{entry.content}</p>
                          </div>

                          {/* Action buttons (hidden in select mode) */}
                          {!selectMode && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleToggleActive(entry)}
                                disabled={togglingId === entry.id}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                                title={entry.isActive ? "Nonaktifkan" : "Aktifkan"}
                              >
                                {togglingId === entry.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : entry.isActive ? (
                                  <ToggleRight className="h-4 w-4 text-emerald-600" />
                                ) : (
                                  <ToggleLeft className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                onClick={() => openEdit(entry)}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(entry.id)}
                                disabled={deletingId === entry.id}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                                title="Hapus"
                              >
                                {deletingId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
