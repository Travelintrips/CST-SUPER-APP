import { DatePicker } from "@/components/ui/date-picker";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { AlertTriangle, BookOpen, BarChart3, Scale, CreditCard, TrendingUp, TrendingDown, Map, RefreshCw, ArrowLeft } from "lucide-react";

interface Overview {
  totals: {
    total_entries: number;
    total_companies: number;
    total_debit: string;
    total_credit: string;
    posted_count: number;
    voided_count: number;
  };
  moduleBreakdown: { module: string; entry_count: number; total_debit: string }[];
  companyBreakdown: { company_id: number; company_name: string; entry_count: number; total_debit: string }[];
  pendingErrors: number;
}

const fmt = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(v));

export default function AccountingHubIndexPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo)   params.set("date_to", dateTo);
      const res = await fetch(`/api/accounting/hub/overview?${params}`, { credentials: "include" });
      if (!res.ok) { setData(null); setError(`Gagal memuat data (${res.status})`); return; }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setData(null);
      setError("Tidak dapat terhubung ke server. Coba refresh halaman.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const t = data?.totals;

  const hubLinks = [
    { href: "/accounting/hub/general-ledger",  label: "Buku Besar",       icon: BookOpen,    desc: "Semua jurnal multi-perusahaan" },
    { href: "/accounting/hub/trial-balance",   label: "Neraca Saldo",     icon: Scale,       desc: "Saldo akun per periode" },
    { href: "/accounting/hub/profit-loss",     label: "Laba Rugi",        icon: BarChart3,   desc: "Pendapatan & beban per modul" },
    { href: "/accounting/hub/balance-sheet",   label: "Neraca",           icon: TrendingUp,  desc: "Aset, liabilitas & ekuitas" },
    { href: "/accounting/hub/payments",        label: "Jurnal Pembayaran", icon: CreditCard,  desc: "Semua pembayaran tercatat" },
    { href: "/accounting/hub/posting-errors",  label: "Error Posting",    icon: AlertTriangle, desc: "Transaksi gagal diposting" },
    { href: "/accounting/hub/coa-mapping",     label: "Mapping COA",      icon: Map,         desc: "Pemetaan akun per modul" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/accounting/dashboard">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Accounting Hub</h1>
            <p className="text-muted-foreground text-sm">Pusat akuntansi multi-perusahaan, multi-modul</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">Dari:</label>
              <DatePicker value={dateFrom} onChange={v => setDateFrom(v)} className="w-40" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">Sampai:</label>
              <DatePicker value={dateTo} onChange={v => setDateTo(v)} className="w-40" />
            </div>
            <Button size="sm" onClick={load}>Terapkan</Button>
          </div>
        </CardContent>
      </Card>

      {/* Error / empty state */}
      {!loading && error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <span className="text-sm text-red-700">{error}</span>
          </CardContent>
        </Card>
      )}

      {!loading && !error && !data && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground">
            <p className="text-sm">Belum ada data akuntansi untuk periode ini.</p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Total Jurnal",    value: t?.total_entries?.toLocaleString("id-ID") ?? "—" },
          { label: "Perusahaan",      value: t?.total_companies?.toLocaleString("id-ID") ?? "—" },
          { label: "Total Debit",     value: t ? fmt(t.total_debit) : "—" },
          { label: "Total Kredit",    value: t ? fmt(t.total_credit) : "—" },
          { label: "Sudah Diposting", value: t?.posted_count?.toLocaleString("id-ID") ?? "—" },
          { label: "Dibatalkan",      value: t?.voided_count?.toLocaleString("id-ID") ?? "—" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold truncate">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data?.pendingErrors ? (
        <Card className="border-yellow-400 bg-yellow-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">
              Ada <strong>{data.pendingErrors}</strong> transaksi gagal diposting.{" "}
              <Link href="/accounting/hub/posting-errors" className="underline">Lihat &amp; selesaikan</Link>
            </span>
          </CardContent>
        </Card>
      ) : null}

      {/* Nav cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {hubLinks.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="pt-5 pb-4 flex flex-col gap-2">
                <l.icon className="h-7 w-7 text-primary" />
                <p className="font-semibold text-sm">{l.label}</p>
                <p className="text-xs text-muted-foreground">{l.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Module breakdown */}
      {data?.moduleBreakdown?.length ? (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Jurnal per Modul</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="text-left pb-1">Modul</th>
                    <th className="text-right pb-1">Jurnal</th>
                    <th className="text-right pb-1">Total Debit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.moduleBreakdown.map((m) => (
                    <tr key={m.module} className="border-t">
                      <td className="py-1.5">
                        <Badge variant="outline" className="font-mono text-xs">{m.module}</Badge>
                      </td>
                      <td className="text-right">{m.entry_count.toLocaleString("id-ID")}</td>
                      <td className="text-right">{fmt(m.total_debit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Jurnal per Perusahaan</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="text-left pb-1">Perusahaan</th>
                    <th className="text-right pb-1">Jurnal</th>
                    <th className="text-right pb-1">Total Debit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companyBreakdown.map((c) => {
                    const noEntry = c.entry_count === 0;
                    return (
                      <tr key={c.company_id} className={`border-t ${noEntry ? "opacity-50" : ""}`}>
                        <td className="py-1.5 flex items-center gap-2">
                          <span>{c.company_name ?? `ID-${c.company_id}`}</span>
                          {noEntry && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground border-dashed">
                              Belum Ada Jurnal
                            </Badge>
                          )}
                        </td>
                        <td className="text-right text-muted-foreground">
                          {noEntry ? "—" : c.entry_count.toLocaleString("id-ID")}
                        </td>
                        <td className="text-right text-muted-foreground">
                          {noEntry ? "—" : fmt(c.total_debit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
