/**
 * Restore backup dari Google Drive ke Replit:
 *   1. Database (.sql.gz) → PostgreSQL (DATABASE_URL)
 *   2. Gambar (.jpg/.png/dll) → Object Storage (path semula)
 *
 * Cara jalankan:
 *   pnpm --filter @workspace/scripts run restore-drive
 *
 * Script akan menampilkan daftar tanggal backup yang tersedia,
 * lalu kamu pilih tanggal mana yang ingin di-restore.
 */

import { ReplitConnectors } from "@replit/connectors-sdk";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gunzipSync } from "zlib";
import { createInterface } from "readline";
import pg from "pg";

const { Pool } = pg;
const PARENT_FOLDER_NAME = "BizPortal Backup";

// ─── helpers ────────────────────────────────────────────────────────────────

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function listFolder(
  connectors: ReplitConnectors,
  folderId: string
): Promise<Array<{ id: string; name: string; mimeType: string; size?: string }>> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await connectors.proxy(
    "google-drive",
    `/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size)&orderBy=name`,
    { method: "GET" }
  );
  const data = (await res.json()) as { files: Array<{ id: string; name: string; mimeType: string; size?: string }> };
  return data.files ?? [];
}

async function downloadFile(connectors: ReplitConnectors, fileId: string): Promise<Buffer> {
  const res = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${fileId}?alt=media`,
    { method: "GET" }
  );
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadToObjectStorage(
  buffer: Buffer,
  originalPath: string,
  contentType: string
): Promise<void> {
  // Upload via Object Storage API endpoint (presigned URL flow)
  const metaRes = await fetch("http://localhost:80/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: originalPath.split("/").pop() ?? "file",
      size: buffer.length,
      contentType,
    }),
  });
  if (!metaRes.ok) throw new Error(`Failed to get presigned URL: ${metaRes.status}`);
  const { uploadURL } = (await metaRes.json()) as { uploadURL: string; objectPath: string };

  const uploadRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error(`Presigned upload failed: ${uploadRes.status}`);
}

function detectContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", webp: "image/webp",
    gif: "image/gif", pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const connectors = new ReplitConnectors();

  console.log("=== BizPortal Google Drive → Replit Restore ===\n");

  // 1. Cari folder induk
  const rootQuery = encodeURIComponent(
    `name='${PARENT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const rootRes = await connectors.proxy("google-drive", `/drive/v3/files?q=${rootQuery}&fields=files(id,name)`, { method: "GET" });
  const rootData = (await rootRes.json()) as { files: Array<{ id: string; name: string }> };

  if (!rootData.files.length) {
    console.error(`Folder "${PARENT_FOLDER_NAME}" tidak ditemukan di Google Drive.`);
    process.exit(1);
  }
  const rootFolderId = rootData.files[0].id;

  // 2. Tampilkan daftar tanggal backup
  const dateFolders = await listFolder(connectors, rootFolderId);
  const backupFolders = dateFolders.filter(f => f.mimeType === "application/vnd.google-apps.folder");

  if (!backupFolders.length) {
    console.error("Belum ada backup tersimpan di Google Drive.");
    process.exit(1);
  }

  console.log("Backup yang tersedia:");
  backupFolders.forEach((f, i) => console.log(`  [${i + 1}] ${f.name}`));

  const choice = await ask("\nPilih nomor backup yang ingin di-restore (atau 'q' untuk batal): ");
  if (choice.toLowerCase() === "q") { console.log("Dibatalkan."); process.exit(0); }

  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= backupFolders.length) {
    console.error("Pilihan tidak valid."); process.exit(1);
  }

  const selectedFolder = backupFolders[idx]!;
  console.log(`\nMenggunakan backup: ${selectedFolder.name}\n`);

  const files = await listFolder(connectors, selectedFolder.id);
  if (!files.length) { console.error("Folder backup kosong."); process.exit(1); }

  // 3. Pisahkan file database dan gambar
  const dbFiles = files.filter(f => f.name.endsWith(".sql.gz"));
  const imageFiles = files.filter(f => !f.name.endsWith(".sql.gz") && f.mimeType !== "application/vnd.google-apps.folder");

  console.log(`Ditemukan: ${dbFiles.length} file database, ${imageFiles.length} file gambar\n`);

  // ── Restore database ──────────────────────────────────────────────────────
  if (dbFiles.length > 0) {
    const dbFile = dbFiles[0]!;
    const confirm = await ask(`⚠️  Restore database dari "${dbFile.name}" akan MENIMPA data saat ini.\nKetik "ya" untuk lanjut, atau tekan Enter untuk lewati: `);

    if (confirm.toLowerCase() === "ya") {
      console.log(`\nDownload ${dbFile.name} dari Drive ...`);
      const gzBuffer = await downloadFile(connectors, dbFile.id);
      console.log(`Download selesai (${(gzBuffer.length / 1024).toFixed(0)} KB terkompresi)`);

      console.log("Dekompresi ...");
      const sqlBuffer = gunzipSync(gzBuffer);
      console.log(`Ukuran SQL: ${(sqlBuffer.length / 1024 / 1024).toFixed(2)} MB`);

      const tmpSql = join(tmpdir(), `restore-${Date.now()}.sql`);
      writeFileSync(tmpSql, sqlBuffer);

      console.log("Menjalankan psql restore ...");
      try {
        execSync(`psql "${process.env.DATABASE_URL}" -f "${tmpSql}"`, { stdio: "pipe" });
        console.log("✓ Database berhasil di-restore!\n");
      } catch (err) {
        console.error("✗ psql gagal:", err);
      } finally {
        try { unlinkSync(tmpSql); } catch {}
      }
    } else {
      console.log("Restore database dilewati.\n");
    }
  }

  // ── Restore gambar ke Object Storage ─────────────────────────────────────
  if (imageFiles.length > 0) {
    const confirmImg = await ask(`Restore ${imageFiles.length} gambar ke Object Storage? (ya/tidak): `);
    if (confirmImg.toLowerCase() === "ya") {
      // Ambil mapping SKU → objectPath dari database
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const result = await pool.query<{ sku: string; image_url: string | null }>(
        `SELECT sku, image_url FROM products WHERE image_url IS NOT NULL`
      );
      await pool.end();

      const skuToPath: Record<string, string> = {};
      for (const row of result.rows) {
        if (row.image_url) skuToPath[row.sku] = row.image_url;
      }

      let uploaded = 0;
      let skipped = 0;

      for (const imgFile of imageFiles) {
        // Nama file format: SKU.ext atau SKU-N.ext
        const baseName = imgFile.name.replace(/\.[^.]+$/, "");
        const sku = baseName.replace(/-\d+$/, "");
        const originalPath = skuToPath[sku];

        if (!originalPath) {
          console.log(`  ⚠ [${imgFile.name}] SKU "${sku}" tidak ditemukan di database — dilewati`);
          skipped++;
          continue;
        }

        try {
          console.log(`  ↓ Download ${imgFile.name} ...`);
          const buffer = await downloadFile(connectors, imgFile.id);
          const contentType = detectContentType(imgFile.name);

          await uploadToObjectStorage(buffer, originalPath, contentType);
          console.log(`  ✓ [${sku}] ${imgFile.name} → Object Storage`);
          uploaded++;
        } catch (err) {
          console.error(`  ✗ [${imgFile.name}] gagal:`, err);
          skipped++;
        }
      }

      console.log(`\nGambar: ${uploaded} berhasil, ${skipped} dilewati`);
    } else {
      console.log("Restore gambar dilewati.");
    }
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log("✓ Proses restore selesai!");
  console.log(`${"═".repeat(50)}\n`);
}

main().catch((err) => {
  console.error("Restore gagal:", err);
  process.exit(1);
});
