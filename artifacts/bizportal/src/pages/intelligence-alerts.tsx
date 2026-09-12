import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, RefreshCw, Bell, Settings, Save } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";

interface IntelligenceAlert {
  id: number;
  alertType: string;
  entityType: string;
  entityId?: number;
  entityRef?: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  status: "open" | "acknowledged" | "resolved";
  isRead: boolean;
  acknowledgedBy?: string;
  resolvedBy?: string;
  triggeredAt: string;
  createdAt: string;
}

interface AlertsResponse {
  alerts: IntelligenceAlert[];
  total: number;
}

interface AlertSummary {
  total: number;
  open: { critical: number; warning: number; info: number };
  acknowledged: { critical: number; warning: number; info: number };
}

interface AlertSettings {
  id: number | null;
  masterEnabled: boolean;
  rfqAlertEnabled: boolean;
  rfqWarningHours: number;
  rfqCriticalHours: number;
  marginAlertEnabled: boolean;
  marginMinPct: string;
  etaAlertEnabled: boolean;
  quoteExpiredAlertEnabled: boolean;
  alertWindowStart: string;
  alertWindowEnd: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

const SEVERITY_CONFIG = {
  critical: { label: "Kritis", color: "destructive" as const, icon: ShieldAlert, bg: "bg-red-50 border-red-200" },
  warning:  { label: "Peringatan", color: "secondary" as const, icon: AlertTriangle, bg: "bg-yellow-50 border-yellow-200" },
  info:     { label: "Info", color: "outline" as const, icon: Bell, bg: "bg-blue-50 border-blue-200" },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  rfq_no_response:     "RFQ Tidak Ada Response",
  quote_expired:       "Quote Expired",
  order_eta_breach:    "ETA Terlewat",
  margin_below_minimum:"Margin Terlalu Kecil",
  missing_required_doc:"Dokumen Kurang",
  stage_stalled:       "Order Stuck",
  duplicate_order:     "Duplicate Order",
};

async function fetchAlerts(status: string): Promise<AlertsResponse> {
  const params = new URLSearchParams({ status, limit: "100" });
  const res = await fetch(`/api/intelligence-alerts?${params}`);
  if (!res.ok) throw new Error("Gagal memuat alerts");
  return res.json();
}

async function fetchSummary(): Promise<AlertSummary> {
  const res = await fetch("/api/intelligence-alerts/summary");
  if (!res.ok) throw new Error("Gagal memuat summary");
  return res.json();
}

async function fetchSettings(): Promise<AlertSettings> {
  const res = await fetch("/api/intelligence-alerts/settings");
  if (!res.ok) throw new Error("Gagal memuat pengaturan");
  return res.json();
}

async function saveSettings(data: Partial<AlertSettings>): Promise<void> {
  const res = await fetch("/api/intelligence-alerts/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Gagal menyimpan pengaturan");
}

async function acknowledgeAlert(id: number): Promise<void> {
  const res = await fetch(`/api/intelligence-alerts/${id}/acknowledge`, { method: "PUT" });
  if (!res.ok) throw new Error("Gagal acknowledge");
}

async function resolveAlert(id: number): Promise<void> {
  const res = await fetch(`/api/intelligence-alerts/${id}/resolve`, { method: "PUT" });
  if (!res.ok) throw new Error("Gagal resolve");
}

async function bulkAcknowledge(ids: number[]): Promise<void> {
  const res = await fetch("/api/intelligence-alerts/bulk-acknowledge", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Gagal bulk acknowledge");
}

function AlertCard({ alert, onAcknowledge, onResolve }: {
  alert: IntelligenceAlert;
  onAcknowledge: (id: number) => void;
  onResolve: (id: number) => void;
}) {
  const cfg = SEVERITY_CONFIG[alert.severity];
  const SeverityIcon = cfg.icon;
  const timeAgo = formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true, locale: idLocale });

