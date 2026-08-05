import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowLeft, CheckCircle, XCircle, AlertCircle, RefreshCw,
  Building2, User, FileText, Shield, ShieldCheck, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Profile {
  id: number;
  companyName: string | null;
  npwp: string | null;
  nib: string | null;
  companyAddress: string | null;
  picName: string | null;
  picWhatsapp: string | null;
  picEmail: string | null;
  legalDocUrl: string | null;
  ktpPicUrl: string | null;
  suratKuasaUrl: string | null;
  apiNikIzinUrl: string | null;
  additionalNotes: string | null;
  profileStatus: string;
  isVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

interface CSRItem {
  id: number;
  sequenceNo: number;
  serviceType: string;
  serviceDetail: string | null;
  status: string;
  vendorNotes: string | null;
  originPort: string | null;
  destPort: string | null;
  commodity: string | null;
  quantity: number | null;
  weight: number | null;
  weightUnit: string | null;
  containerType: string | null;
  specialRequirements: string | null;
  formData: Record<string, unknown>;
}

interface CSRDocument {
  id: number;
  docType: string;
  fileUrl: string;
  fileName: string | null;
  notes: string | null;
}

interface CSRDetail {
  id: number;
  requestNumber: string;
  status: string;
  tradeType: string;
  mode: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCompany: string | null;
  adminNotes: string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
  items: CSRItem[];
  documents: CSRDocument[];
  profile: Profile | null;
  customerAccount: { id: number; name: string; email: string; role: string; createdAt: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", need_review: "Perlu Review",
  need_more_data: "Butuh Data Tambahan", approved_for_rfq: "Disetujui → RFQ",
  rejected: "Ditolak", cancelled: "Dibatalkan",
};
const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-800", need_review: "bg-yellow-100 text-yellow-800",
  need_more_data: "bg-orange-100 text-orange-800", approved_for_rfq: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800", draft: "bg-gray-100 text-gray-700",
  cancelled: "bg-slate-100 text-slate-600",
};
const ITEM_STATUS_LABELS: Record<string, string> = {
  pending: "Pending", approved: "Disetujui", rejected: "Ditolak",
  need_more_data: "Butuh Data", quoted: "Diquote", accepted: "Diterima",
};
const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700", approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800", need_more_data: "bg-orange-100 text-orange-800",
  quoted: "bg-blue-100 text-blue-800", accepted: "bg-emerald-100 text-emerald-800",
};

