import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Truck, MapPin, Clock, UserCheck, Plus, RefreshCw, Camera, Navigation } from "lucide-react";

interface Driver {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
  isActive: boolean;
  currentLat: string | null;
  currentLng: string | null;
  lastLocationAt: string | null;
}

interface Photo {
  id: number;
  driverJobId: number;
  url: string;
  photoType: string;
  takenAt: string;
}

interface DriverJob {
  id: number;
  jobNumber: string;
  driverId: number;
  freightShipmentId: number | null;
  customerName: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  cargoDescription: string | null;
  vehicleType: string | null;
  truckPlate: string | null;
  status: string;
  assignedAt: string;
  completedAt: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverEmail: string | null;
  vehiclePlate: string | null;
  lastLocationAt: string | null;
  currentLat: string | null;
  currentLng: string | null;
  photos: Photo[];
}

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: "Ditugaskan",
  ACCEPTED: "Diterima",
  ON_THE_WAY_TO_PICKUP: "Menuju Pickup",
  ARRIVED_AT_PICKUP: "Tiba Pickup",
  PICKED_UP: "Barang Diambil",
  IN_TRANSIT: "Dalam Perjalanan",
  ARRIVED_AT_DESTINATION: "Tiba di Tujuan",
  DELIVERED: "Terkirim",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  ACCEPTED: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  ON_THE_WAY_TO_PICKUP: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  ARRIVED_AT_PICKUP: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  PICKED_UP: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  IN_TRANSIT: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  ARRIVED_AT_DESTINATION: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  DELIVERED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  COMPLETED: "bg-green-500/10 text-green-600 border-green-500/20",
  CANCELLED: "bg-destructive/10 text-destructive border-destructive/20",
};

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(err.message ?? "Request gagal"));
  }
  return res.json() as Promise<T>;
}

function formatRelativeTime(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return new Date(isoDate).toLocaleDateString("id-ID");
}

interface Props {
  shipmentId: number;
  shipperName?: string | null;
  commodity?: string | null;
  origin?: string | null;
  destination?: string | null;
}

