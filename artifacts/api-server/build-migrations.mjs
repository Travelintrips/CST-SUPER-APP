#!/usr/bin/env node
/**
 * Build the standalone dev-migrations runner.
 * Usage: node build-migrations.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await esbuild({
  entryPoints: [
    path.resolve(artifactDir, "src/run-dev-migrations.ts"),
    path.resolve(artifactDir, "src/run-canonical-contract-migration.ts"),
  ],
  platform: "node",
  target: "node20",
  bundle: true,
  format: "esm",
  outdir: path.resolve(artifactDir, "dist"),
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
  external: [
    // Node.js built-ins (pg requires dynamic require of these)
    "events", "stream", "util", "net", "tls", "fs", "path", "os", "crypto",
    "http", "https", "url", "querystring", "buffer", "dns", "zlib",
    "child_process", "readline", "assert", "string_decoder", "timers",
    "*.node",
    "pdfkit",
    "sharp",
    "fluent-ffmpeg",
    "canvas",
    "@replit/object-storage",
    "@google-cloud/storage",
    "pdf-parse",
    "xlsx",
    "exceljs",
    "archiver",
    "nodemailer",
    "imapflow",
    "mailparser",
    "ws",
    "openai",
    "openid-client",
    "googleapis",
    "google-auth-library",
    "resend",
    "@supabase/supabase-js",
  ],
}).then(() => {
  console.log("[build-migrations] Bundles OK → dist/run-dev-migrations.mjs and dist/run-canonical-contract-migration.mjs");
}).catch((err) => {
  console.error("[build-migrations] Build failed:", err.message);
  process.exit(1);
});
