import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, Plus, Eye, ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const statusColor: Record<string, string> = {
  draft: "secondary", submitted: "default", approved: "default",
  rejected: "destructive", converted: "outline", cancelled: "destructive",
};
const statusLabel: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", approved: "Approved",
  rejected: "Rejected", converted: "Converted→RFQ", cancelled: "Cancelled",
};

export default function PurchaseRequestListPage() {
  const { activeCompanyId } = useCompany();
  const { data: prs = [], isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/pr", activeCompanyId],
    queryFn: () => fetch(`/api/purchase-workflow/pr?company=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Purchase Request (PR)</h1>
            <p className="text-sm text-muted-foreground">Daftar permintaan pembelian internal</p>
          </div>
          <Link href="/purchase/pr/new">
            <Button><Plus className="mr-2 h-4 w-4" />Buat PR</Button>
          </Link>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />Daftar Purchase Request</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : prs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Belum ada purchase request</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">No. PR</th>
                      <th className="text-left py-2 px-3 font-medium">Pemohon</th>
                      <th className="text-left py-2 px-3 font-medium">Departemen</th>
                      <th className="text-left py-2 px-3 font-medium">Status</th>
                      <th className="text-left py-2 px-3 font-medium">Tanggal</th>
                      <th className="text-right py-2 px-3 font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prs.map((pr: Record<string, unknown>) => (
                      <tr key={String(pr.id)} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs">{String(pr.prNumber)}</td>
                        <td className="py-2 px-3">{String(pr.requestedBy ?? "-")}</td>
                        <td className="py-2 px-3">{String(pr.department ?? "-")}</td>
                        <td className="py-2 px-3">
                          <Badge variant={statusColor[String(pr.status)] as "default" | "secondary" | "destructive" | "outline" ?? "secondary"}>
                            {statusLabel[String(pr.status)] ?? String(pr.status)}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">{new Date(String(pr.createdAt)).toLocaleDateString("id-ID")}</td>
                        <td className="py-2 px-3 text-right">
                          <Link href={`/purchase/pr/${pr.id}`}>
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
