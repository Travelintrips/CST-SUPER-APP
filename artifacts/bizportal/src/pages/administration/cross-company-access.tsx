import { DatePicker } from "@/components/ui/date-picker";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldAlert, ArrowRight, RefreshCw, Filter, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { BackButton } from "@/components/ui/back-button";

interface CrossCompanyRow {
  id: number;
  company_id: number | null;
  user_id: string | null;
  user_email: string | null;
  reference_id: string | null;
  new_data: {
    severity?: string;
    role?: string | null;
    sourceCompany?: number | null;
    targetCompany?: number | null;
    route?: string | null;
    method?: string | null;
    timestamp?: string | null;
  } | null;
  ip_address: string | null;
  created_at: string;
}

interface ApiResponse {
  rows: CrossCompanyRow[];
  total: number;
  limit: number;
  offset: number;
}

function formatDt(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function CrossCompanyAccessPage() {
  const today = new Date().toISOString().split("T")[0];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (userIdFilter.trim()) params.set("userId", userIdFilter.trim());
  params.set("limit", String(limit));
  params.set("offset", String(page * limit));

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ["cross-company-access", from, to, userIdFilter, page],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs/cross-company?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <AppShell>
      <BackButton href="/administration" />
      <div className="flex flex-col gap-6">
        <Button variant="ghost" size="sm" className="-ml-2 mt-6 mx-6" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Link href="/settings/workspace/audit-center" className="hover:underline">
                Administration
              </Link>
              <span>›</span>
              <span>Audit Center</span>
              <span>›</span>
              <span>Cross Company Access</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-500" />
              <h1 className="text-xl font-semibold">Cross Company Access</h1>
              <Badge variant="destructive" className="text-xs">HIGH SEVERITY</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Log setiap kali admin mengakses data perusahaan lain (company context switch).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end p-4 border rounded-lg bg-muted/30">
          <Filter className="h-4 w-4 text-muted-foreground self-center" />
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Dari Tanggal</Label>
            <DatePicker value={from} onChange={(v) => { setFrom(v); setPage(0); }} className="h-8 w-36 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Sampai Tanggal</Label>
            <DatePicker value={to} onChange={(v) => { setTo(v); setPage(0); }} className="h-8 w-36 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">User ID</Label>
            <Input
              placeholder="Filter user ID..."
              value={userIdFilter}
              onChange={(e) => { setUserIdFilter(e.target.value); setPage(0); }}
              className="h-8 w-48 text-sm"
            />
          </div>
          {(from || to || userIdFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="self-end text-xs"
              onClick={() => { setFrom(""); setTo(""); setUserIdFilter(""); setPage(0); }}
            >
              Reset Filter
            </Button>
          )}
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-red-500" />
          <span>Total event: <strong className="text-foreground">{total.toLocaleString("id-ID")}</strong></span>
          {total > 0 && (
            <span className="text-muted-foreground">
              · Halaman {page + 1} dari {totalPages}
            </span>
          )}
        </div>

        {/* Table */}
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-36 text-xs">Waktu</TableHead>
                <TableHead className="text-xs">User</TableHead>
                <TableHead className="text-xs">Role</TableHead>
                <TableHead className="text-xs">Perpindahan Company</TableHead>
                <TableHead className="text-xs">Route</TableHead>
                <TableHead className="text-xs">IP Address</TableHead>
                <TableHead className="text-xs">Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-destructive text-sm">
                    Gagal memuat data. Pastikan Anda login sebagai admin/owner.
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                    <ShieldAlert className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    Tidak ada cross-company access event ditemukan.
                    {(from || to || userIdFilter) && " Coba ubah filter."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const nd = row.new_data ?? {};
                  const src = nd.sourceCompany;
                  const tgt = nd.targetCompany;
                  return (
                    <TableRow key={row.id} className="hover:bg-red-50/30 dark:hover:bg-red-950/10">
                      <TableCell className="text-xs tabular-nums whitespace-nowrap">
                        {formatDt(row.created_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{row.user_email ?? "—"}</div>
                        {row.user_id && (
                          <div className="text-muted-foreground font-mono text-[10px]">
                            {row.user_id.slice(0, 12)}…
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {nd.role ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-700">
                            {nd.role}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px]">
                            Co.{src ?? "?"}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded text-[10px]">
                            Co.{tgt ?? "?"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px]">
                        <div className="flex items-center gap-1">
                          {nd.method && (
                            <span className="text-[9px] font-bold bg-slate-100 dark:bg-slate-800 px-1 rounded uppercase">
                              {nd.method}
                            </span>
                          )}
                          <span className="truncate font-mono text-[10px] text-muted-foreground" title={nd.route ?? ""}>
                            {nd.route ?? row.reference_id ?? "—"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {row.ip_address ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          HIGH
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Sebelumnya
            </Button>
            <span className="self-center text-sm text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya →
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
