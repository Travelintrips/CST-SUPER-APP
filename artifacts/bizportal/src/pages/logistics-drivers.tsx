import { AppShell } from "@/components/layout/AppShell";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, UserX, Truck, Phone, Mail, MapPin, ChevronDown, ChevronUp, Activity, ClipboardList } from "lucide-react";
import React from "react";
import DriverMap from "@/components/logistics/DriverMap";
import GeofenceAlertPanel from "@/components/logistics/GeofenceAlertPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";

interface Driver {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  licenseNumber: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
  isActive: boolean;
  currentLat: string | null;
  currentLng: string | null;
  lastLocationAt: string | null;
  createdAt: string;
}

interface DriverJob {
  id: number;
  jobNumber: string;
  customerName: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  status: string;
  assignedAt: string;
  completedAt: string | null;
  freightShipmentId: number | null;
}

interface ActiveJob {
  id: number;
  jobNumber: string;
  driverId: number;
  customerName: string | null;
  status: string;
}

interface DriverDetail extends Driver {
  jobs: DriverJob[];
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

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    credentials: "include",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(err.message ?? "Request gagal"));
  }
  return res.json();
}

const EMPTY_FORM = { name: "", email: "", password: "", phone: "", licenseNumber: "", vehiclePlate: "", vehicleType: "" };

