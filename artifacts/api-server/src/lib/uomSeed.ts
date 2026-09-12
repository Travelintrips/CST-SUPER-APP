import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

interface UomRow { id: number; name: string; }

const STANDARD_UOMS: Array<{ name: string; symbol: string; category: string }> = [
  { name: "Gram",      symbol: "g",    category: "weight" },
  { name: "Kilogram",  symbol: "kg",   category: "weight" },
  { name: "Mililiter", symbol: "ml",   category: "volume" },
  { name: "Liter",     symbol: "L",    category: "volume" },
  { name: "Pcs",       symbol: "pcs",  category: "count" },
  { name: "Box",       symbol: "box",  category: "count" },
  { name: "Karton",    symbol: "ctn",  category: "count" },
  { name: "Meter",     symbol: "m",    category: "length" },
  { name: "Yard",      symbol: "yd",   category: "length" },
  { name: "Roll",      symbol: "roll", category: "count" },
];

export async function seedUom(): Promise<void> {
  try {
    const existing = (await db.execute(sql`SELECT id, name FROM uom`))
      .rows as unknown as UomRow[];
    const existingNames = new Set(existing.map((r) => r.name));

    for (const u of STANDARD_UOMS) {
      if (!existingNames.has(u.name)) {
        await db.execute(sql`
          INSERT INTO uom (name, symbol, category)
          VALUES (${u.name}, ${u.symbol}, ${u.category})
          ON CONFLICT (name) DO NOTHING
        `);
        logger.info(`[uomSeed] inserted UOM: ${u.name}`);
      }
    }

    // Re-fetch IDs after insert
    const allRows = (await db.execute(sql`SELECT id, name FROM uom`))
      .rows as unknown as UomRow[];
    const byName: Record<string, number> = {};
    for (const r of allRows) byName[r.name] = r.id;

    const conversions: Array<{ fromName: string; toName: string; factor: string }> = [
      { fromName: "Kilogram",  toName: "Gram",      factor: "1000" },
      { fromName: "Gram",      toName: "Kilogram",  factor: "0.001" },
      { fromName: "Liter",     toName: "Mililiter", factor: "1000" },
      { fromName: "Mililiter", toName: "Liter",     factor: "0.001" },
      { fromName: "Box",       toName: "Pcs",       factor: "12" },
      { fromName: "Karton",    toName: "Pcs",       factor: "24" },
      { fromName: "Karton",    toName: "Box",       factor: "2" },
      { fromName: "Yard",      toName: "Meter",     factor: "0.9144" },
      { fromName: "Meter",     toName: "Yard",      factor: "1.09361" },
    ];

    for (const c of conversions) {
      const fromId = byName[c.fromName];
      const toId = byName[c.toName];
      if (!fromId || !toId) continue;
      await db.execute(sql`
        INSERT INTO uom_conversions (from_uom_id, to_uom_id, factor)
        VALUES (${fromId}, ${toId}, ${c.factor})
        ON CONFLICT (from_uom_id, to_uom_id) DO NOTHING
      `);
    }

    logger.info("[uomSeed] UOM seed complete");
  } catch (err) {
    logger.error({ err }, "[uomSeed] UOM seed failed");
  }
}
