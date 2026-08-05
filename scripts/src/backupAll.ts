/**
 * Backup lengkap: database + gambar Object Storage → Google Drive
 *
 * Cara jalankan:
 *   pnpm --filter @workspace/scripts run backup-all
 */

import { execSync } from "child_process";

function run(label: string, cmd: string) {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`▶ ${label}`);
  console.log(`${"═".repeat(55)}\n`);
  execSync(cmd, { stdio: "inherit" });
}

run(
  "1/2 — Backup Database ke Google Drive",
  "tsx ./src/backupDbToGoogleDrive.ts"
);

run(
  "2/2 — Backup Gambar (Object Storage) ke Google Drive",
  "tsx ./src/backupToGoogleDrive.ts"
);

console.log(`\n${"═".repeat(55)}`);
console.log("✓ Backup lengkap selesai!");
console.log(`${"═".repeat(55)}\n`);
