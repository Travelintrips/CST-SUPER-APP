import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Summary = {
  service_key: string;
  service_label: string;
  total: number;
  pending: number;
  ambiguous?: number;
};

type WorkloadRow = {
  service_key: string;
  service_label: string;
  id: number;
  reference: string;
  status: string;
  customer_name: string;
  customer_company: string;
  created_at: string;
  is_pending: boolean;
  status_known: boolean;
  management_path: string;
};

type Payload = {
  data: WorkloadRow[];
  total: number;
  summary: Summary[];
};

const statusClass = (status: string) => {
  if (["completed", "closed", "paid", "delivered"].includes(status.toLowerCase())) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (["cancelled", "rejected", "quote_declined"].includes(status.toLowerCase())) {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  return "bg-amber-50 text-amber-700 border-amber-200";
};

const formatStatus = (status: string) =>
  status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function CustomerPortalWorkload() {
  const [payload, setPayload] = useState<Payload>({ data: [], total: 0, summary: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/portal/admin/service-operations?limit=50&offset=0", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Gagal memuat workload Customer Portal");
      setPayload({
        data: Array.isArray(body.data) ? body.data : [],
        total: Number(body.total ?? 0),
        summary: Array.isArray(body.summary) ? body.summary : [],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat workload Customer Portal");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const pending = payload.summary.reduce((sum, item) => sum + Number(item.pending ?? 0), 0);
  const ambiguous = payload.summary.reduce((sum, item) => sum + Number(item.ambiguous ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Customer Portal Workload</h2>
          <p className="text-sm text-muted-foreground">
            Satu antrean read-only dari semua sumber transaksi Customer Portal.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total workload</p><p className="mt-1 text-2xl font-bold">{payload.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pending canonical</p><p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Sumber aktif</p><p className="mt-1 text-2xl font-bold">{payload.summary.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status perlu mapping</p><p className="mt-1 text-2xl font-bold text-slate-500">{ambiguous}</p></CardContent></Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat workload...
        </div>
      ) : payload.data.length === 0 ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-8 w-8 text-slate-300" /> Tidak ada workload.
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Antrean terbaru</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {payload.data.map((row) => (
                <a key={`${row.service_key}-${row.id}`} href={row.management_path} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.service_label} · <span className="font-mono text-xs">{row.reference}</span></p>
                    <p className="truncate text-xs text-muted-foreground">{row.customer_name}{row.customer_company ? ` · ${row.customer_company}` : ""} · {formatDate(row.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!row.status_known && <Badge variant="outline" className="text-slate-500">Mapping perlu review</Badge>}
                    <Badge variant="outline" className={statusClass(row.status)}>{formatStatus(row.status)}</Badge>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}