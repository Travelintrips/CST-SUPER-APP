import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createRequire as _cr } from "module";
const _ws = (() => { try { return _cr(import.meta.url)("ws"); } catch { return globalThis.WebSocket; } })();
type WsType = typeof globalThis.WebSocket;

function normalizeSupabaseUrl(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("https://") || raw.startsWith("http://")) return raw;
  return `https://${raw}.supabase.co`;
}

// Always use the same project as the frontend (VITE_SUPABASE_URL / SUPABASE_URL).
// SUPABASE_URL_DEV is intentionally ignored here — it was a different test project
// that doesn't share JWT secrets with the frontend client, causing token verification
// to fail silently. Both dev and prod must verify tokens against the same project.
const url = normalizeSupabaseUrl(
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  ""
);
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ??
  "";

if (!url || !key) {
  console.warn(
    "[supabaseAdmin] WARNING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — " +
    "Supabase client will be unavailable. Any call via supabaseAdmin will throw."
  );
}

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!url || !key) return null;
  if (!_client) {
    _client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: _ws as unknown as WsType },
    });
  }
  return _client;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    if (!client) throw new Error("Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)");
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export async function verifySupabaseToken(token: string) {
  const client = getClient();
  if (!client) return null;
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user || !user.email) return null;
  return user;
}
