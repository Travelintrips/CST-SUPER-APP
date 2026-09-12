import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Clock, CheckCircle2, XCircle, Users, Building2, Truck, UserCheck,
  User, Phone, Mail, MapPin, FileText, Eye, AlertCircle, RefreshCw,
  CreditCard, Car, Link2, MessageCircle, Package, Copy, ExternalLink,
  ShieldCheck, ShieldAlert, History, ArrowLeft, Download, FolderOpen,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { BackButton } from "@/components/ui/back-button";

// ── Types ────────────────────────────────────────────────────────────────────

type UserProfile = {
  id: number;
  fullName: string | null;
  phone: string | null;
  address: string | null;
  accountType: string;
  status: string;
  ktpUrl: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
};

type VendorProfile = {
  companyName: string | null;
  businessType: string | null;
  companyDescription: string | null;
  nib: string | null;
  npwp: string | null;
  siup: string | null;
  tdp: string | null;
  serviceType: string | null;
  // Contact
  picName: string | null;
  picPosition: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  // Address
  province: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  fullAddress: string | null;
  // Bank
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  // Bridge fields (present after vendor lifecycle runs)
  supplierId: number | null;
  catalogSubmissionLinkId: number | null;
  catalogSubmissionLinkToken: string | null;
  catalogSubmissionLinkUrl: string | null;
  verificationStatus: string | null;
  approvedAt: string | null;
};
type DriverProfile  = { licenseNumber: string | null; vehicleType: string | null; plateNumber: string | null; simUrl: string | null; stnkUrl: string | null };
type EmployeeProfile = { companyName: string | null; branch: string | null; department: string | null; division: string | null; position: string | null };

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
  userProfile: UserProfile | null;
  typeProfile: VendorProfile | DriverProfile | EmployeeProfile | null;
};

type Stats = { pending: number; approved: number; rejected: number; total: number };

type IdentityDoc = {
  id: number | null;
  docType: string;
  url: string;
  fileName: string | null;
  source: "identity_documents" | "vendor_profile";
  createdAt: string | null;
};

type VendorLifecycleResult = {
  ok: boolean;
  status: string;
  createdSupplierId: number | null;
  createdSupplierName: string | null;
  supplierAlreadyExisted: boolean;
  submissionLinkId: number | null;
  submissionLinkToken: string | null;
  submissionLinkUrl: string | null;
  waNotificationSent: boolean;
};

// ── Audit Entry Type ──────────────────────────────────────────────────────────

