import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
import {
  ClipboardList, Search, Download, ChevronDown, ChevronRight,
  Link2, Send, FileCheck, Wrench, CheckCircle, XCircle,
  Clock, AlertCircle, AlertTriangle, BellRing, Loader2, Settings2, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

const BASE = "/api";

async function apiFetch(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Action config ─────────────────────────────────────────────────────────────

type ActionConfig = {
  label: string;
  color: string;
  icon: React.ElementType;
  critical?: boolean;
};

const ACTION_CONFIG: Record<string, ActionConfig> = {
  link_generated:     { label: "Link Generated",    color: "bg-blue-100 text-blue-800 border-blue-200",        icon: Link2,       critical: true },
  approval_sent:      { label: "Approval Sent",      color: "bg-violet-100 text-violet-800 border-violet-200",  icon: Send,        critical: true },
  so_created:         { label: "SO Created",         color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: FileCheck,  critical: true },
  op_confirm_sent:    { label: "Op-Confirm Sent",    color: "bg-orange-100 text-orange-800 border-orange-200",  icon: Wrench,      critical: true },
  created:            { label: "Created",            color: "bg-sky-100 text-sky-800 border-sky-200",            icon: Clock },
  submitted:          { label: "Submitted",          color: "bg-teal-100 text-teal-800 border-teal-200",         icon: Send },
  resubmitted:        { label: "Resubmitted",        color: "bg-cyan-100 text-cyan-800 border-cyan-200",         icon: Send },
  selected:           { label: "Selected",           color: "bg-indigo-100 text-indigo-800 border-indigo-200",   icon: CheckCircle },
  approved:           { label: "Approved",           color: "bg-green-100 text-green-800 border-green-200",      icon: CheckCircle },
  rejected:           { label: "Rejected",           color: "bg-red-100 text-red-800 border-red-200",            icon: XCircle },
  op_submitted:       { label: "Op Submitted",       color: "bg-amber-100 text-amber-800 border-amber-200",      icon: Wrench },
  sent_wa:            { label: "WA Sent",            color: "bg-green-50 text-green-700 border-green-100",       icon: Send },
  revision_requested: { label: "Revision",           color: "bg-yellow-100 text-yellow-800 border-yellow-200",  icon: AlertCircle },
  deleted:            { label: "Deleted",            color: "bg-red-50 text-red-700 border-red-100",             icon: XCircle },
  price_updated:      { label: "Price Updated",      color: "bg-gray-100 text-gray-700 border-gray-200",         icon: Clock },
  bulk_deactivated:   { label: "Bulk Deactivated",   color: "bg-gray-100 text-gray-600 border-gray-200",         icon: Clock },
};

const ENTITY_LABELS: Record<string, string> = {
  link: "Vendor Link",
  submission: "Submission",
  customer_approval: "Customer Approval",
  op_confirm: "Op-Confirm",
  sales_order: "Sales Order",
};

const CRITICAL_ACTIONS = ["link_generated", "approval_sent", "so_created", "op_confirm_sent"] as const;
type CriticalAction = typeof CRITICAL_ACTIONS[number];

// ── Shared badge components ───────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CONFIG[action] ?? { label: action, color: "bg-gray-100 text-gray-700 border-gray-200", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cfg.color} ${cfg.critical ? "font-semibold" : ""}`}>
      <Icon size={11} />
      {cfg.label}
      {cfg.critical && <span className="ml-0.5 text-[9px] font-bold opacity-70">★</span>}
    </span>
  );
}

function EntityBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {ENTITY_LABELS[type] ?? type}
    </Badge>
  );
}

