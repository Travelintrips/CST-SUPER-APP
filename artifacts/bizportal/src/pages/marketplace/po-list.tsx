import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PoStatusBadge } from "@/components/marketplace/MktStatusBadge";
import { Eye, Search, Package, AlertCircle } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

interface MktPoRow {
  id: number;
  poNumber: string;
  rfqId: number;
  companyId: number;
  vendorId: number;
  status: string;
  totalAmount: string | null;
  grandTotal: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  vendorNameSnapshot: string | null;
  currencySnapshot: string | null;
  leadTimeDaysSnapshot: number | null;
  rfqNumber: string | null;
  vendorName: string | null;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function fmtCurrency(amount: string | null | undefined, currency: string | null | undefined) {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  const cur = currency ?? "IDR";
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(num);
}

const PO_STATUSES = [
  { value: "pending",            label: "Pending" },
  { value: "revision_requested", label: "Revisi" },
  { value: "issued",             label: "Issued" },
  { value: "vendor_accepted",    label: "Vendor Accepted" },
  { value: "production",         label: "Produksi" },
  { value: "ready_to_ship",      label: "Siap Kirim" },
  { value: "in_transit",         label: "Dalam Perjalanan" },
  { value: "delivered",          label: "Terkirim" },
  { value: "completed",          label: "Selesai" },
  { value: "closed",             label: "Closed" },
  { value: "cancelled",          label: "Dibatalkan" },
];

export default function MktPoListPage() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data, isLoading, isError, refetch } = useQuery<{ ok: boolean; data: MktPoRow[]; count: number }>({
    queryKey: ["mkt-admin-purchase-orders"],
    queryFn: async () => {
      const res = await fetch("/api/mkt/admin/purchase-orders?limit=200", { credentials: "include" });
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
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        r.poNumber.toLowerCase().includes(q) ||
        (r.vendorName ?? r.vendorNameSnapshot ?? "").toLowerCase().includes(q) ||
        (r.rfqNumber ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <AppShell>
      <BackButton href="/purchase" />
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-6 h-6 text-orange-500" />
              Purchase Orders
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Kelola lifecycle Purchase Order Marketplace</p>
          </div>
          <Link href="/marketplace/rfqs">
            <Button variant="outline" size="sm">
              <Package className="w-4 h-4 mr-1" />
              Lihat RFQ
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Cari PO number, vendor, RFQ…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Status PO" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {PO_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
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
                <p className="text-sm text-muted-foreground">Gagal memuat data Purchase Order.</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>Coba Lagi</Button>
              </div>
            )}

            {!isLoading && !isError && filtered.length === 0 && (
              <div className="p-12 text-center space-y-2">
                <Package className="w-10 h-10 text-gray-200 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {rows.length === 0 ? "Belum ada Purchase Order" : "Tidak ada hasil sesuai filter"}
                </p>
              </div>
            )}

            {!isLoading && !isError && filtered.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">No. PO</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>No. RFQ</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Grand Total</TableHead>
                    <TableHead>Lead Time</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead className="w-16 text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">{r.poNumber}</TableCell>
                      <TableCell className="text-sm">
                        {r.vendorName ?? r.vendorNameSnapshot ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.rfqNumber ?? "—"}
                      </TableCell>
                      <TableCell><PoStatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {fmtCurrency(r.grandTotal, r.currencySnapshot)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.leadTimeDaysSnapshot != null ? `${r.leadTimeDaysSnapshot} hari` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/marketplace/purchase-orders/${r.id}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
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
            Menampilkan {filtered.length} dari {rows.length} PO
          </p>
        )}
      </div>
    </AppShell>
  );
}
