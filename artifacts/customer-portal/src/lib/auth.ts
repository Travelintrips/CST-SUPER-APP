/**
 * auth.ts — Customer Portal authentication utilities.
 *
 * C1-REMEDIATION (dual-mode migration):
 *   - New logins: token is stored as HttpOnly cookie (portal_session) set by the server.
 *     Frontend does NOT write the token to localStorage for new logins.
 *   - Existing sessions: localStorage token (portal_token / portal_dev_token) is still
 *     accepted via Bearer header for backward compatibility.
 *   - All API calls include `credentials: 'include'` so the browser sends the session cookie.
 *   - `isAuthenticated()` checks localStorage token (legacy) OR the non-httponly hint
 *     cookie `portal_session_hint=1` (new cookie-based sessions).
 *   - Legacy Bearer path will be removed after 2026-12-31 or next major release.
 *   - Profile cache (portal_profile) is UI-only; it is NOT the source of authorization.
 *
 * Trusted device (phone OTP remember-me) is still stored in localStorage because it
 * is a separate low-privilege token used only as a login shortcut, not for API auth.
 */
import { supabase } from "./supabase";

export const TOKEN_KEY       = "portal_token";
const PROFILE_KEY            = "portal_profile";
const DEV_TOKEN_KEY          = "portal_dev_token";
export const TRUSTED_DEVICE_KEY = "cst_trusted_device";
export const REMEMBER_DAYS   = 30;

interface PortalProfile {
  customerId: number;
  role: string;
  name: string;
  email: string;
}

interface TrustedDeviceData {
  phone: string;
  deviceToken: string;
  expiresAt: number;
}

// ── Trusted device helpers ────────────────────────────────────────────────────
// Trusted device token is a low-privilege phone-login shortcut, NOT an API auth token.

export function saveTrustedDevice(phone: string, deviceToken: string): void {
  const data: TrustedDeviceData = {
    phone,
    deviceToken,
    expiresAt: Date.now() + REMEMBER_DAYS * 86400_000,
  };
  localStorage.setItem(TRUSTED_DEVICE_KEY, JSON.stringify(data));
}

export function loadTrustedDevice(): TrustedDeviceData | null {
  try {
    const raw = localStorage.getItem(TRUSTED_DEVICE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as TrustedDeviceData;
    if (!data.phone || !data.deviceToken || data.expiresAt < Date.now()) {
      localStorage.removeItem(TRUSTED_DEVICE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearTrustedDevice(): void {
  localStorage.removeItem(TRUSTED_DEVICE_KEY);
}

// ── Supabase session — uses async SDK (not raw localStorage scraping) ─────────

async function getSupabaseToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

// ── Cookie hint detection ─────────────────────────────────────────────────────
// `portal_session` is HttpOnly (invisible to JS).
// The server also sets `portal_session_hint=1` (non-httponly) as a JS-readable signal.

function hasCookieSession(): boolean {
  try {
    return document.cookie.split(";").some((c) => c.trim().startsWith("portal_session_hint=1"));
  } catch {
    return false;
  }
}

// ── Legacy localStorage token (kept for backward compat) ─────────────────────

export function getDevToken(): string | null {
  try { return localStorage.getItem(DEV_TOKEN_KEY); } catch { return null; }
}

export function setDevToken(token: string): void {
  localStorage.setItem(DEV_TOKEN_KEY, token);
}

/**
 * Synchronous token read — for legacy Bearer sessions.
 * New cookie-based sessions return null here (use hasCookieSession() instead).
 */
export function getAuthToken(): string | null {
  try {
    const ours = localStorage.getItem(TOKEN_KEY);
    if (ours) return ours;
    const dev = getDevToken();
    if (dev) return dev;
  } catch { /* storage blocked */ }
  return null;
}

/** Async version — resolves Supabase session if no custom token is stored. */
export async function getAuthTokenAsync(): Promise<string | null> {
  const ours = getAuthToken();
  if (ours) return ours;
  return getSupabaseToken();
}

/**
 * setAuthToken — LEGACY ONLY.
 * New logins should NOT call this; the server sets the HttpOnly cookie directly.
 * Kept for dev-login and Supabase OAuth flows that still use Bearer.
 */
export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  // C1 FIX: Otomatis persist ke HttpOnly cookie di backend (non-blocking, non-fatal).
  // Semua caller (login, register, OTP) langsung mendapat cookie tanpa perubahan tersendiri.
  persistAuthCookie(token);
}

/**
 * C1 FIX: Setelah login, simpan token sebagai HttpOnly cookie di server.
 * Cookie adalah sumber auth utama; localStorage hanya sebagai fallback sementara.
 * Non-fatal: jika gagal, auth via Bearer header localStorage tetap bekerja.
 */
export async function persistAuthCookie(token: string): Promise<void> {
  try {
    await fetch("/api/portal/auth/set-cookie", {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Non-fatal: localStorage fallback masih aktif selama masa transisi
  }
}

export function removeAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(DEV_TOKEN_KEY);
  clearTrustedDevice();
  // C1 FIX: hapus HttpOnly cookie via server endpoint (best-effort)
  fetch("/api/portal/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  if (supabase) supabase.auth.signOut().catch(() => {});
}

/**
 * Returns Authorization header for Bearer-based (legacy) sessions.
 * For cookie-based sessions, returns {} — the cookie is sent automatically
 * by the browser when credentials:'include' is used.
 */
export function getAuthHeaders(): { Authorization?: string } {
  const token = getAuthToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

/**
 * isAuthenticated — checks legacy localStorage token OR cookie session hint.
 * Synchronous, safe to call during route guard evaluation.
 */
export function isAuthenticated(): boolean {
  return !!getAuthToken() || hasCookieSession();
}

export function getPortalProfile(): PortalProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PortalProfile;
  } catch {
    return null;
  }
}

export function setPortalProfile(profile: PortalProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function getPortalRole(): string {
  return getPortalProfile()?.role ?? "guest";
}

export function isPortalAdmin(): boolean {
  return getPortalRole() === "admin";
}

/**
 * fetchAndStoreProfile — always uses credentials:'include' so cookie sessions work.
 * Falls back to Bearer header for legacy localStorage sessions.
 */
export async function fetchAndStoreProfile(): Promise<PortalProfile | null> {
  const token = (await getAuthTokenAsync()) ?? getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch("/api/portal/auth/me", {
      headers,
      credentials: "include", // always include cookies
    });
    // Token invalid/expired — clear session so user is forced to login again
    if (res.status === 401 || res.status === 403) {
      removeAuthToken();
      // Also clear server cookie via logout endpoint
      fetch("/api/portal/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json() as { id: number; role: string; name: string; email: string };
    const profile: PortalProfile = {
      customerId: data.id,
      role: data.role,
      name: data.name,
      email: data.email,
    };
    setPortalProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

/**
 * logout — clears localStorage AND server cookie session.
 * Call this from all logout handlers (Navbar, MobileBottomNav).
 */
export async function logout(): Promise<void> {
  removeAuthToken();
  try {
    await fetch("/api/portal/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Best-effort server-side cookie clear
  }
}
