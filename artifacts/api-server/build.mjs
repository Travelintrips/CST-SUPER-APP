import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";
import { execSync } from "node:child_process";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");

function buildLib(name) {
  const libDir = path.resolve(workspaceRoot, "lib", name);
  console.log(`[build] Compiling lib/${name}...`);
  try {
    execSync("pnpm exec tsc -p tsconfig.json", { cwd: libDir, stdio: "inherit" });
    console.log(`[build] lib/${name} OK`);
  } catch {
    console.warn(`[build] lib/${name} build warning (non-fatal)`);
  }
}

async function buildAll() {
  // Build shared libs first so their dist/index.d.ts exist for TypeScript
  buildLib("db");
  buildLib("api-zod");

  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  const t0 = Date.now();
  const result = await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    target: "node20",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    // Silent: suppress esbuild's built-in reporter (which adds ⚠️ for files >500KB).
    // We print our own summary below using metafile data.
    logLevel: "error",
    metafile: true,
    // Keep explicit list for native addons that can't be bundled.
    external: [
      "*.node",
      "pdfkit",
      "sharp",
      "fluent-ffmpeg",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "xlsx",
      "exceljs",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "jose",
      "fluent-ffmpeg",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "archiver",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      "web-push",
      "compression",
    ],
    alias: {
      "@workspace/logistics-constants": path.resolve(workspaceRoot, "lib/logistics-constants/src/index.ts"),
      "@workspace/product-templates": path.resolve(workspaceRoot, "lib/product-templates/src/index.ts"),
      "@workspace/service-templates": path.resolve(workspaceRoot, "lib/service-templates/src/index.ts"),
      "zod": path.resolve(workspaceRoot, "node_modules/.pnpm/zod@3.25.76/node_modules/zod"),
    },
    sourcemap: process.env.NODE_ENV !== "production" ? "linked" : false,
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
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

  // Custom build summary — no ⚠️ threshold noise.
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  const outputs = Object.entries(result.metafile.outputs)
    .filter(([f]) => !f.endsWith(".map"))
    .sort((a, b) => b[1].bytes - a[1].bytes);
  const pad = Math.max(...outputs.map(([f]) => f.length));
  for (const [file, { bytes }] of outputs) {
    const kb = (bytes / 1024).toFixed(1).padStart(7);
    console.log(`  ${file.padEnd(pad)}  ${kb} kb`);
  }
  console.log(`\n⚡ Done in ${elapsed}s`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
