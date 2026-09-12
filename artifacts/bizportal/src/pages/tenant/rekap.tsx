import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, TrendingUp, AlertTriangle, CheckCircle, ChevronLeft } from "lucide-react";
import { Link } from "wouter";

interface CompanyOption { id: number; companyName: string; companyCode: string; }

interface RekapRow {
  id: number;
  business_name: string;
  owner_name: string;
  phone: string | null;
  business_category: string | null;
  status: string;
  company_id: number;
  total_bookings: number;
  active_bookings: number;
  total_paid: number;
  total_outstanding: number;
  last_payment_at: string | null;
  overdue_invoices: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export default function TenantRekapPage() {
  const [companyId, setCompanyId] = useState("all");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Load companies dynamically from API
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["companies"],
    queryFn: () => fetch("/api/companies", { credentials: "include" }).then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  const companyLabel = (id: number) => companies.find((c) => c.id === id)?.companyName ?? String(id);

  const { data, isLoading } = useQuery<{ data: RekapRow[]; total: number }>({
    queryKey: ["tenant-rekap", companyId],
    queryFn: async () => {
      const params = companyId !== "all" ? `?companyId=${companyId}` : "";
      const r = await fetch(`/api/tenant/rekap${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat rekap");
      return r.json();
    },
    staleTime: 30_000,
  });

  const rows = (data?.data ?? []).filter((r) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return r.business_name.toLowerCase().includes(q) || (r.owner_name ?? "").toLowerCase().includes(q) || (r.phone ?? "").includes(q);
    }
    return true;
  });

  const totalPaid = rows.reduce((s, r) => s + r.total_paid, 0);
  const totalOutstanding = rows.reduce((s, r) => s + r.total_outstanding, 0);
  const overdueCount = rows.filter((r) => r.overdue_invoices > 0).length;

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6 text-indigo-600" />Rekap Tenant</h1>
          <p className="text-sm text-muted-foreground mt-1">Ringkasan per penyewa: pembayaran, piutang, dan booking</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Penyewa</p>
            <p className="text-2xl font-bold mt-0.5">{rows.length}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Terkumpul</p>
            <p className="text-lg font-bold mt-0.5 text-green-700">{fmt(totalPaid)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Piutang</p>
            <p className="text-lg font-bold mt-0.5 text-amber-700">{fmt(totalOutstanding)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Penyewa Overdue</p>
            <p className="text-2xl font-bold mt-0.5 text-red-700">{overdueCount}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Detail Rekap</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama, pemilik, telepon..." className="pl-8 h-8 text-sm" />
              </div>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Lokasi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Lokasi</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="inactive">Tidak Aktif</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Penyewa</TableHead>
                    <TableHead>Lokasi</TableHead>
                    <TableHead className="text-center">Booking</TableHead>
                    <TableHead className="text-right">Terkumpul</TableHead>
                    <TableHead className="text-right">Piutang</TableHead>
                    <TableHead>Bayar Terakhir</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/tenant/tenants`} className="font-medium text-sm hover:underline text-indigo-700">{r.business_name}</Link>
                        <p className="text-xs text-muted-foreground">{r.owner_name}</p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{companyLabel(r.company_id)}</TableCell>
                      <TableCell className="text-center">
                        <span className="font-mono text-sm">{r.active_bookings}/{r.total_bookings}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-green-700">{fmt(r.total_paid)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.total_outstanding > 0 ? (
                          <span className={r.overdue_invoices > 0 ? "text-red-700 font-semibold" : "text-amber-700"}>
                            {fmt(r.total_outstanding)}
                          </span>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.last_payment_at ? new Date(r.last_payment_at).toLocaleDateString("id-ID") : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.overdue_invoices > 0 ? (
                          <Badge className="bg-red-100 text-red-800 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Overdue ({r.overdue_invoices})</Badge>
                        ) : r.status === "active" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 text-xs"><CheckCircle className="h-3 w-3 mr-1" />Aktif</Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-600 text-xs">{r.status}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Tidak ada data.</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
