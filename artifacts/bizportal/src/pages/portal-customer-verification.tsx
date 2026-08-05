import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, FileText,
  Eye, Search, RefreshCw, ChevronRight, Building2, User, Phone, Mail, ArrowLeft,
} from "lucide-react";

type VerifStatus = "DRAFT" | "PENDING_VERIFICATION" | "NEED_REVISION" | "VERIFIED" | "REJECTED" | "EXPIRED";
type DocStatus = "UPLOADED" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "EXPIRED";

interface VerifItem {
  profileId: number;
  customerId: number | null;
  companyName: string | null;
  npwp: string | null;
  nib: string | null;
  picName: string | null;
  picWhatsapp: string | null;
  picEmail: string | null;
  verificationStatus: VerifStatus;
  verificationSubmittedAt: string | null;
  verificationNotes: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  docCount: number;
  pendingDocCount: number;
}

interface VerifDoc {
  id: number;
  documentType: string;
  documentNumber: string | null;
  fileName: string | null;
  fileUrl: string;
  verificationStatus: DocStatus;
  rejectionReason: string | null;
  expiryDate: string | null;
  uploadedVersion: number;
  createdAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

interface VerifDetail {
  profile: Record<string, unknown>;
  documents: VerifDoc[];
  customer: Record<string, unknown> | null;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  NPWP: "NPWP",
  NIB: "NIB",
  KTP_PIC: "KTP PIC",
  AKTA_PERUSAHAAN: "Akta Perusahaan",
  SURAT_KUASA: "Surat Kuasa",
  API_U: "API-U",
  API_P: "API-P",
  NIK_KEPABEANAN: "NIK Kepabeanan",
  SIUP_NIB_ACTIVITY: "SIUP / NIB Activity",
  OTHER: "Dokumen Lainnya",
};

const STATUS_CONFIG: Record<VerifStatus, { label: string; color: string; icon: React.ReactNode }> = {
  DRAFT: { label: "Draft", color: "bg-gray-100 text-gray-700", icon: <FileText className="w-3 h-3" /> },
  PENDING_VERIFICATION: { label: "Pending", color: "bg-blue-100 text-blue-700", icon: <Clock className="w-3 h-3" /> },
  NEED_REVISION: { label: "Perlu Revisi", color: "bg-amber-100 text-amber-700", icon: <AlertTriangle className="w-3 h-3" /> },
  VERIFIED: { label: "Verified", color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="w-3 h-3" /> },
  REJECTED: { label: "Ditolak", color: "bg-rose-100 text-rose-700", icon: <XCircle className="w-3 h-3" /> },
  EXPIRED: { label: "Kadaluarsa", color: "bg-gray-100 text-gray-500", icon: <Clock className="w-3 h-3" /> },
};

const DOC_STATUS_CONFIG: Record<DocStatus, { label: string; color: string }> = {
  UPLOADED: { label: "Uploaded", color: "bg-gray-100 text-gray-700" },
  PENDING_REVIEW: { label: "Pending Review", color: "bg-blue-100 text-blue-700" },
  VERIFIED: { label: "Verified", color: "bg-emerald-100 text-emerald-700" },
  REJECTED: { label: "Ditolak", color: "bg-rose-100 text-rose-700" },
  EXPIRED: { label: "Kadaluarsa", color: "bg-gray-100 text-gray-500" },
};

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { message?: string }).message ?? `HTTP ${r.status}`);
  }
  return r.json();
}

// ─── List Page ────────────────────────────────────────────────────────────────
export default function PortalCustomerVerificationPage() {
  const [, setLocation] = useLocation();
  const [isDetail] = useRoute("/portal/customer-verification/:id");
  const [matchDetail, params] = useRoute("/portal/customer-verification/:id");

  if (matchDetail && params?.id) {
    return <VerificationDetailPage profileId={parseInt(params.id, 10)} />;
  }

  return <VerificationListPage />;
}

function VerificationListPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("PENDING_VERIFICATION");

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search.trim()) params.set("q", search.trim());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["customer-verifications", params.toString()],
    queryFn: () => fetchJSON<{ items: VerifItem[]; total: number }>(`/api/customer-verification/admin?${params}`),
  });

  const items = data?.items ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Verifikasi Customer</h1>
          <p className="text-gray-500 mt-1 text-sm">Review &amp; approve dokumen legal customer untuk layanan PPJK / Customs</p>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Cari perusahaan, nama, email..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="PENDING_VERIFICATION">Pending Verifikasi</SelectItem>
              <SelectItem value="NEED_REVISION">Perlu Revisi</SelectItem>
              <SelectItem value="VERIFIED">Verified</SelectItem>
              <SelectItem value="REJECTED">Ditolak</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Perusahaan</TableHead>
                  <TableHead>PIC</TableHead>
                  <TableHead>NPWP / NIB</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dokumen</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400"><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Memuat...</TableCell></TableRow>
                )}
                {!isLoading && items.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Tidak ada data</TableCell></TableRow>
                )}
                {items.map((item) => {
                  const sc = STATUS_CONFIG[item.verificationStatus] ?? STATUS_CONFIG.DRAFT;
                  return (
                    <TableRow key={item.profileId} className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setLocation(`/portal/customer-verification/${item.profileId}`)}>
                      <TableCell>
                        <div className="font-medium">{item.companyName ?? "-"}</div>
                        <div className="text-xs text-gray-500">{item.customerName ?? item.customerEmail ?? "-"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{item.picName ?? "-"}</div>
                        <div className="text-xs text-gray-500">{item.picWhatsapp ?? "-"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">{item.npwp ?? "-"}</div>
                        <div className="text-xs text-gray-500">{item.nib ?? "-"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${sc.color} hover:${sc.color} flex items-center gap-1 w-fit`}>
                          {sc.icon}{sc.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{item.docCount} total</span>
                        {(item.pendingDocCount ?? 0) > 0 && (
                          <span className="ml-1 text-xs text-blue-600">({item.pendingDocCount} pending)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {item.verificationSubmittedAt
                          ? new Date(item.verificationSubmittedAt).toLocaleDateString("id-ID")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-sm text-gray-500">Total: {data?.total ?? 0} data</p>
      </div>
    </AppShell>
  );
}

// ─── Detail Page ──────────────────────────────────────────────────────────────
function VerificationDetailPage({ profileId }: { profileId: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [actionDialog, setActionDialog] = useState<"approve" | "reject" | "revision" | null>(null);
  const [notes, setNotes] = useState("");
  const [expiredInDays, setExpiredInDays] = useState("365");

  const [docDialog, setDocDialog] = useState<{ doc: VerifDoc; action: "approve" | "reject" } | null>(null);
  const [docNotes, setDocNotes] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["customer-verification-detail", profileId],
    queryFn: () => fetchJSON<VerifDetail>(`/api/customer-verification/admin/${profileId}`),
  });

  const actionMut = useMutation({
    mutationFn: (payload: { action: string; body: Record<string, unknown> }) =>
      fetchJSON(`/api/customer-verification/admin/${profileId}/${payload.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.body),
      }),
    onSuccess: (_, vars) => {
      const labels: Record<string, string> = { approve: "disetujui", reject: "ditolak", "request-revision": "revisi diminta" };
      toast({ title: `Verifikasi ${labels[vars.action] ?? "diproses"}` });
      setActionDialog(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["customer-verification-detail", profileId] });
      qc.invalidateQueries({ queryKey: ["customer-verifications"] });
    },
    onError: (err) => toast({ title: (err as Error).message, variant: "destructive" }),
  });

  const docReviewMut = useMutation({
    mutationFn: (payload: { docId: number; action: "approve" | "reject"; rejectionReason?: string; expiryDate?: string }) =>
      fetchJSON(`/api/customer-verification/admin/${profileId}/documents/${payload.docId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: payload.action, rejectionReason: payload.rejectionReason, expiryDate: payload.expiryDate }),
      }),
    onSuccess: () => {
      toast({ title: "Dokumen berhasil di-review" });
      setDocDialog(null);
      setDocNotes("");
      setExpiryDate("");
      refetch();
    },
    onError: (err) => toast({ title: (err as Error).message, variant: "destructive" }),
  });

  async function handleViewDoc(doc: VerifDoc) {
    const r = await fetch(`/api/customer-verification/admin/${profileId}/signed-url/${doc.id}`, { credentials: "include" });
    if (r.ok) {
      const { url } = await r.json();
      window.open(url, "_blank");
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-64">
          <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </AppShell>
    );
  }

  const profile = data?.profile as Record<string, unknown> | undefined;
  const customer = data?.customer as Record<string, unknown> | null | undefined;
  const docs = data?.documents ?? [];
  const status = (profile?.verificationStatus as VerifStatus) ?? "DRAFT";
  const sc = STATUS_CONFIG[status] ?? STATUS_CONFIG.DRAFT;

  const isPending = status === "PENDING_VERIFICATION";

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — sc.icon is React.ReactNode but TS2322 false-positive due to cast-narrowed data shape
  const _profileHeader = (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-xl font-bold">{String((profile as any)?.companyName ?? "-")}</h1>
        <p className="text-sm text-gray-500">{String((customer as any)?.name ?? (customer as any)?.email ?? "-")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge className={`${sc.color} hover:${sc.color} flex items-center gap-1.5 px-3 py-1.5`}>
          {sc.icon as React.ReactNode} {sc.label}
        </Badge>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-4xl">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button className="hover:text-gray-700" onClick={() => setLocation("/portal/customer-verification")}>
            Verifikasi Customer
          </button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-gray-900">{String((profile as any)?.companyName ?? "Detail")}</span>
        </div>

        {/* Header */}
        {_profileHeader}

        {/* Action Buttons */}
        {isPending && (
          <div className="flex gap-2 flex-wrap">
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setActionDialog("approve")}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
            </Button>
            <Button variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-50" onClick={() => setActionDialog("revision")}>
              <AlertTriangle className="w-4 h-4 mr-2" /> Request Revision
            </Button>
            <Button variant="outline" className="border-rose-400 text-rose-600 hover:bg-rose-50" onClick={() => setActionDialog("reject")}>
              <XCircle className="w-4 h-4 mr-2" /> Reject
            </Button>
          </div>
        )}

        {profile?.verificationNotes != null && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 text-sm">
              <strong>Catatan:</strong> {String(profile.verificationNotes)}
            </CardContent>
          </Card>
        )}

        {/* Profile Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" />Info Perusahaan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Nama Perusahaan" value={String(profile?.companyName ?? "-")} />
              <Row label="NPWP" value={String(profile?.npwp ?? "-")} />
              <Row label="NIB" value={String(profile?.nib ?? "-")} />
              <Row label="Alamat" value={String(profile?.companyAddress ?? "-")} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4" />Info PIC</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Nama PIC" value={String(profile?.picName ?? "-")} />
              <Row label="WhatsApp" value={String(profile?.picWhatsapp ?? customer?.phone ?? "-")} />
              <Row label="Email" value={String(profile?.picEmail ?? customer?.email ?? "-")} />
              <Row label="Submitted" value={profile?.verificationSubmittedAt ? new Date(String(profile.verificationSubmittedAt)).toLocaleString("id-ID") : "-"} />
            </CardContent>
          </Card>
        </div>

        {/* Documents */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Dokumen ({docs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Nomor</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ver.</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-6">Belum ada dokumen</TableCell></TableRow>
                )}
                {docs.map((doc) => {
                  const dsc = DOC_STATUS_CONFIG[doc.verificationStatus as DocStatus] ?? DOC_STATUS_CONFIG.UPLOADED;
                  return (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium text-sm">{DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}</TableCell>
                      <TableCell className="text-sm text-gray-600">{doc.documentNumber ?? "-"}</TableCell>
                      <TableCell className="text-xs text-gray-500 max-w-32 truncate">{doc.fileName ?? "-"}</TableCell>
                      <TableCell>
                        <Badge className={`${dsc.color} hover:${dsc.color} text-xs`}>{dsc.label}</Badge>
                        {doc.verificationStatus === "REJECTED" && doc.rejectionReason && (
                          <p className="text-xs text-rose-600 mt-1">{doc.rejectionReason}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">v{doc.uploadedVersion ?? 1}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleViewDoc(doc)}>
                            <Eye className="w-3.5 h-3.5 mr-1" />Lihat
                          </Button>
                          {isPending && doc.verificationStatus === "PENDING_REVIEW" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={() => { setDocDialog({ doc, action: "approve" }); setDocNotes(""); setExpiryDate(""); }}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />OK
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                onClick={() => { setDocDialog({ doc, action: "reject" }); setDocNotes(""); }}
                              >
                                <XCircle className="w-3.5 h-3.5 mr-1" />Tolak
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* PPJK Compliance */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-blue-800 mb-2">Kelengkapan PPJK / Customs</p>
            <div className="flex gap-6 text-sm">
              {[["NPWP", "NPWP"], ["NIB", "NIB"], ["KTP_PIC", "KTP PIC"]].map(([type, label]) => {
                const found = docs.find((d) => d.documentType === type);
                const isVerif = found?.verificationStatus === "VERIFIED";
                const hasDoc = !!found;
                return (
                  <span key={type} className="flex items-center gap-1.5">
                    {isVerif ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      : hasDoc ? <Clock className="w-4 h-4 text-blue-500" />
                      : <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
                    <span className={isVerif ? "text-emerald-700" : hasDoc ? "text-blue-600" : "text-gray-500"}>
                      {label}
                    </span>
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => { if (!open) { setActionDialog(null); setNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog === "approve" ? "Approve Verifikasi"
                : actionDialog === "reject" ? "Tolak Verifikasi"
                : "Request Revision"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {actionDialog === "approve" && (
              <div className="space-y-1.5">
                <Label>Masa Berlaku (hari)</Label>
                <Input
                  type="number"
                  value={expiredInDays}
                  onChange={(e) => setExpiredInDays(e.target.value)}
                  min={30}
                  max={1825}
                />
                <p className="text-xs text-gray-500">Default 365 hari (1 tahun)</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>
                {actionDialog === "approve" ? "Catatan (opsional)"
                  : actionDialog === "reject" ? "Alasan Penolakan *"
                  : "Catatan Revisi *"}
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  actionDialog === "approve" ? "Catatan tambahan untuk customer..."
                    : actionDialog === "reject" ? "Jelaskan alasan penolakan dokumen..."
                    : "Jelaskan dokumen yang perlu direvisi..."
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionDialog(null); setNotes(""); }}>Batal</Button>
            <Button
              disabled={actionMut.isPending || (actionDialog !== "approve" && !notes.trim())}
              onClick={() => {
                const action = actionDialog === "approve" ? "approve"
                  : actionDialog === "reject" ? "reject"
                  : "request-revision";
                actionMut.mutate({
                  action,
                  body: { notes, ...(actionDialog === "approve" ? { expiredInDays: parseInt(expiredInDays, 10) } : {}) },
                });
              }}
              className={actionDialog === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : actionDialog === "reject" ? "bg-rose-600 hover:bg-rose-700" : ""}
            >
              {actionMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              {actionDialog === "approve" ? "Approve" : actionDialog === "reject" ? "Tolak" : "Kirim Revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doc Review Dialog */}
      <Dialog open={!!docDialog} onOpenChange={(open) => { if (!open) { setDocDialog(null); setDocNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {docDialog?.action === "approve" ? "Approve Dokumen" : "Tolak Dokumen"}: {DOC_TYPE_LABELS[docDialog?.doc.documentType ?? ""] ?? docDialog?.doc.documentType}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {docDialog?.action === "approve" && (
              <div className="space-y-1.5">
                <Label>Tanggal Kedaluwarsa Dokumen (opsional)</Label>
                <DatePicker value={expiryDate} onChange={(v) => setExpiryDate(v)} />
              </div>
            )}
            {docDialog?.action === "reject" && (
              <div className="space-y-1.5">
                <Label>Alasan Penolakan *</Label>
                <Textarea
                  value={docNotes}
                  onChange={(e) => setDocNotes(e.target.value)}
                  placeholder="Jelaskan mengapa dokumen ini ditolak..."
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDocDialog(null); setDocNotes(""); }}>Batal</Button>
            <Button
              disabled={docReviewMut.isPending || (docDialog?.action === "reject" && !docNotes.trim())}
              onClick={() => docDialog && docReviewMut.mutate({
                docId: docDialog.doc.id,
                action: docDialog.action,
                rejectionReason: docDialog.action === "reject" ? docNotes : undefined,
                expiryDate: docDialog.action === "approve" && expiryDate ? expiryDate : undefined,
              })}
              className={docDialog?.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
            >
              {docReviewMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              {docDialog?.action === "approve" ? "Approve Dokumen" : "Tolak Dokumen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="font-medium text-right truncate">{value}</span>
    </div>
  );
}
