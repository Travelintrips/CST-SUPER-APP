import { Router, type Request, type Response } from "express";
import { spawn } from "child_process";
import { requireAdmin } from "../lib/requireAdmin.js";
import path from "path";
import os from "os";
import fs from "fs";

export const dbSyncRouter = Router();

// ── Job store (in-memory, max 30 jobs) ───────────────────────────────────────
type JobStatus = "running" | "done" | "error";
export interface SyncJob {
  id: string;
  direction: "push" | "pull";
  target: "prod" | "dev";
  mode: "data" | "schema" | "full";
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  log: string[];
  progress: number;
}

const jobs = new Map<string, SyncJob>();
const MAX_JOBS = 30;

function addJob(job: SyncJob) {
  jobs.set(job.id, job);
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.keys()][0];
    jobs.delete(oldest);
  }
}

// ── Mask URL ─────────────────────────────────────────────────────────────────
function maskUrl(url?: string): string {
  if (!url) return "";
  return url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
}

// ── GET /status ───────────────────────────────────────────────────────────────
dbSyncRouter.get("/status", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  res.json({
    local:  { configured: !!process.env.DATABASE_URL,              masked: maskUrl(process.env.DATABASE_URL) },
    prod:   { configured: !!process.env.SUPABASE_DATABASE_URL,     masked: maskUrl(process.env.SUPABASE_DATABASE_URL) },
    dev:    { configured: !!process.env.SUPABASE_DATABASE_URL_DEV, masked: maskUrl(process.env.SUPABASE_DATABASE_URL_DEV) },
    jobs:   [...jobs.values()].reverse().slice(0, 20),
  });
});

// ── POST /start ───────────────────────────────────────────────────────────────
dbSyncRouter.post("/start", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const { direction, target, mode = "data" } = req.body as {
    direction: "push" | "pull";
    target: "prod" | "dev";
    mode?: "data" | "schema" | "full";
  };

  if (!["push", "pull"].includes(direction))
    return void res.status(400).json({ error: "direction harus push atau pull" });
  if (!["prod", "dev"].includes(target))
    return void res.status(400).json({ error: "target harus prod atau dev" });
  if (!["data", "schema", "full"].includes(mode))
    return void res.status(400).json({ error: "mode harus data, schema, atau full" });

  const localUrl  = process.env.DATABASE_URL;
  const remoteUrl = target === "prod"
    ? process.env.SUPABASE_DATABASE_URL
    : process.env.SUPABASE_DATABASE_URL_DEV;

  if (!localUrl)
    return void res.status(400).json({ error: "DATABASE_URL tidak dikonfigurasi" });
  if (!remoteUrl)
    return void res.status(400).json({ error: `SUPABASE_DATABASE_URL${target === "dev" ? "_DEV" : ""} tidak dikonfigurasi — set di Secrets` });

  const jobId = Math.random().toString(36).slice(2, 10).toUpperCase();
  const job: SyncJob = {
    id: jobId,
    direction,
    target,
    mode: mode as SyncJob["mode"],
    status: "running",
    startedAt: new Date().toISOString(),
    log: [],
    progress: 0,
  };
  addJob(job);

  const sourceUrl = direction === "push" ? localUrl  : remoteUrl;
  const destUrl   = direction === "push" ? remoteUrl : localUrl;

  runSync(job, sourceUrl, destUrl).catch((err: Error) => {
    job.status = "error";
    job.log.push(`Fatal: ${err.message}`);
    job.finishedAt = new Date().toISOString();
  });

  res.json({ jobId, message: "Sync dimulai" });
});

// ── GET /job/:id ──────────────────────────────────────────────────────────────
dbSyncRouter.get("/job/:jobId", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  const job = jobs.get(String(req.params.jobId));
  if (!job) return void res.status(404).json({ error: "Job tidak ditemukan" });
  res.json(job);
});

