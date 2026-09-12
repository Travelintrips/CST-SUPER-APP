import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Users, UserCheck, UserX, Edit2, Eye, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(parseFloat(String(v ?? 0)) || 0);
}

function tierBadge(tier: string) {
  if (tier === "top") return "bg-yellow-500/20 text-yellow-300 border-yellow-600";
  if (tier === "good") return "bg-emerald-500/20 text-emerald-300 border-emerald-600";
  return "bg-slate-500/20 text-slate-300 border-slate-600";
}

export default function FleetDriversPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["fleet-drivers", search, status, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/logistics/fleet/drivers?${params}`, { credentials: "include" });
      return res.json() as Promise<{ drivers: Array<Record<string, unknown>>; total: number }>;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/logistics/fleet/drivers/${editing?.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Gagal update driver");
    },
    onSuccess: () => {
      toast.success("Driver berhasil diupdate");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["fleet-drivers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const drivers = data?.drivers ?? [];
  const total = data?.total ?? 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Driver Fleet</h1>
            <p className="text-slate-400 text-sm mt-1">Manajemen data driver Gojek</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Cari nama, plat, ID..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9 bg-slate-700 border-slate-600 text-white w-60"
              />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-36 bg-slate-700 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Tidak Aktif</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Driver", value: total, icon: Users, color: "text-blue-400" },
            { label: "Aktif", value: drivers.filter((d) => d.status === "active").length, icon: UserCheck, color: "text-emerald-400" },
            { label: "Tidak Aktif", value: drivers.filter((d) => d.status !== "active").length, icon: UserX, color: "text-red-400" },
            { label: "Top Performer", value: drivers.filter((d) => d.performance_tier === "top").length, icon: Users, color: "text-yellow-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4 flex items-center gap-3">
                <s.icon className={`w-6 h-6 ${s.color}`} />
                <div>
                  <div className="text-xl font-bold text-white">{s.value}</div>
                  <div className="text-xs text-slate-400">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    {["ID External", "Nama Driver", "Plat", "Status", "Terakhir Aktif", "Transaksi", "Total Rental", "Outstanding", "Tier", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td colSpan={10} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                        </tr>
                      ))
                    : drivers.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                            <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <p>Belum ada data driver</p>
                          </td>
                        </tr>
                      )
                    : drivers.map((d) => {
                        const extId = String(d.driver_external_id ?? "");
                        const hasId = d.id != null;
                        const outstanding = parseFloat(String(d.outstanding ?? 0));
                        return (
                          <tr key={extId || String(d.id)} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                            <td className="px-4 py-3 text-slate-400 font-mono text-xs whitespace-nowrap">{extId || "—"}</td>
                            <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{String(d.name ?? "—")}</td>
                            <td className="px-4 py-3 text-slate-300 font-mono text-xs whitespace-nowrap">{String(d.vehicle_plate ?? "—")}</td>
                            <td className="px-4 py-3">
                              <Badge className={d.status === "active" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600 text-xs" : "bg-slate-500/20 text-slate-400 border border-slate-600 text-xs"}>
                                {d.status === "active" ? "Aktif" : "Tidak Aktif"}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                              {d.last_active_date ? new Date(String(d.last_active_date)).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{Number(d.total_trips ?? 0).toLocaleString("id-ID")}</td>
                            <td className="px-4 py-3 text-right font-medium text-emerald-400 tabular-nums whitespace-nowrap">{fmtIdr(d.total_revenue)}</td>
                            <td className={`px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ${outstanding > 0 ? "text-amber-400" : "text-slate-400"}`}>
                              {fmtIdr(outstanding)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={`text-xs border ${tierBadge(String(d.performance_tier ?? "standard"))}`}>
                                {String(d.performance_tier ?? "standard")}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <Link href={`/logistics/fleet-intelligence/drivers/${encodeURIComponent(extId)}/detail`}>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-400 hover:text-blue-300" title="Lihat Detail">
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                </Link>
                                {hasId && (
                                  <Button variant="ghost" size="sm" onClick={() => setEditing(d)} className="h-7 w-7 p-0 text-slate-400 hover:text-white" title="Edit">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
              <span className="text-slate-400 text-sm">{total} total driver</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={drivers.length < 50} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Driver: {String(editing.name)}</DialogTitle>
            </DialogHeader>
            <DriverEditForm
              driver={editing}
              onSave={(body) => updateMutation.mutate(body)}
              loading={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}

function DriverEditForm({ driver, onSave, loading }: {
  driver: Record<string, unknown>;
  onSave: (body: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    name: String(driver.name ?? ""),
    phone: String(driver.phone ?? ""),
    vehiclePlate: String(driver.vehicle_plate ?? ""),
    vehicleType: String(driver.vehicle_type ?? ""),
    status: String(driver.status ?? "active"),
    notes: String(driver.notes ?? ""),
  });
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      {[
        { label: "Nama", key: "name" as const },
        { label: "Phone", key: "phone" as const },
        { label: "Plat Kendaraan", key: "vehiclePlate" as const },
        { label: "Tipe Kendaraan", key: "vehicleType" as const },
        { label: "Catatan", key: "notes" as const },
      ].map(({ label, key }) => (
        <div key={key} className="space-y-1.5">
          <Label className="text-slate-300 text-sm">{label}</Label>
          <Input value={form[key]} onChange={f(key)} className="bg-slate-700 border-slate-600 text-white" />
        </div>
      ))}
      <div className="space-y-1.5">
        <Label className="text-slate-300 text-sm">Status</Label>
        <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="inactive">Tidak Aktif</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading} onClick={() => onSave(form)}>
        {loading ? "Menyimpan..." : "Simpan"}
      </Button>
    </div>
  );
}
