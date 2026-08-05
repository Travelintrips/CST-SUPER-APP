import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, FileText, History, Star, Upload, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

type SupplierStatus = "pending" | "active" | "inactive" | "suspended" | "blacklisted" | "archived";
type MarketplaceStatus = "draft" | "published" | "unpublished";

const STATUS_BADGE_CLASS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  inactive: "bg-gray-100 text-gray-700",
  suspended: "bg-orange-100 text-orange-800",
  blacklisted: "bg-red-100 text-red-800",
  archived: "bg-slate-100 text-slate-600",
};

async function jsonFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.message ?? data.error ?? `Request gagal (${r.status})`);
  }
  return r.json();
}

interface VendorStatusPanelProps {
  vendorId: number;
}

export function VendorStatusPanel({ vendorId }: VendorStatusPanelProps) {
  const { t, locale } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const summaryKey = ["vendor-status-summary", vendorId];
  const docsKey = ["vendor-status-documents", vendorId];
  const historyKey = ["vendor-status-history", vendorId];
  const reviewsKey = ["vendor-status-reviews", vendorId];

  const STATUS_OPTIONS: { value: SupplierStatus; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "active", label: t.vendorStatus.aktif },
    { value: "inactive", label: t.vendorStatus.nonaktif },
    { value: "suspended", label: t.vendorStatus.ditangguhkan },
    { value: "blacklisted", label: "Blacklist" },
    { value: "archived", label: t.vendorStatus.diarsipkan },
  ];

  const MARKETPLACE_OPTIONS: { value: MarketplaceStatus; label: string }[] = [
    { value: "draft", label: "Draft" },
    { value: "published", label: t.vendorStatus.dipublikasikan },
    { value: "unpublished", label: t.vendorStatus.ditarikDariMarketplace },
  ];

  const summary = useQuery({
    queryKey: summaryKey,
    queryFn: () => jsonFetch(`/api/vendor-status/${vendorId}`),
  });
  const docs = useQuery({
    queryKey: docsKey,
    queryFn: () => jsonFetch(`/api/vendor-status/${vendorId}/documents`),
  });
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => jsonFetch(`/api/vendor-status/${vendorId}/status-history`),
  });
  const reviews = useQuery({
    queryKey: reviewsKey,
    queryFn: () => jsonFetch(`/api/vendor-status/${vendorId}/reviews`),
  });

  const [newStatus, setNewStatus] = useState<SupplierStatus | "">("");
  const [statusReason, setStatusReason] = useState("");
  const [docType, setDocType] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);

  const statusMutation = useMutation({
    mutationFn: (payload: { status: SupplierStatus; reason: string }) =>
      jsonFetch(`/api/vendor-status/${vendorId}/status`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: () => {
      toast({ title: t.vendorStatus.statusDiperbarui });
      setNewStatus("");
      setStatusReason("");
      qc.invalidateQueries({ queryKey: summaryKey });
      qc.invalidateQueries({ queryKey: historyKey });
    },
    onError: (e: any) => toast({ variant: "destructive", title: t.vendorStatus.gagalUbahStatus, description: e?.message }),
  });

  const verifyMutation = useMutation({
    mutationFn: () => jsonFetch(`/api/vendor-status/${vendorId}/verify`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: t.vendorStatus.vendorTerverifikasi });
      qc.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (e: any) => toast({ variant: "destructive", title: t.vendorStatus.gagalVerifikasi, description: e?.message }),
  });

  const marketplaceMutation = useMutation({
    mutationFn: (marketplaceStatus: MarketplaceStatus) =>
      jsonFetch(`/api/vendor-status/${vendorId}/marketplace-status`, { method: "PATCH", body: JSON.stringify({ marketplaceStatus }) }),
    onSuccess: () => {
      toast({ title: t.vendorStatus.statusMarketplaceDiperbarui });
      qc.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (e: any) => toast({ variant: "destructive", title: t.vendorStatus.gagalUbahStatus, description: e?.message }),
  });

  const uploadDocMutation = useMutation({
    mutationFn: async () => {
      if (!docType.trim()) throw new Error(t.vendorStatus.jenisDokumenWajib);
      const fd = new FormData();
      fd.append("documentType", docType.trim());
      if (docFile) fd.append("file", docFile);
      const r = await fetch(`/api/vendor-status/${vendorId}/documents`, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? t.vendorStatus.gagalUploadDokumen);
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: t.vendorStatus.dokumenTersimpan });
      setDocType("");
      setDocFile(null);
      qc.invalidateQueries({ queryKey: docsKey });
      qc.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (e: any) => toast({ variant: "destructive", title: t.vendorStatus.gagalUploadDokumen, description: e?.message }),
  });

  const verifyDocMutation = useMutation({
    mutationFn: (payload: { docId: number; verificationStatus: "verified" | "rejected" }) =>
      jsonFetch(`/api/vendor-status/${vendorId}/documents/${payload.docId}`, {
        method: "PATCH",
        body: JSON.stringify({ verificationStatus: payload.verificationStatus }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: docsKey });
      qc.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (e: any) => toast({ variant: "destructive", title: t.vendorStatus.gagalUploadDokumen, description: e?.message }),
  });

  const deleteDocMutation = useMutation({
    mutationFn: (docId: number) => jsonFetch(`/api/vendor-status/${vendorId}/documents/${docId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: t.vendorStatus.dokumenDihapus });
      qc.invalidateQueries({ queryKey: docsKey });
    },
    onError: (e: any) => toast({ variant: "destructive", title: t.vendorStatus.gagalUploadDokumen, description: e?.message }),
  });

  const moderateReviewMutation = useMutation({
    mutationFn: (payload: { reviewId: number; moderationStatus: "approved" | "rejected"; isPublished: boolean }) =>
      jsonFetch(`/api/vendor-status/${vendorId}/reviews/${payload.reviewId}`, {
        method: "PATCH",
        body: JSON.stringify({ moderationStatus: payload.moderationStatus, isPublished: payload.isPublished }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reviewsKey }),
    onError: (e: any) => toast({ variant: "destructive", title: t.vendorStatus.gagalModerasiReview, description: e?.message }),
  });

  if (summary.isLoading) {
    return <Card><CardContent className="pt-4 pb-3 text-sm text-muted-foreground">{t.vendorStatus.memuatStatus}</CardContent></Card>;
  }
  if (summary.isError || !summary.data) {
    // Backend belum siap / gagal — sembunyikan panel daripada menampilkan tombol yang rusak.
    return null;
  }

  const s = summary.data as {
    status: SupplierStatus; isVerified: boolean; marketplaceStatus: MarketplaceStatus;
    transactionAllowed: boolean; transactionBlockReason: string | null;
    documentWarnings: { documentType: string; message: string; severity: string }[];
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> {t.vendorStatus.statusLegalitas}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${STATUS_BADGE_CLASS[s.status] ?? "bg-gray-100 text-gray-700"} text-xs`}>
              {STATUS_OPTIONS.find((o) => o.value === s.status)?.label ?? s.status}
            </Badge>
            {s.isVerified
              ? <Badge className="bg-blue-100 text-blue-800 text-xs">{t.vendorStatus.terverifikasi}</Badge>
              : <Badge variant="outline" className="text-xs text-muted-foreground">{t.vendorStatus.belumTerverifikasi}</Badge>}
            <Badge variant="outline" className="text-xs">
              {t.vendorStatus.marketplace}: {MARKETPLACE_OPTIONS.find((o) => o.value === s.marketplaceStatus)?.label ?? s.marketplaceStatus}
            </Badge>
          </div>
        </div>
        {!s.transactionAllowed && (
          <p className="text-xs text-destructive mt-1">⚠️ {t.vendorStatus.vendorTidakBisaTransaksi}: {s.transactionBlockReason}</p>
        )}
        {s.documentWarnings?.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {s.documentWarnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600">⚠️ {w.message}</p>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="status">
          <TabsList className="w-full flex-wrap h-auto">
            <TabsTrigger value="status" className="flex-1">{t.vendorStatus.ubahStatus}</TabsTrigger>
            <TabsTrigger value="documents" className="flex-1"><FileText className="h-3.5 w-3.5 mr-1" />{t.vendorStatus.dokumen}</TabsTrigger>
            <TabsTrigger value="history" className="flex-1"><History className="h-3.5 w-3.5 mr-1" />{t.vendorStatus.riwayat}</TabsTrigger>
            <TabsTrigger value="reviews" className="flex-1"><Star className="h-3.5 w-3.5 mr-1" />{t.vendorStatus.review}</TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="mt-3 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t.vendorStatus.statusBaru}</Label>
                <Select value={newStatus} onValueChange={(v) => setNewStatus(v as SupplierStatus)}>
                  <SelectTrigger><SelectValue placeholder={t.vendorStatus.pilihStatus} /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t.vendorStatus.statusMarketplace}</Label>
                <Select value={s.marketplaceStatus} onValueChange={(v) => marketplaceMutation.mutate(v as MarketplaceStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MARKETPLACE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t.vendorStatus.alasanOpsional}</Label>
              <Textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} rows={2} placeholder="cth. Vendor tidak responsif 30 hari" />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!newStatus || statusMutation.isPending}
                onClick={() => newStatus && statusMutation.mutate({ status: newStatus, reason: statusReason })}
              >
                {t.vendorStatus.terapkanStatus}
              </Button>
              {!s.isVerified && (
                <Button size="sm" variant="outline" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {t.vendorStatus.verifikasiVendor}
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-3 grid gap-3">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="grid gap-1.5">
                <Label>{t.vendorStatus.jenisDokumen}</Label>
                <Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="cth. NPWP, NIB, SIUP" className="w-40" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t.vendorStatus.fileOpsional}</Label>
                <Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} className="w-56" />
              </div>
              <Button size="sm" onClick={() => uploadDocMutation.mutate()} disabled={uploadDocMutation.isPending}>
                <Upload className="h-3.5 w-3.5 mr-1" /> {t.vendorStatus.simpanDokumen}
              </Button>
            </div>
            <div className="grid gap-2">
              {(docs.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t.common.noData}</p>}
              {(docs.data ?? []).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between border rounded p-2 text-sm">
                  <div>
                    <span className="font-medium">{d.documentType}</span>
                    {d.documentNumber && <span className="text-muted-foreground ml-2">{d.documentNumber}</span>}
                    {d.expiresAt && <span className="text-xs text-muted-foreground ml-2">{t.vendorStatus.kadaluarsa} {d.expiresAt}</span>}
                    <Badge
                      className={`ml-2 text-xs ${
                        d.verificationStatus === "verified" ? "bg-green-100 text-green-800"
                          : d.verificationStatus === "rejected" ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {d.verificationStatus}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {d.verificationStatus !== "verified" && (
                      <Button size="sm" variant="ghost" onClick={() => verifyDocMutation.mutate({ docId: d.id, verificationStatus: "verified" })}>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                    )}
                    {d.verificationStatus !== "rejected" && (
                      <Button size="sm" variant="ghost" onClick={() => verifyDocMutation.mutate({ docId: d.id, verificationStatus: "rejected" })}>
                        <XCircle className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deleteDocMutation.mutate(d.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            <div className="grid gap-2">
              {(history.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t.common.noData}</p>}
              {(history.data ?? []).map((h: any) => (
                <div key={h.id} className="text-sm border-l-2 border-muted pl-3 py-1">
                  <span className="font-medium">{h.previousStatus ?? "—"} → {h.newStatus}</span>
                  {h.reason && <span className="text-muted-foreground"> · {h.reason}</span>}
                  <div className="text-xs text-muted-foreground">
                    {h.actorUserId ?? "system"} · {h.createdAt ? new Date(h.createdAt).toLocaleString(locale) : ""}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="reviews" className="mt-3">
            <div className="grid gap-2">
              {(reviews.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t.common.noData}</p>}
              {(reviews.data ?? []).map((r: any) => (
                <div key={r.id} className="border rounded p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">⭐ {r.ratingOverall}</span>
                    <Badge
                      className={`text-xs ${
                        r.moderationStatus === "approved" ? "bg-green-100 text-green-800"
                          : r.moderationStatus === "rejected" ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {r.moderationStatus}
                    </Badge>
                  </div>
                  {r.reviewText && <p className="text-muted-foreground mt-1">{r.reviewText}</p>}
                  {r.moderationStatus === "pending" && (
                    <div className="flex items-center gap-2 mt-2">
                      <Button size="sm" variant="outline" onClick={() => moderateReviewMutation.mutate({ reviewId: r.id, moderationStatus: "approved", isPublished: true })}>
                        {t.vendorStatus.setujuiPublikasikan}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => moderateReviewMutation.mutate({ reviewId: r.id, moderationStatus: "rejected", isPublished: false })}>
                        {t.vendorStatus.tolak}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
