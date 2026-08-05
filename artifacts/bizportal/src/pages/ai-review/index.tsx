import { AppShell } from "@/components/layout/AppShell";
import { ModuleHub } from "@/components/layout/ModuleHub";
import {
  FileSearch,
  UserCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  BarChart3,
  Brain,
  Lightbulb,
  TrendingUp,
} from "lucide-react";

export default function AiReviewIndexPage() {
  return (
    <AppShell>
      <ModuleHub
        breadcrumb
        moduleIcon={FileSearch}
        moduleName="AI Transaction Review"
        moduleDesc="Review dan validasi rekomendasi AI untuk transaksi keuangan"
        sections={[
          {
            label: "Antrian Review",
            cards: [
              {
                href: "/ai/review/queue",
                icon: FileSearch,
                title: "Review Queue",
                desc: "Semua kasus review transaksi yang menunggu tindakan",
                accent: "bg-indigo-500/10 text-indigo-600 group-hover:bg-indigo-500/20",
              },
              {
                href: "/ai/review/queue?assignedToMe=true",
                icon: UserCheck,
                title: "Tugas Saya",
                desc: "Kasus yang ditugaskan kepada saya",
                accent: "bg-blue-500/10 text-blue-600 group-hover:bg-blue-500/20",
              },
              {
                href: "/ai/review/queue?riskLevel=HIGH",
                icon: ShieldAlert,
                title: "Risiko Tinggi",
                desc: "Kasus dengan anomali skor tinggi yang perlu perhatian segera",
                accent: "bg-red-500/10 text-red-600 group-hover:bg-red-500/20",
              },
              {
                href: "/ai/review/queue?overdue=true",
                icon: Clock,
                title: "Terlambat (Overdue)",
                desc: "Kasus yang melewati batas waktu SLA",
                accent: "bg-orange-500/10 text-orange-600 group-hover:bg-orange-500/20",
              },
              {
                href: "/ai/review/queue?status=CLOSED",
                icon: CheckCircle2,
                title: "Selesai",
                desc: "Kasus yang telah diselesaikan",
                accent: "bg-green-500/10 text-green-600 group-hover:bg-green-500/20",
              },
            ],
          },
          {
            label: "AI Learning Center",
            cards: [
              {
                href: "/ai/review/learning",
                icon: Brain,
                title: "Learning",
                desc: "Pola yang ditemukan AI dari histori keputusan reviewer",
                accent: "bg-violet-500/10 text-violet-600 group-hover:bg-violet-500/20",
              },
              {
                href: "/ai/review/recommendations",
                icon: Lightbulb,
                title: "Recommendations",
                desc: "Rekomendasi rule yang diusulkan AI dan menunggu persetujuan",
                accent: "bg-amber-500/10 text-amber-600 group-hover:bg-amber-500/20",
              },
              {
                href: "/ai/review/statistics",
                icon: TrendingUp,
                title: "Statistics",
                desc: "Metrik akurasi AI, learning patterns, dan statistik rule",
                accent: "bg-teal-500/10 text-teal-600 group-hover:bg-teal-500/20",
              },
            ],
          },
          {
            label: "Monitoring",
            cards: [
              {
                href: "/ai/review/observability",
                icon: BarChart3,
                title: "Observabilitas",
                desc: "Metrik dan grafik performa sistem review transaksi AI",
                accent: "bg-purple-500/10 text-purple-600 group-hover:bg-purple-500/20",
              },
            ],
          },
        ]}
      />
    </AppShell>
  );
}
