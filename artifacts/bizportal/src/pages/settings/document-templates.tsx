import { useState, useEffect, useRef, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Download, MoreHorizontal, Copy, Eye, EyeOff, Lock, Trash2,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Loader2, GripVertical,
  Type, Table, Image, Minus, Columns2, Space, Braces, TableProperties,
  Hash, QrCode, Barcode as BarcodeIcon, PenLine, Square, StickyNote, SeparatorHorizontal,
  ChevronDown, ChevronRight, CheckCircle2, Circle, MoreVertical,
} from "lucide-react";
import { Link } from "wouter";

const API = "/api/settings/documents";

const DOCUMENT_TYPES = [
  { key: "invoice",       label: "Invoice",                icon: "🧾", group: "bisnis" },
  { key: "quotation",     label: "Penawaran / Quotation",  icon: "📋", group: "bisnis" },
  { key: "po",            label: "Purchase Order",         icon: "🛒", group: "bisnis" },
  { key: "delivery_note", label: "Surat Jalan",            icon: "🚚", group: "bisnis" },
  { key: "packing_list",  label: "Packing List",           icon: "📦", group: "bisnis" },
  { key: "mou",           label: "MOU",                    icon: "🤝", group: "legal" },
  { key: "kontrak",       label: "Kontrak",                icon: "📜", group: "legal" },
  { key: "nda",           label: "NDA",                    icon: "🔒", group: "legal" },
  { key: "sla",           label: "SLA",                    icon: "📊", group: "legal" },
];

const COMPONENT_GROUPS = [
  {
    label: "Konten Dasar",
    items: [
      { id: "text",    icon: Type,             label: "Teks" },
      { id: "table",   icon: Table,            label: "Tabel" },
      { id: "image",   icon: Image,            label: "Gambar" },
      { id: "divider", icon: Minus,            label: "Garis" },
      { id: "columns", icon: Columns2,         label: "Kolom" },
      { id: "spacer",  icon: Space,            label: "Spacer" },
    ],
  },
  {
    label: "Data Dinamis",
    items: [
      { id: "dynamic_text",  icon: Braces,          label: "Teks Dinamis" },
      { id: "dynamic_table", icon: TableProperties, label: "Tabel Dinamis" },
      { id: "page_number",   icon: Hash,            label: "Nomor Halaman" },
      { id: "qr_order",      icon: QrCode,          label: "QR Order" },
      { id: "barcode",       icon: BarcodeIcon,     label: "Barcode" },
      { id: "signature",     icon: PenLine,         label: "Tanda Tangan" },
    ],
  },
  {
    label: "Konten Lainnya",
    items: [
      { id: "box",       icon: Square,              label: "Kotak" },
      { id: "note",      icon: StickyNote,          label: "Catatan" },
      { id: "separator", icon: SeparatorHorizontal, label: "Pembatas" },
    ],
  },
];

interface CanvasBlock {
  id: string;
  type: string;
  label: string;
  visible: boolean;
  locked: boolean;
}

const DEFAULT_BLOCKS: CanvasBlock[] = [
  { id: "b-header",    type: "header",    label: "Header",                  visible: true, locked: false },
  { id: "b-company",   type: "company",   label: "Informasi Perusahaan",    visible: true, locked: false },
  { id: "b-docinfo",   type: "docinfo",   label: "Informasi Dokumen",       visible: true, locked: false },
  { id: "b-address",   type: "address",   label: "Alamat (Dari & Kepada)",  visible: true, locked: false },
  { id: "b-items",     type: "items",     label: "Tabel Item",              visible: true, locked: false },
  { id: "b-notes",     type: "notes",     label: "Catatan",                 visible: true, locked: false },
  { id: "b-footer",    type: "footer",    label: "Footer",                  visible: true, locked: false },
];

interface CustomVariable {
  name: string;
  value: string;
  desc: string;
}

interface TemplateConfig {
  documentType: string;
  businessLine: string;
  logoUrl: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  headerText: string;
  footerText: string;
  primaryColor: string;
  accentColor: string;
  fontSize: number;
  defaultTerms: string;
  defaultNotes: string;
  dueDays: number;
  showTax: boolean;
  showSignature: boolean;
  showStamp: boolean;
  templateFormat: "pdf" | "html";
  customVariables?: CustomVariable[];
  updatedAt?: string;
}

const DEFAULT_CONFIG: Omit<TemplateConfig, "documentType"> = {
  businessLine: "Logistic/Forwarder",
  logoUrl: "",
  companyName: "PT B2B Marketplace and Logistic",
  companyAddress: "Jl. Logistik No. 1, Jakarta",
  companyPhone: "+62 21 1234 5678",
  companyEmail: "info@b2bmarketplace.co.id",
  headerText: "",
  footerText: "Terima kasih atas kepercayaan Anda.",
  primaryColor: "#1e3a6e",
  accentColor: "#2563eb",
  fontSize: 11,
  defaultTerms: "Pembayaran dalam 14 hari kerja.",
  defaultNotes: "",
  dueDays: 14,
  showTax: true,
  showSignature: true,
  showStamp: false,
  templateFormat: "pdf",
  customVariables: [],
};

function genId() {
  return `b-${Math.random().toString(36).slice(2, 8)}`;
}

function getDocLabel(key: string) {
  const dt = DOCUMENT_TYPES.find((d) => d.key === key);
  return dt?.label ?? key;
}

function getDocTitle(key: string) {
  const map: Record<string, string> = {
    invoice: "INVOICE",
    quotation: "PENAWARAN",
    po: "PURCHASE ORDER",
    delivery_note: "SURAT JALAN",
    packing_list: "PACKING LIST",
    mou: "MOU",
    kontrak: "KONTRAK",
    nda: "NDA",
    sla: "SLA",
  };
  return map[key] ?? key.toUpperCase();
}

