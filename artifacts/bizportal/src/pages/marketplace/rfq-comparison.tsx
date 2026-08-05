import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RequoteDialog } from "@/components/marketplace/RequoteDialog";
import { QuoteStatusBadge } from "@/components/marketplace/MktStatusBadge";
import { toast } from "sonner";
import {
  ArrowLeft, Trophy, TrendingDown, Clock, CheckCircle2,
  RotateCcw, AlertCircle, Scale, Star, Send,
} from "lucide-react";

interface ComparisonQuote {
  id: number;
  vendorId: number;
  vendorName: string | null;
  status: string;
  submittedAt: string | null;
  validUntil: string | null;
  totalAmount: number | null;
  paymentTerms: string | null;
  incoterm: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  quotationNumber: string | null;
  requoteRound: number;
  requoteNotes: string | null;
  requoteDeadline: string | null;
  quoteLines: Array<{
    rfqLineId: number;
    itemName: string;
    offeredUnitPrice: string;
    offeredQty: string;
    subtotal: string;
    leadTimeDays: number | null;
    stockStatus: string | null;
    isPartialQuote: boolean;
  }>;
  scores?: {
    price: number;
    delivery: number;
    total: number;
    isBest: boolean;
  };
}

interface ComparisonData {
  rfq: {
    id: number;
    rfqNumber: string;
    status: string;
    approvalStatus: string;
    buyerName: string;
    buyerCompany: string | null;
    requiredDeliveryDate: string | null;
  };
  quotes: ComparisonQuote[];
  submittedCount: number;
}

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-600 w-8">{score}</span>
    </div>
  );
}