export default function ServiceRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [detail, setDetail] = useState<CSRDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");
  const [handledBy, setHandledBy] = useState("");
  const [showMoreDataDialog, setShowMoreDataDialog] = useState(false);
  const [moreDataMsg, setMoreDataMsg] = useState("");
  const [itemStatusDialog, setItemStatusDialog] = useState<{ itemId: number; currentStatus: string } | null>(null);
  const [itemNotes, setItemNotes] = useState("");
  const [newItemStatus, setNewItemStatus] = useState("");

  async function fetchDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/service-requests/${params.id}`);
      if (!res.ok) throw new Error("Gagal fetch");
      const data = await res.json();
      setDetail(data);
      setAdminNotes(data.adminNotes ?? "");
      setHandledBy(data.handledBy ?? "");
    } catch {
      toast({ title: "Error", description: "Gagal memuat detail CSR", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDetail(); }, [params.id]);

  async function updateStatus(status: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/service-requests/${params.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNotes, handledBy }),
      });
      if (!res.ok) throw new Error("Gagal update");
      toast({ title: "Status diperbarui", description: `CSR diubah ke: ${STATUS_LABELS[status] ?? status}` });
      fetchDetail();
    } catch {
      toast({ title: "Error", description: "Gagal mengubah status", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  }

  async function requestMoreData() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/service-requests/${params.id}/request-more-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: moreDataMsg, handledBy }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Permintaan data dikirim" });
      setShowMoreDataDialog(false);
      fetchDetail();
    } catch {
      toast({ title: "Error", description: "Gagal", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  }

  async function updateItemStatus() {
    if (!itemStatusDialog || !newItemStatus) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/service-requests/${params.id}/items/${itemStatusDialog.itemId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newItemStatus, vendorNotes: itemNotes }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Status item diperbarui" });
      setItemStatusDialog(null);
      fetchDetail();
    } catch {
      toast({ title: "Error", description: "Gagal mengubah status item", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  }

  async function verifyProfile() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/service-requests/${params.id}/verify-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifiedBy: handledBy }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Profil diverifikasi" });
      fetchDetail();
    } catch {
      toast({ title: "Error", description: "Gagal verifikasi profil", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return <AppShell><div className="p-8 text-center text-muted-foreground">Memuat...</div></AppShell>;
  }
  if (!detail) {
    return <AppShell><div className="p-8 text-center text-muted-foreground">CSR tidak ditemukan</div></AppShell>;
  }

  const p = detail.profile;
  const profileComplete = p && ["companyName", "npwp", "nib", "companyAddress", "picName", "picWhatsapp", "picEmail"]
    .every((f) => !!(p as unknown as Record<string, unknown>)[f]);

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/logistics/service-requests")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold">{detail.requestNumber}</h1>
              <span className={`rounded px-2.5 py-1 text-sm font-medium ${STATUS_COLORS[detail.status] ?? "bg-gray-100"}`}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </span>
              <span className="text-sm text-muted-foreground uppercase">{detail.tradeType} · {detail.mode ?? "-"}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Masuk {detail.createdAt ? format(new Date(detail.createdAt), "dd MMM yyyy HH:mm", { locale: localeId }) : "-"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* LEFT: Info + Actions */}
          <div className="md:col-span-1 space-y-4">
            {/* Customer Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" /> Data Pemohon
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Nama:</span> <span className="font-medium ml-1">{detail.customerName}</span></div>
                <div><span className="text-muted-foreground">Email:</span> <span className="ml-1">{detail.customerEmail}</span></div>
                <div><span className="text-muted-foreground">Telp:</span> <span className="ml-1">{detail.customerPhone || "-"}</span></div>
                <div><span className="text-muted-foreground">Perusahaan:</span> <span className="ml-1">{detail.customerCompany || "-"}</span></div>
                {detail.customerAccount && (
                  <div className="pt-1 text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                    Pelanggan terdaftar (ID: {detail.customerAccount.id})
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Profile Verification */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Profil Perusahaan
                  {p?.isVerified
                    ? <ShieldCheck className="h-4 w-4 text-green-600" />
                    : <Shield className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {!p ? (
                  <p className="text-muted-foreground text-xs">Belum ada data profil</p>
                ) : (
                  <>
                    <div><span className="text-muted-foreground">Nama PT:</span> <span className="font-medium ml-1">{p.companyName || "-"}</span></div>
                    <div><span className="text-muted-foreground">NPWP:</span> <span className="ml-1 font-mono">{p.npwp || "-"}</span></div>
                    <div><span className="text-muted-foreground">NIB:</span> <span className="ml-1 font-mono">{p.nib || "-"}</span></div>
                    <div><span className="text-muted-foreground">Alamat:</span> <span className="ml-1">{p.companyAddress || "-"}</span></div>
                    <Separator className="my-2" />
                    <div><span className="text-muted-foreground">PIC:</span> <span className="ml-1 font-medium">{p.picName || "-"}</span></div>
                    <div><span className="text-muted-foreground">WA PIC:</span> <span className="ml-1">{p.picWhatsapp || "-"}</span></div>
                    <div><span className="text-muted-foreground">Email PIC:</span> <span className="ml-1">{p.picEmail || "-"}</span></div>
                    <Separator className="my-2" />
                    <div className="text-xs space-y-1">
                      {p.legalDocUrl && <a href={p.legalDocUrl} target="_blank" rel="noopener noreferrer" className="block text-blue-600 underline">📄 Dok. Legal</a>}
                      {p.ktpPicUrl && <a href={p.ktpPicUrl} target="_blank" rel="noopener noreferrer" className="block text-blue-600 underline">🪪 KTP PIC</a>}
                      {p.suratKuasaUrl && <a href={p.suratKuasaUrl} target="_blank" rel="noopener noreferrer" className="block text-blue-600 underline">📃 Surat Kuasa</a>}
                      {p.apiNikIzinUrl && <a href={p.apiNikIzinUrl} target="_blank" rel="noopener noreferrer" className="block text-blue-600 underline">📋 API/NIK Izin</a>}
                    </div>
                    {p.isVerified ? (
                      <div className="text-xs text-green-700 bg-green-50 rounded px-2 py-1 mt-2">
                        ✓ Diverifikasi oleh {p.verifiedBy ?? "admin"}
                        {p.verifiedAt ? ` pada ${format(new Date(p.verifiedAt), "dd MMM yyyy", { locale: localeId })}` : ""}
                      </div>
                    ) : profileComplete ? (
                      <Button size="sm" variant="outline" className="w-full mt-2" onClick={verifyProfile} disabled={actionLoading}>
                        <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Verifikasi Profil
                      </Button>
                    ) : (
                      <div className="text-xs text-orange-700 bg-orange-50 rounded px-2 py-1 mt-2">
                        ⚠ Profil belum lengkap
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Aksi Screening</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ditangani oleh</Label>
                  <Input
                    placeholder="Nama CSR / admin"
                    value={handledBy}
                    onChange={(e) => setHandledBy(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Catatan admin</Label>
                  <Textarea
                    placeholder="Catatan internal..."
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    className="text-sm resize-none"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => updateStatus("approved_for_rfq")}
                    disabled={actionLoading}
                  >
                    <CheckCircle className="h-4 w-4 mr-1.5" /> Setujui → RFQ
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                    onClick={() => { setMoreDataMsg(adminNotes); setShowMoreDataDialog(true); }}
                    disabled={actionLoading}
                  >
                    <AlertCircle className="h-4 w-4 mr-1.5" /> Minta Data Tambahan
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-red-300 text-red-700 hover:bg-red-50"
                    onClick={() => updateStatus("rejected")}
                    disabled={actionLoading}
                  >
                    <XCircle className="h-4 w-4 mr-1.5" /> Tolak Request
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT: Items + Docs */}
          <div className="md:col-span-2 space-y-4">
            {/* Service Items */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Item Layanan ({detail.items.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {detail.items.length === 0 ? (
                  <p className="text-muted-foreground text-sm p-4">Tidak ada item layanan</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Layanan</TableHead>
                        <TableHead>Rute</TableHead>
                        <TableHead>Komoditas</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-muted-foreground text-xs">{item.sequenceNo}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{item.serviceType}</div>
                            {item.serviceDetail && (
                              <div className="text-xs text-muted-foreground">{item.serviceDetail}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.originPort && item.destPort
                              ? `${item.originPort} → ${item.destPort}`
                              : item.originPort ?? item.destPort ?? "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div>{item.commodity || "-"}</div>
                            {item.weight && (
                              <div className="text-xs text-muted-foreground">
                                {item.weight} {item.weightUnit ?? "kg"}
                              </div>
                            )}
                            {item.containerType && (
                              <div className="text-xs text-muted-foreground">{item.containerType}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${ITEM_STATUS_COLORS[item.status] ?? "bg-gray-100"}`}>
                              {ITEM_STATUS_LABELS[item.status] ?? item.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setItemStatusDialog({ itemId: item.id, currentStatus: item.status });
                                setNewItemStatus(item.status);
                                setItemNotes(item.vendorNotes ?? "");
                              }}
                            >
                              Ubah Status
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Documents */}
            {detail.documents.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Dokumen Pendukung</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {detail.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between text-sm p-2 rounded border">
                        <div>
                          <span className="font-medium">{doc.docType}</span>
                          {doc.fileName && <span className="text-muted-foreground ml-2 text-xs">({doc.fileName})</span>}
                          {doc.notes && <div className="text-xs text-muted-foreground mt-0.5">{doc.notes}</div>}
                        </div>
                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs underline">
                          Lihat
                        </a>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes history */}
            {detail.adminNotes && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Catatan Admin Terakhir
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.adminNotes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Dialog: Request More Data */}
      <Dialog open={showMoreDataDialog} onOpenChange={setShowMoreDataDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Minta Data Tambahan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Pesan untuk pelanggan</Label>
            <Textarea
              placeholder="Jelaskan data/dokumen apa yang kurang..."
              value={moreDataMsg}
              onChange={(e) => setMoreDataMsg(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoreDataDialog(false)}>Batal</Button>
            <Button onClick={requestMoreData} disabled={actionLoading || !moreDataMsg.trim()}>
              Kirim Permintaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Update Item Status */}
      <Dialog open={!!itemStatusDialog} onOpenChange={() => setItemStatusDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Status Item Layanan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Status baru</Label>
              <Select value={newItemStatus} onValueChange={setNewItemStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ITEM_STATUS_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea
                placeholder="Catatan untuk item ini..."
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemStatusDialog(null)}>Batal</Button>
            <Button onClick={updateItemStatus} disabled={actionLoading}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