export default function LogisticsDriversPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { isAuthenticated } = useSupabaseAuth();

  const [showDialog, setShowDialog] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [geofenceAlertCount, setGeofenceAlertCount] = useState(0);
  const [deviatedDriverIds, setDeviatedDriverIds] = useState<Set<number>>(new Set());
  const sseRef = useRef<EventSource | null>(null);

  // SSE real-time subscription untuk update status driver
  useEffect(() => {
    if (!isAuthenticated) return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    function connect() {
      if (!active) return;

      es = new EventSource(`/api/drivers/events`, { withCredentials: true });
      sseRef.current = es;

      es.addEventListener("connected", () => {
        if (active) setSseConnected(true);
      });

      es.addEventListener("job_status_changed", (e: MessageEvent) => {
        if (!active) return;
        try {
          const data = JSON.parse(e.data) as {
            jobId: number;
            jobNumber: string;
            driverId: number;
            status: string;
            freightShipmentId: number | null;
          };
          queryClient.invalidateQueries({ queryKey: ["driver-jobs-all"] });
          queryClient.invalidateQueries({ queryKey: ["driver-detail"] });
          toast({
            title: `Job ${data.jobNumber} — ${STATUS_LABELS[data.status] ?? data.status}`,
            description: "Status diperbarui oleh driver",
          });
        } catch { /* ignore */ }
      });

      es.addEventListener("location_update", (e: MessageEvent) => {
        if (!active) return;
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("driver_location_update", { detail: data }));
          queryClient.invalidateQueries({ queryKey: ["drivers"] });
        } catch { /* ignore */ }
      });

      es.addEventListener("geofence_alert", (e: MessageEvent) => {
        if (!active) return;
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("geofence_alert", { detail: data }));
          setGeofenceAlertCount((c) => c + 1);
          toast({
            title: `⚠️ Geofence Alert — ${data.driverName}`,
            description: `Job ${data.jobNumber}: menyimpang ${data.deviationKm.toFixed(1)} km dari rute!`,
            variant: "destructive",
          });
        } catch { /* ignore */ }
      });

      es.addEventListener("geofence_alert_update", (e: MessageEvent) => {
        if (!active) return;
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("geofence_alert_update", { detail: data }));
        } catch { /* ignore */ }
      });

      es.addEventListener("geofence_resolved", (e: MessageEvent) => {
        if (!active) return;
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("geofence_resolved", { detail: data }));
          setGeofenceAlertCount((c) => Math.max(0, c - 1));
          toast({
            title: `✅ ${data.driverName} kembali ke rute`,
            description: `Job ${data.jobNumber} sudah kembali dalam jalur normal.`,
          });
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        setSseConnected(false);
        es?.close();
        if (active) {
          reconnectTimer = setTimeout(() => { if (active) connect(); }, 8_000);
        }
      };
    }

    connect();

    return () => {
      active = false;
      setSseConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      sseRef.current = null;
    };
  }, [isAuthenticated, queryClient, toast]);

  // Track deviated driver IDs from geofence events for map highlighting
  useEffect(() => {
    function onAlert(e: Event) {
      const data = (e as CustomEvent).detail as { driverId: number };
      setDeviatedDriverIds((prev) => new Set([...prev, data.driverId]));
    }
    function onResolved(e: Event) {
      const data = (e as CustomEvent).detail as { driverId: number };
      setDeviatedDriverIds((prev) => { const next = new Set(prev); next.delete(data.driverId); return next; });
    }
    window.addEventListener("geofence_alert", onAlert);
    window.addEventListener("geofence_resolved", onResolved);
    return () => {
      window.removeEventListener("geofence_alert", onAlert);
      window.removeEventListener("geofence_resolved", onResolved);
    };
  }, []);

  const [showJobDialog, setShowJobDialog] = useState(false);
  const [jobTargetDriver, setJobTargetDriver] = useState<Driver | null>(null);
  const EMPTY_JOB = { pickupAddress: "", deliveryAddress: "", cargoDescription: "", specialInstruction: "", weight: "", customerName: "" };
  const [jobForm, setJobForm] = useState(EMPTY_JOB);

  const { data: drivers = [], isLoading } = useQuery<Driver[]>({
    queryKey: ["drivers"],
    queryFn: () => apiFetch("/api/drivers"),
    refetchInterval: 30_000,
  });

  const { data: allJobs = [] } = useQuery<ActiveJob[]>({
    queryKey: ["driver-jobs-all"],
    queryFn: () => apiFetch("/api/drivers/jobs/list"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const activeJobByDriver = useMemo(() =>
    allJobs.reduce<Record<number, ActiveJob>>((acc, job) => {
      if (job.status !== "COMPLETED" && job.status !== "CANCELLED") {
        if (!acc[job.driverId]) acc[job.driverId] = job;
      }
      return acc;
    }, {}),
  [allJobs]);

  const { data: expandedDetail } = useQuery<DriverDetail>({
    queryKey: ["driver-detail", expandedId],
    queryFn: () => apiFetch(`/api/drivers/${expandedId}`),
    enabled: expandedId !== null,
    refetchInterval: expandedId !== null ? 15_000 : false,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM) => apiFetch("/api/drivers", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast({ title: t.common.success });
      setShowDialog(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast({ title: t.common.error, description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<typeof EMPTY_FORM> & { isActive?: boolean } }) =>
      apiFetch(`/api/drivers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast({ title: t.common.success });
      setShowDialog(false);
      setEditDriver(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast({ title: t.common.error, description: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/drivers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast({ title: t.common.success });
    },
    onError: (e: Error) => toast({ title: t.common.error, description: e.message, variant: "destructive" }),
  });

  const createJobMutation = useMutation({
    mutationFn: (data: typeof EMPTY_JOB & { driverId: number }) =>
      apiFetch("/api/drivers/jobs", {
        method: "POST",
        body: JSON.stringify({
          driverId: data.driverId,
          customerName: data.customerName || null,
          pickupAddress: data.pickupAddress || null,
          deliveryAddress: data.deliveryAddress || null,
          cargoDescription: data.cargoDescription || null,
          specialInstruction: data.specialInstruction || null,
          weight: data.weight || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver-jobs-all"] });
      queryClient.invalidateQueries({ queryKey: ["driver-detail", jobTargetDriver?.id] });
      toast({ title: t.common.success });
      setShowJobDialog(false);
      setJobForm(EMPTY_JOB);
      setJobTargetDriver(null);
    },
    onError: (e: Error) => toast({ title: t.common.error, description: e.message, variant: "destructive" }),
  });

  function openCreateJob(driver: Driver) {
    setJobTargetDriver(driver);
    setJobForm({ ...EMPTY_JOB });
    setShowJobDialog(true);
  }

  function openCreate() {
    setEditDriver(null);
    setForm(EMPTY_FORM);
    setShowDialog(true);
  }

  function openEdit(driver: Driver) {
    setEditDriver(driver);
    setForm({
      name: driver.name,
      email: driver.email,
      password: "",
      phone: driver.phone ?? "",
      licenseNumber: driver.licenseNumber ?? "",
      vehiclePlate: driver.vehiclePlate ?? "",
      vehicleType: driver.vehicleType ?? "",
    });
    setShowDialog(true);
  }

  function handleSubmit() {
    if (editDriver) {
      const payload: Partial<typeof EMPTY_FORM> = { ...form };
      if (!payload.password) delete payload.password;
      updateMutation.mutate({ id: editDriver.id, data: payload });
    } else {
      createMutation.mutate(form);
    }
  }

  const activeCount = drivers.filter((d) => d.isActive).length;
  const inactiveCount = drivers.length - activeCount;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Manajemen Driver</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {drivers.length} total · {activeCount} aktif · {inactiveCount} nonaktif
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 border ${
              sseConnected
                ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20"
                : "text-amber-600 bg-amber-500/10 border-amber-500/20"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              {sseConnected ? "Realtime · SSE" : "Polling · 15s"}
            </div>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Tambah Driver
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{activeCount}</p>
                  <p className="text-sm text-muted-foreground">Driver Aktif</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{inactiveCount}</p>
                  <p className="text-sm text-muted-foreground">Driver Nonaktif</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{drivers.filter((d) => d.lastLocationAt).length}</p>
                  <p className="text-sm text-muted-foreground">Terdeteksi GPS</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <ErrorBoundary label="Geofence Alert">
          <GeofenceAlertPanel
            onAlertCountChange={setGeofenceAlertCount}
          />
        </ErrorBoundary>

        <ErrorBoundary label="Peta Driver">
          <DriverMap
            drivers={drivers}
            activeJobByDriver={activeJobByDriver}
            sseConnected={sseConnected}
            geofenceAlertDriverIds={deviatedDriverIds}
          />
        </ErrorBoundary>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daftar Driver</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kontak</TableHead>
                  <TableHead>Kendaraan</TableHead>
                  <TableHead>SIM</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Job Aktif</TableHead>
                  <TableHead>Lokasi Terakhir</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : drivers.length === 0
                    ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                          Belum ada driver. Klik "Tambah Driver" untuk memulai.
                        </TableCell>
                      </TableRow>
                    )
                    : drivers.map((driver) => (
                      <React.Fragment key={driver.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/30"
                          onClick={() => setExpandedId(expandedId === driver.id ? null : driver.id)}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {expandedId === driver.id
                                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                              {driver.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 text-sm">
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Mail className="w-3 h-3" />{driver.email}
                              </span>
                              {driver.phone && (
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <Phone className="w-3 h-3" />{driver.phone}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <p className="font-medium">{driver.vehiclePlate ?? "—"}</p>
                              <p className="text-muted-foreground">{driver.vehicleType ?? "—"}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{driver.licenseNumber ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={driver.isActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-muted text-muted-foreground"}>
                              {driver.isActive ? "Aktif" : "Nonaktif"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {activeJobByDriver[driver.id] ? (
                              <div className="flex items-center gap-1.5">
                                <Activity className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                                <div className="flex flex-col">
                                  <span className="text-xs font-mono font-medium text-orange-600">
                                    {activeJobByDriver[driver.id].jobNumber}
                                  </span>
                                  <Badge variant="outline" className={`text-xs mt-0.5 ${STATUS_COLORS[activeJobByDriver[driver.id].status] ?? ""}`}>
                                    {STATUS_LABELS[activeJobByDriver[driver.id].status] ?? activeJobByDriver[driver.id].status}
                                  </Badge>
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {driver.lastLocationAt
                              ? new Date(driver.lastLocationAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })
                              : "Belum terdeteksi"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(driver)}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              {driver.isActive && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => deactivateMutation.mutate(driver.id)}
                                >
                                  <UserX className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandedId === driver.id && (
                          <TableRow key={`${driver.id}-detail`}>
                            <TableCell colSpan={8} className="bg-muted/20 p-4">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold">Riwayat Job — {driver.name}</h3>
                                  {driver.isActive && (
                                    <Button
                                      size="sm"
                                      className="gap-1.5 text-xs"
                                      onClick={(e) => { e.stopPropagation(); openCreateJob(driver); }}
                                    >
                                      <ClipboardList className="w-3.5 h-3.5" />
                                      Buat Job
                                    </Button>
                                  )}
                                </div>
                                {!expandedDetail || expandedDetail.id !== driver.id ? (
                                  <Skeleton className="h-20 w-full" />
                                ) : expandedDetail.jobs.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">Belum ada job yang ditugaskan.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {expandedDetail.jobs.map((job) => (
                                      <div key={job.id} className="flex items-center justify-between bg-background rounded-lg border px-4 py-2 text-sm">
                                        <div>
                                          <span className="font-medium">{job.jobNumber}</span>
                                          <span className="text-muted-foreground ml-2">{job.customerName ?? "—"}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="text-muted-foreground text-xs">
                                            {new Date(job.assignedAt).toLocaleDateString("id-ID")}
                                          </span>
                                          <Badge variant="outline" className={`text-xs ${STATUS_COLORS[job.status] ?? ""}`}>
                                            {STATUS_LABELS[job.status] ?? job.status}
                                          </Badge>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ── Dialog Buat Job ── */}
      <Dialog open={showJobDialog} onOpenChange={(open) => { if (!open) { setShowJobDialog(false); setJobTargetDriver(null); setJobForm(EMPTY_JOB); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Job untuk {jobTargetDriver?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <Truck className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{jobTargetDriver?.vehiclePlate ?? "—"} · {jobTargetDriver?.vehicleType ?? "—"}</span>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Nama Customer</Label>
              <Input placeholder="PT. Maju Bersama" value={jobForm.customerName} onChange={(e) => setJobForm({ ...jobForm, customerName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Alamat Pickup</Label>
              <Input placeholder="Pelabuhan Tanjung Priok, Jakarta" value={jobForm.pickupAddress} onChange={(e) => setJobForm({ ...jobForm, pickupAddress: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Alamat Tujuan</Label>
              <Input placeholder="Gudang Cibitung, Bekasi" value={jobForm.deliveryAddress} onChange={(e) => setJobForm({ ...jobForm, deliveryAddress: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Kargo</Label>
                <Input placeholder="Elektronik, 5 palet" value={jobForm.cargoDescription} onChange={(e) => setJobForm({ ...jobForm, cargoDescription: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Berat</Label>
                <Input placeholder="2.5 ton" value={jobForm.weight} onChange={(e) => setJobForm({ ...jobForm, weight: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instruksi Khusus</Label>
              <Textarea placeholder="Handle with care..." rows={2} value={jobForm.specialInstruction} onChange={(e) => setJobForm({ ...jobForm, specialInstruction: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowJobDialog(false); setJobTargetDriver(null); setJobForm(EMPTY_JOB); }}>Batal</Button>
            <Button
              onClick={() => jobTargetDriver && createJobMutation.mutate({ ...jobForm, driverId: jobTargetDriver.id })}
              disabled={createJobMutation.isPending || !jobTargetDriver}
            >
              {createJobMutation.isPending ? "Membuat..." : "Buat Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Tambah/Edit Driver ── */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditDriver(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editDriver ? "Edit Driver" : "Tambah Driver Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nama Lengkap *</Label>
              <Input placeholder="Ahmad Rizki" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" placeholder="driver@cst.co.id" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{editDriver ? "Password Baru" : "Password *"}</Label>
                <Input type="password" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>No. Telepon</Label>
              <Input placeholder="+62 812-3456-7890" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>No. SIM</Label>
              <Input placeholder="SIM-B2-123456" value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Plat Kendaraan</Label>
                <Input placeholder="B 1234 ABC" value={form.vehiclePlate} onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tipe Kendaraan</Label>
                <Input placeholder="Truk Engkel" value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} />
              </div>
            </div>
            {editDriver && (
              <div className="flex items-center justify-between border rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Status Aktif</p>
                  <p className="text-xs text-muted-foreground">Driver dapat menerima job baru</p>
                </div>
                <Switch
                  checked={editDriver.isActive}
                  onCheckedChange={(checked) => {
                    updateMutation.mutate({ id: editDriver.id, data: { isActive: checked } });
                    setEditDriver({ ...editDriver, isActive: checked });
                  }}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setEditDriver(null); setForm(EMPTY_FORM); }}>
              Batal
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending || !form.name || !form.email || (!editDriver && !form.password)}
            >
              {createMutation.isPending || updateMutation.isPending ? "Menyimpan..." : editDriver ? "Simpan Perubahan" : "Tambah Driver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
