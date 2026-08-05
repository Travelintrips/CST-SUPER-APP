import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runCommodityTemplateMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS commodity_templates (
      id          SERIAL PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      icon        TEXT,
      description TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS commodity_template_fields (
      id          SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES commodity_templates(id) ON DELETE CASCADE,
      field_key   TEXT NOT NULL,
      label       TEXT NOT NULL,
      field_type  TEXT NOT NULL DEFAULT 'text',
      unit        TEXT,
      required    BOOLEAN NOT NULL DEFAULT false,
      options     JSONB,
      sort_order  INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS commodity_required_docs (
      id          SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES commodity_templates(id) ON DELETE CASCADE,
      doc_name    TEXT NOT NULL,
      description TEXT,
      required    BOOLEAN NOT NULL DEFAULT true,
      sort_order  INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS commodity_checklists (
      id          SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES commodity_templates(id) ON DELETE CASCADE,
      item        TEXT NOT NULL,
      category    TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS ct_fields_tpl_idx      ON commodity_template_fields (template_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ct_docs_tpl_idx        ON commodity_required_docs (template_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ct_checklists_tpl_idx  ON commodity_checklists (template_id)`);

  await db.execute(sql`
    ALTER TABLE vendor_mini_form_links
    ADD COLUMN IF NOT EXISTS commodity_template_id INTEGER REFERENCES commodity_templates(id) ON DELETE SET NULL
  `);

  await seedDefaultCommodityTemplates();

  logger.info("Commodity template migration: selesai");
}

async function seedDefaultCommodityTemplates(): Promise<void> {
  const defaults: Array<{
    key: string;
    name: string;
    icon: string;
    description: string;
    fields: Array<{ field_key: string; label: string; field_type: string; unit?: string; required: boolean; options?: unknown }>;
    docs: Array<{ doc_name: string; description?: string; required: boolean }>;
    checklists: Array<{ item: string; category?: string }>;
  }> = [
    {
      key: "coal",
      name: "Batubara",
      icon: "⛏️",
      description: "Komoditas batubara untuk ekspor / impor",
      fields: [
        { field_key: "calorific_value", label: "Calorific Value (kcal/kg)", field_type: "number", unit: "kcal/kg", required: true },
        { field_key: "total_moisture", label: "Total Moisture (%)", field_type: "number", unit: "%", required: true },
        { field_key: "ash_content", label: "Ash Content (%)", field_type: "number", unit: "%", required: true },
        { field_key: "sulfur_content", label: "Total Sulfur (%)", field_type: "number", unit: "%", required: true },
        { field_key: "volatile_matter", label: "Volatile Matter (%)", field_type: "number", unit: "%", required: false },
        { field_key: "fixed_carbon", label: "Fixed Carbon (%)", field_type: "number", unit: "%", required: false },
        { field_key: "hgi", label: "HGI (Hardgrove Grindability Index)", field_type: "number", required: false },
      ],
      docs: [
        { doc_name: "Certificate of Analysis (COA)", description: "Analisis kualitas batubara dari lab terakreditasi", required: true },
        { doc_name: "Certificate of Origin (COO)", description: "Sertifikat asal barang", required: true },
        { doc_name: "Bill of Lading (BL)", description: "Dokumen pengiriman laut", required: true },
        { doc_name: "Packing List", description: "Rincian kemasan dan berat", required: true },
        { doc_name: "Draft Survey Report", description: "Laporan survei draft kapal", required: false },
      ],
      checklists: [
        { item: "Verifikasi spesifikasi kualitas sesuai kontrak", category: "Kualitas" },
        { item: "Inspeksi kondisi fisik batubara (tidak basah berlebihan)", category: "Kualitas" },
        { item: "Pastikan kadar sulfur tidak melebihi batas regulasi", category: "Regulasi" },
        { item: "Cek dokumen ekspor (PEB / EX)", category: "Regulasi" },
        { item: "Verifikasi kapasitas vessel sesuai volume", category: "Logistik" },
        { item: "Konfirmasi jadwal laycan dengan shipper", category: "Logistik" },
      ],
    },
    {
      key: "iron_steel",
      name: "Besi & Baja",
      icon: "🔩",
      description: "Produk besi dan baja (steel products, HRC, CRC, dll.)",
      fields: [
        { field_key: "grade", label: "Grade / Spesifikasi", field_type: "text", required: true },
        { field_key: "thickness", label: "Ketebalan (mm)", field_type: "number", unit: "mm", required: true },
        { field_key: "width", label: "Lebar (mm)", field_type: "number", unit: "mm", required: true },
        { field_key: "tensile_strength", label: "Tensile Strength (MPa)", field_type: "number", unit: "MPa", required: false },
        { field_key: "yield_strength", label: "Yield Strength (MPa)", field_type: "number", unit: "MPa", required: false },
        { field_key: "surface_finish", label: "Surface Finish", field_type: "select", required: false, options: ["HR", "CR", "Galvanized", "Coated"] },
      ],
      docs: [
        { doc_name: "Mill Test Certificate (MTC)", description: "Sertifikat uji pabrik sesuai standar internasional", required: true },
        { doc_name: "Certificate of Origin (COO)", description: "Sertifikat asal negara produksi", required: true },
        { doc_name: "Packing List", description: "Rincian kemasan, berat, dan dimensi", required: true },
        { doc_name: "Commercial Invoice", description: "Invoice komersial", required: true },
        { doc_name: "Inspection Certificate", description: "Sertifikat inspeksi pihak ketiga", required: false },
      ],
      checklists: [
        { item: "Verifikasi grade sesuai spesifikasi pesanan", category: "Kualitas" },
        { item: "Cek dimensi (tebal, lebar, panjang) sesuai kontrak", category: "Kualitas" },
        { item: "Pastikan kemasan anti-karat (strapping, oiling)", category: "Kemasan" },
        { item: "Verifikasi jumlah bundle/coil sesuai PL", category: "Kemasan" },
        { item: "Cek dokumen impor (PIB / IM)", category: "Regulasi" },
      ],
    },
    {
      key: "coffee",
      name: "Kopi",
      icon: "☕",
      description: "Komoditas kopi ekspor (green bean, roasted, processed)",
      fields: [
        { field_key: "variety", label: "Varietas", field_type: "select", required: true, options: ["Arabika", "Robusta", "Liberika"] },
        { field_key: "process", label: "Proses", field_type: "select", required: true, options: ["Natural", "Washed", "Honey", "Wine"] },
        { field_key: "grade", label: "Grade", field_type: "select", required: true, options: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"] },
        { field_key: "moisture", label: "Kadar Air (%)", field_type: "number", unit: "%", required: true },
        { field_key: "defect_value", label: "Defect Value", field_type: "number", required: false },
        { field_key: "screen_size", label: "Screen Size", field_type: "text", required: false },
      ],
      docs: [
        { doc_name: "Phytosanitary Certificate", description: "Sertifikat sanitasi tanaman dari BKSDA/Kementan", required: true },
        { doc_name: "Certificate of Origin (COO)", description: "Sertifikat asal dari dinas terkait", required: true },
        { doc_name: "Certificate of Analysis (COA)", description: "Analisis mutu dari lab terakreditasi", required: true },
        { doc_name: "Packing List", description: "Detail kemasan (karung, bag, dll.)", required: true },
        { doc_name: "ICO Certificate", description: "Sertifikat International Coffee Organization", required: false },
      ],
      checklists: [
        { item: "Verifikasi kadar air sesuai standar ekspor (maks 12,5%)", category: "Kualitas" },
        { item: "Inspeksi visual: bebas dari benda asing, jamur, serangga", category: "Kualitas" },
        { item: "Pastikan kemasan karung goni bersih dan kering", category: "Kemasan" },
        { item: "Cek berat bersih per karung sesuai PL", category: "Kemasan" },
        { item: "Verifikasi dokumen ekspor Karantina Pertanian", category: "Regulasi" },
      ],
    },
    {
      key: "palm_oil",
      name: "Minyak Sawit",
      icon: "🌴",
      description: "Crude Palm Oil (CPO), RBD Palm Oil, Palm Kernel Oil",
      fields: [
        { field_key: "product_type", label: "Jenis Produk", field_type: "select", required: true, options: ["CPO", "CPKO", "RBD Palm Olein", "RBD Palm Stearin", "PKO"] },
        { field_key: "ffa", label: "FFA (%)", field_type: "number", unit: "%", required: true },
        { field_key: "moisture_impurities", label: "M&I (%)", field_type: "number", unit: "%", required: true },
        { field_key: "iodine_value", label: "Iodine Value", field_type: "number", required: false },
        { field_key: "dobi", label: "DOBI", field_type: "number", required: false },
      ],
      docs: [
        { doc_name: "Certificate of Quality (COQ)", description: "Sertifikat kualitas dari lab independen", required: true },
        { doc_name: "Certificate of Weight (COW)", description: "Sertifikat berat dari surveyor", required: true },
        { doc_name: "Phytosanitary Certificate", description: "Sertifikat sanitasi dari otoritas berwenang", required: true },
        { doc_name: "Bill of Lading (BL)", description: "Dokumen pengiriman", required: true },
        { doc_name: "RSPO / ISPO Certificate", description: "Sertifikasi keberlanjutan", required: false },
      ],
      checklists: [
        { item: "Verifikasi suhu tangki sesuai standar (CPO: 50-55°C)", category: "Kualitas" },
        { item: "Cek FFA tidak melebihi batas kontrak", category: "Kualitas" },
        { item: "Inspeksi kebersihan tangki kapal sebelum muat", category: "Logistik" },
        { item: "Konfirmasi volume loading dengan flow meter", category: "Logistik" },
        { item: "Pastikan sertifikasi keberlanjutan (RSPO/ISPO) tersedia jika diminta buyer", category: "Regulasi" },
      ],
    },
    {
      key: "rubber",
      name: "Karet",
      icon: "🔵",
      description: "Karet alam (SIR, RSS, Latex) untuk ekspor",
      fields: [
        { field_key: "product_type", label: "Jenis Produk", field_type: "select", required: true, options: ["SIR 10", "SIR 20", "SIR 3L", "RSS 1", "RSS 3", "Latex Pekat"] },
        { field_key: "dry_rubber_content", label: "DRC (%)", field_type: "number", unit: "%", required: true },
        { field_key: "dirt_content", label: "Dirt Content (%)", field_type: "number", unit: "%", required: true },
        { field_key: "ash_content", label: "Ash Content (%)", field_type: "number", unit: "%", required: false },
        { field_key: "po", label: "PRI / Po", field_type: "number", required: false },
      ],
      docs: [
        { doc_name: "Certificate of Quality (COQ)", description: "Analisis kualitas dari lab terakreditasi GAPKINDO", required: true },
        { doc_name: "Certificate of Origin Form A (GSP)", description: "COO untuk preferential tariff", required: true },
        { doc_name: "Packing List", description: "Detail bale, berat bruto & netto", required: true },
        { doc_name: "Fumigation Certificate", description: "Sertifikat fumigasi jika diperlukan negara tujuan", required: false },
      ],
      checklists: [
        { item: "Cek DRC sesuai spesifikasi (min 93% untuk SIR 20)", category: "Kualitas" },
        { item: "Inspeksi bale: tidak ada kontaminasi, bau asing", category: "Kualitas" },
        { item: "Verifikasi penomoran bale sesuai packing list", category: "Kemasan" },
        { item: "Cek dokumen ekspor (PEB) sudah approved", category: "Regulasi" },
      ],
    },
  ];

  for (let i = 0; i < defaults.length; i++) {
    const tpl = defaults[i];
    const existing = await db.execute(sql`SELECT id FROM commodity_templates WHERE key = ${tpl.key}`);
    if ((existing.rows?.length ?? 0) > 0) continue;

    const inserted = await db.execute(sql`
      INSERT INTO commodity_templates (key, name, icon, description, sort_order)
      VALUES (${tpl.key}, ${tpl.name}, ${tpl.icon}, ${tpl.description}, ${i})
      RETURNING id
    `);
    const templateId = (inserted.rows[0] as { id: number }).id;

    for (let j = 0; j < tpl.fields.length; j++) {
      const f = tpl.fields[j];
      await db.execute(sql`
        INSERT INTO commodity_template_fields (template_id, field_key, label, field_type, unit, required, options, sort_order)
        VALUES (
          ${templateId}, ${f.field_key}, ${f.label}, ${f.field_type},
          ${f.unit ?? null}, ${f.required}, ${f.options ? JSON.stringify(f.options) : null}, ${j}
        )
      `);
    }

    for (let j = 0; j < tpl.docs.length; j++) {
      const d = tpl.docs[j];
      await db.execute(sql`
        INSERT INTO commodity_required_docs (template_id, doc_name, description, required, sort_order)
        VALUES (${templateId}, ${d.doc_name}, ${d.description ?? null}, ${d.required}, ${j})
      `);
    }

    for (let j = 0; j < tpl.checklists.length; j++) {
      const c = tpl.checklists[j];
      await db.execute(sql`
        INSERT INTO commodity_checklists (template_id, item, category, sort_order)
        VALUES (${templateId}, ${c.item}, ${c.category ?? null}, ${j})
      `);
    }
  }
}
