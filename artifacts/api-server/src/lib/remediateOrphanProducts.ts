import { db, productsTable, productCategoriesTable, productCategoryMapTable } from "@workspace/db";
import { sql, notExists } from "drizzle-orm";
import { logger } from "./logger.js";

const FALLBACK_CATEGORY_NAME = "Lainnya";

export async function remediateOrphanProducts(): Promise<void> {
  try {
    const orphans = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable)
      .where(
        notExists(
          db
            .select({ one: sql`1` })
            .from(productCategoryMapTable)
            .where(sql`${productCategoryMapTable.productId} = ${productsTable.id}`)
        )
      );

    if (orphans.length === 0) {
      logger.info("remediateOrphanProducts: no orphan products found");
      return;
    }

    logger.warn(
      { orphanIds: orphans.map((p) => p.id), count: orphans.length },
      `remediateOrphanProducts: found ${orphans.length} product(s) with no category — assigning to "${FALLBACK_CATEGORY_NAME}"`
    );

    await db.transaction(async (tx) => {
      const [fallbackCat] = await tx
        .insert(productCategoriesTable)
        .values({ name: FALLBACK_CATEGORY_NAME })
        .onConflictDoNothing()
        .returning({ id: productCategoriesTable.id });

      const catRows = await tx
        .select({ id: productCategoriesTable.id })
        .from(productCategoriesTable)
        .where(sql`${productCategoriesTable.name} = ${FALLBACK_CATEGORY_NAME}`)
        .limit(1);

      const categoryId = fallbackCat?.id ?? catRows[0]?.id;
      if (!categoryId) {
        logger.error("remediateOrphanProducts: could not find or create fallback category");
        return;
      }

      await tx
        .insert(productCategoryMapTable)
        .values(orphans.map((p) => ({ productId: p.id, categoryId })))
        .onConflictDoNothing();
    });

    logger.info(
      { count: orphans.length, category: FALLBACK_CATEGORY_NAME },
      `remediateOrphanProducts: assigned ${orphans.length} orphan product(s) to "${FALLBACK_CATEGORY_NAME}"`
    );
  } catch (err) {
    logger.error({ err }, "remediateOrphanProducts: failed");
  }
}
