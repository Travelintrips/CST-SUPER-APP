import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, Plus, Eye, PackageCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function GoodsReceiptListPage() {
  const { activeCompanyId } = useCompany();
  const { data: grs = [], isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/gr", activeCompanyId],
    queryFn: () => fetch(`/api/purchase-workflow/gr?company=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Goods Receipt Note (GRN)</h1>
            <p className="text-sm text-muted-foreground">Penerimaan barang dari supplier</p>
          </div>
          <Link href="/purchase/gr/new">
            <Button><Plus className="mr-2 h-4 w-4" />Buat GRN</Button>
          </Link>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5" />Daftar GRN</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : grs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Belum ada goods receipt</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">No. GRN</th>
                      <th className="text-left py-2 px-3 font-medium">No. PO</th>
                      <th className="text-left py-2 px-3 font-medium">Status</th>
                      <th className="text-left py-2 px-3 font-medium">Tgl Terima</th>
                      <th className="text-left py-2 px-3 font-medium">Surat Jalan</th>
                      <th className="text-right py-2 px-3 font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grs.map((gr: Record<string, unknown>) => (
                      <tr key={String(gr.id)} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs">{String(gr.grNumber)}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">PO#{String(gr.poId)}</td>
                        <td className="py-2 px-3">
                          <Badge variant={gr.status === "confirmed" ? "default" : gr.status === "cancelled" ? "destructive" : "secondary"}>
                            {String(gr.status)}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">{new Date(String(gr.receiveDate)).toLocaleDateString("id-ID")}</td>
                        <td className="py-2 px-3 text-xs">{String(gr.deliveryNote ?? "-")}</td>
                        <td className="py-2 px-3 text-right">
                          <Link href={`/purchase/gr/${gr.id}`}>
                            <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
