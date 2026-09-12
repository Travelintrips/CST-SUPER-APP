import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { QueryState } from "@/components/ui/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackButton } from "@/components/ui/back-button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Package,
  BarChart2,
  Loader2,
  Copy,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type QueueItem = {
  id: number;
  vendorId: number;
  vendorName: string;
  name: string;
  categoryKey: string | null;
  serviceType: string | null;
  templateKind: string | null;
  specValues: Record<string, unknown> | null;
  mediaAssets: Record<string, unknown>[];
  priceBase: number;
  currency: string;
  stockStatus: string | null;
  stockQty: number | null;
  leadTime: string | null;
  status: string;
  sourceSubmissionId: number | null;
  createdAt: string;
  updatedAt: string | null;
};

type Submission = {
  id: number;
  token: string;
  linkId: number | null;
  supplierId: number | null;
  vendorName: string | null;
  name: string;
  description: string | null;
  categoryKey: string | null;
  serviceType: string | null;
  templateKind: string | null;
  templateSnapshot: Record<string, unknown> | null;
  specValues: Record<string, unknown> | null;
  mediaAssets: Record<string, unknown>[];
  priceBase: number;
  currency: string;
  stockStatus: string | null;
  stockQty: number | null;
  leadTime: string | null;
  status: string;
  catalogItemId: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  submittedAt: string;
};

type Link = {
  id: number;
  token: string;
  supplierId: number;
  vendorName: string | null;
  title: string | null;
  notes: string | null;
  categoryKey: string | null;
  serviceType: string | null;
  templateKind: string | null;
  isActive: boolean;
  submissionCount: number;
  maxSubmissions: number | null;
  createdAt: string;
  createdBy: string | null;
  formUrl: string;
};

type Stats = {
  submissions: { submitted: number; approved: number; rejected: number };
  items:       { draft: number; pending_review: number; published: number; archived: number };
};

