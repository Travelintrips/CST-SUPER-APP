/**
 * FASE 9 — Auto Fix: Import media dari PDF resmi PT Cahaya Sejati Teknologi (CST)
 * dan publish 11 produk resmi ke Marketplace.
 *
 * Sumber: attached_assets/PT._CST_International_Trading_Divison_Product_...pdf
 * (source of truth, per instruksi user).
 *
 * ATURAN:
 *  - Match by name/id yang SUDAH ADA — TIDAK membuat produk duplikat, TIDAK INSERT baris baru.
 *  - Hanya UPDATE vendor_catalog_items yang sudah ada (11 id spesifik).
 *  - TIDAK mengubah harga, MOQ, lead_time yang sudah diisi manual.
 *  - Upload gambar dari PDF sebagai gallery (product_media), tandai 1 sebagai isPrimary (thumbnail).
 *  - Tidak mengarang data yang tidak ada di PDF (dokumen/sertifikat per-produk dibiarkan kosong).
 *  - Setelah semua terverifikasi lengkap → publish (status='published', is_published=true).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/import-cst-media-and-publish.ts
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { uploadToSupabase } from "../../artifacts/api-server/src/lib/supabaseStorage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const connStr =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_PG_URL ||
  process.env.DATABASE_URL;
if (!connStr) throw new Error("No DB connection string found");

const pool = new Pool({ connectionString: connStr, max: 2, options: "-c search_path=public" });

const CROPS = path.resolve(__dirname, "../../.agents/outputs/cst-pdf/crops");
const PAGES = path.resolve(__dirname, "../../.agents/outputs/cst-pdf");

interface ProductPlan {
  id: number;
  name: string;
  description: string;
  origin: string;
  unit: string;
  specValues: Record<string, unknown>;
  images: string[]; // absolute file paths, first = thumbnail/primary
  specSheetPage: string; // full page image, added as last gallery item (reference sheet)
}

const PLANS: ProductPlan[] = [
  {
    id: 21,
    name: "Indonesian Arabica Coffee – Aceh Gayo Grade 1 Full Wash",
    description:
      "Indonesian Arabica green coffee bean dari Aceh Gayo Highlands, Grade 1 (Specialty Grade), Full Wash process. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Aceh Gayo Highlands, Indonesia",
    unit: "kg",
    specValues: {
      variety: "Ateng, Tim Tim, Bourbon, Catimor",
      grade: "Grade 1 (Specialty Grade)",
      process: "Full Wash",
      moisture_content: "10 – 12%",
      defect_allowance: "Max. 11 defects/300g",
      screen_size: "S16 / S17 / S18",
      color: "Green",
      shelf_life: "24 Months",
      packaging: "60 kg Green Polybag + GrainPro / Jute Bag",
      container_capacity: "±18 – 20 MT / 20 ft FCL",
      cup_score: "84 – 87 (SCA)",
      typical_coa_green_bean: {
        moisture_pct: 11.2,
        total_defects_per_300g: 6,
        foreign_matter_pct: 0.1,
        broken_beans_pct: 1.8,
        black_beans_pct: 0.2,
        sour_beans_pct: 0.3,
        farm_process: "Full Wash",
        color: "Green",
        grade: "Grade 1",
      },
    },
    images: [
      `${CROPS}/coffee_hero.png`,
    ],
    specSheetPage: `${PAGES}/page_03.png`,
  },
  {
    id: 27,
    name: "Raw Cashew Nut R320",
    description:
      "Raw Cashew Nut grade R320 (Large Wholes), 100% natural, no additives/preservatives, sortex cleaned. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      variant: "R320 (Large Wholes)",
      count_per_lb: "300 – 320",
      moisture: "Max. 5%",
      broken: "Max. 5%",
      wholes: "Min. 90%",
      defected: "Max. 10%",
      color: "White / Ivory",
      foreign_matter: "Max. 0.5%",
      packaging_options: ["25 kg PP Bag", "25 kg Jute Bag", "Carton Box 10 kg / 20 kg"],
      container_capacity_20ft: "9 – 10 MT (25kg PP/Jute Bag)",
      container_capacity_40ft: "20 – 21 MT (25kg PP/Jute Bag)",
    },
    images: [`${CROPS}/cashew_r320_tile.png`, `${CROPS}/cashew_hero_shared.png`],
    specSheetPage: `${PAGES}/page_04.png`,
  },
  {
    id: 28,
    name: "Raw Cashew Nut R240",
    description:
      "Raw Cashew Nut grade R240 (Jumbo), 100% natural, no additives/preservatives, sortex cleaned. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      variant: "R240 (Jumbo)",
      count_per_lb: "220 – 240",
      moisture: "Max. 5%",
      broken: "Max. 5%",
      wholes: "Min. 90%",
      defected: "Max. 10%",
      color: "White / Ivory",
      foreign_matter: "Max. 0.5%",
      packaging_options: ["25 kg PP Bag", "25 kg Jute Bag", "Carton Box 10 kg / 20 kg"],
      container_capacity_20ft: "9 – 10 MT (25kg PP/Jute Bag)",
      container_capacity_40ft: "20 – 21 MT (25kg PP/Jute Bag)",
    },
    images: [`${CROPS}/cashew_r240_tile.png`, `${CROPS}/cashew_hero_shared.png`],
    specSheetPage: `${PAGES}/page_04.png`,
  },
  {
    id: 29,
    name: "Frozen Tuna Loin",
    description:
      "Frozen Tuna Loin (Block), premium cut, sourced from Indonesian waters, IQF/Quick Frozen. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      scientific_name: "Thunnus albacares / Thunnus obesus",
      cut: "Loin (Block)",
      size: "1 – 5 kg / block",
      grade: "Sashimi Grade",
      color: "Bright Red – Pink",
      freezing: "IQF / Quick Frozen",
      storage: "-18°C or below",
      shelf_life: "24 Months",
      packaging: "Vacuum Packed",
      net_weight_per_carton: "10 – 20 kg",
    },
    images: [`${CROPS}/tuna_loin_tile.png`],
    specSheetPage: `${PAGES}/page_05.png`,
  },
  {
    id: 30,
    name: "Frozen Tuna Steak",
    description:
      "Frozen Tuna Steak, cut dari bagian terbaik loin, ideal untuk grilling/frying/baking. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      scientific_name: "Thunnus albacares / Thunnus obesus",
      cut: "Steak",
      size: "150 – 300 g / steak",
      grade: "Food Grade / Sashimi Grade",
      color: "Bright Red – Pink",
      freezing: "IQF / Quick Frozen",
      storage: "-18°C or below",
      shelf_life: "24 Months",
      packaging: "Vacuum Packed",
      net_weight_per_carton: "10 kg",
    },
    images: [`${CROPS}/tuna_steak_tile.png`],
    specSheetPage: `${PAGES}/page_05.png`,
  },
  {
    id: 31,
    name: "Frozen Tuna Saku",
    description:
      "Frozen Tuna Saku, sushi grade cut, dirapikan ke bentuk rectangular, ideal untuk sashimi & sushi. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      scientific_name: "Thunnus albacares / Thunnus obesus",
      cut: "Saku",
      size: "100 – 300 g / piece",
      grade: "Sashimi Grade",
      color: "Bright Red – Pink",
      freezing: "IQF / Quick Frozen",
      storage: "-18°C or below",
      shelf_life: "24 Months",
      packaging: "Vacuum Packed",
      net_weight_per_carton: "10 kg",
    },
    images: [`${CROPS}/tuna_saku_tile.png`],
    specSheetPage: `${PAGES}/page_05.png`,
  },
  {
    id: 19,
    name: "Palm Acid Oil",
    description:
      "Palm Acid Oil (PAO), by-product dari refined palm oil, kualitas konsisten dan kemurnian tinggi untuk aplikasi industri (soap & detergent, oleochemical, animal feed, biodiesel). Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      moisture_impurities: "Max 2.0% (AOCS Ca 2c-25 & AOCS Ca 3a-46)",
      acid_value_ffa: "Min 40% (AOCS Ca 5a-10)",
      total_fatty_matter_tfm: "Min 97%",
      packaging_options: ["IBC Tank (900 KG)", "Steel Drum (180 KG)", "Flexibag (20 MT)", "Bulk Tanker (25–30 MT)"],
      container_loading_20ft: {
        "180kg_drum": "80 Drums / 14.4 MT",
        ibc_tank: "18 Tanks / 16.2 MT",
        flexibag: "20 MT",
      },
      certification: "ISO 9001:2015 Certified",
    },
    images: [`${CROPS}/palm_acid_oil_hero.png`, `${CROPS}/palm_acid_oil_overview.png`, `${CROPS}/palm_acid_oil_apps.png`],
    specSheetPage: `${PAGES}/page_06.png`,
  },
  {
    id: 32,
    name: "Fresh Pineapple MD2",
    description:
      "Fresh Pineapple varietas MD2 (Smooth Cayenne), golden color, high sweetness, low acidity. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      variety: "MD2 (Smooth Cayenne)",
      size_weight: "0.8 – 1.2 kg / fruit",
      brix_sweetness: "Min 14°",
      maturity: "80 – 90% ripe",
      color: "Golden Yellow",
      taste: "Very Sweet, Low Acidity",
      shape: "Cylindrical",
      leaves: "Green & Fresh",
      shelf_life: "10 – 14 Days",
      storage_temperature: "7 – 10°C",
      availability: "Year Round",
    },
    images: [`${CROPS}/pineapple_md2_tile.png`, `${CROPS}/pineapple_shared_basket.png`],
    specSheetPage: `${PAGES}/page_07.png`,
  },
  {
    id: 33,
    name: "Fresh Honey Pineapple",
    description:
      "Fresh Honey Pineapple, naturally sweet dengan aroma honey khas, tekstur juicy dan lembut, ideal untuk konsumsi segar. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "kg",
    specValues: {
      variety: "Honey Pineapple",
      size_weight: "0.8 – 1.2 kg / fruit",
      brix_sweetness: "Min 18°",
      maturity: "80 – 90% ripe",
      color: "Golden Yellow",
      taste: "Very Sweet, Honey Aroma",
      shape: "Cylindrical",
      leaves: "Green & Fresh",
      shelf_life: "10 – 14 Days",
      storage_temperature: "7 – 10°C",
      availability: "Year Round",
    },
    images: [`${CROPS}/pineapple_honey_tile.png`, `${CROPS}/pineapple_shared_basket.png`],
    specSheetPage: `${PAGES}/page_07.png`,
  },
  {
    id: 34,
    name: "Canned Pineapple Slices in Syrup",
    description:
      "Canned Pineapple Slices in Syrup, dari fresh pineapple pilihan, 100% natural taste, tanpa pewarna buatan. HACCP & ISO certified. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "can",
    specValues: {
      product_variant: "Slices in Syrup",
      can_size: "565 gr",
      container_loading_20ft: "~1,880 Cartons",
      certification: "HACCP & ISO Certified",
    },
    images: [`${CROPS}/canned_slices_tile.png`, `${CROPS}/canned_shared_cans.png`],
    specSheetPage: `${PAGES}/page_08.png`,
  },
  {
    id: 35,
    name: "Canned Pineapple Chunks in Syrup",
    description:
      "Canned Pineapple Chunks in Syrup, dari fresh pineapple pilihan, 100% natural taste, tanpa pewarna buatan. HACCP & ISO certified. Katalog resmi PT Cahaya Sejati Teknologi.",
    origin: "Indonesia",
    unit: "can",
    specValues: {
      product_variant: "Chunks in Syrup",
      can_size: "565 gr",
      container_loading_20ft: "~1,880 Cartons",
      certification: "HACCP & ISO Certified",
    },
    images: [`${CROPS}/canned_chunks_tile.png`, `${CROPS}/canned_shared_cans.png`],
    specSheetPage: `${PAGES}/page_08.png`,
  },
];

const MIME_BY_EXT: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

async function main() {
  console.log(`\n${"=".repeat(72)}`);
  console.log("IMPORT MEDIA DARI PDF RESMI CST + PUBLISH 11 PRODUK");
  console.log(`${"=".repeat(72)}`);

  const report: {
    id: number;
    name: string;
    imagesImported: number;
    thumbnailUrl: string | null;
    galleryUrls: string[];
    published: boolean;
    error?: string;
  }[] = [];

  for (const plan of PLANS) {
    console.log(`\n─── #${plan.id} ${plan.name} ───`);
    try {
      // 0. Safety: confirm row exists and belongs to vendor 24, and is not something else entirely
      const { rows } = await pool.query(
        `SELECT id, name, vendor_id, price_base, moq, lead_time, status, is_published FROM vendor_catalog_items WHERE id = $1`,
        [plan.id],
      );
      if (rows.length === 0) {
        console.log(`  ❌ SKIP — id ${plan.id} tidak ditemukan di DB`);
        report.push({ id: plan.id, name: plan.name, imagesImported: 0, thumbnailUrl: null, galleryUrls: [], published: false, error: "row not found" });
        continue;
      }
      const existing = rows[0];
      if (existing.vendor_id !== 24) {
        console.log(`  ❌ SKIP — vendor_id mismatch (${existing.vendor_id}), bukan PT Cahaya Sejati Teknologi`);
        report.push({ id: plan.id, name: plan.name, imagesImported: 0, thumbnailUrl: null, galleryUrls: [], published: false, error: "vendor_id mismatch" });
        continue;
      }

      // 1. Guard against duplicate media import (idempotent reruns)
      const { rows: existingMedia } = await pool.query(
        `SELECT count(*)::int AS c FROM product_media WHERE vendor_catalog_item_id = $1 AND is_active = true`,
        [plan.id],
      );
      let thumbnailUrl: string | null = null;
      const galleryUrls: string[] = [];

      if (existingMedia[0].c > 0) {
        console.log(`  ⏭  Media sudah ada (${existingMedia[0].c} baris) — skip upload, tidak duplikat.`);
        const { rows: pmRows } = await pool.query(
          `SELECT file_url, is_primary FROM product_media WHERE vendor_catalog_item_id = $1 AND is_active = true ORDER BY sort_order`,
          [plan.id],
        );
        for (const r of pmRows) {
          galleryUrls.push(r.file_url);
          if (r.is_primary) thumbnailUrl = r.file_url;
        }
      } else {
        const allImagePaths = [...plan.images, plan.specSheetPage];
        let sortOrder = 0;
        for (let i = 0; i < allImagePaths.length; i++) {
          const filePath = allImagePaths[i];
          if (!fs.existsSync(filePath)) {
            console.log(`  ⚠️  File tidak ditemukan, skip: ${filePath}`);
            continue;
          }
          const buf = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mime = MIME_BY_EXT[ext] ?? "image/png";
          const { publicUrl, storagePath } = await uploadToSupabase(buf, mime, "product-media/images");
          const isPrimary = i === 0; // first image (product hero crop) = thumbnail
          const isSpecSheet = filePath === plan.specSheetPage;
          await pool.query(
            `INSERT INTO product_media
               (vendor_catalog_item_id, vendor_id, media_type, file_url, storage_path, title,
                sort_order, is_primary, is_active, uploaded_by, uploaded_by_role, image_source)
             VALUES ($1,$2,'image',$3,$4,$5,$6,$7,true,$8,$9,$10)`,
            [
              plan.id,
              24,
              publicUrl,
              storagePath,
              isSpecSheet ? "Spec sheet (dari PDF resmi CST)" : "Product photo (dari PDF resmi CST)",
              sortOrder++,
              isPrimary,
              "system-pdf-import",
              "system",
              "vendor",
            ],
          );
          galleryUrls.push(publicUrl);
          if (isPrimary) thumbnailUrl = publicUrl;
          console.log(`  ✅ Uploaded ${isSpecSheet ? "[spec sheet]" : "[product photo]"}: ${publicUrl}`);
        }
      }

      // 2. Update spec_values / description / origin / unit — NEVER touch price_base, price_sell, moq, lead_time
      const cleanedSpecValues =
        plan.id === 28
          ? plan.specValues // #28 correction: replace bogus coal-era spec_values entirely
          : plan.specValues;
      const clearDocuments = plan.id === 28; // remove fabricated example.com placeholder docs

      await pool.query(
        `UPDATE vendor_catalog_items
           SET description = $1,
               origin = $2,
               unit = COALESCE(unit, $3),
               spec_values = $4::jsonb,
               documents = CASE WHEN $5 THEN NULL ELSE documents END,
               updated_at = now()
         WHERE id = $6`,
        [plan.description, plan.origin, plan.unit, JSON.stringify(cleanedSpecValues), clearDocuments, plan.id],
      );
      console.log(`  ✅ spec_values/description/origin diperbarui dari PDF (harga/MOQ/lead_time TIDAK disentuh)`);

      // 3. Publish — only after media + spec verified present
      const hasMedia = galleryUrls.length > 0;
      if (!hasMedia) {
        console.log(`  ⚠️  Tidak ada media tersedia — TIDAK dipublish (menunggu media).`);
        report.push({ id: plan.id, name: plan.name, imagesImported: galleryUrls.length, thumbnailUrl, galleryUrls, published: false, error: "no media" });
        continue;
      }
      await pool.query(
        `UPDATE vendor_catalog_items
           SET status = 'published', is_published = true, is_active = true,
               published_at = COALESCE(published_at, now()), updated_at = now()
         WHERE id = $1`,
        [plan.id],
      );
      console.log(`  ✅ PUBLISHED`);
      report.push({ id: plan.id, name: plan.name, imagesImported: galleryUrls.length, thumbnailUrl, galleryUrls, published: true });
    } catch (e: any) {
      console.error(`  ❌ ERROR:`, e?.message);
      report.push({ id: plan.id, name: plan.name, imagesImported: 0, thumbnailUrl: null, galleryUrls: [], published: false, error: e?.message });
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("LAPORAN AKHIR");
  console.log(`${"=".repeat(72)}`);
  let totalImages = 0;
  let totalPublished = 0;
  for (const r of report) {
    totalImages += r.imagesImported;
    if (r.published) totalPublished++;
    console.log(`\n#${r.id} ${r.name}`);
    console.log(`  images: ${r.imagesImported} | published: ${r.published}${r.error ? " | error: " + r.error : ""}`);
    console.log(`  thumbnail: ${r.thumbnailUrl ?? "-"}`);
    r.galleryUrls.forEach((u, i) => console.log(`  gallery[${i}]: ${u}`));
  }
  console.log(`\nTOTAL produk diproses: ${report.length}`);
  console.log(`TOTAL produk dipublish: ${totalPublished}`);
  console.log(`TOTAL gambar diimpor: ${totalImages}`);

  await pool.end();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
