import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, ShieldCheck, ShieldX, AlertTriangle, Clock, Layers,
  RefreshCw, LogIn, Lock, ArrowLeftRight, CheckCircle2, ArrowLeft,
} from "lucide-react";

const BASE = "/api/audit-logs";

async function apiFetch(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function fmtDt(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(iso));
}

interface OverviewData {
  rbacFailures: number;
  crossCompanyDenied: number;
  crossTenantDenied: number;
  financeOverrides: number;
  expiredTokens: number;
  failedLogins: number;
  since: string;
}

interface EventRow {
  id: number;
  created_at: string;
  action: string;
  module: string | null;
  user_email: string | null;
  user_id: string | null;
  company_id: number | null;
  ip_address: string | null;
  new_data: Record<string, unknown> | null;
}

interface EventsData {
  rows: EventRow[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_SEVERITY: Record<string, "high" | "warn" | "info" | "ok"> = {
  RBAC_LOOKUP_FAILED:                    "high",
  CROSS_COMPANY_RESOURCE_ACCESS_DENIED:  "high",
  CROSS_TENANT_RESOURCE_ACCESS_DENIED:   "high",
  PUBLIC_TOKEN_EXPIRED:                  "warn",
  FINANCE_OVERRIDE:                      "warn",
  LOGIN_FAILED:                          "warn",
  CROSS_COMPANY_RESOURCE_ACCESS_ALLOWED: "info",
  CROSS_TENANT_RESOURCE_ACCESS_ALLOWED:  "info",
  BULK_OPERATION_VERIFIED:               "ok",
  BULK_OPERATION_DENIED:                 "high",
};

function ActionBadge({ action }: { action: string }) {
  const sev = ACTION_SEVERITY[action] ?? "info";
  const cls = {
    high: "bg-red-100 text-red-800 border-red-200",
    warn: "bg-amber-100 text-amber-800 border-amber-200",
    info: "bg-blue-100 text-blue-800 border-blue-200",
    ok:   "bg-green-100 text-green-800 border-green-200",
  }[sev];
  const short = action.replace(/_/g, " ").replace(/RESOURCE ACCESS/g, "").replace(/OPERATION/g, "OP").trim();
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {short}
    </span>
  );
}

function StatCard({
  label, value, icon: Icon, color, loading,
}: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>; color: string; loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            {loading ? (
              <Skeleton className="h-8 w-12 mb-1" />
            ) : (
              <div className={`text-2xl font-bold ${value > 0 ? color : "text-muted-foreground"}`}>{value}</div>
            )}
            <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</div>
          </div>
          <div className={`rounded-lg p-2 ${value > 0 ? "bg-red-50 dark:bg-red-950" : "bg-muted"}`}>
            <Icon className={`h-4 w-4 ${value > 0 ? color : "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type Section = "high-severity" | "overrides" | "bulk-ops" | "timeline";

const SECTION_TABS: { key: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "high-severity", label: "High Severity", icon: ShieldX },
  { key: "overrides",     label: "Admin Overrides", icon: ShieldCheck },
  { key: "bulk-ops",      label: "Bulk Operations", icon: Layers },
  { key: "timeline",      label: "Security Timeline", icon: Clock },
];

function EventsTable({ section }: { section: Section }) {
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data, isLoading, isError, error, refetch } = useQuery<EventsData>({
    queryKey: ["security-events", section, page],
    queryFn: () =>
      apiFetch(`${BASE}/security/events?section=${section}&limit=${limit}&offset=${page * limit}`),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pb-2">
        <span className="text-xs text-muted-foreground">
          {isLoading ? "Memuat..." : `${total} event ditemukan`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7 gap-1 text-xs">
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      {isError && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {String(error)}
        </div>
      )}

      <div className="overflow-x-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs bg-muted/30">
              <TableHead className="w-36">Waktu</TableHead>
              <TableHead>Aksi</TableHead>
              <TableHead>Modul</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="w-20">Company</TableHead>
              <TableHead className="w-28">IP</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Tidak ada event untuk section ini
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id} className="text-xs align-top">
                <TableCell className="whitespace-nowrap font-mono text-[11px]">
                  {row.created_at ? fmtDt(row.created_at) : "—"}
                </TableCell>
                <TableCell>
                  <ActionBadge action={row.action} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.module ?? "—"}
                </TableCell>
                <TableCell className="max-w-[140px] truncate">
                  {row.user_email ?? row.user_id ?? "—"}
                </TableCell>
                <TableCell className="text-center">
                  {row.company_id != null ? (
                    <Badge variant="outline" className="text-[10px] px-1">
                      #{row.company_id}
                    </Badge>
                  ) : "—"}
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {row.ip_address ?? "—"}
                </TableCell>
                <TableCell className="max-w-[220px]">
                  {row.new_data ? (
                    <div className="space-y-0.5">
                      {!!(row.new_data.route || row.new_data.path) && (
                        <div className="truncate text-[11px] text-blue-600 font-mono">
                          {String(row.new_data.route ?? row.new_data.path ?? "")}
                        </div>
                      )}
                      {!!row.new_data.role && (
                        <span className="inline-flex items-center rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                          role: {String(row.new_data.role)}
                        </span>
                      )}
                      {!!row.new_data.severity && (
                        <span className="inline-flex items-center rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
                          {String(row.new_data.severity)}
                        </span>
                      )}
                      {!!row.new_data.module && (
                        <span className="inline-flex items-center rounded bg-purple-100 px-1 py-0.5 text-[10px] text-purple-700">
                          mod: {String(row.new_data.module)}
                        </span>
                      )}
                      {row.new_data.count != null && (
                        <span className="inline-flex items-center rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-700">
                          {String(row.new_data.count)} items
                        </span>
                      )}
                    </div>
                  ) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span>Hlm {page + 1} · {Math.ceil(total / limit)} total</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="h-7 text-xs">
              ← Prev
            </Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * limit >= total} onClick={() => setPage((p) => p + 1)} className="h-7 text-xs">
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SecurityCenterPage() {
  const { data: dbUser } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const role = (dbUser?.role as string) ?? "";
  const isSuperAdmin = role === "super_admin";

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery<OverviewData>({
    queryKey: ["security-overview"],
    queryFn: () => apiFetch(`${BASE}/security/overview`),
    enabled: ["admin", "owner", "super_admin"].includes(role),
    refetchInterval: 5 * 60 * 1000,
  });

  const [activeSection, setActiveSection] = useState<Section>("high-severity");

  const OVERVIEW_CARDS = [
    { label: "RBAC Failures (7h)", key: "rbacFailures",       icon: ShieldX,         color: "text-red-600" },
    { label: "Cross Company Denied", key: "crossCompanyDenied", icon: ArrowLeftRight, color: "text-red-500" },
    { label: "Cross Tenant Denied",  key: "crossTenantDenied",  icon: ShieldAlert,    color: "text-orange-600" },
    { label: "Finance Overrides",    key: "financeOverrides",   icon: AlertTriangle,  color: "text-amber-600" },
    { label: "Token Expired",        key: "expiredTokens",      icon: Lock,           color: "text-amber-500" },
    { label: "Login Gagal",          key: "failedLogins",       icon: LogIn,          color: "text-rose-500" },
  ] as const;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="px-6 pt-6">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
        </div>
        <PageHeader
          title="Security Center"
          description="Dashboard visibilitas keamanan ERP — RBAC failures, akses lintas perusahaan, admin overrides, dan bulk operations."
          breadcrumb={[
            { label: "Dashboard", href: "/" },
            { label: "Administration", href: "/settings" },
            { label: "Audit Center", href: "/settings/workspace/audit-center" },
            { label: "Security Center" },
          ]}
          favoriteEnabled
        />

        {/* ── Section A: Overview Cards ──────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Ringkasan 7 Hari Terakhir
            </h2>
            <Button size="sm" variant="ghost" onClick={() => refetchOverview()} className="h-7 gap-1 text-xs">
              <RefreshCw size={12} /> Refresh
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {OVERVIEW_CARDS.map(({ label, key, icon, color }) => (
              <StatCard
                key={key}
                label={label}
                value={overview?.[key] ?? 0}
                icon={icon}
                color={color}
                loading={overviewLoading}
              />
            ))}
          </div>
          {overview && (
            <p className="text-[11px] text-muted-foreground">
              Dihitung sejak {fmtDt(overview.since)}
            </p>
          )}
        </div>

        {/* ── Super Admin Only: Detail Sections ─────────────────────── */}
        {!isSuperAdmin ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
              <ShieldAlert className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">Detail event hanya tersedia untuk Super Admin</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Anda melihat ringkasan overview. Hubungi Super Admin untuk akses penuh.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Detail Event Keamanan</CardTitle>
                <Badge variant="destructive" className="text-[10px]">Super Admin Only</Badge>
              </div>
              {/* Tabs */}
              <div className="flex gap-1 flex-wrap border-b pt-3">
                {SECTION_TABS.map(({ key, label, icon: Icon }) => {
                  const isActive = activeSection === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveSection(key)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors ${
                        isActive
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {/* Section descriptions */}
              <div className="mb-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {activeSection === "high-severity" && (
                  <span>Event RBAC_LOOKUP_FAILED, CROSS_COMPANY_DENIED, CROSS_TENANT_DENIED, PUBLIC_TOKEN_EXPIRED, dan FINANCE_OVERRIDE.</span>
                )}
                {activeSection === "overrides" && (
                  <span>Admin override: CROSS_COMPANY_ALLOWED, CROSS_TENANT_ALLOWED, dan FINANCE_OVERRIDE — akses yang sengaja diizinkan melampaui batas normal.</span>
                )}
                {activeSection === "bulk-ops" && (
                  <span>BULK_OPERATION_VERIFIED dan BULK_OPERATION_DENIED — audit trail untuk operasi massal lintas modul.</span>
                )}
                {activeSection === "timeline" && (
                  <span>Semua event audit terbaru — 50 entri per halaman, urutan terbaru dahulu.</span>
                )}
              </div>
              <EventsTable key={activeSection} section={activeSection} />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
