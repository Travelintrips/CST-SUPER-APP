/**
 * Backup database PostgreSQL (pg_dump) ke Google Drive.
 * File SQL diupload ke folder "BizPortal Backup / YYYY-MM-DD"
 *
 * Cara jalankan:
 *   pnpm --filter @workspace/scripts run backup-db-drive
 *
 * Menggunakan Google Drive connector (Replit integration).
 */

import { ReplitConnectors } from "@replit/connectors-sdk";
import { execSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gzipSync } from "zlib";

const PARENT_FOLDER_NAME = "BizPortal Backup";

async function getOrCreateFolder(
  connectors: ReplitConnectors,
  name: string,
  parentId?: string
): Promise<string> {
  const parentQuery = parentId ? ` and '${parentId}' in parents` : "";
  const query = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentQuery}`
  );
  const listRes = await connectors.proxy("google-drive", `/drive/v3/files?q=${query}`, {
    method: "GET",
  });
  const listData = (await listRes.json()) as { files: Array<{ id: string }> };

  if (listData.files.length > 0) {
    return listData.files[0].id;
  }

  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];

  const createRes = await connectors.proxy("google-drive", "/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

async function uploadFileToDrive(
  connectors: ReplitConnectors,
  folderId: string,
  filename: string,
  fileBuffer: Buffer,
  contentType: string
): Promise<boolean> {
  const boundary = "biz_db_backup_" + Date.now();
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });

  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(metadata),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ];
  const body = Buffer.concat(parts);

  const res = await connectors.proxy(
    "google-drive",
    "/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "(no body)");
    console.error(`Drive API error ${res.status}: ${errText}`);
  }
  return res.ok;
}

async function main() {
  const connectors = new ReplitConnectors();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL tidak ditemukan.");
    process.exit(1);
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `bizportal-db-${timestamp}.sql.gz`;

  console.log("=== BizPortal Database → Google Drive Backup ===\n");
  console.log(`Menjalankan pg_dump ...`);

  const tmpPath = join(tmpdir(), filename);

  try {
    execSync(`pg_dump "${databaseUrl}" -f "${tmpPath}" --no-password`, {
      stdio: "pipe",
    });
    console.log(`pg_dump selesai → ${tmpPath}`);
  } catch (err) {
    console.error("pg_dump gagal:", err);
    process.exit(1);
  }

  const rawBuffer = readFileSync(tmpPath);
  const rawMB = (rawBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`Ukuran dump mentah: ${rawMB} MB`);
  console.log(`Mengompres dengan gzip ...`);
  const fileBuffer = gzipSync(rawBuffer, { level: 9 });
  const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`Ukuran setelah kompres: ${sizeMB} MB\n`);

  console.log(`Menyiapkan folder Drive: ${PARENT_FOLDER_NAME} / ${dateLabel} ...`);
  const parentId = await getOrCreateFolder(connectors, PARENT_FOLDER_NAME);
  const folderId = await getOrCreateFolder(connectors, dateLabel, parentId);
  console.log(`Folder siap (id: ${folderId})\n`);

  console.log(`Mengupload ${filename} ke Drive ...`);
  const ok = await uploadFileToDrive(
    connectors,
    folderId,
    filename,
    fileBuffer,
    "text/plain"
  );

  // Hapus file tmp
  try { unlinkSync(tmpPath); } catch { /* ignore */ }

  if (ok) {
    console.log(`\n✓ Backup database berhasil!`);
    console.log(`  📄 File    : ${filename}`);
    console.log(`  📦 Ukuran  : ${sizeMB} MB`);
    console.log(`  📁 Drive   : ${PARENT_FOLDER_NAME} / ${dateLabel}`);
  } else {
    console.error(`\n✗ Upload ke Google Drive gagal.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Backup gagal:", err);
  process.exit(1);
});