export default function MktRfqComparisonPage() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const rfqIdNum = Number(rfqId);
  const qc = useQueryClient();

  const [requoteTarget, setRequoteTarget] = useState<ComparisonQuote | null>(null);
  const [selectTarget, setSelectTarget] = useState<ComparisonQuote | null>(null);
  const [selectNotes, setSelectNotes] = useState("");
  const [sendToCustomerTarget, setSendToCustomerTarget] = useState<ComparisonQuote | null>(null);
  const [sendToCustomerNotes, setSendToCustomerNotes] = useState("");

  const { data, isLoading, isError } = useQuery<{ ok: boolean; data: ComparisonData }>({
    queryKey: ["mkt-comparison", rfqIdNum],
    queryFn: async () => {
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqIdNum}/comparison`, { credentials: "include" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Gagal memuat comparison");
      }
      return res.json();
    },
    enabled: !!rfqIdNum,
  });

  const selectMutation = useMutation({
    mutationFn: async () => {
      if (!selectTarget) throw new Error("Tidak ada vendor dipilih");
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqIdNum}/select-vendor`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: selectTarget.id, notes: selectNotes || undefined }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Gagal memilih vendor");
      }
      return res.json();
    },
    onSuccess: (result: { ok: boolean; data: { poNumber: string; vendor: string; total: number } }) => {
      toast.success(`PO ${result.data.poNumber} berhasil dibuat untuk ${result.data.vendor}`);
      setSelectTarget(null);
      setSelectNotes("");
      void qc.invalidateQueries({ queryKey: ["mkt-comparison", rfqIdNum] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setSelectTarget(null);
    },
  });

  const sendToCustomerMutation = useMutation({
    mutationFn: async () => {
      if (!sendToCustomerTarget) throw new Error("Tidak ada vendor dipilih");
      const res = await fetch(`/api/mkt/admin/rfqs/${rfqIdNum}/send-to-customer`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: sendToCustomerTarget.id, notes: sendToCustomerNotes || undefined }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Gagal mengirim ke customer");
      }
      return res.json() as Promise<{ ok: boolean; data: { rfqNumber: string; vendorName: string; buyerEmail: string } }>;
    },
    onSuccess: (result) => {
      toast.success(`Quotation ${result.data.vendorName} dikirim ke customer ${result.data.buyerEmail} untuk persetujuan`);
      setSendToCustomerTarget(null);
      setSendToCustomerNotes("");
      void qc.invalidateQueries({ queryKey: ["mkt-comparison", rfqIdNum] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setSendToCustomerTarget(null);
    },
  });

  const rfq = data?.data.rfq;
  const quotes = data?.data.quotes ?? [];
  const submittedQuotes = quotes.filter((q) => ["submitted", "selected"].includes(q.status));
  const isAwarded = rfq?.status === "awarded";
  const isCustomerReview = rfq?.status === "customer_review";
  const isLocked = isAwarded || isCustomerReview;

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href={`/marketplace/rfqs/${rfqId}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Scale className="w-5 h-5 text-orange-500" />
              Vendor Comparison
            </h1>
            {rfq && (
              <p className="text-sm text-muted-foreground">
                RFQ <span className="font-mono font-semibold">{rfq.rfqNumber}</span>
                {rfq.buyerCompany && <span> · {rfq.buyerCompany}</span>}
              </p>
            )}
          </div>
          {isAwarded && (
            <Badge className="ml-auto bg-green-100 text-green-700 border-green-300 text-sm">
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Awarded
            </Badge>
          )}
          {isCustomerReview && (
            <Badge className="ml-auto bg-orange-100 text-orange-700 border-orange-300 text-sm">
              <AlertCircle className="w-4 h-4 mr-1" />
              Menunggu Persetujuan Customer
            </Badge>
          )}
        </div>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
            </div>
          </div>
        )}

        {isError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-8 text-center space-y-2">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-red-700 font-medium">Gagal memuat data comparison</p>
              <p className="text-sm text-red-500">Pastikan RFQ memiliki quotes yang sudah disubmit</p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && submittedQuotes.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center space-y-3">
              <Scale className="w-12 h-12 text-gray-200 mx-auto" />
              <p className="text-muted-foreground">Belum ada penawaran yang bisa dibandingkan</p>
              <p className="text-sm text-muted-foreground">Diperlukan minimal 1 vendor yang sudah submit quote</p>
              <Link href={`/marketplace/rfqs/${rfqId}`}>
                <Button variant="outline">Kembali ke Detail RFQ</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && submittedQuotes.length > 0 && (
          <>
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <Scale className="w-4 h-4 text-blue-500 shrink-0" />
              <p className="text-blue-700">
                <span className="font-semibold">{submittedQuotes.length} penawaran</span> siap dibandingkan.
                {!isLocked && " Kirim ke customer untuk review, atau award langsung."}
                {isCustomerReview && " Menunggu persetujuan customer sebelum PO dapat dibuat."}
              </p>
            </div>

            <div className={`grid gap-4 ${submittedQuotes.length === 1 ? "grid-cols-1 max-w-sm" : submittedQuotes.length === 2 ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-3"}`}>
              {submittedQuotes.map((q) => {
                const isBest = q.scores?.isBest;
                const isSelected = q.status === "selected";

                return (
                  <Card
                    key={q.id}
                    className={`relative ${isBest && !isAwarded ? "ring-2 ring-orange-400 shadow-orange-100 shadow-md" : ""} ${isSelected ? "ring-2 ring-green-500" : ""}`}
                  >
                    {isBest && !isAwarded && (
                      <div className="absolute -top-3 left-4">
                        <Badge className="bg-orange-500 text-white text-xs px-2 py-0.5">
                          <Trophy className="w-3 h-3 mr-1" />
                          Rekomendasi
                        </Badge>
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute -top-3 left-4">
                        <Badge className="bg-green-600 text-white text-xs px-2 py-0.5">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Dipilih
                        </Badge>
                      </div>
                    )}

                    <CardHeader className="pb-3 pt-5">
                      <CardTitle className="text-base">{q.vendorName ?? `Vendor #${q.vendorId}`}</CardTitle>
                      <div className="flex items-center gap-2">
                        <QuoteStatusBadge status={q.status} />
                        {q.requoteRound > 1 && (
                          <Badge variant="outline" className="text-xs bg-orange-50 border-orange-200 text-orange-700">
                            Round {q.requoteRound}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-muted-foreground">Total Penawaran</p>
                        <p className={`text-xl font-bold ${isBest ? "text-orange-600" : "text-gray-800"}`}>
                          {q.totalAmount != null ? idr(q.totalAmount) : "—"}
                        </p>
                      </div>

                      {q.scores && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Skor</p>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs text-gray-600">
                              <TrendingDown className="w-3.5 h-3.5 text-green-500" />
                              <span className="w-12">Harga</span>
                              <ScoreBar score={q.scores.price} color="bg-green-400" />
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-600">
                              <Clock className="w-3.5 h-3.5 text-blue-500" />
                              <span className="w-12">Delivery</span>
                              <ScoreBar score={q.scores.delivery} color="bg-blue-400" />
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-700 font-semibold">
                              <Star className="w-3.5 h-3.5 text-orange-500" />
                              <span className="w-12">Total</span>
                              <ScoreBar score={q.scores.total} color="bg-orange-400" />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="space-y-1.5 text-sm">
                        {q.paymentTerms && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Pembayaran</span>
                            <span className="text-xs font-medium">{q.paymentTerms}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground text-xs">Dikirim</span>
                          <span className="text-xs">{fmtDate(q.submittedAt)}</span>
                        </div>
                        {q.validUntil && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Valid hingga</span>
                            <span className="text-xs">{fmtDate(q.validUntil)}</span>
                          </div>
                        )}
                      </div>

                      {q.quoteLines.length > 0 && (
                        <div className="space-y-1.5 border-t pt-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item</p>
                          {q.quoteLines.map((ql, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-gray-600 truncate max-w-[60%]">{ql.itemName}</span>
                              <span className="font-medium shrink-0">{idr(Number(ql.subtotal))}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {q.notes && (
                        <div className="p-2 bg-gray-50 rounded text-xs text-gray-600">
                          {q.notes}
                        </div>
                      )}

                      {!isLocked && (
                        <div className="flex flex-col gap-2 pt-2 border-t">
                          <Button
                            size="sm"
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                            onClick={() => { setSendToCustomerTarget(q); setSendToCustomerNotes(""); }}
                          >
                            <Send className="w-3.5 h-3.5 mr-1" />
                            Kirim ke Customer
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full border-green-300 text-green-700 hover:bg-green-50 text-xs"
                            onClick={() => { setSelectTarget(q); setSelectNotes(""); }}
                          >
                            <Trophy className="w-3 h-3 mr-1" />
                            Award Langsung
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                            onClick={() => setRequoteTarget(q)}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Minta Requote
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {quotes.filter((q) => !["submitted", "selected"].includes(q.status)).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">Vendor Lain</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {quotes
                      .filter((q) => !["submitted", "selected"].includes(q.status))
                      .map((q) => (
                        <div key={q.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-gray-50">
                          <span className="font-medium">{q.vendorName ?? `Vendor #${q.vendorId}`}</span>
                          <QuoteStatusBadge status={q.status} />
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
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

      {/* Dialog: Kirim ke Customer */}
      <Dialog open={!!sendToCustomerTarget} onOpenChange={(v) => { if (!v) setSendToCustomerTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <Send className="w-5 h-5" />
              Kirim Quotation ke Customer
            </DialogTitle>
          </DialogHeader>
          {sendToCustomerTarget && (
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="font-semibold text-orange-800 text-lg">{sendToCustomerTarget.vendorName ?? `Vendor #${sendToCustomerTarget.vendorId}`}</p>
                {sendToCustomerTarget.totalAmount != null && (
                  <p className="text-2xl font-bold text-orange-700 mt-1">{idr(sendToCustomerTarget.totalAmount)}</p>
                )}
              </div>
              <p className="text-sm text-gray-600">
                Customer akan menerima notifikasi dan perlu <strong>menyetujui</strong> penawaran ini sebelum
                Purchase Order dibuat. Anda tidak bisa memilih vendor lain selama menunggu persetujuan customer.
              </p>
              <div>
                <Label>Catatan ke Customer (opsional)</Label>
                <Textarea
                  value={sendToCustomerNotes}
                  onChange={(e) => setSendToCustomerNotes(e.target.value)}
                  rows={2}
                  className="resize-none mt-1"
                  placeholder="Pesan tambahan untuk customer..."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendToCustomerTarget(null)} disabled={sendToCustomerMutation.isPending}>
              Batal
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              onClick={() => sendToCustomerMutation.mutate()}
              disabled={sendToCustomerMutation.isPending}
            >
              <Send className="w-4 h-4 mr-1" />
              {sendToCustomerMutation.isPending ? "Mengirim…" : "Kirim ke Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Award Langsung */}
      <Dialog open={!!selectTarget} onOpenChange={(v) => { if (!v) setSelectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <Trophy className="w-5 h-5" />
              Konfirmasi Pilih Vendor
            </DialogTitle>
          </DialogHeader>
          {selectTarget && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="font-semibold text-green-800 text-lg">{selectTarget.vendorName}</p>
                {selectTarget.totalAmount != null && (
                  <p className="text-2xl font-bold text-green-700 mt-1">{idr(selectTarget.totalAmount)}</p>
                )}
              </div>
              <p className="text-sm text-gray-600">
                Memilih vendor ini akan membuat <strong>Purchase Order</strong> otomatis dan
                menolak semua penawaran vendor lain. Tindakan ini tidak dapat dibatalkan.
              </p>
              <div>
                <Label>Catatan (opsional)</Label>
                <Textarea
                  value={selectNotes}
                  onChange={(e) => setSelectNotes(e.target.value)}
                  rows={2}
                  className="resize-none mt-1"
                  placeholder="Catatan keputusan pemilihan vendor"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectTarget(null)} disabled={selectMutation.isPending}>
              Batal
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => selectMutation.mutate()}
              disabled={selectMutation.isPending}
            >
              {selectMutation.isPending ? "Memproses…" : "Konfirmasi & Buat PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
