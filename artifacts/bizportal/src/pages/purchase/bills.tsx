import { Link, useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useListPurchaseDocuments,
} from "@workspace/api-client-react";
import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowLeft, ArrowUpRight, FileText, AlertTriangle } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function PaymentStatusBadge({ status }: { status: string }) {
  if (status === "paid") return <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-xs">Lunas</Badge>;
  if (status === "partial") return <Badge className="bg-amber-900/40 text-amber-300 border-amber-700 text-xs">Sebagian</Badge>;
  return <Badge variant="outline" className="text-xs text-slate-400">Belum Bayar</Badge>;
}

export default function PurchaseBillsPage() {
  const [, navigate] = useLocation();
  const { t } = useLanguage();
  const [filter, setFilter] = useState<"all" | "to_bill" | "billed">("all");
  const { data: docs } = useListPurchaseDocuments({ kind: "order" });

  const filtered = (docs ?? []).filter((d) => {
    if (filter === "all") return d.billStatus !== "none";
    return d.billStatus === filter;
  });

  const goToDisbursement = (invoiceId: number) => {
    navigate(`/accounting/bank-disbursements?mode=vendor_invoice&invoiceIds=${invoiceId}`);
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              Bills
              <Badge className="bg-amber-600/20 text-amber-400 border-amber-500 text-[10px] px-1.5 py-0">HISTORIS</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">Data historis — gunakan Vendor Invoice untuk tagihan baru.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")} data-testid="filter-all">Semua</Button>
            <Button size="sm" variant={filter === "to_bill" ? "default" : "outline"} onClick={() => setFilter("to_bill")} data-testid="filter-to-bill">Belum Ditagih</Button>
            <Button size="sm" variant={filter === "billed" ? "default" : "outline"} onClick={() => setFilter("billed")} data-testid="filter-billed">Sudah Ditagih</Button>
          </div>
        </div>

        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-300">Halaman Historis — Read Only</p>
            <p className="text-sm text-amber-200/70 mt-0.5">
              Menu Bills tidak lagi digunakan untuk alur baru. Gunakan <strong>Vendor Invoice</strong> sebagai pusat tagihan, dan <strong>Bank Disbursement</strong> untuk semua pembayaran keluar.
            </p>
            <Link href="/purchase/vendor-invoices">
              <Button size="sm" variant="outline" className="mt-2 border-amber-500/50 text-amber-300 hover:bg-amber-900/30 gap-1">
                <FileText className="h-3.5 w-3.5" /> Buka Vendor Invoice
              </Button>
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Daftar Bill</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Bill</TableHead>
                  <TableHead>No. Order</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status Bill</TableHead>
                  <TableHead>Status Bayar</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Sisa Hutang</TableHead>
                  <TableHead>Tgl Bill</TableHead>
                  <TableHead>Jatuh Tempo</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const balanceDue = Math.max(0, Number(d.grandTotal) - Number(d.amountPaid ?? 0));
                  const effectivePayStatus = balanceDue === 0 ? "paid" : (d.amountPaid ?? 0) > 0 ? "partial" : "unpaid";
                  const canPay = d.billStatus === "billed" && effectivePayStatus !== "paid" && !(d as any).cancelledAt;
                  const isOverdue = (d as any).dueDate && new Date((d as any).dueDate) < new Date() && effectivePayStatus !== "paid" && d.billStatus === "billed";
                  return (
                    <TableRow key={d.id} data-testid={`row-bill-${d.id}`} className={(d as any).cancelledAt ? "opacity-50" : undefined}>
                      <TableCell className="font-mono text-xs text-violet-400">
                        {(d as any).billNumber ?? <span className="text-slate-600">—</span>}
                      </TableCell>
                      <TableCell>
                        <Link href={`/purchase/orders/${d.id}`}>
                          <Badge className="bg-violet-900/40 text-violet-300 border-violet-700 text-xs gap-1 cursor-pointer hover:bg-violet-900/60 font-mono">
                            <FileText className="h-3 w-3" /> {d.docNumber}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell>{d.supplierName}</TableCell>
                      <TableCell>
                        {(d as any).cancelledAt ? (
                          <Badge className="bg-slate-700/60 text-slate-400 border-slate-600 text-xs">Dibatalkan</Badge>
                        ) : (
                          <Badge variant={d.billStatus === "billed" ? "default" : "outline"} className="capitalize">
                            {d.billStatus === "billed" ? "Posted" : d.billStatus.replace("_", " ")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.billStatus === "billed" && !(d as any).cancelledAt ? (
                          <PaymentStatusBadge status={effectivePayStatus} />
                        ) : (
                          <span className="text-slate-500 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{idr(Number(d.grandTotal ?? d.totalAmount))}</TableCell>
                      <TableCell className="text-right">
                        {d.billStatus === "billed" && !(d as any).cancelledAt && balanceDue > 0 ? (
                          <span className="text-amber-400 font-mono text-sm">{idr(balanceDue)}</span>
                        ) : d.billStatus === "billed" && !(d as any).cancelledAt && balanceDue === 0 ? (
                          <span className="text-emerald-400 text-xs">Lunas</span>
                        ) : (
                          <span className="text-slate-500 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {(d as any).billDate ? new Date((d as any).billDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                      </TableCell>
                      <TableCell className={`text-xs ${isOverdue ? "text-red-400 font-semibold" : "text-slate-400"}`}>
                        {(d as any).dueDate ? new Date((d as any).dueDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        {isOverdue && <span className="ml-1 text-xs">(Lewat)</span>}
                      </TableCell>
                      <TableCell>
                        {canPay && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-7 text-xs border-orange-700/50 text-orange-400 hover:bg-orange-900/20"
                            data-testid={`pay-btn-${d.id}`}
                            onClick={() => goToDisbursement(d.id)}
                          >
                            <ArrowUpRight className="h-3 w-3" /> Buat Disbursement
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      Belum ada bill.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
