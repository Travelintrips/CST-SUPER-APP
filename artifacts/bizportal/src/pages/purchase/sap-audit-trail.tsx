import { DatePicker } from "@/components/ui/date-picker";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShieldCheck, Search, Download, ChevronDown, ChevronRight,
  ClipboardList, BarChart3, ArrowLeft, RefreshCw,
  CheckCircle2, XCircle, FileText, Lock, Send, RotateCcw,
  AlertCircle, Clock,
} from "lucide-react";
import { Link } from "wouter";

const BASE = "/api";

async function apiFetch(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Action config ─────────────────────────────────────────────────────────

type ActionConfig = { label: string; color: string; icon: React.ElementType };

const ACTION_CONFIG: Record<string, ActionConfig> = {
  SAP_SUBMIT:       { label: "Submit",        color: "bg-blue-100 text-blue-800 border-blue-200",      icon: Send },
  SAP_APPROVE:      { label: "Approve",       color: "bg-green-100 text-green-800 border-green-200",   icon: CheckCircle2 },
  SAP_REJECT:       { label: "Reject",        color: "bg-red-100 text-red-800 border-red-200",         icon: XCircle },
  SAP_JOURNAL_POST: { label: "Journal Post",  color: "bg-purple-100 text-purple-800 border-purple-200",icon: FileText },
  SAP_REVERSE:      { label: "Reverse",       color: "bg-orange-100 text-orange-800 border-orange-200",icon: RotateCcw },
  SAP_LOCK:         { label: "Lock",          color: "bg-gray-100 text-gray-800 border-gray-200",      icon: Lock },
  SAP_AUTO:         { label: "Auto",          color: "bg-sky-100 text-sky-800 border-sky-200",         icon: Clock },
};

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CONFIG[action] ?? { label: action, color: "bg-gray-100 text-gray-700 border-gray-200", icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cfg.color}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function StateBadge({ state }: { state?: string }) {
  if (!state) return null;
  const MAP: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-600",
    PENDING_APPROVAL: "bg-yellow-100 text-yellow-800",
    APPROVED_LEVEL_1: "bg-blue-100 text-blue-800",
    FINAL_APPROVED: "bg-emerald-100 text-emerald-800",
    POSTED: "bg-purple-100 text-purple-800",
    LOCKED: "bg-red-100 text-red-800",
    REJECTED: "bg-red-50 text-red-600",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${MAP[state] ?? "bg-gray-100 text-gray-600"}`}>
      {state}
    </span>
  );
}

function DataCell({ label, data }: { label: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  if (!data) return <span className="text-gray-400 text-xs">—</span>;
  const str = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const preview = str.length > 55 ? str.slice(0, 55) + "…" : str;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-medium">{label}</span>
          {!open && <code className="text-gray-400">{preview}</code>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 text-xs bg-gray-50 rounded p-2 max-h-48 overflow-auto border whitespace-pre-wrap">{str}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  role: string | null;
  before_data: unknown;
  after_data: unknown;
  timestamp: string;
  invoice_number: string | null;
}

interface AuditResponse {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

interface StatRow {
  entity_type: string;
  action: string;
  count: number;
  last_seen: string;
}

// ─── Filters state ─────────────────────────────────────────────────────────

const LIMIT = 50;
const ENTITY_TYPES = ["", "vendor_invoice"];
const ACTIONS = ["", ...Object.keys(ACTION_CONFIG)];

function buildUrl(params: Record<string, string | number>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== "" && v !== undefined && v !== null) q.set(k, String(v));
  }
  const s = q.toString();
  return `${BASE}/purchase/sap-audit-ledger${s ? "?" + s : ""}`;
}

function InvoiceLink({ entry }: { entry: AuditEntry }) {
  const label = entry.invoice_number ?? `#${entry.entity_id}`;
  if (!entry.entity_id) return <span className="text-gray-400">—</span>;
  return (
    <Link href={`/purchase/vendor-invoices/${entry.entity_id}`}
      className="font-mono text-blue-600 hover:underline text-xs">
      {label}
    </Link>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function SapAuditTrailPage() {
  const today = new Date().toISOString().split("T")[0]!;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0]!;

  const [entityType,    setEntityType]    = useState("");
  const [entityId,      setEntityId]      = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [action,        setAction]        = useState("");
  const [actorId,       setActorId]       = useState("");
  const [from,          setFrom]          = useState(thirtyDaysAgo);
  const [to,            setTo]            = useState(today);
  const [page,          setPage]          = useState(0);

  const [applied, setApplied] = useState({
    entityType: "", entityId: "", invoiceNumber: "", action: "", actorId: "",
    from: thirtyDaysAgo, to: today, page: 0,
  });

  const applyFilters = useCallback(() => {
    setApplied({ entityType, entityId, invoiceNumber, action, actorId, from, to, page: 0 });
    setPage(0);
  }, [entityType, entityId, invoiceNumber, action, actorId, from, to]);

  const ledgerUrl = buildUrl({
    entity_type:    applied.entityType,
    entity_id:      applied.entityId,
    invoice_number: applied.invoiceNumber,
    action:         applied.action,
    actor_id:       applied.actorId,
    from:           applied.from,
    to:             applied.to,
    limit:          LIMIT,
    offset:         applied.page * LIMIT,
  });

  const { data: ledger, isFetching, refetch } = useQuery<AuditResponse>({
    queryKey: ["sap-audit-ledger", ledgerUrl],
    queryFn: () => apiFetch(ledgerUrl),
  });

  const { data: stats } = useQuery<StatRow[]>({
    queryKey: ["sap-audit-stats"],
    queryFn: () => apiFetch(`${BASE}/purchase/sap-audit-ledger/stats`),
  });

  const totalPages = Math.max(1, Math.ceil((ledger?.total ?? 0) / LIMIT));

  function changePage(delta: number) {
    const next = Math.max(0, Math.min(totalPages - 1, (applied.page) + delta));
    setPage(next);
    setApplied(prev => ({ ...prev, page: next }));
  }

  function exportCsv() {
    const rows = ledger?.items ?? [];
    const header = ["id", "invoice_number", "entity_type", "entity_id", "action", "actor_id", "role", "timestamp"].join(",");
    const body = rows.map(r =>
      [r.id, r.invoice_number ?? "", r.entity_type, r.entity_id, r.action, r.actor_id ?? "", r.role ?? "", r.timestamp].join(",")
    ).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sap-audit-trail-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/purchase/vendor-invoices">
              <Button variant="ghost" size="sm" className="gap-1">
                <ArrowLeft size={16} /> Kembali
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <ShieldCheck size={22} className="text-purple-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">SAP Audit Trail</h1>
                <p className="text-xs text-gray-500">Seluruh lifecycle dokumen: submit, approve, posting jurnal, lock, reversal</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
              <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1">
              <Download size={14} /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
        <Tabs defaultValue="trail">
          <TabsList>
            <TabsTrigger value="trail" className="gap-1"><ClipboardList size={14} /> Audit Trail</TabsTrigger>
            <TabsTrigger value="stats" className="gap-1"><BarChart3 size={14} /> Statistik</TabsTrigger>
          </TabsList>

          {/* ── Audit Trail Tab ─────────────────────────────────────────── */}
          <TabsContent value="trail" className="mt-4 space-y-4">

            {/* Filters */}
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">No. Invoice</Label>
                    <Input className="h-8 text-xs" placeholder="VI-2026-001"
                      value={invoiceNumber}
                      onChange={e => setInvoiceNumber(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && applyFilters()} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tipe Entitas</Label>
                    <Select value={entityType} onValueChange={setEntityType}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Semua" /></SelectTrigger>
                      <SelectContent>
                        {ENTITY_TYPES.map(t => (
                          <SelectItem key={t} value={t} className="text-xs">{t || "— Semua —"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Entity ID</Label>
                    <Input className="h-8 text-xs" placeholder="contoh: 42" value={entityId}
                      onChange={e => setEntityId(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && applyFilters()} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Aksi</Label>
                    <Select value={action} onValueChange={setAction}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Semua" /></SelectTrigger>
                      <SelectContent>
                        {ACTIONS.map(a => (
                          <SelectItem key={a} value={a} className="text-xs">{a || "— Semua —"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Actor</Label>
                    <Input className="h-8 text-xs" placeholder="email / user" value={actorId}
                      onChange={e => setActorId(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && applyFilters()} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Dari</Label>
                    <DatePicker value={from} onChange={v => setFrom(v)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sampai</Label>
                    <DatePicker value={to} onChange={v => setTo(v)} className="h-8 text-xs" />
                  </div>
                  <Button size="sm" className="h-8 gap-1" onClick={applyFilters}>
                    <Search size={13} /> Cari
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Summary bar */}
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>
                {isFetching
                  ? "Memuat…"
                  : `${ledger?.total ?? 0} entri ditemukan`}
              </span>
              {(ledger?.total ?? 0) > LIMIT && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={applied.page === 0}
                    onClick={() => changePage(-1)}>‹ Prev</Button>
                  <span className="text-xs">Hal {applied.page + 1} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={applied.page >= totalPages - 1}
                    onClick={() => changePage(1)}>Next ›</Button>
                </div>
              )}
            </div>

            {/* Table */}
            <Card>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="text-xs w-36">Waktu</TableHead>
                      <TableHead className="text-xs w-32">Aksi</TableHead>
                      <TableHead className="text-xs w-32">Entitas</TableHead>
                      <TableHead className="text-xs w-36">No. Invoice</TableHead>
                      <TableHead className="text-xs w-40">Actor</TableHead>
                      <TableHead className="text-xs w-24">Role</TableHead>
                      <TableHead className="text-xs">State Before → After</TableHead>
                      <TableHead className="text-xs">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!ledger?.items?.length ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-gray-400 py-12 text-sm">
                          {isFetching ? "Memuat data…" : "Tidak ada entri audit ditemukan."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      ledger.items.map(entry => {
                        const before = entry.before_data as Record<string, unknown> | null | undefined;
                        const after  = entry.after_data  as Record<string, unknown> | null | undefined;
                        const stateB = before?.approval_status as string | undefined;
                        const stateA = after?.approval_status  as string | undefined;
                        return (
                          <TableRow key={entry.id} className="align-top hover:bg-gray-50">
                            <TableCell className="text-xs text-gray-500 whitespace-nowrap py-2">
                              {new Date(entry.timestamp).toLocaleString("id-ID", {
                                dateStyle: "short", timeStyle: "short",
                              })}
                            </TableCell>
                            <TableCell className="py-2">
                              <ActionBadge action={entry.action} />
                            </TableCell>
                            <TableCell className="text-xs text-gray-600 py-2">
                              {entry.entity_type}
                            </TableCell>
                            <TableCell className="py-2">
                              <InvoiceLink entry={entry} />
                            </TableCell>
                            <TableCell className="text-xs py-2 max-w-[160px] truncate" title={entry.actor_id ?? ""}>
                              {entry.actor_id ?? <span className="text-gray-400">—</span>}
                            </TableCell>
                            <TableCell className="text-xs py-2">
                              {entry.role
                                ? <Badge variant="outline" className="text-xs">{entry.role}</Badge>
                                : <span className="text-gray-400">—</span>}
                            </TableCell>
                            <TableCell className="py-2">
                              {(stateB || stateA) ? (
                                <div className="flex items-center gap-1 flex-wrap">
                                  {stateB && <StateBadge state={stateB} />}
                                  {stateB && stateA && <span className="text-gray-400 text-xs">→</span>}
                                  {stateA && <StateBadge state={stateA} />}
                                </div>
                              ) : <span className="text-gray-400 text-xs">—</span>}
                            </TableCell>
                            <TableCell className="py-2 space-y-1">
                              <DataCell label="Before" data={entry.before_data} />
                              <DataCell label="After"  data={entry.after_data} />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* Bottom pagination */}
            {(ledger?.total ?? 0) > LIMIT && (
              <div className="flex justify-center gap-2">
                <Button variant="outline" size="sm" disabled={applied.page === 0}
                  onClick={() => changePage(-1)}>‹ Prev</Button>
                <span className="text-sm text-gray-500 flex items-center">Hal {applied.page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={applied.page >= totalPages - 1}
                  onClick={() => changePage(1)}>Next ›</Button>
              </div>
            )}
          </TabsContent>

          {/* ── Statistik Tab ───────────────────────────────────────────── */}
          <TabsContent value="stats" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Action frequency */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 size={16} className="text-purple-600" /> Frekuensi Aksi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!stats?.length ? (
                    <p className="text-sm text-gray-400 py-4 text-center">Belum ada data statistik.</p>
                  ) : (
                    <div className="space-y-2">
                      {stats.map((row, i) => {
                        const cfg = ACTION_CONFIG[row.action];
                        const Icon = cfg?.icon ?? AlertCircle;
                        const maxCount = Math.max(...stats.map(s => s.count));
                        const pct = Math.round((row.count / maxCount) * 100);
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="flex items-center gap-1.5 text-xs">
                                <Icon size={12} />
                                <span className="font-medium">{cfg?.label ?? row.action}</span>
                                <span className="text-gray-400 text-[10px]">({row.entity_type})</span>
                              </span>
                              <span className="text-xs font-semibold text-gray-700">{row.count}×</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div className="bg-purple-500 h-1.5 rounded-full transition-all"
                                style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent activity */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock size={16} className="text-blue-600" /> Aktivitas Terakhir per Aksi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!stats?.length ? (
                    <p className="text-sm text-gray-400 py-4 text-center">Belum ada data statistik.</p>
                  ) : (
                    <div className="divide-y">
                      {[...stats]
                        .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
                        .map((row, i) => (
                          <div key={i} className="flex items-center justify-between py-1.5">
                            <ActionBadge action={row.action} />
                            <span className="text-xs text-gray-500">
                              {new Date(row.last_seen).toLocaleString("id-ID", {
                                dateStyle: "short", timeStyle: "short",
                              })}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Quick summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {Object.entries(ACTION_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const row = stats?.find(s => s.action === key);
                return (
                  <Card key={key} className="border-0 shadow-sm">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-500">{cfg.label}</p>
                          <p className="text-2xl font-bold text-gray-900 mt-0.5">{row?.count ?? 0}</p>
                        </div>
                        <div className={`p-2 rounded-lg ${cfg.color}`}>
                          <Icon size={18} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
