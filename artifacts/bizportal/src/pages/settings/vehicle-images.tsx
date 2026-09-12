import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Upload, X, ImageIcon, Loader2, Truck,
  CheckCircle2, GripVertical, Save,
} from "lucide-react";
import { Link } from "wouter";

const DEFAULT_VEHICLES = [
  { id: "mobil",          name: "Mobil",         color: "#94a3b8" },
  { id: "mobil-xl",       name: "Mobil XL",      color: "#93c5fd" },
  { id: "van",            name: "Van",            color: "#a5b4fc" },
  { id: "pickup-kecil",   name: "Pickup Kecil",  color: "#fbbf24" },
  { id: "box-kecil",      name: "Box Kecil",     color: "#86efac" },
  { id: "engkel",         name: "Engkel",         color: "#fb923c" },
  { id: "double-engkel",  name: "Double Engkel", color: "#f87171" },
  { id: "cdd-long",       name: "CDD Long",      color: "#60a5fa" },
  { id: "fuso",           name: "Fuso",           color: "#34d399" },
  { id: "tronton",        name: "Tronton",        color: "#a78bfa" },
  { id: "truk-trailer",   name: "Truk Trailer",  color: "#64748b" },
  { id: "truk-reefer",    name: "Truk Reefer",   color: "#38bdf8" },
];

type Vehicle = typeof DEFAULT_VEHICLES[0];

const apiFetch = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { credentials: "include", ...init });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string; message?: string }).error ?? (j as { message?: string }).message ?? `HTTP ${r.status}`);
  }
  return r.json();
};

// ── Image Card ────────────────────────────────────────────────────────────────

