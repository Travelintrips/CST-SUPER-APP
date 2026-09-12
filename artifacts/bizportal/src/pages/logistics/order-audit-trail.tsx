import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ArrowLeft, Clock, User, Activity, Shield, MessageSquare,
  CheckCircle2, XCircle, AlertTriangle, Truck, Package,
  Send, RefreshCw, ChevronRight, FileText, Info,
} from "lucide-react";

const API = "/api";

const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }) : "—";

type AuditEntry = Record<string, unknown>;

function actorBadge(type: string) {
  const map: Record<string, string> = {
    admin: "bg-blue-100 text-blue-700",
    vendor: "bg-orange-100 text-orange-700",
    customer: "bg-green-100 text-green-700",
    driver: "bg-purple-100 text-purple-700",
    system: "bg-slate-100 text-slate-600",
  };
  return map[type] ?? "bg-slate-100 text-slate-600";
}

function eventIcon(action: string, eventType?: string) {
  const key = (action || eventType || "").toLowerCase();
  if (key.includes("creat") || key.includes("order_created")) return <Package className="w-3.5 h-3.5 text-blue-500" />;
  if (key.includes("approv") || key.includes("confirm") || key.includes("select")) return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
  if (key.includes("reject") || key.includes("cancel")) return <XCircle className="w-3.5 h-3.5 text-red-500" />;
  if (key.includes("revisi") || key.includes("revision")) return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />;
  if (key.includes("blast") || key.includes("rfq")) return <Send className="w-3.5 h-3.5 text-teal-500" />;
  if (key.includes("vendor")) return <Truck className="w-3.5 h-3.5 text-orange-500" />;
  if (key.includes("status")) return <Activity className="w-3.5 h-3.5 text-violet-500" />;
  if (key.includes("quot")) return <FileText className="w-3.5 h-3.5 text-indigo-500" />;
  return <Clock className="w-3.5 h-3.5 text-slate-400" />;
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    status_history: "Status",
    activity_logs: "Aktivitas",
    vendor_quotes: "Vendor Quote",
    customer_approvals: "Approval Customer",
  };
  return map[source] ?? source;
}

function sourceBadgeColor(source: string): string {
  const map: Record<string, string> = {
    status_history: "bg-violet-100 text-violet-700",
    activity_logs: "bg-blue-100 text-blue-700",
    vendor_quotes: "bg-orange-100 text-orange-700",
    customer_approvals: "bg-green-100 text-green-700",
  };
  return map[source] ?? "bg-slate-100 text-slate-600";
}

