/**
 * Backup semua gambar produk & layanan dari Object Storage ke Google Drive.
 * Folder tujuan: "BizPortal Backup / YYYY-MM-DD"
 *
 * Cara jalankan:
 *   pnpm --filter @workspace/scripts run backup-drive
 *
 * Menggunakan Google Drive connector (Replit integration).
 */

import { ReplitConnectors } from "@replit/connectors-sdk";
import pg from "pg";

const { Pool } = pg;

const BASE_URL = "http://localhost:80";
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
  const boundary = "biz_backup_boundary_" + Date.now();
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
  return res.ok;
}

async function downloadFromStorage(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  // Paths in DB can be:
  //   /api/storage/objects/...   → prepend BASE_URL only
  //   /objects/...               → prepend BASE_URL + /api/storage
  //   https://...                → use as-is
  const downloadUrl = url.startsWith("http")
    ? url
    : url.startsWith("/api/")
    ? `${BASE_URL}${url}`
    : `${BASE_URL}/api/storage${url.startsWith("/") ? url : "/" + url}`;

  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch {
    return null;
  }
}

function getExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  const base = contentType.split(";")[0].trim();
  return map[base] ?? base.split("/")[1] ?? "bin";
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const connectors = new ReplitConnectors();

  console.log("=== BizPortal Object Storage → Google Drive Backup ===\n");

  const dateLabel = new Date().toISOString().slice(0, 10);

  console.log(`Menyiapkan folder Drive: ${PARENT_FOLDER_NAME} / ${dateLabel} ...`);
  const parentId = await getOrCreateFolder(connectors, PARENT_FOLDER_NAME);
  const folderId = await getOrCreateFolder(connectors, dateLabel, parentId);
  console.log(`Folder siap (id: ${folderId})\n`);

  const result = await pool.query<{
    id: number;
    name: string;
    sku: string;
    image_url: string | null;
    media_items: string | null;
  }>(`
    SELECT id, name, sku, image_url, media_items
    FROM products
    WHERE image_url IS NOT NULL
       OR (media_items IS NOT NULL AND media_items != '[]')
    ORDER BY id
  `);

  console.log(`Ditemukan ${result.rows.length} produk/layanan dengan gambar.\n`);

  let uploaded = 0;
  let skipped = 0;

  for (const row of result.rows) {
    const imageUrls: Array<{ url: string; index: number }> = [];

    if (row.image_url) {
      imageUrls.push({ url: row.image_url, index: 0 });
    }

    try {
      const media = JSON.parse(row.media_items ?? "[]") as Array<{ url?: string; type?: string }>;
      for (let i = 0; i < media.length; i++) {
        const item = media[i];
        if (item.url && item.url !== row.image_url) {
          imageUrls.push({ url: item.url, index: i + 1 });
        }
      }
    } catch { /* ignore */ }

    for (const { url, index } of imageUrls) {
      const data = await downloadFromStorage(url);
      if (!data) {
        console.log(`  ✗ [${row.sku}] #${index} — gagal download: ${url}`);
        skipped++;
        continue;
      }

      const ext = getExtension(data.contentType);
      const filename = index === 0
        ? `${row.sku}.${ext}`
        : `${row.sku}-${index}.${ext}`;

      const ok = await uploadFileToDrive(connectors, folderId, filename, data.buffer, data.contentType);
      if (ok) {
        console.log(`  ✓ [${row.sku}] ${filename} (${Math.round(data.buffer.length / 1024)} KB)`);
        uploaded++;
      } else {
        console.log(`  ✗ [${row.sku}] ${filename} — gagal upload ke Drive`);
        skipped++;
      }
    }
  }

  await pool.end();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Backup selesai!`);
  console.log(`  ✓ Berhasil diupload : ${uploaded} file`);
  console.log(`  ✗ Dilewati/gagal    : ${skipped} file`);
  console.log(`  📁 Lokasi Drive     : ${PARENT_FOLDER_NAME} / ${dateLabel}`);
}

main().catch((err) => {
  console.error("Backup gagal:", err);
  process.exit(1);
});
