import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Truck, Info } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { BackButton } from "@/components/ui/back-button";

interface VehicleRate {
  id: number;
  type: string;
  label: string;
  description: string;
  max_kg: string | null;
  rate_per_kg: string;
  min_price: string;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

const apiFetch = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { credentials: "include", ...init });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { message?: string }).message ?? `HTTP ${r.status}`);
  }
  return r.json();
};

const formatRp = (v: string | number) =>
  `Rp ${Number(v).toLocaleString("id-ID")}`;

function EditDialog({
  rate,
  open,
  onClose,
}: {
  rate: VehicleRate;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    label:       rate.label,
    description: rate.description,
    max_kg:      rate.max_kg ?? "",
    rate_per_kg: String(rate.rate_per_kg),
    min_price:   String(rate.min_price),
    sort_order:  String(rate.sort_order),
    is_active:   rate.is_active,
  });

  const mut = useMutation({
    mutationFn: (body: typeof form) =>
      apiFetch(`/api/trucking-rates/${rate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          max_kg:      body.max_kg !== "" ? Number(body.max_kg) : null,
          rate_per_kg: Number(body.rate_per_kg),
          min_price:   Number(body.min_price),
          sort_order:  Number(body.sort_order),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/trucking-rates/all"] });
      toast({ title: `Tarif ${rate.type} berhasil disimpan` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }),
  });

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-orange-500" /> Edit Tarif — {rate.type}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={form.label} onChange={sf("label")} />
          </div>
          <div className="space-y-1.5">
            <Label>Deskripsi Kapasitas</Label>
            <Input value={form.description} onChange={sf("description")} placeholder="s/d 3.000 kg" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Maks Berat (kg)</Label>
              <Input
                type="number" min={0} value={form.max_kg}
                onChange={sf("max_kg")}
                placeholder="Kosong = tak terbatas"
              />
              <p className="text-[10px] text-muted-foreground">Kosongkan untuk Trailer (unlimited)</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Urutan Tampil</Label>
              <Input type="number" min={0} value={form.sort_order} onChange={sf("sort_order")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tarif per Kg (Rp)</Label>
              <Input type="number" min={0} value={form.rate_per_kg} onChange={sf("rate_per_kg")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Harga Minimum (Rp)</Label>
              <Input type="number" min={0} value={form.min_price} onChange={sf("min_price")} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.is_active}
              onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
            />
            <Label>{form.is_active ? "Aktif" : "Nonaktif"}</Label>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex gap-2 text-xs text-amber-700">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Estimasi offline = max(<em>harga_minimum</em>, berat_tertagih × <em>tarif_per_kg</em>).
              Jika API estimate-price mengembalikan harga nyata, nilai itu yang dipakai.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            className="bg-orange-600 hover:bg-orange-700"
            disabled={mut.isPending}
            onClick={() => mut.mutate(form)}
          >
            {mut.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TruckingRatesPage() {
  const { data: rates = [], isLoading } = useQuery<VehicleRate[]>({
    queryKey: ["/api/trucking-rates/all"],
    queryFn: () => apiFetch("/api/trucking-rates/all"),
  });

  const [editing, setEditing] = useState<VehicleRate | null>(null);

  return (
    <AppShell>
      <BackButton href="/settings" />
      <div className="max-w-3xl mx-auto space-y-6">
        <PageHeader
          onBack={() => window.history.back()}
          title="Tarif Kendaraan Trucking"
          description="Tarif offline fallback yang dipakai Customer Portal saat API estimate tidak tersedia."
          breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Tarif Trucking" }]}
          favoriteEnabled
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daftar Kendaraan & Tarif</CardTitle>
            <CardDescription>
              Klik Edit untuk mengubah tarif per kg, harga minimum, dan kapasitas. Perubahan langsung berlaku di portal customer.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Memuat...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Kapasitas</TableHead>
                    <TableHead className="text-right">Tarif/kg</TableHead>
                    <TableHead className="text-right">Min. Harga</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-sm">{r.type}</p>
                          <p className="text-xs text-muted-foreground">{r.label.split("—")[1]?.trim() ?? ""}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.description}</TableCell>
                      <TableCell className="text-right font-medium text-sm">{formatRp(r.rate_per_kg)}</TableCell>
                      <TableCell className="text-right font-medium text-sm">{formatRp(r.min_price)}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={r.is_active ? "default" : "secondary"} className="text-[10px]">
                          {r.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => setEditing(r)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="rounded-lg border bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
          <p className="font-semibold">Cara kerja estimasi offline:</p>
          <p>Estimasi = max(Harga Minimum, Berat Tertagih × Tarif/kg)</p>
          <p>Berat Tertagih = max(Berat Aktual, Berat Volumetrik (P×L×T / 4000))</p>
          <p className="text-slate-400 mt-1">Jika API /estimate-price mengembalikan harga nyata, nilai API yang digunakan.</p>
        </div>
      </div>

      {editing && (
        <EditDialog rate={editing} open={!!editing} onClose={() => setEditing(null)} />
      )}
    </AppShell>
  );
}
