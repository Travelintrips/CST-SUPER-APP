import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Truck, User, Phone, Copy, ExternalLink, Plus, RefreshCw,
  CheckCircle2, XCircle, Clock, Smartphone, MessageCircle,
  ChevronDown, ChevronUp, Circle, Navigation, Zap, Filter,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Driver {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
  isActive: boolean;
}

interface StatusLog {
  id: number;
  driverJobId: number;
  status: string;
  note: string | null;
  timestamp: string;
}

interface DriverJob {
  id: number;
  jobNumber: string;
  driverId: number | null;
  logisticOrderId: number | null;
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
  driverType: string | null;
  executionMode: string | null;
  waProgressToken: string | null;
  driverNameOverride: string | null;
  driverPhoneOverride: string | null;
  vehiclePlateOverride: string | null;
  statusLogs?: StatusLog[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

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
  ASSIGNED: "bg-amber-50 text-amber-700 border-amber-200",
  ACCEPTED: "bg-blue-50 text-blue-700 border-blue-200",
  ON_THE_WAY_TO_PICKUP: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ARRIVED_AT_PICKUP: "bg-purple-50 text-purple-700 border-purple-200",
  PICKED_UP: "bg-cyan-50 text-cyan-700 border-cyan-200",
  IN_TRANSIT: "bg-orange-50 text-orange-700 border-orange-200",
  ARRIVED_AT_DESTINATION: "bg-teal-50 text-teal-700 border-teal-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

const TIMELINE_SEQUENCE = [
  "ASSIGNED", "ACCEPTED", "ON_THE_WAY_TO_PICKUP", "ARRIVED_AT_PICKUP",
  "PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "DELIVERED", "COMPLETED",
];

const ALL_STATUSES = [
  "ASSIGNED", "ACCEPTED", "ON_THE_WAY_TO_PICKUP", "ARRIVED_AT_PICKUP",
  "PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "DELIVERED", "COMPLETED", "CANCELLED",
];

// ── Utils ──────────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(err.message ?? "Request gagal"));
  }
  return res.json() as Promise<T>;
}

const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const dtShort = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// ── SSE Realtime Hook ──────────────────────────────────────────────────────────

function useDriverSSE(orderId: number, onJobUpdate: (data: Record<string, unknown>) => void) {
  const cbRef = useRef(onJobUpdate);
  cbRef.current = onJobUpdate;

  useEffect(() => {
    const es = new EventSource("/api/drivers/events", { withCredentials: true });

    es.addEventListener("job_status_changed", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        cbRef.current(data);
      } catch { /* non-fatal */ }
    });

    es.onerror = () => {
      // SSE auto-reconnects; errors are expected on network issues
    };

    return () => es.close();
  }, []);
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

interface Props {
  orderId: number;
  orderNumber?: string;
  customerName?: string | null;
  origin?: string | null;
  destination?: string | null;
  commodity?: string | null;
}

