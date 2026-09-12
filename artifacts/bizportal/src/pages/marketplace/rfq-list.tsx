import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { RfqStatusBadge, ApprovalStatusBadge } from "@/components/marketplace/MktStatusBadge";
import { Eye, Search, ShoppingBag, Scale, AlertCircle } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

interface MktRfqRow {
  rfqId: number;
  rfqNumber: string;
  rfqStatus: string;
  approvalStatus: string;
  approvalRequestedAt: string | null;
  approvalResolvedAt: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerCompany: string | null;
  buyerApprovalLevel: number | null;
  notes: string | null;
  requiredDeliveryDate: string | null;
  createdAt: string;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function MktRfqListPage() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterApproval, setFilterApproval] = useState("all");

  const { data, isLoading, isError } = useQuery<{ ok: boolean; data: MktRfqRow[]; count: number }>({
    queryKey: ["mkt-admin-rfqs"],
    queryFn: async () => {
      const res = await fetch("/api/mkt/admin/rfqs", { credentials: "include" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];

  const filtered = rows.filter((r) => {
    if (filterStatus !== "all" && r.rfqStatus !== filterStatus) return false;
    if (filterApproval !== "all" && r.approvalStatus !== filterApproval) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        r.rfqNumber.toLowerCase().includes(q) ||
        r.buyerName.toLowerCase().includes(q) ||
        (r.buyerCompany ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pendingCount = rows.filter((r) => r.approvalStatus === "pending").length;

  return (
    <AppShell>
      <BackButton href="/purchase" />
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ShoppingBag className="w-6 h-6 text-orange-500" />
              Marketplace RFQ
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Kelola permintaan penawaran dan approval buyer</p>
          </div>
          <Link href="/marketplace/purchase-orders">
            <Button variant="outline" size="sm">
              <ShoppingBag className="w-4 h-4 mr-1" />
              Purchase Orders
            </Button>
          </Link>
        </div>

        {pendingCount > 0 && (
          <Card className="border-yellow-300 bg-yellow-50">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0" />
              <p className="text-sm text-yellow-800">
                <span className="font-semibold">{pendingCount} RFQ</span> sedang menunggu approval dari buyer
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Cari RFQ, buyer, perusahaan…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Status RFQ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="quoting">Quoting</SelectItem>
                  <SelectItem value="quoted">Quoted</SelectItem>
                  <SelectItem value="awarded">Awarded</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterApproval} onValueChange={setFilterApproval}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Status Approval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Approval</SelectItem>
                  <SelectItem value="none">Tanpa Approval</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}

            {isError && (
              <div className="p-12 text-center space-y-3">
                <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Gagal memuat data RFQ. Endpoint belum tersedia atau terjadi kesalahan server.
                </p>
              </div>
            )}

            {!isLoading && !isError && filtered.length === 0 && (
              <div className="p-12 text-center space-y-2">
                <ShoppingBag className="w-10 h-10 text-gray-200 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {rows.length === 0 ? "Belum ada RFQ masuk" : "Tidak ada hasil sesuai filter"}
                </p>
              </div>
            )}

            {!isLoading && !isError && filtered.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">No. RFQ</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Perusahaan</TableHead>
                    <TableHead>Status RFQ</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Tgl Dibuat</TableHead>
                    <TableHead className="w-24 text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.rfqId} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">{r.rfqNumber}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{r.buyerName}</p>
                          <p className="text-xs text-muted-foreground">{r.buyerEmail}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{r.buyerCompany ?? "—"}</TableCell>
                      <TableCell><RfqStatusBadge status={r.rfqStatus} /></TableCell>
                      <TableCell><ApprovalStatusBadge status={r.approvalStatus} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Link href={`/marketplace/rfqs/${r.rfqId}`}>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                          <Link href={`/marketplace/rfqs/${r.rfqId}/comparison`}>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Scale className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {!isLoading && !isError && (
          <p className="text-xs text-muted-foreground text-right">
            Menampilkan {filtered.length} dari {rows.length} RFQ
          </p>
        )}
      </div>
    </AppShell>
  );
}
