import { useGetApAging, getGetApAgingQueryKey } from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { apiFetch } from "@/lib/api";
import { Link } from "wouter";
import { ArrowLeft, FileText, Package } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const bucketColor = (b: string) => {
  if (b === "0-30") return "bg-green-100 text-green-800";
  if (b === "31-60") return "bg-yellow-100 text-yellow-800";
  if (b === "61-90") return "bg-orange-100 text-orange-800";
  return "bg-red-100 text-red-800";
};

export default function ApAgingPage() {
  const { activeCompanyId, companyQueryParam, isConsolidated } = useCompany();
  const { data, isLoading, error } = useGetApAging({
    query: {
      queryKey: [...getGetApAgingQueryKey(), activeCompanyId],
      queryFn: () => apiFetch(isConsolidated
        ? "/api/reports/ap-aging"
        : `/api/reports/ap-aging?${companyQueryParam}`),
      enabled: isConsolidated || companyQueryParam.length > 0,
    },
  });

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div>
          <Link href="/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" /> Hutang (Accounts Payable)
          </h1>
          <p className="text-sm text-muted-foreground">Daftar tagihan pembelian yang belum lunas — menampilkan sisa hutang setelah pembayaran (tidak termasuk yang dibatalkan)</p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" data-testid="error-state">
            Gagal memuat: {String((error as any)?.message ?? error)}
          </div>
        ) : isLoading || !data ? (
          <div className="text-muted-foreground">Memuat...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <Card>
                <CardHeader><CardTitle className="text-sm text-muted-foreground">Total Hutang</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold" data-testid="stat-total-ap">{idr(data.total)}</div></CardContent>
              </Card>
              {(["0-30", "31-60", "61-90", "90+"] as const).map((b) => (
                <Card key={b}>
                  <CardHeader><CardTitle className="text-sm text-muted-foreground">{b} hari</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold">{idr(data.buckets[b])}</div></CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader><CardTitle>Detail Hutang</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No Dokumen</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Sejak</TableHead>
                      <TableHead className="text-right">Umur</TableHead>
                      <TableHead className="text-right">Total Hutang</TableHead>
                      <TableHead className="text-right">Dibayar</TableHead>
                      <TableHead className="text-right">Sisa Hutang</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Tidak ada hutang</TableCell></TableRow>
                    ) : data.items.map((it) => {
                      const isPartial = it.amountPaid > 0;
                      const pctPaid = it.grandTotal > 0 ? Math.round((it.amountPaid / it.grandTotal) * 100) : 0;
                      return (
                        <TableRow key={it.id}>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Link href={`/purchase/orders/${it.id}`}>
                                <span className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline font-mono">
                                  <Package size={10} />
                                  {it.docNumber}
                                </span>
                              </Link>
                              {isPartial && (
                                <span className="inline-flex w-fit">
                                  <Badge className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0 font-medium border border-amber-200">
                                    Dibayar sebagian
                                  </Badge>
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{it.supplierName ?? "-"}</TableCell>
                          <TableCell>{new Date(it.confirmedAt).toLocaleDateString("id-ID")}</TableCell>
                          <TableCell className="text-right">
                            <Badge className={bucketColor(it.bucket)}>{it.daysOld} hari</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {isPartial ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="font-medium">{idr(it.grandTotal)}</span>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-20 h-2 rounded-full bg-gray-200 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-amber-400"
                                      style={{ width: `${pctPaid}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-amber-600 font-medium">{pctPaid}%</span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{idr(it.grandTotal)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isPartial ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-amber-700 font-medium">{idr(it.amountPaid)}</span>
                                <span className="text-[10px] text-muted-foreground">dari {idr(it.grandTotal)}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{idr(it.amountPaid)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">{idr(it.amount)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