function TimelineEntry({ entry, index }: { entry: AuditEntry; index: number }) {
  const source: string = String(entry["_source"] ?? "");
  const action: string = String(entry["action"] ?? entry["event_type"] ?? entry["new_status"] ?? "");
  const description: string = String(entry["description"] ?? entry["notes"] ?? "");
  const actorType: string = String(entry["actor_type"] ?? entry["changed_by_type"] ?? "system");
  const actorName: string = String(entry["actor_name"] ?? entry["changed_by_name"] ?? entry["customer_name"] ?? entry["vendor_name"] ?? "");
  const oldStatus: string | null = entry["old_status"] != null ? String(entry["old_status"]) : null;
  const newStatus: string | null = entry["new_status"] != null ? String(entry["new_status"]) : null;
  const createdAt: string = String(entry["created_at"] ?? "");

  return (
    <div className="relative flex gap-3 pb-4">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10 ${
          source === "status_history" ? "bg-violet-100" :
          source === "activity_logs" ? "bg-blue-100" :
          source === "vendor_quotes" ? "bg-orange-100" :
          "bg-green-100"
        }`}>
          {eventIcon(action, entry["event_type"] as string)}
        </div>
        {/* vertical line — drawn after, won't show for last */}
        <div className="w-0.5 bg-slate-100 flex-1 mt-1" />
      </div>

      <div className="flex-1 min-w-0 pb-2">
        <div className="bg-white border border-slate-100 rounded-lg px-3 py-2 shadow-sm hover:border-slate-200 transition-colors">
          {/* Header row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${sourceBadgeColor(source)}`}>
              {sourceLabel(source)}
            </span>
            {action && (
              <span className="text-xs font-semibold text-slate-700 truncate">{action}</span>
            )}
            <span className="ml-auto text-[10px] text-slate-400 whitespace-nowrap">{dt(createdAt)}</span>
          </div>

          {/* Status transition */}
          {(oldStatus || newStatus) && (
            <div className="flex items-center gap-1.5 text-xs mb-1 flex-wrap">
              {oldStatus && (
                <span className="text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{oldStatus}</span>
              )}
              {oldStatus && newStatus && <ChevronRight className="w-3 h-3 text-slate-300" />}
              {newStatus && (
                <span className="text-slate-800 bg-emerald-100 px-1.5 py-0.5 rounded text-[11px] font-medium">{newStatus}</span>
              )}
            </div>
          )}

          {description ? <p className="text-xs text-slate-600 leading-relaxed">{description}</p> : null}

          {/* Vendor price info */}
          {(entry["old_price"] != null || entry["new_price"] != null) && (
            <div className="flex items-center gap-2 mt-1 text-[11px]">
              {entry["old_price"] != null && (
                <span className="text-slate-400 line-through">
                  Rp {Math.round(Number(entry["old_price"])).toLocaleString("id-ID")}
                </span>
              )}
              {entry["new_price"] != null && (
                <span className="text-emerald-700 font-semibold">
                  Rp {Math.round(Number(entry["new_price"])).toLocaleString("id-ID")}
                </span>
              )}
            </div>
          )}

          {/* Revision/rejection notes */}
          {!!entry["revision_notes"] && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">
              Revisi: {entry["revision_notes"] as string}
            </p>
          )}
          {!!entry["rejection_reason"] && (
            <p className="text-xs text-red-700 bg-red-50 rounded px-2 py-1 mt-1">
              Alasan: {entry["rejection_reason"] as string}
            </p>
          )}

          {/* Actor */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${actorBadge(actorType)}`}>
              {actorType}
            </span>
            {actorName && (
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <User className="w-3 h-3" /> {actorName}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  title, count, icon, children,
}: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="secondary" className="ml-auto text-xs">{count}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="text-sm text-slate-400 text-center py-4">{label}</p>
  );
}

export default function OrderAuditTrailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const id = Number(orderId);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    orderNumber: string;
    statusHistory: AuditEntry[];
    activityLogs: AuditEntry[];
    vendorQuotes: AuditEntry[];
    customerApprovals: AuditEntry[];
    timeline: AuditEntry[];
  }>({
    queryKey: ["order-audit-trail", id],
    queryFn: async () => {
      const r = await fetch(`${API}/logistic/orders/${id}/audit-trail`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat audit trail");
      return r.json();
    },
    enabled: !isNaN(id),
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <p className="text-red-500">Gagal memuat audit trail. Pastikan Anda sudah login.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href={`/logistics/orders/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Shield className="w-5 h-5 text-violet-500" />
              Audit Trail
            </h1>
            <p className="text-sm text-slate-500">Order: <span className="font-mono font-semibold">{data.orderNumber}</span></p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1.5 text-violet-700 border-violet-200 bg-violet-50">
            <Activity className="w-3 h-3" /> {data.statusHistory.length} Status Change
          </Badge>
          <Badge variant="outline" className="gap-1.5 text-blue-700 border-blue-200 bg-blue-50">
            <Clock className="w-3 h-3" /> {data.activityLogs.length} Activity
          </Badge>
          <Badge variant="outline" className="gap-1.5 text-orange-700 border-orange-200 bg-orange-50">
            <Truck className="w-3 h-3" /> {data.vendorQuotes.length} Vendor Event
          </Badge>
          <Badge variant="outline" className="gap-1.5 text-green-700 border-green-200 bg-green-50">
            <CheckCircle2 className="w-3 h-3" /> {data.customerApprovals.length} Customer Event
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: unified timeline */}
          <div className="lg:col-span-2 space-y-1">
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  Timeline Lengkap
                  <Badge variant="secondary" className="ml-auto">{data.timeline.length} event</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 max-h-[700px] overflow-y-auto">
                {data.timeline.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">
                    Belum ada aktivitas tercatat untuk order ini.
                    <br />
                    <span className="text-xs">Event baru akan muncul setelah ada perubahan status.</span>
                  </p>
                ) : (
                  <div className="pt-2">
                    {data.timeline.map((entry, i) => (
                      <TimelineEntry key={`${entry["_source"]}-${entry["id"]}`} entry={entry} index={i} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: per-category summaries */}
          <div className="space-y-4">
            <SectionCard
              title="Status History"
              count={data.statusHistory.length}
              icon={<Activity className="w-4 h-4 text-violet-500" />}
            >
              {data.statusHistory.length === 0 ? (
                <EmptyState label="Belum ada riwayat status" />
              ) : (
                <div className="space-y-2">
                  {data.statusHistory.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          {!!e["old_status"] && (
                            <span className="text-slate-400 truncate">{e["old_status"] as string}</span>
                          )}
                          {!!e["old_status"] && <ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />}
                          <span className="font-medium text-slate-700 truncate">{e["new_status"] as string}</span>
                        </div>
                        <span className="text-slate-400 text-[10px]">
                          {e["changed_by_name"] as string || e["changed_by_type"] as string} · {dt(e["created_at"] as string)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Vendor Quote Events"
              count={data.vendorQuotes.length}
              icon={<Truck className="w-4 h-4 text-orange-500" />}
            >
              {data.vendorQuotes.length === 0 ? (
                <EmptyState label="Belum ada event vendor" />
              ) : (
                <div className="space-y-2">
                  {data.vendorQuotes.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400 mt-1 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-medium text-slate-700">{e["event_type"] as string}</span>
                          {!!e["vendor_name"] && (
                            <span className="text-orange-600 text-[10px]">· {e["vendor_name"] as string}</span>
                          )}
                        </div>
                        {e["new_price"] != null && (
                          <span className="text-emerald-600">
                            Rp {Math.round(Number(e["new_price"])).toLocaleString("id-ID")}
                          </span>
                        )}
                        <span className="block text-slate-400 text-[10px]">{dt(e["created_at"] as string)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Customer Approval Events"
              count={data.customerApprovals.length}
              icon={<MessageSquare className="w-4 h-4 text-green-500" />}
            >
              {data.customerApprovals.length === 0 ? (
                <EmptyState label="Belum ada event customer" />
              ) : (
                <div className="space-y-2">
                  {data.customerApprovals.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${
                        (e["event_type"] as string)?.includes("approved") ? "bg-green-400" :
                        (e["event_type"] as string)?.includes("reject") ? "bg-red-400" :
                        (e["event_type"] as string)?.includes("revision") ? "bg-yellow-400" :
                        "bg-slate-300"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-slate-700">{e["event_type"] as string}</span>
                        {!!e["customer_name"] && (
                          <span className="block text-slate-500 text-[10px]">{e["customer_name"] as string}</span>
                        )}
                        <span className="block text-slate-400 text-[10px]">{dt(e["created_at"] as string)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Info box */}
            <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-50 rounded-lg p-3 border border-slate-100">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <p>
                Audit trail mencatat setiap perubahan status, aktivitas vendor, dan respons customer secara otomatis.
                Data disimpan di 4 tabel terpisah: <code className="font-mono text-[10px] bg-slate-200 px-1 rounded">order_status_history</code>,{" "}
                <code className="font-mono text-[10px] bg-slate-200 px-1 rounded">order_audit_logs</code>,{" "}
                <code className="font-mono text-[10px] bg-slate-200 px-1 rounded">vendor_quote_history</code>,{" "}
                <code className="font-mono text-[10px] bg-slate-200 px-1 rounded">customer_approval_history</code>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
