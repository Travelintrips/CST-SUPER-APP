import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { AuthUser } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabaseClient";

interface AuthContextValue {
  session: { user: AuthUser } | null;
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** The API process can accept requests even while background migrations run. */
  isApiAvailable: boolean;
  isApiReady: boolean;
  apiReadinessError: string | null;
  retryApiReadiness: () => void;
  signInWithGoogle: () => void;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  devLogin: (email: string) => Promise<{ error: string | null }>;
  loginWithWA: (phone: string, code: string) => Promise<{ error: string | null }>;
  signOut: () => void;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const CACHE_KEY = "biz_auth_user_v1";
const IS_DEV = import.meta.env.DEV;
const READINESS_POLL_INTERVAL_MS = 2_000;
const LIVENESS_REQUEST_TIMEOUT_MS = 5_000;
const READINESS_REQUEST_TIMEOUT_MS = 5_000;

function readCache(): AuthUser | null {
  try {
    const v = sessionStorage.getItem(CACHE_KEY);
    return v ? (JSON.parse(v) as AuthUser) : null;
  } catch { return null; }
}

function writeCache(u: AuthUser | null) {
  try {
    if (u) sessionStorage.setItem(CACHE_KEY, JSON.stringify(u));
    else sessionStorage.removeItem(CACHE_KEY);
  } catch {}
}

function getBase(): string {
  return (window as unknown as Record<string, string>).__BASE_PATH__ || import.meta.env.BASE_URL || "/bizportal/";
}

function getOrigin(): string {
  return window.location.origin;
}

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const cached = readCache();
  const [user, setUser] = useState<AuthUser | null>(cached);
  const [isLoading, setIsLoading] = useState(IS_DEV || !cached);
  const [isApiAvailable, setIsApiAvailable] = useState(!IS_DEV);
  const [isApiReady, setIsApiReady] = useState(!IS_DEV);
  const [apiReadinessError, setApiReadinessError] = useState<string | null>(null);
  const [readinessRetryKey, setReadinessRetryKey] = useState(0);
  const apiHasBeenReadyRef = useRef(false);

