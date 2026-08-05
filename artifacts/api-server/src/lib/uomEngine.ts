/**
 * UOM Conversion Engine
 * Converts qty between any two UOMs using the uom_conversions table.
 * Supports direct conversion and reverse (1/factor).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export class UomConversionError extends Error {
  constructor(fromUomId: number, toUomId: number) {
    super(`Tidak ada konversi dari UOM ID ${fromUomId} ke UOM ID ${toUomId}`);
    this.name = "UomConversionError";
  }
}

/**
 * Convert qty from one UOM to another.
 * Looks up direct conversion first, then reverse.
 * Returns converted qty (rounded to 4 decimal places).
 * If fromUomId === toUomId, returns qty unchanged.
 */
export async function convertQty(
  qty: number,
  fromUomId: number | null | undefined,
  toUomId: number | null | undefined,
): Promise<number> {
  if (!fromUomId || !toUomId || fromUomId === toUomId) return qty;

  // Direct conversion
  const direct = (await db.execute(sql`
    SELECT factor::float FROM uom_conversions
    WHERE from_uom_id = ${fromUomId} AND to_uom_id = ${toUomId}
    LIMIT 1
  `)).rows[0] as { factor: number } | undefined;

  if (direct) {
    return Math.round(qty * Number(direct.factor) * 10000) / 10000;
  }

  // Reverse conversion
  const reverse = (await db.execute(sql`
    SELECT factor::float FROM uom_conversions
    WHERE from_uom_id = ${toUomId} AND to_uom_id = ${fromUomId}
    LIMIT 1
  `)).rows[0] as { factor: number } | undefined;

  if (reverse && Number(reverse.factor) !== 0) {
    return Math.round((qty / Number(reverse.factor)) * 10000) / 10000;
  }

  throw new UomConversionError(fromUomId, toUomId);
}

/**
 * Get factor from fromUomId -> toUomId (direct or reverse).
 * Returns null if no conversion exists.
 */
export async function getConversionFactor(
  fromUomId: number,
  toUomId: number,
): Promise<number | null> {
  if (fromUomId === toUomId) return 1;

  const direct = (await db.execute(sql`
    SELECT factor::float FROM uom_conversions
    WHERE from_uom_id = ${fromUomId} AND to_uom_id = ${toUomId}
    LIMIT 1
  `)).rows[0] as { factor: number } | undefined;

  if (direct) return Number(direct.factor);

  const reverse = (await db.execute(sql`
    SELECT factor::float FROM uom_conversions
    WHERE from_uom_id = ${toUomId} AND to_uom_id = ${fromUomId}
    LIMIT 1
  `)).rows[0] as { factor: number } | undefined;

  if (reverse && Number(reverse.factor) !== 0) return 1 / Number(reverse.factor);

  return null;
}

/**
 * Seed default UOMs and conversions.
 * Called once at startup. Idempotent.
 */
export async function seedDefaultUom() {
  // Insert default UOMs (ON CONFLICT DO NOTHING)
  await db.execute(sql`
    INSERT INTO uom (name, symbol, category) VALUES
      ('pcs',     'pcs',  'count'),
      ('lusin',   'lsn',  'count'),
      ('kodi',    'kdi',  'count'),
      ('gross',   'grs',  'count'),
      ('box',     'box',  'count'),
      ('carton',  'ctn',  'count'),
      ('pallet',  'plt',  'count'),
      ('roll',    'rol',  'count'),
      ('meter',   'm',    'length'),
      ('yard',    'yd',   'length'),
      ('cm',      'cm',   'length'),
      ('kg',      'kg',   'weight'),
      ('gram',    'g',    'weight'),
      ('ton',     'ton',  'weight'),
      ('liter',   'L',    'volume'),
      ('ml',      'ml',   'volume'),
      ('cup',     'cup',  'volume')
    ON CONFLICT (name) DO NOTHING
  `);

  // Insert default conversions (ON CONFLICT DO NOTHING)
  await db.execute(sql`
    INSERT INTO uom_conversions (from_uom_id, to_uom_id, factor)
    SELECT f.id, t.id, conv.factor FROM (VALUES
      ('lusin',   'pcs',    12),
      ('kodi',    'pcs',    20),
      ('gross',   'lusin',  12),
      ('gross',   'pcs',    144),
      ('box',     'pcs',    12),
      ('carton',  'box',    12),
      ('pallet',  'carton', 40),
      ('yard',    'meter',  0.9144),
      ('kg',      'gram',   1000),
      ('ton',     'kg',     1000),
      ('liter',   'ml',     1000),
      ('cm',      'meter',  0.01)
    ) AS conv(from_name, to_name, factor)
    JOIN uom f ON f.name = conv.from_name
    JOIN uom t ON t.name = conv.to_name
    ON CONFLICT (from_uom_id, to_uom_id) DO NOTHING
  `);

  console.log("[uom] Seed defaults done");
}