  return (
    <div className={`rounded-lg border p-4 ${cfg.bg} space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <SeverityIcon className={`h-4 w-4 mt-0.5 shrink-0 ${alert.severity === "critical" ? "text-red-600" : alert.severity === "warning" ? "text-yellow-600" : "text-blue-600"}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{alert.title}</span>
              <Badge variant={cfg.color} className="text-[10px] px-1.5 py-0">{cfg.label}</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-white">
                {ALERT_TYPE_LABELS[alert.alertType] ?? alert.alertType}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
            {alert.entityRef && (
              <p className="text-xs text-muted-foreground/70 mt-0.5">Ref: {alert.entityRef}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo}</span>
          {alert.status === "open" && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 bg-white"
                onClick={() => onAcknowledge(alert.id)}>
                Ack
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 bg-white text-green-700 border-green-300"
                onClick={() => onResolve(alert.id)}>
                Resolve
              </Button>
            </div>
          )}
          {alert.status === "acknowledged" && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 bg-white text-green-700 border-green-300"
                onClick={() => onResolve(alert.id)}>
                Resolve
              </Button>
            </div>
          )}
          {alert.status === "resolved" && (
            <span className="text-[11px] text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Resolved
            </span>
          )}
        </div>
      </div>
      {(alert.acknowledgedBy || alert.resolvedBy) && (
        <p className="text-[11px] text-muted-foreground/60 pl-7">
          {alert.resolvedBy ? `Resolved oleh: ${alert.resolvedBy}` : `Acknowledged oleh: ${alert.acknowledgedBy}`}
        </p>
      )}
    </div>
  );
}