function A4Canvas({ config, blocks, selectedId, onSelect }: {
  config: TemplateConfig;
  blocks: CanvasBlock[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const visibleBlocks = blocks.filter((b) => b.visible);
  const primary = config.primaryColor || "#1e3a6e";
  const accent = config.accentColor || "#2563eb";
  const docTitle = getDocTitle(config.documentType);

  return (
    <div
      className="relative bg-white shadow-lg mx-auto"
      style={{ width: "595px", minHeight: "842px", fontFamily: "Arial, sans-serif", fontSize: `${config.fontSize}pt` }}
    >
      {visibleBlocks.map((block) => {
        const isSelected = selectedId === block.id;
        const base = `cursor-pointer transition-all ${isSelected ? "ring-2 ring-blue-500 ring-offset-1" : "hover:ring-1 hover:ring-blue-300"}`;
        const blockA11y = {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `Pilih blok ${block.label || block.type}`,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(block.id); }
          },
        };

        if (block.type === "header") {
          return (
            <div key={block.id} className={`px-8 pt-6 pb-4 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {config.logoUrl ? (
                    <img src={config.logoUrl} alt="Logo" className="h-12 w-auto object-contain" />
                  ) : (
                    <div
                      className="h-12 w-28 rounded flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: primary }}
                    >
                      <span className="opacity-50 text-[10px]">LOGO</span>
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-base" style={{ color: primary }}>{config.companyName}</div>
                    <div className="text-xs text-gray-500">Jl. Logistik No. 1, Jakarta</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold tracking-wide" style={{ color: accent }}>{docTitle}</div>
                  <div className="text-xs text-gray-400 mt-0.5"># {`{nomor_${config.documentType}}`}</div>
                </div>
              </div>
              <div className="mt-3 h-[2px] w-full" style={{ background: primary }} />
            </div>
          );
        }

        if (block.type === "docinfo") {
          return (
            <div key={block.id} className={`px-8 py-2 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
              <div className="flex gap-6 text-xs text-gray-600">
                <div><span className="text-gray-400">Tanggal:</span> <span className="text-gray-700">{`{tanggal}`}</span></div>
                <div><span className="text-gray-400">Jatuh Tempo:</span> <span className="text-gray-700">{`{jatuh_tempo}`}</span></div>
              </div>
            </div>
          );
        }

        if (block.type === "company") {
          return (
            <div key={block.id} className={`px-8 py-2 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
              <div className="text-xs text-gray-600 space-y-0.5">
                <div style={{ color: primary }}>{config.companyName}</div>
                <div>{config.companyAddress}</div>
                <div>{config.companyPhone}</div>
                <div>{config.companyEmail}</div>
              </div>
            </div>
          );
        }

        if (block.type === "address") {
          return (
            <div key={block.id} className={`px-8 py-3 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: primary }}>DARI</div>
                  <div className="text-xs space-y-0.5 text-gray-700">
                    <div className="font-semibold">{config.companyName}</div>
                    <div>{config.companyAddress}</div>
                    <div>{config.companyPhone}</div>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: primary }}>KEPADA</div>
                  <div className="text-xs space-y-0.5 text-gray-700">
                    <div className="font-semibold">{`{nama_pelanggan}`}</div>
                    <div>{`{alamat_pelanggan}`}</div>
                    <div>{`{telepon_pelanggan}`}</div>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (block.type === "items") {
          return (
            <div key={block.id} className={`px-8 py-3 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: primary, color: "#fff" }}>
                    <th className="py-1.5 px-2 text-left font-semibold">Deskripsi</th>
                    <th className="py-1.5 px-2 text-center font-semibold">Qty / Satuan</th>
                    <th className="py-1.5 px-2 text-right font-semibold">Harga Satuan</th>
                    <th className="py-1.5 px-2 text-right font-semibold">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Jasa Pengiriman Internasional", "1 Shipment", "Rp 18.500.000", "Rp 18.500.000"],
                    ["Biaya Handling & Custom Clearance", "2 Pax", "Rp 2.500.000", "Rp 5.000.000"],
                    ["Asuransi Kargo", "1 Paket", "Rp 750.000", "Rp 750.000"],
                  ].map(([desc, qty, price, sub], i) => (
                    <tr key={i} className={i % 2 === 1 ? "bg-gray-50" : ""}>
                      <td className="py-1.5 px-2 border-b border-gray-100 text-gray-700">{desc}</td>
                      <td className="py-1.5 px-2 border-b border-gray-100 text-center text-gray-600">{qty}</td>
                      <td className="py-1.5 px-2 border-b border-gray-100 text-right text-gray-600">{price}</td>
                      <td className="py-1.5 px-2 border-b border-gray-100 text-right text-gray-700 font-medium">{sub}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex justify-end">
                <div className="w-52 text-xs space-y-1">
                  <div className="flex justify-between py-0.5 text-gray-600">
                    <span>Subtotal</span><span>Rp 24.250.000</span>
                  </div>
                  <div className="flex justify-between py-0.5 text-gray-600">
                    <span>Diskon</span><span>- Rp 500.000</span>
                  </div>
                  {config.showTax && (
                    <div className="flex justify-between py-0.5 text-gray-600">
                      <span>Pajak (PPN 11%)</span><span>Rp 2.227.500</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1.5 px-2 rounded font-bold text-white text-sm" style={{ background: primary }}>
                    <span>Total</span><span>Rp 25.977.500</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (block.type === "notes") {
          return (
            <div key={block.id} className={`px-8 py-2 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
              <div className="text-xs text-gray-500 font-medium mb-1">Catatan:</div>
              <div className="text-xs text-gray-600">{config.defaultTerms || `{catatan}`}</div>
            </div>
          );
        }

        if (block.type === "footer") {
          return (
            <div key={block.id} className={`px-8 pt-3 pb-5 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
              <div className="h-[1px] w-full mb-2" style={{ background: accent + "40" }} />
              <div className="flex justify-between items-end">
                <div className="text-xs text-gray-500 italic">{config.footerText}</div>
                <div className="text-[9px] text-gray-400">Halaman 1/1</div>
              </div>
              {config.showSignature && (
                <div className="mt-4 grid grid-cols-2 gap-8 text-xs text-gray-500">
                  <div className="text-center">
                    <div className="h-12 border-b border-gray-300 mb-1" />
                    <div>Dibuat oleh</div>
                  </div>
                  <div className="text-center">
                    <div className="h-12 border-b border-gray-300 mb-1" />
                    <div>Disetujui oleh</div>
                  </div>
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={block.id} className={`px-8 py-2 ${base}`} onClick={() => onSelect(block.id)} {...blockA11y}>
            <div className="text-xs text-gray-400 italic border border-dashed border-gray-200 rounded p-2 text-center">
              {block.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DocumentTemplatesPage() {
  const { toast } = useToast();
  const [activeType, setActiveType] = useState("invoice");
  const [templates, setTemplates] = useState<Record<string, TemplateConfig>>({});
  const [config, setConfig] = useState<TemplateConfig>({ ...DEFAULT_CONFIG, documentType: "invoice" });
  const [blocks, setBlocks] = useState<CanvasBlock[]>(DEFAULT_BLOCKS);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState("1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(70);
  const [previewMode, setPreviewMode] = useState<"dummy" | "real">("dummy");
  const [showGrid, setShowGrid] = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [paperSize, setPaperSize] = useState("A4");
  const [margin, setMargin] = useState({ top: 15, right: 15, bottom: 15, left: 15 });
  const [layerExpanded, setLayerExpanded] = useState(true);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const res = await fetch(API, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data: TemplateConfig[] = await res.json();
      const map: Record<string, TemplateConfig> = {};
      data.forEach((t) => { map[t.documentType] = t; });
      setTemplates(map);
      const current = map["invoice"] ?? { ...DEFAULT_CONFIG, documentType: "invoice" };
      setConfig(current);
    } catch {
      toast({ title: "Gagal memuat template", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function switchType(type: string) {
    setActiveType(type);
    const saved = templates[type] ?? { ...DEFAULT_CONFIG, documentType: type };
    setConfig(saved);
    setBlocks(DEFAULT_BLOCKS);
    setSelectedBlockId(null);
    setDirty(false);
    setPreviewHtml(null);
  }

  function patchConfig<K extends keyof TemplateConfig>(key: K, value: TemplateConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function handleSave(asDraft = false) {
    setSaving(true);
    try {
      const res = await fetch(`${API}/${activeType}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error();
      const { template } = await res.json();
      setTemplates((prev) => ({ ...prev, [activeType]: template }));
      setConfig(template);
      setDirty(false);
      toast({ title: asDraft ? "Draft tersimpan" : "Template aktif", description: `Template ${getDocLabel(activeType)} berhasil diperbarui.` });
    } catch {
      toast({ title: "Gagal menyimpan", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await fetch(`${API}/${activeType}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...config, paperSize, margin, orientation }),
      });
      if (!res.ok) throw new Error();
      const html = await res.text();
      setPreviewHtml(html);
      setTimeout(() => {
        if (iframeRef.current) {
          const doc = iframeRef.current.contentDocument;
          if (doc) { doc.open(); doc.write(html); doc.close(); }
        }
      }, 50);
    } catch {
      toast({ title: "Gagal generate preview", variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  function addBlockFromPalette(componentId: string, label: string) {
    const newBlock: CanvasBlock = {
      id: genId(),
      type: componentId,
      label,
      visible: true,
      locked: false,
    };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedBlockId(newBlock.id);
    setDirty(true);
  }

  function toggleBlockVisibility(id: string) {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, visible: !b.visible } : b));
    setDirty(true);
  }

  function toggleBlockLock(id: string) {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, locked: !b.locked } : b));
    setDirty(true);
  }

  function deleteBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
    setDirty(true);
  }

  function moveBlock(id: string, dir: -1 | 1) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
    setDirty(true);
  }

  const meta = DOCUMENT_TYPES.find((d) => d.key === activeType);
  const isLegal = ["mou", "kontrak", "nda", "sla"].includes(activeType);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell noPadding>
      <div className="flex flex-col h-screen overflow-hidden bg-[#0f1117]">

        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-[#161b27] shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-white/10 h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-sm font-bold text-white">Template Dokumen</h1>
              <p className="text-[11px] text-gray-500">Buat, edit &amp; kelola template dokumen bisnis Anda</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs border-white/20 text-gray-300 hover:bg-white/10 hover:text-white bg-transparent gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Ekspor Template
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/10">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Main 3-column layout ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Left Sidebar: Document Types ── */}
          <div className="w-48 shrink-0 border-r border-white/10 bg-[#161b27] overflow-y-auto py-3">
            <div className="px-3 mb-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1">Bisnis</p>
            </div>
            <nav className="flex flex-col gap-0.5 px-2">
              {DOCUMENT_TYPES.filter((d) => d.group === "bisnis").map((d) => (
                <button
                  key={d.key}
                  onClick={() => switchType(d.key)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition-colors w-full text-left ${
                    activeType === d.key
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:bg-white/8 hover:text-gray-200"
                  }`}
                >
                  <span>{d.icon}</span>
                  <span className="truncate">{d.label}</span>
                  {templates[d.key]?.updatedAt && activeType !== d.key && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  )}
                </button>
              ))}
            </nav>
            <div className="px-3 mt-4 mb-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1">Legal</p>
            </div>
            <nav className="flex flex-col gap-0.5 px-2">
              {DOCUMENT_TYPES.filter((d) => d.group === "legal").map((d) => (
                <button
                  key={d.key}
                  onClick={() => switchType(d.key)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition-colors w-full text-left ${
                    activeType === d.key
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:bg-white/8 hover:text-gray-200"
                  }`}
                >
                  <span>{d.icon}</span>
                  <span className="truncate">{d.label}</span>
                  {templates[d.key]?.updatedAt && activeType !== d.key && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* ── Center: Canvas Area ── */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Doc Header + Step Tabs */}
            <div className="shrink-0 border-b border-white/10 bg-[#1a2035] px-4 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                    <span className="text-sm font-bold text-white">{meta?.label}</span>
                  </div>
                  {config.updatedAt && (
                    <span className="text-[11px] text-gray-500">
                      Terakhir diperbarui: {new Date(config.updatedAt).toLocaleString("id-ID")}
                    </span>
                  )}
                  {dirty
                    ? <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/40 border">Belum disimpan</Badge>
                    : config.updatedAt
                    ? <Badge className="text-[10px] px-1.5 py-0 bg-green-500/20 text-green-400 border-green-500/40 border">Tersimpan</Badge>
                    : null
                  }
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs border-white/20 text-gray-300 hover:bg-white/10 bg-transparent gap-1.5">
                  <Copy className="h-3 w-3" />
                  Duplikat Template
                </Button>
              </div>
              <Tabs value={activeStep} onValueChange={setActiveStep}>
                <TabsList className="bg-transparent p-0 gap-0 border-0 h-auto">
                  {[
                    { v: "1", label: "Desain" },
                    { v: "2", label: "Variabel" },
                    { v: "3", label: "Pengaturan" },
                    { v: "4", label: "Akses" },
                  ].map((tab, i) => (
                    <TabsTrigger
                      key={tab.v}
                      value={tab.v}
                      className="relative flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-none border-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none text-gray-500 data-[state=active]:text-white"
                    >
                      <span
                        className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                          activeStep === tab.v ? "bg-blue-600 text-white" : "bg-white/10 text-gray-500"
                        }`}
                      >
                        {i + 1}
                      </span>
                      {tab.label}
                      {activeStep === tab.v && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {/* Canvas + Component Panel + Layer */}
            {activeStep === "1" && (
              <div className="flex flex-1 overflow-hidden">

                {/* Component Palette + Layers */}
                <div className="w-44 shrink-0 border-r border-white/10 bg-[#161b27] overflow-y-auto">
                  <div className="p-2">
                    <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Komponen</p>
                    <p className="text-[10px] text-gray-600 px-1 mb-2">Seret &amp; lepas ke canvas</p>
                    {COMPONENT_GROUPS.map((group) => (
                      <div key={group.label} className="mb-3">
                        <p className="text-[10px] font-semibold text-gray-500 px-1 mb-1.5">{group.label}</p>
                        <div className="grid grid-cols-3 gap-1">
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.id}
                                title={item.label}
                                onClick={() => addBlockFromPalette(item.id, item.label)}
                                className="flex flex-col items-center gap-1 p-1.5 rounded-md bg-white/5 hover:bg-blue-600/30 text-gray-400 hover:text-blue-300 transition-colors"
                              >
                                <Icon className="h-3.5 w-3.5" />
                                <span className="text-[8px] leading-tight text-center">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Layer Panel */}
                  <div className="border-t border-white/10">
                    <button
                      onClick={() => setLayerExpanded(!layerExpanded)}
                      className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-semibold text-gray-400 hover:text-white"
                    >
                      <span>Layer</span>
                      {layerExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                    {layerExpanded && (
                      <div className="px-2 pb-2 space-y-0.5">
                        {blocks.map((block, idx) => (
                          <div
                            key={block.id}
                            onClick={() => setSelectedBlockId(block.id)}
                            className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                              selectedBlockId === block.id
                                ? "bg-blue-600/30 text-blue-300"
                                : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                            }`}
                          >
                            <GripVertical className="h-2.5 w-2.5 shrink-0 opacity-40" />
                            <span className="text-[10px] flex-1 truncate">{block.label}</span>
                            <div className="hidden group-hover:flex items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleBlockVisibility(block.id); }}
                                className="p-0.5 rounded hover:bg-white/10"
                                title={block.visible ? "Sembunyikan" : "Tampilkan"}
                              >
                                {block.visible ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleBlockLock(block.id); }}
                                className="p-0.5 rounded hover:bg-white/10"
                                title={block.locked ? "Unlock" : "Lock"}
                              >
                                <Lock className={`h-2.5 w-2.5 ${block.locked ? "text-amber-400" : ""}`} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteBlock(block.id); }}
                                className="p-0.5 rounded hover:bg-red-500/20 text-red-400"
                                title="Hapus"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Canvas toolbar */}
                  <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/10 bg-[#1a2035] shrink-0">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400 border border-white/15 rounded px-2 py-0.5">Canvas ({paperSize})</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white hover:bg-white/10">
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white hover:bg-white/10">
                        <Redo2 className="h-3.5 w-3.5" />
                      </Button>
                      <div className="w-px h-4 bg-white/10 mx-1" />
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white hover:bg-white/10" onClick={() => setZoom((z) => Math.max(40, z - 10))}>
                        <ZoomOut className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-xs text-gray-400 w-10 text-center">{zoom}%</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white hover:bg-white/10" onClick={() => setZoom((z) => Math.min(150, z + 10))}>
                        <ZoomIn className="h-3.5 w-3.5" />
                      </Button>
                      <div className="w-px h-4 bg-white/10 mx-1" />
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white hover:bg-white/10" onClick={() => setZoom(100)}>
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Canvas area */}
                  <div className="flex-1 overflow-auto bg-[#0f1117] flex items-start justify-center pt-6 pb-10">
                    <div
                      style={{
                        transform: `scale(${zoom / 100})`,
                        transformOrigin: "top center",
                        width: orientation === "portrait" ? "595px" : "842px",
                      }}
                    >
                      {showGrid && (
                        <div
                          className="absolute inset-0 pointer-events-none z-10"
                          style={{
                            backgroundImage: "linear-gradient(rgba(99,102,241,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.15) 1px, transparent 1px)",
                            backgroundSize: "20px 20px",
                          }}
                        />
                      )}
                      <A4Canvas
                        config={config}
                        blocks={blocks}
                        selectedId={selectedBlockId}
                        onSelect={setSelectedBlockId}
                      />
                      {showSafeArea && (
                        <div
                          className="absolute pointer-events-none z-10 border border-dashed border-blue-400/30 rounded"
                          style={{
                            top: `${margin.top}px`,
                            right: `${margin.right}px`,
                            bottom: `${margin.bottom}px`,
                            left: `${margin.left}px`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Variabel Tab */}
            {activeStep === "2" && (() => {
              const customVars: CustomVariable[] = config.customVariables ?? [];
              const sysVars = [
                { var: `{nomor_${activeType}}`, desc: "Nomor dokumen otomatis" },
                { var: "{tanggal}",              desc: "Tanggal dokumen" },
                { var: "{jatuh_tempo}",          desc: "Tanggal jatuh tempo" },
                { var: "{nama_perusahaan}",      desc: "Nama perusahaan pengirim" },
                { var: "{alamat_perusahaan}",    desc: "Alamat perusahaan" },
                { var: "{telepon_perusahaan}",   desc: "Telepon perusahaan" },
                { var: "{email_perusahaan}",     desc: "Email perusahaan" },
                { var: "{nama_pelanggan}",       desc: "Nama pelanggan / vendor" },
                { var: "{alamat_pelanggan}",     desc: "Alamat pelanggan" },
                { var: "{telepon_pelanggan}",    desc: "Telepon pelanggan" },
                { var: "{email_pelanggan}",      desc: "Email pelanggan" },
                { var: "{subtotal}",             desc: "Subtotal sebelum pajak" },
                { var: "{diskon}",               desc: "Jumlah diskon" },
                { var: "{pajak}",               desc: "Nama pajak (mis: PPN 11%)" },
                { var: "{total}",                desc: "Total akhir" },
                { var: "{catatan}",              desc: "Catatan dokumen" },
                { var: "{page_number}",          desc: "Nomor halaman" },
              ];

              function addCustomVar() {
                const updated = [...customVars, { name: "", value: "", desc: "" }];
                patchConfig("customVariables", updated);
              }
              function updateCustomVar(idx: number, field: keyof CustomVariable, val: string) {
                const updated = customVars.map((v, i) => i === idx ? { ...v, [field]: val } : v);
                patchConfig("customVariables", updated);
              }
              function deleteCustomVar(idx: number) {
                patchConfig("customVariables", customVars.filter((_, i) => i !== idx));
              }

              return (
                <div className="flex-1 overflow-auto p-6">
                  <div className="max-w-2xl mx-auto space-y-6">

                    {/* System Variables — read-only with copy button */}
                    <div>
                      <h2 className="text-white font-semibold mb-1 text-sm">Variabel Sistem</h2>
                      <p className="text-gray-500 text-xs mb-3">Variabel bawaan yang diisi otomatis saat dokumen dibuat. Klik untuk menyalin.</p>
                      <div className="grid grid-cols-2 gap-2">
                        {sysVars.map((v) => (
                          <button
                            key={v.var}
                            onClick={() => { navigator.clipboard.writeText(v.var); toast({ title: "Disalin!", description: v.var, duration: 1500 }); }}
                            className="flex items-start gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-blue-500/10 hover:border-blue-500/30 text-left transition-colors group"
                          >
                            <code className="text-blue-400 text-[11px] font-mono shrink-0 group-hover:text-blue-300">{v.var}</code>
                            <span className="text-[11px] text-gray-500">{v.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Custom Variables — editable */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <h2 className="text-white font-semibold text-sm">Variabel Kustom</h2>
                          <p className="text-gray-500 text-xs">Buat variabel sendiri untuk digunakan di template.</p>
                        </div>
                        <Button size="sm" onClick={addCustomVar} className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white">
                          + Tambah Variabel
                        </Button>
                      </div>

                      {customVars.length === 0 ? (
                        <div className="text-center py-8 text-gray-600 text-xs border border-dashed border-white/10 rounded-lg">
                          Belum ada variabel kustom. Klik "Tambah Variabel" untuk mulai.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {/* Header row */}
                          <div className="grid grid-cols-[1fr_1.2fr_1.5fr_32px] gap-2 px-1">
                            <span className="text-[10px] text-gray-600 font-semibold uppercase">Nama Variabel</span>
                            <span className="text-[10px] text-gray-600 font-semibold uppercase">Nilai Default</span>
                            <span className="text-[10px] text-gray-600 font-semibold uppercase">Keterangan</span>
                            <span />
                          </div>
                          {customVars.map((cv, idx) => (
                            <div key={idx} className="grid grid-cols-[1fr_1.2fr_1.5fr_32px] gap-2 items-center p-2 bg-white/5 border border-white/10 rounded-lg">
                              <div className="flex items-center gap-1">
                                <span className="text-blue-400 text-[11px] font-mono shrink-0">{`{`}</span>
                                <Input
                                  placeholder="nama_var"
                                  value={cv.name}
                                  onChange={(e) => updateCustomVar(idx, "name", e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase())}
                                  className="h-6 text-[11px] font-mono bg-transparent border-0 border-b border-white/20 rounded-none text-blue-300 px-0 focus-visible:ring-0 focus-visible:border-blue-400 placeholder:text-gray-600"
                                />
                                <span className="text-blue-400 text-[11px] font-mono shrink-0">{`}`}</span>
                              </div>
                              <Input
                                placeholder="nilai default..."
                                value={cv.value}
                                onChange={(e) => updateCustomVar(idx, "value", e.target.value)}
                                className="h-6 text-xs bg-white/5 border-white/10 text-white"
                              />
                              <Input
                                placeholder="deskripsi..."
                                value={cv.desc}
                                onChange={(e) => updateCustomVar(idx, "desc", e.target.value)}
                                className="h-6 text-xs bg-white/5 border-white/10 text-gray-300"
                              />
                              <button onClick={() => deleteCustomVar(idx)} className="h-6 w-6 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              );
            })()}

            {/* Pengaturan Tab */}
            {activeStep === "3" && (
              <div className="flex-1 overflow-auto p-6">
                <div className="max-w-xl mx-auto space-y-5">
                  <div>
                    <h2 className="text-white font-semibold mb-3 text-sm">Identitas Perusahaan</h2>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-400">URL Logo</Label>
                        <Input
                          placeholder="https://example.com/logo.png"
                          value={config.logoUrl}
                          onChange={(e) => patchConfig("logoUrl", e.target.value)}
                          className="bg-white/5 border-white/10 text-white text-xs"
                        />
                        {config.logoUrl && (
                          <div className="border border-white/10 rounded p-2 bg-white/5 flex items-center justify-center h-16">
                            <img src={config.logoUrl} alt="Logo" className="max-h-12 max-w-36 object-contain" />
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-400">Nama Perusahaan</Label>
                        <Input value={config.companyName} onChange={(e) => patchConfig("companyName", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-400">Alamat</Label>
                        <Textarea rows={2} value={config.companyAddress} onChange={(e) => patchConfig("companyAddress", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-400">Telepon</Label>
                          <Input value={config.companyPhone} onChange={(e) => patchConfig("companyPhone", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-400">Email</Label>
                          <Input value={config.companyEmail} onChange={(e) => patchConfig("companyEmail", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-white font-semibold mb-3 text-sm">Desain & Warna</h2>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-400">Warna Utama</Label>
                          <div className="flex gap-2">
                            <input type="color" value={config.primaryColor} onChange={(e) => patchConfig("primaryColor", e.target.value)} className="w-9 h-9 rounded cursor-pointer border border-white/10 bg-transparent" />
                            <Input value={config.primaryColor} onChange={(e) => patchConfig("primaryColor", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs font-mono" />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-400">Warna Aksen</Label>
                          <div className="flex gap-2">
                            <input type="color" value={config.accentColor} onChange={(e) => patchConfig("accentColor", e.target.value)} className="w-9 h-9 rounded cursor-pointer border border-white/10 bg-transparent" />
                            <Input value={config.accentColor} onChange={(e) => patchConfig("accentColor", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs font-mono" />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-400">Ukuran Font (pt)</Label>
                        <Input type="number" min={8} max={16} value={config.fontSize} onChange={(e) => patchConfig("fontSize", parseInt(e.target.value) || 11)} className="bg-white/5 border-white/10 text-white text-xs w-24" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-white font-semibold mb-3 text-sm">Konten Default</h2>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-400">Syarat & Ketentuan</Label>
                        <Textarea rows={2} value={config.defaultTerms} onChange={(e) => patchConfig("defaultTerms", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-400">Teks Footer</Label>
                        <Input value={config.footerText} onChange={(e) => patchConfig("footerText", e.target.value)} className="bg-white/5 border-white/10 text-white text-xs" />
                      </div>
                      {!isLegal && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-400">Jatuh Tempo Default (hari)</Label>
                          <Input type="number" min={1} max={365} value={config.dueDays} onChange={(e) => patchConfig("dueDays", parseInt(e.target.value) || 14)} className="bg-white/5 border-white/10 text-white text-xs w-24" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-white font-semibold mb-3 text-sm">Opsi Tampilan</h2>
                    <div className="space-y-2">
                      {[
                        { key: "showTax" as const,       label: "Tampilkan PPN",         desc: "Tampilkan baris PPN 11% di total" },
                        { key: "showSignature" as const, label: "Kolom Tanda Tangan",    desc: "Tampilkan area tanda tangan" },
                        { key: "showStamp" as const,     label: "Kolom Stempel",         desc: "Tampilkan area stempel perusahaan" },
                      ].map((opt) => (
                        <div key={opt.key} className="flex items-center justify-between p-2.5 bg-white/5 border border-white/10 rounded-lg">
                          <div>
                            <p className="text-xs text-white font-medium">{opt.label}</p>
                            <p className="text-[11px] text-gray-500">{opt.desc}</p>
                          </div>
                          <Switch checked={config[opt.key]} onCheckedChange={(v) => patchConfig(opt.key, v)} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Akses Tab */}
            {activeStep === "4" && (
              <div className="flex-1 overflow-auto p-6">
                <div className="max-w-xl mx-auto">
                  <h2 className="text-white font-semibold mb-1 text-sm">Pengaturan Akses</h2>
                  <p className="text-gray-500 text-xs mb-4">Kelola siapa yang dapat menggunakan atau mengedit template ini.</p>
                  <div className="space-y-2">
                    {[
                      { role: "Admin", level: "Edit", icon: CheckCircle2, color: "text-green-400" },
                      { role: "Manager", level: "Lihat & Cetak", icon: Eye, color: "text-blue-400" },
                      { role: "Staff", level: "Cetak saja", icon: Circle, color: "text-gray-400" },
                    ].map((row) => (
                      <div key={row.role} className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg">
                        <div className="flex items-center gap-2">
                          <row.icon className={`h-4 w-4 ${row.color}`} />
                          <span className="text-sm text-white">{row.role}</span>
                        </div>
                        <Badge className="text-[10px] bg-white/10 text-gray-300 border-0">{row.level}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Right Panel: Block Properties / Preview + Canvas Settings ── */}
          <div className="w-56 shrink-0 border-l border-white/10 bg-[#161b27] overflow-y-auto flex flex-col">

            {/* Block Properties Panel — shown when a block is selected in Desain tab */}
            {activeStep === "1" && selectedBlockId && (() => {
              const blk = blocks.find((b) => b.id === selectedBlockId);
              if (!blk) return null;
              return (
                <div className="p-3 border-b border-white/10 flex-1 overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-white">Properti Blok</span>
                    <button onClick={() => setSelectedBlockId(null)} className="text-gray-500 hover:text-white text-[10px]">✕</button>
                  </div>
                  <div className="space-y-3">
                    {/* Block label */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Nama Blok</Label>
                      <Input
                        value={blk.label}
                        onChange={(e) => setBlocks((prev) => prev.map((b) => b.id === blk.id ? { ...b, label: e.target.value } : b))}
                        className="h-6 text-xs bg-white/5 border-white/10 text-white"
                      />
                    </div>

                    {/* Type-specific fields */}
                    {(blk.type === "header") && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">URL Logo</Label>
                          <Input
                            placeholder="https://..."
                            value={config.logoUrl}
                            onChange={(e) => patchConfig("logoUrl", e.target.value)}
                            className="h-6 text-xs bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Warna Utama</Label>
                          <div className="flex gap-1.5">
                            <input type="color" value={config.primaryColor} onChange={(e) => patchConfig("primaryColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-white/10 bg-transparent shrink-0" />
                            <Input value={config.primaryColor} onChange={(e) => patchConfig("primaryColor", e.target.value)} className="h-7 text-xs bg-white/5 border-white/10 text-white font-mono" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Warna Aksen</Label>
                          <div className="flex gap-1.5">
                            <input type="color" value={config.accentColor} onChange={(e) => patchConfig("accentColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-white/10 bg-transparent shrink-0" />
                            <Input value={config.accentColor} onChange={(e) => patchConfig("accentColor", e.target.value)} className="h-7 text-xs bg-white/5 border-white/10 text-white font-mono" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Nama Perusahaan</Label>
                          <Input value={config.companyName} onChange={(e) => patchConfig("companyName", e.target.value)} className="h-6 text-xs bg-white/5 border-white/10 text-white" />
                        </div>
                      </>
                    )}

                    {(blk.type === "company") && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Nama Perusahaan</Label>
                          <Input value={config.companyName} onChange={(e) => patchConfig("companyName", e.target.value)} className="h-6 text-xs bg-white/5 border-white/10 text-white" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Alamat</Label>
                          <Textarea rows={2} value={config.companyAddress} onChange={(e) => patchConfig("companyAddress", e.target.value)} className="text-xs bg-white/5 border-white/10 text-white resize-none" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Telepon</Label>
                          <Input value={config.companyPhone} onChange={(e) => patchConfig("companyPhone", e.target.value)} className="h-6 text-xs bg-white/5 border-white/10 text-white" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Email</Label>
                          <Input value={config.companyEmail} onChange={(e) => patchConfig("companyEmail", e.target.value)} className="h-6 text-xs bg-white/5 border-white/10 text-white" />
                        </div>
                      </>
                    )}

                    {(blk.type === "items") && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Ukuran Font (pt)</Label>
                          <Input type="number" min={8} max={16} value={config.fontSize} onChange={(e) => patchConfig("fontSize", parseInt(e.target.value) || 11)} className="h-6 text-xs bg-white/5 border-white/10 text-white w-20" />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400">Tampilkan PPN</span>
                          <Switch checked={config.showTax} onCheckedChange={(v) => patchConfig("showTax", v)} className="scale-75" />
                        </div>
                      </>
                    )}

                    {(blk.type === "notes") && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Syarat & Ketentuan</Label>
                          <Textarea rows={3} value={config.defaultTerms} onChange={(e) => patchConfig("defaultTerms", e.target.value)} className="text-xs bg-white/5 border-white/10 text-white resize-none" />
                        </div>
                      </>
                    )}

                    {(blk.type === "footer") && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Teks Footer</Label>
                          <Input value={config.footerText} onChange={(e) => patchConfig("footerText", e.target.value)} className="h-6 text-xs bg-white/5 border-white/10 text-white" />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400">Tanda Tangan</span>
                          <Switch checked={config.showSignature} onCheckedChange={(v) => patchConfig("showSignature", v)} className="scale-75" />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400">Stempel</span>
                          <Switch checked={config.showStamp} onCheckedChange={(v) => patchConfig("showStamp", v)} className="scale-75" />
                        </div>
                      </>
                    )}

                    {(blk.type === "docinfo" || blk.type === "address") && (
                      <p className="text-[10px] text-gray-500 bg-white/5 rounded p-2 leading-relaxed">
                        Blok ini menggunakan data dinamis dari dokumen. Nilai akan diisi otomatis saat cetak.
                      </p>
                    )}

                    {/* Visibility & Lock toggles */}
                    <div className="pt-1 border-t border-white/10 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">Tampilkan</span>
                        <Switch checked={blk.visible} onCheckedChange={() => toggleBlockVisibility(blk.id)} className="scale-75" />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">Kunci</span>
                        <Switch checked={blk.locked} onCheckedChange={() => toggleBlockLock(blk.id)} className="scale-75" />
                      </div>
                    </div>

                    {/* Move up/down + delete */}
                    <div className="flex items-center gap-1 pt-1">
                      <Button variant="ghost" size="sm" className="flex-1 h-6 text-[10px] text-gray-400 hover:text-white hover:bg-white/10 px-1" onClick={() => moveBlock(blk.id, -1)}>↑ Atas</Button>
                      <Button variant="ghost" size="sm" className="flex-1 h-6 text-[10px] text-gray-400 hover:text-white hover:bg-white/10 px-1" onClick={() => moveBlock(blk.id, 1)}>↓ Bawah</Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => deleteBlock(blk.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Preview Live */}
            <div className="p-3 border-b border-white/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-white">Preview Live</span>
                <span className="flex items-center gap-1 text-[10px] text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  Live
                </span>
              </div>
              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => setPreviewMode("dummy")}
                  className={`flex-1 text-[10px] py-1 rounded transition-colors ${previewMode === "dummy" ? "bg-white/15 text-white" : "text-gray-500 hover:text-gray-300"}`}
                >
                  Data Dummy
                </button>
                <button
                  onClick={() => setPreviewMode("real")}
                  className={`flex-1 text-[10px] py-1 rounded transition-colors ${previewMode === "real" ? "bg-white/15 text-white" : "text-gray-500 hover:text-gray-300"}`}
                >
                  Muat Data Saya
                </button>
              </div>

              {/* Mini preview */}
              <div
                className="rounded-lg overflow-hidden border border-white/10 bg-white cursor-pointer relative"
                style={{ height: "180px" }}
                onClick={handlePreview}
              >
                {previewHtml ? (
                  <iframe
                    ref={iframeRef}
                    title="Mini Preview"
                    className="w-full h-full border-0 pointer-events-none"
                    style={{ transform: "scale(0.3)", transformOrigin: "top left", width: "333%", height: "333%" }}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 bg-gray-50">
                    {previewing
                      ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                      : <>
                          <div className="text-[10px] text-gray-400 text-center px-2">Klik untuk generate preview</div>
                          <Button size="sm" variant="outline" className="text-[10px] h-6 px-2" onClick={(e) => { e.stopPropagation(); handlePreview(); }}>
                            <Eye className="h-3 w-3 mr-1" /> Preview
                          </Button>
                        </>
                    }
                  </div>
                )}
              </div>
              {previewHtml && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full mt-1.5 h-6 text-[10px] text-gray-400 hover:text-white"
                  onClick={handlePreview}
                  disabled={previewing}
                >
                  {previewing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                  Refresh
                </Button>
              )}
            </div>

            {/* Canvas Settings */}
            <div className="p-3 flex-1 overflow-y-auto">
              <p className="text-xs font-semibold text-white mb-3">Pengaturan Canvas</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-gray-500">Ukuran Kertas</Label>
                  <Select value={paperSize} onValueChange={setPaperSize}>
                    <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10 text-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4 (210 x 297 mm)</SelectItem>
                      <SelectItem value="Letter">Letter (216 x 279 mm)</SelectItem>
                      <SelectItem value="A5">A5 (148 x 210 mm)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] text-gray-500">Orientasi</Label>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => setOrientation("portrait")}
                      className={`text-[10px] py-1.5 rounded border transition-colors ${orientation === "portrait" ? "bg-blue-600 text-white border-blue-600" : "border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300"}`}
                    >
                      Potrait
                    </button>
                    <button
                      onClick={() => setOrientation("landscape")}
                      className={`text-[10px] py-1.5 rounded border transition-colors ${orientation === "landscape" ? "bg-blue-600 text-white border-blue-600" : "border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300"}`}
                    >
                      Landscape
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] text-gray-500">Margin (mm)</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["top", "right", "bottom", "left"] as const).map((side) => (
                      <div key={side} className="space-y-0.5">
                        <span className="text-[9px] text-gray-600 capitalize">{side === "top" ? "Atas" : side === "right" ? "Kanan" : side === "bottom" ? "Bawah" : "Kiri"}</span>
                        <Input
                          type="number"
                          value={margin[side]}
                          onChange={(e) => setMargin((m) => ({ ...m, [side]: parseInt(e.target.value) || 0 }))}
                          className="h-6 text-xs bg-white/5 border-white/10 text-white text-center px-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">Tampilkan Grid</span>
                    <Switch checked={showGrid} onCheckedChange={setShowGrid} className="scale-75" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">Tampilkan Area Aman</span>
                    <Switch checked={showSafeArea} onCheckedChange={setShowSafeArea} className="scale-75" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom Bar ── */}
        <div className="shrink-0 border-t border-white/10 bg-[#161b27] px-4 py-2.5 flex items-center justify-between">
          <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-white hover:bg-white/10" asChild>
            <Link href="/settings">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Kembali
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-white/20 text-gray-300 hover:bg-white/10 bg-transparent"
              onClick={() => handleSave(true)}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Simpan Draft
            </Button>
            <Button
              size="sm"
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
              Simpan &amp; Aktifkan
            </Button>
          </div>
        </div>

        {/* ── Feature Cards Bar ── */}
        <div className="shrink-0 border-t border-white/10 bg-[#0f1117] px-4 py-2">
          <div className="grid grid-cols-6 gap-2">
            {[
              { n: 1, title: "Desain Drag & Drop",     desc: "Editor visual lengkap dengan komponen siap pakai dan canvas interaktif." },
              { n: 2, title: "Variabel Dinamis",        desc: "Kelola semua variabel data dalam satu tempat dan gunakan dengan mudah." },
              { n: 3, title: "Preview Real-time",       desc: "Lihat perubahan kertas, margin, orientation, dan preferensi tampilan." },
              { n: 4, title: "Pengaturan Fleksibel",    desc: "Atur ukuran kertas, margin, orientation, dan preferensi tampilan." },
              { n: 5, title: "Layer Management",        desc: "Kelola urutan elemen, sembunyikan, kunci, atau hapus dengan mudah." },
              { n: 6, title: "Ekspor & Duplikasi",      desc: "Ekspor template atau duplikasi untuk membuat variasi baru dengan cepat." },
            ].map((f) => (
              <div key={f.n} className="flex items-start gap-2">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                  style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)", color: "white" }}
                >
                  {f.n}
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-300">{f.title}</p>
                  <p className="text-[9px] text-gray-600 leading-tight">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