type Supplier = { id: number; name: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string }> = {
  submitted:      { label: "Submitted",      color: "bg-yellow-100 text-yellow-800" },
  approved:       { label: "Approved",       color: "bg-green-100  text-green-800" },
  rejected:       { label: "Rejected",       color: "bg-red-100    text-red-800" },
  pending_review: { label: "Pending Review", color: "bg-orange-100 text-orange-800" },
  published:      { label: "Published",      color: "bg-blue-100   text-blue-800" },
  draft:          { label: "Draft",          color: "bg-gray-100   text-gray-700" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${m.color}`}>
      {m.label}
    </span>
  );
}

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VendorCatalogEnginePage() {
  const { toast }  = useToast();
  const qc         = useQueryClient();
  const [tab, setTab] = useState<"queue" | "submissions" | "links">("queue");
  const [search, setSearch]  = useState("");
  const [subFilter, setSubFilter] = useState("all");

  // ── Detail dialog ──────────────────────────────────────────────────────────
  const [detailItem, setDetailItem] = useState<QueueItem | Submission | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionLoading, setActionLoading] = useState<"approve" | "reject" | null>(null);

  // ── Create link dialog ─────────────────────────────────────────────────────
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [newLink, setNewLink] = useState({
    supplierId:   "",
    title:        "",
    notes:        "",
    categoryKey:  "",
    serviceType:  "",
    templateKind: "service",
    maxSubmissions: "",
  });
  const [createdLinkUrl, setCreatedLinkUrl] = useState<string | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: queueItems = [], isLoading: queueLoading, refetch: refetchQueue } = useQuery<QueueItem[]>({
    queryKey: ["catalog-engine-queue"],
    queryFn: async () => {
      const r = await fetch("/api/trading/catalog-engine/queue");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: submissions = [], isLoading: subLoading, refetch: refetchSubs } = useQuery<Submission[]>({
    queryKey: ["catalog-engine-submissions", subFilter],
    queryFn: async () => {
      const url = subFilter === "all"
        ? "/api/trading/catalog-engine/submissions"
        : `/api/trading/catalog-engine/submissions?status=${subFilter}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: links = [], isLoading: linksLoading, refetch: refetchLinks } = useQuery<Link[]>({
    queryKey: ["catalog-engine-links"],
    queryFn: async () => {
      const r = await fetch("/api/trading/catalog-engine/links");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["catalog-engine-stats"],
    queryFn: async () => {
      const r = await fetch("/api/trading/catalog-engine/stats");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const r = await fetch("/api/trading/suppliers");
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      return (Array.isArray(data) ? data : data.suppliers ?? []).map((s: any) => ({
        id: s.id, name: s.name,
      }));
    },
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleApprove(submissionId: number) {
    setActionLoading("approve");
    try {
      const r = await fetch(`/api/trading/catalog-engine/submissions/${submissionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNotes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal approve");
      toast({ title: "✅ Submission disetujui & item dipublish" });
      setDetailItem(null);
      setReviewNotes("");
      qc.invalidateQueries({ queryKey: ["catalog-engine-queue"] });
      qc.invalidateQueries({ queryKey: ["catalog-engine-submissions"] });
      qc.invalidateQueries({ queryKey: ["catalog-engine-stats"] });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(submissionId: number) {
    if (!reviewNotes.trim()) {
      toast({ title: "Catatan diperlukan", description: "Isi alasan penolakan", variant: "destructive" });
      return;
    }
    setActionLoading("reject");
    try {
      const r = await fetch(`/api/trading/catalog-engine/submissions/${submissionId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNotes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal reject");
      toast({ title: "❌ Submission ditolak" });
      setDetailItem(null);
      setReviewNotes("");
      qc.invalidateQueries({ queryKey: ["catalog-engine-queue"] });
      qc.invalidateQueries({ queryKey: ["catalog-engine-submissions"] });
      qc.invalidateQueries({ queryKey: ["catalog-engine-stats"] });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCreateLink() {
    if (!newLink.supplierId) {
      toast({ title: "Pilih vendor terlebih dahulu", variant: "destructive" });
      return;
    }
    try {
      const r = await fetch("/api/trading/catalog-engine/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId:    Number(newLink.supplierId),
          title:         newLink.title || undefined,
          notes:         newLink.notes || undefined,
          categoryKey:   newLink.categoryKey || undefined,
          serviceType:   newLink.serviceType || undefined,
          templateKind:  newLink.templateKind || undefined,
          maxSubmissions: newLink.maxSubmissions ? Number(newLink.maxSubmissions) : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal buat link");
      const fullUrl = `${window.location.origin}/api/vendor-catalog-engine/form/${data.token}`;
      setCreatedLinkUrl(fullUrl);
      qc.invalidateQueries({ queryKey: ["catalog-engine-links"] });
    } catch (e: any) {
      toast({ title: "Gagal buat link", description: e.message, variant: "destructive" });
    }
  }

  async function deactivateLink(linkId: number) {
    const r = await fetch(`/api/trading/catalog-engine/links/${linkId}/deactivate`, { method: "PATCH" });
    if (r.ok) {
      toast({ title: "Link dinonaktifkan" });
      qc.invalidateQueries({ queryKey: ["catalog-engine-links"] });
    }
  }

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const filteredQueue = queueItems.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase())
      || (i.vendorName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredSubs = submissions.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase())
      || (i.vendorName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // ── Resolve submission id for detail dialog ────────────────────────────────
  const detailAsSubmission = detailItem && "submittedAt" in detailItem ? detailItem as Submission : null;
  const detailAsQueue      = detailItem && !("submittedAt" in detailItem) ? detailItem as QueueItem : null;

  // Find matching submission for a queue item
  const matchedSub = detailAsQueue
    ? submissions.find(s => s.id === detailAsQueue.sourceSubmissionId) ?? null
    : null;
  const activeSubmission = detailAsSubmission ?? matchedSub;

  return (
    <AppShell>
      <BackButton href="/purchase" />
      <div className="p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Vendor Catalog Engine</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review submission vendor → publikasi ke katalog
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchQueue(); refetchSubs(); refetchLinks(); }}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => { setCreatedLinkUrl(null); setLinkDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Buat Link Vendor
            </Button>
          </div>
        </div>

        {/* ── Stats Cards ─────────────────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Pending Review</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">{stats.items.pending_review}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Submissions Masuk</p>
                <p className="text-3xl font-bold mt-1">{stats.submissions.submitted}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Disetujui</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{stats.submissions.approved}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Published</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{stats.items.published}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Search ──────────────────────────────────────────────────────── */}
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari item atau vendor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="queue">
              Review Queue
              {(stats?.items.pending_review ?? 0) > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-orange-500 text-white text-xs w-5 h-5">
                  {stats!.items.pending_review}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="submissions">Semua Submission</TabsTrigger>
            <TabsTrigger value="links">Link Vendor</TabsTrigger>
          </TabsList>

          {/* ── Review Queue ────────────────────────────────────────────── */}
          <TabsContent value="queue">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Item Menunggu Review</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <QueryState
                  loading={queueLoading}
                  empty={!queueLoading && filteredQueue.length === 0}
                  emptyMessage="Tidak ada item pending review"
                  emptyIcon={<Clock className="w-10 h-10 opacity-30" />}
                  skeletonRows={4}
                  className="p-4"
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Kategori</TableHead>
                        <TableHead>Harga Dasar</TableHead>
                        <TableHead>Lead Time</TableHead>
                        <TableHead>Disubmit</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredQueue.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>{item.vendorName}</TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">
                              {item.categoryKey ?? item.serviceType ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>{fmtIDR(item.priceBase)}</TableCell>
                          <TableCell>{item.leadTime ?? "—"}</TableCell>
                          <TableCell className="text-xs">{fmtDate(item.updatedAt ?? item.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setDetailItem(item); setReviewNotes(""); }}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" /> Review
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryState>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── All Submissions ─────────────────────────────────────────── */}
          <TabsContent value="submissions">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Semua Submission</CardTitle>
                <Select value={subFilter} onValueChange={setSubFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="p-0">
                <QueryState
                  loading={subLoading}
                  empty={!subLoading && filteredSubs.length === 0}
                  emptyMessage="Belum ada submission"
                  emptyIcon={<Package className="w-10 h-10 opacity-30" />}
                  skeletonRows={4}
                  className="p-4"
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Harga Dasar</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reviewer</TableHead>
                        <TableHead>Disubmit</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSubs.map(sub => (
                        <TableRow key={sub.id}>
                          <TableCell className="font-medium">{sub.name}</TableCell>
                          <TableCell>{sub.vendorName ?? "—"}</TableCell>
                          <TableCell>{fmtIDR(sub.priceBase)}</TableCell>
                          <TableCell><StatusBadge status={sub.status} /></TableCell>
                          <TableCell className="text-xs">{sub.reviewedBy ?? "—"}</TableCell>
                          <TableCell className="text-xs">{fmtDate(sub.submittedAt)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setDetailItem(sub); setReviewNotes(sub.reviewNotes ?? ""); }}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" /> Detail
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryState>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Links ───────────────────────────────────────────────────── */}
          <TabsContent value="links">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Link Submission Vendor</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <QueryState
                  loading={linksLoading}
                  empty={!linksLoading && links.length === 0}
                  emptyMessage='Belum ada link. Klik "Buat Link Vendor"'
                  emptyIcon={<Link2 className="w-10 h-10 opacity-30" />}
                  skeletonRows={3}
                  className="p-4"
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Judul</TableHead>
                        <TableHead>Kategori</TableHead>
                        <TableHead>Submissions</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Dibuat</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {links.map(link => (
                        <TableRow key={link.id}>
                          <TableCell className="font-medium">{link.vendorName ?? "—"}</TableCell>
                          <TableCell>{link.title ?? "—"}</TableCell>
                          <TableCell className="text-xs">
                            {link.categoryKey ?? link.serviceType ?? "—"}
                          </TableCell>
                          <TableCell>
                            {link.submissionCount}
                            {link.maxSubmissions != null && ` / ${link.maxSubmissions}`}
                          </TableCell>
                          <TableCell>
                            {link.isActive
                              ? <Badge variant="default" className="bg-green-600">Aktif</Badge>
                              : <Badge variant="secondary">Nonaktif</Badge>}
                          </TableCell>
                          <TableCell className="text-xs">{fmtDate(link.createdAt)}</TableCell>
                          <TableCell className="text-right flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const url = `${window.location.origin}${link.formUrl}`;
                                navigator.clipboard.writeText(url);
                                toast({ title: "URL disalin ke clipboard" });
                              }}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            {link.isActive && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-500 hover:text-red-700"
                                onClick={() => deactivateLink(link.id)}
                              >
                                Nonaktifkan
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryState>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Review Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!detailItem} onOpenChange={open => { if (!open) setDetailItem(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailAsSubmission
                ? `Review Submission — ${detailAsSubmission.name}`
                : `Review Item — ${detailAsQueue?.name}`}
            </DialogTitle>
          </DialogHeader>

          {detailItem && (
            <div className="space-y-4">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Vendor</span>
                  <p className="font-medium">{detailItem.vendorName ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Kategori</span>
                  <p className="font-medium">
                    {("categoryKey" in detailItem ? detailItem.categoryKey : null)
                      ?? ("serviceType" in detailItem ? detailItem.serviceType : null)
                      ?? "—"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Harga Dasar</span>
                  <p className="font-bold text-lg">{fmtIDR("priceBase" in detailItem ? Number(detailItem.priceBase) : 0)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Lead Time</span>
                  <p className="font-medium">
                    {"leadTime" in detailItem ? (detailItem.leadTime ?? "—") : "—"}
                  </p>
                </div>
                {"stockStatus" in detailItem && detailItem.stockStatus && (
                  <div>
                    <span className="text-muted-foreground">Stok</span>
                    <p className="font-medium">
                      {detailItem.stockStatus}
                      {"stockQty" in detailItem && detailItem.stockQty != null
                        ? ` (${detailItem.stockQty})`
                        : ""}
                    </p>
                  </div>
                )}
                {"status" in detailItem && (
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <div className="mt-0.5"><StatusBadge status={detailItem.status} /></div>
                  </div>
                )}
              </div>

              {/* specValues */}
              {"specValues" in detailItem && detailItem.specValues && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Spec Values</p>
                  <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
                    {Object.entries(detailItem.specValues as Record<string, unknown>).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-muted-foreground w-40 shrink-0">{k}</span>
                        <span className="font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* mediaAssets */}
              {"mediaAssets" in detailItem && Array.isArray(detailItem.mediaAssets) && detailItem.mediaAssets.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Media Assets ({detailItem.mediaAssets.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {detailItem.mediaAssets.map((a: any, i) => (
                      <div key={i} className="rounded border p-2 text-xs bg-muted/30 flex items-center gap-1">
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                            <ExternalLink className="w-3 h-3" />
                            {a.name ?? a.filename ?? `Asset ${i + 1}`}
                          </a>
                        ) : (
                          <span>{a.name ?? a.filename ?? `Asset ${i + 1}`}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Review notes */}
              {activeSubmission?.status === "submitted" && (
                <div>
                  <Label htmlFor="review-notes">Catatan Review (opsional untuk approve, wajib untuk tolak)</Label>
                  <Textarea
                    id="review-notes"
                    className="mt-1"
                    rows={3}
                    placeholder="Catatan untuk vendor..."
                    value={reviewNotes}
                    onChange={e => setReviewNotes(e.target.value)}
                  />
                </div>
              )}

              {/* Read-only notes */}
              {activeSubmission && activeSubmission.status !== "submitted" && activeSubmission.reviewNotes && (
                <div className="rounded-md border p-3 bg-muted/30 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Catatan Reviewer</p>
                  <p>{activeSubmission.reviewNotes}</p>
                  {activeSubmission.reviewedBy && (
                    <p className="text-xs text-muted-foreground mt-1">— {activeSubmission.reviewedBy}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDetailItem(null)}>Tutup</Button>
            {activeSubmission?.status === "submitted" && (
              <>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-300 hover:bg-red-50"
                  disabled={actionLoading !== null}
                  onClick={() => handleReject(activeSubmission.id)}
                >
                  {actionLoading === "reject"
                    ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    : <XCircle className="w-4 h-4 mr-1" />}
                  Tolak
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  disabled={actionLoading !== null}
                  onClick={() => handleApprove(activeSubmission.id)}
                >
                  {actionLoading === "approve"
                    ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  Setujui & Publish
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Link Dialog ───────────────────────────────────────────── */}
      <Dialog open={linkDialogOpen} onOpenChange={open => { if (!open) { setLinkDialogOpen(false); setCreatedLinkUrl(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Link Submission Vendor</DialogTitle>
          </DialogHeader>

          {createdLinkUrl ? (
            <div className="space-y-4">
              <p className="text-sm text-green-700 font-medium">✅ Link berhasil dibuat!</p>
              <div className="rounded-md border p-3 bg-muted/30 break-all text-sm font-mono">
                {createdLinkUrl}
              </div>
              <Button
                className="w-full"
                onClick={() => { navigator.clipboard.writeText(createdLinkUrl); toast({ title: "URL disalin!" }); }}
              >
                <Copy className="w-4 h-4 mr-2" /> Salin URL
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Vendor *</Label>
                <Select value={newLink.supplierId} onValueChange={v => setNewLink(p => ({ ...p, supplierId: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pilih vendor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Judul Form</Label>
                <Input
                  className="mt-1"
                  placeholder="cth: Submit Katalog Sea Freight Q3"
                  value={newLink.title}
                  onChange={e => setNewLink(p => ({ ...p, title: e.target.value }))}
                />
              </div>
              <div>
                <Label>Catatan untuk Vendor</Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  placeholder="Instruksi khusus untuk vendor..."
                  value={newLink.notes}
                  onChange={e => setNewLink(p => ({ ...p, notes: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category Key</Label>
                  <Input
                    className="mt-1"
                    placeholder="cth: sea_freight"
                    value={newLink.categoryKey}
                    onChange={e => setNewLink(p => ({ ...p, categoryKey: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Template Kind</Label>
                  <Select value={newLink.templateKind} onValueChange={v => setNewLink(p => ({ ...p, templateKind: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="service">Service</SelectItem>
                      <SelectItem value="product">Product</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Maks. Submissions (kosongkan = tidak terbatas)</Label>
                <Input
                  className="mt-1"
                  type="number"
                  placeholder="cth: 3"
                  value={newLink.maxSubmissions}
                  onChange={e => setNewLink(p => ({ ...p, maxSubmissions: e.target.value }))}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setLinkDialogOpen(false); setCreatedLinkUrl(null); }}>
              {createdLinkUrl ? "Tutup" : "Batal"}
            </Button>
            {!createdLinkUrl && (
              <Button onClick={handleCreateLink}>
                <Link2 className="w-4 h-4 mr-2" /> Buat Link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
