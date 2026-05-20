import { useState, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Send, RefreshCw, Package, MapPin, Users, Clock,
  Copy, Check, Loader2, ExternalLink, AlertCircle, BarChart2, Truck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const idr = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_LABEL: Record<string, string> = {
  admin_review: "Perlu Review Admin",
  vendor_blasted: "Sudah Dikirim ke Vendor",
  vendor_selected: "Vendor Telah Dipilih",
  customer_quoted: "Penawaran Terkirim ke Customer",
  customer_approved: "Disetujui Customer",
  customer_revision_requested: "Customer Minta Revisi",
  customer_rejected: "Ditolak Customer",
  closed: "Selesai",
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
};

interface Vendor {
  id: number;
  name: string;
  phone: string | null;
  serviceType: string | null;
  isActive: boolean;
}

interface RfqDetail {
  rfqId: number;
  rfqNumber: string;
  rfqStatus: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  serviceType: string;
  origin: string;
  destination: string;
  commodity: string | null;
  responseDeadline: string | null;
  createdAt: string;
  vendorStats: { total: number; waiting: number; answered: number; rejected: number; expired: number };
  comparisonUrl: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-1 text-muted-foreground hover:text-foreground">
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function LogisticsRfqDetailPage() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<number>>(new Set());
  const [deadlineHours, setDeadlineHours] = useState("48");
  const [vendorSearch, setVendorSearch] = useState("");
  const [showBlastConfirm, setShowBlastConfirm] = useState(false);

  const rfqNumId = Number(rfqId);

  const { data: rfq, isLoading: rfqLoading } = useQuery<RfqDetail>({
    queryKey: ["rfq-detail", rfqNumId],
    queryFn: async () => {
      const r = await fetch(`/api/logistic/rfq/list?limit=200`);
      if (!r.ok) throw new Error("Gagal memuat RFQ");
      const list: RfqDetail[] = await r.json();
      const found = list.find((x) => x.rfqId === rfqNumId);
      if (!found) throw new Error("RFQ tidak ditemukan");
      return found;
    },
  });

  const { data: vendors = [], isLoading: vendorLoading } = useQuery<Vendor[]>({
    queryKey: ["active-vendors"],
    queryFn: async () => {
      const r = await fetch("/api/logistic/logistic-vendors");
      if (!r.ok) return [];
      return r.json();
    },
  });

  const blastMutation = useMutation({
    mutationFn: async () => {
      if (selectedVendorIds.size === 0) throw new Error("Pilih minimal 1 vendor");
      const r = await fetch(`/api/logistic/rfq/${rfqNumId}/blast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorIds: Array.from(selectedVendorIds),
          deadlineHours: Number(deadlineHours) || 48,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal blast ke vendor");
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Berhasil dikirim ke vendor",
        description: `${data.sentCount} vendor menerima WA. Status RFQ: vendor_blasted`,
      });
      setShowBlastConfirm(false);
      qc.invalidateQueries({ queryKey: ["rfq-detail", rfqNumId] });
      navigate(`/logistics/rfq/${rfqNumId}/comparison`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleVendor = useCallback((id: number) => {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const filteredVendors = vendors.filter((v) =>
    !vendorSearch ||
    v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    (v.serviceType ?? "").toLowerCase().includes(vendorSearch.toLowerCase())
  );

  if (rfqLoading) {
    return (
      <AppShell>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!rfq) {
    return (
      <AppShell>
        <div className="p-6 text-center">
          <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <p>RFQ tidak ditemukan</p>
          <Button variant="link" onClick={() => navigate("/logistics/rfq")}>← Kembali ke daftar</Button>
        </div>
      </AppShell>
    );
  }

  const isAdminReview = rfq.rfqStatus === "admin_review";
  const isBlasted = rfq.rfqStatus === "vendor_blasted";

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/logistics/rfq")}>
            <ArrowLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold font-mono">{rfq.rfqNumber}</h1>
              <Badge className={`text-xs ${STATUS_COLOR[rfq.rfqStatus] ?? "bg-gray-100"}`}>
                {STATUS_LABEL[rfq.rfqStatus] ?? rfq.rfqStatus}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Order: <span className="font-mono">{rfq.orderNumber}</span> · {rfq.customerName}
            </p>
          </div>
          {!isAdminReview && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/logistics/rfq/${rfqNumId}/comparison`)}>
              <BarChart2 className="h-4 w-4 mr-1" />Lihat Comparison
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4" />Detail Request Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <span className="text-muted-foreground">Layanan</span>
                <span className="font-medium">{rfq.serviceType || "—"}</span>
                <span className="text-muted-foreground">Asal</span>
                <span>{rfq.origin}</span>
                <span className="text-muted-foreground">Tujuan</span>
                <span>{rfq.destination}</span>
                {rfq.commodity && (
                  <>
                    <span className="text-muted-foreground">Komoditi</span>
                    <span>{rfq.commodity}</span>
                  </>
                )}
              </div>
              <div className="pt-1">
                <Button variant="outline" size="sm" className="text-xs h-7" asChild>
                  <Link href={`/logistics/portal-orders/${rfq.orderId}`}>
                    <ExternalLink className="h-3 w-3 mr-1" />Lihat Detail Order
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {isAdminReview ? (
            <Card className="border-orange-200 bg-orange-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-orange-800">
                  <AlertCircle className="h-4 w-4" />Langkah Selanjutnya
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-orange-800 space-y-2">
                <p>RFQ ini perlu direview. Pilih vendor di bawah dan klik <strong>Blast ke Vendor</strong> untuk mengirim permintaan penawaran via WhatsApp.</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Response Deadline Vendor</Label>
                  <Select value={deadlineHours} onValueChange={setDeadlineHours}>
                    <SelectTrigger className="h-8 text-xs bg-white">
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
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />Status Vendor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-muted-foreground">Total Vendor</span>
                  <span className="font-medium">{rfq.vendorStats.total}</span>
                  <span className="text-muted-foreground">Sudah Jawab</span>
                  <span className="text-green-700 font-medium">{rfq.vendorStats.answered}</span>
                  <span className="text-muted-foreground">Belum Jawab</span>
                  <span className="text-orange-600">{rfq.vendorStats.waiting}</span>
                  {rfq.responseDeadline && (
                    <>
                      <span className="text-muted-foreground">Deadline</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(rfq.responseDeadline).toLocaleString("id-ID")}
                      </span>
                    </>
                  )}
                </div>
                {isBlasted && selectedVendorIds.size > 0 && (
                  <div className="pt-2">
                    <Button
                      size="sm"
                      className="text-xs h-8 w-full"
                      onClick={() => setShowBlastConfirm(true)}
                    >
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      Tambah Vendor ({selectedVendorIds.size} dipilih)
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {isAdminReview && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Truck className="h-4 w-4" />Pilih Vendor
                  {selectedVendorIds.size > 0 && (
                    <Badge variant="secondary" className="ml-1">{selectedVendorIds.size} dipilih</Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Cari vendor..."
                    value={vendorSearch}
                    onChange={(e) => setVendorSearch(e.target.value)}
                    className="h-7 text-xs w-48"
                  />
                  {selectedVendorIds.size === filteredVendors.length ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedVendorIds(new Set())}>
                      Hapus Semua
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedVendorIds(new Set(filteredVendors.map((v) => v.id)))}>
                      Pilih Semua
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {vendorLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : filteredVendors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Tidak ada vendor aktif ditemukan</p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {filteredVendors.map((v) => (
                    <div
                      key={v.id}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedVendorIds.has(v.id) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                      }`}
                      onClick={() => toggleVendor(v.id)}
                    >
                      <Checkbox
                        checked={selectedVendorIds.has(v.id)}
                        onCheckedChange={() => toggleVendor(v.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">{v.serviceType || "—"}</div>
                      </div>
                      {v.phone ? (
                        <span className="text-xs text-green-700 font-mono">{v.phone}</span>
                      ) : (
                        <span className="text-xs text-red-500">No WA tidak ada</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Separator className="my-4" />

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-muted-foreground">
                  {selectedVendorIds.size} vendor dipilih · Deadline: {deadlineHours} jam
                </div>
                <Button
                  disabled={selectedVendorIds.size === 0 || blastMutation.isPending}
                  onClick={() => setShowBlastConfirm(true)}
                  className="gap-2"
                >
                  {blastMutation.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Mengirim...</>
                    : <><Send className="h-4 w-4" />Blast ke Vendor ({selectedVendorIds.size})</>
                  }
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={showBlastConfirm} onOpenChange={setShowBlastConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Konfirmasi Blast ke Vendor</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                Anda akan mengirim permintaan penawaran ke{" "}
                <strong>{selectedVendorIds.size} vendor</strong> via WhatsApp.
              </p>
              <div className="bg-muted/50 rounded p-3 space-y-1 text-xs">
                <div><span className="text-muted-foreground">RFQ:</span> {rfq.rfqNumber}</div>
                <div><span className="text-muted-foreground">Layanan:</span> {rfq.serviceType}</div>
                <div><span className="text-muted-foreground">Rute:</span> {rfq.origin} → {rfq.destination}</div>
                <div><span className="text-muted-foreground">Deadline:</span> {deadlineHours} jam dari sekarang</div>
              </div>
              <p className="text-muted-foreground text-xs">
                Setiap vendor akan mendapat link unik untuk mengisi penawaran. Status RFQ akan berubah menjadi <strong>vendor_blasted</strong>.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBlastConfirm(false)}>Batal</Button>
              <Button
                onClick={() => blastMutation.mutate()}
                disabled={blastMutation.isPending}
              >
                {blastMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Ya, Blast ke Vendor
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
