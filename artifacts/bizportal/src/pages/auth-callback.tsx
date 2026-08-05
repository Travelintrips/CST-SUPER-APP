import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function getBase(): string {
  return (window as unknown as Record<string, string>).__BASE_PATH__ || import.meta.env.BASE_URL || "/bizportal/";
}

/**
 * Halaman callback OAuth Supabase untuk BizPortal.
 * Menangani dua mode:
 * - Popup mode (Replit/iframe): postMessage access_token ke parent, lalu window.close()
 * - Redirect mode (production): exchange token langsung ke /api/auth/supabase-exchange, lalu redirect ke home
 */
export default function AuthCallbackPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    if (!supabase) {
      setStatus("error");
      try { window.opener?.postMessage("auth:error", "*"); } catch {}
      return;
    }

    const isPopup = !!window.opener;
    let done = false;

    async function handleToken(accessToken: string) {
      if (done) return;
      done = true;

      if (isPopup) {
        // Popup mode: kirim ke parent window, tutup popup
        try {
          window.opener?.postMessage({ type: "supabase-auth", access_token: accessToken }, "*");
        } catch {}
        setStatus("success");
        setTimeout(() => window.close(), 500);
      } else {
        // Redirect mode: exchange token langsung, redirect ke home
        try {
          const res = await fetch("/api/auth/supabase-exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ access_token: accessToken }),
          });
          if (res.ok) {
            setStatus("success");
            const base = getBase();
            setTimeout(() => { window.location.replace(base); }, 300);
          } else {
            setStatus("error");
            setTimeout(() => { window.location.replace(getBase()); }, 1500);
          }
        } catch {
          setStatus("error");
          setTimeout(() => { window.location.replace(getBase()); }, 1500);
        }
      }
    }

    function handleError() {
      if (done) return;
      done = true;
      if (isPopup) {
        try { window.opener?.postMessage("auth:error", "*"); } catch {}
        setStatus("error");
        setTimeout(() => window.close(), 1000);
      } else {
        setStatus("error");
        setTimeout(() => { window.location.replace(getBase()); }, 1500);
      }
    }

    // Cek session yang mungkin sudah ter-detect otomatis dari hash URL (implicit flow)
    supabase!.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        handleToken(session.access_token);
        return;
      }

      // Fallback: tunggu event SIGNED_IN dari Supabase (implicit flow parse hash async)
      const { data: { subscription } } = supabase!.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session?.access_token) {
          handleToken(session.access_token);
          subscription.unsubscribe();
        }
      });

      // Timeout 15 detik
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        handleError();
      }, 15_000);

      return () => {
        subscription.unsubscribe();
        clearTimeout(timeout);
      };
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        {status === "loading" && (
          <>
            <div className="h-7 w-7 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Memproses login Google...</p>
          </>
        )}
        {status === "success" && (
          <p className="text-sm text-green-600">Login berhasil. Mengalihkan...</p>
        )}
        {status === "error" && (
          <p className="text-sm text-destructive">Login gagal. Tutup tab ini dan coba lagi.</p>
        )}
      </div>
    </div>
  );
}
