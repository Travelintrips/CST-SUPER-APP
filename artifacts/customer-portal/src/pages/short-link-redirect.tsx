import { useEffect, useState } from "react";
import { useParams } from "wouter";

export default function ShortLinkRedirect() {
  const { code } = useParams<{ code: string }>();
  const [status, setStatus] = useState<"loading" | "expired" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    fetch(`/api/q/${code}`)
      .then(async (r) => {
        if (r.redirected) {
          window.location.replace(r.url);
          return;
        }
        const data = await r.json().catch(() => null);
        if (r.status === 410 || data?.isExpired) {
          setStatus("expired");
          return;
        }
        if (!r.ok) {
          setErrorMsg(data?.error ?? "Link tidak ditemukan atau sudah kedaluwarsa.");
          setStatus("error");
          return;
        }
        if (data?.targetUrl) {
          window.location.replace(data.targetUrl);
        } else {
          setErrorMsg("Link tidak valid.");
          setStatus("error");
        }
      })
      .catch(() => {
        setErrorMsg("Terjadi kesalahan jaringan.");
        setStatus("error");
      });
  }, [code]);

  if (status === "expired") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">⏰</div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Link Sudah Kadaluarsa</h2>
          <p className="text-sm text-slate-500">
            Link ini sudah tidak aktif. Admin akan menerima link baru secara otomatis via WhatsApp.
          </p>
          <p className="text-xs text-slate-400 mt-3">
            Hubungi tim kami jika membutuhkan bantuan.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Link Tidak Valid</h2>
          <p className="text-sm text-slate-500">{errorMsg}</p>
          <p className="text-xs text-slate-400 mt-3">
            Hubungi tim kami untuk mendapatkan link baru.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Mengalihkan…</span>
      </div>
    </div>
  );
}
