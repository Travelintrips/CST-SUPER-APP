import {
  useListEmailCorrespondencesByTransaction,
  useValidateEmailLink,
  getListEmailCorrespondencesByTransactionQueryKey,
  type TransactionEmailCorrespondence,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Paperclip, ShieldCheck, CheckCircle2, Download, FileImage, Loader2, ExternalLink,
} from "lucide-react";
import { Link, useLocation } from "wouter";

function useNavigate() {
  const [, setLocation] = useLocation();
  return setLocation;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  linked: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  validated: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  archived: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Baru",
  linked: "Ditautkan",
  validated: "Divalidasi",
  rejected: "Ditolak",
  archived: "Diarsipkan",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function resolveFileUrl(fileUrl: string) {
  if (!fileUrl) return null;
  if (fileUrl.startsWith("/objects/")) return `/api/storage${fileUrl}`;
  if (fileUrl.startsWith("/api/")) return fileUrl;
  return fileUrl;
}

function isImage(mimeType?: string | null, fileName?: string) {
  if (mimeType?.startsWith("image/")) return true;
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext ?? "");
  }
  return false;
}

interface CorrespondenceTabProps {
  linkedType: "sales_order" | "purchase_order" | "expense" | "shipment" | "payment" | "invoice";
  linkedId: number;
}

export function CorrespondenceTab({ linkedType, linkedId }: CorrespondenceTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const params = useMemo(() => ({ linkedType, linkedId }), [linkedType, linkedId]);

  const { data = [], isLoading } = useListEmailCorrespondencesByTransaction(params, {
    query: { queryKey: getListEmailCorrespondencesByTransactionQueryKey(params), enabled: linkedId > 0 },
  });

  const validateLink = useValidateEmailLink();

  function handleValidate(item: TransactionEmailCorrespondence) {
    if (!item.email) return;
    validateLink.mutate(
      { id: item.email.id, linkId: item.link.id, data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmailCorrespondencesByTransactionQueryKey(params) });
          toast({ title: "Link divalidasi" });
        },
        onError: () => toast({ title: "Gagal memvalidasi", variant: "destructive" }),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground border border-dashed rounded-lg">
        <Mail className="h-9 w-9 mb-2 opacity-30" />
        <p className="font-medium text-sm">Belum ada email yang ditautkan</p>
        <p className="text-xs mt-1">
          Tautkan email dari{" "}
          <Link href="/email-inbox" className="underline text-primary">Kotak Masuk Email</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.link.id} className="border rounded-lg overflow-hidden">
          {/* Email header */}
          <div className="p-3 bg-muted/20">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {item.email && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.email.status] ?? STATUS_COLORS["new"]}`}
                    >
                      {STATUS_LABELS[item.email.status] ?? item.email.status}
                    </span>
                  )}
                  {item.link.isValidated ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <CheckCircle2 className="h-3 w-3" /> Divalidasi
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Belum divalidasi</span>
                  )}
                </div>
                <p className="font-medium text-sm truncate">
                  {item.email?.subject ?? "(tanpa subjek)"}
                </p>
                {item.email?.fromEmail && (
                  <p className="text-xs text-muted-foreground truncate">
                    Dari: {item.email.fromEmail}
                  </p>
                )}
                {item.email?.receivedAt && (
                  <p className="text-xs text-muted-foreground">{formatDateTime(item.email.receivedAt)}</p>
                )}
                {item.link.linkReason && (
                  <p className="text-xs text-muted-foreground mt-0.5 italic">
                    Alasan: {item.link.linkReason}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                {item.email && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 h-7 text-xs text-muted-foreground"
                    onClick={() => navigate(`/email-inbox?emailId=${item.email!.id}`)}
                    title="Buka email lengkap di inbox"
                  >
                    <ExternalLink className="h-3 w-3" /> Buka Email
                  </Button>
                )}
                {!item.link.isValidated && item.email && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 h-7 text-xs"
                    onClick={() => handleValidate(item)}
                    disabled={validateLink.isPending}
                  >
                    {validateLink.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <ShieldCheck className="h-3 w-3" />}
                    Validasi
                  </Button>
                )}
                {item.link.validatedBy && item.link.validatedAt && (
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(item.link.validatedAt)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Body preview */}
          {item.email?.body && (
            <div className="px-3 py-2 border-t">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3 leading-relaxed">
                {item.email.body.slice(0, 300)}
                {item.email.body.length > 300 && "…"}
              </p>
            </div>
          )}

          {/* Attachments */}
          {item.attachments.length > 0 && (
            <div className="border-t px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> Lampiran ({item.attachments.length})
              </p>
              <div className="space-y-1.5">
                {item.attachments.map((att) => {
                  const url = resolveFileUrl(att.fileUrl);
                  return (
                    <div key={att.id} className="border rounded overflow-hidden">
                      {isImage(att.mimeType, att.fileName) && url && (
                        <a href={url} target="_blank" rel="noreferrer">
                          <img
                            src={url}
                            alt={att.fileName}
                            className="w-full max-h-32 object-contain bg-muted"
                          />
                        </a>
                      )}
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/20">
                        <FileImage className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate flex-1">{att.fileName}</span>
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer" download>
                            <Button size="icon" variant="ghost" className="h-6 w-6">
                              <Download className="h-3 w-3" />
                            </Button>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