type AuditEntry = {
  id: number;
  userId: string | null;
  userEmail: string | null;
  action: string;
  module: string;
  referenceId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (s: string | null) => s ? new Date(s).toLocaleString("id-ID") : "-";

const statusBadge = (s: string) => {
  if (s === "approved") return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Disetujui</Badge>;
  if (s === "rejected") return <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">Ditolak</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">Menunggu</Badge>;
};

const accountTypeLabel = (t: string) => ({
  vendor: "Vendor", driver: "Driver", employee: "Karyawan", customer: "Customer",
}[t] ?? t);

const accountTypeIcon = (t: string) => {
  if (t === "vendor") return <Building2 className="h-4 w-4 text-blue-600" />;
  if (t === "driver") return <Truck className="h-4 w-4 text-orange-600" />;
  if (t === "employee") return <UserCheck className="h-4 w-4 text-purple-600" />;
  return <User className="h-4 w-4 text-gray-500" />;
};

const accountTypeBadge = (t: string) => {
  const colors: Record<string, string> = {
    vendor: "bg-blue-100 text-blue-800 border-blue-200",
    driver: "bg-orange-100 text-orange-800 border-orange-200",
    employee: "bg-purple-100 text-purple-800 border-purple-200",
    customer: "bg-gray-100 text-gray-700 border-gray-200",
  };
  return (
    <Badge className={`${colors[t] ?? "bg-gray-100 text-gray-700"} text-xs flex items-center gap-1`}>
      {accountTypeIcon(t)} {accountTypeLabel(t)}
    </Badge>
  );
};

// ── Vendor Bridge Status Panel ────────────────────────────────────────────────

function VendorBridgePanel({ vp }: { vp: VendorProfile }) {
  const isLinked = !!vp.supplierId;

  const submissionUrl = vp.catalogSubmissionLinkUrl ?? null;

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(() =>
      toast({ title: "Link submission disalin ke clipboard" })
    );
  };

  return (
    <div className={`rounded-lg border p-3 text-sm space-y-2 ${isLinked ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"}`}>
      <div className="flex items-center gap-2 font-semibold text-xs text-muted-foreground uppercase tracking-wide">
        <Package className="h-3.5 w-3.5" /> Status Supplier Bridge
      </div>
      <div className="flex items-center gap-2">
        {isLinked
          ? <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
          : <ShieldAlert className="h-4 w-4 text-gray-400 shrink-0" />}
        <span className={isLinked ? "text-blue-700 font-medium" : "text-muted-foreground"}>
          {isLinked ? `Terhubung ke Supplier #${vp.supplierId}` : "Belum terhubung ke supplier"}
        </span>
      </div>
      {vp.verificationStatus && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Status Verifikasi:</span>
          <Badge className={vp.verificationStatus === "verified"
            ? "bg-green-100 text-green-700 text-xs"
            : "bg-gray-100 text-gray-600 text-xs"}>
            {vp.verificationStatus}
          </Badge>
        </div>
      )}
      {submissionUrl ? (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground font-medium">Link Submission Katalog:</div>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-white border rounded px-2 py-1 flex-1 truncate font-mono text-blue-700">
              {submissionUrl}
            </code>
            <Button size="icon" variant="outline" className="h-6 w-6 shrink-0" onClick={() => copyLink(submissionUrl)}>
              <Copy className="h-3 w-3" />
            </Button>
            <a href={submissionUrl} target="_blank" rel="noopener noreferrer">
              <Button size="icon" variant="outline" className="h-6 w-6 shrink-0">
                <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
          </div>
          {vp.catalogSubmissionLinkId && (
            <div className="text-xs text-muted-foreground">
              Link ID: <span className="font-mono">#{vp.catalogSubmissionLinkId}</span>
              {vp.catalogSubmissionLinkToken && (
                <> · Token: <span className="font-mono">{vp.catalogSubmissionLinkToken.slice(0, 8)}…</span></>
              )}
            </div>
          )}
        </div>
      ) : vp.catalogSubmissionLinkId ? (
        <div className="text-xs text-muted-foreground">
          Link Katalog ID: <span className="font-mono font-medium">#{vp.catalogSubmissionLinkId}</span>
        </div>
      ) : null}
      {vp.approvedAt && (
        <div className="text-xs text-muted-foreground">Disetujui: {fmt(vp.approvedAt)}</div>
      )}
    </div>
  );
}

// ── Post-Approval Vendor Result Dialog ───────────────────────────────────────

