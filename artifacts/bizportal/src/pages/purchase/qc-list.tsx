import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, Plus, Eye, ClipboardCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function QcListPage() {
  const { activeCompanyId } = useCompany();
  const { data: qcs = [], isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/qc", activeCompanyId],
    queryFn: () => fetch(`/api/purchase-workflow/qc?company=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">QC Inspection</h1>
            <p className="text-sm text-muted-foreground">Pemeriksaan kualitas barang diterima</p>
          </div>
          <Link href="/purchase/qc/new">
            <Button><Plus className="mr-2 h-4 w-4" />Buat QC</Button>
          </Link>
        </div>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Daftar QC Inspection</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="text-center py-8 text-muted-foreground">Loading...</div>
              : qcs.length === 0 ? <div className="text-center py-8 text-muted-foreground">Belum ada QC inspection</div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b">
                      <th className="text-left py-2 px-3">No. QC</th>
                      <th className="text-left py-2 px-3">GR#</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Inspektor</th>
                      <th className="text-left py-2 px-3">Tgl</th>
                      <th className="text-right py-2 px-3">Aksi</th>
                    </tr></thead>
                    <tbody>
                      {qcs.map((qc: Record<string, unknown>) => (
                        <tr key={String(qc.id)} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-3 font-mono text-xs">{String(qc.qcNumber)}</td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">GR#{String(qc.grId)}</td>
                          <td className="py-2 px-3"><Badge variant={qc.status === "passed" ? "default" : qc.status === "failed" ? "destructive" : "secondary"}>{String(qc.status)}</Badge></td>
                          <td className="py-2 px-3">{String(qc.inspectorName ?? "-")}</td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">{new Date(String(qc.createdAt)).toLocaleDateString("id-ID")}</td>
                          <td className="py-2 px-3 text-right"><Link href={`/purchase/qc/${qc.id}`}><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></Link></td>
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
