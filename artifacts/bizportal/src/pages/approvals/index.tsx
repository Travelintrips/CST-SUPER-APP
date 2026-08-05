import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, XCircle, ClipboardList, Clock, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type ApprovalRequest = {
  id: number; company_id: number; module: string; doc_type: string;
  doc_id: number; doc_number: string; requested_by: string | null;
  requested_at: string; status: "pending" | "approved" | "rejected";
  approved_by: string | null; approved_at: string | null;
  rejected_by: string | null; rejected_at: string | null;
  note: string | null;
};
type Stats = { pending: number; approved: number; rejected: number };

const statusBadge = (s: string) => {
  if (s === "approved") return <Badge className="bg-green-100 text-green-800 border-green-200">Disetujui</Badge>;
  if (s === "rejected") return <Badge className="bg-red-100 text-red-800 border-red-200">Ditolak</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Menunggu</Badge>;
};

const fmt = (s: string | null) => s ? new Date(s).toLocaleString("id-ID") : "-";
const moduleLabel = (m: string) => ({
  purchase: "Pembelian", sales: "Penjualan", expense: "Beban",
  logistics: "Logistik", finance: "Keuangan",
}[m] ?? m);

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("pending");
  const [module_, setModule] = useState<string>("all");

  const params = new URLSearchParams({ status, limit: "50" });
  if (module_ !== "all") params.set("module", module_);

  const { data, isLoading } = useQuery<{ items: ApprovalRequest[]; total: number }>({
    queryKey: ["approvals", status, module_],
    queryFn: async () => {
      const res = await fetch(`/api/approvals?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const stats = useQuery<Stats>({
    queryKey: ["approval-stats"],
    queryFn: async () => {
      const res = await fetch("/api/approvals/stats");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const approve = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/approvals/${id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: "admin" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Permintaan disetujui" });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approval-stats"] });
    },
    onError: (e) => toast({ title: "Gagal menyetujui", description: String((e as Error).message), variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/approvals/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectedBy: "admin" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Permintaan ditolak" });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approval-stats"] });
    },
    onError: (e) => toast({ title: "Gagal menolak", description: String((e as Error).message), variant: "destructive" }),
  });

  const s = stats.data ?? { pending: 0, approved: 0, rejected: 0 };

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> Approval Workflow
          </h1>
          <p className="text-sm text-muted-foreground">Kelola persetujuan dokumen antar modul</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 pt-4">
              <Clock className="h-8 w-8 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{s.pending}</div>
                <div className="text-xs text-muted-foreground">Menunggu</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-4">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{s.approved}</div>
                <div className="text-xs text-muted-foreground">Disetujui</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-4">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{s.rejected}</div>
                <div className="text-xs text-muted-foreground">Ditolak</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="flex flex-wrap gap-4 p-4">
            <div className="w-40">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Menunggu</SelectItem>
                  <SelectItem value="approved">Disetujui</SelectItem>
                  <SelectItem value="rejected">Ditolak</SelectItem>
                  <SelectItem value="all">Semua</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Modul</label>
              <Select value={module_} onValueChange={setModule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Modul</SelectItem>
                  <SelectItem value="purchase">Pembelian</SelectItem>
                  <SelectItem value="sales">Penjualan</SelectItem>
                  <SelectItem value="expense">Beban</SelectItem>
                  <SelectItem value="logistics">Logistik</SelectItem>
                  <SelectItem value="finance">Keuangan</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Daftar Permintaan Persetujuan</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-muted-foreground">Memuat data...</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Dokumen</TableHead>
                      <TableHead>Modul</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead>Diajukan Oleh</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Catatan</TableHead>
                      {status === "pending" && <TableHead>Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.items ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          Tidak ada permintaan persetujuan
                        </TableCell>
                      </TableRow>
                    ) : (data?.items ?? []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">{item.doc_number}</TableCell>
                        <TableCell><Badge variant="outline">{moduleLabel(item.module)}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.doc_type}</TableCell>
                        <TableCell>{item.requested_by ?? "-"}</TableCell>
                        <TableCell className="text-sm">{fmt(item.requested_at)}</TableCell>
                        <TableCell>{statusBadge(item.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">{item.note ?? "-"}</TableCell>
                        {status === "pending" && (
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() => approve.mutate(item.id)}
                                disabled={approve.isPending}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" /> Setujui
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-700 border-red-300 hover:bg-red-50"
                                onClick={() => reject.mutate(item.id)}
                                disabled={reject.isPending}
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Tolak
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
