import { useState, useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Database, ArrowUpFromLine, ArrowDownToLine, CheckCircle2,
  XCircle, AlertCircle, RefreshCw, ArrowLeft, Clock, Loader2,
  ServerCrash, Server,
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DbStatus {
  enabled: boolean;
  reason?: string;
  local:  { configured: boolean; masked: string };
  prod:   { configured: boolean; masked: string };
  dev:    { configured: boolean; masked: string };
  jobs:   SyncJob[];
}

interface SyncJob {
  id: string;
  direction: "push" | "pull";
  target: "prod" | "dev";
  mode: "data" | "schema" | "full";
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  log: string[];
  progress: number;
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function fetchStatus(): Promise<DbStatus> {
  const r = await fetch("/api/admin/db-sync/status");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function startSync(direction: "push" | "pull", target: "prod" | "dev", mode: string) {
  const r = await fetch("/api/admin/db-sync/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction, target, mode }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? "Gagal memulai sync");
  }
  return r.json() as Promise<{ jobId: string }>;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
    : <XCircle className="h-4 w-4 text-red-500" />;
}

function ConnectionCard({
  label, icon: Icon, configured, masked, colorClass,
}: {
  label: string; icon: React.ElementType; configured: boolean; masked: string; colorClass: string;
}) {
  return (
    <Card className={`border-l-4 ${colorClass}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{label}</span>
          <StatusDot ok={configured} />
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {masked || "(env var belum diset)"}
        </p>
      </CardContent>
    </Card>
  );
}

function JobBadge({ status }: { status: SyncJob["status"] }) {
  if (status === "running") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Berjalan</Badge>;
  if (status === "done")    return <Badge variant="default"   className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />Selesai</Badge>;
  return                           <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Error</Badge>;
}

function duration(job: SyncJob) {
  const end = job.finishedAt ? new Date(job.finishedAt) : new Date();
  const ms  = end.getTime() - new Date(job.startedAt).getTime();
  return ms < 60_000 ? `${Math.round(ms / 1000)}d` : `${Math.round(ms / 60_000)}m`;
}

// ── Live log box with SSE ─────────────────────────────────────────────────────
function LiveLog({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [lines, setLines]     = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [done, setDone]       = useState(false);
  const bottomRef             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/admin/db-sync/stream/${jobId}`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "log")      setLines((l) => [...l, data.line]);
      if (data.type === "progress") setProgress(data.progress);
      if (data.type === "done") {
        setDone(true);
        es.close();
        onDone();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Job ID: <code className="font-mono">{jobId}</code></span>
        <span>{progress}%</span>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ScrollArea className="h-48 rounded-md border bg-black/90 p-2">
        <div className="font-mono text-xs text-green-400 space-y-0.5">
          {lines.map((l, i) => <div key={i}>{l}</div>)}
          {!done && <div className="animate-pulse text-zinc-500">▋</div>}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Sync Panel (push/pull card) ───────────────────────────────────────────────
function SyncPanel({
  target, localOk, remoteOk, onJobStarted,
}: {
  target: "prod" | "dev";
  localOk: boolean;
  remoteOk: boolean;
  onJobStarted: (jobId: string, direction: "push" | "pull") => void;
}) {
  const [mode, setMode]       = useState("data");
  const [loading, setLoading] = useState<"push" | "pull" | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const canSync = localOk && remoteOk;

  const run = async (direction: "push" | "pull") => {
    if (!canSync) return;
    setError(null);
    setLoading(direction);
    try {
      const { jobId } = await startSync(direction, target, mode);
      onJobStarted(jobId, direction);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  };

  const label = target === "prod" ? "Prod" : "Dev";
  const color = target === "prod" ? "text-orange-500" : "text-blue-500";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4" />
          Supabase <span className={color}>{label}</span>
          {!remoteOk && <Badge variant="outline" className="text-xs text-red-500">Belum dikonfigurasi</Badge>}
        </CardTitle>
        <CardDescription className="text-xs">
          {target === "prod"
            ? "SUPABASE_DATABASE_URL"
            : "SUPABASE_DATABASE_URL_DEV"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-12">Mode:</span>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="data">Data saja</SelectItem>
              <SelectItem value="schema">Skema saja</SelectItem>
              <SelectItem value="full">Full (skema + data)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="default"
            disabled={!canSync || !!loading}
            onClick={() => run("push")}
            className="gap-1.5 text-xs"
          >
            {loading === "push"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ArrowUpFromLine className="h-3.5 w-3.5" />
            }
            Push ke {label}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canSync || !!loading}
            onClick={() => run("pull")}
            className="gap-1.5 text-xs"
          >
            {loading === "pull"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ArrowDownToLine className="h-3.5 w-3.5" />
            }
            Pull dari {label}
          </Button>
        </div>

        {!canSync && (
          <p className="text-xs text-muted-foreground">
            {!localOk ? "DATABASE_URL belum diset." : `SUPABASE_DATABASE_URL${target === "dev" ? "_DEV" : ""} belum diset di Secrets.`}
          </p>
        )}
        {error && (
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DbSyncPage() {
  const [activeJob, setActiveJob]   = useState<{ jobId: string; direction: "push" | "pull" } | null>(null);
  const [showLive, setShowLive]     = useState(false);

  const { data, isLoading, error, refetch } = useQuery<DbStatus>({
    queryKey: ["db-sync-status"],
    queryFn: fetchStatus,
    refetchInterval: 30_000,
  });

  const handleJobStarted = (jobId: string, direction: "push" | "pull") => {
    setActiveJob({ jobId, direction });
    setShowLive(true);
  };

  const handleDone = () => {
    refetch();
  };

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/system-health">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Database className="h-5 w-5" />
              Sinkronisasi Database
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Sinkronisasi database legacy dinonaktifkan
            </p>
          </div>
          <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

         <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
           <AlertCircle className="h-4 w-4 text-blue-500" />
          <AlertDescription className="text-sm">
             <strong>Supabase adalah satu-satunya database aplikasi.</strong>{" "}
             Sinkronisasi dua arah dengan database Replit/Helium telah dinonaktifkan.
             Gunakan alat migrasi Supabase yang eksplisit untuk perubahan schema.
          </AlertDescription>
        </Alert>

        {/* Connection status */}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat status koneksi...
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <ServerCrash className="h-4 w-4" />
            <AlertDescription>Gagal memuat status: {String(error)}</AlertDescription>
          </Alert>
        )}

        {data && (
          <>
             {/* Connections */}
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">Status Koneksi</h2>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ConnectionCard
                  label="Supabase Prod"
                  icon={Server}
                  configured={data.prod.configured}
                  masked={data.prod.masked}
                  colorClass="border-l-orange-500"
                />
                <ConnectionCard
                  label="Supabase Dev"
                  icon={Server}
                  configured={data.dev.configured}
                  masked={data.dev.masked}
                  colorClass="border-l-blue-500"
                />
              </div>
            </div>

             <Alert>
               <Server className="h-4 w-4" />
               <AlertDescription className="text-sm">
                 Endpoint sync lama tetap tersedia hanya untuk menampilkan status
                 kompatibilitas, tetapi semua operasi push/pull akan ditolak.
               </AlertDescription>
             </Alert>

            {/* Live log */}
            {showLive && activeJob && (
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-2">
                  Log Real-time — {activeJob.direction === "push" ? "Push" : "Pull"}{" "}
                  ke Supabase {activeJob.jobId}
                </h2>
                <LiveLog
                  jobId={activeJob.jobId}
                  onDone={handleDone}
                />
              </div>
            )}

            {/* Job history */}
            {data.jobs.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-muted-foreground mb-2">Riwayat Sync</h2>
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {data.jobs.map((job) => (
                        <div key={job.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                          {job.direction === "push"
                            ? <ArrowUpFromLine className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ArrowDownToLine className="h-4 w-4 text-muted-foreground shrink-0" />
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium capitalize">{job.direction}</span>
                              <Badge variant="outline" className="text-xs">
                                {job.target === "prod" ? "Prod" : "Dev"}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{job.mode}</span>
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Clock className="h-3 w-3" />
                              {new Date(job.startedAt).toLocaleString("id-ID")}
                              {job.finishedAt && <span>· {duration(job)}</span>}
                            </div>
                          </div>
                          <JobBadge status={job.status} />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => {
                              setActiveJob({ jobId: job.id, direction: job.direction });
                              setShowLive(true);
                            }}
                          >
                            Log
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