function VendorLifecycleResultDialog({
  result,
  vendorName,
  onClose,
}: {
  result: VendorLifecycleResult;
  vendorName: string;
  onClose: () => void;
}) {
  const copyLink = () => {
    if (result.submissionLinkUrl) {
      navigator.clipboard.writeText(result.submissionLinkUrl).then(() =>
        toast({ title: "Link submission disalin" })
      );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-5 w-5" /> Vendor Disetujui — Bridge Berhasil
          </DialogTitle>
          <DialogDescription>
            Lifecycle vendor selesai. Berikut detail yang dihasilkan otomatis:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Supplier info */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
              <Building2 className="h-4 w-4" /> Supplier Record
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nama Supplier</span>
                <span className="font-medium">{result.createdSupplierName ?? vendorName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID Supplier</span>
                <span className="font-mono font-medium">#{result.createdSupplierId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge className={result.supplierAlreadyExisted
                  ? "bg-gray-100 text-gray-700 text-xs"
                  : "bg-green-100 text-green-700 text-xs"}>
                  {result.supplierAlreadyExisted ? "Data Diperbarui" : "Baru Dibuat"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Submission link */}
          {result.submissionLinkUrl && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
                <Link2 className="h-4 w-4" /> Link Katalog Submission
              </div>
              <p className="text-xs text-muted-foreground">
                Link ini dikirim ke vendor via WhatsApp. Vendor menggunakan link ini untuk upload produk/layanan.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-white border rounded px-2 py-1 flex-1 truncate font-mono text-indigo-700">
                  {result.submissionLinkUrl}
                </code>
                <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={copyLink}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Link ID: <span className="font-mono">#{result.submissionLinkId}</span>
                {" · "}Token: <span className="font-mono">{result.submissionLinkToken?.slice(0, 8)}…
                </span>
              </div>
            </div>
          )}

          {/* WA notification status */}
          <div className={`rounded-lg border p-3 flex items-start gap-3 ${
            result.waNotificationSent
              ? "bg-green-50 border-green-200"
              : "bg-yellow-50 border-yellow-200"
          }`}>
            <MessageCircle className={`h-4 w-4 mt-0.5 shrink-0 ${result.waNotificationSent ? "text-green-600" : "text-yellow-600"}`} />
            <div className="text-sm">
              <div className={`font-medium ${result.waNotificationSent ? "text-green-700" : "text-yellow-700"}`}>
                {result.waNotificationSent
                  ? "Notifikasi WhatsApp terkirim"
                  : "Notifikasi WhatsApp tidak terkirim"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {result.waNotificationSent
                  ? "Vendor telah menerima pesan beserta link submission katalog."
                  : "Nomor telepon tidak ditemukan atau layanan WA tidak aktif. Kirim link secara manual."}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          {result.submissionLinkUrl && (
            <Button
              className="gap-2"
              onClick={() => window.open(result.submissionLinkUrl!, "_blank")}
            >
              <ExternalLink className="h-4 w-4" /> Buka Form Vendor
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail Section helpers ────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-[140px] shrink-0">{label}</span>
      <span className="font-medium break-all">{value || <span className="text-muted-foreground italic">—</span>}</span>
    </div>
  );
}

function TypeProfileDetail({ accountType, profile }: { accountType: string; profile: unknown }) {
  if (!profile) return <p className="text-sm text-muted-foreground italic">Data profil tidak tersedia</p>;

  if (accountType === "vendor") {
    const vp = profile as VendorProfile;
    return (
      <div className="space-y-2">
        <InfoRow label="Nama Perusahaan" value={vp.companyName} />
        {vp.businessType && <InfoRow label="Jenis Usaha" value={vp.businessType} />}
        {vp.companyDescription && <InfoRow label="Deskripsi" value={vp.companyDescription} />}
        <InfoRow label="NIB" value={vp.nib} />
        <InfoRow label="NPWP" value={vp.npwp} />
        {vp.siup && <InfoRow label="NIB" value={vp.siup} />}
        {vp.tdp && <InfoRow label="TDP" value={vp.tdp} />}
        <InfoRow label="Jenis Layanan" value={vp.serviceType} />
        {(vp.picName || vp.picPosition) && (
          <InfoRow label="PIC" value={[vp.picName, vp.picPosition].filter(Boolean).join(" — ")} />
        )}
        {vp.phone && (
          <InfoRow label="Telepon" value={
            <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-muted-foreground" />{vp.phone}</span>
          } />
        )}
        {vp.whatsapp && (
          <InfoRow label="WhatsApp" value={
            <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3 text-muted-foreground" />{vp.whatsapp}</span>
          } />
        )}
        {vp.email && (
          <InfoRow label="Email" value={
            <span className="flex items-center gap-1"><Mail className="h-3 w-3 text-muted-foreground" />{vp.email}</span>
          } />
        )}
        {vp.fullAddress && (
          <InfoRow label="Alamat" value={
            <span className="flex items-start gap-1"><MapPin className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />{vp.fullAddress}{[vp.district, vp.city, vp.province, vp.postalCode].filter(Boolean).length > 0 && `, ${[vp.district, vp.city, vp.province, vp.postalCode].filter(Boolean).join(", ")}`}</span>
          } />
        )}
        {(vp.bankName || vp.bankAccountName || vp.bankAccountNumber) && (
          <InfoRow label="Rekening" value={[vp.bankName, vp.bankAccountName, vp.bankAccountNumber].filter(Boolean).join(" · ")} />
        )}
        {/* Verification & Bridge fields */}
        {vp.verificationStatus && (
          <InfoRow label="Status Verifikasi" value={
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              vp.verificationStatus === "verified"
                ? "bg-green-100 text-green-700"
                : vp.verificationStatus === "unverified"
                ? "bg-gray-100 text-gray-600"
                : "bg-amber-100 text-amber-700"
            }`}>
              {vp.verificationStatus === "verified"
                ? <ShieldCheck className="h-3 w-3" />
                : <ShieldAlert className="h-3 w-3" />}
              {vp.verificationStatus}
            </span>
          } />
        )}
        {vp.supplierId && (
          <InfoRow label="Supplier ID" value={
            <span className="font-mono text-xs bg-muted/40 px-2 py-0.5 rounded">#{vp.supplierId}</span>
          } />
        )}
        {vp.approvedAt && (
          <InfoRow label="Tanggal Approval" value={fmt(vp.approvedAt)} />
        )}
        {vp.catalogSubmissionLinkUrl ? (
          <InfoRow label="Link Submission" value={
            <a
              href={vp.catalogSubmissionLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-600 hover:underline text-xs font-mono break-all"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              {vp.catalogSubmissionLinkUrl}
            </a>
          } />
        ) : vp.catalogSubmissionLinkId ? (
          <InfoRow label="Link Submission" value={
            <span className="text-xs text-muted-foreground font-mono">Link ID #{vp.catalogSubmissionLinkId} (URL belum tersedia)</span>
          } />
        ) : null}
      </div>
    );
  }
  if (accountType === "driver") {
    const dp = profile as DriverProfile;
    return (
      <div className="space-y-2">
        <InfoRow label="No. SIM" value={dp.licenseNumber} />
        <InfoRow label="Jenis Kendaraan" value={dp.vehicleType} />
        <InfoRow label="No. Plat" value={dp.plateNumber} />
        {dp.simUrl && (
          <div className="flex gap-2 text-sm items-center">
            <span className="text-muted-foreground min-w-[140px]">Foto SIM</span>
            <a href={dp.simUrl} target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-1">
              <Eye className="h-3 w-3" /> Lihat Dokumen
            </a>
          </div>
        )}
        {dp.stnkUrl && (
          <div className="flex gap-2 text-sm items-center">
            <span className="text-muted-foreground min-w-[140px]">Foto STNK</span>
            <a href={dp.stnkUrl} target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-1">
              <Eye className="h-3 w-3" /> Lihat Dokumen
            </a>
          </div>
        )}
      </div>
    );
  }
  if (accountType === "employee") {
    const ep = profile as EmployeeProfile;
    return (
      <div className="space-y-2">
        <InfoRow label="Perusahaan" value={ep.companyName} />
        <InfoRow label="Cabang" value={ep.branch} />
        <InfoRow label="Departemen" value={ep.department} />
        <InfoRow label="Divisi" value={ep.division} />
        <InfoRow label="Jabatan" value={ep.position} />
      </div>
    );
  }
  return null;
}

// ── Identity Documents Panel ──────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  ktp:       "KTP",
  npwp:      "NPWP",
  siup:      "NIB",
  tdp:       "TDP",
  nib:       "NIB",
  legality:  "Legalitas Perusahaan",
  sim:       "SIM",
  stnk:      "STNK",
  akta:      "Akta Perusahaan",
  skdp:      "SKDP",
};

function docTypeLabel(t: string) {
  return DOC_TYPE_LABELS[t] ?? t.replace(/_/g, " ").toUpperCase();
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|webp|heic|heif|gif)(\?|$)/i.test(url) || url.startsWith("/api/storage");
}

function IdentityDocsPanel({ approvalId }: { approvalId: number }) {
  const { data, isLoading, error } = useQuery<{ docs: IdentityDoc[] }>({
    queryKey: ["approval-identity-docs", approvalId],
    queryFn: async () => {
      const res = await fetch(`/api/portal/admin/approvals/${approvalId}/identity-docs`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat dokumen");
      return res.json();
    },
    staleTime: 60_000,
  });

  const docs = data?.docs ?? [];

  if (isLoading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
      <RefreshCw className="h-3 w-3 animate-spin" /> Memuat dokumen…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-md px-3 py-2">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Gagal memuat daftar dokumen
    </div>
  );

  if (docs.length === 0) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/20 rounded-lg p-3">
      <FolderOpen className="h-4 w-4 shrink-0" />
      Belum ada dokumen yang diupload
    </div>
  );

  return (
    <div className="space-y-3">
      {docs.map((doc, i) => (
        <div key={doc.id ?? i} className="rounded-lg border bg-muted/10 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold">{docTypeLabel(doc.docType)}</span>
              {doc.source === "vendor_profile" && (
                <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200 h-4 px-1.5">dari profil vendor</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline px-2 py-0.5 rounded hover:bg-blue-50"
              >
                <Eye className="h-3 w-3" /> Lihat
              </a>
              <a
                href={doc.url}
                download={doc.fileName ?? undefined}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-muted/40"
              >
                <Download className="h-3 w-3" /> Unduh
              </a>
            </div>
          </div>

          {/* Preview (images only) */}
          {isImageUrl(doc.url) && (
            <div className="p-2">
              <img
                src={doc.url}
                alt={docTypeLabel(doc.docType)}
                className="w-full max-h-48 object-contain rounded"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}

          {/* File name */}
          {doc.fileName && (
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground font-mono truncate border-t">
              {doc.fileName}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Audit Trail Panel ────────────────────────────────────────────────────────

function AuditTrailPanel({ approvalId }: { approvalId: number }) {
  const { data, isLoading } = useQuery<{ ok: boolean; data: AuditEntry[]; count: number }>({
    queryKey: ["approval-audit", approvalId],
    queryFn: async () => {
      const res = await fetch(`/api/portal/admin/approvals/${approvalId}/audit`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat riwayat");
      return res.json();
    },
    staleTime: 30_000,
  });

  const entries = data?.data ?? [];

  return (
    <div>
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <History className="h-4 w-4" /> Riwayat Keputusan
      </h4>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <RefreshCw className="h-3 w-3 animate-spin" /> Memuat riwayat…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-muted-foreground italic bg-muted/20 rounded-lg px-3 py-2">
          Belum ada riwayat keputusan yang tercatat.
        </div>
      ) : (
        <div className="relative pl-4 space-y-3">
          {/* Timeline vertical line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />

          {entries.map((entry, i) => {
            const isApproved = entry.action === "portal_onboarding_approved";
            const nd = (entry.newData ?? {}) as Record<string, unknown>;
            const reviewer = (nd["reviewedBy"] as string | null) ?? entry.userEmail ?? "Admin";
            const note = nd["adminNote"] as string | null;

            return (
              <div key={entry.id ?? i} className="relative flex gap-3">
                {/* Timeline dot */}
                <div className={`absolute -left-4 mt-1 w-3.5 h-3.5 rounded-full border-2 border-white shrink-0 ${
                  isApproved ? "bg-green-500" : "bg-red-500"
                }`} />

                <div className={`flex-1 rounded-lg border p-3 text-sm space-y-1 ${
                  isApproved
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {isApproved
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />}
                      <span className={isApproved ? "text-green-700" : "text-red-700"}>
                        {isApproved ? "Disetujui" : "Ditolak"}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{fmt(entry.createdAt)}</span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Direview oleh:{" "}
                    <span className="font-medium text-foreground">{reviewer}</span>
                  </div>

                  {note && (
                    <div className="text-xs text-muted-foreground">
                      Catatan:{" "}
                      <span className="font-medium text-foreground">{note}</span>
                    </div>
                  )}

                  {entry.ipAddress && entry.ipAddress !== "unknown" && (
                    <div className="text-[10px] text-muted-foreground/60 font-mono">
                      IP: {entry.ipAddress}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Detail Dialog ─────────────────────────────────────────────────────────────

function DetailDialog({
  item,
  open,
  onClose,
  onApprove,
  onReject,
  isActing,
}: {
  item: ApprovalItem;
  open: boolean;
  onClose: () => void;
  onApprove: (id: number, note: string, by: string) => void;
  onReject: (id: number, note: string, by: string) => void;
  isActing: boolean;
}) {
  const [note, setNote] = useState(item.adminNote ?? "");
  const [reviewedBy, setReviewedBy] = useState("");
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);

  const up  = item.userProfile;
  const vp  = item.accountType === "vendor" ? (item.typeProfile as VendorProfile | null) : null;
  const isPending = item.status === "pending";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {accountTypeIcon(item.accountType)}
            Permohonan Akun — {accountTypeLabel(item.accountType)}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {statusBadge(item.status)}
            <span className="text-xs text-muted-foreground">Diajukan {fmt(item.createdAt)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">

          {/* Personal Info */}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <User className="h-4 w-4" /> Informasi Pribadi
            </h4>
            <div className="space-y-2 bg-muted/30 rounded-lg p-3">
              <InfoRow label="Nama Lengkap" value={up?.fullName ?? item.customerName} />
              <InfoRow label="Email" value={
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3 text-muted-foreground" />
                  {item.customerEmail}
                </span>
              } />
              <InfoRow label="Telepon" value={
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3 text-muted-foreground" />
                  {up?.phone ?? item.customerPhone}
                </span>
              } />
              <InfoRow label="Alamat" value={
                <span className="flex items-start gap-1">
                  <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                  {up?.address}
                </span>
              } />
              <InfoRow label="Tanggal Submit" value={fmt(up?.completedAt ?? null)} />
            </div>
          </div>

          {/* KTP */}
          {up?.ktpUrl ? (
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> Foto KTP
              </h4>
              <div className="rounded-lg overflow-hidden border bg-muted/20">
                <img
                  src={up.ktpUrl}
                  alt="KTP"
                  className="w-full max-h-52 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="p-2 text-center">
                  <a href={up.ktpUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center justify-center gap-1">
                    <Eye className="h-3 w-3" /> Buka di tab baru
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/20 rounded-lg p-3">
              <CreditCard className="h-4 w-4" />
              Foto KTP belum diunggah
            </div>
          )}

          {/* Dokumen Identitas */}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" /> Dokumen yang Diupload
            </h4>
            <IdentityDocsPanel approvalId={item.id} />
          </div>

          {/* Type-specific */}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              {item.accountType === "vendor" && <Building2 className="h-4 w-4" />}
              {item.accountType === "driver" && <Car className="h-4 w-4" />}
              {item.accountType === "employee" && <UserCheck className="h-4 w-4" />}
              Data {accountTypeLabel(item.accountType)}
            </h4>
            <div className="bg-muted/30 rounded-lg p-3">
              <TypeProfileDetail accountType={item.accountType} profile={item.typeProfile} />
            </div>
          </div>

          {/* Vendor Bridge Status (for approved vendors that have been linked) */}
          {item.accountType === "vendor" && item.status === "approved" && vp && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Marketplace Bridge
              </h4>
              <VendorBridgePanel vp={vp} />
            </div>
          )}

          {/* Review result (if already reviewed) */}
          {!isPending && (
            <div className={`rounded-lg p-3 space-y-2 text-sm ${item.status === "approved" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
              <div className="flex items-center gap-2 font-medium">
                {item.status === "approved"
                  ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                  : <XCircle className="h-4 w-4 text-red-600" />}
                {item.status === "approved" ? "Disetujui" : "Ditolak"} oleh {item.reviewedBy ?? "Admin"}
              </div>
              <div className="text-muted-foreground">Waktu: {fmt(item.reviewedAt)}</div>
              {item.adminNote && <div>Catatan: <span className="font-medium">{item.adminNote}</span></div>}
            </div>
          )}

          {/* Audit Trail */}
          <Separator />
          <AuditTrailPanel approvalId={item.id} />

          {/* Action form (only pending) */}
          {isPending && (
            <>
              <Separator />
              {confirmAction ? (
                <div className={`rounded-lg p-4 space-y-3 ${confirmAction === "approve" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                  <p className="text-sm font-semibold">
                    {confirmAction === "approve"
                      ? "✅ Konfirmasi Persetujuan"
                      : "❌ Konfirmasi Penolakan"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {confirmAction === "approve"
                      ? item.accountType === "vendor"
                        ? `Akun vendor ${up?.fullName ?? item.customerName} akan disetujui. Sistem akan otomatis membuat Supplier record dan link submission katalog, lalu mengirim notifikasi WhatsApp.`
                        : `Akun ${accountTypeLabel(item.accountType)} untuk ${up?.fullName ?? item.customerName} akan diaktifkan.`
                      : `Permohonan akun ${accountTypeLabel(item.accountType)} untuk ${up?.fullName ?? item.customerName} akan ditolak.`}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setConfirmAction(null)} disabled={isActing}>
                      Batal
                    </Button>
                    <Button
                      size="sm"
                      className={confirmAction === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
                      onClick={() => {
                        if (confirmAction === "approve") onApprove(item.id, note, reviewedBy);
                        else onReject(item.id, note, reviewedBy);
                      }}
                      disabled={isActing}
                    >
                      {isActing
                        ? (item.accountType === "vendor" && confirmAction === "approve" ? "Membuat supplier & link…" : "Memproses...")
                        : (confirmAction === "approve" ? "Ya, Setujui" : "Ya, Tolak")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Review & Keputusan</h4>
                  {item.accountType === "vendor" && (
                    <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md p-2.5">
                      <Package className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Menyetujui vendor akan otomatis membuat Supplier record, generate link submission katalog, dan mengirim notifikasi WhatsApp ke vendor.
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Catatan Admin (opsional)</label>
                    <Textarea
                      placeholder="Catatan keputusan..."
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Direview oleh</label>
                    <Input
                      placeholder="Nama reviewer..."
                      value={reviewedBy}
                      onChange={(e) => setReviewedBy(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {isPending && !confirmAction && (
          <DialogFooter className="flex gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>Tutup</Button>
            <Button
              variant="outline"
              className="text-red-700 border-red-300 hover:bg-red-50"
              onClick={() => setConfirmAction("reject")}
            >
              <XCircle className="h-4 w-4 mr-1" /> Tolak
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setConfirmAction("approve")}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Setujui
            </Button>
          </DialogFooter>
        )}
        {(!isPending || confirmAction) && !isActing && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Tutup</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PortalOnboardingApprovalsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState<ApprovalItem | null>(null);
  const [vendorLifecycleResult, setVendorLifecycleResult] = useState<{ result: VendorLifecycleResult; vendorName: string } | null>(null);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (typeFilter !== "all") params.set("accountType", typeFilter);

  const { data = [], isLoading, refetch } = useQuery<ApprovalItem[]>({
    queryKey: ["portal-onboarding-approvals", statusFilter, typeFilter],
    queryFn: async () => {
      const res = await fetch(`/api/portal/admin/approvals?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: stats = { pending: 0, approved: 0, rejected: 0, total: 0 } } = useQuery<Stats>({
    queryKey: ["portal-onboarding-approvals-stats"],
    queryFn: async () => {
      const res = await fetch("/api/portal/admin/approvals/stats", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-onboarding-approvals"] });
    qc.invalidateQueries({ queryKey: ["portal-onboarding-approvals-stats"] });
  };

  const actMutation = useMutation({
    mutationFn: async ({ id, status, adminNote, reviewedBy }: { id: number; status: string; adminNote: string; reviewedBy: string }) => {
      const res = await fetch(`/api/portal/admin/approvals/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNote: adminNote || undefined, reviewedBy: reviewedBy || "Admin" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<VendorLifecycleResult>;
    },
    onSuccess: (data, vars) => {
      invalidate();
      if (vars.status === "approved") {
        toast({ title: "✅ Akun disetujui" });
        // Show vendor lifecycle result dialog if this was a vendor approval
        if (data.createdSupplierId != null) {
          const item = selectedItem;
          const vendorName = data.createdSupplierName
            ?? (item?.typeProfile as VendorProfile | null)?.companyName
            ?? item?.customerName
            ?? "Vendor";
          setVendorLifecycleResult({ result: data, vendorName });
        }
      } else {
        toast({ title: "❌ Permohonan ditolak" });
      }
      setSelectedItem(null);
    },
    onError: (e) => toast({ title: "Gagal memproses", description: String((e as Error).message), variant: "destructive" }),
  });

  return (
    <AppShell>
      <BackButton />
      <div className="space-y-6 p-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6" /> Persetujuan Onboarding Portal
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review dan setujui permohonan akun vendor, driver, dan karyawan dari Customer Portal
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <Clock className="h-8 w-8 text-amber-500 shrink-0" />
              <div>
                <div className="text-2xl font-bold text-amber-700">{stats.pending}</div>
                <div className="text-xs text-amber-600">Menunggu Review</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
              <div>
                <div className="text-2xl font-bold text-green-700">{stats.approved}</div>
                <div className="text-xs text-green-600">Disetujui</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <XCircle className="h-8 w-8 text-red-500 shrink-0" />
              <div>
                <div className="text-2xl font-bold text-red-700">{stats.rejected}</div>
                <div className="text-xs text-red-600">Ditolak</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
              <div>
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Total Permohonan</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="flex flex-wrap gap-4 p-4 items-end">
            <div className="w-40">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Menunggu</SelectItem>
                  <SelectItem value="approved">Disetujui</SelectItem>
                  <SelectItem value="rejected">Ditolak</SelectItem>
                  <SelectItem value="all">Semua</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipe Akun</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Tipe</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="employee">Karyawan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {stats.pending > 0 && statusFilter !== "pending" && (
              <div className="flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertCircle className="h-4 w-4" />
                {stats.pending} permohonan belum direview
              </div>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Daftar Permohonan
              {data.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({data.length} data)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" /> Memuat data...
              </div>
            ) : data.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                Tidak ada permohonan
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Tipe Akun</TableHead>
                      <TableHead>Perusahaan / Kendaraan</TableHead>
                      <TableHead>Supplier Bridge</TableHead>
                      <TableHead>Tanggal Daftar</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((item) => {
                      const up = item.userProfile;
                      const vp = item.accountType === "vendor" ? (item.typeProfile as VendorProfile | null) : null;
                      const extraInfo =
                        item.accountType === "vendor" ? vp?.companyName :
                        item.accountType === "driver" ? (item.typeProfile as DriverProfile)?.plateNumber :
                        item.accountType === "employee" ? (item.typeProfile as EmployeeProfile)?.companyName :
                        null;

                      return (
                        <TableRow key={item.id} className="hover:bg-muted/30">
                          <TableCell className="text-muted-foreground text-xs pl-4">{item.id}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{up?.fullName ?? item.customerName ?? "—"}</div>
                            {up?.phone && <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{up.phone}</div>}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-muted-foreground">{item.customerEmail ?? "—"}</div>
                          </TableCell>
                          <TableCell>{accountTypeBadge(item.accountType)}</TableCell>
                          <TableCell>
                            <div className="text-sm text-muted-foreground">{extraInfo ?? "—"}</div>
                          </TableCell>
                          <TableCell>
                            {item.accountType === "vendor" && vp ? (
                              vp.supplierId ? (
                                <div className="flex items-center gap-1 text-xs text-blue-700">
                                  <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                                  #{vp.supplierId}
                                </div>
                              ) : item.status === "approved" ? (
                                <span className="text-xs text-yellow-600 flex items-center gap-1">
                                  <ShieldAlert className="h-3.5 w-3.5" /> Belum sync
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{fmt(item.createdAt)}</div>
                          </TableCell>
                          <TableCell>{statusBadge(item.status)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedItem(item)}
                            >
                              <Eye className="h-3 w-3 mr-1" /> Detail
                              {item.status === "pending" && (
                                <span className="ml-1 h-2 w-2 rounded-full bg-amber-400 inline-block"></span>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail Dialog */}
      {selectedItem && (
        <DetailDialog
          item={selectedItem}
          open={!!selectedItem}
          onClose={() => setSelectedItem(null)}
          onApprove={(id, note, by) => actMutation.mutate({ id, status: "approved", adminNote: note, reviewedBy: by })}
          onReject={(id, note, by) => actMutation.mutate({ id, status: "rejected", adminNote: note, reviewedBy: by })}
          isActing={actMutation.isPending}
        />
      )}

      {/* Vendor Lifecycle Result Dialog */}
      {vendorLifecycleResult && (
        <VendorLifecycleResultDialog
          result={vendorLifecycleResult.result}
          vendorName={vendorLifecycleResult.vendorName}
          onClose={() => setVendorLifecycleResult(null)}
        />
      )}
    </AppShell>
  );
}
