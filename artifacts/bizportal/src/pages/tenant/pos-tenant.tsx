import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, ShoppingBag, Database, Shield, UserCircle, Package, Layers, Settings, ArrowRight, ChevronLeft } from "lucide-react";

async function apiFetch(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

interface Stats { total: number; active: number; }

export default function PosTenant() {
  const { data: kasir } = useQuery<{ companies: Stats; branches: Stats; users: Stats; products: Stats; devices: Stats }>({
    queryKey: ["kasir-stats"],
    queryFn: () => apiFetch("/api/tenant/kasir/stats"),
    refetchInterval: 30_000,
  });

  const { data: pos } = useQuery<{ branches: Stats; cashiers: Stats; products: Stats; roles: { total: number }; inventory: Stats }>({
    queryKey: ["pos-stats"],
    queryFn: () => apiFetch("/api/tenant/pos/stats"),
    refetchInterval: 30_000,
  });

  const kasirLinks = [
    { label: "Perusahaan",  href: "/tenant/kasir/companies", icon: Building2, stat: kasir?.companies },
    { label: "Cabang",      href: "/tenant/kasir/branches",  icon: Layers,    stat: kasir?.branches },
    { label: "Pengguna",    href: "/tenant/kasir/users",     icon: Users,     stat: kasir?.users },
    { label: "Produk",      href: "/tenant/kasir/products",  icon: ShoppingBag, stat: kasir?.products },
    { label: "Perangkat",   href: "/tenant/kasir/devices",   icon: Database,  stat: kasir?.devices },
  ];

  const posLinks = [
    { label: "Cabang POS",  href: "/tenant/pos/branches",  icon: Building2,  stat: pos?.branches },
    { label: "Kasir",       href: "/tenant/pos/cashiers",  icon: UserCircle, stat: pos?.cashiers },
    { label: "Produk POS",  href: "/tenant/pos/products",  icon: Package,    stat: pos?.products },
    { label: "Role & Akses",href: "/tenant/pos/roles",     icon: Shield,     stat: pos?.roles ? { total: pos.roles.total, active: pos.roles.total } : undefined },
    { label: "Pengaturan",  href: "/tenant/pos/settings",  icon: Settings,   stat: undefined },
  ];

  return (
    <div className="p-6 space-y-6">
      <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
        <span>/</span>
        <Link href="/tenant" className="hover:text-foreground transition-colors">Tenant & Property</Link>
        <span>/</span>
        <span className="text-foreground font-medium">POS Tenant</span>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold">POS Tenant</h1>
        <p className="text-muted-foreground text-sm mt-1">Manajemen sistem kasir dan point-of-sale terintegrasi</p>
      </div>

      {/* Kasir System */}
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          Sistem Kasir
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {kasirLinks.map(item => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Card className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all group">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <CardTitle className="text-sm">{item.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {item.stat ? (
                      <div className="space-y-1">
                        <div className="text-2xl font-bold">{item.stat.total}</div>
                        <Badge variant="secondary" className="text-xs">{item.stat.active} aktif</Badge>
                      </div>
                    ) : (
                      <div className="text-2xl font-bold text-muted-foreground">—</div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* POS System */}
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          Sistem POS
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {posLinks.map(item => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Card className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all group">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <CardTitle className="text-sm">{item.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {item.stat ? (
                      <div className="space-y-1">
                        <div className="text-2xl font-bold">{item.stat.total}</div>
                        <Badge variant="secondary" className="text-xs">{item.stat.active} aktif</Badge>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm pt-1">Buka →</div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