// ── GET /stream/:id (SSE) ─────────────────────────────────────────────────────
dbSyncRouter.get("/stream/:jobId", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const job = jobs.get(String(req.params.jobId));
  if (!job) return void res.status(404).json({ error: "Job tidak ditemukan" });

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  (res as any).flushHeaders?.();

  let lastSent = 0;
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const tick = () => {
    const newLines = job.log.slice(lastSent);
    newLines.forEach((line) => send({ type: "log", line }));
    lastSent = job.log.length;
    send({ type: "progress", progress: job.progress, status: job.status });
    if (job.status !== "running") {
      send({ type: "done", job });
      clearInterval(iv);
      res.end();
    }
  };

  const iv = setInterval(tick, 400);
  req.on("close", () => clearInterval(iv));
});

// ── Core: pg_dump → pg_restore ────────────────────────────────────────────────
async function runSync(job: SyncJob, sourceUrl: string, destUrl: string) {
  const tmpFile = path.join(os.tmpdir(), `db-sync-${job.id}.pgdump`);

  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    job.log.push(`[${ts}] ${msg}`);
  };

  const label = {
    source: job.direction === "push" ? "Replit DB" : `Supabase ${job.target.toUpperCase()}`,
    dest:   job.direction === "push" ? `Supabase ${job.target.toUpperCase()}` : "Replit DB",
  };

  try {
    // ── Step 1: pg_dump ──────────────────────────────────────────────────────
    log(`📦 Memulai dump dari ${label.source}...`);
    job.progress = 5;

    const dumpArgs: string[] = [
      "--no-password",
      "-Fc",
      "--no-owner",
      "--no-acl",
    ];
    if (job.mode === "data")   dumpArgs.push("--data-only");
    if (job.mode === "schema") dumpArgs.push("--schema-only");
    dumpArgs.push(sourceUrl);

    await spawnAsync("pg_dump", dumpArgs, (line) => log(`  dump: ${line}`), tmpFile);

    const sizeMb = (fs.statSync(tmpFile).size / 1024 / 1024).toFixed(2);
    log(`✅ Dump selesai — ${sizeMb} MB`);
    job.progress = 50;

    // ── Step 2: pg_restore ───────────────────────────────────────────────────
    log(`🔄 Memulai restore ke ${label.dest}...`);

    const restoreArgs: string[] = [
      "--no-password",
      "-d", destUrl,
      "--no-owner",
      "--no-acl",
      "--clean",
      "--if-exists",
    ];
    if (job.mode === "data") {
      restoreArgs.push("--data-only");
      restoreArgs.push("--disable-triggers");
    }
    restoreArgs.push(tmpFile);

    const code = await spawnAsyncCode("pg_restore", restoreArgs, (line) => {
      if (line) log(`  restore: ${line}`);
    });

    if (code > 1) throw new Error(`pg_restore gagal dengan exit code ${code}`);
    if (code === 1) log("⚠️  pg_restore selesai dengan warnings (umumnya aman diabaikan)");

    job.progress = 100;
    job.status   = "done";
    job.finishedAt = new Date().toISOString();
    log(`✅ Sync ${job.direction === "push" ? "push" : "pull"} ke ${label.dest} SELESAI!`);

  } catch (err: any) {
    job.status     = "error";
    job.finishedAt = new Date().toISOString();
    log(`❌ Gagal: ${err.message}`);
    throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ── spawnAsync: capture stdout to file, stderr to log callback ─────────────────
function spawnAsync(
  cmd: string,
  args: string[],
  onStderr: (line: string) => void,
  outFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, PGPASSWORD: "" } });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) onStderr(msg);
    });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${cmd} exited with code ${code}`));
      fs.writeFileSync(outFile, Buffer.concat(chunks));
      resolve();
    });
    child.on("error", reject);
  });
}

function spawnAsyncCode(
  cmd: string,
  args: string[],
  onOutput: (line: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, PGPASSWORD: "" } });
    child.stdout.on("data", (d: Buffer) => onOutput(d.toString().trim()));
    child.stderr.on("data", (d: Buffer) => onOutput(d.toString().trim()));
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", reject);
  });
}
