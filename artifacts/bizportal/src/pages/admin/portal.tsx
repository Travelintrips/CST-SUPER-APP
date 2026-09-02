import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Building2, Truck, CheckCircle2, Clock, XCircle,
  RefreshCw, Search, AlertCircle,
  MessageCircle, Mail, ArrowRight, Loader2,
  ShieldCheck, UserCheck, BarChart3, Pencil, Eye, Ban,
  Link2, Copy, ExternalLink, RotateCcw, FileText, ClipboardList,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { CustomerPortalWorkload } from "@/components/admin/CustomerPortalWorkload";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApprovalStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

interface CustomerStats {
  total: number;
  wa: number;
  customer: number;
  vendor: number;
  profileIncomplete: number;
  profilePending: number;
  profileActive: number;
}

interface CustomerItem {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string;
  accountStatus: "active" | "inactive" | "sanctioned";
  sanctionReason: string | null;
  sanctionUntil: string | null;
  source: "wa" | "oauth" | "email";
  createdAt: string;
  profileStatus: string;
  profileAccountType: string | null;
  profileFullName: string | null;
  profileAddress: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function sourceBadge(source: string) {
  if (source === "wa")
    return <Badge variant="outline" className="gap-1 text-xs border-green-300 text-green-700 bg-green-50"><MessageCircle className="h-3 w-3" />WhatsApp</Badge>;
  if (source === "oauth")
    return <Badge variant="outline" className="gap-1 text-xs border-blue-300 text-blue-700 bg-blue-50"><ShieldCheck className="h-3 w-3" />Google</Badge>;
  return <Badge variant="outline" className="gap-1 text-xs"><Mail className="h-3 w-3" />Email</Badge>;
}

function profileStatusBadge(s: string) {
  if (s === "active")
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Aktif</Badge>;
  if (s === "pending")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">Pending</Badge>;
  if (s === "incomplete")
    return <Badge variant="outline" className="text-xs text-orange-600 border-orange-200">Incomplete</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Belum mulai</Badge>;
}

function roleBadge(role: string) {
  const map: Record<string, string> = {
    vendor: "bg-blue-100 text-blue-800 border-blue-200",
    driver: "bg-orange-100 text-orange-800 border-orange-200",
    employee: "bg-purple-100 text-purple-800 border-purple-200",
    customer: "bg-gray-100 text-gray-700 border-gray-200",
    admin: "bg-red-100 text-red-800 border-red-200",
  };
  return <Badge className={`text-xs ${map[role] ?? "bg-gray-100 text-gray-700"}`}>{role}</Badge>;
}

function accountStatusBadge(status: string) {
  if (status === "sanctioned") {
    return <Badge className="gap-1 bg-red-100 text-red-800 border-red-200 text-xs"><Ban className="h-3 w-3" />Sanksi</Badge>;
  }
  if (status === "inactive") {
    return <Badge variant="outline" className="text-xs text-slate-600 border-slate-300">Nonaktif</Badge>;
  }
  return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Aktif</Badge>;
}

// ── Unified Vendor Requests Tab ───────────────────────────────────────────────

interface VendorRequestItem {
  source_type: string;
  source_id: string;
  request_number: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_company: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  raw_service_type: string | null;
  service_key: string;
  request_status: string | null;
  quote_status: string | null;
  raw_status: string | null;
  quotation_number: string | null;
  quote_amount: string | number | null;
  quote_notes: string | null;
  request_notes: string | null;
  created_at: string;
  invited_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  expires_at: string | null;
  token_available: boolean;
  is_expired: boolean;
}

const SERVICE_LABELS: Record<string, string> = {
  trucking: "Jasa Trucking",
  domestic: "Domestic",
  sea_freight: "Sea Freight / Ocean",
  air_freight: "Air Freight",
  custom_clearance: "Custom Clearance",
  customs: "Kepabeanan",
  marketplace: "Marketplace / Produk",
  other: "Layanan lain",
};

const SOURCE_LABELS: Record<string, string> = {
  portal_invitation: "Undangan Vendor",
  logistic_rfq: "Logistik RFQ",
  air_freight_rfq: "Air Freight RFQ",
  ocean_freight_rfq: "Ocean Freight RFQ",
  ppjk_order: "PPJK assignment",
  marketplace_quote: "Marketplace quotation",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  portal_invitation: "Vendor Assignment",
  logistic_rfq: "RFQ Vendor",
  air_freight_rfq: "RFQ Vendor",
  ocean_freight_rfq: "RFQ Vendor",
  ppjk_order: "Vendor Assignment",
  marketplace_quote: "RFQ Vendor",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  waiting_response: "Menunggu respons",
  invited: "Diundang",
  opened: "Dibuka",
  submitted: "Terkirim",
  accepted: "Diterima",
  selected: "Dipilih",
  rejected: "Ditolak",
  expired: "Expired",
  withdrawn: "Ditarik",
  quote_received: "Quotation masuk",
  open: "Terbuka",
  sent: "Terkirim",
  draft: "Draft",
  waiting_documents: "Menunggu dokumen",
  document_review: "Review dokumen",
  submitted_ceisa: "Terkirim ke CEISA",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const TOKEN_LINK_SOURCES = new Set([
  "portal_invitation",
  "logistic_rfq",
  "air_freight_rfq",
  "ocean_freight_rfq",
  "marketplace_quote",
]);

function requestStatusBadge(status: string | null | undefined, expired: boolean) {
  const value = expired ? "expired" : status || "unknown";
  const color =
    value === "expired" || value === "rejected"
      ? "bg-red-100 text-red-800 border-red-200"
      : value === "submitted" || value === "accepted" || value === "selected"
        ? "bg-green-100 text-green-800 border-green-200"
        : value === "opened"
          ? "bg-blue-100 text-blue-800 border-blue-200"
          : "bg-amber-100 text-amber-800 border-amber-200";
  return <Badge className={`text-xs ${color}`}>{STATUS_LABELS[value] ?? value}</Badge>;
}

function VendorRequestsTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("all");
  const [linkStatus, setLinkStatus] = useState("all");
  const [selected, setSelected] = useState<VendorRequestItem | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ limit: "50" });
  if (debouncedSearch) params.set("q", debouncedSearch);
  if (service !== "all") params.set("service", service);
  if (status !== "all") params.set("status", status);
  if (linkStatus !== "all") params.set("linkStatus", linkStatus);
  const queryString = params.toString();

  const { data, isLoading, error, refetch } = useQuery<{
    items: VendorRequestItem[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ["admin-vendor-service-requests", queryString],
    queryFn: async () => {
      const response = await fetch(`/api/portal/admin/vendor-service-requests?${queryString}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    staleTime: 15_000,
  });

  const getLink = async (item: VendorRequestItem) => {
    const response = await fetch(
      `/api/portal/admin/vendor-service-requests/${item.source_type}/${item.source_id}/access-link`,
      { method: "POST", credentials: "include" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Link tidak tersedia");
    return body as { url: string; expiresAt: string | null };
  };

  const handleCopy = async (item: VendorRequestItem) => {
    try {
      const link = await getLink(item);
      await navigator.clipboard.writeText(link.url);
      toast({ title: "Link disalin", description: "Token hanya dikembalikan untuk aksi admin ini." });
    } catch (e) {
      toast({ title: "Link tidak tersedia", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleOpen = async (item: VendorRequestItem) => {
    try {
      const link = await getLink(item);
      window.open(link.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ title: "Link tidak tersedia", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleRegenerate = async (item: VendorRequestItem) => {
    if (!window.confirm(`Buat ulang link ${item.request_number}? Link lama akan langsung tidak berlaku.`)) return;
    const key = `${item.source_type}:${item.source_id}`;
    setRegenerating(key);
    try {
      const response = await fetch(
        `/api/portal/admin/vendor-service-requests/${item.source_type}/${item.source_id}/regenerate`,
        { method: "POST", credentials: "include" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Gagal membuat ulang link");
      await navigator.clipboard.writeText(body.url);
      toast({ title: "Link dibuat ulang dan disalin", description: "Link lama sudah diinvalidate." });
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-service-requests"] });
    } catch (e) {
      toast({ title: "Regenerate gagal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRegenerating(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-slate-50/70 p-3 text-xs text-muted-foreground flex gap-2 items-start">
        <ShieldCheck className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
        <span>Daftar ini menggabungkan request vendor dari semua alur portal. Token mentah tidak pernah dikirim pada list/detail; token hanya diberikan saat Admin menekan Salin atau Buka.</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari request, customer, vendor, layanan…"
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="h-9 w-[190px] text-sm"><SelectValue placeholder="Layanan" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua layanan</SelectItem>
            {Object.entries(SERVICE_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-[155px] text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={linkStatus} onValueChange={setLinkStatus}>
          <SelectTrigger className="h-9 w-[145px] text-sm"><SelectValue placeholder="Link" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua link</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="missing">Tidak tersedia</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
        {data && <span className="text-xs text-muted-foreground ml-auto">{data.total} request</span>}
      </div>

      {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
              <TableHead className="text-xs">Tanggal</TableHead>
              <TableHead className="text-xs">Nomor Request</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Vendor</TableHead>
              <TableHead className="text-xs">Kontak</TableHead>
                  <TableHead className="text-xs">Layanan</TableHead>
              <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Masa berlaku</TableHead>
              <TableHead className="text-xs">Lifecycle</TableHead>
                  <TableHead className="text-xs text-right">Aksi link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                ) : !data?.items.length ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">Tidak ada request vendor yang cocok.</TableCell></TableRow>
                ) : data.items.map((item) => {
                  const key = `${item.source_type}:${item.source_id}`;
                  const expires = item.expires_at ? fmt(item.expires_at) : "Tanpa batas";
                  return (
                    <TableRow key={key} className="text-sm align-top">
                      <TableCell>
                    <div className="text-xs">{fmt(item.created_at)}</div>
                  </TableCell>
                  <TableCell>
                        <div className="font-mono text-xs font-medium">{item.request_number}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{SOURCE_LABELS[item.source_type] ?? item.source_type}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{item.customer_name || item.customer_company || "—"}</div>
                        {item.customer_email && <div className="text-[11px] text-muted-foreground">{item.customer_email}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{item.vendor_name || "Open RFQ"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">{item.vendor_phone || item.vendor_email || "—"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{SERVICE_LABELS[item.service_key] ?? item.raw_service_type ?? "Layanan lain"}</div>
                        {item.raw_service_type && item.raw_service_type !== SERVICE_LABELS[item.service_key] && <div className="text-[11px] text-muted-foreground">{item.raw_service_type}</div>}
                      </TableCell>
                      <TableCell>
                        {requestStatusBadge(item.quote_status || item.request_status, item.is_expired)}
                        <div className="text-[11px] text-muted-foreground mt-1">{item.quotation_number || "Belum ada nomor quotation"}</div>
                      </TableCell>
                      <TableCell>
                        <div className={`text-xs ${item.is_expired ? "text-red-600 font-medium" : "text-muted-foreground"}`}>{item.is_expired ? "Expired" : expires}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{item.token_available ? "Token tersedia" : "Token tidak tersedia"}</div>
                      </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      {LIFECYCLE_LABELS[item.source_type] ?? item.source_type}
                    </Badge>
                  </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setSelected(item)}><FileText className="h-3.5 w-3.5 mr-1" />Detail</Button>
                          {item.token_available && !item.is_expired ? (
                            <>
                              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => handleCopy(item)}><Copy className="h-3.5 w-3.5 mr-1" />Salin</Button>
                              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => handleOpen(item)}><ExternalLink className="h-3.5 w-3.5" /></Button>
                            </>
                          ) : null}
                          {TOKEN_LINK_SOURCES.has(item.source_type) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              disabled={regenerating === key}
                              onClick={() => handleRegenerate(item)}
                              title="Invalidate link lama dan buat link baru"
                            >
                              {regenerating === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                              <span className="hidden xl:inline">Regenerate</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" />Detail request vendor</DialogTitle>
                <DialogDescription>{selected.request_number} · {SOURCE_LABELS[selected.source_type] ?? selected.source_type}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Customer</div><div className="font-medium">{selected.customer_name || "—"}</div><div className="text-xs text-muted-foreground">{selected.customer_company || selected.customer_email || "—"}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Vendor</div><div className="font-medium">{selected.vendor_name || "Open RFQ"}</div><div className="text-xs text-muted-foreground">{selected.vendor_phone || selected.vendor_email || "—"}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Layanan</div><div className="font-medium">{SERVICE_LABELS[selected.service_key] ?? selected.raw_service_type ?? "Layanan lain"}</div><div className="text-xs text-muted-foreground">raw: {selected.raw_service_type || "—"}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Status sumber</div><div className="mt-1">{requestStatusBadge(selected.raw_status, selected.is_expired)}</div><div className="text-xs text-muted-foreground mt-1">sourceType: {selected.source_type}</div>{selected.source_type === "ppjk_order" && <div className="text-xs text-amber-700 mt-1">Assignment internal; tidak memakai link vendor.</div>}</div>
                <div className="rounded-md border p-3 sm:col-span-2"><div className="text-xs text-muted-foreground">Quotation</div><div className="font-medium">{selected.quotation_number || "Belum ada nomor quotation"}</div><div className="text-xs text-muted-foreground">{selected.quote_notes || "Belum ada catatan quotation."}</div></div>
                <div className="rounded-md border p-3 sm:col-span-2"><div className="text-xs text-muted-foreground">Catatan request</div><div>{selected.request_notes || "Tidak ada catatan request."}</div></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>
                {TOKEN_LINK_SOURCES.has(selected.source_type) ? (
                  <Button onClick={() => handleCopy(selected)} disabled={!selected.token_available}><Copy className="h-4 w-4 mr-2" />Salin link</Button>
                ) : (
                  <span className="text-xs text-muted-foreground self-center">Tidak ada link vendor pada lifecycle ini</span>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Stats Cards ───────────────────────────────────────────────────────────────

function ApprovalStatsCard() {
  const { data, isLoading } = useQuery<ApprovalStats>({
    queryKey: ["admin-approval-stats"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/approvals/stats", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" />
          Approval Onboarding
        </CardTitle>
        <CardDescription className="text-xs">Status permohonan akun vendor / driver / karyawan</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Memuat…</div>
        ) : data ? (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Total", value: data.total, icon: <BarChart3 className="h-4 w-4 text-muted-foreground" /> },
              { label: "Pending", value: data.pending, icon: <Clock className="h-4 w-4 text-amber-500" />, highlight: data.pending > 0 ? "text-amber-600 font-bold" : "" },
              { label: "Disetujui", value: data.approved, icon: <CheckCircle2 className="h-4 w-4 text-green-500" /> },
              { label: "Ditolak", value: data.rejected, icon: <XCircle className="h-4 w-4 text-red-500" /> },
            ].map(({ label, value, icon, highlight }) => (
              <div key={label} className="text-center space-y-1">
                <div className="flex justify-center">{icon}</div>
                <div className={`text-2xl font-semibold ${highlight ?? ""}`}>{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-4 pt-3 border-t">
          <Link href="/portal/onboarding-approvals">
            <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
              Kelola Approvals <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerStatsCard() {
  const { data, isLoading } = useQuery<CustomerStats>({
    queryKey: ["admin-customer-stats"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/customers/stats", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Pelanggan Portal
        </CardTitle>
        <CardDescription className="text-xs">Total pengguna terdaftar di Customer Portal</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Memuat…</div>
        ) : data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="space-y-1">
                <div className="text-2xl font-semibold">{data.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div className="space-y-1">
                <div className="text-2xl font-semibold text-blue-600">{data.vendor}</div>
                <div className="text-xs text-muted-foreground">Vendor</div>
              </div>
              <div className="space-y-1">
                <div className="text-2xl font-semibold text-green-600">{data.customer}</div>
                <div className="text-xs text-muted-foreground">Customer</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1 border-t">
              <div>
                <div className="font-medium text-green-600">{data.profileActive}</div>
                <div className="text-muted-foreground">Profil Aktif</div>
              </div>
              <div>
                <div className="font-medium text-amber-600">{data.profilePending}</div>
                <div className="text-muted-foreground">Pending</div>
              </div>
              <div>
                <div className="font-medium text-orange-600">{data.profileIncomplete}</div>
                <div className="text-muted-foreground">Incomplete</div>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Customers Tab ─────────────────────────────────────────────────────────────

function CustomersTab() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<CustomerItem | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", role: "customer",
    accountStatus: "active" as CustomerItem["accountStatus"],
    sanctionReason: "", sanctionUntil: "",
  });
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  // Clean up debounce timer on unmount
  useEffect(() => () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); }, []);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const params = new URLSearchParams();
  if (roleFilter !== "all") params.set("role", roleFilter);
  if (statusFilter !== "all") params.set("accountStatus", statusFilter);
  if (debouncedSearch) params.set("q", debouncedSearch);
  const qs = params.toString();

  const { data, isLoading, error, refetch } = useQuery<{ items: CustomerItem[]; total: number }>({
    queryKey: ["admin-customers", qs],
    queryFn: async () => {
      const r = await fetch(`/api/portal/admin/customers${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Akun belum dipilih");
      if (form.accountStatus === "sanctioned" && !form.sanctionReason.trim()) {
        throw new Error("Alasan sanksi wajib diisi");
      }
      const r = await fetch(`/api/portal/admin/customers/${selected.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          company: form.company || null,
          role: form.role,
          accountStatus: form.accountStatus,
          sanctionReason: form.sanctionReason || null,
          sanctionUntil: form.sanctionUntil || null,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || body.message || "Gagal menyimpan akun");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-customer-stats"] });
      toast({ title: "Perubahan akun tersimpan" });
      setSelected(null);
    },
    onError: (err: Error) => toast({ title: "Gagal menyimpan", description: err.message, variant: "destructive" }),
  });

  const openCustomer = (customer: CustomerItem) => {
    setSelected(customer);
    setForm({
      name: customer.name ?? customer.profileFullName ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      company: customer.company ?? "",
      role: customer.role ?? "customer",
      accountStatus: customer.accountStatus ?? "active",
      sanctionReason: customer.sanctionReason ?? "",
      sanctionUntil: customer.sanctionUntil ? customer.sanctionUntil.slice(0, 10) : "",
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari nama, email, telepon, perusahaan…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Role</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
            <SelectItem value="driver">Driver</SelectItem>
            <SelectItem value="employee">Karyawan</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[145px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="inactive">Nonaktif</SelectItem>
            <SelectItem value="sanctioned">Sanksi</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        {data && (
          <span className="text-xs text-muted-foreground ml-auto">{data.total} pelanggan</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">{String(error)}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Nama / Email</TableHead>
                  <TableHead className="text-xs">Telepon</TableHead>
                  <TableHead className="text-xs">Perusahaan</TableHead>
                  <TableHead className="text-xs">Role</TableHead>
                  <TableHead className="text-xs">Sumber</TableHead>
                  <TableHead className="text-xs">Status Profil</TableHead>
                  <TableHead className="text-xs">Tipe Akun</TableHead>
                  <TableHead className="text-xs">Status Akun</TableHead>
                  <TableHead className="text-xs">Daftar</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">
                      Tidak ada data yang ditemukan
                    </TableCell>
                  </TableRow>
                ) : data?.items.map((c) => (
                  <TableRow key={c.id} className="text-sm">
                    <TableCell>
                      <div className="font-medium">{c.name || c.profileFullName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.phone || "—"}</TableCell>
                    <TableCell className="text-xs">{c.company || "—"}</TableCell>
                    <TableCell>{roleBadge(c.role)}</TableCell>
                    <TableCell>{sourceBadge(c.source)}</TableCell>
                    <TableCell>{profileStatusBadge(c.profileStatus)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.profileAccountType || "—"}</TableCell>
                   <TableCell>{accountStatusBadge(c.accountStatus)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(c.createdAt)}</TableCell>
                   <TableCell className="text-right">
                     <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openCustomer(c)}>
                       <Eye className="h-3.5 w-3.5" /> Lihat / Ubah
                     </Button>
                   </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-primary" /> Kelola Akun Portal
                </DialogTitle>
                <DialogDescription>
                  Perubahan berlaku pada login Customer Portal. Data transaksi akun tidak dihapus.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="rounded-lg border bg-muted/30 p-3 grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-xs text-muted-foreground">Sumber akun</div>{sourceBadge(selected.source)}</div>
                  <div><div className="text-xs text-muted-foreground">Terdaftar</div><div>{fmt(selected.createdAt)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Status profil</div>{profileStatusBadge(selected.profileStatus)}</div>
                  <div><div className="text-xs text-muted-foreground">Tipe akun</div><div>{selected.profileAccountType || "—"}</div></div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="portal-account-name">Nama</Label>
                    <Input id="portal-account-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="portal-account-email">Email</Label>
                    <Input id="portal-account-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="portal-account-phone">Telepon / WhatsApp</Label>
                    <Input id="portal-account-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="portal-account-company">Perusahaan</Label>
                    <Input id="portal-account-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Role Portal</Label>
                    <Select value={form.role} onValueChange={(role) => setForm({ ...form, role })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="vendor">Vendor</SelectItem>
                        <SelectItem value="driver">Driver</SelectItem>
                        <SelectItem value="employee">Karyawan</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Status Akun</Label>
                    <Select value={form.accountStatus} onValueChange={(accountStatus: CustomerItem["accountStatus"]) => setForm({ ...form, accountStatus })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Aktif — dapat login</SelectItem>
                        <SelectItem value="inactive">Nonaktif — login ditolak</SelectItem>
                        <SelectItem value="sanctioned">Sanksi — login ditolak</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="portal-account-reason">
                    {form.accountStatus === "sanctioned" ? "Alasan sanksi *" : "Catatan status (opsional)"}
                  </Label>
                  <Textarea
                    id="portal-account-reason"
                    value={form.sanctionReason}
                    onChange={(e) => setForm({ ...form, sanctionReason: e.target.value })}
                    placeholder="Contoh: dokumen tidak valid, pelanggaran kebijakan, atau permintaan penonaktifan."
                  />
                </div>
                {form.accountStatus === "sanctioned" && (
                  <div className="grid gap-1.5 max-w-xs">
                    <Label htmlFor="portal-sanction-until">Sanksi berakhir (opsional)</Label>
                    <Input id="portal-sanction-until" type="date" value={form.sanctionUntil} onChange={(e) => setForm({ ...form, sanctionUntil: e.target.value })} />
                  </div>
                )}

                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-medium mb-2">Ringkasan profil</div>
                  <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1 text-muted-foreground">
                    <div>Nama profil: <span className="text-foreground">{selected.profileFullName || "—"}</span></div>
                    <div>Alamat: <span className="text-foreground">{selected.profileAddress || "—"}</span></div>
                  </div>
                  {selected.sanctionReason && (
                    <div className="mt-2 text-xs text-red-700">Sanksi sebelumnya: {selected.sanctionReason}</div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>Batal</Button>
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Menyimpan…" : "Simpan Perubahan"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPortalPage() {
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "overview";
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "vendors" || tab === "workload" ? tab : "overview";
  });

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Admin Portal
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Kelola pelanggan, approvals, dan seluruh link request vendor portal
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full max-w-xl">
            <TabsTrigger value="overview" className="gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="workload" className="gap-1.5 text-xs">
              <ClipboardList className="h-3.5 w-3.5" /> Workload
            </TabsTrigger>
            <TabsTrigger value="customers" className="gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" /> Pelanggan
            </TabsTrigger>
            <TabsTrigger value="vendors" className="gap-1.5 text-xs">
              <Link2 className="h-3.5 w-3.5" /> Undang Vendor
            </TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="mt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ApprovalStatsCard />
              <CustomerStatsCard />
            </div>

            {/* Quick Links */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wide">
                  Aksi Cepat
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Link href="/portal/onboarding-approvals">
                    <Button variant="outline" className="w-full justify-start gap-3 h-auto py-3">
                      <div className="p-1.5 bg-amber-100 rounded">
                        <UserCheck className="h-4 w-4 text-amber-600" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium">Kelola Approvals</div>
                        <div className="text-xs text-muted-foreground">Setujui / tolak permohonan vendor & driver</div>
                      </div>
                      <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
                    </Button>
                  </Link>
                  <Link href="/admin/db-sync">
                    <Button variant="outline" className="w-full justify-start gap-3 h-auto py-3">
                      <div className="p-1.5 bg-blue-100 rounded">
                        <Building2 className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium">Sinkronisasi Database</div>
                        <div className="text-xs text-muted-foreground">Sync data antara dev dan produksi</div>
                      </div>
                      <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
                    </Button>
                  </Link>
                  <Link href="/admin/portal?tab=customers">
                    <Button variant="outline" className="w-full justify-start gap-3 h-auto py-3">
                      <div className="p-1.5 bg-green-100 rounded">
                        <Users className="h-4 w-4 text-green-600" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium">Daftar Pelanggan</div>
                        <div className="text-xs text-muted-foreground">Semua pengguna portal & status onboarding</div>
                      </div>
                      <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workload" className="mt-6">
            <CustomerPortalWorkload />
          </TabsContent>

          {/* ── Customers ── */}
          <TabsContent value="customers" className="mt-6">
            <CustomersTab />
          </TabsContent>

          {/* ── Unified vendor requests ── */}
          <TabsContent value="vendors" className="mt-6">
            <VendorRequestsTab />
          </TabsContent>

        </Tabs>
      </div>
    </AppShell>
  );
}
