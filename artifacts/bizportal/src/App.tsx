import React from "react";
import { Router as WouterRouter, Switch, Route, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupabaseAuthProvider, useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { AppRoutes } from "@/routes";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OrderNotificationsProvider } from "@/contexts/OrderNotificationsContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";





const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const ROLE_CACHE_KEY = "biz_user_role_v1";
function readRoleCache() {
  try {
    return sessionStorage.getItem(ROLE_CACHE_KEY);
  } catch {
    return null;
  }
}
function writeRoleCache(role: string | null) {
  try {
    if (role) sessionStorage.setItem(ROLE_CACHE_KEY, role);
    else sessionStorage.removeItem(ROLE_CACHE_KEY);
  } catch {}
}

function roleToPath(role?: string | null) {
  switch (role) {
    case "admin":
      return "/dashboard";
    case "ecommerce":
      return "/ecommerce";
    case "trading":
      return "/trading";
    case "logistics":
      return "/logistics";
    default:
      return "/welcome";
  }
}
function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  );
}

const IS_DEV = import.meta.env.DEV;

type DevUser = { id: string; email: string; firstName: string | null; lastName: string | null; role: string | null };

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  ecommerce: "Ecommerce",
  trading: "Trading",
  logistics: "Logistics",
};

function DevLoginSection() {
  const [users, setUsers] = React.useState<DevUser[]>([]);
  const [devEmail, setDevEmail] = React.useState("");
  const [mode, setMode] = React.useState<"pick" | "manual">("pick");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/dev-users", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((d: { users: DevUser[] }) => {
        setUsers(d.users ?? []);
        if (d.users?.length > 0) {
          setDevEmail(d.users[0].email ?? "");
        }
      })
      .catch(() => setMode("manual"));
  }, []);

  const grouped = React.useMemo(() => {
    const map: Record<string, DevUser[]> = {};
    for (const u of users) {
      const r = u.role ?? "other";
      if (!map[r]) map[r] = [];
      map[r].push(u);
    }
    return map;
  }, [users]);

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!devEmail || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev-login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `email=${encodeURIComponent(devEmail)}`,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Login gagal (${res.status})`);
        return;
      }
      window.location.href = "/bizportal/";
    } catch (err) {
      setError("Gagal terhubung ke server. Pastikan API Server berjalan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-xs text-amber-400 font-mono">DEV ONLY</span>
        <div className="flex-1 h-px bg-slate-700" />
      </div>
      <form onSubmit={handleDevLogin} className="flex flex-col gap-2">
        {mode === "pick" && users.length > 0 ? (
          <>
            <select
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              className="rounded-lg bg-slate-800 border border-amber-600/40 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
            >
              {Object.entries(grouped).map(([role, roleUsers]) => (
                <optgroup key={role} label={`— ${ROLE_LABELS[role] ?? role} —`}>
                  {roleUsers.map((u) => {
                    const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
                    return (
                      <option key={u.id} value={u.email ?? ""}>
                        {name} ({u.email})
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className="text-xs text-slate-500 hover:text-slate-400 text-right -mt-1"
            >
              + email lain
            </button>
          </>
        ) : (
          <>
            <input
              type="email"
              placeholder="Email (dev bypass)"
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              required
              className="rounded-lg bg-slate-800 border border-amber-600/40 px-4 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {users.length > 0 && (
              <button
                type="button"
                onClick={() => { setMode("pick"); setDevEmail(users[0].email ?? ""); }}
                className="text-xs text-slate-500 hover:text-slate-400 text-right -mt-1"
              >
                ← pilih dari daftar
              </button>
            )}
          </>
        )}
        {error && (
          <p className="text-xs text-red-400 text-center">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-600 px-6 py-2.5 text-sm font-medium text-white shadow hover:bg-amber-500 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Logging in…" : "Dev Login (tanpa Google)"}
        </button>
      </form>
    </>
  );
}

function WaLoginSection() {
  const { loginWithWA } = useSupabaseAuth();
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [otpSent, setOtpSent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [countdown, setCountdown] = React.useState(0);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function sendOtp() {
    if (!phone || loading) return;
    setLoading(true);
    setError(null);
    setDevCode(null);
    try {
      const res = await fetch("/api/auth/wa-otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; _dev_code?: string };
      if (!res.ok) { setError(data.message ?? "Gagal mengirim OTP"); return; }
      setOtpSent(true);
      setCountdown(60);
      if (data._dev_code) setDevCode(data._dev_code);
    } catch {
      setError("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!code || loading) return;
    setLoading(true);
    setError(null);
    const result = await loginWithWA(phone, code);
    if (result.error) { setError(result.error); setLoading(false); return; }
    window.location.href = "/bizportal/";
  }

  return (
    <div className="flex flex-col gap-3">
      {!otpSent ? (
        <div className="flex gap-2">
          <input
            type="tel"
            placeholder="No. WhatsApp (cth: 08123456789)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={sendOtp}
            disabled={loading || !phone}
            className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-500 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? "..." : "Kirim OTP"}
          </button>
        </div>
      ) : (
        <form onSubmit={verifyOtp} className="flex flex-col gap-2">
          <p className="text-xs text-slate-400 text-center">
            Kode OTP dikirim ke WhatsApp <span className="text-white font-mono">{phone}</span>
          </p>
          {devCode && (
            <p className="text-xs text-amber-400 text-center font-mono bg-amber-900/20 rounded p-1">
              DEV: kode = {devCode}
            </p>
          )}
          <input
            type="text"
            inputMode="numeric"
            placeholder="Masukkan 6 digit kode OTP"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            maxLength={6}
            autoFocus
            className="rounded-lg bg-slate-800 border border-green-600/40 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500 text-center tracking-widest font-mono text-lg"
          />
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="rounded-lg bg-green-600 px-6 py-2.5 text-sm font-medium text-white shadow hover:bg-green-500 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? "Memverifikasi..." : "Masuk"}
          </button>
          <div className="flex justify-between text-xs text-slate-500">
            <button type="button" onClick={() => { setOtpSent(false); setCode(""); setError(null); }} className="hover:text-slate-300">
              ← Ganti nomor
            </button>
            {countdown > 0 ? (
              <span>Kirim ulang ({countdown}s)</span>
            ) : (
              <button type="button" onClick={sendOtp} disabled={loading} className="hover:text-slate-300">
                Kirim ulang OTP
              </button>
            )}
          </div>
        </form>
      )}
      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </div>
  );
}

function EmailPasswordLoginSection() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/email-login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Login gagal"); setLoading(false); return; }
      window.location.href = "/bizportal/";
    } catch {
      setError("Tidak dapat terhubung ke server");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
      <button
        type="submit"
        disabled={loading || !email || !password}
        className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow hover:bg-indigo-500 active:scale-95 transition-all disabled:opacity-50"
      >
        {loading ? "Masuk..." : "Masuk dengan Email"}
      </button>
    </form>
  );
}

function LoginScreen() {
  const { signInWithGoogle } = useSupabaseAuth();
  const [loginMode, setLoginMode] = React.useState<"email" | "wa" | "google">("email");

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 text-white">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold shadow-lg">
          B
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">BizPortal</h1>
        <p className="text-sm text-slate-400">
          Sistem ERP Internal B2B Marketplace and Logistic
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg bg-slate-800 p-1 gap-1 w-72">
        <button
          onClick={() => setLoginMode("email")}
          className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${loginMode === "email" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
        >
          ✉️ Email
        </button>
        <button
          onClick={() => setLoginMode("wa")}
          className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${loginMode === "wa" ? "bg-green-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
        >
          📱 WhatsApp
        </button>
        <button
          onClick={() => setLoginMode("google")}
          className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${loginMode === "google" ? "bg-white text-slate-800 shadow" : "text-slate-400 hover:text-white"}`}
        >
          Google
        </button>
      </div>

      <div className="flex flex-col gap-3 w-72">
        {loginMode === "email" ? (
          <EmailPasswordLoginSection />
        ) : loginMode === "wa" ? (
          <WaLoginSection />
        ) : (
          <button
            onClick={signInWithGoogle}
            className="flex items-center justify-center gap-3 rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-slate-800 shadow hover:bg-slate-100 active:scale-95 transition-all"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Masuk dengan Google
          </button>
        )}
        {IS_DEV && <DevLoginSection />}
      </div>
    </div>
  );
}

function AuthRouteGuard() {
  const { isAuthenticated, isLoading } = useSupabaseAuth();
  const cachedRole = readRoleCache();
  const { data: dbUser, isLoading: dbLoading } = useGetCurrentUser({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetCurrentUserQueryKey(),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  });
  React.useEffect(() => {
    if (dbUser?.role) writeRoleCache(dbUser.role);
  }, [dbUser?.role]);
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) {
    writeRoleCache(null);
    return <LoginScreen />;
  }
  if (dbLoading) return <LoadingSpinner />;
  return <Redirect to={roleToPath(dbUser?.role ?? cachedRole)} />;
}

function Router() {
  return (
    <WouterRouter base={basePath}>
      <AppRoutes rootGuard={AuthRouteGuard} />
    </WouterRouter>
  );
}

export default function App() {
  return (
    <ErrorBoundary label="App">
      <QueryClientProvider client={queryClient}>
        <SupabaseAuthProvider>
          <LanguageProvider>
            <CompanyProvider>
            <OrderNotificationsProvider>
              <TooltipProvider>
                <Router />
                <Toaster />
              </TooltipProvider>
            </OrderNotificationsProvider>
            </CompanyProvider>
          </LanguageProvider>
        </SupabaseAuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
