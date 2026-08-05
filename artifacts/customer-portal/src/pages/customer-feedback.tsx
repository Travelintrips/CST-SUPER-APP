import { useState, useEffect } from "react";
import { useParams } from "wouter";

type FeedbackData = {
  token: string;
  orderNumber: string | null;
  customerName: string | null;
  serviceType: string | null;
  completedAt: string | null;
  status: string;
  rating: number | null;
  feedback: string | null;
};

function Spinner() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
      <div className="h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Link Tidak Valid</h2>
        <p className="text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

function SuccessState({ orderNumber }: { orderNumber?: string | null }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-4xl mb-3">⭐</div>
        <h2 className="text-xl font-semibold text-slate-800 mb-2">Terima Kasih!</h2>
        {orderNumber && <p className="text-xs text-slate-400 mb-2">Ref: {orderNumber}</p>}
        <p className="text-sm text-slate-500">Feedback Anda sangat berarti bagi kami untuk terus meningkatkan kualitas layanan.</p>
      </div>
    </div>
  );
}

function AlreadySubmittedState({ rating }: { rating?: number | null }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-4">{"⭐".repeat(rating ?? 5)}</div>
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Feedback Sudah Dikirim</h2>
        <p className="text-sm text-slate-500">Anda sudah memberikan penilaian. Terima kasih atas feedback Anda!</p>
      </div>
    </div>
  );
}

const STAR_LABELS: Record<number, string> = {
  1: "Sangat Buruk 😞",
  2: "Buruk 😕",
  3: "Cukup 😐",
  4: "Baik 😊",
  5: "Sangat Baik 🤩",
};

export default function CustomerFeedbackPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<FeedbackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError("Token tidak ditemukan"); setLoading(false); return; }
    fetch(`/api/customer-feedback/${token}`)
      .then(async r => {
        const d = await r.json() as FeedbackData & { error?: string };
        if (!r.ok) throw new Error(d.error ?? "Terjadi kesalahan");
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    if (rating === 0) { setSubmitError("Pilih rating terlebih dahulu"); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/customer-feedback/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, feedback: feedback.trim() || null }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Gagal mengirim");
      setSubmitted(true);
    } catch (e: unknown) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} />;
  if (submitted) return <SuccessState orderNumber={data?.orderNumber} />;
  if (data?.status === "submitted") return <AlreadySubmittedState rating={data.rating} />;

  const activeRating = hovered || rating;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-4">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-11 h-11 bg-amber-500 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">⭐</div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Penilaian Layanan</h1>
              {data?.orderNumber && <p className="text-xs text-amber-600 font-medium mt-0.5">📦 Order: {data.orderNumber}</p>}
            </div>
          </div>
          {data?.customerName && (
            <p className="text-sm text-slate-600 mt-1">Untuk: <span className="font-medium">{data.customerName}</span></p>
          )}
          {data?.serviceType && (
            <p className="text-xs text-slate-400 mt-0.5">Jenis Layanan: {data.serviceType}</p>
          )}
        </div>

        {/* Status order */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3.5">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-semibold text-emerald-700">Order telah selesai</span>
          </div>
        </div>

        {/* Rating stars */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Berikan Penilaian Anda</p>
          <div className="flex justify-center gap-3 mb-4">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHovered(star)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(star)}
                className="text-5xl transition-transform hover:scale-110 focus:outline-none"
              >
                <span className={star <= activeRating ? "text-amber-400" : "text-slate-200"}>★</span>
              </button>
            ))}
          </div>
          {activeRating > 0 && (
            <p className="text-center text-sm font-medium text-amber-600 mb-2">{STAR_LABELS[activeRating]}</p>
          )}
        </div>

        {/* Feedback text */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Komentar / Saran (opsional)</p>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            rows={4}
            placeholder="Ceritakan pengalaman Anda menggunakan layanan kami..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
        </div>

        {submitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{submitError}</div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || rating === 0}
          className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Mengirim..." : "Kirim Penilaian"}
        </button>

        <p className="text-center text-xs text-slate-400 pb-4">Penilaian Anda bersifat anonim dan hanya digunakan untuk peningkatan layanan.</p>
      </div>
    </div>
  );
}
