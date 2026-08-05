import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { QueryState } from "@/components/ui/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useListAiDraftQuotations,
  useListAiIntakeLog,
  useForwardSalesDocumentToVendors,
  useListEligibleVendorsForDoc,
  useSalesDocumentAction,
  getListAiDraftQuotationsQueryKey,
  getListAiIntakeLogQueryKey,
  getListEligibleVendorsForDocQueryKey,
  getListSalesDocumentsQueryKey,
  type SalesDocument,
  type ForwardToVendorsBodyChannelsItem,
  type VendorSendResult,
  type AiIntakeLogEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowLeft, Bot, ExternalLink, SendHorizonal, Trash2, RefreshCw, MessageSquare, Mail, CheckCircle2, MinusCircle, ClipboardList, X, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

function SourceBadge({ doc }: { doc: SalesDocument }) {
  if (doc.aiSourceWaPhone)
    return (
      <Badge variant="outline" className="text-green-400 border-green-700">
        WhatsApp
      </Badge>
    );
  if (doc.aiSourceCorrespondenceId)
    return (
      <Badge variant="outline" className="text-blue-400 border-blue-700">
        Email
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-slate-400 border-slate-600">
      AI
    </Badge>
  );
}

function IntakeSourceBadge({ entry }: { entry: AiIntakeLogEntry }) {
  if (entry.source === "wa")
    return (
      <Badge variant="outline" className="text-green-600 border-green-400 gap-1">
        <MessageSquare size={10} />
        WhatsApp
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-blue-600 border-blue-400 gap-1">
      <Mail size={10} />
      Email
    </Badge>
  );
}

function HighlightText({ text, query }: { text: string | null; query: string }) {
  if (!text) return null;
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-300/70 text-inherit rounded-[2px] px-0">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function IntakeStatusBadge({ entry }: { entry: AiIntakeLogEntry }) {
  if (entry.status === "created")
    return (
      <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
        <CheckCircle2 size={13} />
        Draft dibuat
      </span>
    );
  if (entry.status === "error")
    return (
      <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
        <MinusCircle size={13} />
        Error
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      <MinusCircle size={13} />
      Dilewati
    </span>
  );
}

