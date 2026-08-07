import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, endPool } from "@workspace/db";
import {
  createMarketplaceVendorInvoice,
  submitMarketplaceVendorInvoice,
} from "../lib/services/mktVendorInvoiceService.js";

const actor = { actorType: "vendor" as const, actorId: "sprint7-runtime", actorName: "Sprint 7 Runtime" };
const runTag = `s7-${Date.now()}`;
const created: { rfq?: number; quote?: number; po?: number; poLine?: number; shipment?: number; shipmentItem?: number; gr?: number; invoices: number[] } = { invoices: [] };

async function rows<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

async function one<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await rows<T>(query);
  if (!result[0]) throw new Error("Expected one row");
  return result[0];
}

async function createFixture() {
  const vendor = await one<{ id: number; name: string }>(sql`
    SELECT id, name FROM suppliers WHERE is_active = true ORDER BY id LIMIT 1
  `);
  const rfq = await one<{ id: number }>(sql`
    INSERT INTO mkt_rfqs
      (rfq_number, catalog_vendor_id, buyer_name, buyer_email, status, approval_status, priority, line_count, quote_count, notes)
    VALUES
      (${`S7-RFQ-${runTag}`}, ${vendor.id}, ${`Sprint 7 ${runTag}`}, ${`${runTag}@test.local`},
       'submitted', 'none', 'normal', 1, 1, 'temporary Sprint 7 runtime fixture')
    RETURNING id
  `);
  created.rfq = rfq.id;
  const quote = await one<{ id: number }>(sql`
    INSERT INTO mkt_vendor_quotes
      (rfq_id, vendor_id, token, status, valid_until, quotation_number, quotation_date)
    VALUES
      (${rfq.id}, ${vendor.id}, ${runTag.repeat(3).slice(0, 64)}, 'selected', NOW() + INTERVAL '1 day',
       ${`S7-QUOTE-${runTag}`}, CURRENT_DATE)
    RETURNING id
  `);
  created.quote = quote.id;
  const po = await one<{ id: number }>(sql`
    INSERT INTO mkt_purchase_orders
      (po_number, rfq_id, quote_id, vendor_id, status, total_amount, tax_amount, grand_total,
       vendor_name_snapshot, currency_snapshot, vendor_token)
    VALUES
      (${`S7-PO-${runTag}`}, ${rfq.id}, ${quote.id}, ${vendor.id}, 'in_transit', '100000.00', '11000.00', '111000.00',
       ${vendor.name}, 'IDR', ${`${runTag}-token`.padEnd(64, "x")})
    RETURNING id
  `);
  created.po = po.id;
  const poLine = await one<{ id: number }>(sql`
    INSERT INTO mkt_purchase_order_lines (po_id, item_name, qty, unit, unit_price, subtotal)
    VALUES (${po.id}, 'Sprint 7 test item', '2', 'pcs', '50000.00', '100000.00')
    RETURNING id
  `);
  created.poLine = poLine.id;
  const shipment = await one<{ id: number }>(sql`
    INSERT INTO mkt_po_shipments
      (po_id, shipment_number, shipment_status, origin, destination)
    VALUES (${po.id}, ${`S7-SHP-${runTag}`}, 'delivered', 'Test origin', 'Test destination')
    RETURNING id
  `);
  created.shipment = shipment.id;
  const shipmentItem = await one<{ id: number }>(sql`
    INSERT INTO mkt_po_shipment_items (shipment_id, po_line_id, line_number, qty, uom)
    VALUES (${shipment.id}, ${poLine.id}, 1, '2', 'pcs')
    RETURNING id
  `);
  created.shipmentItem = shipmentItem.id;
  await db.execute(sql`
    INSERT INTO mkt_po_shipment_events
      (shipment_id, event_sequence, event_type, attachment_object_path, actor_type)
    VALUES (${shipment.id}, 1, 'pod_uploaded', ${`/objects/uploads/${runTag}.pdf`}, 'system')
  `);
  const gr = await one<{ id: number }>(sql`
    INSERT INTO mkt_po_goods_receipts
      (shipment_id, receipt_number, receipt_type, inspection_status, received_by)
    VALUES (${shipment.id}, ${`S7-GR-${runTag}`}, 'full', 'passed', 'sprint7-runtime')
    RETURNING id
  `);
  created.gr = gr.id;
  await db.execute(sql`
    INSERT INTO mkt_po_goods_receipt_items
      (goods_receipt_id, shipment_item_id, received_qty, accepted_qty, rejected_qty, condition)
    VALUES (${gr.id}, ${shipmentItem.id}, '2', '2', '0', 'GOOD')
  `);
  return { vendor, rfqId: rfq.id, quoteId: quote.id, poId: po.id, poLineId: poLine.id, shipmentId: shipment.id, grId: gr.id };
}

