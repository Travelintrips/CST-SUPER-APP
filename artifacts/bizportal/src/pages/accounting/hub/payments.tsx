import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ChevronLeft, ChevronRight, Ban, ArrowLeft, AlertTriangle, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PaymentRow {
  id: number; company_id: number; branch_id: number | null; source_module: string | null;
  payment_number: string | null; payment_type: string; status: string;
  amount: string; date: string; ref: string | null; memo: string | null;
  partner_name: string | null; journal_name: string; journal_type: string;
  source_type: string | null; posted_at: string | null; voided_at: string | null;
  source_posting_status: string | null; source_posting_error: string | null; source_reference: string | null;
}

const fmt = (v: string | number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));

const MODULES = ["","manual","sales","purchase","tenant","sport_center","pos","logistics","expense","hrd"];
const isPostingError = (status: string | null | undefined) => status === "error" || status === "failed";

export default function AccountingHubPaymentsPage() {
  const [rows, setRows]       = useState<PaymentRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [page, setPage]       = useState(1);
  const [filters, setFilters] = useState({ company_id: "", source_module: "" });
  const [voidDialog, setVoidDialog] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);
  const limit = 50;

  const load = async (p = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await fetch(`/api/accounting/hub/payments?${params}`, { credentials: "include" });
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
  };

  useEffect(() => { load(1); setPage(1); }, []);

  const handleVoid = async () => {
    if (!voidDialog.id || !voidReason.trim()) return;
    setVoidLoading(true);
    try {
      await fetch(`/api/accounting/void-payment/${voidDialog.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: voidReason }),
      });
      setVoidDialog({ open: false, id: null });
      setVoidReason("");
      load(page);
    } finally {
      setVoidLoading(false);
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
            <h1 className="text-xl font-bold">Jurnal Pembayaran</h1>
            <p className="text-xs text-muted-foreground">{total.toLocaleString("id-ID")} pembayaran</p>
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
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Company ID" value={filters.company_id} onChange={e => setFilters(f => ({...f, company_id: e.target.value}))} className="w-32" />
            <Select value={filters.source_module || "__all"} onValueChange={v => setFilters(f => ({...f, source_module: v === "__all" ? "" : v}))}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Modul" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Semua Modul</SelectItem>
                {MODULES.filter(Boolean).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => { setPage(1); load(1); }}>Terapkan</Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Tanggal</th>
              <th className="px-3 py-2 text-left">No. Pembayaran</th>
              <th className="px-3 py-2 text-left">Modul</th>
              <th className="px-3 py-2 text-left">Tipe</th>
              <th className="px-3 py-2 text-left">Jurnal</th>
              <th className="px-3 py-2 text-left">Mitra</th>
              <th className="px-3 py-2 text-right">Jumlah</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Referensi / Error</th>
              <th className="px-3 py-2 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">{loading ? "Memuat..." : "Tidak ada data"}</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-t hover:bg-muted/40">
                <td className="px-3 py-2 whitespace-nowrap text-xs">{r.date}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.payment_number ?? `#${r.id}`}</td>
                <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{r.source_module ?? r.source_type ?? "—"}</Badge></td>
                <td className="px-3 py-2">
                  <Badge className={`text-xs ${r.payment_type === "inbound" ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`} variant="outline">
                    {r.payment_type === "inbound" ? "Masuk" : "Keluar"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs">{r.journal_name}</td>
                <td className="px-3 py-2 text-xs">{r.partner_name ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{fmt(r.amount)}</td>
                <td className="px-3 py-2">
                  <Badge
                    variant={isPostingError(r.source_posting_status) || r.status === "voided" ? "destructive" : "default"}
                    className="text-xs"
                  >
                    {isPostingError(r.source_posting_status) ? "Error / Perlu perhatian" : r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 max-w-xs text-xs">
                  <div className="font-mono text-muted-foreground">{r.source_reference ?? r.ref ?? "—"}</div>
                  {isPostingError(r.source_posting_status) && (
                    <div className="mt-1 flex items-start gap-1 text-red-700" title={r.source_posting_error ?? undefined}>
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{r.source_posting_error ?? "Posting jurnal gagal"}</span>
                    </div>
                  )}
                  {isPostingError(r.source_posting_status) && (
                    <Link href="/accounting/posting-monitor" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" />Buka monitor posting
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.status !== "voided" && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-600"
                      onClick={() => { setVoidDialog({ open: true, id: r.id }); setVoidReason(""); }}>
                      <Ban className="h-3 w-3 mr-1" />Void
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

      <Dialog open={voidDialog.open} onOpenChange={o => setVoidDialog(d => ({...d, open: o}))}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void Pembayaran #{voidDialog.id}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Alasan void</Label>
            <Textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Masukkan alasan pembatalan..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialog({ open: false, id: null })}>Batal</Button>
            <Button variant="destructive" onClick={handleVoid} disabled={!voidReason.trim() || voidLoading}>
              {voidLoading ? "Proses..." : "Void Pembayaran"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
