/**
 * PPJK Phase 5+6 — Document checklist with upload, verify, reject flow
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle, XCircle, Clock, Upload, AlertTriangle, FileText,
  Loader2, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface ChecklistItem {
  id: number;
  docType: string;
  docLabel: string;
  status: "pending" | "uploaded" | "verified" | "rejected";
  isRequired: boolean;
  fileUrl?: string | null;
  fileName?: string | null;
  rejectionReason?: string | null;
  verifiedBy?: string | null;
  uploadedBy?: string | null;
}

interface ChecklistSummary {
  total: number;
  uploaded: number;
  verified: number;
  rejected: number;
  pending: number;
  missingRequired: number;
}

interface Props {
  orderId: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: "Menunggu",   color: "bg-gray-100 text-gray-600 border-gray-200",     icon: <Clock className="w-3 h-3" /> },
  uploaded: { label: "Diunggah",   color: "bg-blue-100 text-blue-700 border-blue-200",     icon: <Upload className="w-3 h-3" /> },
  verified: { label: "Terverifikasi", color: "bg-green-100 text-green-700 border-green-200", icon: <CheckCircle className="w-3 h-3" /> },
  rejected: { label: "Ditolak",    color: "bg-red-100 text-red-700 border-red-200",        icon: <XCircle className="w-3 h-3" /> },
};

export function PpjkChecklist({ orderId }: Props) {
  const qc = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<ChecklistItem | null>(null);
  const [actionType, setActionType] = useState<"upload" | "verify" | "reject" | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const { data, isLoading, refetch } = useQuery<{ items: ChecklistItem[]; summary: ChecklistSummary; readyToSubmit: boolean }>({
    queryKey: ["ppjk-checklist", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/ppjk/orders/${orderId}/checklist`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat checklist");
      return r.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!selectedItem) throw new Error("No item selected");
      const r = await fetch(`/api/ppjk/orders/${orderId}/checklist/${selectedItem.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Checklist diperbarui");
      qc.invalidateQueries({ queryKey: ["ppjk-checklist", orderId] });
      setSelectedItem(null);
      setActionType(null);
      setFileUrl("");
      setFileName("");
      setRejectionReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openAction(item: ChecklistItem, action: "upload" | "verify" | "reject") {
    setSelectedItem(item);
    setActionType(action);
    setFileUrl(item.fileUrl ?? "");
    setFileName(item.fileName ?? "");
    setRejectionReason(item.rejectionReason ?? "");
  }

  function submitAction() {
    if (!actionType) return;
    if (actionType === "upload") mutation.mutate({ status: "uploaded", fileUrl, fileName });
    if (actionType === "verify") mutation.mutate({ status: "verified" });
    if (actionType === "reject") mutation.mutate({ status: "rejected", rejectionReason });
  }

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Memuat checklist...</div>;

  const items = data?.items ?? [];
  const summary = data?.summary;
  const readyToSubmit = data?.readyToSubmit ?? false;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      {summary && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Progress:</span>
            <span className="font-semibold text-green-700">{summary.verified} terverifikasi</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-blue-700">{summary.uploaded} diunggah</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-gray-500">{summary.pending ?? (summary.total - summary.uploaded - summary.verified - summary.rejected)} menunggu</span>
            {summary.rejected > 0 && (
              <><span className="text-muted-foreground">·</span><span className="text-red-600">{summary.rejected} ditolak</span></>
            )}
          </div>
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-32">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${summary.total > 0 ? (summary.verified / summary.total) * 100 : 0}%` }}
            />
          </div>
          {readyToSubmit ? (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">✓ Siap Submit</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {summary.missingRequired} wajib kurang
            </Badge>
          )}
          <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Checklist items */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Belum ada checklist dokumen</p>
      ) : (
        <div className="divide-y rounded-lg border overflow-hidden">
          {items.map((item) => {
            const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-muted/20 transition-colors">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{item.docLabel}</p>
                    {item.isRequired && <span className="text-[10px] text-red-500 font-semibold">WAJIB</span>}
                  </div>
                  {item.fileName && <p className="text-xs text-muted-foreground truncate">{item.fileName}</p>}
                  {item.rejectionReason && <p className="text-xs text-red-500 mt-0.5">Ditolak: {item.rejectionReason}</p>}
                </div>
                <Badge className={`text-xs border flex items-center gap-1 shrink-0 ${cfg.color}`}>
                  {cfg.icon}{cfg.label}
                </Badge>
                <div className="flex gap-1 shrink-0">
                  {item.fileUrl && (
                    <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Lihat</a>
                  )}
                  {item.status !== "verified" && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => openAction(item, "upload")}>
                      Upload
                    </Button>
                  )}
                  {item.status === "uploaded" && (
                    <>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-green-700" onClick={() => openAction(item, "verify")}>
                        Verifikasi
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-red-600" onClick={() => openAction(item, "reject")}>
                        Tolak
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action dialog */}
      <Dialog open={!!selectedItem && !!actionType} onOpenChange={() => { setSelectedItem(null); setActionType(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionType === "upload" ? "Upload Dokumen" :
               actionType === "verify" ? "Verifikasi Dokumen" : "Tolak Dokumen"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm font-medium">{selectedItem?.docLabel}</p>
            {actionType === "upload" && (
              <>
                <div className="space-y-1.5">
                  <Label>URL File / Object Path</Label>
                  <Input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://... atau /storage/..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Nama File</Label>
                  <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="invoice.pdf" />
                </div>
              </>
            )}
            {actionType === "verify" && (
              <p className="text-sm text-muted-foreground">Dokumen ini akan ditandai sebagai terverifikasi.</p>
            )}
            {actionType === "reject" && (
              <div className="space-y-1.5">
                <Label>Alasan Penolakan *</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  className="resize-none"
                  placeholder="Dokumen tidak lengkap, format salah, dll."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedItem(null); setActionType(null); }}>Batal</Button>
            <Button
              onClick={submitAction}
              disabled={mutation.isPending || (actionType === "reject" && !rejectionReason)}
              variant={actionType === "reject" ? "destructive" : "default"}
            >
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {actionType === "upload" ? "Simpan" : actionType === "verify" ? "Verifikasi" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
