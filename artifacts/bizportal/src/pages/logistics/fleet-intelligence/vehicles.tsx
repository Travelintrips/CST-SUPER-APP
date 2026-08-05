import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Car, Plus, ArrowLeft, FileText } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

function fmtDate(s: unknown) {
  if (!s) return "—";
  return new Date(String(s)).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

type Vehicle = Record<string, unknown>;

export default function FleetVehiclesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ plate: "", vehicleType: "motor", brand: "", model: "", year: "", color: "", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["fleet-vehicles"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/vehicles", { credentials: "include" });
      return res.json() as Promise<{ vehicles: Vehicle[] }>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/vehicles", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Gagal menambah kendaraan");
    },
    onSuccess: () => {
      toast.success("Kendaraan berhasil ditambahkan");
      setOpen(false);
      setForm({ plate: "", vehicleType: "motor", brand: "", model: "", year: "", color: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["fleet-vehicles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const vehicles = data?.vehicles ?? [];
  const total    = vehicles.length;
  const aktif    = vehicles.filter((v) => v.status === "active").length;
  const motor    = vehicles.filter((v) => String(v.vehicle_type ?? "motor") === "motor").length;
  const mobil    = vehicles.filter((v) => String(v.vehicle_type ?? "") === "car").length;

  return (
    <AppShell>
      <div className="space-y-6">

        {/* Back link */}
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Kendaraan Fleet</h1>
            <p className="text-slate-400 text-sm mt-1">Data kendaraan dari armada &amp; CSV laporan Gojek</p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700 gap-2" onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4" /> Tambah Kendaraan
          </Button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Kendaraan", value: total },
            { label: "Aktif", value: aktif },
            { label: "Motor", value: motor },
            { label: "Mobil", value: mobil },
          ].map((s) => (
            <Card key={s.label} className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4 flex items-center gap-3">
                <Car className="w-6 h-6 text-blue-400 flex-shrink-0" />
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
                    {["Plat", "Tipe", "Merk/Model", "Driver Terakhir", "Terakhir Aktif", "Transaksi", "Sumber", "Status"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="h-4 bg-slate-700 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    : vehicles.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-16 text-center text-slate-500">
                            <Car className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p>Belum ada data kendaraan</p>
                            <p className="text-xs mt-1">Upload laporan CSV Gojek untuk mengisi data otomatis</p>
                          </td>
                        </tr>
                      )
                    : vehicles.map((v, idx) => {
                        const isManual = v.is_manual === true;
                        const vehicleType = String(v.vehicle_type ?? "motor");
                        const brand = String(v.brand ?? "");
                        const model = String(v.model ?? "");
                        const brandModel = [brand, model].filter(Boolean).join(" / ") || "—";
                        return (
                          <tr key={String(v.plate ?? idx)} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                            <td className="px-4 py-3 font-mono font-bold text-white whitespace-nowrap">
                              {String(v.plate ?? "—")}
                            </td>
                            <td className="px-4 py-3 text-slate-300 capitalize whitespace-nowrap">
                              {vehicleType === "car" ? "Mobil" : vehicleType === "van" ? "Van" : "Motor"}
                            </td>
                            <td className="px-4 py-3 text-slate-300">{brandModel}</td>
                            <td className="px-4 py-3 text-slate-400 whitespace-nowrap max-w-[140px] truncate">
                              {String(v.driver_name ?? "—")}
                            </td>
                            <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                              {fmtDate(v.last_seen_date)}
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
                              {v.tx_count != null ? Number(v.tx_count).toLocaleString("id-ID") : "—"}
                            </td>
                            <td className="px-4 py-3">
                              {isManual ? (
                                <Badge className="bg-blue-500/15 text-blue-300 border border-blue-700/50 text-xs">
                                  <Plus className="w-3 h-3 mr-1" /> Manual
                                </Badge>
                              ) : (
                                <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-700/50 text-xs">
                                  <FileText className="w-3 h-3 mr-1" /> CSV
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={
                                v.status === "active"
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600 text-xs"
                                  : "bg-slate-500/20 text-slate-400 border border-slate-600 text-xs"
                              }>
                                {v.status === "active" ? "Aktif" : String(v.status ?? "aktif")}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Dialog Tambah */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Kendaraan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {([
              { label: "Nomor Plat *", key: "plate" as const },
              { label: "Merk", key: "brand" as const },
              { label: "Model", key: "model" as const },
              { label: "Tahun", key: "year" as const },
              { label: "Warna", key: "color" as const },
              { label: "Catatan", key: "notes" as const },
            ] as const).map(({ label, key }) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-slate-300 text-sm">{label}</Label>
                <Input
                  value={form[key]}
                  onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Tipe Kendaraan</Label>
              <Select value={form.vehicleType} onValueChange={(v) => setForm((p) => ({ ...p, vehicleType: v }))}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="motor">Motor</SelectItem>
                  <SelectItem value="car">Mobil</SelectItem>
                  <SelectItem value="van">Van</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={!form.plate || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Menyimpan..." : "Simpan Kendaraan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
