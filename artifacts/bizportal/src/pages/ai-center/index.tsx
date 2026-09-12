import { AppShell } from "@/components/layout/AppShell";
import { ModuleHub } from "@/components/layout/ModuleHub";
import {
  Bot, ShieldAlert, ShieldCheck, Brain, Layers, BookOpen, ScanLine,
  ImageIcon, FileText, Truck, FileSearch,
} from "lucide-react";

export default function AiCenterHubPage() {
  return (
    <AppShell>
      <ModuleHub
        breadcrumb
        moduleIcon={Bot}
        moduleName="AI Center"
        moduleDesc="Kecerdasan buatan, otomatisasi, dan pengambilan keputusan berbasis data"
        sections={[
          {
            label: "AI Insights",
            cards: [
              {
                href: "/intelligence-alerts",
                icon: ShieldAlert,
                title: "Intelligence Alerts",
                desc: "Peringatan otomatis dari AI untuk anomali dan risiko",
                accent: "bg-red-500/10 text-red-600 group-hover:bg-red-500/20",
              },
              {
                href: "/ai-approvals",
                icon: ShieldCheck,
                title: "AI Approval Queue",
                desc: "Antrean persetujuan yang direkomendasikan AI",
                accent: "bg-amber-500/10 text-amber-600 group-hover:bg-amber-500/20",
              },
              {
                href: "/ai/decision-memory",
                icon: Brain,
                title: "Decision Memory",
                desc: "Riwayat keputusan yang dipelajari oleh AI",
                accent: "bg-purple-500/10 text-purple-600 group-hover:bg-purple-500/20",
              },
              {
                href: "/operational-context",
                icon: Layers,
                title: "Operational Context",
                desc: "Konteks operasional yang digunakan AI dalam analisis",
                accent: "bg-blue-500/10 text-blue-600 group-hover:bg-blue-500/20",
              },
            ],
          },
          {
            label: "AI Transaction Intelligence",
            cards: [
              {
                href: "/ai/review",
                icon: FileSearch,
                title: "AI Transaction Review",
                desc: "Review dan validasi rekomendasi AI untuk transaksi keuangan",
                accent: "bg-indigo-500/10 text-indigo-600 group-hover:bg-indigo-500/20",
              },
            ],
          },
          {
            label: "AI Governance",
            cards: [
              {
                href: "/settings/ai-chatbot/knowledge",
                icon: BookOpen,
                title: "Knowledge Base",
                desc: "Basis pengetahuan yang digunakan AI chatbot",
                accent: "bg-green-500/10 text-green-600 group-hover:bg-green-500/20",
              },
              {
                href: "/settings/ai-chatbot",
                icon: Bot,
                title: "Konfigurasi AI Chatbot",
                desc: "Pengaturan chatbot AI untuk respon otomatis",
              },
            ],
          },
          {
            label: "AI Assistant",
            cards: [
              {
                href: "/sales/ai-drafts",
                icon: FileText,
                title: "AI Draft Quotation",
                desc: "Buat draft penawaran otomatis dengan AI",
              },
              {
                href: "/settings/ai-scan",
                icon: ScanLine,
                title: "Scan Dokumen",
                desc: "OCR dan ekstraksi data dari foto/scan dokumen",
              },
              {
                href: "/logistics/import-assistant",
                icon: Truck,
                title: "AI Import Assistant",
                desc: "Asisten AI untuk proses kepabeanan impor",
              },
              {
                href: "/marketplace/ai-images",
                icon: ImageIcon,
                title: "AI Image Generator",
                desc: "Buat gambar produk dan marketing dengan AI",
              },
            ],
          },
        ]}
      />
    </AppShell>
  );
}