export function OrderDriverAssignmentPanel({ orderId, orderNumber, customerName, origin, destination, commodity }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [mode, setMode] = useState<"INTERNAL" | "EXTERNAL">("INTERNAL");
  const [showForceDialog, setShowForceDialog] = useState(false);
  const [forceJobId, setForceJobId] = useState<number | null>(null);
  const [forceStatus, setForceStatus] = useState("");
  const [forceNote, setForceNote] = useState("");
  const [forceOverride, setForceOverride] = useState(false);
  const [filterType, setFilterType] = useState<"ALL" | "INTERNAL" | "EXTERNAL">("ALL");

  const [internalForm, setInternalForm] = useState({
    driverNameOverride: "",
    driverPhoneOverride: "",
    vehiclePlateOverride: "",
    pickupAddress: origin ?? "",
    deliveryAddress: destination ?? "",
    cargoDescription: commodity ?? "",
    specialInstruction: "",
  });

  const [externalForm, setExternalForm] = useState({
    driverId: "",
    pickupAddress: origin ?? "",
    deliveryAddress: destination ?? "",
    cargoDescription: commodity ?? "",
    specialInstruction: "",
  });

  const { data: jobs = [], isLoading: jobsLoading, refetch } = useQuery<DriverJob[]>({
    queryKey: ["driver-jobs-by-order", orderId],
    queryFn: () => apiFetch<DriverJob[]>(`/api/drivers/jobs/list?logisticOrderId=${orderId}`),
    refetchInterval: 20_000,
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["drivers"],
    queryFn: () => apiFetch<Driver[]>("/api/drivers"),
    enabled: showDialog && mode === "EXTERNAL",
  });

  // SSE realtime updates
  useDriverSSE(orderId, (data) => {
    void queryClient.invalidateQueries({ queryKey: ["driver-jobs-by-order", orderId] });
    const status = data.status as string;
    if (status) {
      toast({
        title: `🚚 Driver Update`,
        description: `${String(data.jobNumber ?? "")} — ${STATUS_LABELS[status] ?? status}`,
        duration: 5000,
      });
    }
  });

  const filteredJobs = jobs.filter((j) => {
    if (filterType === "INTERNAL") return j.driverType === "INTERNAL";
    if (filterType === "EXTERNAL") return j.driverType !== "INTERNAL";
    return true;
  });

  const activeDrivers = drivers.filter((d) => d.isActive);
  const activeJob = filteredJobs.find((j) => j.status !== "COMPLETED" && j.status !== "CANCELLED");
  const pastJobs = filteredJobs.filter((j) => j.status === "COMPLETED" || j.status === "CANCELLED");

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (mode === "INTERNAL") {
        return apiFetch("/api/drivers/jobs", {
          method: "POST",
          body: JSON.stringify({
            logisticOrderId: orderId,
            customerName: customerName ?? "",
            driverType: "INTERNAL",
            executionMode: "WA_MINI_FORM",
            driverNameOverride: internalForm.driverNameOverride,
            driverPhoneOverride: internalForm.driverPhoneOverride || null,
            vehiclePlateOverride: internalForm.vehiclePlateOverride || null,
            pickupAddress: internalForm.pickupAddress || null,
            deliveryAddress: internalForm.deliveryAddress || null,
            cargoDescription: internalForm.cargoDescription || null,
            specialInstruction: internalForm.specialInstruction || null,
          }),
        });
      }
      return apiFetch("/api/drivers/jobs", {
        method: "POST",
        body: JSON.stringify({
          driverId: Number(externalForm.driverId),
          logisticOrderId: orderId,
          customerName: customerName ?? "",
          driverType: "EXTERNAL",
          executionMode: "DRIVER_APP",
          pickupAddress: externalForm.pickupAddress || null,
          deliveryAddress: externalForm.deliveryAddress || null,
          cargoDescription: externalForm.cargoDescription || null,
          specialInstruction: externalForm.specialInstruction || null,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Driver berhasil di-assign" });
      setShowDialog(false);
      void queryClient.invalidateQueries({ queryKey: ["driver-jobs-by-order", orderId] });
    },
    onError: (err: Error) => {
      toast({ title: "Gagal assign driver", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: number) =>
      apiFetch(`/api/drivers/jobs/${jobId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CANCELLED", note: "Dibatalkan oleh admin" }),
      }),
    onSuccess: () => {
      toast({ title: "Assignment dibatalkan" });
      void queryClient.invalidateQueries({ queryKey: ["driver-jobs-by-order", orderId] });
    },
    onError: (err: Error) => toast({ title: "Gagal batalkan", description: err.message, variant: "destructive" }),
  });

  const forceUpdateMutation = useMutation({
    mutationFn: ({ jobId, status, note, force }: { jobId: number; status: string; note: string; force: boolean }) =>
      apiFetch(`/api/drivers/jobs/${jobId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, note: note || undefined, force }),
      }),
    onSuccess: () => {
      toast({ title: "Status berhasil diperbarui" });
      setShowForceDialog(false);
      setForceJobId(null);
      setForceStatus("");
      setForceNote("");
      setForceOverride(false);
      void queryClient.invalidateQueries({ queryKey: ["driver-jobs-by-order", orderId] });
    },
    onError: (err: Error) => toast({ title: "Gagal update status", description: err.message, variant: "destructive" }),
  });

  function openForceDialog(jobId: number, currentStatus: string) {
    setForceJobId(jobId);
    setForceStatus("");
    setForceNote("");
    setForceOverride(false);
    setShowForceDialog(true);
  }

  function copyWaLink(token: string) {
    const link = `${window.location.origin}/driver-progress/${token}`;
    void navigator.clipboard.writeText(link).then(() => toast({ title: "Link WA Mini Form disalin" }));
  }

  function openWaLink(token: string) {
    window.open(`${window.location.origin}/driver-progress/${token}`, "_blank");
  }

  const displayDriverName = (job: DriverJob) =>
    job.driverType === "INTERNAL" ? (job.driverNameOverride ?? "—") : (job.driverName ?? "—");
  const displayPhone = (job: DriverJob) =>
    job.driverType === "INTERNAL" ? (job.driverPhoneOverride ?? null) : (job.driverPhone ?? null);
  const displayPlate = (job: DriverJob) =>
    job.driverType === "INTERNAL" ? (job.vehiclePlateOverride ?? null) : (job.vehiclePlate ?? null);

  const hasMultipleTypes = jobs.some((j) => j.driverType === "INTERNAL") && jobs.some((j) => j.driverType !== "INTERNAL");

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
              <Truck className="w-4 h-4" /> Driver Assignment
            </CardTitle>
            <div className="flex items-center gap-1.5">
              {hasMultipleTypes && (
                <Select value={filterType} onValueChange={(v) => setFilterType(v as "ALL" | "INTERNAL" | "EXTERNAL")}>
                  <SelectTrigger className="h-6 w-28 text-[10px]">
                    <Filter className="w-2.5 h-2.5 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua</SelectItem>
                    <SelectItem value="INTERNAL">Internal</SelectItem>
                    <SelectItem value="EXTERNAL">Eksternal</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void refetch()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              {!activeJob && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowDialog(true)}>
                  <Plus className="w-3.5 h-3.5" /> Assign
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {jobsLoading ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : !activeJob && pastJobs.length === 0 ? (
            <div className="text-center py-6 text-slate-400">
              <Truck className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Belum ada driver yang di-assign</p>
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => setShowDialog(true)}>
                <Plus className="w-3.5 h-3.5" /> Assign Driver
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {activeJob && (
                <ActiveJobCard
                  job={activeJob}
                  onCancel={(id) => cancelMutation.mutate(id)}
                  onForceUpdate={(id, status) => openForceDialog(id, status)}
                  onCopyLink={copyWaLink}
                  onOpenLink={openWaLink}
                  displayDriverName={displayDriverName}
                  displayPhone={displayPhone}
                  displayPlate={displayPlate}
                />
              )}
              {pastJobs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Riwayat</p>
                  {pastJobs.map((j) => (
                    <PastJobRow key={j.id} job={j} displayDriverName={displayDriverName} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Assign Dialog ── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Driver — {orderNumber ?? `Order #${orderId}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-slate-500 mb-2 block">Mode Eksekusi</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["INTERNAL", "EXTERNAL"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-sm transition-colors ${
                      mode === m ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 hover:border-slate-300 text-slate-600"
                    }`}
                  >
                    {m === "INTERNAL" ? <MessageCircle className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
                    <span className="font-medium">{m === "INTERNAL" ? "Driver Internal" : "Driver Eksternal"}</span>
                    <span className="text-xs opacity-70">{m === "INTERNAL" ? "Via WA Mini Form" : "Via CST Driver App"}</span>
                  </button>
                ))}
              </div>
            </div>

            {mode === "INTERNAL" ? (
              <div className="space-y-3">
                <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-700">
                  Driver tanpa akun app. Link WA Mini Form akan dikirim ke nomor driver.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Nama Driver <span className="text-red-500">*</span></Label>
                    <Input className="mt-1" value={internalForm.driverNameOverride} onChange={(e) => setInternalForm(f => ({ ...f, driverNameOverride: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Nomor WA</Label>
                    <Input className="mt-1" placeholder="08xx/62xx" value={internalForm.driverPhoneOverride} onChange={(e) => setInternalForm(f => ({ ...f, driverPhoneOverride: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Plat Kendaraan</Label>
                    <Input className="mt-1" value={internalForm.vehiclePlateOverride} onChange={(e) => setInternalForm(f => ({ ...f, vehiclePlateOverride: e.target.value }))} />
                  </div>
                </div>
                <div><Label className="text-xs">Alamat Pickup</Label><Input className="mt-1" value={internalForm.pickupAddress} onChange={(e) => setInternalForm(f => ({ ...f, pickupAddress: e.target.value }))} /></div>
                <div><Label className="text-xs">Alamat Tujuan</Label><Input className="mt-1" value={internalForm.deliveryAddress} onChange={(e) => setInternalForm(f => ({ ...f, deliveryAddress: e.target.value }))} /></div>
                <div><Label className="text-xs">Deskripsi Muatan</Label><Input className="mt-1" value={internalForm.cargoDescription} onChange={(e) => setInternalForm(f => ({ ...f, cargoDescription: e.target.value }))} /></div>
                <div><Label className="text-xs">Catatan Khusus</Label><Textarea className="mt-1 text-sm" rows={2} value={internalForm.specialInstruction} onChange={(e) => setInternalForm(f => ({ ...f, specialInstruction: e.target.value }))} /></div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-100 text-xs text-sky-700">
                  Driver terdaftar di CST Driver App. Notifikasi dikirim via WA dan app.
                </div>
                <div>
                  <Label className="text-xs">Pilih Driver <span className="text-red-500">*</span></Label>
                  <Select value={externalForm.driverId} onValueChange={(v) => setExternalForm(f => ({ ...f, driverId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih driver aktif…" /></SelectTrigger>
                    <SelectContent>
                      {activeDrivers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-400">Tidak ada driver aktif</div>
                      ) : activeDrivers.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}{d.vehiclePlate ? ` — ${d.vehiclePlate}` : ""}{d.vehicleType ? ` (${d.vehicleType})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Alamat Pickup</Label><Input className="mt-1" value={externalForm.pickupAddress} onChange={(e) => setExternalForm(f => ({ ...f, pickupAddress: e.target.value }))} /></div>
                <div><Label className="text-xs">Alamat Tujuan</Label><Input className="mt-1" value={externalForm.deliveryAddress} onChange={(e) => setExternalForm(f => ({ ...f, deliveryAddress: e.target.value }))} /></div>
                <div><Label className="text-xs">Deskripsi Muatan</Label><Input className="mt-1" value={externalForm.cargoDescription} onChange={(e) => setExternalForm(f => ({ ...f, cargoDescription: e.target.value }))} /></div>
                <div><Label className="text-xs">Catatan Khusus</Label><Textarea className="mt-1 text-sm" rows={2} value={externalForm.specialInstruction} onChange={(e) => setExternalForm(f => ({ ...f, specialInstruction: e.target.value }))} /></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
            <Button
              onClick={() => assignMutation.mutate()}
              disabled={assignMutation.isPending || (mode === "INTERNAL" ? !internalForm.driverNameOverride : !externalForm.driverId)}
            >
              {assignMutation.isPending ? "Menyimpan…" : "Assign Driver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Force Update Dialog ── */}
      <Dialog open={showForceDialog} onOpenChange={setShowForceDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" /> Update Status Driver
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Status Baru</Label>
              <Select value={forceStatus} onValueChange={setForceStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih status…" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Catatan (opsional)</Label>
              <Textarea className="mt-1 text-sm" rows={2} value={forceNote} onChange={(e) => setForceNote(e.target.value)} placeholder="Alasan update…" />
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded bg-amber-50 border border-amber-200">
              <Checkbox
                id="force-override"
                checked={forceOverride}
                onCheckedChange={(v) => setForceOverride(Boolean(v))}
              />
              <Label htmlFor="force-override" className="text-xs text-amber-700 cursor-pointer">
                Force override — bypass validasi urutan status
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceDialog(false)}>Batal</Button>
            <Button
              disabled={!forceStatus || forceUpdateMutation.isPending}
              onClick={() => forceJobId && forceUpdateMutation.mutate({ jobId: forceJobId, status: forceStatus, note: forceNote, force: forceOverride })}
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              {forceUpdateMutation.isPending ? "Menyimpan…" : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Job Timeline ───────────────────────────────────────────────────────────────

function JobTimeline({ job }: { job: DriverJob }) {
  const [expanded, setExpanded] = useState(false);
  const logs = job.statusLogs ?? [];
  const isCancelled = job.status === "CANCELLED";

  if (logs.length === 0) return null;

  const loggedStatuses = new Set(logs.map((l) => l.status));
  const maxReachedIdx = isCancelled
    ? TIMELINE_SEQUENCE.indexOf(logs.filter((l) => l.status !== "CANCELLED").at(-1)?.status ?? "")
    : TIMELINE_SEQUENCE.indexOf(job.status);
  const latestLog = logs[logs.length - 1];

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <button
        type="button"
        className="flex items-center justify-between w-full text-[10px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-1">
          <Navigation className="w-3 h-3" />
          Timeline Pengiriman
          {isCancelled && <span className="text-red-500 ml-1">(Dibatalkan)</span>}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {!expanded && latestLog && (
        <p className="text-[10px] text-slate-400 mt-0.5 ml-4">
          Terakhir: {STATUS_LABELS[latestLog.status] ?? latestLog.status} — {dtShort(latestLog.timestamp)}
        </p>
      )}

      {expanded && (
        <div className="mt-2 space-y-0">
          {TIMELINE_SEQUENCE.map((stepStatus, idx) => {
            const log = logs.find((l) => l.status === stepStatus);
            const isReached = loggedStatuses.has(stepStatus);
            const isCurrent = !isCancelled && job.status === stepStatus;
            const isPast = isReached && idx <= maxReachedIdx;

            let dotColor = "text-slate-200";
            let lineColor = "bg-slate-100";
            let textColor = "text-slate-400";
            if (isPast || isReached) { dotColor = "text-green-500"; lineColor = "bg-green-300"; textColor = "text-slate-700"; }
            if (isCurrent) { dotColor = "text-indigo-500"; }
            const isLast = idx === TIMELINE_SEQUENCE.length - 1;

            return (
              <div key={stepStatus} className="flex items-start gap-2">
                <div className="flex flex-col items-center">
                  <Circle className={`w-3 h-3 shrink-0 mt-0.5 ${dotColor}`} fill={isPast || isReached ? "currentColor" : "none"} strokeWidth={2} />
                  {!isLast && <div className={`w-px flex-1 min-h-[14px] ${lineColor}`} />}
                </div>
                <div className="pb-1.5 min-w-0">
                  <p className={`text-[10px] font-medium leading-tight ${textColor}`}>
                    {STATUS_LABELS[stepStatus] ?? stepStatus}
                    {isCurrent && <span className="ml-1 text-indigo-500">(Aktif)</span>}
                  </p>
                  {log && (
                    <p className="text-[9px] text-slate-400 leading-tight">
                      {dtShort(log.timestamp)}
                      {log.note && !log.note.startsWith("Status diperbarui") && !log.note.startsWith("Job diterima") ? ` — ${log.note}` : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {isCancelled && (() => {
            const cancelLog = logs.find((l) => l.status === "CANCELLED");
            return (
              <div className="flex items-start gap-2">
                <div className="flex flex-col items-center">
                  <XCircle className="w-3 h-3 shrink-0 mt-0.5 text-red-400" />
                </div>
                <div className="pb-1.5">
                  <p className="text-[10px] font-medium text-red-500">Dibatalkan</p>
                  {cancelLog && (
                    <p className="text-[9px] text-slate-400">
                      {dtShort(cancelLog.timestamp)}
                      {cancelLog.note ? ` — ${cancelLog.note}` : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Active Job Card ────────────────────────────────────────────────────────────

function ActiveJobCard({
  job, onCancel, onForceUpdate, onCopyLink, onOpenLink, displayDriverName, displayPhone, displayPlate,
}: {
  job: DriverJob;
  onCancel: (id: number) => void;
  onForceUpdate: (id: number, status: string) => void;
  onCopyLink: (token: string) => void;
  onOpenLink: (token: string) => void;
  displayDriverName: (j: DriverJob) => string;
  displayPhone: (j: DriverJob) => string | null;
  displayPlate: (j: DriverJob) => string | null;
}) {
  const isInternal = job.driverType === "INTERNAL";
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;
  const statusColor = STATUS_COLORS[job.status] ?? "bg-slate-50 text-slate-600 border-slate-200";
  const isTerminal = job.status === "COMPLETED" || job.status === "CANCELLED";

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-slate-500">{job.jobNumber}</span>
          <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${statusColor}`}>{statusLabel}</Badge>
          {isInternal ? (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-indigo-50 text-indigo-600 border-indigo-200">
              <MessageCircle className="w-2.5 h-2.5 mr-0.5" /> WA Internal
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-sky-50 text-sky-600 border-sky-200">
              <Smartphone className="w-2.5 h-2.5 mr-0.5" /> Driver App
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onForceUpdate(job.id, job.status)}
            className="text-[10px] text-amber-600 hover:text-amber-800 flex items-center gap-0.5"
            title="Update Status"
          >
            <Zap className="w-3 h-3" /> Update
          </button>
          {!isTerminal && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-0.5"
            >
              <XCircle className="w-3 h-3" /> Batalkan
            </button>
          )}
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div>
            <span className="text-slate-400 flex items-center gap-1"><User className="w-3 h-3" />Driver</span>
            <p className="font-medium text-slate-800 mt-0.5">{displayDriverName(job)}</p>
          </div>
          {displayPhone(job) && (
            <div>
              <span className="text-slate-400 flex items-center gap-1"><Phone className="w-3 h-3" />Telepon</span>
              <p className="font-medium text-slate-800 mt-0.5">{displayPhone(job)}</p>
            </div>
          )}
          {displayPlate(job) && (
            <div>
              <span className="text-slate-400 flex items-center gap-1"><Truck className="w-3 h-3" />Plat</span>
              <p className="font-medium text-slate-800 mt-0.5">{displayPlate(job)}</p>
            </div>
          )}
          <div>
            <span className="text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" />Ditugaskan</span>
            <p className="font-medium text-slate-800 mt-0.5">{dt(job.assignedAt)}</p>
          </div>
        </div>

        {isInternal && job.waProgressToken && (
          <div className="mt-2 p-2 rounded-md bg-indigo-50 border border-indigo-100">
            <p className="text-[10px] font-medium text-indigo-600 mb-1.5">Link WA Mini Form</p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-[10px] bg-white border border-indigo-200 rounded px-2 py-1 text-indigo-700 truncate">
                {window.location.origin}/driver-progress/{job.waProgressToken}
              </code>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => onCopyLink(job.waProgressToken!)}>
                <Copy className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => onOpenLink(job.waProgressToken!)}>
                <ExternalLink className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        <JobTimeline job={job} />
      </div>
    </div>
  );
}

// ── Past Job Row ───────────────────────────────────────────────────────────────

function PastJobRow({ job, displayDriverName }: { job: DriverJob; displayDriverName: (j: DriverJob) => string }) {
  const [showTimeline, setShowTimeline] = useState(false);
  const isCompleted = job.status === "COMPLETED";

  return (
    <div className="rounded border border-slate-100 bg-slate-50 text-xs overflow-hidden">
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-slate-100 transition-colors"
        onClick={() => job.statusLogs && job.statusLogs.length > 0 && setShowTimeline((v) => !v)}
      >
        {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
        <span className="font-mono text-slate-400">{job.jobNumber}</span>
        <span className="text-slate-600 flex-1 truncate">{displayDriverName(job)}</span>
        <span className={`text-[10px] ${isCompleted ? "text-green-600" : "text-red-500"}`}>
          {STATUS_LABELS[job.status] ?? job.status}
        </span>
        {job.statusLogs && job.statusLogs.length > 0 && (
          showTimeline ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />
        )}
      </div>
      {showTimeline && job.statusLogs && job.statusLogs.length > 0 && (
        <div className="px-3 pb-2 border-t border-slate-100">
          <JobTimeline job={job} />
        </div>
      )}
    </div>
  );
}
