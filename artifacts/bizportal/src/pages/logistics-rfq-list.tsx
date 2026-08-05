import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, RefreshCw, Plus, Eye, ArrowRight, Clock, Users, Loader2,
  CheckCircle, Send, AlertCircle, BarChart2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABEL: Record<string, string> = {
  admin_review: "Perlu Review",
  vendor_blasted: "Dikirim ke Vendor",
  vendor_selected: "Vendor Dipilih",
  customer_quoted: "Penawaran Terkirim",
  customer_approved: "Disetujui Customer",
  customer_revision_requested: "Revisi Diminta",
  customer_rejected: "Ditolak Customer",
  closed: "Selesai",
  open: "Buka",
};

const STATUS_COLOR: Record<string, string> = {
  admin_review: "bg-orange-100 text-orange-800",
  vendor_blasted: "bg-blue-100 text-blue-800",
  vendor_selected: "bg-purple-100 text-purple-800",
  customer_quoted: "bg-cyan-100 text-cyan-800",
  customer_approved: "bg-green-100 text-green-800",
  customer_revision_requested: "bg-yellow-100 text-yellow-800",
  customer_rejected: "bg-red-100 text-red-800",
  closed: "bg-gray-100 text-gray-600",
  open: "bg-blue-100 text-blue-800",
};

const STATUS_TABS = [
  { value: "all", label: "Semua" },
  { value: "admin_review", label: "Perlu Review" },
  { value: "vendor_blasted", label: "Di Vendor" },
  { value: "vendor_selected", label: "Vendor Dipilih" },
  { value: "customer_quoted", label: "Penawaran Terkirim" },
  { value: "customer_approved", label: "✓ Disetujui" },
  { value: "customer_revision_requested", label: "⟳ Revisi" },
  { value: "customer_rejected", label: "✗ Ditolak" },
  { value: "closed", label: "Selesai" },
];

interface RfqRow {
  rfqId: number;
  rfqNumber: string;
  rfqStatus: string;
  responseDeadline: string | null;
  createdAt: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  serviceType: string;
  origin: string;
  destination: string;
  comparisonUrl: string;
  vendorStats: {
    total: number;
    waiting: number;
    answered: number;
    rejected: number;
    expired: number;
  };
}

interface PortalOrder {
  id: number;
  orderNumber: string;
  customerName: string;
  shipmentType: string;
  origin: string;
  destination: string;
  status: string;
}

function timeSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  return `${Math.floor(hrs / 24)}h lalu`;
}

function deadlineLabel(iso: string | null) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return { label: "Deadline terlewat", color: "text-red-600" };
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 2) return { label: `${Math.floor(diff / 60000)} menit lagi`, color: "text-red-600" };
  if (hrs < 24) return { label: `${hrs} jam lagi`, color: "text-orange-600" };
  return { label: `${Math.floor(hrs / 24)} hari lagi`, color: "text-green-700" };
}