  useEffect(() => {
    // Production keeps the existing auth path: it does not wait on the
    // development cold-start readiness contract.
    if (!IS_DEV) return;

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      let liveOk = false;
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(
          () => controller.abort(),
          LIVENESS_REQUEST_TIMEOUT_MS,
        );
        const res = await fetch("/api/health/live", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        liveOk = res.ok;
        window.clearTimeout(timeout);
      } catch {
        liveOk = false;
      }

      if (cancelled) return;
      setIsApiAvailable(liveOk);

      if (!liveOk) {
        // Do not unmount an already usable portal because one proxied probe
        // timed out. API-backed queries can report their own errors while the
        // next health probe retries in the background.
        if (apiHasBeenReadyRef.current) {
          setIsApiAvailable(true);
          setIsApiReady(true);
          setApiReadinessError(null);
        } else {
          setIsApiAvailable(false);
          setIsApiReady(false);
          setApiReadinessError("API belum dapat dijangkau. Akan mencoba lagi otomatis.");
        }
      } else {
        try {
          const controller = new AbortController();
          const timeout = window.setTimeout(
            () => controller.abort(),
            READINESS_REQUEST_TIMEOUT_MS,
          );
          const res = await fetch("/api/health/ready", {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          const data = await res.json().catch(() => null) as { ready?: boolean } | null;
          window.clearTimeout(timeout);

          if (cancelled) return;
          setIsApiAvailable(true);
          if (data?.ready === true) {
            apiHasBeenReadyRef.current = true;
            setIsApiReady(true);
            setApiReadinessError(null);
          } else {
            setIsApiReady(false);
            setApiReadinessError(null);
          }
        } catch {
          if (cancelled) return;
          // Liveness succeeded, so a slow/blocked readiness probe is not an
          // unavailable API. Keep the distinction visible to the user.
          setIsApiAvailable(true);
          if (apiHasBeenReadyRef.current) {
            setIsApiReady(true);
            setApiReadinessError(null);
          } else {
            setIsApiReady(false);
            setApiReadinessError("API hidup, tetapi persiapan database masih berjalan. Akan mencoba lagi otomatis.");
          }
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), READINESS_POLL_INTERVAL_MS);
      }
    };

    setIsApiReady(false);
    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [readinessRetryKey]);

  const retryApiReadiness = useCallback(() => {
    setApiReadinessError(null);
    setReadinessRetryKey((key) => key + 1);
  }, []);

  const fetchUser = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch("/api/auth/user", {
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status >= 500) return;
      if (!res.ok) { setUser(null); writeCache(null); return; }
      const data = await res.json() as { user: AuthUser | null };
      const u = data.user ?? null;
      setUser(u);
      writeCache(u);
    } catch {
      // keep existing cache
    } finally {
      window.clearTimeout(timeout);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const exchangeToken = useCallback(async (access_token: string) => {
    try {
      const res = await fetch("/api/auth/supabase-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ access_token }),
      });
      if (res.ok) {
        const data = await res.json() as { user: AuthUser };
        if (data.user) { writeCache(data.user); setUser(data.user); }
      } else {
        await fetchUser();
      }
    } catch {
      await fetchUser();
    }
  }, [fetchUser]);

  const signInWithGoogle = useCallback(() => {
    const origin = getOrigin();
    const base = getBase();
    const returnTo = encodeURIComponent(base);
    const loginUrl = `${origin}/api/login/google?returnTo=${returnTo}`;

    const isInIframe = window !== window.top;
    if (isInIframe) {
      // Dalam iframe (Replit preview): buka di tab baru, poll sampai session terbentuk
      const authWindow = window.open(loginUrl, "_blank", "noopener");
      if (authWindow) {
        const poll = setInterval(() => {
          fetch("/api/auth/user", { credentials: "include" })
            .then((r) => r.json())
            .then((data: { user: AuthUser | null }) => {
              if (data.user) {
                clearInterval(poll);
                writeCache(data.user);
                setUser(data.user);
              }
            })
            .catch(() => {});
          if (authWindow.closed) clearInterval(poll);
        }, 2000);
        setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
      } else {
        window.location.href = loginUrl;
      }
    } else {
      window.location.href = loginUrl;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.access_token) {
        await exchangeToken(session.access_token);
      }
    });
    return () => subscription.unsubscribe();
  }, [exchangeToken]);

  const signInWithEmail = useCallback(async (_email: string, _password: string) => {
    return { error: "Email login tidak didukung. Gunakan Google login." };
  }, []);

  const devLogin = useCallback(async (email: string) => {
    try {
      const res = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json() as { user?: AuthUser; error?: string };
      if (!res.ok) return { error: data.error ?? "Login gagal" };
      if (data.user) { writeCache(data.user); setUser(data.user); }
      return { error: null };
    } catch {
      return { error: "Koneksi ke server gagal" };
    }
  }, []);

  const loginWithWA = useCallback(async (phone: string, code: string) => {
    try {
      const res = await fetch("/api/auth/wa-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json() as { ok?: boolean; user?: AuthUser; message?: string };
      if (!res.ok) return { error: data.message ?? "Verifikasi gagal" };
      if (data.user) { writeCache(data.user); setUser(data.user); }
      else await fetchUser();
      return { error: null };
    } catch {
      return { error: "Koneksi ke server gagal" };
    }
  }, [fetchUser]);

  const signOut = useCallback(() => {
    writeCache(null);
    setUser(null);
    if (supabase) supabase.auth.signOut().catch(() => {});
    const base = getBase();
    window.location.href = `${getOrigin()}/api/logout?redirect=${encodeURIComponent(base)}`;
  }, []);

  const value: AuthContextValue = {
    session: user ? { user } : null,
    user,
    isLoading,
    isAuthenticated: !!user,
    isApiAvailable,
    isApiReady,
    apiReadinessError,
    retryApiReadiness,
    signInWithGoogle,
    signInWithEmail,
    devLogin,
    loginWithWA,
    signOut,
    login: signInWithGoogle,
    logout: signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSupabaseAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useSupabaseAuth must be used within SupabaseAuthProvider");
  return ctx;
}
