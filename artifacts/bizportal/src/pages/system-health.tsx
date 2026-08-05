import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Clock, Database,
  MessageCircle, Mail, Server, Activity, Wifi, ArrowLeft, Shield,
  AlertTriangle, Zap, Radio, Send,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HealthzResponse {
  status: "ok" | "degraded" | "error";
  uptimeSeconds: number;
  version: string;
  services: {
    db: "ok" | "error" | "unconfigured";
    whatsapp: "ok" | "error" | "unconfigured";
    whatsappLatencyMs: number | null;
    smtp: "ok" | "error" | "unconfigured";
    smtpLatencyMs: number | null;
  };
}

interface CbState {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failure_count: number;
  cooldown_remaining: number;
}

interface ServiceEntry {
  name: string;
  status: "up" | "down" | "slow" | "unknown";
  latency_ms: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms?: number | null;
  uptime_pct: number | null;
  last_check: string | null;
  last_down?: string | null;
  circuit_breaker: CbState;
  dependencies: string[];
  simulated?: boolean;
}

interface CascadeRisk {
  source: string;
  affected: string[];
  risk_level: "low" | "medium" | "high" | "critical";
}

interface RecentEvent {
  ts: string;
  service: string;
  event: string;
  severity: "info" | "warn" | "error";
}

interface GlobalHealthResponse {
  overall_status: "healthy" | "degraded" | "critical" | "unknown";
  health_score: number;
  timestamp: string;
  simulation_mode?: boolean;
  simulated_failures?: string[];
  services: Record<string, ServiceEntry>;
  cascade_risks: CascadeRisk[];
  recent_events: RecentEvent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}d`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}d`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}h ${h % 24}j`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "–";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}d lalu`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m lalu`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}j lalu`;
  return `${Math.round(diff / 86_400_000)}hr lalu`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

type StatusVal = "ok" | "error" | "unconfigured" | "loading" | "warn";

function StatusBadge({ status }: { status: StatusVal }) {
  if (status === "loading") return <Badge variant="secondary" className="text-xs gap-1"><RefreshCw size={10} className="animate-spin" />Loading</Badge>;
  if (status === "ok") return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-xs gap-1"><CheckCircle2 size={10} />OK</Badge>;
  if (status === "warn") return <Badge className="bg-yellow-600 hover:bg-yellow-600 text-xs gap-1"><AlertCircle size={10} />Lambat</Badge>;
  if (status === "error") return <Badge variant="destructive" className="text-xs gap-1"><XCircle size={10} />Error</Badge>;
  return <Badge variant="outline" className="text-xs gap-1 text-muted-foreground"><AlertCircle size={10} />Tidak dikonfigurasi</Badge>;
}

function CbBadge({ state }: { state: "CLOSED" | "OPEN" | "HALF_OPEN" }) {
  if (state === "CLOSED") return <Badge className="bg-emerald-800/60 text-emerald-200 hover:bg-emerald-800/60 text-xs gap-1 font-mono"><Shield size={9} />CLOSED</Badge>;
  if (state === "OPEN") return <Badge className="bg-red-800/60 text-red-200 hover:bg-red-800/60 text-xs gap-1 font-mono"><Zap size={9} />OPEN</Badge>;
  return <Badge className="bg-yellow-800/60 text-yellow-200 hover:bg-yellow-800/60 text-xs gap-1 font-mono"><Radio size={9} />HALF-OPEN</Badge>;
}

function LatencyChip({ ms }: { ms: number | null }) {
  if (ms === null) return <span className="text-xs text-muted-foreground">–</span>;
  const color = ms < 200 ? "text-emerald-400" : ms < 1000 ? "text-yellow-400" : "text-red-400";
  return <span className={`text-xs font-mono ${color}`}>{ms}ms</span>;
}

function HealthScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-lg font-bold font-mono ${score >= 80 ? "text-emerald-400" : score >= 50 ? "text-yellow-400" : "text-red-400"}`}>{score}</span>
    </div>
  );
}

function SvcStatusVal(s: ServiceEntry): StatusVal {
  if (s.status === "up") return "ok";
  if (s.status === "slow") return "warn";
  if (s.status === "down") return "error";
  return "unconfigured";
}

// ── WA Test Panel (dev/staging only) ─────────────────────────────────────────

interface SendWaResult {
  ok: boolean;
  verdict: string;
  waMessageId: string | null;
  target?: string;
  testRefId?: string;
}

function WaTestPanel() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SendWaResult | null>(null);

  async function handleSend() {
    setLoading(true);
    setResult(null);
    try {
      const body: Record<string, string> = {};
      if (phone.trim()) body.target = phone.trim();
      const r = await fetch("/api/dev-test/send-wa", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      setResult({
        ok: data.ok ?? false,
        verdict: data.verdict ?? (r.ok ? "Terkirim" : `HTTP ${r.status}`),
        waMessageId: data.waMessageId ?? null,
        target: data.target,
        testRefId: data.testRefId,
      });
    } catch (err) {
      setResult({ ok: false, verdict: `❌ Network error — ${String(err)}`, waMessageId: null });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-yellow-600/30 bg-yellow-950/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-yellow-300">
          <Send size={15} />
          Kirim Test WhatsApp
          <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-600/40 ml-1">DEV / STAGING</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Kirim pesan WA sungguhan via Fonnte untuk verifikasi pipeline E2E. Berguna setelah ganti kredensial atau reconnect device.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="Nomor tujuan, mis. 08123456789 (kosong = WA_TEST_NUMBER)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="text-sm h-8 flex-1"
            disabled={loading}
          />
          <Button size="sm" onClick={handleSend} disabled={loading} className="shrink-0 gap-1.5">
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
            {loading ? "Mengirim…" : "Kirim"}
          </Button>
        </div>
        {result && (
          <div className={`rounded px-3 py-2.5 text-sm border ${result.ok ? "border-emerald-600/40 bg-emerald-950/20" : "border-red-600/40 bg-red-950/20"}`}>
            <p className="font-medium">{result.verdict}</p>
            {result.target && (
              <p className="text-xs text-muted-foreground mt-1">
                Tujuan: <span className="font-mono">{result.target}</span>
                {result.waMessageId && <span> · wa_message_id: <span className="font-mono">{result.waMessageId}</span></span>}
              </p>
            )}
            {result.testRefId && (
              <p className="text-xs text-muted-foreground">
                refId: <span className="font-mono">{result.testRefId}</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchHealthz(): Promise<HealthzResponse> {
  const r = await fetch("/api/healthz", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchGlobalHealth(): Promise<GlobalHealthResponse> {
  const r = await fetch("/system/global-health", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemHealthPage() {
  const {
    data: hz, isLoading: hzLoading, isError: hzError, error: hzErr,
    refetch: refetchHz, isFetching: hzFetching, dataUpdatedAt: hzUpdatedAt,
  } = useQuery<HealthzResponse>({
    queryKey: ["system", "healthz"],
    queryFn: fetchHealthz,
    refetchInterval: 15_000,
    retry: 1,
  });

  const {
    data: gh, isLoading: ghLoading, isError: ghError,
    refetch: refetchGh, isFetching: ghFetching,
  } = useQuery<GlobalHealthResponse>({
    queryKey: ["system", "global-health"],
    queryFn: fetchGlobalHealth,
    refetchInterval: 10_000,
    retry: 2,
  });

  const isLoading = hzLoading || ghLoading;
  const isFetching = hzFetching || ghFetching;

  function refetchAll() { refetchHz(); refetchGh(); }

  const lastUpdated = hzUpdatedAt
    ? new Date(hzUpdatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "–";

  const overallStatus: StatusVal = isLoading ? "loading"
    : gh?.overall_status === "healthy" ? "ok"
    : gh?.overall_status === "degraded" ? "warn"
    : gh?.overall_status === "critical" ? "error"
    : hzError ? "error"
    : hz?.status === "ok" ? "ok"
    : "unconfigured";

  const services = gh?.services ? Object.entries(gh.services) : [];
  const riskColor: Record<string, string> = { low: "border-blue-600/30 bg-blue-950/20", medium: "border-yellow-600/30 bg-yellow-950/20", high: "border-orange-600/30 bg-orange-950/20", critical: "border-red-600/30 bg-red-950/20" };
  const severityColor: Record<string, string> = { info: "text-blue-400", warn: "text-yellow-400", error: "text-red-400" };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
              <h1 className="text-2xl font-bold">Status Sistem</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Monitoring real-time semua layanan BizPortal
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refetchAll} disabled={isFetching} className="gap-2">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {/* Overall Status Banner */}
        <Card className={
          overallStatus === "ok" ? "border-emerald-600/40 bg-emerald-950/20"
          : overallStatus === "error" ? "border-red-600/40 bg-red-950/20"
          : overallStatus === "warn" ? "border-yellow-600/40 bg-yellow-950/20"
          : "border-border"
        }>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-4">
              {overallStatus === "ok" && <CheckCircle2 size={36} className="text-emerald-400 shrink-0" />}
              {overallStatus === "error" && <XCircle size={36} className="text-red-400 shrink-0" />}
              {(overallStatus === "warn" || overallStatus === "unconfigured" || overallStatus === "loading") && <AlertCircle size={36} className="text-yellow-400 shrink-0" />}
              <div className="flex-1">
                <p className="font-semibold text-lg">
                  {overallStatus === "ok" && "Semua Layanan Normal"}
                  {overallStatus === "error" && "Ada Layanan Kritis"}
                  {overallStatus === "warn" && "Beberapa Layanan Terdegradasi"}
                  {overallStatus === "unconfigured" && "Beberapa Layanan Tidak Dikonfigurasi"}
                  {overallStatus === "loading" && "Memuat status…"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Diperbarui: {lastUpdated} · Auto-refresh setiap 10–15 detik
                </p>
                {gh && (
                  <div className="mt-3">
                    <HealthScoreBar score={gh.health_score} />
                  </div>
                )}
              </div>
            </div>
            {gh?.simulation_mode && (
              <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400 border border-yellow-600/30 rounded px-3 py-1.5 bg-yellow-950/30">
                <AlertTriangle size={12} />
                <span>SIMULATION MODE aktif — kegagalan disimulasikan: {gh.simulated_failures?.join(", ") || "—"}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Watchdog — Service Cards */}
        {services.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity size={16} />
                Status Layanan (Watchdog)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {services.map(([id, svc]) => (
                  <div key={id} className="px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{svc.name}</span>
                        <StatusBadge status={SvcStatusVal(svc)} />
                        <CbBadge state={svc.circuit_breaker.state} />
                        {svc.simulated && (
                          <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-600/40">simulasi</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          Latensi: <LatencyChip ms={svc.latency_ms} />
                          {svc.avg_latency_ms != null && <span className="text-muted-foreground"> ∅{svc.avg_latency_ms}ms</span>}
                        </span>
                        {svc.uptime_pct != null && (
                          <span className="text-xs text-muted-foreground">
                            Uptime: <span className={svc.uptime_pct >= 99 ? "text-emerald-400" : svc.uptime_pct >= 90 ? "text-yellow-400" : "text-red-400"}>{svc.uptime_pct.toFixed(1)}%</span>
                          </span>
                        )}
                        {svc.circuit_breaker.failure_count > 0 && (
                          <span className="text-xs text-red-400">
                            {svc.circuit_breaker.failure_count} kegagalan
                            {svc.circuit_breaker.cooldown_remaining > 0 && ` · cooldown ${Math.ceil(svc.circuit_breaker.cooldown_remaining / 1000)}d`}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">cek {relativeTime(svc.last_check)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cascade Risks */}
        {gh?.cascade_risks && gh.cascade_risks.length > 0 && (
          <Card className="border-orange-600/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-orange-300">
                <AlertTriangle size={16} />
                Risiko Cascade
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {gh.cascade_risks.map((risk, i) => (
                <div key={i} className={`flex items-center gap-3 rounded px-3 py-2 border ${riskColor[risk.risk_level] ?? "border-border"}`}>
                  <Badge className="text-xs capitalize shrink-0" variant="outline">{risk.risk_level}</Badge>
                  <span className="text-sm">
                    <span className="font-mono text-orange-300">{risk.source}</span>
                    {" → "}
                    <span className="text-muted-foreground">{risk.affected.join(", ")}</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* API Server Ext Deps */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi size={16} />
              Dependensi Eksternal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-muted"><Database size={15} className="text-muted-foreground" /></div>
                <div>
                  <p className="text-sm font-medium">Database (PostgreSQL)</p>
                  <p className="text-xs text-muted-foreground">Supabase · Drizzle ORM</p>
                </div>
              </div>
              <StatusBadge status={hzLoading ? "loading" : (hz?.services.db ?? "unconfigured") as StatusVal} />
            </div>
            <div className="flex items-center justify-between py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-muted"><MessageCircle size={15} className="text-muted-foreground" /></div>
                <div>
                  <p className="text-sm font-medium">WhatsApp (Fonnte)</p>
                  <p className="text-xs text-muted-foreground">Notifikasi order & driver</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hz?.services.whatsappLatencyMs != null && <LatencyChip ms={hz.services.whatsappLatencyMs} />}
                <StatusBadge status={hzLoading ? "loading" : (hz?.services.whatsapp ?? "unconfigured") as StatusVal} />
              </div>
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded bg-muted"><Mail size={15} className="text-muted-foreground" /></div>
                <div>
                  <p className="text-sm font-medium">Email (SMTP)</p>
                  <p className="text-xs text-muted-foreground">Pengiriman email dokumen</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hz?.services.smtpLatencyMs != null && <LatencyChip ms={hz.services.smtpLatencyMs} />}
                <StatusBadge status={hzLoading ? "loading" : (hz?.services.smtp ?? "unconfigured") as StatusVal} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* WA Test Panel — dev/staging only */}
        {!import.meta.env.PROD && <WaTestPanel />}

        {/* API Server Uptime */}
        {hz && (
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Uptime API</span>
                </div>
                <p className="text-2xl font-bold font-mono">{formatUptime(hz.uptimeSeconds)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-2 mb-1">
                  <Server size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Versi</span>
                </div>
                <p className="text-2xl font-bold font-mono">{hz.version}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recent Events */}
        {gh?.recent_events && gh.recent_events.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity size={16} />
                Event Terbaru
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50 max-h-60 overflow-y-auto">
                {gh.recent_events.slice(0, 20).map((ev, i) => (
                  <div key={i} className="px-6 py-2.5 flex items-start gap-3">
                    <span className={`text-xs mt-0.5 shrink-0 ${severityColor[ev.severity] ?? "text-muted-foreground"}`}>
                      {ev.severity.toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground">[{ev.service}]</span>
                      {" "}
                      <span className="text-xs">{ev.event}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{relativeTime(ev.ts)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Watchdog Error State */}
        {ghError && !ghLoading && (
          <Card className="border-yellow-600/30 bg-yellow-950/10">
            <CardContent className="pt-5 pb-5 flex items-center gap-3">
              <AlertCircle size={20} className="text-yellow-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-300">Watchdog Service tidak tersedia</p>
                <p className="text-xs text-muted-foreground mt-0.5">Data per-service dan circuit breaker tidak dapat dimuat. Periksa Watchdog Service workflow.</p>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </AppShell>
  );
}