function VehicleImageCard({
  vehicle,
  imageUrl,
  onUpload,
  onRemove,
}: {
  vehicle: Vehicle;
  imageUrl: string | null;
  onUpload: (vehicleId: string, file: File) => void;
  onRemove: (vehicleId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      await onUpload(vehicle.id, file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div
        className="h-36 flex items-center justify-center relative"
        style={{ background: imageUrl ? undefined : `${vehicle.color}22` }}
      >
        {imageUrl ? (
          <>
            <img src={imageUrl} alt={vehicle.name} className="h-full w-full object-contain p-2" />
            <button
              onClick={() => onRemove(vehicle.id)}
              className="absolute top-2 right-2 bg-white rounded-full p-1 shadow text-slate-500 hover:text-red-500 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-2 left-2">
              <Badge variant="secondary" className="text-[10px] gap-1 bg-white/90">
                <CheckCircle2 className="w-3 h-3 text-green-500" /> Terpasang
              </Badge>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <ImageIcon className="w-10 h-10" style={{ color: vehicle.color }} />
            <span className="text-xs">Belum ada gambar</span>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        )}
      </div>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: vehicle.color }} />
          <span className="font-semibold text-sm text-slate-800">{vehicle.name}</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs gap-1.5"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Mengupload…</>
          ) : (
            <><Upload className="w-3.5 h-3.5" /> {imageUrl ? "Ganti" : "Upload"}</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Sortable Row Card ─────────────────────────────────────────────────────────

function SortableVehicleRow({
  vehicle,
  index,
  imageUrl,
}: {
  vehicle: Vehicle;
  index: number;
  imageUrl?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: vehicle.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm"
    >
      <span className="text-slate-400 text-sm font-mono w-6 text-center shrink-0">{index + 1}</span>
      <button
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-5 h-5" />
      </button>
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: `${vehicle.color}22` }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={vehicle.name} className="w-full h-full object-contain p-1" />
        ) : (
          <div className="w-3 h-3 rounded-full" style={{ background: vehicle.color }} />
        )}
      </div>
      <span className="font-medium text-slate-800 flex-1">{vehicle.name}</span>
      {imageUrl ? (
        <Badge variant="secondary" className="text-[10px] gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-500" /> Gambar
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] text-slate-400">SVG</Badge>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VehicleImagesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: images = {}, isLoading: loadingImages } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings/vehicle-images"],
    queryFn: () => apiFetch("/api/settings/vehicle-images"),
  });

  const { data: savedOrder = [], isLoading: loadingOrder } = useQuery<string[]>({
    queryKey: ["/api/settings/vehicle-order"],
    queryFn: () => apiFetch("/api/settings/vehicle-order"),
  });

  // Build ordered vehicle list: saved order first, then remaining defaults
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const effectiveOrder = localOrder ?? savedOrder;
  const orderedVehicles: Vehicle[] = (() => {
    const byId = Object.fromEntries(DEFAULT_VEHICLES.map(v => [v.id, v]));
    const ids = effectiveOrder.length > 0
      ? [...effectiveOrder, ...DEFAULT_VEHICLES.map(v => v.id).filter(id => !effectiveOrder.includes(id))]
      : DEFAULT_VEHICLES.map(v => v.id);
    return ids.map(id => byId[id]).filter(Boolean);
  })();

  const saveMut = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch("/api/settings/vehicle-images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/settings/vehicle-images"] }),
    onError: (e: Error) => toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }),
  });

  const saveOrderMut = useMutation({
    mutationFn: (order: string[]) =>
      apiFetch("/api/settings/vehicle-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings/vehicle-order"] });
      toast({ title: "Urutan kendaraan berhasil disimpan" });
    },
    onError: (e: Error) => toast({ title: "Gagal menyimpan urutan", description: e.message, variant: "destructive" }),
  });

  async function handleUpload(vehicleId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    let url: string;
    try {
      const res = await fetch("/api/settings/vehicle-images/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      url = data.url;
    } catch (err) {
      toast({ title: "Gagal upload", description: String(err), variant: "destructive" });
      return;
    }
    const updated = { ...images, [vehicleId]: url };
    await saveMut.mutateAsync(updated);
    toast({ title: `Gambar ${DEFAULT_VEHICLES.find(v => v.id === vehicleId)?.name} berhasil disimpan` });
  }

  async function handleRemove(vehicleId: string) {
    const updated = { ...images };
    delete updated[vehicleId];
    await saveMut.mutateAsync(updated);
    toast({ title: `Gambar ${DEFAULT_VEHICLES.find(v => v.id === vehicleId)?.name} dihapus` });
  }

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIds = orderedVehicles.map(v => v.id);
    const oldIndex = oldIds.indexOf(active.id as string);
    const newIndex = oldIds.indexOf(over.id as string);
    setLocalOrder(arrayMove(oldIds, oldIndex, newIndex));
  }

  const isLoading = loadingImages || loadingOrder;
  const hasUnsavedOrder = localOrder !== null;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Truck className="w-5 h-5 text-orange-500" /> Gambar & Urutan Armada Trucking
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Upload gambar dan atur urutan tampil kendaraan di Customer Portal.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-xl" />)}
          </div>
        ) : (
          <Tabs defaultValue="gambar">
            <TabsList className="mb-4">
              <TabsTrigger value="gambar">
                <ImageIcon className="w-4 h-4 mr-1.5" /> Gambar
              </TabsTrigger>
              <TabsTrigger value="urutan">
                <GripVertical className="w-4 h-4 mr-1.5" /> Urutan Tampil
              </TabsTrigger>
            </TabsList>

            {/* Tab: Gambar */}
            <TabsContent value="gambar" className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-2.5">
                <ImageIcon className="w-4 h-4 shrink-0" />
                <span>
                  {Object.keys(images).length} dari {DEFAULT_VEHICLES.length} kendaraan sudah punya gambar.
                  Yang belum diupload tetap menampilkan ilustrasi SVG bawaan.
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {orderedVehicles.map(v => (
                  <VehicleImageCard
                    key={v.id}
                    vehicle={v}
                    imageUrl={images[v.id] ?? null}
                    onUpload={handleUpload}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </TabsContent>

            {/* Tab: Urutan */}
            <TabsContent value="urutan" className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Drag baris untuk mengubah urutan tampil kendaraan di halaman Trucking.
                </p>
                {hasUnsavedOrder && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => saveOrderMut.mutate(orderedVehicles.map(v => v.id))}
                    disabled={saveOrderMut.isPending}
                  >
                    {saveOrderMut.isPending
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Menyimpan…</>
                      : <><Save className="w-3.5 h-3.5" /> Simpan Urutan</>
                    }
                  </Button>
                )}
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedVehicles.map(v => v.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="space-y-2">
                    {orderedVehicles.map((v, i) => (
                      <SortableVehicleRow
                        key={v.id}
                        vehicle={v}
                        index={i}
                        imageUrl={images[v.id]}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {!hasUnsavedOrder && savedOrder.length === 0 && (
                <p className="text-xs text-center text-slate-400 pt-2">
                  Urutan default — drag untuk mengubah, lalu klik Simpan.
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