export default function LogisticsRfqListPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [deadlineHours, setDeadlineHours] = useState("48");

  const { data: rfqs = [], isLoading, refetch } = useQuery<RfqRow[]>({
    queryKey: ["rfq-list", activeTab],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (activeTab !== "all") params.set("status", activeTab);
      const r = await fetch(`/api/logistic/rfq/list?${params}`);
      if (!r.ok) throw new Error("Gagal memuat daftar RFQ");
      return r.json();
    },
    refetchInterval: 15000,
  });

  const { data: orders = [] } = useQuery<PortalOrder[]>({
    queryKey: ["portal-orders-for-rfq"],
    queryFn: async () => {
      const r = await fetch("/api/logistic/orders?limit=100&status=New+Order");
      if (!r.ok) return [];
      const data = await r.json();
      return data.orders ?? data ?? [];
    },
    enabled: showCreateDialog,
  });

  const createRfqMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrderId) throw new Error("Pilih order terlebih dahulu");
      const r = await fetch(`/api/logistic/rfq/create-from-order/${selectedOrderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes || undefined,
          responseDeadlineHours: Number(deadlineHours) || 48,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal membuat RFQ");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "RFQ berhasil dibuat", description: `${data.rfqNumber} — status: admin_review` });
      setShowCreateDialog(false);
      setSelectedOrderId("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["rfq-list"] });
      navigate(`/logistics/rfq/${data.rfqId}/detail`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = rfqs.filter((r) =>
    !search ||
    r.rfqNumber.toLowerCase().includes(search.toLowerCase()) ||
    r.customerName.toLowerCase().includes(search.toLowerCase()) ||
    r.orderNumber.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">RFQ — Permintaan Penawaran Vendor</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Flow baru: Customer → Admin Review → Blast Vendor → Pilih Vendor → Kirim ke Customer
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-1" /> Buat RFQ Baru
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto">
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs">
                {t.label}
                {t.value !== "all" && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({rfqs.filter((r) => r.rfqStatus === t.value).length})
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Cari RFQ, customer, nomor order..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <span className="text-sm text-muted-foreground">{filtered.length} RFQ</span>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. RFQ</TableHead>
                  <TableHead>Order / Customer</TableHead>
                  <TableHead>Layanan</TableHead>
                  <TableHead>Rute</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      {activeTab === "admin_review"
                        ? "Tidak ada RFQ yang perlu direview"
                        : "Tidak ada RFQ ditemukan"}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((rfq) => {
                  const dl = deadlineLabel(rfq.responseDeadline);
                  return (
                    <TableRow key={rfq.rfqId} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-medium">
                        {rfq.rfqNumber}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{rfq.customerName}</div>
                        <div className="text-xs text-muted-foreground">{rfq.orderNumber}</div>
                      </TableCell>
                      <TableCell className="text-xs">{rfq.serviceType || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <span className="truncate max-w-[120px] block">{rfq.origin}</span>
                        <span className="text-muted-foreground">→ {rfq.destination}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLOR[rfq.rfqStatus] ?? "bg-gray-100"}`}>
                          {STATUS_LABEL[rfq.rfqStatus] ?? rfq.rfqStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {rfq.rfqStatus === "admin_review" ? (
                          <span className="text-xs text-muted-foreground">Belum dikirim</span>
                        ) : (
                          <div className="text-xs space-y-0.5">
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              <span>{rfq.vendorStats.total} vendor</span>
                            </div>
                            <div className="text-muted-foreground">
                              {rfq.vendorStats.answered} jawab · {rfq.vendorStats.waiting} tunggu
                              {rfq.vendorStats.expired > 0 && ` · ${rfq.vendorStats.expired} expired`}
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {dl ? (
                          <span className={`text-xs ${dl.color}`}>
                            <Clock className="h-3 w-3 inline mr-1" />{dl.label}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {timeSince(rfq.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => navigate(`/logistics/rfq/${rfq.rfqId}/detail`)}
                          >
                            {rfq.rfqStatus === "admin_review" ? (
                              <><Send className="h-3 w-3 mr-1" />Review</>
                            ) : (
                              <><Eye className="h-3 w-3 mr-1" />Detail</>
                            )}
                          </Button>
                          {!["admin_review", "closed"].includes(rfq.rfqStatus) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2 text-xs ${
                                rfq.rfqStatus === "customer_approved"
                                  ? "border-green-400 text-green-700"
                                  : rfq.rfqStatus === "customer_revision_requested"
                                    ? "border-yellow-400 text-yellow-700"
                                    : rfq.rfqStatus === "customer_rejected"
                                      ? "border-red-400 text-red-700"
                                      : ""
                              }`}
                              onClick={() => navigate(`/logistics/rfq/${rfq.rfqId}/comparison`)}
                            >
                              <BarChart2 className="h-3 w-3 mr-1" />Comparison
                            </Button>
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

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Buat RFQ Baru dari Order</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Pilih Order Customer</Label>
                <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih order yang masuk..." />
                  </SelectTrigger>
                  <SelectContent>
                    {orders.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        <span className="font-mono text-xs mr-2">{o.orderNumber}</span>
                        {o.customerName} — {o.shipmentType} ({o.origin} → {o.destination})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Response Deadline Vendor (jam)</Label>
                <Select value={deadlineHours} onValueChange={setDeadlineHours}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12 jam</SelectItem>
                    <SelectItem value="24">24 jam (1 hari)</SelectItem>
                    <SelectItem value="48">48 jam (2 hari)</SelectItem>
                    <SelectItem value="72">72 jam (3 hari)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Catatan Internal (opsional)</Label>
                <Textarea
                  placeholder="Catatan untuk admin, tidak dilihat vendor..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Batal</Button>
              <Button
                onClick={() => createRfqMutation.mutate()}
                disabled={!selectedOrderId || createRfqMutation.isPending}
              >
                {createRfqMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Buat RFQ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
