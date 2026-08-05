import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RfqStatusBadge, ApprovalStatusBadge, QuoteStatusBadge } from "@/components/marketplace/MktStatusBadge";
import { RequoteDialog } from "@/components/marketplace/RequoteDialog";
import { toast } from "sonner";
import {
  ArrowLeft, Scale, Users, UserCheck, Building2, Calendar, Send,
  RotateCcw, AlertCircle, CheckCircle2, Mail,
} from "lucide-react";

interface VendorQuote {
  id: number;
  vendorId: number;
  vendorName: string | null;
  status: string;
  submittedAt: string | null;
  openedAt: string | null;
  validUntil: string | null;
  totalValue: number | null;
  paymentTerms: string | null;
  notes: string | null;
  requoteNotes: string | null;
  requoteDeadline: string | null;
  requoteRound: number;
  quotationNumber: string | null;
}

interface RfqDetail {
  rfqId: number;
  rfqNumber: string;
  rfqStatus: string;
  approvalStatus: string;
  buyerName: string;
  buyerEmail: string;
  buyerCompany: string | null;
  buyerApprovalLevel: number | null;
  notes: string | null;
  requiredDeliveryDate: string | null;
  deliveryAddress: string | null;
  createdAt: string;
  pendingApproval: {
    id: number;
    approverLevel: number;
    status: string;
    requestedAt: string;
    responseNotes: string | null;
  } | null;
}

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function fmtDateTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <p className="text-sm text-muted-foreground w-40 shrink-0">{label}</p>
      <p className="text-sm text-gray-800">{value}</p>
    </div>
  );
}

export default function MktRfqDetailPage() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const rfqIdNum = Number(rfqId);
  const qc = useQueryClient();

  const [requoteTarget, setRequoteTarget] = useState<VendorQuote | null>(null);
  const [inviteForm, setInviteForm] = useState({ open: false, vendorId: "", notes: "" });

  const { data: quotesData, isLoading: quotesLoading } = useQuery<{ ok: boolean; data: VendorQuote[]; count: number }>({
    queryKey: ["mkt-vendor-quotes", rfqIdNum],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqIdNum}/vendor-quotes`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat vendor quotes");
      return res.json();
    },
    enabled: !!rfqIdNum,
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const vendorId = Number(inviteForm.vendorId);
      if (!vendorId) throw new Error("Vendor ID tidak valid");
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqIdNum}/invite-vendor`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, notes: inviteForm.notes || undefined }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Gagal mengundang vendor");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Vendor berhasil diundang");
      setInviteForm({ open: false, vendorId: "", notes: "" });
      void qc.invalidateQueries({ queryKey: ["mkt-vendor-quotes", rfqIdNum] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const quotes = quotesData?.data ?? [];
  const submittedQuotes = quotes.filter((q) => ["submitted", "selected"].includes(q.status));

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/marketplace/rfqs">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Detail RFQ</h1>
            <p className="text-sm text-muted-foreground">RFQ ID: {rfqId}</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Link href={`/marketplace/rfqs/${rfqId}/comparison`}>
              <Button variant="outline" size="sm" disabled={submittedQuotes.length < 2}>
                <Scale className="w-4 h-4 mr-1" />
                Comparison
              </Button>
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteForm({ open: true, vendorId: "", notes: "" })}
            >
              <Users className="w-4 h-4 mr-1" />
              Undang Vendor
            </Button>
          </div>
        </div>

        <Tabs defaultValue="quotes">
          <TabsList>
            <TabsTrigger value="quotes">
              <Users className="w-4 h-4 mr-1" />
              Vendor Quotes ({quotes.length})
            </TabsTrigger>
            <TabsTrigger value="approval">
              <UserCheck className="w-4 h-4 mr-1" />
              Approval
            </TabsTrigger>
          </TabsList>

          <TabsContent value="quotes" className="space-y-4 mt-4">
            {quotesLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            )}

            {!quotesLoading && quotes.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="p-12 text-center space-y-3">
                  <Users className="w-10 h-10 text-gray-200 mx-auto" />
                  <p className="text-sm text-muted-foreground">Belum ada vendor yang diundang</p>
                  <Button
                    variant="outline"
                    onClick={() => setInviteForm({ open: true, vendorId: "", notes: "" })}
                  >
                    <Users className="w-4 h-4 mr-1" />
                    Undang Vendor Sekarang
                  </Button>
                </CardContent>
              </Card>
            )}

            {quotes.length > 0 && (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Total Penawaran</TableHead>
                        <TableHead>Terkirim</TableHead>
                        <TableHead>Round</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotes.map((q) => (
                        <TableRow key={q.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{q.vendorName ?? `Vendor #${q.vendorId}`}</p>
                              {q.quotationNumber && (
                                <p className="text-xs text-muted-foreground font-mono">{q.quotationNumber}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell><QuoteStatusBadge status={q.status} /></TableCell>
                          <TableCell className="text-sm font-semibold">
                            {q.totalValue != null ? idr(q.totalValue) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDateTime(q.submittedAt)}
                          </TableCell>
                          <TableCell>
                            {q.requoteRound > 1 && (
                              <Badge variant="outline" className="text-xs bg-orange-50 border-orange-200 text-orange-700">
                                Round {q.requoteRound}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {q.status === "submitted" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-orange-600 hover:bg-orange-50 h-7 text-xs"
                                onClick={() => setRequoteTarget(q)}
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                Requote
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {submittedQuotes.length >= 2 && (
              <div className="flex justify-center">
                <Link href={`/marketplace/rfqs/${rfqId}/comparison`}>
                  <Button className="bg-orange-500 hover:bg-orange-600">
                    <Scale className="w-4 h-4 mr-2" />
                    Buka Vendor Comparison
                  </Button>
                </Link>
              </div>
            )}
          </TabsContent>

          <TabsContent value="approval" className="mt-4">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  Informasi approval ditampilkan di halaman RFQ list.
                  Untuk melihat histori approval lengkap, hubungi sistem administrator.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {requoteTarget && (
        <RequoteDialog
          open={!!requoteTarget}
          onClose={() => setRequoteTarget(null)}
          rfqId={rfqIdNum}
          quoteId={requoteTarget.id}
          vendorName={requoteTarget.vendorName ?? `Vendor #${requoteTarget.vendorId}`}
          currentRound={requoteTarget.requoteRound}
        />
      )}

      <Dialog open={inviteForm.open} onOpenChange={(v) => { if (!v) setInviteForm({ open: false, vendorId: "", notes: "" }); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4 text-blue-500" />
              Undang Vendor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Vendor ID <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                value={inviteForm.vendorId}
                onChange={(e) => setInviteForm((p) => ({ ...p, vendorId: e.target.value }))}
                placeholder="ID vendor dari sistem"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Catatan (opsional)</Label>
              <Textarea
                value={inviteForm.notes}
                onChange={(e) => setInviteForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="resize-none mt-1"
                placeholder="Pesan tambahan untuk vendor"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteForm({ open: false, vendorId: "", notes: "" })}>
              Batal
            </Button>
            <Button
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending || !inviteForm.vendorId}
            >
              {inviteMutation.isPending ? "Mengundang…" : "Kirim Undangan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
