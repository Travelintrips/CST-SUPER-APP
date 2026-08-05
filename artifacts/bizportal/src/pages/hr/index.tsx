import { AppShell } from "@/components/layout/AppShell";
import { Users, Clock, DollarSign, FileText, CalendarDays, BarChart2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const COMING_SOON = [
  { icon: Users, title: "Data Karyawan", desc: "Profil, jabatan, dan kontrak karyawan" },
  { icon: Clock, title: "Absensi & Waktu Kerja", desc: "Rekap kehadiran dan lembur" },
  { icon: DollarSign, title: "Penggajian (Payroll)", desc: "Hitung dan proses gaji karyawan" },
  { icon: FileText, title: "Slip Gaji", desc: "Cetak dan kirim slip gaji" },
  { icon: CalendarDays, title: "Cuti & Izin", desc: "Pengajuan dan persetujuan cuti" },
  { icon: BarChart2, title: "Laporan HR", desc: "Analisis biaya SDM dan produktivitas" },
];

export default function HrHubPage() {
  return (
    <AppShell>
      <div className="space-y-8 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <Users className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">HR & Payroll</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manajemen sumber daya manusia dan penggajian
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              Segera Hadir
            </Badge>
          </div>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Modul HR & Payroll sedang dalam pengembangan. Fitur-fitur di bawah ini akan segera tersedia.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMING_SOON.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="border-dashed opacity-60 cursor-not-allowed">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="shrink-0 rounded-lg bg-muted p-2.5 text-muted-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold leading-tight">{item.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
