import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Inbox, Loader2, MessageCircle, RefreshCw, X } from "lucide-react";
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
  customer_phone?: string | null;
  created_at: string;
  is_pending: boolean;
  status_known: boolean;
  management_path: string;
  available_actions?: string[];
};

type Payload = {
  data: WorkloadRow[];
  total: number;
  summary: Summary[];
};

type Detail = {
  service: string;
  id: number;
  record: Record<string, unknown>;
  projection?: {
    finance?: {
      source: string | null;
      invoice: { number: string | null; paymentStatus: string; total: number; amountPaid: number; outstanding: number; dueDate: string | null } | null;
      payment: { status: string; fulfillmentGate: string } | null;
      paymentProof: { status: string; remarks: string | null; fileUrl: string | null } | null;
    };
    timeline?: { source: string; currentStatus: string | null; events: Array<Record<string, unknown>> };
  };
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
  const [actionBusy, setActionBusy] = useState("");
  const [selected, setSelected] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  async function runAction(row: WorkloadRow, action: "approve" | "request_revision" | "reject" | "contact") {
    if (actionBusy) return;
    let reason = "";
    if (action === "reject" || action === "request_revision") {
      reason = window.prompt(action === "reject" ? "Alasan penolakan" : "Data yang perlu direvisi")?.trim() ?? "";
      if (!reason) return;
    } else if (action === "approve" && !window.confirm("Setujui transaksi ini dan lanjutkan lifecycle canonical?")) {
      return;
    }
    setActionBusy(`${row.service_key}-${row.id}`);
    setError("");
    try {
      const response = await fetch(`/api/portal/admin/service-operations/${row.service_key}/${row.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Action gagal dijalankan");
      if (action === "contact" && body.contactUrl) {
        window.open(body.contactUrl, "_blank", "noopener,noreferrer");
      } else {
        await load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action gagal dijalankan");
    } finally {
      setActionBusy("");
    }
  }

  async function openDetail(row: WorkloadRow) {
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/portal/admin/service-operations/${row.service_key}/${row.id}`, {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Gagal memuat detail canonical");
      setSelected(body as Detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat detail canonical");
    } finally {
      setDetailLoading(false);
    }
  }

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
                <button type="button" key={`${row.service_key}-${row.id}`} onClick={() => void openDetail(row)} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.service_label} · <span className="font-mono text-xs">{row.reference}</span></p>
                    <p className="truncate text-xs text-muted-foreground">{row.customer_name}{row.customer_company ? ` · ${row.customer_company}` : ""}{row.customer_phone ? ` · ${row.customer_phone}` : ""} · {formatDate(row.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!row.status_known && <Badge variant="outline" className="text-slate-500">Mapping perlu review</Badge>}
                    <Badge variant="outline" className={statusClass(row.status)}>{formatStatus(row.status)}</Badge>
                  </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                      <a href={row.management_path}>Buka BizPortal</a>
                    </Button>
                    {row.available_actions?.includes("approve") && (
                      <Button size="sm" className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700" disabled={!!actionBusy} onClick={() => void runAction(row, "approve")}>
                        <Check className="mr-1 h-3.5 w-3.5" /> Setujui
                      </Button>
                    )}
                    {row.available_actions?.includes("request_revision") && (
                      <Button variant="outline" size="sm" className="h-7 border-amber-300 bg-amber-50 text-xs text-amber-800" disabled={!!actionBusy} onClick={() => void runAction(row, "request_revision")}>
                        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Minta Revisi
                      </Button>
                    )}
                    {row.available_actions?.includes("reject") && (
                      <Button variant="outline" size="sm" className="h-7 border-rose-200 bg-rose-50 text-xs text-rose-700" disabled={!!actionBusy} onClick={() => void runAction(row, "reject")}>
                        <X className="mr-1 h-3.5 w-3.5" /> Tolak
                      </Button>
                    )}
                    {row.available_actions?.includes("contact") && (
                      <Button variant="outline" size="sm" className="h-7 border-indigo-200 bg-indigo-50 text-xs text-indigo-700" disabled={!!actionBusy} onClick={() => void runAction(row, "contact")}>
                        <MessageCircle className="mr-1 h-3.5 w-3.5" /> Hubungi
                      </Button>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Detail canonical Customer Portal">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-background p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">{selected.service}</p>
                <h3 className="mt-1 text-lg font-bold">Detail transaksi #{selected.id}</h3>
                <p className="text-xs text-muted-foreground">Projection read-only dari sumber canonical.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)} aria-label="Tutup detail"><X className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-5 pt-5">
              <div className="rounded-lg border bg-sky-50/50 p-4">
                <h4 className="mb-3 text-sm font-semibold">Invoice & Payment</h4>
                {selected.projection?.finance?.invoice ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div><p className="text-xs text-muted-foreground">Invoice</p><p className="font-medium">{selected.projection.finance.invoice.number ?? "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Total</p><p className="font-medium">Rp {selected.projection.finance.invoice.total.toLocaleString("id-ID")}</p></div>
                    <div><p className="text-xs text-muted-foreground">Dibayar</p><p className="font-medium">Rp {selected.projection.finance.invoice.amountPaid.toLocaleString("id-ID")}</p></div>
                    <div><p className="text-xs text-muted-foreground">Outstanding</p><p className="font-medium">Rp {selected.projection.finance.invoice.outstanding.toLocaleString("id-ID")}</p></div>
                    <div><p className="text-xs text-muted-foreground">Payment</p><p className="font-medium">{formatStatus(selected.projection.finance.invoice.paymentStatus)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Proof</p><p className="font-medium">{formatStatus(selected.projection.finance.paymentProof?.status ?? "not_uploaded")}</p></div>
                    <div><p className="text-xs text-muted-foreground">Gate</p><p className="font-medium">{formatStatus(selected.projection.finance.payment?.fulfillmentGate ?? "payment_required")}</p></div>
                    <div><p className="text-xs text-muted-foreground">Jatuh tempo</p><p className="font-medium">{selected.projection.finance.invoice.dueDate ? formatDate(selected.projection.finance.invoice.dueDate) : "—"}</p></div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Belum ada invoice canonical yang terhubung.</p>
                )}
                {selected.projection?.finance?.paymentProof?.remarks && <p className="mt-3 text-xs text-muted-foreground">Catatan proof: {selected.projection.finance.paymentProof.remarks}</p>}
                {selected.projection?.finance?.paymentProof?.fileUrl && <a className="mt-3 inline-flex text-xs font-semibold text-sky-700 hover:underline" href={selected.projection.finance.paymentProof.fileUrl} target="_blank" rel="noopener noreferrer">Buka bukti pembayaran</a>}
              </div>
              <div>
                <h4 className="mb-3 text-sm font-semibold">Timeline canonical</h4>
                {selected.projection?.timeline?.events?.length ? (
                  <div className="space-y-2">
                    {selected.projection.timeline.events.map((event, index) => (
                      <div key={`${String(event.id ?? index)}`} className="rounded-lg border p-3">
                        <p className="text-sm font-medium">{formatStatus(String(event.status ?? event.event_type ?? event.new_status ?? "event"))}</p>
                        <p className="text-xs text-muted-foreground">{String(event.notes ?? event.note ?? event.location ?? "")} {event.created_at ? `· ${formatDate(String(event.created_at))}` : ""}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Status canonical: {formatStatus(selected.projection?.timeline?.currentStatus ?? String(selected.record.status ?? "unknown"))}. Tidak ada event tambahan.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {detailLoading && <div className="fixed bottom-5 right-5 z-[60] rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"><Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />Memuat detail</div>}
    </div>
  );
}