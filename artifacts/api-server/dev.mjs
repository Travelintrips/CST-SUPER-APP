import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { context as esbuildContext } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { spawn } from "node:child_process";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");
const distDir = path.resolve(artifactDir, "dist");

// ── Clean dist before initial build to prevent stale JS loading after schema changes ──
// Only cleans on startup (not on incremental rebuilds in watch mode).
// Stale dist files caused "old code running after restart" race conditions.
if (fs.existsSync(distDir)) {
  try {
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log("[dev] Cleaned stale dist/");
  } catch {
    // non-fatal
  }
}
fs.mkdirSync(distDir, { recursive: true });
const entry = path.resolve(artifactDir, "src/index.ts");

let serverProcess = null;
let restarting = false;
let initialBuildDone = false;

function startServer() {
  restarting = true;
  if (serverProcess) {
    serverProcess.once("exit", () => {
      restarting = false;
      spawnServer();
    });
    serverProcess.kill("SIGTERM");
  } else {
    restarting = false;
    spawnServer();
  }
}

function spawnServer() {
  console.log("[dev] Starting API Server (via load-secrets.mjs)...");
  // Route startup through load-secrets.mjs so GCP Secret Manager injects all
  // credentials before the server process starts — same path as production
  // (start:secure). load-secrets.mjs forwards SIGTERM/SIGINT to its child,
  // so kill() on serverProcess correctly tears down the server on rebuild.
  const loadSecretsPath = path.resolve(artifactDir, "load-secrets.mjs");
  serverProcess = spawn(
    process.execPath,
    [
      loadSecretsPath,
      process.execPath,
      "--enable-source-maps",
      path.join(distDir, "index.mjs"),
    ],
    {
      env: {
        ...process.env,
        PORT: process.env.PORT ?? "8080",
        NODE_ENV: process.env.APP_ENV === "production" ? "production" : "development",
      },
      stdio: "inherit",
    }
  );
  serverProcess.on("exit", (code, signal) => {
    serverProcess = null;
    if (!restarting && signal !== "SIGTERM" && code !== 0) {
      console.error(`[dev] Server crashed (code=${code}) — restarting in 30s...`);
      setTimeout(spawnServer, 30_000);
    }
  });
}

// Plugin: restart server on every successful rebuild
const restartPlugin = {
  name: "restart-on-rebuild",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error(`[dev] Build failed (${result.errors.length} error(s))`);
        return;
      }
      if (!initialBuildDone) {
        initialBuildDone = true;
        console.log("[dev] Initial build OK — starting server...");
        spawnServer();
        return;
      }
      console.log("[dev] Rebuild OK — restarting server...");
      startServer();
    });
  },
};

const external = [
  "*.node", "pdfkit", "sharp", "better-sqlite3", "sqlite3", "canvas",
  "bcrypt", "argon2", "fsevents", "re2", "farmhash", "xxhash-addon",
  "bufferutil", "utf-8-validate", "ssh2", "cpu-features", "dtrace-provider",
  "isolated-vm", "lightningcss", "pg-native", "oracledb",
  "mongodb-client-encryption", "nodemailer", "imapflow", "mailparser",
  "handlebars", "knex", "typeorm", "protobufjs", "onnxruntime-node", "jose",
  "@tensorflow/*", "@prisma/client", "@mikro-orm/*", "@grpc/*", "@swc/*",
  "@aws-sdk/*", "@azure/*", "@opentelemetry/*", "@google-cloud/*", "@google/*",
  "googleapis", "firebase-admin", "@parcel/watcher", "@sentry/profiling-node",
  "@tree-sitter/*", "aws-sdk", "classic-level", "dd-trace", "ffi-napi", "grpc",
  "hiredis", "kerberos", "leveldown", "miniflare", "mysql2", "newrelic", "odbc",
  "piscina", "realm", "ref-napi", "rocksdb", "sass-embedded", "sequelize",
  "serialport", "snappy", "tinypool", "usb", "workerd", "wrangler",
  "zeromq", "zeromq-prebuilt", "playwright", "puppeteer", "puppeteer-core", "electron",
  "ws", "web-push", "fluent-ffmpeg", "xlsx", "exceljs",
  "archiver",
];

const ctx = await esbuildContext({
  entryPoints: [entry],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "error",
  sourcemap: "linked",
  external,
  alias: {
    "@workspace/logistics-constants": path.resolve(workspaceRoot, "lib/logistics-constants/src/index.ts"),
    "@workspace/product-templates": path.resolve(workspaceRoot, "lib/product-templates/src/index.ts"),
    "@workspace/service-templates": path.resolve(workspaceRoot, "lib/service-templates/src/index.ts"),
    "zod": path.resolve(workspaceRoot, "node_modules/.pnpm/zod@3.25.76/node_modules/zod"),
  },
  plugins: [
    esbuildPluginPino({ transports: ["pino-pretty"] }),
    restartPlugin,
  ],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});

console.log("[dev] Watch mode started — waiting for initial build...");
await ctx.watch();

// Cleanup on process exit
function shutdown() {
  restarting = true;
  serverProcess?.kill("SIGTERM");
  ctx.dispose().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
