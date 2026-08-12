import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Users, MessageCircle, Mail, KeyRound, Phone, Building2, RefreshCw,
  MapPin, User, Calendar, ShieldCheck, FileText, Pencil, Ban,
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

type PortalCustomer = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  role: string;
  accountStatus: "active" | "inactive" | "sanctioned";
  sanctionReason: string | null;
  sanctionUntil: string | null;
  avatarUrl: string | null;
  source: "wa" | "oauth" | "email";
  createdAt: string;
  profileStatus: string;
  profileAccountType: string | null;
  profileFullName: string | null;
  profileAddress: string | null;
};

type CustomerDetail = PortalCustomer & {
  oauthProvider: string | null;
  profile: {
    companyName: string | null;
    npwp: string | null;
    nib: string | null;
    companyAddress: string | null;
    picName: string | null;
    picWhatsapp: string | null;
    picEmail: string | null;
    ktpPicUrl: string | null;
    legalDocUrl: string | null;
    profileStatus: string;
    verificationStatus: string;
    isVerified: boolean;
    createdAt: string;
    updatedAt: string | null;
  } | null;
};

type Stats = {
  total: number; wa: number; customer: number; vendor: number;
  profileIncomplete: number; profilePending: number; profileActive: number;
  accountActive: number; accountInactive: number; accountSanctioned: number;
};

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function Avatar({ url, name, size = "sm" }: { url: string | null; name: string; size?: "sm" | "lg" }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const dim = size === "lg" ? "h-20 w-20 text-2xl" : "h-9 w-9 text-sm";
  return url ? (
    <img src={url} alt={name} className={`${dim} rounded-full object-cover ring-2 ring-white shadow`} />
  ) : (
    <div className={`${dim} rounded-full bg-sky-100 text-sky-700 font-bold flex items-center justify-center flex-shrink-0`}>
      {initials}
    </div>
  );
}