function SettingsPanel() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["intelligence-alerts-settings"],
    queryFn: fetchSettings,
  });

  const [form, setForm] = React.useState<Partial<AlertSettings>>({});
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intelligence-alerts-settings"] });
      setDirty(false);
      toast({ title: "Pengaturan disimpan" });
    },
    onError: () => {
      toast({ title: "Gagal menyimpan pengaturan", variant: "destructive" });
    },
  });

  function update<K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Memuat pengaturan...</p>;

  const f = { ...settings, ...form } as AlertSettings;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Master toggle */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Status Sistem Alert</CardTitle>
          <CardDescription>Matikan semua alert sekaligus jika dibutuhkan</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Intelligence Alerts Aktif</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Jika dimatikan, sistem tidak akan membuat alert baru maupun mengirim notifikasi WA
              </p>
            </div>
            <Switch
              checked={f.masterEnabled}
              onCheckedChange={(v) => update("masterEnabled", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Jam pengiriman alert */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Jam Pengiriman Notifikasi WA</CardTitle>
          <CardDescription>Alert tetap dibuat di sistem, tapi notifikasi WhatsApp hanya dikirim dalam rentang jam ini</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Dari jam</Label>
              <Input
                type="time"
                value={f.alertWindowStart}
                onChange={(e) => update("alertWindowStart", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Sampai jam</Label>
              <Input
                type="time"
                value={f.alertWindowEnd}
                onChange={(e) => update("alertWindowEnd", e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Contoh: 08:00 – 17:00 berarti notifikasi WA hanya dikirim di jam kerja.
          </p>
        </CardContent>
      </Card>

      {/* RFQ no response */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">RFQ Tidak Ada Response</CardTitle>
              <CardDescription>Alert jika vendor tidak submit quote dalam batas waktu</CardDescription>
            </div>
            <Switch
              checked={f.rfqAlertEnabled}
              onCheckedChange={(v) => update("rfqAlertEnabled", v)}
            />
          </div>
        </CardHeader>
        {f.rfqAlertEnabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Batas Peringatan (jam)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={f.rfqWarningHours}
                  onChange={(e) => update("rfqWarningHours", parseInt(e.target.value) || 24)}
                />
                <p className="text-xs text-muted-foreground">Kirim reminder WA ke admin</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Batas Kritis (jam)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={f.rfqCriticalHours}
                  onChange={(e) => update("rfqCriticalHours", parseInt(e.target.value) || 48)}
                />
                <p className="text-xs text-muted-foreground">Buat alert kritis + eskalasi WA</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Margin minimum */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Margin di Bawah Minimum</CardTitle>
              <CardDescription>Alert jika margin keuntungan order terlalu kecil</CardDescription>
            </div>
            <Switch
              checked={f.marginAlertEnabled}
              onCheckedChange={(v) => update("marginAlertEnabled", v)}
            />
          </div>
        </CardHeader>
        {f.marginAlertEnabled && (
          <CardContent>
            <div className="space-y-1.5 max-w-xs">
              <Label className="text-sm">Margin Minimum (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={f.marginMinPct}
                  onChange={(e) => update("marginMinPct", e.target.value)}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Alert dibuat jika margin order di bawah angka ini</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ETA breach */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">ETA Order Terlewat</CardTitle>
              <CardDescription>Alert jika order melebihi estimasi waktu pengiriman</CardDescription>
            </div>
            <Switch
              checked={f.etaAlertEnabled}
              onCheckedChange={(v) => update("etaAlertEnabled", v)}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Quote expired */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Quote Customer Expired</CardTitle>
              <CardDescription>Alert jika customer tidak konfirmasi quotation dalam 7 hari</CardDescription>
            </div>
            <Switch
              checked={f.quoteExpiredAlertEnabled}
              onCheckedChange={(v) => update("quoteExpiredAlertEnabled", v)}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Footer info */}
      {f.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Terakhir diupdate: {format(new Date(f.updatedAt), "dd MMM yyyy HH:mm", { locale: idLocale })}
          {f.updatedBy && ` oleh ${f.updatedBy}`}
        </p>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          onClick={() => saveMut.mutate(form)}
          disabled={!dirty || saveMut.isPending}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {saveMut.isPending ? "Menyimpan..." : "Simpan Pengaturan"}
        </Button>
      </div>
    </div>
  );
}

export default function IntelligenceAlertsPage() {
  const [tab, setTab] = useState<"open" | "acknowledged" | "resolved" | "settings">("open");
  const qc = useQueryClient();

  const { data: summary } = useQuery({
    queryKey: ["intelligence-alerts-summary"],
    queryFn: fetchSummary,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["intelligence-alerts", tab],
    queryFn: () => (tab === "settings" ? Promise.resolve({ alerts: [], total: 0 }) : fetchAlerts(tab)),
    enabled: tab !== "settings",
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  const ackMut = useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["intelligence-alerts"] }); qc.invalidateQueries({ queryKey: ["intelligence-alerts-summary"] }); },
  });

  const resMut = useMutation({
    mutationFn: resolveAlert,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["intelligence-alerts"] }); qc.invalidateQueries({ queryKey: ["intelligence-alerts-summary"] }); },
  });

  const bulkAckMut = useMutation({
    mutationFn: bulkAcknowledge,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["intelligence-alerts"] }); qc.invalidateQueries({ queryKey: ["intelligence-alerts-summary"] }); },
  });

  const openAlerts = data?.alerts ?? [];
  const criticalCount = summary?.open.critical ?? 0;
  const warningCount = summary?.open.warning ?? 0;
  const totalOpen = criticalCount + warningCount + (summary?.open.info ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intelligence Alerts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitoring otomatis untuk bottleneck operasional, RFQ, dan order.
          </p>
        </div>
        {tab !== "settings" && (
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <ShieldAlert className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{criticalCount}</p>
                <p className="text-xs text-muted-foreground">Kritis (Open)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-yellow-100 p-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{warningCount}</p>
                <p className="text-xs text-muted-foreground">Peringatan (Open)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-gray-100 p-2">
                <Clock className="h-4 w-4 text-gray-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalOpen}</p>
                <p className="text-xs text-muted-foreground">Total Open</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="open">
            Open {totalOpen > 0 && <span className="ml-1.5 rounded-full bg-red-500 text-white text-[10px] px-1.5 py-0.5">{totalOpen}</span>}
          </TabsTrigger>
          <TabsTrigger value="acknowledged">Acknowledged</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            Pengaturan
          </TabsTrigger>
        </TabsList>

        {/* Alerts list tabs */}
        {(["open", "acknowledged", "resolved"] as const).map(t => (
          <TabsContent key={t} value={t} className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">Daftar Alert</CardTitle>
                  {t === "open" && openAlerts.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => bulkAckMut.mutate(openAlerts.map(a => a.id))}
                      disabled={bulkAckMut.isPending}
                    >
                      Acknowledge Semua
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Memuat...</p>}
                {!isLoading && openAlerts.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground">
                    <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-400" />
                    <p className="text-sm">Tidak ada alert {t === "open" ? "aktif" : t}.</p>
                  </div>
                )}
                {openAlerts.map(alert => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={(id) => ackMut.mutate(id)}
                    onResolve={(id) => resMut.mutate(id)}
                  />
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        {/* Settings tab */}
        <TabsContent value="settings" className="mt-4">
          <SettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
