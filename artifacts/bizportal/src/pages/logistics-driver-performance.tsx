import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, BarChart2, Download, Trophy, Clock, CheckCircle2, XCircle, Loader2, Timer } from "lucide-react";
import { exportXlsx } from "@/lib/export";
import { Link } from "wouter";

interface DriverStat {
  driverId: number;
  driverName: string;
  driverEmail: string;
  vehiclePlate: string | null;
  vehicleType: string | null;
  totalJobs: number;
  completed: number;
  delivered: number;
  cancelled: number;
  inProgress: number;
  successRate: number;
  avgDurationHours: number | null;
  onTimeCount: number;
  onTimeEligible: number;
  onTimePct: number | null;
}

interface PerformanceData {
  from: string;
  to: string;
  drivers: DriverStat[];
}

function toLocalDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return toLocalDate(d);
}

function RateBadge({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  const color = value >= 90 ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
    : value >= 70 ? "bg-amber-500/10 text-amber-700 border-amber-500/20"
    : "bg-destructive/10 text-destructive border-destructive/20";
  return <Badge variant="outline" className={`text-xs font-semibold ${color}`}>{value}{suffix}</Badge>;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-base">🥇</span>;
  if (rank === 2) return <span className="text-base">🥈</span>;
  if (rank === 3) return <span className="text-base">🥉</span>;
  return <span className="text-xs text-muted-foreground font-mono">#{rank}</span>;
}

async function apiFetch(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

export default function LogisticsDriverPerformancePage() {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(toLocalDate(new Date()));
  const [applied, setApplied] = useState({ from: defaultFrom(), to: toLocalDate(new Date()) });

  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ["driver-performance", applied.from, applied.to],
    queryFn: () => apiFetch(`/api/drivers/performance?from=${applied.from}&to=${applied.to}`),
    staleTime: 60_000,
  });

  const drivers = data?.drivers ?? [];

  const totalJobs = drivers.reduce((s, d) => s + d.totalJobs, 0);
  const totalCompleted = drivers.reduce((s, d) => s + d.completed, 0);
  const totalCancelled = drivers.reduce((s, d) => s + d.cancelled, 0);
  const avgSuccessRate = drivers.length > 0
    ? Math.round(drivers.reduce((s, d) => s + d.successRate, 0) / drivers.length)
    : 0;

  function handleExport() {
    const headers = [
      "Driver", "Email", "Kendaraan", "Total Job", "Selesai", "Dikirim",
      "Dibatalkan", "Sedang Berjalan", "Tingkat Sukses (%)",
      "Rata-rata Durasi (jam)", "Tepat Waktu", "Eligible Tepat Waktu", "% Tepat Waktu",
    ];
    const rows = drivers.map((d) => [
      d.driverName, d.driverEmail, d.vehiclePlate ?? "—",
      d.totalJobs, d.completed, d.delivered,
      d.cancelled, d.inProgress, d.successRate,
      d.avgDurationHours ?? "—", d.onTimeCount, d.onTimeEligible, d.onTimePct ?? "—",
    ]);
    const dateLabel = `${applied.from}_${applied.to}`;
    exportXlsx(`laporan_performa_driver_${dateLabel}`, headers, rows);
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Link href="/logistics/drivers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="w-6 h-6 text-primary" />
              Laporan Performa Driver
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tingkat pengiriman, durasi rata-rata, dan ketepatan waktu per driver
            </p>
          </div>
          <Button variant="outline" onClick={handleExport} disabled={drivers.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
        </div>

        {/* Date filter */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Dari Tanggal</Label>
                <DatePicker value={from} onChange={(v) => setFrom(v)} className="w-40 h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sampai Tanggal</Label>
                <DatePicker value={to} onChange={(v) => setTo(v)} className="w-40 h-9" />
              </div>
              <Button size="sm" onClick={() => setApplied({ from, to })}>
                Tampilkan
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <BarChart2 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{totalJobs}</p>}
                  <p className="text-xs text-muted-foreground">Total Job</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{totalCompleted}</p>}
                  <p className="text-xs text-muted-foreground">Job Selesai</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                  <XCircle className="w-4 h-4 text-destructive" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{totalCancelled}</p>}
                  <p className="text-xs text-muted-foreground">Dibatalkan</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <Trophy className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  {isLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{avgSuccessRate}%</p>}
                  <p className="text-xs text-muted-foreground">Avg Tingkat Sukses</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Detail Performa per Driver</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Kendaraan</TableHead>
                  <TableHead className="text-center">Total Job</TableHead>
                  <TableHead className="text-center">Selesai</TableHead>
                  <TableHead className="text-center">Batal</TableHead>
                  <TableHead className="text-center">Berjalan</TableHead>
                  <TableHead className="text-center">Tingkat Sukses</TableHead>
                  <TableHead className="text-center">
                    <span className="flex items-center justify-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Avg Durasi
                    </span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span className="flex items-center justify-center gap-1">
                      <Timer className="w-3.5 h-3.5" /> Tepat Waktu
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : drivers.length === 0
                    ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                          Tidak ada data job untuk periode ini.
                        </TableCell>
                      </TableRow>
                    )
                    : drivers.map((d, i) => (
                      <TableRow key={d.driverId} className={i < 3 ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                        <TableCell><RankBadge rank={i + 1} /></TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{d.driverName}</p>
                            <p className="text-xs text-muted-foreground">{d.driverEmail}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <p className="font-medium">{d.vehiclePlate ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{d.vehicleType ?? "—"}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-semibold">{d.totalJobs}</TableCell>
                        <TableCell className="text-center">
                          <span className="text-emerald-700 font-medium">{d.completed}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          {d.cancelled > 0
                            ? <span className="text-destructive font-medium">{d.cancelled}</span>
                            : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {d.inProgress > 0
                            ? <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-700 border-blue-500/20">{d.inProgress}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          <RateBadge value={d.successRate} />
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {d.avgDurationHours !== null
                            ? <span className="font-mono text-sm">{d.avgDurationHours}j</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {d.onTimeEligible > 0
                            ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <RateBadge value={d.onTimePct} />
                                <span className="text-xs text-muted-foreground">{d.onTimeCount}/{d.onTimeEligible}</span>
                              </div>
                            )
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Sukses ≥ 90%</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> Sukses 70–89%</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-400 inline-block" /> Sukses &lt; 70%</span>
          <span className="ml-auto">🥇🥈🥉 = 3 driver terbaik berdasarkan total job</span>
        </div>
      </div>
    </AppShell>
  );
}
