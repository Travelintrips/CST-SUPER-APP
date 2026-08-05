import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { RefreshCw, Search, Eye } from "lucide-react";

interface CSR {
  id: number;
  requestNumber: string;
  status: string;
  tradeType: string;
  mode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCompany: string;
  adminNotes: string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  need_review: "Perlu Review",
  need_more_data: "Butuh Data",
  approved_for_rfq: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  need_review: "bg-yellow-100 text-yellow-800",
  need_more_data: "bg-orange-100 text-orange-700",
  approved_for_rfq: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

export default function ServiceRequestsPage() {
  const [, setLocation] = useLocation();
  const [requests, setRequests] = useState<CSR[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tradeTypeFilter, setTradeTypeFilter] = useState("all");

  async function fetchRequests() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (tradeTypeFilter !== "all") params.set("tradeType", tradeTypeFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/admin/service-requests?${params}`);
      if (!res.ok) throw new Error("Gagal fetch");
      const data = await res.json();
      setRequests(data.requests ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchRequests(); }, [statusFilter, tradeTypeFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRequests();
  };

  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Service Request CSR</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Screening & persetujuan permintaan layanan pelanggan
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchRequests}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="pt-4">
            <form onSubmit={handleSearch} className="flex gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari nama, email, nomor CSR, perusahaan..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Semua status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={tradeTypeFilter} onValueChange={setTradeTypeFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Trade type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Type</SelectItem>
                  <SelectItem value="import">Import</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                  <SelectItem value="domestic">Domestik</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={loading}>Cari</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {total > 0 ? `${total} total request` : `${requests.length} request`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Memuat data...</div>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Tidak ada service request</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. CSR</TableHead>
                    <TableHead>Pelanggan</TableHead>
                    <TableHead>Perusahaan</TableHead>
                    <TableHead>Trade Type</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ditangani</TableHead>
                    <TableHead>Waktu</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-xs">{r.requestNumber}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.customerName}</div>
                        <div className="text-xs text-muted-foreground">{r.customerEmail}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.customerCompany || "-"}</TableCell>
                      <TableCell>
                        <span className="text-xs uppercase font-medium">{r.tradeType}</span>
                      </TableCell>
                      <TableCell className="text-sm">{r.mode || "-"}</TableCell>
                      <TableCell>
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.handledBy || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.createdAt ? formatDistanceToNow(new Date(r.createdAt), { locale: localeId, addSuffix: true }) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLocation(`/logistics/service-requests/${r.id}`)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
