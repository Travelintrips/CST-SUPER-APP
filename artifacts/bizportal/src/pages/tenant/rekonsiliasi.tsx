import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { GitCompare, CheckCircle, AlertCircle, Clock, ChevronLeft } from "lucide-react";
import { Link } from "wouter";

interface Invoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  status: string;
  business_name: string;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  company_id: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n ?? 0);
}

const STATUS_BADGE: Record<string, { label: string; cls: string; icon?: React.ReactNode }> = {
  paid:      { label: "Lunas",    cls: "bg-emerald-100 text-emerald-800", icon: <CheckCircle className="h-3 w-3" /> },
  partial:   { label: "Sebagian", cls: "bg-blue-100 text-blue-800",       icon: <Clock className="h-3 w-3" /> },
  unpaid:    { label: "Belum Bayar", cls: "bg-amber-100 text-amber-800",  icon: <AlertCircle className="h-3 w-3" /> },
  overdue:   { label: "Terlambat", cls: "bg-red-100 text-red-800",        icon: <AlertCircle className="h-3 w-3" /> },
  draft:     { label: "Draft",    cls: "bg-slate-100 text-slate-600" },
  sent:      { label: "Terkirim", cls: "bg-sky-100 text-sky-800" },
  cancelled: { label: "Batal",    cls: "bg-slate-100 text-slate-500" },
};

export default function TenantRekonsiliasiPage() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [companyId, setCompanyId] = useState("all");

  const { data, isLoading } = useQuery<{ data: Invoice[]; total: number }>({
    queryKey: ["tenant-invoices-rekon", filterStatus, companyId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (filterStatus !== "all") p.set("status", filterStatus);
      if (companyId !== "all") p.set("companyId", companyId);
      const r = await fetch(`/api/tenant/invoices?${p}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalTagihan  = rows.reduce((s, r) => s + r.total_amount, 0);
  const totalTerbayar = rows.reduce((s, r) => s + r.paid_amount, 0);
  const totalPiutang  = rows.reduce((s, r) => s + r.outstanding_amount, 0);
  const overdueRows   = rows.filter((r) => r.status === "overdue" || (r.due_date && new Date(r.due_date) < new Date() && !["paid","cancelled"].includes(r.status)));

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><GitCompare className="h-6 w-6 text-violet-600" />Rekonsiliasi Invoice</h1>
          <p className="text-sm text-muted-foreground mt-1">Saldo invoice vs pembayaran per penyewa</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Tagihan</p>
            <p className="text-lg font-bold mt-0.5">{fmt(totalTagihan)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Terbayar</p>
            <p className="text-lg font-bold mt-0.5 text-green-700">{fmt(totalTerbayar)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Sisa Piutang</p>
            <p className="text-lg font-bold mt-0.5 text-amber-700">{fmt(totalPiutang)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold mt-0.5 text-red-700">{overdueRows.length}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Daftar Invoice</CardTitle>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="unpaid">Belum Bayar</SelectItem>
                  <SelectItem value="partial">Sebagian</SelectItem>
                  <SelectItem value="paid">Lunas</SelectItem>
                  <SelectItem value="overdue">Terlambat</SelectItem>
                  <SelectItem value="sent">Terkirim</SelectItem>
                  <SelectItem value="cancelled">Batal</SelectItem>
                </SelectContent>
              </Select>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="h-8 text-sm w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Lokasi</SelectItem>
                  <SelectItem value="1">PT Cahaya Sejati Teknologi</SelectItem>
                  <SelectItem value="4">PT Elmira Ratu Abadi</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Invoice</TableHead>
                    <TableHead>Penyewa</TableHead>
                    <TableHead>Tgl Invoice</TableHead>
                    <TableHead>Jatuh Tempo</TableHead>
                    <TableHead className="text-right">Tagihan</TableHead>
                    <TableHead className="text-right">Terbayar</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const st = STATUS_BADGE[r.status] ?? STATUS_BADGE["draft"];
                    const isOverdue = r.due_date && new Date(r.due_date) < new Date() && !["paid","cancelled"].includes(r.status);
                    return (
                      <TableRow key={r.id} className={isOverdue ? "bg-red-50/50" : ""}>
                        <TableCell className="font-mono text-sm">{r.invoice_number}</TableCell>
                        <TableCell className="text-sm">{r.business_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString("id-ID") : "—"}</TableCell>
                        <TableCell className={`text-sm ${isOverdue ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
                          {r.due_date ? new Date(r.due_date).toLocaleDateString("id-ID") : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(r.total_amount)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-green-700">{fmt(r.paid_amount)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.outstanding_amount > 0 ? <span className="text-amber-700">{fmt(r.outstanding_amount)}</span> : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={`text-xs flex items-center gap-0.5 w-fit mx-auto ${st.cls}`}>
                            {st.icon}{st.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">Tidak ada invoice.</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
