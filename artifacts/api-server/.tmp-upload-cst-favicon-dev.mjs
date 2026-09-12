import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { readFileSync } from "node:fs";

const rawUrl = process.env.SUPABASE_URL_DEV || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL_DEV || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV || process.env.SUPABASE_SERVICE_ROLE_KEY;
const url = rawUrl?.startsWith("http://") || rawUrl?.startsWith("https://") ? rawUrl : `https://${rawUrl}.supabase.co`;
if (!url || !key) throw new Error("Development Supabase storage credentials are missing");

const buffer = readFileSync("/home/runner/workspace/attached_assets/logocst_1786640843601.png");
const storagePath = "portal-assets/static/customer-portal/images/logo.png";
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
});
const { error } = await supabase.storage.from("public-assets").upload(storagePath, buffer, {
  contentType: "image/png",
  upsert: true,
});
if (error) throw new Error(`favicon upload failed: ${error.message}`);
console.log(`Uploaded development favicon: ${storagePath} (${buffer.length} bytes)`);
