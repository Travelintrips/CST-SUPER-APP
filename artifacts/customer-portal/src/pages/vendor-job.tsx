import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams } from "wouter";
import { resolveServiceCategory } from "@workspace/logistics-constants";

type LightboxItem = { url: string; title: string; subtitle?: string };

const SWIPE_THRESHOLD = 50;

function Lightbox({
  items, index, onNavigate, onClose,
}: {
  items: LightboxItem[];
  index: number;
  onNavigate: (i: number) => void;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const total = items.length;
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft"  && hasPrev) onNavigate(index - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(index + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNavigate, index, hasPrev, hasNext]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Abaikan jika gerakan lebih dominan vertikal (scroll)
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (dx < -SWIPE_THRESHOLD && hasNext) onNavigate(index + 1);
    if (dx >  SWIPE_THRESHOLD && hasPrev) onNavigate(index - 1);
  };

  if (!item) return null;
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Prev */}
      {hasPrev && (
        <button
          onClick={() => onNavigate(index - 1)}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white text-xl flex items-center justify-center transition"
          aria-label="Foto sebelumnya"
        >‹</button>
      )}
      {/* Next */}
      {hasNext && (
        <button
          onClick={() => onNavigate(index + 1)}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white text-xl flex items-center justify-center transition"
          aria-label="Foto berikutnya"
        >›</button>
      )}

      <div className="relative flex flex-col items-center gap-3 max-w-full">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-white/90 text-slate-800 text-lg font-bold leading-none flex items-center justify-center shadow-lg hover:bg-white"
          aria-label="Tutup"
        >×</button>

        <img
          key={item.url}
          src={item.url}
          alt={item.title}
          className="max-h-[78vh] max-w-[85vw] rounded-xl shadow-2xl object-contain"
        />

        <div className="text-center space-y-0.5">
          {total > 1 && (
            <p className="text-white/50 text-xs">{index + 1} / {total}</p>
          )}
          <p className="text-white text-sm font-semibold drop-shadow">{item.title}</p>
          {item.subtitle && (
            <p className="text-white/60 text-xs drop-shadow">{item.subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}

type ProgressEntry = {
  id: number;
  status: string;
  notes: string | null;
  photo_url: string | null;
  updated_by: string;
  is_public: boolean;
  created_at: string;
};

type OperationalDetails = {
  driverName?: string | null;
  driverPhone?: string | null;
  vehiclePlate?: string | null;
  vehicleType?: string | null;
  pickupTime?: string | null;
  carrier?: string | null;
  schedule?: string | null;
  etd?: string | null;
  eta?: string | null;
  awbBlNumber?: string | null;
  stockConfirmed?: string | null;
  deliverySchedule?: string | null;
  documentStatus?: string | null;
  notes?: string | null;
};

type JobData = {
  token: string;
  status: string;
  serviceType: string;
  vendorName: string | null;
  order: {
    orderNumber: string;
    shipmentType: string;
    origin: string;
    destination: string;
    commodity?: string | null;
    cargoDescription?: string | null;
    grossWeight?: string | null;
    requiredDate?: string | null;
    notes?: string | null;
    status: string;
  };
  operationalDetails: OperationalDetails;
  podFiles: { name: string; url: string; type: string; publicUrl?: string }[];
  completionNotes?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
  progress: ProgressEntry[];
};

const PROGRESS_OPTIONS = [
  { value: "Pickup Scheduled", label: "📅 Pickup Dijadwalkan" },
  { value: "In Progress", label: "🚛 Sedang Diproses / Dalam Perjalanan" },
  { value: "Completed", label: "✅ Selesai" },
  { value: "Problem", label: "⚠️ Ada Masalah / Perlu Perhatian" },
];

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value}</span>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition";
const textareaCls = "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition resize-none";

export default function VendorJobPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const lightboxItems = useMemo<LightboxItem[]>(() => {
    if (!data) return [];
    const podPhotos: LightboxItem[] = data.podFiles
      .filter(f => f.publicUrl)
      .map(f => ({ url: f.publicUrl!, title: f.name, subtitle: "Foto POD" }));
    const progressPhotos: LightboxItem[] = [...data.progress]
      .reverse()
      .filter(p => p.photo_url)
      .map(p => ({
        url: p.photo_url!,
        title: p.status,
        subtitle:
          new Date(p.created_at).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) +
          (p.notes ? ` · ${p.notes}` : ""),
      }));
    return [...podPhotos, ...progressPhotos];
  }, [data]);

  const lightboxIdxByUrl = useMemo(
    () => new Map(lightboxItems.map((item, i) => [item.url, i])),
    [lightboxItems],
  );

  // Accept form
  const [showAcceptForm, setShowAcceptForm] = useState(false);
  const [acceptValues, setAcceptValues] = useState<Record<string, string>>({});
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Reject
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // Progress update
  const [showProgressForm, setShowProgressForm] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [progressNotes, setProgressNotes] = useState("");
  const [progressPhoto, setProgressPhoto] = useState<File | null>(null);
  const [updatingProgress, setUpdatingProgress] = useState(false);

  // POD upload
  const [showPodForm, setShowPodForm] = useState(false);
  const [podFiles, setPodFiles] = useState<FileList | null>(null);
  const [podNotes, setPodNotes] = useState("");
  const [uploadingPod, setUploadingPod] = useState(false);
  const [podDone, setPodDone] = useState(false);

  const fetchData = useCallback(() => {
    if (!token) return;
    fetch(`/api/vendor-job/${token}`)
      .then(async r => {
        const d = await r.json() as JobData & { error?: string };
        if (!r.ok) throw new Error(d.error ?? "Terjadi kesalahan");
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    const category = resolveServiceCategory(data.serviceType);

    // Validate required fields by category
    const required: string[] = [];
    if (category === "trucking") {
      if (!acceptValues.driverName?.trim()) required.push("Nama Driver");
      if (!acceptValues.driverPhone?.trim()) required.push("No. HP Driver");
      if (!acceptValues.vehiclePlate?.trim()) required.push("Plat Nomor");
    } else if (category === "freight") {
      if (!acceptValues.carrier?.trim()) required.push("Carrier");
    }
    if (required.length) { setAcceptError(`Field wajib: ${required.join(", ")}`); return; }

    setAccepting(true); setAcceptError(null);
    try {
      const res = await fetch(`/api/vendor-job/${token}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(acceptValues),
      });
      const d = await res.json() as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) throw new Error(d.error ?? "Gagal");
      setShowAcceptForm(false);
      fetchData();
    } catch (e: unknown) {
      setAcceptError((e as Error).message);
    } finally {
      setAccepting(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await fetch(`/api/vendor-job/${token}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      setShowRejectForm(false);
      fetchData();
    } finally {
      setRejecting(false);
    }
  };

  const handleProgress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!progressStatus) return;
    setUpdatingProgress(true);
    try {
      const form = new FormData();
      form.append("status", progressStatus);
      if (progressNotes) form.append("notes", progressNotes);
      if (progressPhoto) form.append("photo", progressPhoto);
      await fetch(`/api/vendor-job/${token}/progress`, { method: "POST", body: form });
      setShowProgressForm(false);
      setProgressNotes(""); setProgressStatus(""); setProgressPhoto(null);
      fetchData();
    } finally {
      setUpdatingProgress(false);
    }
  };

  const handlePodUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!podFiles?.length) return;
    setUploadingPod(true);
    try {
      const form = new FormData();
      for (const f of podFiles) form.append("files", f);
      if (podNotes) form.append("completionNotes", podNotes);
      await fetch(`/api/vendor-job/${token}/pod`, { method: "POST", body: form });
      setPodDone(true);
      fetchData();
    } finally {
      setUploadingPod(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Memuat job order...</span>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Link Tidak Valid</h2>
        <p className="text-sm text-slate-500">{error}</p>
        <p className="text-xs text-slate-400 mt-3">Hubungi tim kami jika ada kendala.</p>
      </div>
    </div>
  );

  if (!data) return null;

  const category = resolveServiceCategory(data.serviceType);
  const isPending = data.status === "pending";
  const isAccepted = data.status === "accepted" || data.status === "in_progress" || data.status === "pickup_scheduled";
  const isCompleted = data.status === "completed";
  const isRejected = data.status === "rejected";
  const canUpdateProgress = isAccepted;
  const canUploadPod = isAccepted || data.status === "completed";

  const STATUS_LABEL: Record<string, { text: string; color: string }> = {
    pending:          { text: "⏳ Menunggu Respon", color: "bg-amber-50 border-amber-200 text-amber-800" },
    accepted:         { text: "✅ Diterima", color: "bg-green-50 border-green-200 text-green-800" },
    rejected:         { text: "❌ Ditolak", color: "bg-red-50 border-red-200 text-red-800" },
    in_progress:      { text: "🚛 Dalam Proses", color: "bg-blue-50 border-blue-200 text-blue-800" },
    pickup_scheduled: { text: "📅 Pickup Dijadwalkan", color: "bg-indigo-50 border-indigo-200 text-indigo-800" },
    completed:        { text: "🎉 Selesai", color: "bg-emerald-50 border-emerald-200 text-emerald-800" },
    problem:          { text: "⚠️ Ada Masalah", color: "bg-orange-50 border-orange-200 text-orange-800" },
  };

  const statusInfo = STATUS_LABEL[data.status] ?? { text: data.status, color: "bg-slate-50 border-slate-200 text-slate-700" };

  return (
    <>
    {lightboxIdx !== null && (
      <Lightbox
        items={lightboxItems}
        index={lightboxIdx}
        onNavigate={setLightboxIdx}
        onClose={() => setLightboxIdx(null)}
      />
    )}
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-50 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-start gap-3">
            <div className="text-3xl flex-shrink-0">🚚</div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-slate-800">Job Order Vendor</h1>
              {data.vendorName && <p className="text-sm text-slate-500 mt-0.5">Vendor: {data.vendorName}</p>}
            </div>
          </div>

          <div className={`mt-4 rounded-xl border px-4 py-2.5 text-sm font-semibold ${statusInfo.color}`}>
            {statusInfo.text}
          </div>

          <div className="mt-4 bg-slate-50 rounded-xl px-4 py-3 space-y-2">
            <InfoRow label="No. Order" value={<span className="font-mono">{data.order.orderNumber}</span>} />
            <InfoRow label="Layanan" value={data.order.shipmentType} />
            <InfoRow label="Rute" value={`${data.order.origin} → ${data.order.destination}`} />
            {data.order.commodity && <InfoRow label="Komoditi" value={data.order.commodity} />}
            {data.order.grossWeight && <InfoRow label="Berat" value={`${data.order.grossWeight} kg`} />}
            {data.order.requiredDate && <InfoRow label="Tanggal Dibutuhkan" value={data.order.requiredDate} />}
            {data.order.notes && <InfoRow label="Catatan" value={data.order.notes} />}
          </div>
        </div>

        {/* Pending: Accept / Reject buttons */}
        {isPending && !showAcceptForm && !showRejectForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
            <p className="text-sm text-slate-600 font-medium">Apakah Anda bersedia menerima job ini?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAcceptForm(true)}
                className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-sm transition-colors"
              >
                ✅ Terima Job
              </button>
              <button
                onClick={() => setShowRejectForm(true)}
                className="flex-1 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold py-3 text-sm transition-colors"
              >
                ❌ Tolak Job
              </button>
            </div>
          </div>
        )}

        {/* Reject form */}
        {showRejectForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-red-700">Konfirmasi Penolakan Job</h2>
            <FormField label="Alasan Penolakan (opsional)">
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Jelaskan alasan tidak bisa menerima job ini..."
                className={textareaCls}
              />
            </FormField>
            <div className="flex gap-3">
              <button onClick={() => setShowRejectForm(false)} className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-sm font-medium">
                Batal
              </button>
              <button
                onClick={handleReject}
                disabled={rejecting}
                className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-semibold py-2.5 text-sm transition-colors"
              >
                {rejecting ? "Mengirim..." : "Konfirmasi Tolak"}
              </button>
            </div>
          </div>
        )}

        {/* Accept form: fill operational details */}
        {showAcceptForm && (
          <form onSubmit={handleAccept} className="bg-white rounded-2xl shadow-sm border border-green-100 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-green-700 uppercase tracking-wide">
              ✅ Detail Operasional
            </h2>
            <p className="text-xs text-slate-500">Isi detail berikut untuk mengkonfirmasi penerimaan job.</p>

            {category === "trucking" && (<>
              <FormField label="Nama Driver" required><input type="text" className={inputCls} value={acceptValues.driverName ?? ""} onChange={e => setAcceptValues(p => ({...p, driverName: e.target.value}))} placeholder="Nama lengkap driver" /></FormField>
              <FormField label="No. HP Driver" required><input type="text" className={inputCls} value={acceptValues.driverPhone ?? ""} onChange={e => setAcceptValues(p => ({...p, driverPhone: e.target.value}))} placeholder="0812xxxx" /></FormField>
              <FormField label="Plat Nomor Kendaraan" required><input type="text" className={inputCls} value={acceptValues.vehiclePlate ?? ""} onChange={e => setAcceptValues(p => ({...p, vehiclePlate: e.target.value}))} placeholder="B 1234 XYZ" /></FormField>
              <FormField label="Jenis Kendaraan"><input type="text" className={inputCls} value={acceptValues.vehicleType ?? ""} onChange={e => setAcceptValues(p => ({...p, vehicleType: e.target.value}))} placeholder="CDE / Fuso / Engkel" /></FormField>
              <FormField label="Waktu Pickup"><input type="datetime-local" className={inputCls} value={acceptValues.pickupTime ?? ""} onChange={e => setAcceptValues(p => ({...p, pickupTime: e.target.value}))} /></FormField>
            </>)}

            {category === "freight" && (<>
              <FormField label="Carrier / Maskapai" required><input type="text" className={inputCls} value={acceptValues.carrier ?? ""} onChange={e => setAcceptValues(p => ({...p, carrier: e.target.value}))} placeholder="Garuda Cargo, Salam Pacific, dll." /></FormField>
              <FormField label="Jadwal Keberangkatan"><input type="text" className={inputCls} value={acceptValues.schedule ?? ""} onChange={e => setAcceptValues(p => ({...p, schedule: e.target.value}))} placeholder="Nomor flight/voyage, jadwal" /></FormField>
              <FormField label="ETD (Estimasi Keberangkatan)"><input type="datetime-local" className={inputCls} value={acceptValues.etd ?? ""} onChange={e => setAcceptValues(p => ({...p, etd: e.target.value}))} /></FormField>
              <FormField label="ETA (Estimasi Tiba)"><input type="datetime-local" className={inputCls} value={acceptValues.eta ?? ""} onChange={e => setAcceptValues(p => ({...p, eta: e.target.value}))} /></FormField>
              <FormField label="AWB / BL Number"><input type="text" className={inputCls} value={acceptValues.awbBlNumber ?? ""} onChange={e => setAcceptValues(p => ({...p, awbBlNumber: e.target.value}))} placeholder="Nomor dokumen pengiriman" /></FormField>
            </>)}

            {category === "product" && (<>
              <FormField label="Konfirmasi Stok" required><input type="text" className={inputCls} value={acceptValues.stockConfirmed ?? ""} onChange={e => setAcceptValues(p => ({...p, stockConfirmed: e.target.value}))} placeholder="Stok tersedia / jumlah" /></FormField>
              <FormField label="Jadwal Pengiriman"><input type="text" className={inputCls} value={acceptValues.deliverySchedule ?? ""} onChange={e => setAcceptValues(p => ({...p, deliverySchedule: e.target.value}))} placeholder="Estimasi tanggal pengiriman" /></FormField>
            </>)}

            {category === "customs" && (<>
              <FormField label="Status Dokumen"><input type="text" className={inputCls} value={acceptValues.documentStatus ?? ""} onChange={e => setAcceptValues(p => ({...p, documentStatus: e.target.value}))} placeholder="PIB sudah diserahkan, menunggu pemeriksaan..." /></FormField>
            </>)}

            <FormField label="Catatan Tambahan">
              <textarea rows={3} className={textareaCls} value={acceptValues.notes ?? ""} onChange={e => setAcceptValues(p => ({...p, notes: e.target.value}))} placeholder="Instruksi khusus, kendala, dll." />
            </FormField>

            {acceptError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">{acceptError}</p>}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setShowAcceptForm(false)} className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-3 text-sm font-medium">
                Batal
              </button>
              <button type="submit" disabled={accepting} className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-3 text-sm transition-colors">
                {accepting ? "Memproses..." : "✅ Konfirmasi Terima Job"}
              </button>
            </div>
          </form>
        )}

        {/* Rejected state */}
        {isRejected && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
            <div className="text-3xl mb-2">❌</div>
            <p className="text-sm font-semibold text-red-700">Job ini telah ditolak.</p>
            {data.rejectReason && <p className="text-xs text-red-500 mt-1">Alasan: {data.rejectReason}</p>}
            <p className="text-xs text-slate-500 mt-2">Admin akan segera menindaklanjuti.</p>
          <p className="text-xs text-slate-400 mt-1">Hubungi tim kami jika ada kendala.</p>
          </div>
        )}

        {/* Accepted: show operational details */}
        {(isAccepted || isCompleted) && data.operationalDetails && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">📋 Detail Operasional</h2>
            <div className="space-y-2">
              <InfoRow label="Driver" value={data.operationalDetails.driverName} />
              <InfoRow label="HP Driver" value={data.operationalDetails.driverPhone} />
              <InfoRow label="Plat Kendaraan" value={data.operationalDetails.vehiclePlate} />
              <InfoRow label="Jenis Kendaraan" value={data.operationalDetails.vehicleType} />
              <InfoRow label="Waktu Pickup" value={data.operationalDetails.pickupTime} />
              <InfoRow label="Carrier" value={data.operationalDetails.carrier} />
              <InfoRow label="Jadwal" value={data.operationalDetails.schedule} />
              <InfoRow label="ETD" value={data.operationalDetails.etd} />
              <InfoRow label="ETA" value={data.operationalDetails.eta} />
              <InfoRow label="AWB / BL" value={data.operationalDetails.awbBlNumber} />
              <InfoRow label="Stok" value={data.operationalDetails.stockConfirmed} />
              <InfoRow label="Jadwal Kirim" value={data.operationalDetails.deliverySchedule} />
              <InfoRow label="Status Dokumen" value={data.operationalDetails.documentStatus} />
              <InfoRow label="Catatan" value={data.operationalDetails.notes} />
            </div>
          </div>
        )}

        {/* Progress update */}
        {canUpdateProgress && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">📍 Update Progress</h2>
              {!showProgressForm && (
                <button onClick={() => setShowProgressForm(true)} className="text-sm text-blue-600 font-medium hover:underline">
                  + Update
                </button>
              )}
            </div>
            {showProgressForm && (
              <form onSubmit={handleProgress} className="space-y-3">
                <FormField label="Status Terbaru" required>
                  <select
                    className={inputCls}
                    value={progressStatus}
                    onChange={e => setProgressStatus(e.target.value)}
                    required
                  >
                    <option value="">Pilih status...</option>
                    {PROGRESS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Keterangan">
                  <textarea rows={2} className={textareaCls} value={progressNotes} onChange={e => setProgressNotes(e.target.value)} placeholder="Informasi tambahan..." />
                </FormField>
                <FormField label="Foto (opsional)">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                    onChange={e => setProgressPhoto(e.target.files?.[0] ?? null)}
                  />
                  {progressPhoto && (
                    <p className="text-xs text-slate-500 mt-1">📷 {progressPhoto.name}</p>
                  )}
                </FormField>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowProgressForm(false)} className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-sm">Batal</button>
                  <button type="submit" disabled={updatingProgress} className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 text-sm">
                    {updatingProgress ? "Menyimpan..." : "Kirim Update"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* POD upload */}
        {canUploadPod && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">📎 Upload POD / Dokumen</h2>
              {!showPodForm && !podDone && (
                <button onClick={() => setShowPodForm(true)} className="text-sm text-emerald-600 font-medium hover:underline">
                  Upload
                </button>
              )}
            </div>
            {data.podFiles.length > 0 && (
              <div className="space-y-2">
                {/* Thumbnail grid untuk file gambar */}
                {data.podFiles.some(f => f.publicUrl) && (
                  <div className="flex flex-wrap gap-2">
                    {data.podFiles.filter(f => f.publicUrl).map((f, i) => (
                      <button key={i} type="button" onClick={() => { const idx = lightboxIdxByUrl.get(f.publicUrl!); if (idx !== undefined) setLightboxIdx(idx); }} className="focus:outline-none">
                        <img
                          src={f.publicUrl}
                          alt={f.name}
                          className="w-20 h-20 object-cover rounded-lg border border-slate-200 shadow-sm hover:opacity-80 transition-opacity cursor-zoom-in"
                        />
                      </button>
                    ))}
                  </div>
                )}
                {/* Daftar semua file */}
                {data.podFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                    <span>{f.type?.startsWith("image/") ? "🖼" : "📄"}</span>
                    <span>{f.name}</span>
                  </div>
                ))}
              </div>
            )}
            {podDone && (
              <p className="text-sm text-emerald-600 font-medium">✅ Dokumen berhasil diunggah. Menunggu konfirmasi admin.</p>
            )}
            {showPodForm && !podDone && (
              <form onSubmit={handlePodUpload} className="space-y-3">
                <FormField label="File (POD, Invoice, Foto)" required>
                  <input type="file" multiple accept="image/*,application/pdf" onChange={e => setPodFiles(e.target.files)}
                    className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium cursor-pointer" />
                </FormField>
                <FormField label="Catatan Penyelesaian">
                  <textarea rows={2} className={textareaCls} value={podNotes} onChange={e => setPodNotes(e.target.value)} placeholder="Catatan akhir, kendala, dll." />
                </FormField>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowPodForm(false)} className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-sm">Batal</button>
                  <button type="submit" disabled={uploadingPod || !podFiles?.length} className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold py-2.5 text-sm">
                    {uploadingPod ? "Mengunggah..." : "Upload Dokumen"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Progress timeline */}
        {data.progress.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4">📅 Riwayat Progress</h2>
            <div className="relative pl-5">
              <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-slate-100" />
              <div className="space-y-4">
                {[...data.progress].reverse().map((p, i) => (
                  <div key={p.id} className="relative text-sm">
                    <div className={`absolute -left-[15px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${i === 0 ? "bg-blue-500" : "bg-slate-300"}`} />
                    <p className="font-semibold text-slate-800">{p.status}</p>
                    {p.notes && <p className="text-slate-600 text-xs mt-0.5">{p.notes}</p>}
                    {p.photo_url && (
                      <button type="button" onClick={() => { const idx = lightboxIdxByUrl.get(p.photo_url!); if (idx !== undefined) setLightboxIdx(idx); }} className="inline-block mt-1 focus:outline-none">
                        <img
                          src={p.photo_url}
                          alt="Foto progress"
                          className="w-28 h-28 object-cover rounded-lg border border-slate-200 shadow-sm hover:opacity-80 transition-opacity cursor-zoom-in"
                        />
                      </button>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(p.created_at).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {" · "}{p.updated_by === "admin" ? "Admin" : "Vendor"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 pb-4">Vendor Job Order</p>
      </div>
    </div>
    </>
  );
}