export default function AiDraftsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();

  const { data: drafts = [], isLoading, refetch } = useListAiDraftQuotations();
  const { data: intakeLog = [], isLoading: isLogLoading, refetch: refetchLog } = useListAiIntakeLog({
    query: { refetchInterval: 60_000, queryKey: getListAiIntakeLogQueryKey() },
  });
  const forwardMut = useForwardSalesDocumentToVendors();
  const actionMut = useSalesDocumentAction();

  const [forwardDoc, setForwardDoc] = useState<SalesDocument | null>(null);
  const [discardDoc, setDiscardDoc] = useState<SalesDocument | null>(null);
  const [forwardResults, setForwardResults] = useState<VendorSendResult[] | null>(null);

  const [selectedVendorIds, setSelectedVendorIds] = useState<number[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["wa", "email"]);

  // Intake log filters (client-side)
  const LS_SOURCE = "ai-intake-log:source";
  const LS_DATE_FROM = "ai-intake-log:dateFrom";
  const LS_DATE_TO = "ai-intake-log:dateTo";

  const VALID_SOURCES = ["all", "email", "wa"] as const;
  const [logSource, _setLogSource] = useState<"all" | "email" | "wa">(() => {
    const stored = localStorage.getItem(LS_SOURCE);
    return (VALID_SOURCES as readonly string[]).includes(stored ?? "")
      ? (stored as "all" | "email" | "wa")
      : "all";
  });
  const [logDateFrom, _setLogDateFrom] = useState(
    () => localStorage.getItem(LS_DATE_FROM) ?? "",
  );
  const [logDateTo, _setLogDateTo] = useState(
    () => localStorage.getItem(LS_DATE_TO) ?? "",
  );

  function setLogSource(v: "all" | "email" | "wa") {
    _setLogSource(v);
    if (v === "all") localStorage.removeItem(LS_SOURCE);
    else localStorage.setItem(LS_SOURCE, v);
  }
  function setLogDateFrom(v: string) {
    _setLogDateFrom(v);
    if (v === "") localStorage.removeItem(LS_DATE_FROM);
    else localStorage.setItem(LS_DATE_FROM, v);
  }
  function setLogDateTo(v: string) {
    _setLogDateTo(v);
    if (v === "") localStorage.removeItem(LS_DATE_TO);
    else localStorage.setItem(LS_DATE_TO, v);
  }

  const [logSearch, setLogSearch] = useState("");

  // Parse YYYY-MM-DD as local midnight (not UTC) to avoid timezone boundary shift
  const fromDate = logDateFrom ? new Date(logDateFrom + "T00:00:00") : null;
  const toDate = logDateTo ? new Date(logDateTo + "T23:59:59.999") : null;
  // Ignore invalid ranges (from after to) — show all rather than silent zero
  const rangeValid = !fromDate || !toDate || fromDate <= toDate;

  const logSearchLower = logSearch.trim().toLowerCase();

  const filteredLog = intakeLog.filter((entry) => {
    if (logSource !== "all" && entry.source !== logSource) return false;
    if (rangeValid && fromDate) {
      if (new Date(entry.timestamp) < fromDate) return false;
    }
    if (rangeValid && toDate) {
      if (new Date(entry.timestamp) > toDate) return false;
    }
    if (logSearchLower) {
      const senderMatch = entry.sender?.toLowerCase().includes(logSearchLower) ?? false;
      const subjectMatch = entry.subject?.toLowerCase().includes(logSearchLower) ?? false;
      if (!senderMatch && !subjectMatch) return false;
    }
    return true;
  });

  const hasLogFilters = logSource !== "all" || logDateFrom !== "" || logDateTo !== "" || logSearchLower !== "";

  function resetLogFilters() {
    setLogSource("all");
    setLogDateFrom("");
    setLogDateTo("");
    setLogSearch("");
  }

  const { data: eligibleVendors = [] } = useListEligibleVendorsForDoc(
    forwardDoc?.id ?? 0,
    { query: { enabled: !!forwardDoc, queryKey: getListEligibleVendorsForDocQueryKey(forwardDoc?.id ?? 0) } },
  );

  function handleForward(doc: SalesDocument) {
    setSelectedVendorIds([]);
    setSelectedChannels(["wa", "email"]);
    setForwardResults(null);
    setForwardDoc(doc);
  }

  function handleDiscard(doc: SalesDocument) {
    setDiscardDoc(doc);
  }

  function toggleChannel(ch: string) {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  function toggleVendor(id: number) {
    setSelectedVendorIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  async function confirmForward() {
    if (!forwardDoc) return;
    forwardMut.mutate(
      {
        id: forwardDoc.id,
        data: {
          vendorIds: selectedVendorIds.length > 0 ? selectedVendorIds : undefined,
          channels: selectedChannels.length > 0 ? (selectedChannels as ForwardToVendorsBodyChannelsItem[]) : undefined,
        },
      },
      {
        onSuccess: (data) => {
          setForwardResults(data.results ?? []);
          queryClient.invalidateQueries({ queryKey: getListAiDraftQuotationsQueryKey() });
          toast({ title: t.common.success });
        },
        onError: () => {
          toast({ title: t.common.error, variant: "destructive" });
        },
      },
    );
  }

  async function confirmDiscard() {
    if (!discardDoc) return;
    actionMut.mutate(
      { id: discardDoc.id, data: { action: "cancel" } },
      {
        onSuccess: () => {
          toast({ title: t.common.success, description: discardDoc.docNumber });
          setDiscardDoc(null);
          queryClient.invalidateQueries({ queryKey: getListAiDraftQuotationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
        },
        onError: () => {
          toast({ title: t.common.error, variant: "destructive" });
        },
      },
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <Link href="/sales"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

              <h1 className="text-2xl font-bold text-foreground">AI Draft Quotations</h1>
              <p className="text-sm text-muted-foreground">
                Draft penawaran yang dibuat otomatis dari email & WhatsApp masuk
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetch(); refetchLog(); }}>
            <RefreshCw size={14} className="mr-2" />
            Refresh
          </Button>
        </div>

        <Tabs defaultValue="drafts">
          <TabsList>
            <TabsTrigger value="drafts" className="gap-2">
              <Bot size={14} />
              Draft Menunggu Review
              {drafts.length > 0 && (
                <Badge className="bg-purple-600 text-white ml-1 px-1.5 py-0 text-[10px] h-4 min-w-[18px]">
                  {drafts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-2">
              <ClipboardList size={14} />
              Riwayat Intake
              {intakeLog.length > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground">({intakeLog.length})</span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Draft queue ── */}
          <TabsContent value="drafts" className="mt-4">
            <Card className="border-border bg-card">
              <CardContent className="pt-4">
                <QueryState
                  loading={isLoading}
                  empty={!isLoading && drafts.length === 0}
                  emptyMessage="Draft akan muncul otomatis saat ada email/WA berisi inquiry order"
                  emptyIcon={<Bot size={40} className="opacity-30" />}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>No. Draft</TableHead>
                        <TableHead>Sumber</TableHead>
                        <TableHead>Pengirim</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Rute &amp; Moda</TableHead>
                        <TableHead>Masuk</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {drafts.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <Link
                              href={`/sales/quotations/${doc.id}`}
                              className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
                            >
                              {doc.docNumber}
                              <ExternalLink size={10} />
                            </Link>
                          </TableCell>
                          <TableCell>
                            <SourceBadge doc={doc} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                            {doc.aiSourceWaPhone
                              ? <span title={doc.aiSourceWaPhone}>{doc.aiSourceWaPhone}</span>
                              : doc.aiSourceCorrespondenceId
                                ? <span className="italic">Email #{doc.aiSourceCorrespondenceId}</span>
                                : "—"}
                          </TableCell>
                          <TableCell className="font-medium">{doc.customerName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            <div>{[doc.origin, doc.destination].filter(Boolean).join(" → ") || "—"}</div>
                            {doc.transportMode && (
                              <div className="text-xs capitalize text-muted-foreground/70">{doc.transportMode}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(doc.createdAt).toLocaleDateString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                                onClick={() => handleForward(doc)}
                                disabled={forwardMut.isPending}
                              >
                                <SendHorizonal size={13} className="mr-1" />
                                Forward ke Vendor
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive border-destructive hover:bg-destructive hover:text-white"
                                onClick={() => handleDiscard(doc)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryState>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 2: Intake log ── */}
          <TabsContent value="log" className="mt-4">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <ClipboardList size={16} className="text-purple-500" />
                    Riwayat Pemrosesan AI
                    <span className="text-xs font-normal text-muted-foreground">— email & WhatsApp yang diproses sistem AI</span>
                  </CardTitle>
                  {hasLogFilters && (
                    <Button variant="ghost" size="sm" onClick={resetLogFilters} className="text-xs text-muted-foreground h-7 px-2 gap-1">
                      <X size={12} />
                      Reset filter
                    </Button>
                  )}
                </div>

                {/* Search box */}
                <div className="relative pt-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 mt-1 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Cari pengirim / subjek..."
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    className="h-8 pl-8 pr-8 text-xs"
                  />
                  {logSearch && (
                    <button
                      onClick={() => setLogSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 mt-1 text-muted-foreground hover:text-foreground"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Filter toolbar */}
                <div className="flex flex-wrap items-center gap-3 pt-1.5">
                  {/* Source chips */}
                  <div className="flex items-center gap-1">
                    {(["all", "email", "wa"] as const).map((src) => (
                      <button
                        key={src}
                        onClick={() => setLogSource(src)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          logSource === src
                            ? "bg-purple-600 border-purple-600 text-white"
                            : "border-border text-muted-foreground hover:border-purple-400 hover:text-foreground"
                        }`}
                      >
                        {src === "email" && <Mail size={10} />}
                        {src === "wa" && <MessageSquare size={10} />}
                        {src === "all" ? "Semua" : src === "email" ? "Email" : "WhatsApp"}
                        {src !== "all" && (
                          <span className="opacity-60 ml-0.5">
                            ({intakeLog.filter((e) => e.source === src).length})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Date range */}
                  <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                    <span className="text-xs text-muted-foreground">Dari</span>
                    <DatePicker value={logDateFrom} onChange={(v) => setLogDateFrom(v)} className={`h-7 text-xs w-32 px-2 ${!rangeValid ? "border-red-500" : ""}`} />
                    <span className="text-xs text-muted-foreground">s/d</span>
                    <DatePicker value={logDateTo} onChange={(v) => setLogDateTo(v)} className={`h-7 text-xs w-32 px-2 ${!rangeValid ? "border-red-500" : ""}`} />
                    {!rangeValid && (
                      <span className="text-xs text-red-500">Tanggal tidak valid</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <QueryState
                  loading={isLogLoading}
                  empty={!isLogLoading && intakeLog.length === 0}
                  emptyMessage="Log akan muncul setelah AI memproses email atau pesan WhatsApp pertama"
                  emptyIcon={<ClipboardList size={40} className="opacity-30" />}
                >
                  {filteredLog.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <ClipboardList size={32} className="mx-auto mb-2 opacity-20" />
                      <p className="text-sm font-medium">Tidak ada hasil</p>
                      <p className="text-xs mt-1">Coba ubah atau reset filter</p>
                      <Button variant="outline" size="sm" onClick={resetLogFilters} className="mt-3 text-xs">
                        Reset filter
                      </Button>
                    </div>
                  ) : (
                  <>
                    {hasLogFilters && (
                      <p className="text-xs text-muted-foreground mb-2">
                        Menampilkan {filteredLog.length} dari {intakeLog.length} entri
                      </p>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sumber</TableHead>
                          <TableHead>Pengirim</TableHead>
                          <TableHead>Subjek / Info</TableHead>
                          <TableHead>Waktu</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Draft Terkait</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLog.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>
                              <IntakeSourceBadge entry={entry} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate" title={entry.sender ?? undefined}>
                              {entry.sender
                                ? <HighlightText text={entry.sender} query={logSearch.trim()} />
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={entry.subject ?? undefined}>
                              {entry.subject
                                ? <HighlightText text={entry.subject} query={logSearch.trim()} />
                                : <span className="italic text-muted-foreground/60">Pesan WhatsApp</span>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(entry.timestamp).toLocaleDateString("id-ID", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </TableCell>
                            <TableCell>
                              <IntakeStatusBadge entry={entry} />
                            </TableCell>
                            <TableCell>
                              {entry.docId && entry.docNumber ? (
                                <Link
                                  href={`/sales/quotations/${entry.docId}`}
                                  className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
                                >
                                  {entry.docNumber}
                                  <ExternalLink size={10} />
                                </Link>
                              ) : (
                                <span className="text-xs text-muted-foreground/50">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                  )}
                </QueryState>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Forward Confirmation Dialog */}
        <Dialog open={!!forwardDoc} onOpenChange={(o) => !o && setForwardDoc(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-purple-400" />
                Forward ke Vendor
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1 text-sm">
              {forwardResults ? (
                <div className="space-y-2">
                  <p className="font-medium text-green-400">✓ Selesai dikirim</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {forwardResults.map((r) => (
                      <div key={r.vendorId} className="flex items-center justify-between rounded border border-border px-3 py-1.5 bg-muted/20">
                        <span className="font-medium flex-1">{r.vendorName}</span>
                        <div className="flex gap-2 text-xs">
                          {r.waStatus && (
                            <span className={r.waStatus === "sent" ? "text-green-400" : r.waStatus === "failed" ? "text-red-400" : "text-muted-foreground"}>
                              WA: {r.waStatus}
                            </span>
                          )}
                          {r.emailStatus && (
                            <span className={r.emailStatus === "sent" ? "text-green-400" : r.emailStatus === "failed" ? "text-red-400" : "text-muted-foreground"}>
                              Email: {r.emailStatus}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
              {forwardDoc && (
                <div className="rounded-md border border-border p-3 space-y-1 bg-muted/30">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dokumen</span>
                    <span className="font-medium">{forwardDoc.docNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customer</span>
                    <span className="font-medium">{forwardDoc.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rute</span>
                    <span>{[forwardDoc.origin, forwardDoc.destination].filter(Boolean).join(" → ") || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Moda</span>
                    <span className="capitalize">{forwardDoc.transportMode ?? "—"}</span>
                  </div>
                </div>
              )}

              <div>
                <p className="font-medium mb-2">Channel Pengiriman</p>
                <div className="flex gap-4">
                  {[
                    { id: "wa", label: "WhatsApp", icon: <MessageSquare size={14} /> },
                    { id: "email", label: "Email", icon: <Mail size={14} /> },
                  ].map((ch) => (
                    <label key={ch.id} className="flex items-center gap-2 cursor-pointer select-none">
                      <Checkbox
                        checked={selectedChannels.includes(ch.id)}
                        onCheckedChange={() => toggleChannel(ch.id)}
                      />
                      {ch.icon}
                      {ch.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-medium mb-2">
                  Vendor {eligibleVendors.length > 0 ? `(${eligibleVendors.length} eligible)` : ""}
                </p>
                {eligibleVendors.length === 0 ? (
                  <p className="text-muted-foreground text-xs">Tidak ada vendor eligible — semua vendor aktif akan digunakan.</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground mb-1">
                      <Checkbox
                        checked={selectedVendorIds.length === 0}
                        onCheckedChange={() => setSelectedVendorIds([])}
                      />
                      <span>Semua vendor</span>
                    </label>
                    {eligibleVendors.map((v) => (
                      <label key={v.id} className="flex items-center gap-2 cursor-pointer select-none">
                        <Checkbox
                          checked={selectedVendorIds.includes(v.id)}
                          onCheckedChange={() => toggleVendor(v.id)}
                        />
                        <span className="flex-1">{v.name}</span>
                        <span className="text-muted-foreground text-xs flex gap-1">
                          {v.hasPhone && <MessageSquare size={11} />}
                          {v.hasEmail && <Mail size={11} />}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
              )}
            </div>
            <DialogFooter>
              {forwardResults ? (
                <Button variant="outline" onClick={() => { setForwardDoc(null); setForwardResults(null); }}>Tutup</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setForwardDoc(null)}>Batal</Button>
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={confirmForward}
                    disabled={forwardMut.isPending || selectedChannels.length === 0}
                  >
                    {forwardMut.isPending ? "Mengirim..." : "Forward ke Vendor"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Discard Confirmation Dialog */}
        <Dialog open={!!discardDoc} onOpenChange={(o) => !o && setDiscardDoc(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Batalkan Draft</DialogTitle>
            </DialogHeader>
            <p className="text-sm py-2">
              Draft <strong>{discardDoc?.docNumber}</strong> akan dibatalkan. Tindakan ini
              tidak dapat dibatalkan.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDiscardDoc(null)}>
                Kembali
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDiscard}
                disabled={actionMut.isPending}
              >
                {actionMut.isPending ? "Membatalkan..." : "Batalkan Draft"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
