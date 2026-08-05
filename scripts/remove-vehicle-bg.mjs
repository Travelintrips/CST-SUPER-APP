/**
 * Hapus background putih dari semua gambar kendaraan, simpan sebagai PNG transparan.
 * Cara kerja: pixel yang mendekati putih (R,G,B > threshold) diubah ke alpha=0.
 */
import sharp from "sharp";
import { readdir } from "fs/promises";
import { join, extname, basename } from "path";

const INPUT_DIR  = "artifacts/customer-portal/public/images/vehicles";
const OUTPUT_DIR = "artifacts/customer-portal/public/images/vehicles";

// Threshold: pixel dianggap "putih" jika semua channel >= nilai ini
const WHITE_THRESHOLD = 235;
// Edge feather: pixel yang agak abu-abu di tepi (threshold-20) dibuat semi-transparan
const FEATHER_THRESHOLD = 215;

async function removeWhiteBg(inputPath, outputPath) {
  const image = sharp(inputPath);
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info; // channels = 4 (RGBA)
  const buf = Buffer.from(data);

  for (let i = 0; i < buf.length; i += channels) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];

    if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) {
      // Fully transparent
      buf[i + 3] = 0;
    } else if (r >= FEATHER_THRESHOLD && g >= FEATHER_THRESHOLD && b >= FEATHER_THRESHOLD) {
      // Semi-transparent feather at edges
      const brightness = Math.min(r, g, b);
      const alpha = Math.round(((WHITE_THRESHOLD - brightness) / (WHITE_THRESHOLD - FEATHER_THRESHOLD)) * 255);
      buf[i + 3] = Math.min(alpha, buf[i + 3]);
    }
  }

  await sharp(buf, { raw: { width, height, channels } })
    .png({ compressionLevel: 8 })
    .toFile(outputPath);

  console.log(`✓ ${basename(outputPath)}`);
}

const files = await readdir(INPUT_DIR);
const jpgs  = files.filter(f => [".jpg", ".jpeg"].includes(extname(f).toLowerCase()));

console.log(`Processing ${jpgs.length} vehicle images…\n`);

for (const file of jpgs) {
  const inputPath  = join(INPUT_DIR, file);
  const outputName = basename(file, extname(file)) + ".png";
  const outputPath = join(OUTPUT_DIR, outputName);
  try {
    await removeWhiteBg(inputPath, outputPath);
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`);
  }
}

console.log("\nDone! PNG files with transparent backgrounds created.");
