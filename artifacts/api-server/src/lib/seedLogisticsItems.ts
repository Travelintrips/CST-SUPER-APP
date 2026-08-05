import { db, productsTable, productCategoriesTable, productCategoryMapTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger.js";

const LOGISTICS_SERVICE_ITEMS: Array<{
  sku: string;
  name: string;
  unit: string;
  price: string;
  categoryName: string;
}> = [
  { sku: "SVC-OCEAN-FREIGHT",   name: "Jasa Ocean Freight",           unit: "shipment", price: "0", categoryName: "Laut" },
  { sku: "SVC-AIR-FREIGHT",     name: "Jasa Air Freight",             unit: "shipment", price: "0", categoryName: "Udara" },
  { sku: "SVC-TRUCKING",        name: "Jasa Trucking",                unit: "trip",     price: "0", categoryName: "Trucking" },
  { sku: "SVC-HANDLING",        name: "Jasa Handling",                unit: "lot",      price: "0", categoryName: "Handling" },
  { sku: "SVC-CUSTOMS",         name: "Jasa Customs Clearance",       unit: "dokumen",  price: "0", categoryName: "Pabean" },
  { sku: "SVC-PPJK",            name: "Jasa Pengurusan Dokumen PPJK", unit: "dokumen",  price: "0", categoryName: "Pabean" },
  { sku: "SVC-PORT-CHARGES",    name: "Jasa Port Charges",            unit: "lot",      price: "0", categoryName: "Freight Forwarding" },
  { sku: "SVC-STORAGE",         name: "Jasa Storage / Demurrage",     unit: "hari",     price: "0", categoryName: "Lainnya" },
  { sku: "SVC-EMKL",            name: "Jasa EMKL",                    unit: "lot",      price: "0", categoryName: "Freight Forwarding" },
  { sku: "SVC-INSURANCE",       name: "Jasa Asuransi Kargo",          unit: "shipment", price: "0", categoryName: "Lainnya" },
];

const REQUIRED_CATEGORIES = [...new Set(LOGISTICS_SERVICE_ITEMS.map((i) => i.categoryName))];

export async function seedLogisticsServiceItems(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // 1. Ensure required categories exist (idempotent)
      for (const name of REQUIRED_CATEGORIES) {
        await tx
          .insert(productCategoriesTable)
          .values({ name })
          .onConflictDoNothing();
      }

      // 2. Fetch category id→name map for our required categories
      const cats = await tx
        .select({ id: productCategoriesTable.id, name: productCategoriesTable.name })
        .from(productCategoriesTable)
        .where(inArray(productCategoriesTable.name, REQUIRED_CATEGORIES));
      const catByName = new Map(cats.map((c) => [c.name, c.id]));

      // 3. Insert products (idempotent via ON CONFLICT DO NOTHING on sku)
      await tx
        .insert(productsTable)
        .values(
          LOGISTICS_SERVICE_ITEMS.map((item) => ({
            sku: item.sku,
            name: item.name,
            itemType: "jasa" as const,
            unit: item.unit,
            price: item.price,
            stock: 0,
            subcategory: "Logistics Services",
            isActive: true,
          })),
        )
        .onConflictDoNothing({ target: productsTable.sku });

      // 4. Fetch product ids by sku (needed after potential no-op inserts)
      const skus = LOGISTICS_SERVICE_ITEMS.map((i) => i.sku);
      const products = await tx
        .select({ id: productsTable.id, sku: productsTable.sku })
        .from(productsTable)
        .where(inArray(productsTable.sku, skus));
      const productBySku = new Map(products.map((p) => [p.sku, p.id]));

      // 5. Assign categories (idempotent via ON CONFLICT DO NOTHING)
      const mappings = LOGISTICS_SERVICE_ITEMS.flatMap((item) => {
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

    logger.info("Logistics service items seeded (with category assignments)");
  } catch (err) {
    logger.error({ err }, "Failed to seed logistics service items");
  }
}
