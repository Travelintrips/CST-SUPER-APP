import React, { useState } from "react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  );
}

function LoginScreen() {
  const { signInWithGoogle, devLogin } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isDev = import.meta.env.DEV;

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setErr(null);
    const { error } = await devLogin(email.trim());
    if (error) { setErr(error); setLoading(false); }
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 text-white">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold shadow-lg">
          B
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">BizPortal</h1>
        <p className="text-sm text-slate-400">Sistem ERP Internal B2B Marketplace and Logistic</p>
      </div>

      <button
        onClick={signInWithGoogle}
        className="flex items-center justify-center gap-3 rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-slate-800 shadow hover:bg-slate-100 active:scale-95 transition-all"
      >
        Masuk dengan Google
      </button>

      {isDev && (
        <div className="flex flex-col items-center gap-2 w-72">
          <div className="flex w-full items-center gap-2 text-xs text-slate-500">
            <div className="flex-1 h-px bg-slate-700" />
            <span>Dev Login</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>
          <form onSubmit={handleDevLogin} className="flex w-full gap-2">
            <input
              type="email"
              placeholder="email@domain.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="flex-1 rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {loading ? "..." : "Masuk"}
            </button>
          </form>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <p className="text-xs text-slate-600">Hanya tersedia di mode development</p>
        </div>
      )}
    </div>
  );
}

export function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useSupabaseAuth();
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <LoginScreen />;
  return <Component />;
}
