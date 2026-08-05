/**
 * Fase 2 — Link produk draft internal PT Cahaya Sejati Teknologi (company_id=1,
 * suppliers 1/10/11/24) ke Product/Service Template yang sesuai.
 *
 * Mekanisme yang dipakai SAMA dengan yang sudah ada di aplikasi (lihat
 * resolveTemplateForCategory() di routes/logisticOrders.ts dan PUT
 * /api/trading/suppliers/catalog/:itemId di routes/trading.ts):
 *   - in-code template (lib/product-templates | lib/service-templates) sebagai base
 *   - override dari tabel product_templates/service_templates (jika ada & aktif)
 *   - hasil resolve disimpan sebagai template_snapshot + template_version
 *
 * TIDAK ada migration, TIDAK ada tabel baru, TIDAK mengubah API/UI/workflow.
 * Hanya UPDATE data pada vendor_catalog_items, dan HANYA untuk baris status='draft'.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/link-cst-templates.ts
 */
import pg from "pg";
import { resolveTemplate } from "../../lib/product-templates/src/registry";
import { resolveServiceTemplate } from "../../lib/service-templates/src/registry";
import type { ProductTemplateOverride } from "../../lib/product-templates/src/types";
import type { ServiceTemplateOverride } from "../../lib/service-templates/src/types";

const { Pool } = pg;

const connStr =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_PG_URL ||
  process.env.DATABASE_URL;
if (!connStr) throw new Error("No DB connection string found");

const pool = new Pool({ connectionString: connStr, max: 2, options: "-c search_path=public" });

type ProductLink = { id: number; name: string; categoryKey: string };
type ServiceLink = { id: number; name: string; serviceType: string };

// ── Draft products yang cocok dengan template EXISTING (in-code + DB override) ──
const PRODUCT_LINKS: ProductLink[] = [
  { id: 17, name: "Batubara Thermal", categoryKey: "coal" },
  { id: 18, name: "Coconut Charcoal Briquette", categoryKey: "coconut_charcoal_briquette" },
  { id: 19, name: "Palm Acid Oil", categoryKey: "palm_oil" },
  { id: 20, name: "Karet (Rubber)", categoryKey: "rubber" },
  { id: 21, name: "Indonesian Arabica Coffee – Aceh Gayo Grade 1 Full Wash", categoryKey: "coffee" },
  { id: 23, name: "Baja (Steel)", categoryKey: "iron_steel" },
  { id: 24, name: "Bijih Besi (Iron Ore)", categoryKey: "iron_ore" },
  { id: 29, name: "Frozen Tuna Loin", categoryKey: "seafood" },
  { id: 30, name: "Frozen Tuna Steak", categoryKey: "seafood" },
  { id: 31, name: "Frozen Tuna Saku", categoryKey: "seafood" },
];

// Draft services (vendor 10) — belum punya categoryKey/serviceType sama sekali
const SERVICE_LINKS: ServiceLink[] = [
  { id: 25, name: "Air Freight", serviceType: "air_freight" },
  { id: 26, name: "Trucking", serviceType: "trucking" },
];

// Draft products yang TIDAK punya template yang cocok — sengaja TIDAK dipaksa
// ke kategori yang salah (menghindari data dummy/salah klasifikasi).
const UNMATCHED: { id: number; name: string; reason: string }[] = [
  { id: 22, name: "Kayu Manis (Cinnamon)", reason: "Tidak ada Product Template untuk kategori rempah/spice" },
  { id: 27, name: "Raw Cashew Nut R320", reason: "Tidak ada Product Template untuk kategori kacang/nuts" },
  { id: 28, name: "Raw Cashew Nut R240", reason: "Tidak ada Product Template untuk kategori kacang/nuts" },
  { id: 32, name: "Fresh Pineapple MD2", reason: "Tidak ada Product Template untuk buah segar (frozen_food tidak sesuai)" },
  { id: 33, name: "Fresh Honey Pineapple", reason: "Tidak ada Product Template untuk buah segar (frozen_food tidak sesuai)" },
  { id: 34, name: "Canned Pineapple Slices in Syrup", reason: "Tidak ada Product Template untuk makanan kalengan (frozen_food tidak sesuai)" },
  { id: 35, name: "Canned Pineapple Chunks in Syrup", reason: "Tidak ada Product Template untuk makanan kalengan (frozen_food tidak sesuai)" },
];

