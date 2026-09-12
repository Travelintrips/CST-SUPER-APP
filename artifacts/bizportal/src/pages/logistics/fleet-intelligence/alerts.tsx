import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, BellOff, CheckCheck, AlertTriangle, Info, AlertCircle, XCircle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

function severityIcon(s: string) {
  if (s === "critical") return <XCircle className="w-4 h-4 text-red-400" />;
  if (s === "warning") return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  if (s === "error") return <AlertCircle className="w-4 h-4 text-red-400" />;
  return <Info className="w-4 h-4 text-blue-400" />;
}

function severityBadge(s: string) {
  if (s === "critical") return "bg-red-500/20 text-red-300 border-red-600";
  if (s === "warning") return "bg-amber-500/20 text-amber-300 border-amber-600";
  if (s === "error") return "bg-red-400/20 text-red-300 border-red-500";
  return "bg-blue-500/20 text-blue-300 border-blue-600";
}

function fmtDate(v: unknown) {
  if (!v) return "-";
  return new Date(String(v)).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

export default function FleetAlertsPage() {
  const qc = useQueryClient();
  const [isRead, setIsRead] = useState("false");
  const [severity, setSeverity] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-alerts", isRead, severity, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (isRead !== "all") params.set("isRead", isRead);
      if (severity !== "all") params.set("severity", severity);
      const res = await fetch(`/api/logistics/fleet/alerts?${params}`, { credentials: "include" });
      return res.json() as Promise<{
        alerts: Array<Record<string, unknown>>;
        unreadCount: number;
      }>;
    },
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/logistics/fleet/alerts/${id}/read`, { method: "PUT", credentials: "include" });
      if (!res.ok) throw new Error("Gagal mark alert");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet-alerts"] }),
  });

  const markAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/alerts/read-all", { method: "PUT", credentials: "include" });
      if (!res.ok) throw new Error("Gagal mark all");
    },
    onSuccess: () => {
      toast.success("Semua alert ditandai sudah dibaca");
      qc.invalidateQueries({ queryKey: ["fleet-alerts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alerts = data?.alerts ?? [];
  const unread = data?.unreadCount ?? 0;

  const alertTypeMap: Record<string, string> = {
    outstanding_high: "Outstanding Tinggi",
    driver_inactive: "Driver Tidak Aktif",
    revenue_drop: "Revenue Turun",
    upload_error: "Error Upload",
    churn_risk: "Risiko Churn",
    idle_vehicle: "Kendaraan Idle",
    high_outstanding: "Outstanding Tinggi",
    ingestion_failure: "Gagal Ingest Data",
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Alerts & Notifikasi
              {unread > 0 && (
                <span className="text-sm font-normal px-2 py-0.5 bg-red-500 text-white rounded-full">{unread} belum dibaca</span>
              )}
            </h1>
            <p className="text-slate-400 text-sm mt-1">Notifikasi otomatis dari sistem monitoring fleet</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={isRead} onValueChange={(v) => { setIsRead(v); setPage(1); }}>
              <SelectTrigger className="w-40 bg-slate-700 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Belum Dibaca</SelectItem>
                <SelectItem value="true">Sudah Dibaca</SelectItem>
                <SelectItem value="all">Semua</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(1); }}>
              <SelectTrigger className="w-36 bg-slate-700 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            {unread > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-slate-600"
                disabled={markAllMutation.isPending}
                onClick={() => markAllMutation.mutate()}
              >
                <CheckCheck className="w-4 h-4" /> Tandai Semua
              </Button>
            )}
          </div>
        </div>

        {/* Alert List */}
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-slate-800/60 rounded-xl border border-slate-700 animate-pulse" />
            ))
          ) : alerts.length === 0 ? (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="py-16 text-center">
                <Bell className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400">Tidak ada alert</p>
                <p className="text-slate-600 text-sm mt-1">Sistem akan mengirim notifikasi otomatis saat ditemukan anomali</p>
              </CardContent>
            </Card>
          ) : (
            alerts.map((a) => (
              <div
                key={String(a.id)}
                className={`p-4 rounded-xl border transition-all ${
                  !a.is_read
                    ? "bg-slate-800 border-slate-600 shadow-lg"
                    : "bg-slate-800/40 border-slate-700/50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0">{severityIcon(String(a.severity))}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold ${!a.is_read ? "text-white" : "text-slate-300"}`}>
                        {String(a.title)}
                      </span>
                      <Badge className={`text-xs border ${severityBadge(String(a.severity))}`}>
                        {String(a.severity)}
                      </Badge>
                      <Badge className="text-xs bg-slate-700 text-slate-400 border border-slate-600">
                        {alertTypeMap[String(a.alert_type)] ?? String(a.alert_type)}
                      </Badge>
                      {!!a.is_notified && (
                        <Badge className="text-xs bg-purple-500/20 text-purple-300 border border-purple-600">
                          WA Terkirim
                        </Badge>
                      )}
                    </div>
                    <p className="text-slate-400 text-sm mt-1 leading-relaxed whitespace-pre-line">
                      {String(a.message)}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span>{fmtDate(a.created_at)}</span>
                      {!!a.driver_name && <span>Driver: {String(a.driver_name)}</span>}
                      {!!a.notified_at && <span>Notified: {fmtDate(a.notified_at)}</span>}
                    </div>
                  </div>
                  {!a.is_read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-slate-400 hover:text-white flex-shrink-0"
                      onClick={() => markReadMutation.mutate(Number(a.id))}
                    >
                      <BellOff className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center">
          <span className="text-slate-500 text-sm">{alerts.length} alert ditampilkan</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" disabled={alerts.length < 50} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>

        {/* Info Card */}
        <Card className="bg-slate-800/40 border-slate-700/50">
          <CardContent className="p-4">
            <h3 className="text-white font-medium mb-2 text-sm">Jenis Alert Otomatis</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              {[
                { icon: <AlertTriangle className="w-4 h-4 text-amber-400" />, title: "Outstanding Tinggi", desc: "Driver dengan saldo hutang ≥ Rp 500.000 — notifikasi WA ke admin + driver" },
                { icon: <BellOff className="w-4 h-4 text-blue-400" />, title: "Driver Tidak Aktif", desc: "Driver tidak ada aktivitas selama ≥7 hari — notifikasi ke admin" },
                { icon: <XCircle className="w-4 h-4 text-red-400" />, title: "Revenue Turun >15%", desc: "Pendapatan fleet turun >15% dibanding minggu sebelumnya — notifikasi critical" },
              ].map((item) => (
                <div key={item.title} className="flex gap-2 p-3 bg-slate-900/40 rounded-lg">
                  <div className="mt-0.5">{item.icon}</div>
                  <div>
                    <p className="text-white font-medium text-xs">{item.title}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
