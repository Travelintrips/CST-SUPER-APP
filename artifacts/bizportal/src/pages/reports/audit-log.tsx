import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, ChevronDown, ChevronRight, Shield, Search, Download } from "lucide-react";
import { Link } from "wouter";

const BASE = "/api";

async function apiFetch(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const MODULE_LABELS: Record<string, string> = {
  auth: "Login/Auth", pos: "POS", product: "Produk",
  recipe: "Resep/BOM", stock: "Stok", transfer: "Transfer",
  return: "Retur", damage: "Rusak/Hilang", opname: "Opname",
  role: "Role", permission: "Permission",
};

const ACTION_COLORS: Record<string, string> = {
  login: "bg-green-100 text-green-800",
  logout: "bg-gray-100 text-gray-800",
  create: "bg-blue-100 text-blue-800",
  update: "bg-yellow-100 text-yellow-800",
  delete: "bg-red-100 text-red-800",
  confirm: "bg-purple-100 text-purple-800",
  cancel: "bg-orange-100 text-orange-800",
  pay: "bg-emerald-100 text-emerald-800",
  adjust: "bg-cyan-100 text-cyan-800",
  transfer: "bg-indigo-100 text-indigo-800",
  opname: "bg-violet-100 text-violet-800",
};

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_COLORS[action] ?? "bg-gray-100 text-gray-700";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{action}</span>;
}

function ModuleBadge({ module }: { module: string }) {
  return <Badge variant="outline" className="text-xs">{MODULE_LABELS[module] ?? module}</Badge>;
}

function DataCell({ label, data }: { label: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  if (!data) return <span className="text-gray-400 text-xs">—</span>;
  const str = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const preview = str.length > 60 ? str.slice(0, 60) + "…" : str;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{label}: {!open && <code className="text-gray-500">{preview}</code>}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 text-xs bg-gray-50 rounded p-2 max-h-40 overflow-auto border">{str}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

const MODULES = ["", "auth", "pos", "product", "recipe", "stock", "transfer", "return", "damage", "opname", "role", "permission"];
const ACTIONS = ["", "login", "logout", "create", "update", "delete", "confirm", "cancel", "pay", "adjust", "transfer", "opname"];

export default function AuditLogPage() {
  const today = new Date().toISOString().split("T")[0]!;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [mod, setMod] = useState("");
  const [action, setAction] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [refId, setRefId] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const params = new URLSearchParams({
    from, to, limit: String(limit), offset: String(page * limit),
    ...(mod ? { module: mod } : {}),
    ...(action ? { action } : {}),
    ...(userEmail ? { userId: userEmail } : {}),
    ...(refId ? { referenceId: refId } : {}),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit-logs", from, to, mod, action, userEmail, refId, page],
    queryFn: () => apiFetch(`${BASE}/audit-logs?${params}`),
  });

  const { data: stats } = useQuery({
    queryKey: ["audit-stats", from, to],
    queryFn: () => apiFetch(`${BASE}/audit-logs/stats?from=${from}&to=${to}`),
  });

  function exportCsv() {
    const rows = data?.rows ?? [];
    if (!rows.length) return;
    const cols = ["id", "created_at", "module", "action", "user_email", "branch_name", "reference_id", "ip_address"];
    const header = cols.join(",");
    const body = rows.map((r: Record<string, unknown>) =>
      cols.map((c) => JSON.stringify(r[c] ?? "")).join(",")
    ).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `audit-log-${from}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const rows: Record<string, unknown>[] = data?.rows ?? [];
  const total: number = data?.total ?? 0;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Shield className="text-red-600" size={22} />
        <Link href="/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

        <h1 className="text-xl font-bold">Audit Log Keamanan</h1>
        <span className="text-sm text-gray-500 ml-2">Semua aktivitas penting tercatat</span>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3"><div className="text-2xl font-bold text-blue-600">{stats.total}</div><div className="text-xs text-gray-500">Total Aktivitas</div></Card>
          {(stats.byModule as { module: string; total: number }[])?.slice(0, 3).map((m) => (
            <Card key={m.module} className="p-3">
              <div className="text-2xl font-bold">{m.total}</div>
              <div className="text-xs text-gray-500">{MODULE_LABELS[m.module] ?? m.module}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Filter */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Filter</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div><Label className="text-xs">Dari</Label><DatePicker value={from} onChange={(v) => { setFrom(v); setPage(0); }} className="h-8 text-sm" /></div>
            <div><Label className="text-xs">Sampai</Label><DatePicker value={to} onChange={(v) => { setTo(v); setPage(0); }} className="h-8 text-sm" /></div>
            <div><Label className="text-xs">Modul</Label>
              <Select value={mod} onValueChange={(v) => { setMod(v === "_all" ? "" : v); setPage(0); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua modul" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Semua modul</SelectItem>
                  {MODULES.filter(Boolean).map((m) => <SelectItem key={m} value={m}>{MODULE_LABELS[m] ?? m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Aksi</Label>
              <Select value={action} onValueChange={(v) => { setAction(v === "_all" ? "" : v); setPage(0); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua aksi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Semua aksi</SelectItem>
                  {ACTIONS.filter(Boolean).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Email User</Label><Input value={userEmail} onChange={(e) => { setUserEmail(e.target.value); setPage(0); }} placeholder="user@..." className="h-8 text-sm" /></div>
            <div><Label className="text-xs">Ref. ID</Label><Input value={refId} onChange={(e) => { setRefId(e.target.value); setPage(0); }} placeholder="Nomor dok..." className="h-8 text-sm" /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => refetch()} className="gap-1"><Search size={14} /> Cari</Button>
            <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1"><Download size={14} /> Export CSV</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && <div className="p-8 text-center text-gray-400 text-sm">Memuat...</div>}
          {error && <div className="p-8 text-center text-red-500 text-sm">{String(error)}</div>}
          {!isLoading && !error && (
            <>
              <div className="px-4 py-2 border-b text-xs text-gray-500">
                {total} entri ditemukan · halaman {page + 1}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Waktu</TableHead>
                      <TableHead>Modul</TableHead>
                      <TableHead>Aksi</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Cabang</TableHead>
                      <TableHead>Ref. ID</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-gray-400 text-sm py-8">Tidak ada data</TableCell></TableRow>
                    )}
                    {rows.map((row) => (
                      <TableRow key={String(row.id)} className="text-xs align-top">
                        <TableCell className="whitespace-nowrap">
                          {row.created_at ? new Date(row.created_at as string).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—"}
                        </TableCell>
                        <TableCell><ModuleBadge module={String(row.module ?? "")} /></TableCell>
                        <TableCell><ActionBadge action={String(row.action ?? "")} /></TableCell>
                        <TableCell className="max-w-[160px] truncate">{String(row.user_email ?? row.user_id ?? "—")}</TableCell>
                        <TableCell>{String(row.branch_name ?? "—")}</TableCell>
                        <TableCell className="font-mono">{String(row.reference_id ?? "—")}</TableCell>
                        <TableCell className="min-w-[200px]">
                          <DataCell label="Before" data={row.old_data} />
                          <DataCell label="After" data={row.new_data} />
                        </TableCell>
                        <TableCell className="text-gray-400">{String(row.ip_address ?? "—")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="p-3 flex gap-2 justify-end border-t">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next →</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
