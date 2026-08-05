import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QueryState } from "@/components/ui/query-state";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, ShieldCheck, ShieldAlert, Clock, CheckCircle, XCircle,
  Lock, AlertTriangle, Activity, Eye, RefreshCw, ChevronDown, ChevronUp, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";

const API = "/api/accounting/governance";

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtAmt(n: unknown) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(Math.abs(Number(n ?? 0)));
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 border-red-300",
    HIGH: "bg-orange-100 text-orange-800 border-orange-300",
    MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-300",
    LOW: "bg-green-100 text-green-800 border-green-300",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${map[severity] ?? "bg-gray-100 text-gray-700"}`}>{severity}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    pending_approval: "bg-blue-100 text-blue-800",
    posted: "bg-gray-100 text-gray-700",
  };
  return <Badge className={map[status] ?? "bg-gray-100 text-gray-700"}>{status}</Badge>;
}

// KPI Cards
function KPICards({ companyId }: { companyId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-stats", companyId],
    queryFn: () => fetch(`${API}/stats?company_id=${companyId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  const cards = [
    { label: "Pending Approval", value: data?.pendingApprovals ?? 0, icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "Anomali Terbuka", value: data?.openAnomalies ?? 0, icon: ShieldAlert, color: "text-red-600", bg: "bg-red-50" },
    { label: "Period Terkunci", value: data?.lockedPeriods ?? 0, icon: Lock, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Total Override", value: data?.totalOverrides ?? 0, icon: ShieldCheck, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => (
        <Card key={c.label} className={`${c.bg} border-0`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <c.icon className={`w-7 h-7 ${c.color}`} />
              <div>
                <div className={`text-2xl font-bold ${c.color}`}>{isLoading ? "…" : c.value}</div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Pending Approvals Table
function PendingApprovalsTable({ companyId }: { companyId: number }) {
  const qc = useQueryClient();
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["gov-pending", companyId, page],
    queryFn: () =>
      fetch(`${API}/journal/pending?company_id=${companyId}&page=${page}&limit=20`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
  });

  const approve = useMutation({
    mutationFn: (entryId: number) =>
      fetch(`${API}/journal/${entryId}/approve?company_id=${companyId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ notes: "Approved via dashboard" }),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-pending"] }); qc.invalidateQueries({ queryKey: ["gov-stats"] }); },
  });

  const reject = useMutation({
    mutationFn: ({ entryId, reason }: { entryId: number; reason: string }) =>
      fetch(`${API}/journal/${entryId}/reject?company_id=${companyId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ reason }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setRejectId(null); setRejectReason("");
      qc.invalidateQueries({ queryKey: ["gov-pending"] }); qc.invalidateQueries({ queryKey: ["gov-stats"] });
    },
  });

  const items: any[] = data?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Menunggu Persetujuan ({data?.total ?? 0})</h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
      </div>
      <QueryState loading={isLoading} empty={!isLoading && items.length === 0} emptyMessage="Tidak ada entri pending">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nomor Entri</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              <TableHead>Disubmit Oleh</TableHead>
              <TableHead>Disubmit Pada</TableHead>
              <TableHead>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.entry_number}</TableCell>
                <TableCell>{row.date}</TableCell>
                <TableCell className="text-right font-mono">Rp {fmtAmt(row.total_debit)}</TableCell>
                <TableCell>{row.submitted_by ?? "—"}</TableCell>
                <TableCell>{fmtDate(row.submitted_at)}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50"
                      onClick={() => approve.mutate(row.entry_id)} disabled={approve.isPending}>
                      <CheckCircle className="w-3.5 h-3.5 mr-1" /> Setuju
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50"
                      onClick={() => setRejectId(row.entry_id)} disabled={reject.isPending}>
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Tolak
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
      {(data?.total ?? 0) > 20 && (
        <div className="flex justify-center gap-2 mt-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground self-center">Hal {page}</span>
          <Button variant="outline" size="sm" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      <Dialog open={rejectId !== null} onOpenChange={() => setRejectId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tolak Entri Jurnal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Alasan Penolakan *</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Masukkan alasan penolakan..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>Batal</Button>
            <Button variant="destructive" disabled={!rejectReason.trim() || reject.isPending}
              onClick={() => rejectId && reject.mutate({ entryId: rejectId, reason: rejectReason })}>
              Konfirmasi Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Anomaly Alerts Table
function AnomalyAlertsTable({ companyId }: { companyId: number }) {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["gov-anomalies", companyId, severity],
    queryFn: () =>
      fetch(`${API}/anomalies?company_id=${companyId}&severity=${severity}&reviewed=false&limit=50`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
  });

  const review = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/anomalies/${id}/review?company_id=${companyId}`, { method: "PATCH", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gov-anomalies"] }),
  });

  const items: any[] = data?.items ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="font-semibold text-sm">Anomali Terdeteksi ({data?.total ?? 0})</h3>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua</SelectItem>
            <SelectItem value="CRITICAL">CRITICAL</SelectItem>
            <SelectItem value="HIGH">HIGH</SelectItem>
            <SelectItem value="MEDIUM">MEDIUM</SelectItem>
            <SelectItem value="LOW">LOW</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <QueryState loading={isLoading}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aturan</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Entry ID</TableHead>
              <TableHead>Terdeteksi</TableHead>
              <TableHead>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Tidak ada anomali aktif</TableCell></TableRow>
            )}
            {items.map((row) => (
              <>
                <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <button className="flex items-center gap-1 text-left text-xs font-medium"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      {expanded === row.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {row.rule_triggered}
                    </button>
                  </TableCell>
                  <TableCell><SeverityBadge severity={row.severity} /></TableCell>
                  <TableCell className="text-right font-mono text-sm">{row.anomaly_score}</TableCell>
                  <TableCell className="font-mono text-xs">{row.entry_id ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtDate(row.detected_at)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" className="text-xs h-7"
                      onClick={() => review.mutate(row.id)} disabled={review.isPending}>
                      <Eye className="w-3 h-3 mr-1" /> Review
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded === row.id && (
                  <TableRow key={`${row.id}-detail`}>
                    <TableCell colSpan={6} className="bg-muted/30 text-xs p-3">
                      <pre className="whitespace-pre-wrap font-mono text-xs">
                        {JSON.stringify(typeof row.details === "string" ? JSON.parse(row.details) : row.details, null, 2)}
                      </pre>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </QueryState>
    </div>
  );
}

// Audit Trail Viewer
function AuditTrailViewer({ companyId }: { companyId: number }) {
  const [correlationId, setCorrelationId] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["gov-audit-trail", companyId, search],
    queryFn: () => {
      const params = new URLSearchParams({ company_id: String(companyId), limit: "50" });
      if (search) params.set("correlationId", search);
      return fetch(`${API}/audit-trail?${params}`, { credentials: "include" }).then((r) => r.json());
    },
    enabled: !!companyId,
  });

  const items: any[] = data?.items ?? [];
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Input placeholder="Cari Correlation ID..." value={correlationId}
          onChange={(e) => setCorrelationId(e.target.value)}
          className="h-8 text-sm w-64" />
        <Button size="sm" variant="outline" onClick={() => { setSearch(correlationId); refetch(); }}>Cari</Button>
        <Button size="sm" variant="ghost" onClick={() => { setCorrelationId(""); setSearch(""); }}>Reset</Button>
      </div>
      <QueryState loading={isLoading}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aksi</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Correlation ID</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Waktu</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Tidak ada data audit</TableCell></TableRow>
            )}
            {items.map((row) => (
              <>
                <TableRow key={row.id}>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{row.action}</Badge></TableCell>
                  <TableCell className="text-xs">{row.user_id ?? "—"}</TableCell>
                  <TableCell className="text-xs">{row.user_role ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.correlation_id?.slice(0, 16)}…</TableCell>
                  <TableCell className="text-xs">{row.ip_address ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtDate(row.created_at)}</TableCell>
                  <TableCell>
                    <button onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      className="text-muted-foreground hover:text-foreground">
                      {expanded === row.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </TableCell>
                </TableRow>
                {expanded === row.id && (
                  <TableRow key={`${row.id}-exp`}>
                    <TableCell colSpan={7} className="bg-muted/30 text-xs p-3">
                      <div className="grid grid-cols-2 gap-4">
                        {row.before_state && (
                          <div>
                            <div className="font-semibold mb-1">Before:</div>
                            <pre className="whitespace-pre-wrap font-mono text-xs bg-red-50 p-2 rounded">
                              {JSON.stringify(typeof row.before_state === "string" ? JSON.parse(row.before_state) : row.before_state, null, 2)}
                            </pre>
                          </div>
                        )}
                        {row.after_state && (
                          <div>
                            <div className="font-semibold mb-1">After:</div>
                            <pre className="whitespace-pre-wrap font-mono text-xs bg-green-50 p-2 rounded">
                              {JSON.stringify(typeof row.after_state === "string" ? JSON.parse(row.after_state) : row.after_state, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </QueryState>
    </div>
  );
}

// Period Lock Table
function PeriodLockTable({ companyId }: { companyId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-locked-periods", companyId],
    queryFn: () =>
      fetch(`${API}/locked-periods?company_id=${companyId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
  });

  const items: any[] = data?.items ?? [];

  return (
    <div>
      <h3 className="font-semibold text-sm mb-3">Status Periode ({items.length} total)</h3>
      <QueryState loading={isLoading} empty={!isLoading && items.length === 0} emptyMessage="Tidak ada data periode">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Periode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ditutup Oleh</TableHead>
              <TableHead>Ditutup Pada</TableHead>
              <TableHead>Override</TableHead>
              <TableHead>Alasan</TableHead>
              <TableHead>Signature</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono">{row.year}-{String(row.month).padStart(2, "0")}</TableCell>
                <TableCell>
                  {row.is_closed
                    ? <Badge className="bg-red-100 text-red-800"><Lock className="w-3 h-3 mr-1 inline" />Tertutup</Badge>
                    : <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1 inline" />Terbuka</Badge>}
                </TableCell>
                <TableCell className="text-xs">{row.closed_by ?? "—"}</TableCell>
                <TableCell className="text-xs">{fmtDate(row.closed_at)}</TableCell>
                <TableCell className="text-xs">{row.override_allowed ? <Badge className="bg-yellow-100 text-yellow-800">Ya</Badge> : "Tidak"}</TableCell>
                <TableCell className="text-xs">{row.close_reason ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.period_close_signature ? row.period_close_signature.slice(0, 12) + "…" : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
    </div>
  );
}

// Override Dialog
function OverrideDialog({ companyId, onClose }: { companyId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [entryId, setEntryId] = useState("");
  const [reason, setReason] = useState("");
  const [targetAction, setTargetAction] = useState("FORCE_POST");
  const [result, setResult] = useState<any>(null);

  const override = useMutation({
    mutationFn: () =>
      fetch(`${API}/override?company_id=${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entryId: Number(entryId), reason, targetAction }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["gov-stats"] });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <ShieldAlert className="w-5 h-5" /> Emergency Override (CFO Only)
          </DialogTitle>
        </DialogHeader>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Override akan dicatat permanen di audit trail dengan severity HIGH. Tindakan ini tidak dapat dibatalkan.
          </AlertDescription>
        </Alert>
        <div className="space-y-3">
          <div>
            <Label>Entry ID *</Label>
            <Input value={entryId} onChange={(e) => setEntryId(e.target.value)} placeholder="ID entri jurnal" className="h-8" />
          </div>
          <div>
            <Label>Target Aksi *</Label>
            <Select value={targetAction} onValueChange={setTargetAction}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FORCE_POST">FORCE_POST</SelectItem>
                <SelectItem value="BYPASS_APPROVAL">BYPASS_APPROVAL</SelectItem>
                <SelectItem value="UNLOCK_PERIOD">UNLOCK_PERIOD</SelectItem>
                <SelectItem value="EMERGENCY_CORRECTION">EMERGENCY_CORRECTION</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Alasan Override *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan alasan override secara detail..." rows={3} />
          </div>
        </div>
        {result && (
          <Alert className={result.ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}>
            <AlertDescription className="text-xs">{result.message ?? JSON.stringify(result)}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button variant="destructive" disabled={!entryId || !reason.trim() || override.isPending}
            onClick={() => override.mutate()}>
            {override.isPending ? "Memproses…" : "Konfirmasi Override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const { activeCompanyId } = useCompany();
  const [showOverride, setShowOverride] = useState(false);

  if (!activeCompanyId) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64 text-muted-foreground">Pilih perusahaan terlebih dahulu.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <Shield className="w-7 h-7 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold">Finance Governance & Audit Control</h1>
              <p className="text-xs text-muted-foreground">SAP-grade financial control layer — maker-checker, immutability, anomaly detection</p>
            </div>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setShowOverride(true)}>
            <ShieldAlert className="w-4 h-4 mr-2" /> Emergency Override
          </Button>
        </div>

        <KPICards companyId={activeCompanyId} />

        <Tabs defaultValue="approvals">
          <TabsList className="mb-4">
            <TabsTrigger value="approvals"><Clock className="w-4 h-4 mr-1.5" />Pending Approvals</TabsTrigger>
            <TabsTrigger value="anomalies"><ShieldAlert className="w-4 h-4 mr-1.5" />Anomali</TabsTrigger>
            <TabsTrigger value="periods"><Lock className="w-4 h-4 mr-1.5" />Periode</TabsTrigger>
            <TabsTrigger value="audit"><Activity className="w-4 h-4 mr-1.5" />Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent value="approvals">
            <Card>
              <CardContent className="pt-4">
                <PendingApprovalsTable companyId={activeCompanyId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="anomalies">
            <Card>
              <CardContent className="pt-4">
                <AnomalyAlertsTable companyId={activeCompanyId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="periods">
            <Card>
              <CardContent className="pt-4">
                <PeriodLockTable companyId={activeCompanyId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card>
              <CardContent className="pt-4">
                <AuditTrailViewer companyId={activeCompanyId} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {showOverride && <OverrideDialog companyId={activeCompanyId} onClose={() => setShowOverride(false)} />}
      </div>
    </AppShell>
  );
}
