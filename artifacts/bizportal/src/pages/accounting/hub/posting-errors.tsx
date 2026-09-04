import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, CheckCircle, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface ErrorRow {
  id: number; company_id: number | null; branch_id: number | null;
  source_module: string; source_table: string | null; source_id: number | null;
  source_ref: string | null; error_code: string; error_message: string;
  payload: unknown; resolved_at: string | null; resolved_by: string | null;
  resolve_note: string | null; created_at: string;
}

const MODULES = ["","manual","sales","purchase","tenant","sport_center","pos","logistics","expense","hrd"];
const ERROR_COLORS: Record<string, string> = {
  BALANCE_VIOLATION:       "bg-red-100 text-red-700",
  MISSING_COMPANY_ID:      "bg-orange-100 text-orange-700",
  NO_JOURNAL_FOUND:        "bg-yellow-100 text-yellow-700",
  COA_MAPPING_NOT_FOUND:   "bg-purple-100 text-purple-700",
  DB_ERROR:                "bg-rose-100 text-rose-700",
};

export default function AccountingHubPostingErrorsPage() {
  const [rows, setRows]           = useState<ErrorRow[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [page, setPage]           = useState(1);
  const [onlyUnresolved, setOnlyUnresolved] = useState(true);
  const [appliedOnlyUnresolved, setAppliedOnlyUnresolved] = useState(true);
  const [filters, setFilters]     = useState({ company_id: "", source_module: "" });
  const [appliedFilters, setAppliedFilters] = useState({ company_id: "", source_module: "" });
  const [resolveDialog, setResolveDialog] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [resolveNote, setResolveNote] = useState("");
  const [resolveLoading, setResolveLoading] = useState(false);
  const limit = 50;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit), unresolved: String(appliedOnlyUnresolved) });
      Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await fetch(`/api/accounting/hub/posting-errors?${params}`, { credentials: "include" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(`Gagal memuat data: ${res.status}${msg ? ` — ${msg}` : ""}`);
        return;
      }
      const json = await res.json();
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (e: any) {
      setError(e.message ?? "Terjadi kesalahan saat memuat data");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, appliedOnlyUnresolved]);

  useEffect(() => { void load(1); setPage(1); }, [load]);

  const handleResolve = async () => {
    if (!resolveDialog.id) return;
    setResolveLoading(true);
    try {
      await fetch(`/api/accounting/hub/posting-errors/${resolveDialog.id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resolve_note: resolveNote }),
      });
      setResolveDialog({ open: false, id: null });
      setResolveNote("");
      load(page);
    } finally {
      setResolveLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/accounting/hub">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Error Posting</h1>
            <p className="text-xs text-muted-foreground">{total.toLocaleString("id-ID")} error</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(page)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-md px-4 py-3 text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="Company ID" value={filters.company_id} onChange={e => setFilters(f => ({...f, company_id: e.target.value}))} className="w-32" />
            <Select value={filters.source_module || "__all"} onValueChange={v => setFilters(f => ({...f, source_module: v === "__all" ? "" : v}))}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Modul" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Semua Modul</SelectItem>
                {MODULES.filter(Boolean).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 ml-2">
              <Switch checked={onlyUnresolved} onCheckedChange={setOnlyUnresolved} />
              <span className="text-sm">Hanya belum diselesaikan</span>
            </div>
            <Button size="sm" onClick={() => {
              setPage(1);
              setAppliedFilters({ ...filters });
              setAppliedOnlyUnresolved(onlyUnresolved);
            }}>Terapkan</Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Waktu</th>
              <th className="px-3 py-2 text-left">Error</th>
              <th className="px-3 py-2 text-left">Modul</th>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Pesan</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
                {loading ? "Memuat..." : onlyUnresolved ? "🎉 Tidak ada error posting yang belum diselesaikan" : "Tidak ada data"}
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-t hover:bg-muted/40">
                <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString("id-ID")}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ERROR_COLORS[r.error_code] ?? "bg-gray-100 text-gray-700"}`}>{r.error_code}</span>
                </td>
                <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{r.source_module}</Badge></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.source_table && <span>{r.source_table}</span>}
                  {r.source_id && <span className="ml-1">#{r.source_id}</span>}
                  {r.source_ref && <span className="ml-1 font-mono">{r.source_ref}</span>}
                </td>
                <td className="px-3 py-2 text-xs max-w-[280px] truncate" title={r.error_message}>{r.error_message}</td>
                <td className="px-3 py-2">
                  {r.resolved_at ? (
                    <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                      <CheckCircle className="h-3 w-3 mr-1" />Selesai
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs">Belum</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  {!r.resolved_at && (
                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs text-green-700 border-green-300"
                      onClick={() => { setResolveDialog({ open: true, id: r.id }); setResolveNote(""); }}>
                      Selesaikan
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Halaman {page} · {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} dari {total}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={page * limit >= total} onClick={() => { setPage(p => p + 1); load(page + 1); }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={resolveDialog.open} onOpenChange={o => setResolveDialog(d => ({...d, open: o}))}>
        <DialogContent>
          <DialogHeader><DialogTitle>Selesaikan Error #{resolveDialog.id}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Catatan penyelesaian</Label>
            <Textarea value={resolveNote} onChange={e => setResolveNote(e.target.value)} placeholder="Jelaskan bagaimana error ini diselesaikan..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialog({ open: false, id: null })}>Batal</Button>
            <Button onClick={handleResolve} disabled={resolveLoading}>
              <CheckCircle className="h-4 w-4 mr-2" />
              {resolveLoading ? "Proses..." : "Tandai Selesai"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
