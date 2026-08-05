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
import {
  Users, Building2, Truck, CheckCircle2, Clock, XCircle,
  RefreshCw, Search, AlertCircle,
  MessageCircle, Mail, ArrowRight, Loader2,
  ShieldCheck, UserCheck, BarChart3,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";

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
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount
  useEffect(() => () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); }, []);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const params = new URLSearchParams();
  if (roleFilter !== "all") params.set("role", roleFilter);
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
                  <TableHead className="text-xs">Daftar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
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
                    <TableCell className="text-xs text-muted-foreground">{fmt(c.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPortalPage() {
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
            Kelola pelanggan dan approvals onboarding portal
          </p>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="grid grid-cols-2 w-full max-w-xs">
            <TabsTrigger value="overview" className="gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="customers" className="gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" /> Pelanggan
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

          {/* ── Customers ── */}
          <TabsContent value="customers" className="mt-6">
            <CustomersTab />
          </TabsContent>

        </Tabs>
      </div>
    </AppShell>
  );
}
