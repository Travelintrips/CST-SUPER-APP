/**
 * QA Fixture Manager — BizPortal
 * ================================
 * Admin page for loading / resetting / removing the QA marketplace dataset.
 * Only visible in DEV (import.meta.env.PROD = false).
 * Backend has triple production guard — any prod indicator = HTTP 403.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  TestTube2, RefreshCw, Trash2, FileBarChart2, ShieldCheck,
  Upload, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Database, Server, Tag, Package, Users, Clock,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QaStatus {
  success: boolean;
  environment: string;
  nodeEnv: string;
  projectRef: string;
  isProduction: boolean;
  qaDatasetVersion: string;
  totalQaProducts: number;
  totalQaVendors: number;
  activePublished: number;
  categoryCount: number;
  lastSeed: string | null;
  lastReset: string | null;
  fixtureCount: number;
}

interface ValidationCheck {
  check: string;
  status: "PASS" | "FAIL" | "WARN";
  detail: string;
}

interface ValidationResult {
  success: boolean;
  overall: "PASS" | "FAIL" | "WARN";
  passed: number;
  failed: number;
  warned: number;
  checks: ValidationCheck[];
  validatedAt: string;
}

interface ReportSummary {
  total_qa_products: string;
  total_qa_vendors: string;
  products_without_image: string;
  products_without_price: string;
  active_published: string;
  stock_available: string;
  stock_on_order: string;
  stock_limited: string;
}

interface ReportResult {
  success: boolean;
  generatedAt: string;
  summary: ReportSummary;
  categories: Array<{ category: string; count: string }>;
  duplicateSku: Array<{ name: string; cnt: string }>;
  invalidRecords: Array<{ id: number; name: string; issue: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID") : "—";

const statusBadge = (s: "PASS" | "FAIL" | "WARN") => {
  if (s === "PASS")
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs font-mono">PASS</Badge>;
  if (s === "FAIL")
    return <Badge className="bg-red-100 text-red-800 border-red-200 text-xs font-mono">FAIL</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs font-mono">WARN</Badge>;
};

const overallIcon = (overall: "PASS" | "FAIL" | "WARN") => {
  if (overall === "PASS") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (overall === "FAIL") return <XCircle className="h-5 w-5 text-red-600" />;
  return <AlertTriangle className="h-5 w-5 text-amber-600" />;
};

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...opts });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? body?.message ?? `HTTP ${res.status}`);
  return body as T;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QaFixtureManagerPage() {
  const queryClient = useQueryClient();
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);

  // Status query
  const { data: status, isLoading: statusLoading, error: statusError, refetch: refetchStatus } =
    useQuery<QaStatus>({
      queryKey: ["qa-fixture-status"],
      queryFn: () => apiFetch("/api/admin/marketplace/qa/status"),
      staleTime: 10_000,
      retry: 1,
    });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const loadMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; message: string; inserted: number; skipped: number; total: number; alreadyLoaded: boolean }>(
        "/api/admin/marketplace/qa/load",
        { method: "POST", headers: { "Content-Type": "application/json" } },
      ),
    onSuccess: (data) => {
      toast({
        title: data.alreadyLoaded ? "⚡ Dataset Already Loaded" : "✅ Dataset Loaded",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["qa-fixture-status"] });
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "❌ Load Failed", description: err.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; message: string; updated: number }>(
        "/api/admin/marketplace/qa/reset",
        { method: "POST", headers: { "Content-Type": "application/json" } },
      ),
    onSuccess: (data) => {
      toast({ title: "🔄 Dataset Reset", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["qa-fixture-status"] });
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "❌ Reset Failed", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; message: string; removed: number }>(
        "/api/admin/marketplace/qa/remove",
        { method: "DELETE" },
      ),
    onSuccess: (data) => {
      toast({ title: "🗑️ Dataset Removed", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["qa-fixture-status"] });
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "❌ Remove Failed", description: err.message, variant: "destructive" });
    },
  });

  const validateMutation = useMutation({
    mutationFn: () =>
      apiFetch<ValidationResult>("/api/admin/marketplace/qa/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (data) => {
      setValidationResult(data);
      toast({
        title: data.overall === "PASS"
          ? "✅ Validation Passed"
          : data.overall === "WARN"
          ? "⚠️ Validation Warnings"
          : "❌ Validation Failed",
        description: `${data.passed} pass, ${data.failed} fail, ${data.warned} warn`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "❌ Validation Error", description: err.message, variant: "destructive" });
    },
  });

  const reportMutation = useMutation({
    mutationFn: () => apiFetch<ReportResult>("/api/admin/marketplace/qa/report"),
    onSuccess: (data) => {
      setReportResult(data);
      toast({ title: "📊 Report Generated", description: `As of ${fmt(data.generatedAt)}` });
    },
    onError: (err: Error) => {
      toast({ title: "❌ Report Error", description: err.message, variant: "destructive" });
    },
  });

  const anyLoading =
    loadMutation.isPending ||
    resetMutation.isPending ||
    removeMutation.isPending ||
    validateMutation.isPending ||
    reportMutation.isPending;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-100 rounded-lg">
            <TestTube2 className="h-6 w-6 text-violet-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">QA Fixture Manager</h1>
            <p className="text-sm text-gray-500">
              Kelola dataset QA untuk Marketplace — load, reset, dan remove tanpa SQL.
            </p>
          </div>
          <Badge className="ml-auto bg-violet-100 text-violet-800 border-violet-200">
            DEV ONLY
          </Badge>
        </div>

        {/* Status Error */}
        {statusError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              {(statusError as Error).message.includes("disabled in Production")
                ? "🔒 QA Fixture Manager dinonaktifkan di environment Production."
                : `Gagal load status: ${(statusError as Error).message}`}
            </AlertDescription>
          </Alert>
        )}

        {/* Environment Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-gray-500" />
              Environment Info
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : status ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Environment</p>
                  <p className="font-mono text-sm font-medium mt-1">{status.environment}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Node Env</p>
                  <p className="font-mono text-sm font-medium mt-1">{status.nodeEnv}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">DB Project Ref</p>
                  <p className="font-mono text-xs font-medium mt-1 truncate">{status.projectRef}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Dataset Version</p>
                  <p className="font-mono text-sm font-medium mt-1">{status.qaDatasetVersion}</p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Dataset Stats Card */}
        {status && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-gray-500">
                  <Package className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wide">QA Products</span>
                </div>
                <p className="text-3xl font-bold mt-2">{status.totalQaProducts}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {status.activePublished} aktif & published
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-gray-500">
                  <Users className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wide">QA Vendors</span>
                </div>
                <p className="text-3xl font-bold mt-2">{status.totalQaVendors}</p>
                <p className="text-xs text-gray-400 mt-1">vendor aktif</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-gray-500">
                  <Tag className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wide">Kategori</span>
                </div>
                <p className="text-3xl font-bold mt-2">{status.categoryCount}</p>
                <p className="text-xs text-gray-400 mt-1">dari 7 target</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-gray-500">
                  <Database className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wide">Fixture Slots</span>
                </div>
                <p className="text-3xl font-bold mt-2">{status.fixtureCount}</p>
                <p className="text-xs text-gray-400 mt-1">definisi di fixture</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Last Actions */}
        {status && (
          <div className="flex gap-6 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              <span>Last Seed: <span className="text-gray-800 font-medium">{fmt(status.lastSeed)}</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              <span>Last Reset: <span className="text-gray-800 font-medium">{fmt(status.lastReset)}</span></span>
            </div>
          </div>
        )}

        <Separator />

        {/* Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Load */}
          <Card className="border-emerald-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-emerald-700">
                <Upload className="h-4 w-4" /> Load QA Dataset
              </CardTitle>
              <CardDescription className="text-xs">
                Insert semua {status?.fixtureCount ?? 14} fixture items. Idempotent — tidak duplicate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadMutation.data && (
                <div className="mb-3 p-2 rounded bg-emerald-50 text-xs text-emerald-700">
                  {loadMutation.data.message}
                </div>
              )}
              {loadMutation.isError && (
                <div className="mb-3 p-2 rounded bg-red-50 text-xs text-red-700">
                  {(loadMutation.error as Error).message}
                </div>
              )}
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                onClick={() => loadMutation.mutate()}
                disabled={anyLoading}
              >
                {loadMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" /> Load Dataset</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Reset */}
          <Card className="border-amber-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                <RefreshCw className="h-4 w-4" /> Reset QA Dataset
              </CardTitle>
              <CardDescription className="text-xs">
                Kembalikan semua QA items ke kondisi fixture awal (harga, media, status).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {resetMutation.data && (
                <div className="mb-3 p-2 rounded bg-amber-50 text-xs text-amber-700">
                  {resetMutation.data.message}
                </div>
              )}
              {resetMutation.isError && (
                <div className="mb-3 p-2 rounded bg-red-50 text-xs text-red-700">
                  {(resetMutation.error as Error).message}
                </div>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="w-full border-amber-300 text-amber-700 hover:bg-amber-50" disabled={anyLoading}>
                    {resetMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Resetting…</>
                    ) : (
                      <><RefreshCw className="h-4 w-4 mr-2" /> Reset Dataset</>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset QA Dataset?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Semua item QA akan dikembalikan ke kondisi awal fixture. Perubahan manual (harga, foto, status) akan hilang. Data non-QA tidak terpengaruh.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-amber-600 hover:bg-amber-700"
                      onClick={() => resetMutation.mutate()}
                    >
                      Ya, Reset
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* Remove */}
          <Card className="border-red-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                <Trash2 className="h-4 w-4" /> Remove QA Dataset
              </CardTitle>
              <CardDescription className="text-xs">
                Hapus permanen semua QA items (fixture_source=&apos;qa&apos;). Data asli aman.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {removeMutation.data && (
                <div className="mb-3 p-2 rounded bg-red-50 text-xs text-red-700">
                  {removeMutation.data.message}
                </div>
              )}
              {removeMutation.isError && (
                <div className="mb-3 p-2 rounded bg-red-50 text-xs text-red-700">
                  {(removeMutation.error as Error).message}
                </div>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full" disabled={anyLoading}>
                    {removeMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Removing…</>
                    ) : (
                      <><Trash2 className="h-4 w-4 mr-2" /> Remove Dataset</>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus QA Dataset?</AlertDialogTitle>
                    <AlertDialogDescription>
                      <strong>{status?.totalQaProducts ?? 0} QA items</strong> akan dihapus permanen. Hanya item dengan marker <code>fixture_source=&apos;qa&apos;</code> yang dihapus — data produksi tidak terpengaruh.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={() => removeMutation.mutate()}
                    >
                      Ya, Hapus Semua
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>

        {/* Validate + Report buttons */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            className="flex-1 border-violet-300 text-violet-700 hover:bg-violet-50"
            onClick={() => validateMutation.mutate()}
            disabled={anyLoading}
          >
            {validateMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Validating…</>
            ) : (
              <><ShieldCheck className="h-4 w-4 mr-2" /> Validate Dataset</>
            )}
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-50"
            onClick={() => reportMutation.mutate()}
            disabled={anyLoading}
          >
            {reportMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating…</>
            ) : (
              <><FileBarChart2 className="h-4 w-4 mr-2" /> Show Dataset Report</>
            )}
          </Button>
        </div>

        {/* Validation Result */}
        {validationResult && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {overallIcon(validationResult.overall)}
                Validation Result — {validationResult.overall}
                <span className="ml-auto text-xs text-gray-400 font-normal">
                  {fmt(validationResult.validatedAt)}
                </span>
              </CardTitle>
              <CardDescription>
                {validationResult.passed} PASS · {validationResult.failed} FAIL · {validationResult.warned} WARN
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {validationResult.checks.map((check, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 p-2 rounded-lg bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{check.check}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>
                    </div>
                    {statusBadge(check.status)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Report Result */}
        {reportResult && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileBarChart2 className="h-5 w-5 text-blue-600" />
                Dataset Report
                <span className="ml-auto text-xs text-gray-400 font-normal">
                  {fmt(reportResult.generatedAt)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Total Products", value: reportResult.summary.total_qa_products },
                  { label: "Active+Published", value: reportResult.summary.active_published },
                  { label: "Without Image", value: reportResult.summary.products_without_image },
                  { label: "Without Price", value: reportResult.summary.products_without_price },
                  { label: "Total Vendors", value: reportResult.summary.total_qa_vendors },
                  { label: "Stock Available", value: reportResult.summary.stock_available },
                  { label: "Stock On Order", value: reportResult.summary.stock_on_order },
                  { label: "Stock Limited", value: reportResult.summary.stock_limited },
                ].map((item) => (
                  <div key={item.label} className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{item.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{item.label}</p>
                  </div>
                ))}
              </div>

              {/* Categories */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Categories</p>
                <div className="flex flex-wrap gap-2">
                  {reportResult.categories.map((cat) => (
                    <Badge key={cat.category} variant="outline" className="text-xs">
                      {cat.category || "(no category)"} × {cat.count}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Duplicates */}
              {reportResult.duplicateSku.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Duplicate names:</strong>{" "}
                    {reportResult.duplicateSku.map((d) => `"${d.name}" (${d.cnt}×)`).join(", ")}
                  </AlertDescription>
                </Alert>
              )}

              {/* Invalid records */}
              {reportResult.invalidRecords.length > 0 && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{reportResult.invalidRecords.length} invalid record(s):</strong>{" "}
                    {reportResult.invalidRecords
                      .map((r) => `id=${r.id} "${r.name}" (${r.issue})`)
                      .join("; ")}
                  </AlertDescription>
                </Alert>
              )}

              {reportResult.duplicateSku.length === 0 && reportResult.invalidRecords.length === 0 && (
                <Alert className="border-emerald-200 bg-emerald-50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-emerald-700">
                    Tidak ada duplicate SKU atau invalid record.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