export function DriverAssignmentPanel({ shipmentId, shipperName, commodity, origin, destination }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showDialog, setShowDialog] = useState(false);
  const [showPhotosJobId, setShowPhotosJobId] = useState<number | null>(null);
  const [form, setForm] = useState({
    driverId: "",
    pickupAddress: origin ?? "",
    deliveryAddress: destination ?? "",
    cargoDescription: commodity ?? "",
    specialInstruction: "",
    weight: "",
    notes: "",
  });

  const { data: jobs = [], isLoading: jobsLoading, refetch } = useQuery<DriverJob[]>({
    queryKey: ["driver-jobs-by-shipment", shipmentId],
    queryFn: () => apiFetch<DriverJob[]>(`/api/drivers/jobs/list?shipmentId=${shipmentId}`),
    refetchInterval: 15_000,
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["drivers"],
    queryFn: () => apiFetch<Driver[]>("/api/drivers"),
    refetchInterval: 30_000,
  });

  const activeDrivers = drivers.filter((d) => d.isActive);
  const activeJob = jobs.find((j) => j.status !== "COMPLETED" && j.status !== "CANCELLED");
  const photosForJob = showPhotosJobId != null ? jobs.find((j) => j.id === showPhotosJobId)?.photos ?? [] : [];

  const assignMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return apiFetch("/api/drivers/jobs", {
        method: "POST",
        body: JSON.stringify({
          driverId: Number(data.driverId),
          freightShipmentId: shipmentId,
          customerName: shipperName,
          pickupAddress: data.pickupAddress || null,
          deliveryAddress: data.deliveryAddress || null,
          cargoDescription: data.cargoDescription || null,
          specialInstruction: data.specialInstruction || null,
          weight: data.weight || null,
          notes: data.notes || null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver-jobs-by-shipment", shipmentId] });
      toast({ title: "Driver berhasil ditugaskan" });
      setShowDialog(false);
    },
    onError: (e: Error) => toast({ title: "Gagal menugaskan driver", description: e.message, variant: "destructive" }),
  });

  function openAssign() {
    setForm({
      driverId: "",
      pickupAddress: origin ?? "",
      deliveryAddress: destination ?? "",
      cargoDescription: commodity ?? "",
      specialInstruction: "",
      weight: "",
      notes: "",
    });
    setShowDialog(true);
  }

  return (
    <div className="space-y-4">
      {jobsLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : activeJob ? (
        <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{activeJob.driverName ?? "Driver"}</span>
              <span className="text-xs text-muted-foreground font-mono">{activeJob.jobNumber}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </div>
              <Badge variant="outline" className={`text-xs ${STATUS_COLORS[activeJob.status] ?? ""}`}>
                {STATUS_LABELS[activeJob.status] ?? activeJob.status}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Truck className="h-3.5 w-3.5 shrink-0" />
              <span>{activeJob.vehiclePlate ?? activeJob.truckPlate ?? activeJob.vehicleType ?? "—"}</span>
            </div>
            {activeJob.driverPhone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>{activeJob.driverPhone}</span>
              </div>
            )}
            {activeJob.pickupAddress && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-red-400" />
                <span className="truncate">{activeJob.pickupAddress}</span>
              </div>
            )}
            {activeJob.deliveryAddress && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-green-500" />
                <span className="truncate">{activeJob.deliveryAddress}</span>
              </div>
            )}
          </div>

          {activeJob.lastLocationAt && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Navigation className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              <span>
                Lokasi terakhir: {formatRelativeTime(activeJob.lastLocationAt)}
                {activeJob.currentLat && activeJob.currentLng && (
                  <> &middot; <a
                    href={`https://maps.google.com/?q=${activeJob.currentLat},${activeJob.currentLng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-500 hover:underline ml-1"
                  >Buka Maps</a></>
                )}
              </span>
            </div>
          )}

          {activeJob.photos.length > 0 && (
            <div>
              <button
                className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                onClick={() => setShowPhotosJobId(activeJob.id === showPhotosJobId ? null : activeJob.id)}
              >
                <Camera className="h-3.5 w-3.5" />
                {activeJob.photos.length} foto
              </button>
              {showPhotosJobId === activeJob.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {photosForJob.map((ph) => (
                    <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer">
                      <img src={ph.url} alt={ph.photoType} className="h-16 w-16 object-cover rounded-md border" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={openAssign} className="text-xs gap-1">
              <Plus className="h-3.5 w-3.5" />
              Tambah Driver Lain
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-2">
          <Truck className="h-8 w-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Belum ada driver yang ditugaskan untuk shipment ini</p>
          <Button size="sm" onClick={openAssign} className="gap-1">
            <Plus className="h-4 w-4" />
            Tugaskan Driver
          </Button>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Riwayat Job Driver</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </div>
          <div className="space-y-1">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">{job.jobNumber}</span>
                  <span className="text-muted-foreground text-xs">{job.driverName}</span>
                  {job.photos.length > 0 && (
                    <button
                      className="text-xs text-blue-500 hover:underline flex items-center gap-0.5"
                      onClick={() => setShowPhotosJobId(job.id === showPhotosJobId ? null : job.id)}
                    >
                      <Camera className="h-3 w-3" />
                      {job.photos.length}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {job.lastLocationAt && (
                    <span className="text-xs text-muted-foreground hidden md:flex items-center gap-1">
                      <Navigation className="h-3 w-3 text-blue-400" />
                      {formatRelativeTime(job.lastLocationAt)}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(job.assignedAt).toLocaleDateString("id-ID")}
                  </span>
                  <Badge variant="outline" className={`text-xs ${STATUS_COLORS[job.status] ?? ""}`}>
                    {STATUS_LABELS[job.status] ?? job.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
          {showPhotosJobId != null && photosForJob.length > 0 && !jobs.find(j => j.id === showPhotosJobId && (j.status !== "COMPLETED" && j.status !== "CANCELLED")) && (
            <div className="flex flex-wrap gap-2 pt-1 pb-2">
              {photosForJob.map((ph) => (
                <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer">
                  <img src={ph.url} alt={ph.photoType} className="h-16 w-16 object-cover rounded-md border" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tugaskan Driver ke Shipment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Pilih Driver *</Label>
              <Select value={form.driverId} onValueChange={(v) => setForm({ ...form, driverId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih driver..." />
                </SelectTrigger>
                <SelectContent>
                  {activeDrivers.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      <div className="flex flex-col">
                        <span>{d.name}</span>
                        {d.vehiclePlate && (
                          <span className="text-xs text-muted-foreground">{d.vehiclePlate} · {d.vehicleType}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                  {activeDrivers.length === 0 && (
                    <SelectItem value="__none" disabled>Tidak ada driver aktif</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Alamat Pickup</Label>
              <Input
                value={form.pickupAddress}
                onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })}
                placeholder="Pelabuhan / gudang asal..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Alamat Pengiriman</Label>
              <Input
                value={form.deliveryAddress}
                onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
                placeholder="Gudang / tujuan akhir..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Deskripsi Kargo</Label>
              <Input
                value={form.cargoDescription}
                onChange={(e) => setForm({ ...form, cargoDescription: e.target.value })}
                placeholder="Jenis barang..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Berat</Label>
                <Input
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                  placeholder="5.2 ton"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instruksi Khusus</Label>
              <Textarea
                value={form.specialInstruction}
                onChange={(e) => setForm({ ...form, specialInstruction: e.target.value })}
                placeholder="Handle with care, koordinasi dengan gudang..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
            <Button
              onClick={() => assignMutation.mutate(form)}
              disabled={assignMutation.isPending || !form.driverId}
            >
              {assignMutation.isPending ? "Menugaskan..." : "Tugaskan Driver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
