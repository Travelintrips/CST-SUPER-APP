import { db, productsTable, productCategoriesTable, productCategoryMapTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger.js";

const GREEN_BEAN_ARABICA_DESCRIPTION = `Green Bean Arabica Grade 1 — biji kopi hijau Arabica pilihan dari perkebunan unggulan Indonesia.

SPESIFIKASI TEKNIS:
• Jenis        : Arabica
• Moisture     : 12–13%
• Defect Value : < 5% (Grade 1)
• Screen Size  : 15-18 mesh
• Aroma        : Medium acidity, floral, fruity notes
• Packaging    : 60 kg/bag (karung goni)
• Origin       : Indonesia (Gayo, Toraja, Flores, dll.)

INFORMASI PEMBELIAN:
• MOQ          : 1 Container 20ft atau 40ft
• Harga        : USD 12/Kg (dapat dinegosiasikan sesuai volume)
• Pembayaran   : Bank Transfer (TT) — DP diperlukan sebelum pengiriman
• Dokumen      : COO, Phytosanitary Certificate, Invoice & Packing List tersedia

Hubungi kami untuk informasi harga terkini dan ketersediaan stok.`;

interface CatalogProductSeed {
  sku: string;
  name: string;
  itemType: "barang" | "jasa";
  unit: string;
  unitOptions: string[];
  price: string;
  subcategory: string;
  categoryName: string;
  description: string;
  isActive: boolean;
}

const CATALOG_PRODUCTS: CatalogProductSeed[] = [
  {
    sku: "GBA-GRADE1-001",
    name: "Green Bean Arabica Grade 1",
    itemType: "barang",
    unit: "Kg",
    unitOptions: ["Kg", "MT (Metric Ton)", "Container 20ft", "Container 40ft"],
    price: "12",
    subcategory: "Green Bean",
    categoryName: "Kopi / Green Bean",
    description: GREEN_BEAN_ARABICA_DESCRIPTION,
    isActive: true,
  },
];

const REQUIRED_CATEGORIES = [...new Set(CATALOG_PRODUCTS.map((p) => p.categoryName))];

export async function seedCatalogProducts(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // 1. Ensure required categories exist (idempotent)
      for (const name of REQUIRED_CATEGORIES) {
        await tx
          .insert(productCategoriesTable)
          .values({ name })
          .onConflictDoNothing();
      }

      // 2. Fetch category id→name map
      const cats = await tx
        .select({ id: productCategoriesTable.id, name: productCategoriesTable.name })
        .from(productCategoriesTable)
        .where(inArray(productCategoriesTable.name, REQUIRED_CATEGORIES));
      const catByName = new Map(cats.map((c) => [c.name, c.id]));

      // 3. Upsert products — update price, description, isActive on conflict so re-runs self-heal
      for (const item of CATALOG_PRODUCTS) {
        await tx
          .insert(productsTable)
          .values({
            sku: item.sku,
            name: item.name,
            itemType: item.itemType,
            unit: item.unit,
            unitOptions: JSON.stringify(item.unitOptions),
            price: item.price,
            stock: 0,
            subcategory: item.subcategory,
            description: item.description,
            isActive: item.isActive,
          })
          .onConflictDoUpdate({
            target: productsTable.sku,
            set: {
              name: item.name,
              // Tidak overwrite harga — biarkan harga yang sudah diubah manual tetap
              unit: item.unit,
              unitOptions: JSON.stringify(item.unitOptions),
              subcategory: item.subcategory,
              description: item.description,
              isActive: item.isActive,
            },
          });
      }

      // 4. Fetch product ids by sku
      const skus = CATALOG_PRODUCTS.map((p) => p.sku);
      const products = await tx
        .select({ id: productsTable.id, sku: productsTable.sku })
        .from(productsTable)
        .where(inArray(productsTable.sku, skus));
      const productBySku = new Map(products.map((p) => [p.sku, p.id]));

      // 5. Assign categories (idempotent via ON CONFLICT DO NOTHING)
      const mappings = CATALOG_PRODUCTS.flatMap((item) => {
        const productId = productBySku.get(item.sku);
        const categoryId = catByName.get(item.categoryName);
        if (!productId || !categoryId) return [];
        return [{ productId, categoryId }];
      });
      if (mappings.length > 0) {
        await tx
          .insert(productCategoryMapTable)
          .values(mappings)
          .onConflictDoNothing();
      }
    });

    logger.info("Catalog products seeded (Green Bean Arabica Grade 1)");
  } catch (err) {
    logger.error({ err }, "Failed to seed catalog products");
  }
}
