import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabaseClient";

interface AuthContextValue {
  session: { user: AuthUser } | null;
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
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
  const [isLoading, setIsLoading] = useState(!cached);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (res.status >= 500) return;
      if (!res.ok) { setUser(null); writeCache(null); return; }
      const data = await res.json() as { user: AuthUser | null };
      const u = data.user ?? null;
      setUser(u);
      writeCache(u);
    } catch {
      // keep existing cache
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchUser(); }, [fetchUser]);

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
