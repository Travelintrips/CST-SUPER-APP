import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Settings, Building2, ExternalLink, MapPin, ChevronLeft } from "lucide-react";
import { Link } from "wouter";

interface MallSite {
  id: number;
  code: string;
  name: string;
  type: string;
  address: string | null;
  status: string;
  unit_count: number;
  available_count: number;
  occupied_count: number;
}

const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  inactive: "bg-slate-100 text-slate-600",
};

export default function TenantPengaturanPage() {
  const { data, isLoading } = useQuery<{ data: MallSite[] }>({
    queryKey: ["mall-sites-settings"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/mall-sites", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
  });

  const sites = data?.data ?? [];

  return (
    <AppShell>
      <div className="space-y-5 p-6 max-w-3xl">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Settings className="h-6 w-6 text-slate-600" />Pengaturan Tenant</h1>
          <p className="text-sm text-muted-foreground mt-1">Konfigurasi lokasi, unit, dan tautan cepat ke pengaturan terkait</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" />Lokasi (Mall Sites)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <p className="text-muted-foreground text-sm">Memuat...</p> : (
              <div className="space-y-3">
                {sites.map((s) => (
                  <div key={s.id} className="border rounded-lg p-4 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-sm">{s.name} <span className="text-muted-foreground font-mono text-xs">({s.code})</span></p>
                        {s.address && <p className="text-xs text-muted-foreground mt-0.5">{s.address}</p>}
                        <div className="flex gap-2 mt-1.5 text-xs text-muted-foreground">
                          <span>Total unit: <strong>{s.unit_count}</strong></span>
                          <span>·</span>
                          <span className="text-green-700">Tersedia: <strong>{s.available_count}</strong></span>
                          <span>·</span>
                          <span className="text-amber-700">Terisi: <strong>{s.occupied_count}</strong></span>
                        </div>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLS[s.status] ?? STATUS_CLS.inactive}`}>
                      {s.status === "active" ? "Aktif" : "Tidak Aktif"}
                    </span>
                  </div>
                ))}
                {sites.length === 0 && <p className="text-muted-foreground text-sm">Belum ada lokasi terdaftar.</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Tautan Cepat</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: "Template WhatsApp", href: "/settings/wa-templates", desc: "Kelola template pesan WA" },
              { label: "Rekonsiliasi Bank", href: "/accounting/bank-reconciliation", desc: "Cocokkan mutasi bank vs pembayaran" },
              { label: "Manajemen User", href: "/users", desc: "Kelola akses pengguna" },
              { label: "Mall Units", href: "/tenant/mall-units", desc: "Kelola unit per lokasi" },
            ].map((l) => (
              <Link key={l.href} href={l.href}>
                <Button variant="outline" className="w-full justify-start gap-2 h-auto py-3 px-4 text-left">
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{l.label}</p>
                    <p className="text-xs text-muted-foreground font-normal">{l.desc}</p>
                  </div>
                </Button>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
