/**
 * Settlement Pattern Engine — BizPortal Page
 *
 * Finance → Settings → Settlement Pattern
 *
 * Tabs:
 *   1. General    — list + CRUD patterns
 *   2. Keyword    — keyword builder per pattern
 *   3. Merchant   — merchant mapping fields
 *   4. Matching   — match strategy config
 *   5. Settlement — delay config
 *   6. Learning   — AI examples
 *   7. Statistics — dashboard
 *   8. Simulator  — test a bank mutation description
 *   9. Tester     — batch CSV simulation
 *
 * GUARDRAILS:
 *   - Read-only advisory only. Does NOT post/approve journals.
 *   - Does NOT modify Accounting Engine, COA Governance, or any journal.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  SlidersHorizontal, Plus, Pencil, Trash2, Power, RefreshCw,
  Brain, Tag, Search, BarChart2, FlaskConical, Upload,
  CheckCircle2, XCircle, AlertCircle, ChevronRight,
} from "lucide-react";

const API = "/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const MATCH_STRATEGIES = [
  { value: "ONE_TO_ONE",       label: "One-to-One" },
  { value: "ONE_TO_MANY",      label: "One-to-Many" },
  { value: "MANY_TO_ONE",      label: "Many-to-One" },
  { value: "BATCH_SETTLEMENT", label: "Batch Settlement" },
];

const MATCH_MODES = [
  { value: "contains",    label: "Contains" },
  { value: "starts_with", label: "Starts With" },
  { value: "ends_with",   label: "Ends With" },
  { value: "equals",      label: "Equals" },
  { value: "regex",       label: "Regex" },
];

const PATTERN_TYPES = [
  { value: "settlement", label: "Settlement" },
  { value: "refund",     label: "Refund" },
  { value: "chargeback", label: "Chargeback" },
];

const DELAY_PRESETS = [
  { value: 0, label: "Same Day (H+0)" },
  { value: 1, label: "H+1" },
  { value: 2, label: "H+2" },
  { value: 3, label: "H+3" },
];

const PROVIDERS = [
  "QRIS","Midtrans","Xendit","Paylabs","DOKU",
  "OVO","GoPay","ShopeePay","DANA","LinkAja",
  "BCA EDC","Mandiri EDC","BNI EDC","BRI EDC",
  "Virtual Account","Other",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  return status === "active"
    ? <Badge className="bg-emerald-900 text-emerald-300 text-xs">Aktif</Badge>
    : <Badge className="bg-slate-700 text-slate-400 text-xs">Nonaktif</Badge>;
}

function strategyBadge(strategy: string) {
  const colors: Record<string, string> = {
    BATCH_SETTLEMENT: "bg-purple-900 text-purple-300",
    ONE_TO_ONE:       "bg-blue-900 text-blue-300",
    ONE_TO_MANY:      "bg-teal-900 text-teal-300",
    MANY_TO_ONE:      "bg-amber-900 text-amber-300",
  };
  return (
    <Badge className={`text-xs ${colors[strategy] ?? "bg-slate-700 text-slate-300"}`}>
      {strategy.replace(/_/g, " ")}
    </Badge>
  );
}

function confidenceBadge(pct: number) {
  const color = pct >= 80 ? "bg-emerald-900 text-emerald-300"
               : pct >= 60 ? "bg-amber-900 text-amber-300"
               : "bg-red-900 text-red-300";
  return <Badge className={`text-xs ${color}`}>{pct}%</Badge>;
}

// ─── Pattern Form ─────────────────────────────────────────────────────────────

interface PatternFormData {
  code:                string;
  name:                string;
  provider:            string;
  patternType:         string;
  matchStrategy:       string;
  priority:            number;
  merchantName:        string;
  merchantId:          string;
  terminalId:          string;
  bankName:            string;
  accountNumber:       string;
  currency:            string;
  settlementDelayDays: number;
  grossMatching:       boolean;
  feeMatching:         boolean;
  confidenceThreshold: number;
  feeAccountId:        number | null;
}

const defaultForm = (): PatternFormData => ({
  code:                "",
  name:                "",
  provider:            "QRIS",
  patternType:         "settlement",
  matchStrategy:       "BATCH_SETTLEMENT",
  priority:            50,
  merchantName:        "",
  merchantId:          "",
  terminalId:          "",
  bankName:            "",
  accountNumber:       "",
  currency:            "IDR",
  settlementDelayDays: 1,
  grossMatching:       true,
  feeMatching:         true,
  confidenceThreshold: 0.80,
  feeAccountId:        null,
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SettlementPatternPage() {
  const [tab, setTab] = useState("general");

  // Patterns
  const [patterns, setPatterns]         = useState<any[]>([]);
  const [loading, setLoading]           = useState(false);
  const [selected, setSelected]         = useState<any | null>(null);
  const [showForm, setShowForm]         = useState(false);
  const [editingId, setEditingId]       = useState<number | null>(null);
  const [form, setForm]                 = useState<PatternFormData>(defaultForm());
  const [saving, setSaving]             = useState(false);
  const [filterProvider, setFilterProvider] = useState("__all__");

  // Keywords (for selected pattern)
  const [keywords, setKeywords]         = useState<any[]>([]);
  const [kwForm, setKwForm]             = useState({ keyword: "", matchMode: "contains", priority: 0 });
  const [savingKw, setSavingKw]         = useState(false);

  // Examples
  const [examples, setExamples]         = useState<any[]>([]);

  // Statistics
  const [stats, setStats]               = useState<any>(null);

  // COA list for fee account picker
  const [coaAccounts, setCoaAccounts]   = useState<any[]>([]);
  const [coaSearch, setCoaSearch]       = useState("");

  // Simulator
  const [simDesc, setSimDesc]           = useState("");
  const [simResult, setSimResult]       = useState<any>(null);
  const [simLoading, setSimLoading]     = useState(false);

  // Batch tester
  const [batchInput, setBatchInput]     = useState("");
  const [batchResult, setBatchResult]   = useState<any>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  // ── API helpers ────────────────────────────────────────────────────────────

  const fetchPatterns = useCallback(async () => {
    setLoading(true);
    try {
      const qs = (filterProvider && filterProvider !== "__all__") ? `?provider=${encodeURIComponent(filterProvider)}&include_inactive=1` : "?include_inactive=1";
      const r = await fetch(`${API}/settlement-patterns${qs}`);
      const d = await r.json();
      setPatterns(d.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [filterProvider]);

  const fetchStats = useCallback(async () => {
    const r = await fetch(`${API}/settlement-patterns/statistics`);
    const d = await r.json();
    setStats(d);
  }, []);

  const fetchKeywords = useCallback(async (patternId: number) => {
    const r = await fetch(`${API}/settlement-patterns/${patternId}/keywords`);
    const d = await r.json();
    setKeywords(d.data ?? []);
  }, []);

  const fetchExamples = useCallback(async (patternId: number) => {
    const r = await fetch(`${API}/settlement-patterns/${patternId}/examples`);
    const d = await r.json();
    setExamples(d.data ?? []);
  }, []);

  // Fetch COA accounts for fee account picker (expense accounts only)
  useEffect(() => {
    fetch(`${API}/accounting/accounts`)
      .then(r => r.json())
      .then((rows: any[]) => {
        // prefer expense accounts but keep all for flexibility
        setCoaAccounts(rows.filter((r: any) => r.isActive !== false));
      })
      .catch(() => {/* ignore if not logged in */});
  }, []);

  useEffect(() => { fetchPatterns(); }, [fetchPatterns]);
  useEffect(() => { if (tab === "statistics") fetchStats(); }, [tab, fetchStats]);
  useEffect(() => {
    if (selected) {
      fetchKeywords(selected.id);
      fetchExamples(selected.id);
    }
  }, [selected, fetchKeywords, fetchExamples]);

  // ── Save pattern ───────────────────────────────────────────────────────────

  const savePattern = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        merchantName:  form.merchantName  || null,
        merchantId:    form.merchantId    || null,
        terminalId:    form.terminalId    || null,
        bankName:      form.bankName      || null,
        accountNumber: form.accountNumber || null,
        feeAccountId:  form.feeAccountId  ?? null,
      };
      const url    = editingId ? `${API}/settlement-patterns/${editingId}` : `${API}/settlement-patterns`;
      const method = editingId ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) { const e = await r.json(); alert(e.error ?? "Gagal menyimpan"); return; }
      setShowForm(false);
      setEditingId(null);
      setForm(defaultForm());
      fetchPatterns();
    } finally {
      setSaving(false);
    }
  };

  // ── Deactivate / Activate ──────────────────────────────────────────────────

  const toggleStatus = async (p: any) => {
    if (!confirm(`${p.status === "active" ? "Nonaktifkan" : "Aktifkan"} pattern "${p.name}"?`)) return;
    if (p.status === "active") {
      await fetch(`${API}/settlement-patterns/${p.id}`, { method: "DELETE" });
    } else {
      await fetch(`${API}/settlement-patterns/${p.id}/activate`, { method: "POST" });
    }
    fetchPatterns();
  };

  // ── Add keyword ────────────────────────────────────────────────────────────

  const addKeyword = async () => {
    if (!selected || !kwForm.keyword.trim()) return;
    setSavingKw(true);
    try {
      await fetch(`${API}/settlement-patterns/${selected.id}/keywords`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kwForm),
      });
      setKwForm({ keyword: "", matchMode: "contains", priority: 0 });
      fetchKeywords(selected.id);
    } finally {
      setSavingKw(false);
    }
  };

  const deleteKeyword = async (kwId: number) => {
    if (!confirm("Hapus keyword ini?")) return;
    await fetch(`${API}/settlement-patterns/keywords/${kwId}`, { method: "DELETE" });
    if (selected) fetchKeywords(selected.id);
  };

  // ── Simulator ──────────────────────────────────────────────────────────────

  const runSimulate = async () => {
    if (!simDesc.trim()) return;
    setSimLoading(true);
    try {
      const r = await fetch(`${API}/settlement-patterns/simulate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: simDesc }),
      });
      setSimResult(await r.json());
    } finally {
      setSimLoading(false);
    }
  };

  // ── Batch tester ───────────────────────────────────────────────────────────

  const runBatch = async () => {
    if (!batchInput.trim()) return;
    setBatchLoading(true);
    try {
      const lines = batchInput.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 200);
      const items = lines.map(l => ({ description: l }));
      const r = await fetch(`${API}/settlement-patterns/simulate/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      setBatchResult(await r.json());
    } finally {
      setBatchLoading(false);
    }
  };

  // ── Save as new pattern from AI correction ─────────────────────────────────

  const saveSimAsPattern = async () => {
    if (!simResult?.result?.matched) return;
    alert("Fungsi: Simpan sebagai Pattern Baru tersedia. Buka tab General dan klik Tambah Pattern dengan provider yang terdeteksi.");
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <PageHeader
          title="Settlement Pattern Engine"
          description="Konfigurasi master pattern untuk mengenali settlement dari berbagai payment provider"
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap gap-1 h-auto">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="keyword">Keyword</TabsTrigger>
            <TabsTrigger value="merchant">Merchant</TabsTrigger>
            <TabsTrigger value="matching">Matching</TabsTrigger>
            <TabsTrigger value="settlement">Settlement</TabsTrigger>
            <TabsTrigger value="learning">Learning</TabsTrigger>
            <TabsTrigger value="statistics">Statistics</TabsTrigger>
            <TabsTrigger value="simulator">Simulator</TabsTrigger>
            <TabsTrigger value="tester">Tester</TabsTrigger>
          </TabsList>

          {/* ── Tab: General ─────────────────────────────────────────────── */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={filterProvider} onValueChange={setFilterProvider}>
                <SelectTrigger className="w-48 bg-slate-800 border-slate-700">
                  <SelectValue placeholder="Filter provider..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Provider</SelectItem>
                  {PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={fetchPatterns}>
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
              </Button>
              <Button size="sm" onClick={() => { setEditingId(null); setForm(defaultForm()); setShowForm(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Tambah Pattern
              </Button>
            </div>

            {loading ? (
              <div className="text-slate-400 text-sm">Memuat pattern...</div>
            ) : (
              <div className="space-y-2">
                {patterns.map(p => (
                  <Card key={p.id} className={`bg-slate-900 border-slate-700 cursor-pointer transition-all ${selected?.id === p.id ? "ring-1 ring-purple-500" : "hover:border-slate-600"}`}
                    onClick={() => setSelected(p)}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium text-sm">{p.name}</span>
                              {statusBadge(p.status)}
                              {p.is_seed && <Badge className="bg-slate-800 text-slate-400 text-xs">Seed</Badge>}
                            </div>
                            <div className="text-slate-400 text-xs mt-0.5">
                              {p.code} · {p.provider} · Prioritas {p.priority}
                              · {p.keyword_count ?? 0} keyword · {p.usage_count ?? 0}× dipakai
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {strategyBadge(p.match_strategy)}
                          <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setEditingId(p.id); setForm({
                            code: p.code, name: p.name, provider: p.provider, patternType: p.pattern_type,
                            matchStrategy: p.match_strategy, priority: p.priority,
                            merchantName: p.merchant_name ?? "", merchantId: p.merchant_id ?? "",
                            terminalId: p.terminal_id ?? "", bankName: p.bank_name ?? "",
                            accountNumber: p.account_number ?? "", currency: p.currency,
                            settlementDelayDays: p.settlement_delay_days, grossMatching: p.gross_matching,
                            feeMatching: p.fee_matching, confidenceThreshold: parseFloat(p.confidence_threshold),
                            feeAccountId: p.fee_account_id ?? null,
                          }); setCoaSearch(""); setShowForm(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); toggleStatus(p); }}>
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {!patterns.length && (
                  <div className="text-center py-12 text-slate-500 text-sm">
                    Tidak ada pattern ditemukan
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── Tab: Keyword ─────────────────────────────────────────────── */}
          <TabsContent value="keyword" className="space-y-4 mt-4">
            {!selected ? (
              <div className="text-slate-400 text-sm">Pilih pattern dari tab General terlebih dahulu.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-purple-400" />
                  <span className="text-white font-medium">{selected.name}</span>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                  <span className="text-slate-400 text-sm">Keyword Builder</span>
                </div>

                {/* Add keyword */}
                <Card className="bg-slate-900 border-slate-700">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex gap-3 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <Label className="text-xs text-slate-400 mb-1">Keyword / Regex</Label>
                        <Input
                          value={kwForm.keyword}
                          onChange={e => setKwForm(f => ({ ...f, keyword: e.target.value }))}
                          placeholder="e.g. QRTRAVELI atau 7177.*"
                          className="bg-slate-800 border-slate-700"
                          onKeyDown={e => { if (e.key === "Enter") addKeyword(); }}
                        />
                      </div>
                      <div className="w-40">
                        <Label className="text-xs text-slate-400 mb-1">Match Mode</Label>
                        <Select value={kwForm.matchMode} onValueChange={v => setKwForm(f => ({ ...f, matchMode: v }))}>
                          <SelectTrigger className="bg-slate-800 border-slate-700">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MATCH_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-24">
                        <Label className="text-xs text-slate-400 mb-1">Prioritas</Label>
                        <Input type="number" min={0} value={kwForm.priority}
                          onChange={e => setKwForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                          className="bg-slate-800 border-slate-700" />
                      </div>
                      <div className="flex items-end">
                        <Button size="sm" onClick={addKeyword} disabled={savingKw}>
                          <Plus className="h-4 w-4 mr-1" /> Tambah
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Keyword list */}
                <div className="space-y-2">
                  {keywords.map(kw => (
                    <div key={kw.id} className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg px-4 py-2">
                      <div className="flex items-center gap-3">
                        <Badge className="bg-slate-800 text-slate-300 text-xs font-mono">{kw.match_mode}</Badge>
                        <span className="text-white text-sm font-mono">{kw.keyword}</span>
                        <span className="text-slate-500 text-xs">prio {kw.priority}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => deleteKeyword(kw.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  ))}
                  {!keywords.length && <div className="text-slate-500 text-sm">Belum ada keyword</div>}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Tab: Merchant ────────────────────────────────────────────── */}
          <TabsContent value="merchant" className="space-y-4 mt-4">
            {!selected ? (
              <div className="text-slate-400 text-sm">Pilih pattern dari tab General terlebih dahulu.</div>
            ) : (
              <Card className="bg-slate-900 border-slate-700">
                <CardHeader><CardTitle className="text-base text-white">Merchant Mapping — {selected.name}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { label: "Merchant Name", key: "merchant_name" },
                      { label: "Merchant ID",   key: "merchant_id" },
                      { label: "Terminal ID",   key: "terminal_id" },
                      { label: "Bank Name",     key: "bank_name" },
                    ].map(({ label, key }) => (
                      <div key={key}>
                        <Label className="text-xs text-slate-400 mb-1">{label}</Label>
                        <div className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white">
                          {selected[key] ?? <span className="text-slate-500 italic">—</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-slate-400 text-xs">
                    Edit merchant mapping melalui form Edit di tab General.
                    Merchant name dan ID digunakan untuk meningkatkan confidence score matching.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Tab: Matching ────────────────────────────────────────────── */}
          <TabsContent value="matching" className="space-y-4 mt-4">
            {!selected ? (
              <div className="text-slate-400 text-sm">Pilih pattern dari tab General terlebih dahulu.</div>
            ) : (
              <Card className="bg-slate-900 border-slate-700">
                <CardHeader><CardTitle className="text-base text-white">Matching Strategy — {selected.name}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Match Strategy</Label>
                      <div className="mt-1">{strategyBadge(selected.match_strategy)}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Gross Matching</Label>
                      <div className="text-white text-sm">{selected.gross_matching ? "✓ Aktif" : "—"}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Fee Matching</Label>
                      <div className="text-white text-sm">{selected.fee_matching ? "✓ Aktif" : "—"}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Confidence Threshold</Label>
                      <div className="text-white text-sm">{Math.round(parseFloat(selected.confidence_threshold) * 100)}%</div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Prioritas</Label>
                      <div className="text-white text-sm">{selected.priority}</div>
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 text-xs text-slate-400 space-y-1">
                    <p><strong className="text-slate-300">ONE_TO_ONE:</strong> Satu mutasi bank ↔ satu transaksi</p>
                    <p><strong className="text-slate-300">ONE_TO_MANY:</strong> Satu settlement untuk beberapa transaksi</p>
                    <p><strong className="text-slate-300">MANY_TO_ONE:</strong> Beberapa mutasi untuk satu transaksi</p>
                    <p><strong className="text-slate-300">BATCH_SETTLEMENT:</strong> Batch booking di-net ke satu settlement (default QRIS)</p>
                  </div>
                  <div className="bg-amber-950/40 border border-amber-800/40 rounded-lg p-4 text-xs text-amber-300">
                    <strong>Formula Batch (Phase 9):</strong> Gross Booking = Net Settlement + Fee
                    <br />Matching berdasarkan Economic Event — bukan Pendapatan/PPN/Journal Line.
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Tab: Settlement ──────────────────────────────────────────── */}
          <TabsContent value="settlement" className="space-y-4 mt-4">
            {!selected ? (
              <div className="text-slate-400 text-sm">Pilih pattern dari tab General terlebih dahulu.</div>
            ) : (
              <Card className="bg-slate-900 border-slate-700">
                <CardHeader><CardTitle className="text-base text-white">Settlement Delay — {selected.name}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Settlement Delay</Label>
                      <div className="text-white text-lg font-semibold">H+{selected.settlement_delay_days}</div>
                      <div className="text-slate-400 text-xs">
                        {DELAY_PRESETS.find(d => d.value === selected.settlement_delay_days)?.label ?? `Custom (${selected.settlement_delay_days} hari)`}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Provider</Label>
                      <div className="text-white text-sm">{selected.provider}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Currency</Label>
                      <div className="text-white text-sm">{selected.currency}</div>
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 text-xs text-slate-400">
                    Delay digunakan AI untuk mencocokkan tanggal mutasi bank dengan tanggal booking.
                    Ubah delay melalui form Edit di tab General.
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Tab: Learning ────────────────────────────────────────────── */}
          <TabsContent value="learning" className="space-y-4 mt-4">
            {!selected ? (
              <div className="text-slate-400 text-sm">Pilih pattern dari tab General terlebih dahulu.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-purple-400" />
                  <span className="text-white font-medium">AI Learning Examples — {selected.name}</span>
                </div>
                <div className="bg-purple-950/30 border border-purple-800/30 rounded-lg p-4 text-xs text-purple-300">
                  Saat Finance mengubah hasil AI (Phase 11), simpan mutasi asli sebagai example di sini.
                  AI menggunakan examples untuk meningkatkan akurasi pengenalan pattern di masa depan.
                </div>
                <div className="space-y-2">
                  {examples.map(ex => (
                    <div key={ex.id} className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs">
                      <div className="font-mono text-white text-sm mb-1">{ex.raw_description}</div>
                      <div className="flex gap-4 text-slate-400">
                        <span>Provider: {ex.matched_provider ?? "—"}</span>
                        <span>Merchant: {ex.matched_merchant ?? "—"}</span>
                        {ex.gross_amount && <span>Gross: {Number(ex.gross_amount).toLocaleString("id-ID")}</span>}
                        {ex.fee_amount && <span>Fee: {Number(ex.fee_amount).toLocaleString("id-ID")}</span>}
                        <span>Sumber: {ex.source}</span>
                      </div>
                    </div>
                  ))}
                  {!examples.length && <div className="text-slate-500 text-sm">Belum ada learning examples</div>}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Tab: Statistics ──────────────────────────────────────────── */}
          <TabsContent value="statistics" className="space-y-4 mt-4">
            {!stats ? (
              <div className="text-slate-400 text-sm">Memuat statistik...</div>
            ) : (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Pattern Aktif",    value: stats.summary?.active_patterns   ?? 0, color: "text-emerald-400" },
                    { label: "Pattern Nonaktif", value: stats.summary?.inactive_patterns ?? 0, color: "text-slate-400" },
                    { label: "Total Pemakaian",  value: stats.summary?.total_usage       ?? 0, color: "text-blue-400" },
                    { label: "Provider",         value: stats.summary?.provider_count    ?? 0, color: "text-purple-400" },
                  ].map(({ label, value, color }) => (
                    <Card key={label} className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4">
                        <div className={`text-2xl font-bold ${color}`}>{value}</div>
                        <div className="text-slate-400 text-xs mt-1">{label}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Most used */}
                <Card className="bg-slate-900 border-slate-700">
                  <CardHeader><CardTitle className="text-sm text-white">Most Used Pattern</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {stats.topPatterns?.map((p: any) => (
                        <div key={p.name} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300">{p.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 text-xs">{p.provider}</span>
                            <Badge className="bg-slate-800 text-slate-300 text-xs">{p.usage_count ?? 0}×</Badge>
                          </div>
                        </div>
                      ))}
                      {!stats.topPatterns?.length && <div className="text-slate-500 text-xs">Belum ada data</div>}
                    </div>
                  </CardContent>
                </Card>

                {/* By provider */}
                <Card className="bg-slate-900 border-slate-700">
                  <CardHeader><CardTitle className="text-sm text-white">Settlement Provider Breakdown</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {stats.byProvider?.map((p: any) => (
                        <div key={p.provider} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300">{p.provider}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400 text-xs">{p.pattern_count} pattern</span>
                            <Badge className="bg-slate-800 text-slate-300 text-xs">{p.total_usage ?? 0}× dipakai</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ── Tab: Simulator ───────────────────────────────────────────── */}
          <TabsContent value="simulator" className="space-y-4 mt-4">
            <div className="space-y-3">
              <Label className="text-sm text-slate-300">Mutasi Bank (deskripsi)</Label>
              <Input
                value={simDesc}
                onChange={e => setSimDesc(e.target.value)}
                placeholder="7177632488799999999111111111111QRTRAVELI DR 0000029511812 KR 1640006707220 99106"
                className="bg-slate-800 border-slate-700 font-mono text-sm"
              />
              <div className="flex gap-2">
                <Button onClick={runSimulate} disabled={simLoading || !simDesc.trim()}>
                  <Search className="h-4 w-4 mr-2" /> {simLoading ? "Menjalankan..." : "Jalankan Simulasi"}
                </Button>
                {simDesc === "" && (
                  <Button variant="outline" size="sm" onClick={() =>
                    setSimDesc("7177632488799999999111111111111QRTRAVELI DR 0000029511812 KR 1640006707220 99106")
                  }>
                    Contoh QRIS
                  </Button>
                )}
              </div>

              {simResult && (
                <Card className={`border ${simResult.result?.matched ? "border-emerald-700 bg-emerald-950/20" : "border-slate-700 bg-slate-900"}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      {simResult.result?.matched
                        ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        : <XCircle className="h-5 w-5 text-red-400" />}
                      <span className={`font-medium ${simResult.result?.matched ? "text-emerald-300" : "text-red-300"}`}>
                        {simResult.result?.matched ? "Pattern Ditemukan" : "Tidak Cocok"}
                      </span>
                      {simResult.result?.confidencePct != null && confidenceBadge(simResult.result.confidencePct)}
                    </div>
                    {simResult.result && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                        <div><Label className="text-xs text-slate-400">Pattern</Label><div className="text-white">{simResult.result.patternName ?? "—"}</div></div>
                        <div><Label className="text-xs text-slate-400">Provider</Label><div className="text-white">{simResult.result.provider ?? "—"}</div></div>
                        <div><Label className="text-xs text-slate-400">Strategy</Label><div>{simResult.result.matchStrategy ? strategyBadge(simResult.result.matchStrategy) : "—"}</div></div>
                        <div><Label className="text-xs text-slate-400">Settlement Delay</Label><div className="text-white">{simResult.result.settlementDelayDays != null ? `H+${simResult.result.settlementDelayDays}` : "—"}</div></div>
                        <div><Label className="text-xs text-slate-400">Gross Matching</Label><div className="text-white">{simResult.result.grossMatching ? "Ya" : "Tidak"}</div></div>
                        <div><Label className="text-xs text-slate-400">Fee Matching</Label><div className="text-white">{simResult.result.feeMatching ? "Ya" : "Tidak"}</div></div>
                      </div>
                    )}
                    {simResult.result?.matchedKeywords?.length > 0 && (
                      <div>
                        <Label className="text-xs text-slate-400">Keyword Cocok</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {simResult.result.matchedKeywords.map((kw: string) => (
                            <Badge key={kw} className="bg-purple-900 text-purple-300 text-xs font-mono">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {simResult.result?.matched && (
                      <Button size="sm" variant="outline" onClick={saveSimAsPattern}>
                        <Brain className="h-3.5 w-3.5 mr-1" /> Simpan Pattern Baru
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ── Tab: Tester ──────────────────────────────────────────────── */}
          <TabsContent value="tester" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-400">
                <Upload className="h-4 w-4 inline mr-1" />
                Masukkan mutasi bank satu per baris (maks 200 baris). AI menjalankan simulasi tanpa membuat journal.
              </div>
              <Textarea
                value={batchInput}
                onChange={e => setBatchInput(e.target.value)}
                placeholder={"7177632488799999999QRTRAVELI DR 999 KR 888\nXENDIT DISBURSEMENT BATCH 20240801\nBCA EDC SETTLE HARIAN TGL 20240801\nRANDOM DESCRIPTION NO MATCH"}
                className="bg-slate-800 border-slate-700 font-mono text-xs h-40"
              />
              <Button onClick={runBatch} disabled={batchLoading || !batchInput.trim()}>
                <FlaskConical className="h-4 w-4 mr-2" /> {batchLoading ? "Memproses..." : "Jalankan Batch Test"}
              </Button>

              {batchResult && (
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "Total", value: batchResult.summary?.total    ?? 0, color: "text-white" },
                      { label: "Cocok", value: batchResult.summary?.matched  ?? 0, color: "text-emerald-400" },
                      { label: "Tidak Cocok", value: batchResult.summary?.unmatched ?? 0, color: "text-red-400" },
                      { label: "Avg Confidence", value: `${batchResult.summary?.avgConfidence ?? 0}%`, color: "text-blue-400" },
                    ].map(({ label, value, color }) => (
                      <Card key={label} className="bg-slate-900 border-slate-700">
                        <CardContent className="p-3">
                          <div className={`text-xl font-bold ${color}`}>{value}</div>
                          <div className="text-slate-400 text-xs">{label}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Results table */}
                  <div className="space-y-1">
                    {batchResult.results?.map((r: any, i: number) => (
                      <div key={i} className={`flex items-center gap-3 text-xs px-3 py-2 rounded border ${r.matched ? "border-emerald-800/40 bg-emerald-950/10" : "border-slate-700 bg-slate-900"}`}>
                        {r.matched ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                        <span className="text-slate-300 font-mono flex-1 truncate">{r.description}</span>
                        <span className="text-slate-400 w-24 shrink-0">{r.provider ?? "—"}</span>
                        <span className="text-slate-400 w-28 shrink-0">{r.patternName ?? "—"}</span>
                        {confidenceBadge(r.confidencePct)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Pattern Form Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">
              {editingId ? "Edit Pattern" : "Tambah Settlement Pattern"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-slate-400 mb-1">Kode *</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="QRIS_TRAVELINTRIPS" className="bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1">Nama *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="QRIS Travelintrips" className="bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1">Provider *</Label>
                <Select value={form.provider} onValueChange={v => setForm(f => ({ ...f, provider: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1">Jenis Pattern</Label>
                <Select value={form.patternType} onValueChange={v => setForm(f => ({ ...f, patternType: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>{PATTERN_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1">Match Strategy</Label>
                <Select value={form.matchStrategy} onValueChange={v => setForm(f => ({ ...f, matchStrategy: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>{MATCH_STRATEGIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1">Settlement Delay</Label>
                <Select value={String(form.settlementDelayDays)} onValueChange={v => setForm(f => ({ ...f, settlementDelayDays: parseInt(v) }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DELAY_PRESETS.map(d => <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>)}
                    <SelectItem value="7">H+7 (Custom)</SelectItem>
                    <SelectItem value="14">H+14 (Custom)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1">Prioritas</Label>
                <Input type="number" min={0} max={999} value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                  className="bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1">Confidence Threshold (0–1)</Label>
                <Input type="number" min={0} max={1} step={0.05} value={form.confidenceThreshold}
                  onChange={e => setForm(f => ({ ...f, confidenceThreshold: parseFloat(e.target.value) || 0.8 }))}
                  className="bg-slate-800 border-slate-700" />
              </div>
            </div>

            {/* Fee Account section */}
            <div className="border-t border-slate-700 pt-4">
              <div className="text-xs text-slate-400 mb-2 font-medium flex items-center gap-1">
                Fee Account — COA Biaya MDR
                {form.feeMatching && !form.feeAccountId && (
                  <span className="ml-2 text-amber-400 font-normal">⚠ Wajib diisi saat Fee Matching aktif</span>
                )}
              </div>
              {/* Search box */}
              <Input
                value={coaSearch}
                onChange={e => setCoaSearch(e.target.value)}
                placeholder="Cari kode atau nama akun… (misal: 6-1020 atau Biaya MDR)"
                className="bg-slate-800 border-slate-700 text-sm mb-2"
              />
              {/* Current selection display */}
              {form.feeAccountId && (() => {
                const acc = coaAccounts.find(a => a.id === form.feeAccountId);
                return acc ? (
                  <div className="flex items-center justify-between bg-slate-800 border border-emerald-700 rounded px-3 py-2 mb-2">
                    <span className="text-sm text-white font-mono">{acc.code} — {acc.name}</span>
                    <Button size="sm" variant="ghost" className="text-red-400 h-6 px-2 text-xs"
                      onClick={() => { setForm(f => ({ ...f, feeAccountId: null })); setCoaSearch(""); }}>
                      ✕ Hapus
                    </Button>
                  </div>
                ) : null;
              })()}
              {/* Dropdown list */}
              {coaSearch.trim().length > 0 && (
                <div className="max-h-48 overflow-y-auto border border-slate-700 rounded bg-slate-800 divide-y divide-slate-700">
                  {coaAccounts
                    .filter(a => {
                      const q = coaSearch.toLowerCase();
                      return a.code?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q);
                    })
                    .slice(0, 30)
                    .map(a => (
                      <button
                        key={a.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-700 transition-colors ${form.feeAccountId === a.id ? "bg-purple-900/40 text-purple-200" : "text-slate-200"}`}
                        onClick={() => { setForm(f => ({ ...f, feeAccountId: a.id })); setCoaSearch(""); }}
                      >
                        <span className="font-mono text-xs text-slate-400 mr-2">{a.code}</span>
                        {a.name}
                        <span className="ml-2 text-xs text-slate-500">[{a.type}]</span>
                      </button>
                    ))}
                  {coaAccounts.filter(a => {
                    const q = coaSearch.toLowerCase();
                    return a.code?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q);
                  }).length === 0 && (
                    <div className="px-3 py-2 text-xs text-slate-500">Tidak ada akun ditemukan</div>
                  )}
                </div>
              )}
            </div>

            {/* Merchant section */}
            <div className="border-t border-slate-700 pt-4">
              <div className="text-xs text-slate-400 mb-3 font-medium">Merchant Mapping (opsional)</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Merchant Name", key: "merchantName" as const },
                  { label: "Merchant ID",   key: "merchantId"   as const },
                  { label: "Terminal ID",   key: "terminalId"   as const },
                  { label: "Bank Name",     key: "bankName"     as const },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <Label className="text-xs text-slate-400 mb-1">{label}</Label>
                    <Input value={form[key] as string} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="bg-slate-800 border-slate-700" />
                  </div>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.grossMatching} onCheckedChange={v => setForm(f => ({ ...f, grossMatching: v }))} />
                <Label className="text-sm text-slate-300">Gross Matching</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.feeMatching} onCheckedChange={v => setForm(f => ({ ...f, feeMatching: v }))} />
                <Label className="text-sm text-slate-300">Fee Matching</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
            <Button onClick={savePattern} disabled={saving || !form.code || !form.name}>
              {saving ? "Menyimpan..." : editingId ? "Perbarui" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