export default function PortalCustomersPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", role: "customer",
    accountStatus: "active" as PortalCustomer["accountStatus"],
    sanctionReason: "", sanctionUntil: "",
  });
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  if (roleFilter !== "all") params.set("role", roleFilter);
  if (statusFilter !== "all") params.set("accountStatus", statusFilter);
  if (search.trim()) params.set("q", search.trim());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["portal-customers", params.toString()],
    queryFn: () => fetchJSON<{ items: PortalCustomer[]; total: number }>(`/api/portal/admin/customers?${params.toString()}`),
  });

  const { data: stats } = useQuery({
    queryKey: ["portal-customers-stats"],
    queryFn: () => fetchJSON<Stats>("/api/portal/admin/customers/stats"),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["portal-customer-detail", selectedId],
    queryFn: () => fetchJSON<CustomerDetail>(`/api/portal/admin/customers/${selectedId}`),
    enabled: selectedId !== null,
  });

  useEffect(() => {
    if (!detail) return;
    setForm({
      name: detail.name ?? "",
      email: detail.email ?? "",
      phone: detail.phone ?? "",
      company: detail.company ?? "",
      role: detail.role ?? "customer",
      accountStatus: detail.accountStatus ?? "active",
      sanctionReason: detail.sanctionReason ?? "",
      sanctionUntil: detail.sanctionUntil ? detail.sanctionUntil.slice(0, 10) : "",
    });
  }, [detail]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (selectedId === null) throw new Error("Akun belum dipilih");
      if (!form.name.trim()) throw new Error("Nama wajib diisi");
      if (!form.email.includes("@")) throw new Error("Email tidak valid");
      if (form.accountStatus === "sanctioned" && !form.sanctionReason.trim()) {
        throw new Error("Alasan sanksi wajib diisi");
      }
      const response = await fetch(`/api/portal/admin/customers/${selectedId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          role: form.role,
          accountStatus: form.accountStatus,
          sanctionReason: form.sanctionReason.trim() || null,
          sanctionUntil: form.sanctionUntil || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.message || "Gagal menyimpan perubahan");
      return body;
    },
    onSuccess: () => {
      setSaveMessage("Perubahan akun berhasil disimpan.");
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["portal-customers"] });
      queryClient.invalidateQueries({ queryKey: ["portal-customers-stats"] });
      queryClient.invalidateQueries({ queryKey: ["portal-customer-detail", selectedId] });
    },
    onError: (error: Error) => setSaveMessage(error.message),
  });

  const items = (data?.items ?? []).filter((it) => sourceFilter === "all" || it.source === sourceFilter);

  const sourceBadge = (source: PortalCustomer["source"]) => {
    if (source === "wa") return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"><MessageCircle className="w-3 h-3 mr-1" />WhatsApp</Badge>;
    if (source === "oauth") return <Badge variant="secondary"><KeyRound className="w-3 h-3 mr-1" />OAuth</Badge>;
    return <Badge variant="outline"><Mail className="w-3 h-3 mr-1" />Email</Badge>;
  };

  const profileBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      not_started: { cls: "bg-gray-100 text-gray-700", label: "Belum Onboarding" },
      incomplete:  { cls: "bg-amber-100 text-amber-700", label: "Belum Lengkap" },
      pending:     { cls: "bg-blue-100 text-blue-700", label: "Menunggu Approval" },
      active:      { cls: "bg-emerald-100 text-emerald-700", label: "Aktif" },
      rejected:    { cls: "bg-rose-100 text-rose-700", label: "Ditolak" },
    };
    const m = map[status] ?? map.not_started;
    return <Badge className={`${m.cls} hover:${m.cls}`}>{m.label}</Badge>;
  };

  const accountBadge = (status: PortalCustomer["accountStatus"]) => {
    if (status === "sanctioned") {
      return <Badge className="gap-1 bg-red-100 text-red-700 hover:bg-red-100"><Ban className="w-3 h-3" />Sanksi</Badge>;
    }
    if (status === "inactive") {
      return <Badge variant="outline" className="text-slate-600 border-slate-300">Nonaktif</Badge>;
    }
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Aktif</Badge>;
  };

  const fmtDate = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <AppShell>
      <BackButton />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6" />Pelanggan Portal</h1>
            <p className="text-sm text-muted-foreground">Daftar semua user yang mendaftar di Customer Portal (web/WA/OAuth).</p>
          </div>
          <button onClick={() => refetch()} className="inline-flex items-center gap-2 text-sm px-3 py-2 border rounded-md hover:bg-accent">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: "Total", value: stats.total, cls: "text-foreground" },
              { label: "Via WA", value: stats.wa, cls: "text-emerald-600" },
              { label: "Customer", value: stats.customer, cls: "text-blue-600" },
              { label: "Vendor", value: stats.vendor, cls: "text-purple-600" },
              { label: "Belum Onboarding", value: stats.profileIncomplete, cls: "text-gray-600" },
              { label: "Pending Approval", value: stats.profilePending, cls: "text-amber-600" },
              { label: "Aktif", value: stats.profileActive, cls: "text-emerald-600" },
              { label: "Akun Nonaktif", value: stats.accountInactive, cls: "text-slate-600" },
              { label: "Akun Sanksi", value: stats.accountSanctioned, cls: "text-rose-600" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Cari nama / email / phone / perusahaan…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Role</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Sumber" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Sumber</SelectItem>
                  <SelectItem value="wa">WhatsApp</SelectItem>
                  <SelectItem value="email">Email/Password</SelectItem>
                  <SelectItem value="oauth">OAuth (Google)</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Status akun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status Akun</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="inactive">Nonaktif</SelectItem>
                  <SelectItem value="sanctioned">Sanksi</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pelanggan</TableHead>
                    <TableHead>Kontak</TableHead>
                    <TableHead>Perusahaan</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Sumber</TableHead>
                    <TableHead>Status Profil</TableHead>
                    <TableHead>Status Akun</TableHead>
                    <TableHead>Terdaftar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Memuat…</TableCell></TableRow>
                  )}
                  {!isLoading && items.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Belum ada data.</TableCell></TableRow>
                  )}
                  {items.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => setSelectedId(c.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar url={c.avatarUrl} name={c.profileFullName || c.name} />
                          <div>
                            <div className="font-medium">{c.profileFullName || c.name}</div>
                            {c.profileFullName && c.profileFullName !== c.name && (
                              <div className="text-xs text-muted-foreground">alias: {c.name}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5 text-sm">
                          {c.phone && <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</div>}
                          {c.email && !c.email.endsWith("@wa.local") && (
                            <div className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3 h-3" />{c.email}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.company ? (
                          <div className="flex items-center gap-1 text-sm"><Building2 className="w-3 h-3" />{c.company}</div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{c.role}</Badge></TableCell>
                      <TableCell>{sourceBadge(c.source)}</TableCell>
                      <TableCell>{profileBadge(c.profileStatus)}</TableCell>
                      <TableCell>{accountBadge(c.accountStatus)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Customer Detail Dialog */}
      <Dialog open={selectedId !== null} onOpenChange={(open) => {
        if (!open) {
          setSelectedId(null);
          setEditing(false);
          setSaveMessage(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editing ? <Pencil className="w-4 h-4" /> : <Users className="w-4 h-4" />}
              {editing ? "Ubah Akun Pelanggan" : "Detail Pelanggan"}
            </DialogTitle>
            <DialogDescription>
              Kelola akses login dan data akun tanpa menghapus histori transaksi.
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="py-12 flex justify-center"><div className="h-8 w-8 rounded-full border-4 border-sky-500 border-t-transparent animate-spin" /></div>
          ) : (
            <div className="space-y-5 pt-1">
              {/* Hero */}
              <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                <Avatar url={detail.avatarUrl} name={detail.profileFullName || detail.name} size="lg" />
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold truncate">{detail.profileFullName || detail.name}</h2>
                  {detail.company && <p className="text-sm text-slate-600 flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{detail.company}</p>}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline" className="capitalize">{detail.role}</Badge>
                    {sourceBadge(detail.source)}
                    {profileBadge(detail.profileStatus)}
                    {accountBadge(detail.accountStatus)}
                  </div>
                </div>
              </div>

              {editing && (
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="portal-customer-name">Nama</Label>
                      <Input id="portal-customer-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="portal-customer-email">Email</Label>
                      <Input id="portal-customer-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="portal-customer-phone">WhatsApp / Telepon</Label>
                      <Input id="portal-customer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="portal-customer-company">Perusahaan</Label>
                      <Input id="portal-customer-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Role</Label>
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
                      <Select value={form.accountStatus} onValueChange={(accountStatus: PortalCustomer["accountStatus"]) => setForm({ ...form, accountStatus })}>
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
                    <Label htmlFor="portal-customer-sanction-reason">
                      {form.accountStatus === "sanctioned" ? "Alasan sanksi *" : "Catatan status (opsional)"}
                    </Label>
                    <Textarea id="portal-customer-sanction-reason" value={form.sanctionReason} onChange={(e) => setForm({ ...form, sanctionReason: e.target.value })} />
                  </div>
                  {form.accountStatus === "sanctioned" && (
                    <div className="grid gap-1.5 max-w-xs">
                      <Label htmlFor="portal-customer-sanction-until">Sanksi berakhir (opsional)</Label>
                      <Input id="portal-customer-sanction-until" type="date" value={form.sanctionUntil} onChange={(e) => setForm({ ...form, sanctionUntil: e.target.value })} />
                    </div>
                  )}
                  {saveMessage && (
                    <p className={`text-sm ${saveMessage.includes("berhasil") ? "text-emerald-600" : "text-red-600"}`}>{saveMessage}</p>
                  )}
                </div>
              )}

              {/* Contact */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Kontak</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={detail.email?.endsWith("@wa.local") ? "—" : detail.email} />
                  <InfoRow icon={<Phone className="w-4 h-4" />} label="WhatsApp / Telepon" value={detail.phone} />
                  <InfoRow icon={<User className="w-4 h-4" />} label="Username (login)" value={detail.name} />
                  <InfoRow icon={<Calendar className="w-4 h-4" />} label="Terdaftar" value={fmtDate(detail.createdAt)} />
                </div>
              </div>

              {/* Profile */}
              {detail.profile && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Profil Perusahaan (Onboarding)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <InfoRow icon={<Building2 className="w-4 h-4" />} label="Nama Perusahaan" value={detail.profile.companyName} />
                    <InfoRow icon={<FileText className="w-4 h-4" />} label="NPWP" value={detail.profile.npwp} />
                    <InfoRow icon={<FileText className="w-4 h-4" />} label="NIB" value={detail.profile.nib} />
                    <InfoRow icon={<User className="w-4 h-4" />} label="PIC" value={detail.profile.picName} />
                    <InfoRow icon={<Phone className="w-4 h-4" />} label="WA PIC" value={detail.profile.picWhatsapp} />
                    <InfoRow icon={<Mail className="w-4 h-4" />} label="Email PIC" value={detail.profile.picEmail} />
                    <div className="sm:col-span-2">
                      <InfoRow icon={<MapPin className="w-4 h-4" />} label="Alamat Perusahaan" value={detail.profile.companyAddress} />
                    </div>
                    <InfoRow icon={<ShieldCheck className="w-4 h-4" />} label="Status Verifikasi" value={detail.profile.verificationStatus} />
                    <InfoRow icon={<Calendar className="w-4 h-4" />} label="Diperbarui" value={fmtDate(detail.profile.updatedAt ?? null)} />
                  </div>

                  {/* Document images */}
                  {(detail.profile.ktpPicUrl || detail.profile.legalDocUrl) && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Dokumen</p>
                      <div className="flex flex-wrap gap-3">
                        {detail.profile.ktpPicUrl && (
                          <a href={detail.profile.ktpPicUrl} target="_blank" rel="noreferrer" className="group">
                            <div className="relative h-28 w-40 rounded-lg overflow-hidden border bg-slate-50">
                              <img src={detail.profile.ktpPicUrl} alt="KTP" className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                            </div>
                            <p className="text-xs text-center mt-1 text-muted-foreground">KTP / Identitas</p>
                          </a>
                        )}
                        {detail.profile.legalDocUrl && (
                          <a href={detail.profile.legalDocUrl} target="_blank" rel="noreferrer" className="group">
                            <div className="relative h-28 w-40 rounded-lg overflow-hidden border bg-slate-50">
                              <img src={detail.profile.legalDocUrl} alt="Dok Legal" className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                            </div>
                            <p className="text-xs text-center mt-1 text-muted-foreground">Dokumen Legal</p>
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!detail.profile && (
                <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">Belum ada data onboarding untuk pelanggan ini.</p>
              )}
            </div>
          )}

          {!detailLoading && detail && (
            <DialogFooter>
              {editing ? (
                <>
                  <Button variant="outline" onClick={() => { setEditing(false); setSaveMessage(null); }}>Batal</Button>
                  <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Menyimpan…" : "Simpan Perubahan"}
                  </Button>
                </>
              ) : (
                <Button className="gap-2" onClick={() => { setEditing(true); setSaveMessage(null); }}>
                  <Pencil className="w-4 h-4" /> Ubah Akun
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value || "—"}</p>
      </div>
    </div>
  );
}