async function main() {
  // 1. Ambil semua override dari DB (product_templates & service_templates)
  const ptRows = (await pool.query(`select * from product_templates where is_active = true`)).rows;
  const stRows = (await pool.query(`select * from service_templates where is_active = true`)).rows;

  const ptOverrideByKey = new Map<string, ProductTemplateOverride>();
  for (const r of ptRows) {
    ptOverrideByKey.set(r.category_key, {
      categoryKey: r.category_key,
      label: r.label,
      version: r.version,
      isActive: r.is_active,
      requiredDocuments: r.required_documents,
      checklist: r.checklist,
      customFields: r.custom_fields,
      packagingInstructions: r.packaging_instructions,
      conditionalRules: r.conditional_rules,
      validationRules: r.validation_rules,
    });
  }
  const stOverrideByType = new Map<string, ServiceTemplateOverride>();
  const stDbIdByType = new Map<string, number>();
  for (const r of stRows) {
    stDbIdByType.set(r.service_type, r.id);
    stOverrideByType.set(r.service_type, {
      serviceType: r.service_type,
      label: r.label,
      emoji: r.emoji,
      version: r.version,
      isActive: r.is_active,
      fields: r.fields,
      requiredDocuments: r.required_documents,
      checklist: r.checklist,
      conditionalRules: r.conditional_rules,
      validationRules: r.validation_rules,
    });
  }
  const ptDbIdByKey = new Map<string, number>();
  for (const r of ptRows) ptDbIdByKey.set(r.category_key, r.id);

  const linkedReport: { id: number; name: string; kind: string; category: string; templateVersion: string }[] = [];

  // 2. Link product drafts
  for (const p of PRODUCT_LINKS) {
    const override = ptOverrideByKey.get(p.categoryKey) ?? null;
    const resolved = resolveTemplate(p.categoryKey, override);
    const dbId = ptDbIdByKey.get(p.categoryKey);
    const res = await pool.query(
      `update vendor_catalog_items
         set template_kind = 'product',
             category_key = $1,
             service_type = null,
             template_id = $2,
             template_version = $3,
             template_snapshot = $4::jsonb,
             updated_at = now()
       where id = $5 and status = 'draft'
       returning id`,
      [p.categoryKey, dbId ? String(dbId) : null, resolved.version, JSON.stringify(resolved), p.id],
    );
    if (res.rowCount && res.rowCount > 0) {
      linkedReport.push({ id: p.id, name: p.name, kind: "product", category: p.categoryKey, templateVersion: resolved.version });
    } else {
      console.warn(`[SKIP] id=${p.id} (${p.name}) tidak diupdate — kemungkinan status bukan 'draft' lagi.`);
    }
  }

  // 3. Link service drafts
  for (const s of SERVICE_LINKS) {
    const override = stOverrideByType.get(s.serviceType) ?? null;
    const resolved = resolveServiceTemplate(s.serviceType, override);
    const dbId = stDbIdByType.get(s.serviceType);
    const res = await pool.query(
      `update vendor_catalog_items
         set template_kind = 'service',
             category_key = $1,
             service_type = $1,
             template_id = $2,
             template_version = $3,
             template_snapshot = $4::jsonb,
             updated_at = now()
       where id = $5 and status = 'draft'
       returning id`,
      [s.serviceType, dbId ? String(dbId) : null, resolved.version, JSON.stringify(resolved), s.id],
    );
    if (res.rowCount && res.rowCount > 0) {
      linkedReport.push({ id: s.id, name: s.name, kind: "service", category: s.serviceType, templateVersion: resolved.version });
    } else {
      console.warn(`[SKIP] id=${s.id} (${s.name}) tidak diupdate — kemungkinan status bukan 'draft' lagi.`);
    }
  }

  console.log("\n=== BERHASIL DI-LINK ===");
  for (const r of linkedReport) {
    console.log(`  #${r.id} [${r.kind}] ${r.name} -> ${r.category} (template v${r.templateVersion})`);
  }
  console.log(`\nTotal linked: ${linkedReport.length}`);

  console.log("\n=== TIDAK DI-LINK (belum ada template yang cocok) ===");
  for (const u of UNMATCHED) {
    console.log(`  #${u.id} ${u.name} — ${u.reason}`);
  }
  console.log(`\nTotal unmatched: ${UNMATCHED.length}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