function DataCell({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  if (!data || (typeof data === "object" && Object.keys(data as object).length === 0)) {
    return <span className="text-gray-300 text-xs">—</span>;
  }
  const str = JSON.stringify(data, null, 2);
  const preview = str.length > 50 ? str.slice(0, 50) + "…" : str;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <code className="text-gray-500 text-[11px]">{!open && preview}</code>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 text-[11px] bg-gray-50 rounded p-2 max-h-36 overflow-auto border whitespace-pre-wrap">{str}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Timeline per order ────────────────────────────────────────────────────────

type LogRow = {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  actor: string | null;
  note: string | null;
  data: unknown;
  createdAt: string;
};

function OrderTimeline({ orderNumber, rows }: { orderNumber: string; rows: LogRow[] }) {
  const [open, setOpen] = useState(false);
  const criticalHit = CRITICAL_ACTIONS.filter(a => rows.some(r => r.action === a));
  const missingCritical = CRITICAL_ACTIONS.filter(a => !rows.some(r => r.action === a));
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 text-left"
      >
        {open ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
        <span className="font-mono text-sm font-semibold text-gray-800">{orderNumber}</span>
        <span className="text-xs text-gray-400">{rows.length} event</span>
        <div className="flex gap-1 flex-wrap">
          {criticalHit.map(a => {
            const cfg = ACTION_CONFIG[a];
            const Icon = cfg?.icon ?? Clock;
            return (
              <span key={a} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cfg?.color}`}>
                <Icon size={9} />{cfg?.label}
              </span>
            );
          })}
          {missingCritical.map(a => (
            <span key={a} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] text-gray-400 border-gray-200 bg-gray-50">
              <AlertCircle size={9} /> {ACTION_CONFIG[a]?.label ?? a}?
            </span>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-gray-400 shrink-0">
          {new Date(sorted[0]?.createdAt ?? "").toLocaleDateString("id-ID")}
        </span>
      </button>

      {open && (
        <div className="border-t bg-gray-50 px-4 py-3">
          <div className="relative">
            <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-gray-200" />
            <div className="space-y-3">
              {sorted.map(row => {
                const cfg = ACTION_CONFIG[row.action] ?? { label: row.action, color: "bg-gray-100 text-gray-700", icon: Clock, critical: false };
                const Icon = cfg.icon;
                return (
                  <div key={row.id} className="relative flex gap-3">
                    <div className={`relative z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${cfg.critical ? "border-white shadow-sm bg-white" : "bg-white border-gray-200"}`}>
                      <Icon size={12} className={cfg.critical ? "text-blue-600" : "text-gray-400"} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ActionBadge action={row.action} />
                        <EntityBadge type={row.entityType} />
                        {row.entityId > 0 && <span className="text-[10px] text-gray-400 font-mono">ID:{row.entityId}</span>}
                        <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                          {new Date(row.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" })}
                        </span>
                      </div>
                      {row.note && <p className="text-xs text-gray-600 mt-0.5">{row.note}</p>}
                      <div className="mt-1"><DataCell data={row.data} /></div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        actor: <span className="font-mono">{row.actor ?? "—"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Gap indicator row ─────────────────────────────────────────────────────────

type GapEntry = {
  orderNumber: string;
  present: CriticalAction[];
  missing: CriticalAction[];
  hasGap: boolean;
  firstEvent: string;
  lastEvent: string;
  totalEvents: number;
};

const GAP_NEXT_STEP: Record<CriticalAction, string> = {
  link_generated:  "Kirim link approval ke customer",
  approval_sent:   "Tunggu customer approve → SO dibuat",
  so_created:      "Kirim link op-confirm ke vendor",
  op_confirm_sent: "Selesai",
};

function GapRow({ row }: { row: GapEntry }) {
  const lastPresent = [...row.present].reverse()[0];
  const nextMissing = row.missing[0];
  const daysSinceLastEvent = Math.floor(
    (Date.now() - new Date(row.lastEvent).getTime()) / 86_400_000
  );
  const isStale = daysSinceLastEvent >= 3;

  return (
    <div className={`border rounded-lg p-3 flex flex-col gap-2 ${isStale ? "border-red-200 bg-red-50/30" : "border-amber-200 bg-amber-50/20"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <AlertTriangle size={14} className={isStale ? "text-red-500 shrink-0" : "text-amber-500 shrink-0"} />
        <span className="font-mono text-sm font-semibold">{row.orderNumber}</span>
        {isStale && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 font-semibold">
            Stuck {daysSinceLastEvent}h
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-400">
          Terakhir: {new Date(row.lastEvent).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 items-center">
        {CRITICAL_ACTIONS.map((a, i) => {
          const isDone = row.present.includes(a);
          const cfg = ACTION_CONFIG[a];
          const Icon = cfg?.icon ?? Clock;
          return (
            <div key={a} className="flex items-center gap-1">
              {i > 0 && <div className={`w-4 h-0.5 ${isDone ? "bg-emerald-400" : "bg-gray-200"}`} />}
              <div className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
                isDone
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : a === nextMissing
                    ? "bg-amber-50 border-amber-300 text-amber-700 ring-1 ring-amber-300"
                    : "bg-gray-50 border-gray-200 text-gray-400"
              }`}>
                <Icon size={10} />
                {cfg?.label}
                {isDone && <CheckCircle size={9} className="text-emerald-500" />}
                {!isDone && a === nextMissing && <span className="text-amber-600">←</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Next action hint */}
      {nextMissing && lastPresent && (
        <div className="text-xs text-gray-600 flex items-center gap-1.5">
          <span className="font-medium text-amber-700">Tindakan berikutnya:</span>
          {GAP_NEXT_STEP[lastPresent]}
        </div>
      )}
    </div>
  );
}

// ── Stats card ────────────────────────────────────────────────────────────────

function CriticalStat({ action, count, total }: { action: string; count: number; total: number }) {
  const cfg = ACTION_CONFIG[action];
  const Icon = cfg?.icon ?? Clock;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-gray-500" />
        <span className="text-xs text-gray-500">{cfg?.label ?? action}</span>
      </div>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs text-gray-400">{pct}% dari total</div>
    </Card>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["", "link", "submission", "customer_approval", "op_confirm", "sales_order"];
const ALL_ACTIONS = [
  "", "link_generated", "approval_sent", "so_created", "op_confirm_sent",
  "created", "submitted", "resubmitted", "selected", "approved", "rejected",
  "op_submitted", "sent_wa", "revision_requested", "deleted", "price_updated",
];

type FilterState = {
  from: string; to: string;
  entityType: string; action: string;
  orderNumber: string; actor: string;
};

function FilterBar({
  filters, onChange, onSearch, onExport, showActionFilter = true,
}: {
  filters: FilterState;
  onChange: (k: keyof FilterState, v: string) => void;
  onSearch: () => void;
  onExport?: () => void;
  showActionFilter?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm">Filter</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">Dari</Label>
            <DatePicker value={filters.from} onChange={v => onChange("from", v)} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Sampai</Label>
            <DatePicker value={filters.to} onChange={v => onChange("to", v)} className="h-8 text-sm" />
          </div>
          {showActionFilter && (
            <div>
              <Label className="text-xs">Tipe Entity</Label>
              <Select value={filters.entityType || "_all"} onValueChange={v => onChange("entityType", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Semua</SelectItem>
                  {ENTITY_TYPES.filter(Boolean).map(t => (
                    <SelectItem key={t} value={t}>{ENTITY_LABELS[t] ?? t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {showActionFilter && (
            <div>
              <Label className="text-xs">Aksi</Label>
              <Select value={filters.action || "_all"} onValueChange={v => onChange("action", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua aksi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Semua aksi</SelectItem>
                  {ALL_ACTIONS.filter(Boolean).map(a => (
                    <SelectItem key={a} value={a}>
                      {ACTION_CONFIG[a]?.label ?? a}
                      {CRITICAL_ACTIONS.includes(a as CriticalAction) ? " ★" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">No. Order</Label>
            <Input value={filters.orderNumber} onChange={e => onChange("orderNumber", e.target.value)} placeholder="ORD/2025/…" className="h-8 text-sm" />
          </div>
          {showActionFilter && (
            <div>
              <Label className="text-xs">Actor</Label>
              <Input value={filters.actor} onChange={e => onChange("actor", e.target.value)} placeholder="admin / vendor" className="h-8 text-sm" />
            </div>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={onSearch} className="gap-1"><Search size={14} /> Cari</Button>
          {onExport && (
            <Button size="sm" variant="outline" onClick={onExport} className="gap-1"><Download size={14} /> Export CSV</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tab: Timeline / Table ─────────────────────────────────────────────────────

function AuditLogTab() {
  const today = new Date().toISOString().split("T")[0]!;
  const [filters, setFilters] = useState<FilterState>({ from: "", to: "", entityType: "", action: "", orderNumber: "", actor: "" });
  const [applied, setApplied] = useState(filters);
  const [viewMode, setViewMode] = useState<"timeline" | "table">("timeline");
  const [page, setPage] = useState(0);
  const limit = 100;

  const params = new URLSearchParams({
    limit: String(limit), offset: String(page * limit),
    ...(applied.entityType ? { entityType: applied.entityType } : {}),
    ...(applied.action ? { action: applied.action } : {}),
    ...(applied.orderNumber.trim() ? { orderNumber: applied.orderNumber.trim() } : {}),
    ...(applied.actor.trim() ? { actor: applied.actor.trim() } : {}),
    ...(applied.from ? { from: applied.from } : {}),
    ...(applied.to ? { to: applied.to } : {}),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["vmf-audit-log", applied, page],
    queryFn: () => apiFetch(`${BASE}/vendor-form/admin/activity-log?${params}`),
  });

  const rows: LogRow[] = data?.rows ?? [];
  const total: number = data?.total ?? 0;

  const grouped = new Map<string, LogRow[]>();
  for (const row of rows) {
    const key = (row.data as Record<string, unknown>)?.orderNumber as string | undefined ?? `entity:${row.entityType}#${row.entityId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const actionCounts = CRITICAL_ACTIONS.map(a => ({ action: a, count: rows.filter(r => r.action === a).length }));

  function exportCsv() {
    if (!rows.length) return;
    const cols = ["id", "createdAt", "entityType", "entityId", "action", "actor", "note"];
    const header = cols.join(",");
    const body = rows.map(r => cols.map(c => JSON.stringify((r as Record<string, unknown>)[c] ?? "")).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `vmf-audit-trail-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant={viewMode === "timeline" ? "default" : "outline"} onClick={() => setViewMode("timeline")}>Timeline</Button>
        <Button size="sm" variant={viewMode === "table" ? "default" : "outline"} onClick={() => setViewMode("table")}>Tabel</Button>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {actionCounts.map(({ action, count }) => (
            <CriticalStat key={action} action={action} count={count} total={rows.length} />
          ))}
        </div>
      )}

      <FilterBar
        filters={filters}
        onChange={(k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(0); }}
        onSearch={() => { setApplied(filters); setPage(0); refetch(); }}
        onExport={exportCsv}
      />

      {isLoading && <div className="p-10 text-center text-gray-400 text-sm">Memuat data…</div>}
      {error && <div className="p-8 text-center text-red-500 text-sm">{String(error)}</div>}

      {!isLoading && !error && (
        <>
          <div className="text-xs text-gray-400 px-1">{total} entri{page > 0 ? ` · halaman ${page + 1}` : ""}</div>

          {viewMode === "timeline" && (
            <div className="space-y-2">
              {grouped.size === 0 && (
                <div className="text-center text-gray-400 text-sm py-12 border rounded-lg bg-white">Tidak ada data</div>
              )}
              {[...grouped.entries()].map(([key, orderRows]) => (
                <OrderTimeline key={key} orderNumber={key} rows={orderRows} />
              ))}
            </div>
          )}

          {viewMode === "table" && (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Waktu</TableHead>
                        <TableHead>Aksi</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>ID</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Catatan</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 && (
                        <TableRow><TableCell colSpan={8} className="text-center text-gray-400 py-10 text-sm">Tidak ada data</TableCell></TableRow>
                      )}
                      {rows.map(row => (
                        <TableRow key={row.id} className={`text-xs align-top ${CRITICAL_ACTIONS.includes(row.action as CriticalAction) ? "bg-blue-50/40" : ""}`}>
                          <TableCell className="text-gray-400 font-mono">{row.id}</TableCell>
                          <TableCell className="whitespace-nowrap text-gray-600">
                            {new Date(row.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" })}
                          </TableCell>
                          <TableCell><ActionBadge action={row.action} /></TableCell>
                          <TableCell><EntityBadge type={row.entityType} /></TableCell>
                          <TableCell className="font-mono text-gray-500">{row.entityId || "—"}</TableCell>
                          <TableCell>
                            <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                              row.actor === "system" ? "bg-gray-100 text-gray-500"
                              : row.actor === "customer" ? "bg-purple-50 text-purple-700"
                              : row.actor === "vendor" ? "bg-teal-50 text-teal-700"
                              : "bg-blue-50 text-blue-700"
                            }`}>{row.actor ?? "—"}</span>
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            <p className="text-xs text-gray-600 line-clamp-2">{row.note ?? "—"}</p>
                          </TableCell>
                          <TableCell className="min-w-[150px]"><DataCell data={row.data} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next →</Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab: Gap Detection ────────────────────────────────────────────────────────

function GapConfigCard() {
  const qc = useQueryClient();
  const { data: cfg, isLoading: cfgLoading } = useQuery<{ thresholdDays: number; enabled: boolean }>({
    queryKey: ["vmf-gap-config"],
    queryFn: () => apiFetch(`${BASE}/vendor-form/admin/gap-config`),
  });

  const [days, setDays] = useState<string>("");
  const [enabled, setEnabled] = useState<boolean>(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (cfg) {
      setDays(String(cfg.thresholdDays));
      setEnabled(cfg.enabled);
    }
  }, [cfg]);

  const saveMutation = useMutation({
    mutationFn: (payload: { thresholdDays?: number; enabled?: boolean }) =>
      fetch(`${BASE}/vendor-form/admin/gap-config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vmf-gap-config"] });
      setSaveMsg("Konfigurasi disimpan.");
      setTimeout(() => setSaveMsg(null), 4000);
    },
  });

  const daysNum = parseInt(days, 10);
  const daysValid = !isNaN(daysNum) && daysNum >= 1 && daysNum <= 365;

  function save() {
    const payload: { thresholdDays?: number; enabled?: boolean } = {};
    if (daysValid) payload.thresholdDays = daysNum;
    payload.enabled = enabled;
    saveMutation.mutate(payload);
  }

  return (
    <Card className="border-blue-100 bg-blue-50/40">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings2 size={14} className="text-blue-600" />
          Konfigurasi Alert Otomatis
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {cfgLoading ? (
          <div className="text-xs text-gray-400 py-2">Memuat konfigurasi…</div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            {/* Enabled toggle */}
            <div className="flex items-center gap-2">
              <Switch
                checked={enabled}
                onCheckedChange={v => setEnabled(v)}
                id="gap-enabled"
              />
              <label htmlFor="gap-enabled" className="text-sm font-medium cursor-pointer">
                Alert WA aktif
              </label>
              <span className={`text-xs px-1.5 py-0.5 rounded ${enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                {enabled ? "ON" : "OFF"}
              </span>
            </div>

            {/* Threshold days */}
            <div className="flex items-center gap-2">
              <Label className="text-xs text-gray-500 whitespace-nowrap">Threshold stuck</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={e => setDays(e.target.value)}
                  className={`h-8 w-20 text-sm text-center ${!daysValid && days !== "" ? "border-red-400" : ""}`}
                />
                <span className="text-xs text-gray-500">hari</span>
              </div>
              {!daysValid && days !== "" && (
                <span className="text-xs text-red-500">1–365</span>
              )}
            </div>

            <Button
              size="sm"
              onClick={save}
              disabled={saveMutation.isPending || (!daysValid && days !== "")}
              className="gap-1"
            >
              {saveMutation.isPending
                ? <><Loader2 size={12} className="animate-spin" /> Menyimpan…</>
                : "Simpan"
              }
            </Button>

            {saveMsg && (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
                ✓ {saveMsg}
              </span>
            )}

            <span className="text-xs text-gray-400 ml-auto">
              Alert dikirim harian ke grup admin WA untuk order stuck lebih dari threshold.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GapsTab() {
  const [filters, setFilters] = useState<FilterState>({ from: "", to: "", entityType: "", action: "", orderNumber: "", actor: "" });
  const [applied, setApplied] = useState(filters);
  const [gapAfter, setGapAfter] = useState<string>("");
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  const triggerMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/vendor-form/admin/activity-log/gaps/trigger`, {
        method: "POST",
        credentials: "include",
      }).then(r => r.json()),
    onSuccess: (data: { message?: string }) => {
      setTriggerMsg(data.message ?? "Gap check dimulai.");
      setTimeout(() => setTriggerMsg(null), 6000);
    },
  });

  const params = new URLSearchParams({
    ...(applied.from ? { from: applied.from } : {}),
    ...(applied.to ? { to: applied.to } : {}),
    ...(applied.orderNumber.trim() ? { orderNumber: applied.orderNumber.trim() } : {}),
    ...(gapAfter ? { gapAfter } : {}),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["vmf-gaps", applied, gapAfter],
    queryFn: () => apiFetch(`${BASE}/vendor-form/admin/activity-log/gaps?${params}`),
  });

  const rows: GapEntry[] = data?.rows ?? [];
  const summary = data?.summary;

  function exportCsv() {
    if (!rows.length) return;
    const header = "orderNumber,present,missing,firstEvent,lastEvent,totalEvents";
    const body = rows.map(r =>
      [r.orderNumber, r.present.join("|"), r.missing.join("|"), r.firstEvent, r.lastEvent, r.totalEvents]
        .map(v => JSON.stringify(v)).join(",")
    ).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `vmf-gaps-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3 col-span-1">
            <div className="text-xs text-gray-500 mb-1">Total Order</div>
            <div className="text-2xl font-bold">{summary.total_orders}</div>
          </Card>
          <Card className={`p-3 ${summary.orders_with_gap > 0 ? "border-amber-300 bg-amber-50" : ""}`}>
            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <AlertTriangle size={11} className="text-amber-500" /> Ada Gap
            </div>
            <div className="text-2xl font-bold text-amber-700">{summary.orders_with_gap}</div>
          </Card>
          {(["link_generated", "approval_sent", "so_created", "op_confirm_sent"] as const).map(a => (
            <Card key={a} className="p-3">
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                {(() => { const Icon = ACTION_CONFIG[a]?.icon ?? Clock; return <Icon size={11} />; })()}
                Tanpa {ACTION_CONFIG[a]?.label}
              </div>
              <div className="text-xl font-bold">{(summary as Record<string, number>)[`missing_${a}`]}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm">Filter Gap</CardTitle></CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Dari</Label>
              <DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v }))} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Sampai</Label>
              <DatePicker value={filters.to} onChange={v => setFilters(f => ({ ...f, to: v }))} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">No. Order</Label>
              <Input value={filters.orderNumber} onChange={e => setFilters(f => ({ ...f, orderNumber: e.target.value }))} placeholder="ORD/2025/…" className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Gap setelah step</Label>
              <Select value={gapAfter || "_all"} onValueChange={v => setGapAfter(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua gap" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Semua gap</SelectItem>
                  {CRITICAL_ACTIONS.map(a => (
                    <SelectItem key={a} value={a}>Setelah {ACTION_CONFIG[a]?.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <Button size="sm" onClick={() => { setApplied(filters); refetch(); }} className="gap-1"><Search size={14} /> Cari</Button>
            <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1"><Download size={14} /> Export CSV</Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
                disabled={triggerMutation.isPending}
                onClick={() => triggerMutation.mutate()}
              >
                {triggerMutation.isPending
                  ? <><Loader2 size={13} className="animate-spin" /> Mengirim…</>
                  : <><BellRing size={13} /> Kirim Alert WA Sekarang</>
                }
              </Button>
              {triggerMsg && (
                <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
                  ✓ {triggerMsg}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <GapConfigCard />

      {isLoading && <div className="p-10 text-center text-gray-400 text-sm">Menganalisis gap…</div>}
      {error && <div className="p-8 text-center text-red-500 text-sm">{String(error)}</div>}

      {!isLoading && !error && (
        <>
          {rows.length === 0 ? (
            <div className="text-center py-14 border rounded-lg bg-white text-gray-400 text-sm">
              <CheckCircle className="mx-auto mb-2 text-emerald-400" size={32} />
              Tidak ada gap terdeteksi — semua order sudah lengkap step kritisnya!
            </div>
          ) : (
            <>
              <div className="text-xs text-gray-500 px-1">
                <span className="font-semibold text-amber-700">{rows.length} order</span> memiliki gap alur VMF
              </div>
              <div className="space-y-2">
                {rows.map(row => <GapRow key={row.orderNumber} row={row} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VmfAuditTrailPage() {
  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ClipboardList className="text-blue-600" size={22} />
        <Link href="/purchase/vendor-forms"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

        <h1 className="text-xl font-bold">Audit Trail VMF</h1>
        <span className="text-sm text-gray-500 ml-2">Rekam jejak alur Vendor Mini Form</span>
      </div>

      {/* Critical steps legend */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium">4 Step Kritis:</span>
        {CRITICAL_ACTIONS.map(a => <ActionBadge key={a} action={a} />)}
        <span className="text-xs text-gray-400 ml-1">★ = tercatat &nbsp;·&nbsp; ? = belum tercatat</span>
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline &amp; Log</TabsTrigger>
          <TabsTrigger value="gaps" className="flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber-500" />
            Gap Detection
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-4">
          <AuditLogTab />
        </TabsContent>

        <TabsContent value="gaps" className="mt-4">
          <GapsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
