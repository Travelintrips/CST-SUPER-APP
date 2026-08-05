import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { MapPin, TrendingUp, Users, Building2, AlertTriangle, ChevronLeft } from "lucide-react";
import { Link } from "wouter";

interface LokData {
  lokasi: string;
  company_id: number;
  total_tenant: number;
  tenant_aktif: number;
  total_unit: number;
  unit_tersedia: number;
  unit_terisi: number;
  total_pendapatan: number;
  total_piutang: number;
  invoice_overdue: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n ?? 0);
}

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

function StatRow({ label, a, b, fmtFn = String }: { label: string; a: any; b: any; fmtFn?: (v: any) => string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex gap-8">
        <span className="text-sm font-semibold text-indigo-700 w-32 text-right">{fmtFn(a)}</span>
        <span className="text-sm font-semibold text-violet-700 w-32 text-right">{fmtFn(b)}</span>
      </div>
    </div>
  );
}

export default function TenantPerbandinganLokasiPage() {
  const { data, isLoading } = useQuery<{ data: LokData[] }>({
    queryKey: ["tenant-perbandingan-lokasi"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/perbandingan-lokasi", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    staleTime: 60_000,
  });

  const locs = data?.data ?? [];
  // Use first two locations returned by the API — no hardcoded company IDs
  const cst = locs[0];
  const era = locs[1];

  const cstName = cst?.lokasi ?? "Lokasi 1";
  const eraName = era?.lokasi ?? "Lokasi 2";

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="h-6 w-6 text-rose-600" />Perbandingan Lokasi</h1>
          <p className="text-sm text-muted-foreground mt-1">{cstName} vs {eraName} — statistik side by side</p>
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-12">Memuat...</p>
        ) : (
          <>
            {/* Header cards */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="border-indigo-200 bg-indigo-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-indigo-700">
                    <Building2 className="h-5 w-5" />{cstName}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card className="border-violet-200 bg-violet-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-violet-700">
                    <Building2 className="h-5 w-5" />{eraName}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Summary metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Tenant Aktif", valA: cst?.tenant_aktif ?? 0, valB: era?.tenant_aktif ?? 0, icon: <Users className="h-4 w-4" /> },
                { label: "Unit Terisi", valA: cst?.unit_terisi ?? 0, valB: era?.unit_terisi ?? 0, icon: <Building2 className="h-4 w-4" /> },
                { label: "Pendapatan", valA: cst?.total_pendapatan ?? 0, valB: era?.total_pendapatan ?? 0, icon: <TrendingUp className="h-4 w-4" />, money: true },
                { label: "Invoice Overdue", valA: cst?.invoice_overdue ?? 0, valB: era?.invoice_overdue ?? 0, icon: <AlertTriangle className="h-4 w-4" />, warn: true },
              ].map((m) => (
                <Card key={m.label}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">{m.icon}{m.label}</p>
                    <div className="flex gap-3 mt-1 items-end">
                      <div>
                        <p className="text-[10px] text-indigo-600">CST</p>
                        <p className={`text-lg font-bold ${m.warn && m.valA > 0 ? "text-red-700" : "text-indigo-700"}`}>
                          {m.money ? fmt(m.valA) : m.valA}
                        </p>
                      </div>
                      <div className="text-muted-foreground/30 text-lg pb-0.5">|</div>
                      <div>
                        <p className="text-[10px] text-violet-600">ERA</p>
                        <p className={`text-lg font-bold ${m.warn && m.valB > 0 ? "text-red-700" : "text-violet-700"}`}>
                          {m.money ? fmt(m.valB) : m.valB}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Detailed comparison table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Detail Perbandingan</CardTitle>
                  <div className="flex gap-6 text-sm">
                    <span className="text-indigo-700 font-semibold">{cstName}</span>
                    <span className="text-violet-700 font-semibold">{eraName}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <StatRow label="Total Penyewa"     a={cst?.total_tenant ?? 0}    b={era?.total_tenant ?? 0} />
                <StatRow label="Penyewa Aktif"     a={cst?.tenant_aktif ?? 0}    b={era?.tenant_aktif ?? 0} />
                <StatRow label="Total Unit"        a={cst?.total_unit ?? 0}      b={era?.total_unit ?? 0} />
                <StatRow label="Unit Tersedia"     a={cst?.unit_tersedia ?? 0}   b={era?.unit_tersedia ?? 0} />
                <StatRow label="Unit Terisi"       a={cst?.unit_terisi ?? 0}     b={era?.unit_terisi ?? 0} />
                <StatRow label="Tingkat Hunian"
                  a={pct(cst?.unit_terisi ?? 0, cst?.total_unit ?? 0) + "%"}
                  b={pct(era?.unit_terisi ?? 0, era?.total_unit ?? 0) + "%"} />
                <StatRow label="Total Pendapatan"  a={cst?.total_pendapatan ?? 0} b={era?.total_pendapatan ?? 0} fmtFn={fmt} />
                <StatRow label="Total Piutang"     a={cst?.total_piutang ?? 0}   b={era?.total_piutang ?? 0} fmtFn={fmt} />
                <StatRow label="Invoice Overdue"   a={cst?.invoice_overdue ?? 0} b={era?.invoice_overdue ?? 0} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