function input(fixture: Awaited<ReturnType<typeof createFixture>>, ref: string, overrides: Record<string, unknown> = {}) {
  return {
    poId: fixture.poId,
    grId: fixture.grId,
    vendorInvoiceRef: ref,
    invoiceDate: new Date("2026-08-07T00:00:00Z"),
    currency: "IDR",
    totalAmount: 100000,
    taxAmount: 11000,
    grandTotal: 111000,
    lines: [{ poLineId: fixture.poLineId, quantity: 2, unitPrice: 50000, subtotal: 100000, taxAmount: 11000, name: "Sprint 7 test item", unit: "pcs" }],
    attachment: { objectPath: `/objects/uploads/${runTag}-${ref}.pdf`, fileName: `${ref}.pdf`, contentType: "application/pdf", size: 16 },
    supplierId: fixture.vendor.id,
    supplierName: fixture.vendor.name,
    createdBy: "sprint7-runtime",
    ...overrides,
  };
}

async function cleanup() {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (created.invoices.length) {
    await db.execute(sql`DELETE FROM vendor_invoice_lines WHERE invoice_id IN (${sql.join(created.invoices.map((id) => sql`${id}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM vendor_invoices WHERE id IN (${sql.join(created.invoices.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (created.gr) {
    await db.execute(sql`DELETE FROM mkt_po_goods_receipt_items WHERE goods_receipt_id = ${created.gr}`);
    await db.execute(sql`DELETE FROM mkt_po_goods_receipts WHERE id = ${created.gr}`);
  }
  if (created.shipment) {
    await db.execute(sql`DELETE FROM mkt_po_shipment_events WHERE shipment_id = ${created.shipment}`);
    await db.execute(sql`DELETE FROM mkt_po_shipment_items WHERE shipment_id = ${created.shipment}`);
    await db.execute(sql`DELETE FROM mkt_po_shipments WHERE id = ${created.shipment}`);
  }
  if (created.poLine) await db.execute(sql`DELETE FROM mkt_purchase_order_lines WHERE id = ${created.poLine}`);
  if (created.po) {
    await db.execute(sql`DELETE FROM mkt_notification_queue WHERE purchase_order_id = ${created.po}`);
    await db.execute(sql`DELETE FROM activity_logs WHERE mkt_purchase_order_id = ${created.po}`);
    await db.execute(sql`DELETE FROM mkt_purchase_orders WHERE id = ${created.po}`);
  }
  if (created.quote) {
    await db.execute(sql`DELETE FROM mkt_vendor_quotes WHERE id = ${created.quote}`);
    await db.execute(sql`DELETE FROM activity_logs WHERE mkt_vendor_quote_id = ${created.quote}`);
  }
  if (created.rfq) {
    await db.execute(sql`DELETE FROM mkt_rfq_lines WHERE rfq_id = ${created.rfq}`);
    await db.execute(sql`DELETE FROM mkt_rfqs WHERE id = ${created.rfq}`);
  }
}

describe("Sprint 7 runtime vendor invoice gates", () => {
  it("passes happy path, negative cases, retries, concurrency, integrity, and cleanup", async () => {
    const fixture = await createFixture();
    const before = await one(sql`
      SELECT
        (SELECT row_to_json(p) FROM mkt_purchase_orders p WHERE p.id = ${fixture.poId}) AS po,
        (SELECT row_to_json(l) FROM mkt_purchase_order_lines l WHERE l.id = ${fixture.poLineId}) AS po_line,
        (SELECT row_to_json(s) FROM mkt_po_shipments s WHERE s.id = ${fixture.shipmentId}) AS shipment,
        (SELECT row_to_json(g) FROM mkt_po_goods_receipts g WHERE g.id = ${fixture.grId}) AS gr
    `);

    const happy = await createMarketplaceVendorInvoice(input(fixture, "S7-HAPPY"), actor);
    expect(happy.ok).toBe(true);
    if (!happy.ok) return;
    created.invoices.push(happy.invoice.id);
    expect(happy.invoice.currency).toBe("IDR");
    expect(happy.invoice.totalAmount).toBe("100000.00");
    expect(happy.invoice.grandTotal).toBe("111000.00");
    expect(happy.lines).toHaveLength(1);
    expect(happy.lines[0].quantity).toBe("2.00");
    expect(happy.lines[0].unitCost).toBe("50000.00");

    const duplicate = await createMarketplaceVendorInvoice(input(fixture, "S7-HAPPY"), actor);
    expect(duplicate.ok).toBe(true);
    expect(duplicate.ok && duplicate.alreadyExists).toBe(true);
    expect(duplicate.ok && duplicate.invoice.id).toBe(happy.invoice.id);

    const noGr = await createMarketplaceVendorInvoice(input(fixture, "S7-NO-GR", { grId: 999999999 }), actor);
    expect(noGr).toMatchObject({ ok: false, code: "GR_NOT_FOUND" });
    const wrongVendor = await createMarketplaceVendorInvoice(input(fixture, "S7-WRONG-VENDOR", { supplierId: fixture.vendor.id + 999999 }), actor);
    expect(wrongVendor).toMatchObject({ ok: false, code: "PO_NOT_FOUND" });
    const badCurrency = await createMarketplaceVendorInvoice(input(fixture, "S7-BAD-CURRENCY", { currency: "US" }), actor);
    expect(badCurrency).toMatchObject({ ok: false, code: "INVALID_CURRENCY" });

    const submitted = await submitMarketplaceVendorInvoice(happy.invoice.id, actor);
    expect(submitted.ok).toBe(true);
    expect(submitted.ok && submitted.invoice.status).toBe("ready_for_ap");
    expect(submitted.ok && submitted.match?.status).toBe("passed");
    const retrySubmit = await submitMarketplaceVendorInvoice(happy.invoice.id, actor);
    expect(retrySubmit.ok).toBe(true);
    expect(retrySubmit.ok && retrySubmit.alreadyExists).toBe(true);

    const failedCases = [
      ["S7-QTY", { lines: [{ poLineId: fixture.poLineId, quantity: 1, unitPrice: 50000, subtotal: 50000, taxAmount: 5500 }] }, { totalAmount: 50000, taxAmount: 5500, grandTotal: 55500 }],
      ["S7-PRICE", { lines: [{ poLineId: fixture.poLineId, quantity: 2, unitPrice: 60000, subtotal: 120000, taxAmount: 13200 }] }, { totalAmount: 120000, taxAmount: 13200, grandTotal: 133200 }],
      ["S7-CURRENCY", { currency: "USD" }],
    ] as const;
    for (const [ref, lineOverride, headerOverride] of failedCases) {
      const draft = await createMarketplaceVendorInvoice(input(fixture, ref, { ...lineOverride, ...headerOverride }), actor);
      expect(draft.ok).toBe(true);
      if (!draft.ok) continue;
      created.invoices.push(draft.invoice.id);
      const result = await submitMarketplaceVendorInvoice(draft.invoice.id, actor);
      expect(result.ok).toBe(true);
      expect(result.ok && result.invoice.status).toBe("submitted");
      expect(result.ok && result.match?.status).toBe("failed");
    }

    const concurrentDraft = await createMarketplaceVendorInvoice(input(fixture, "S7-CONCURRENT"), actor);
    expect(concurrentDraft.ok).toBe(true);
    if (!concurrentDraft.ok) return;
    created.invoices.push(concurrentDraft.invoice.id);
    const concurrent = await Promise.all([
      submitMarketplaceVendorInvoice(concurrentDraft.invoice.id, actor),
      submitMarketplaceVendorInvoice(concurrentDraft.invoice.id, actor),
    ]);
    expect(concurrent.every((result) => result.ok)).toBe(true);
    expect(concurrent.every((result) => result.ok && result.invoice.status === "ready_for_ap")).toBe(true);
    expect(concurrent.filter((result) => result.ok && result.alreadyExists).length).toBe(1);

    const concurrentCreates = await Promise.all([
      createMarketplaceVendorInvoice(input(fixture, "S7-RACE"), actor),
      createMarketplaceVendorInvoice(input(fixture, "S7-RACE"), actor),
    ]);
    expect(concurrentCreates.every((result) => result.ok)).toBe(true);
    const raceIds = concurrentCreates.filter((result) => result.ok && !result.alreadyExists).map((result) => result.invoice.id);
    created.invoices.push(...raceIds);
    expect(raceIds).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await one(sql`
      SELECT
        (SELECT row_to_json(p) FROM mkt_purchase_orders p WHERE p.id = ${fixture.poId}) AS po,
        (SELECT row_to_json(l) FROM mkt_purchase_order_lines l WHERE l.id = ${fixture.poLineId}) AS po_line,
        (SELECT row_to_json(s) FROM mkt_po_shipments s WHERE s.id = ${fixture.shipmentId}) AS shipment,
        (SELECT row_to_json(g) FROM mkt_po_goods_receipts g WHERE g.id = ${fixture.grId}) AS gr
    `);
    expect(after.po).toEqual(before.po);
    expect(after.po_line).toEqual(before.po_line);
    expect(after.shipment).toEqual(before.shipment);
    expect(after.gr).toEqual(before.gr);

    const eventRows = await rows<{ action: string; count: string }>(sql`
      SELECT action, COUNT(*)::text AS count
      FROM activity_logs
      WHERE mkt_purchase_order_id = ${fixture.poId}
        AND action IN ('invoice_uploaded', 'invoice_ready_for_ap', 'three_way_match_passed', 'three_way_match_failed')
      GROUP BY action
    `);
    expect(Number(eventRows.find((row) => row.action === "invoice_uploaded")?.count ?? 0)).toBe(3);
    expect(Number(eventRows.find((row) => row.action === "invoice_ready_for_ap")?.count ?? 0)).toBe(2);
    expect(Number(eventRows.find((row) => row.action === "three_way_match_passed")?.count ?? 0)).toBe(2);
    expect(Number(eventRows.find((row) => row.action === "three_way_match_failed")?.count ?? 0)).toBe(3);

    const queueRows = await rows<{ deduplication_key: string; count: string }>(sql`
      SELECT deduplication_key, COUNT(*)::text AS count
      FROM mkt_notification_queue
      WHERE purchase_order_id = ${fixture.poId}
        AND deduplication_key LIKE 'mkt_vendor_invoice:%'
      GROUP BY deduplication_key
    `);
    expect(queueRows.every((row) => Number(row.count) === 1)).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await endPool();
  });
});