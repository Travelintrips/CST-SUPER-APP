/**
 * One-time migration: fix logistic_orders yang tersimpan dengan PPN inklusif.
 *
 * Formula lama (inklusif): subtotal = grandTotal / 1.11, tax = grandTotal - subtotal
 * Formula baru (eksklusif): subtotal = DPP, tax = DPP × 11%, grandTotal = DPP + tax
 *
 * Strategi per order:
 *  - Jika ada items → DPP = sum(item.subtotal)
 *  - Jika tidak ada items, tapi grand_total > 0 → DPP = grand_total lama
 *    (grand_total lama adalah harga produk, bukan total inklusif)
 *
 * Jalankan: npx tsx scripts/fix-inclusive-ppn.ts
 * Tambahkan --dry-run untuk preview tanpa mengubah DB.
 */

import { db, logisticOrdersTable, logisticOrderItemsTable } from "@workspace/db";
import { eq, gt, sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");
const TAX_RATE = 0.11;

function roundCents(n: number) {
  return Math.round(n);
}

async function main() {
  console.log(`\n=== fix-inclusive-ppn ===`);
  console.log(`Mode : ${DRY_RUN ? "DRY RUN (tidak ada perubahan)" : "LIVE (menulis ke DB)"}\n`);

  // Ambil semua order yang punya tax > 0 (order dengan PPN)
  const orders = await db
    .select({
      id: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      orderType: (logisticOrdersTable as any).orderType,
      subtotal: logisticOrdersTable.subtotal,
      tax: logisticOrdersTable.tax,
      grandTotal: logisticOrdersTable.grandTotal,
    })
    .from(logisticOrdersTable)
    .where(gt(logisticOrdersTable.tax, "0"));

  console.log(`Ditemukan ${orders.length} order dengan tax > 0\n`);

  let fixed = 0, skipped = 0, errors = 0;

  for (const order of orders) {
    const oldSubtotal  = Number(order.subtotal ?? 0);
    const oldTax       = Number(order.tax ?? 0);
    const oldGrandTotal = Number(order.grandTotal ?? 0);

    // Cek apakah ini sudah eksklusif: DPP + DPP×11% = grandTotal
    const expectedGrandIfExclusive = roundCents(oldSubtotal + oldSubtotal * TAX_RATE);
    if (expectedGrandIfExclusive === roundCents(oldGrandTotal)) {
      // Sudah eksklusif — skip
      skipped++;
      continue;
    }

    // Ambil item subtotals
    const items = await db
      .select({ subtotal: logisticOrderItemsTable.subtotal })
      .from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, order.id));

    const itemsSum = items.reduce((s, i) => s + Number(i.subtotal ?? 0), 0);

    // Tentukan DPP baru
    let newDpp: number;
    if (itemsSum > 0) {
      // Order punya item — DPP = sum item subtotals
      newDpp = itemsSum;
    } else if (oldGrandTotal > 0) {
      // Tidak ada item — DPP = grandTotal lama (harga produk)
      newDpp = oldGrandTotal;
    } else {
      console.log(`  SKIP  ${order.orderNumber} — grandTotal=0, tidak ada items`);
      skipped++;
      continue;
    }

    const newTax       = roundCents(newDpp * TAX_RATE);
    const newGrandTotal = newDpp + newTax;

    console.log(
      `  FIX   ${order.orderNumber.padEnd(22)}` +
      `  DPP: ${String(roundCents(oldSubtotal)).padStart(10)} → ${String(newDpp).padStart(10)}` +
      `  TAX: ${String(roundCents(oldTax)).padStart(8)} → ${String(newTax).padStart(8)}` +
      `  GT:  ${String(roundCents(oldGrandTotal)).padStart(10)} → ${String(newGrandTotal).padStart(10)}`
    );

    if (!DRY_RUN) {
      try {
        await db
          .update(logisticOrdersTable)
          .set({
            subtotal:   String(newDpp),
            tax:        String(newTax),
            grandTotal: String(newGrandTotal),
          })
          .where(eq(logisticOrdersTable.id, order.id));
        fixed++;
      } catch (err) {
        console.error(`  ERROR ${order.orderNumber}:`, err);
        errors++;
      }
    } else {
      fixed++;
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`Difix   : ${fixed}`);
  console.log(`Diskip  : ${skipped} (sudah eksklusif)`);
  console.log(`Error   : ${errors}`);
  if (DRY_RUN) {
    console.log(`\nJalankan tanpa --dry-run untuk terapkan perubahan.`);
  } else {
    console.log(`\nSelesai.`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
