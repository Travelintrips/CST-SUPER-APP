import { useState, useEffect } from "react";
import { getAuthHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, RefreshCw, Search, Users, MessageCircle, Phone, Mail, Globe, Clock,
  UserCheck, UserX, Eye, CheckCircle2, AlertCircle,
} from "lucide-react";

// ── ApprovalsTab ──────────────────────────────────────────────────────────────

type ApprovalItem = {
  id: number;
  customerId: number;
  accountType: string;
  status: string;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  userProfile: { status: string; fullName?: string; address?: string; phone?: string } | null;
  typeProfile: Record<string, unknown> | null;
};
type ApprovalStats = { pending: number; approved: number; rejected: number; total: number };

export function ApprovalsTab() {
  const { toast } = useToast();
  const h = getAuthHeaders();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [stats, setStats] = useState<ApprovalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ApprovalItem | null>(null);
  const [actionStatus, setActionStatus] = useState<"approved" | "rejected">("approved");
  const [adminNote, setAdminNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [auditItem, setAuditItem] = useState<ApprovalItem | null>(null);
  const [auditLogs, setAuditLogs] = useState<unknown[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("accountType", typeFilter);
      const [r1, r2] = await Promise.all([
        fetch(`/api/portal/admin/approvals?${params}`, { headers: h, credentials: "include" }),
        fetch("/api/portal/admin/approvals/stats", { headers: h, credentials: "include" }),
      ]);
      if (r1.ok) setItems(await r1.json() as ApprovalItem[]);
      if (r2.ok) setStats(await r2.json() as ApprovalStats);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [statusFilter, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAction() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/portal/admin/approvals/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...h },
        credentials: "include",
        body: JSON.stringify({ status: actionStatus, adminNote: adminNote || null, reviewedBy: "admin" }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: actionStatus === "approved" ? "✅ Disetujui" : "❌ Ditolak", description: `Akun ${selected.customerName ?? ""} berhasil ${actionStatus === "approved" ? "disetujui" : "ditolak"}.` });
      setSelected(null);
      setAdminNote("");
      void load();
    } catch (e) {
      toast({ title: "Gagal", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function loadAudit(item: ApprovalItem) {
    setAuditItem(item);
    setAuditLogs([]);
    setAuditLoading(true);
    try {
      const r = await fetch(`/api/portal/admin/approvals/${item.id}/audit`, { headers: h, credentials: "include" });
      if (r.ok) {
        const d = await r.json() as { data: unknown[] };
        setAuditLogs(d.data ?? []);
      }
    } finally {
      setAuditLoading(false);
    }
  }

  const statusBadge = (s: string) => {
    if (s === "pending") return <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50">Menunggu</Badge>;
    if (s === "approved") return <Badge variant="outline" className="border-green-400 text-green-700 bg-green-50">Disetujui</Badge>;
    if (s === "rejected") return <Badge variant="outline" className="border-red-400 text-red-700 bg-red-50">Ditolak</Badge>;
    return <Badge variant="outline">{s}</Badge>;
  };

  const typeBadge = (t: string) => {
    const map: Record<string, string> = { vendor: "bg-blue-50 text-blue-700 border-blue-300", driver: "bg-purple-50 text-purple-700 border-purple-300", employee: "bg-teal-50 text-teal-700 border-teal-300", customer: "bg-slate-50 text-slate-700 border-slate-300" };
    return <Badge variant="outline" className={map[t] ?? ""}>{t}</Badge>;
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-slate-700 bg-slate-50 border-slate-200" },
            { label: "Menunggu", value: stats.pending, color: "text-amber-700 bg-amber-50 border-amber-200" },
            { label: "Disetujui", value: stats.approved, color: "text-green-700 bg-green-50 border-green-200" },
            { label: "Ditolak", value: stats.rejected, color: "text-red-700 bg-red-50 border-red-200" },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-xl border p-4 ${color}`}>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs font-medium mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Menunggu</SelectItem>
            <SelectItem value="approved">Disetujui</SelectItem>
            <SelectItem value="rejected">Ditolak</SelectItem>
            <SelectItem value="all">Semua Status</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Tipe</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
            <SelectItem value="driver">Driver</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-8 gap-1.5 text-xs">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <CheckCircle2 className="h-8 w-8 text-green-400" />
          <p className="text-sm">Tidak ada data untuk filter ini</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border bg-white hover:shadow-sm transition-shadow">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{item.customerName ?? "-"}</span>
                  {typeBadge(item.accountType)}
                  {statusBadge(item.status)}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {item.customerEmail && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{item.customerEmail}</span>}
                  {item.customerPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{item.customerPhone}</span>}
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(item.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span>
                </div>
                {item.typeProfile && item.accountType === "vendor" && (item.typeProfile as { companyName?: string }).companyName && (
                  <p className="text-xs text-muted-foreground">🏢 {(item.typeProfile as { companyName?: string }).companyName}</p>
                )}
                {item.adminNote && <p className="text-xs text-slate-500 italic">Catatan: {item.adminNote}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void loadAudit(item)}>
                  <Eye className="h-3 w-3" /> Audit
                </Button>
                {item.status === "pending" && (
                  <>
                    <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => { setSelected(item); setActionStatus("approved"); setAdminNote(""); }}>
                      <UserCheck className="h-3 w-3" /> Setujui
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-red-300 text-red-600 hover:bg-red-50" onClick={() => { setSelected(item); setActionStatus("rejected"); setAdminNote(""); }}>
                      <UserX className="h-3 w-3" /> Tolak
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionStatus === "approved"
                ? <><UserCheck className="h-5 w-5 text-green-600" /> Setujui Akun</>
                : <><UserX className="h-5 w-5 text-red-500" /> Tolak Akun</>}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                <p><span className="font-medium">Nama:</span> {selected.customerName}</p>
                <p><span className="font-medium">Email:</span> {selected.customerEmail}</p>
                <p><span className="font-medium">Tipe:</span> {selected.accountType}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{actionStatus === "rejected" ? "Alasan Penolakan *" : "Catatan Admin (opsional)"}</Label>
                <Textarea
                  placeholder={actionStatus === "rejected" ? "Jelaskan alasan penolakan..." : "Tambahkan catatan untuk vendor/customer..."}
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)} disabled={submitting}>Batal</Button>
            <Button
              size="sm"
              disabled={submitting || (actionStatus === "rejected" && !adminNote.trim())}
              className={actionStatus === "approved" ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
              onClick={() => void handleAction()}
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {actionStatus === "approved" ? "Ya, Setujui" : "Ya, Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!auditItem} onOpenChange={(o) => { if (!o) setAuditItem(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Audit Trail — {auditItem?.customerName}</DialogTitle>
          </DialogHeader>
          {auditLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat...</div>
          ) : auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Belum ada log audit</p>
          ) : (
            <div className="space-y-3">
              {(auditLogs as Array<{ action: string; userEmail?: string; createdAt?: string; newData?: Record<string, unknown> }>).map((log, i) => (
                <div key={i} className="rounded-lg border p-3 text-xs space-y-1">
                  <div className="flex justify-between items-center">
                    <span className={`font-semibold ${log.action?.includes("approved") ? "text-green-700" : "text-red-600"}`}>{log.action}</span>
                    <span className="text-muted-foreground">{log.createdAt ? new Date(log.createdAt).toLocaleString("id-ID") : ""}</span>
                  </div>
                  {log.userEmail && <p className="text-muted-foreground">Oleh: {log.userEmail}</p>}
                  {log.newData?.adminNote != null && <p className="italic text-slate-500">Catatan: {String(log.newData.adminNote)}</p>}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── CustomersTab ──────────────────────────────────────────────────────────────

type CustomerItem = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  role: string;
  source: "wa" | "oauth" | "email";
  createdAt: string;
  profileStatus: string;
  profileAccountType: string | null;
  profileFullName: string | null;
};
type CustomerStats = { total: number; wa: number; customer: number; vendor: number; profileIncomplete: number; profilePending: number; profileActive: number };

export function CustomersTab() {
  const h = getAuthHeaders();
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");

  async function load(q = search, role = roleFilter) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (role !== "all") params.set("role", role);
      const [r1, r2] = await Promise.all([
        fetch(`/api/portal/admin/customers?${params}`, { headers: h, credentials: "include" }),
        fetch("/api/portal/admin/customers/stats", { headers: h, credentials: "include" }),
      ]);
      if (r1.ok) { const d = await r1.json() as { items: CustomerItem[] }; setItems(d.items); }
      if (r2.ok) setStats(await r2.json() as CustomerStats);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [roleFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    void load(searchInput, roleFilter);
  }

  const roleBadge = (r: string) => {
    const map: Record<string, string> = { admin: "bg-amber-50 text-amber-700 border-amber-300", vendor: "bg-blue-50 text-blue-700 border-blue-300", driver: "bg-purple-50 text-purple-700 border-purple-300", customer: "bg-slate-50 text-slate-700 border-slate-300", employee: "bg-teal-50 text-teal-700 border-teal-300" };
    return <Badge variant="outline" className={`text-[10px] ${map[r] ?? ""}`}>{r}</Badge>;
  };

  const profileBadge = (s: string) => {
    if (s === "active") return <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 bg-green-50">Aktif</Badge>;
    if (s === "pending") return <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50">Pending</Badge>;
    if (s === "rejected") return <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">Ditolak</Badge>;
    if (s === "incomplete" || s === "not_started") return <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-500">Belum Lengkap</Badge>;
    return <Badge variant="outline" className="text-[10px]">{s}</Badge>;
  };

  const sourceIcon = (s: string) => {
    if (s === "wa") return <MessageCircle className="h-3 w-3 text-green-600" />;
    if (s === "oauth") return <Globe className="h-3 w-3 text-blue-500" />;
    return <Mail className="h-3 w-3 text-slate-400" />;
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            { label: "Total", value: stats.total, color: "text-slate-700" },
            { label: "Customer", value: stats.customer, color: "text-slate-600" },
            { label: "Vendor", value: stats.vendor, color: "text-blue-700" },
            { label: "Via WA", value: stats.wa, color: "text-green-700" },
            { label: "Aktif", value: stats.profileActive, color: "text-green-700" },
            { label: "Pending", value: stats.profilePending, color: "text-amber-700" },
            { label: "Belum Lengkap", value: stats.profileIncomplete, color: "text-slate-500" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border bg-white p-3 text-center">
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-48">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Cari nama, email, HP, perusahaan..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={loading}>Cari</Button>
        </form>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v)}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Role</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
            <SelectItem value="driver">Driver</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => void load(searchInput, roleFilter)} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <Users className="h-8 w-8 opacity-30" />
          <p className="text-sm">Tidak ada pelanggan ditemukan</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{items.length} pelanggan ditampilkan</p>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left p-3 font-medium">Nama / Perusahaan</th>
                  <th className="text-left p-3 font-medium hidden sm:table-cell">Kontak</th>
                  <th className="text-left p-3 font-medium">Role</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Status</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">Daftar</th>
                  <th className="text-left p-3 font-medium">Sumber</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="p-3">
                      <p className="font-medium text-foreground">{c.profileFullName ?? c.name}</p>
                      {c.company && <p className="text-muted-foreground">{c.company}</p>}
                    </td>
                    <td className="p-3 hidden sm:table-cell">
                      <p className="text-muted-foreground">{c.email?.endsWith("@wa.local") ? "-" : c.email}</p>
                      {c.phone && <p className="text-muted-foreground">{c.phone}</p>}
                    </td>
                    <td className="p-3">{roleBadge(c.role)}</td>
                    <td className="p-3 hidden md:table-cell">{profileBadge(c.profileStatus)}</td>
                    <td className="p-3 hidden lg:table-cell text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="p-3">{sourceIcon(c.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── WaLogsTab ─────────────────────────────────────────────────────────────────

type WaLogItem = {
  id: number;
  recipient: string;
  status: string;
  context: string | null;
  refType: string | null;
  refId: string | null;
  errorMsg: string | null;
  retryCount: number | null;
  nextRetryAt: string | null;
  waMessageId: string | null;
  waDeliveryStatus: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};
type WaLogStats = { allTime: { sent: number; failed: number; deduped: number }; today: { sent: number; failed: number; deduped: number } };

export function WaLogsTab() {
  const { toast } = useToast();
  const h = getAuthHeaders();
  const [rows, setRows] = useState<WaLogItem[]>([]);
  const [stats, setStats] = useState<WaLogStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [retryingId, setRetryingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const [r1, r2] = await Promise.all([
        fetch(`/api/portal/admin/wa-logs?${params}`, { headers: h, credentials: "include" }),
        fetch("/api/portal/admin/wa-logs/stats", { headers: h, credentials: "include" }),
      ]);
      if (r1.ok) {
        const d = await r1.json() as { rows: WaLogItem[]; total: number };
        setRows(d.rows ?? []);
        setTotal(d.total ?? 0);
      }
      if (r2.ok) setStats(await r2.json() as WaLogStats);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRetry(id: number) {
    setRetryingId(id);
    try {
      const r = await fetch(`/api/portal/admin/wa-logs/${id}/retry`, { method: "POST", headers: h, credentials: "include" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { message?: string }).message ?? "Gagal retry");
      toast({ title: "✅ Terkirim ulang", description: `Pesan ke ${rows.find((x) => x.id === id)?.recipient ?? ""} berhasil dikirim ulang.` });
      void load();
    } catch (e) {
      toast({ title: "Gagal retry", description: String(e), variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
  }

  const statusBadge = (s: string) => {
    if (s === "sent") return <Badge variant="outline" className="border-green-400 text-green-700 bg-green-50">Terkirim</Badge>;
    if (s === "failed") return <Badge variant="outline" className="border-red-400 text-red-700 bg-red-50">Gagal</Badge>;
    if (s === "deduped") return <Badge variant="outline" className="border-slate-300 text-slate-600 bg-slate-50">Deduplikasi</Badge>;
    if (s === "draft") return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">Draft</Badge>;
    return <Badge variant="outline">{s}</Badge>;
  };

  const deliveryBadge = (s: string | null) => {
    if (!s) return null;
    if (s === "read") return <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 bg-blue-50">Dibaca</Badge>;
    if (s === "delivered") return <Badge variant="outline" className="text-[10px] border-teal-300 text-teal-700 bg-teal-50">Diterima</Badge>;
    if (s === "sent") return <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-500">Terkirim ke server</Badge>;
    return <Badge variant="outline" className="text-[10px]">{s}</Badge>;
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border p-4 text-green-700 bg-green-50 border-green-200">
            <p className="text-2xl font-bold">{stats.allTime.sent}</p>
            <p className="text-xs font-medium mt-0.5">Terkirim (semua waktu) · {stats.today.sent} hari ini</p>
          </div>
          <div className="rounded-xl border p-4 text-red-700 bg-red-50 border-red-200">
            <p className="text-2xl font-bold">{stats.allTime.failed}</p>
            <p className="text-xs font-medium mt-0.5">Gagal (semua waktu) · {stats.today.failed} hari ini</p>
          </div>
          <div className="rounded-xl border p-4 text-slate-700 bg-slate-50 border-slate-200">
            <p className="text-2xl font-bold">{stats.allTime.deduped}</p>
            <p className="text-xs font-medium mt-0.5">Deduplikasi (semua waktu) · {stats.today.deduped} hari ini</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="sent">Terkirim</SelectItem>
            <SelectItem value="failed">Gagal</SelectItem>
            <SelectItem value="deduped">Deduplikasi</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-8 gap-1.5 text-xs">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">Menampilkan {rows.length} dari {total} log</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <MessageCircle className="h-8 w-8 text-slate-300" />
          <p className="text-sm">Belum ada log notifikasi WhatsApp untuk filter ini</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border bg-white hover:shadow-sm transition-shadow">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{row.recipient}</span>
                  {statusBadge(row.status)}
                  {deliveryBadge(row.waDeliveryStatus)}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {row.context && <span>Konteks: {row.context}</span>}
                  {row.refType && row.refId && <span>Ref: {row.refType} #{row.refId}</span>}
                  <span>{new Date(row.createdAt).toLocaleString("id-ID")}</span>
                  {(row.retryCount ?? 0) > 0 && <span>Percobaan retry: {row.retryCount}</span>}
                </div>
                {row.status === "failed" && row.errorMsg && (
                  <p className="text-xs text-red-600 flex items-start gap-1"><AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{row.errorMsg}</p>
                )}
              </div>
              {row.status === "failed" && (row.retryCount ?? 0) < 3 && (
                <Button
                  variant="outline" size="sm"
                  className="h-8 gap-1.5 text-xs shrink-0"
                  disabled={retryingId === row.id}
                  onClick={() => void handleRetry(row.id)}
                >
                  {retryingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Kirim Ulang
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
