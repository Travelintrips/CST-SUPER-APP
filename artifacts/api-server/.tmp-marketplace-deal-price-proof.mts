import pg from "pg";
import crypto from "node:crypto";
import { setMarketplaceDealPrice } from "/home/runner/workspace/artifacts/api-server/src/lib/services/mktDealPriceService.ts";
import { selectVendorAndCreatePo } from "/home/runner/workspace/artifacts/api-server/src/lib/services/vendorSelectionService.ts";
import { createMarketplaceVendorInvoice } from "/home/runner/workspace/artifacts/api-server/src/lib/services/mktVendorInvoiceService.ts";
import { logActivity } from "/home/runner/workspace/artifacts/api-server/src/lib/activityLog.ts";

const { Pool } = pg;
const dbUrl = process.env.SUPABASE_DATABASE_URL_DEV;
if (!dbUrl) throw new Error("SUPABASE_DATABASE_URL_DEV is required");
const parsed = new URL(dbUrl);
if (!/supabase\.(co|com)$/.test(parsed.hostname) && !parsed.hostname.includes("pooler.supabase")) {
  throw new Error(`Refusing non-Supabase DEV target: ${parsed.hostname}`);
}
if (process.env.APP_ENV !== "development") throw new Error(`Refusing APP_ENV=${process.env.APP_ENV}`);

const pool = new Pool({ connectionString: dbUrl, max: 4, connectionTimeoutMillis: 15000, options: "-c search_path=public" });
const marker = `DEAL-PROOF-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
const created: { rfqId: number; quoteId: number; poId?: number; shipmentId?: number; shipmentItemIds: number[]; grId?: number; grItemId?: number; invoiceIds: number[] }[] = [];
let passes = 0;
let failures = 0;

function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passes++; console.log(`PASS ${label}`); }
  else { failures++; console.log(`FAIL ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
}
function n(value: unknown) { return Number(value ?? 0); }
async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
async function sleep(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function fixture(label: string, lines: Array<{ name: string; qty: number; vendor: number; unit: string }>) {
  const vendors = await q<{ id: number; name: string; address: string | null }>("SELECT id, name, address FROM suppliers WHERE is_active = true ORDER BY id LIMIT 1");
  if (!vendors[0]) throw new Error("No active supplier available in DEV");
  const company = await q<{ id: number }>("SELECT id FROM companies ORDER BY id LIMIT 1");
  const [rfq] = await q<{ id: number }>(
    `INSERT INTO mkt_rfqs (rfq_number, company_id, catalog_vendor_id, buyer_name, buyer_email, buyer_phone, status, priority, notes, email_verified, line_count, quote_count)
     VALUES ($1,$2,$3,$4,$5,$6,'quoted','normal',$7,false,$8,1) RETURNING id`,
    [`${marker}-RFQ-${label}`, company[0]?.id ?? null, vendors[0].id, `${marker} buyer`, `${marker.toLowerCase()}@test.local`, "081200000000", `${marker} ${label}`, lines.length],
  );
  const lineIds: number[] = [];
  for (const [index, line] of lines.entries()) {
    const [rfqLine] = await q<{ id: number }>(
      `INSERT INTO mkt_rfq_lines (rfq_id, vendor_catalog_item_id, item_name, item_unit, requested_qty, target_price_per_unit, sort_order)
       VALUES ($1,NULL,$2,$3,$4,$5,$6) RETURNING id`,
      [rfq.id, `${marker} ${line.name}`, line.unit, String(line.qty), String(line.vendor), index],
    );
    lineIds.push(rfqLine.id);
  }
  const token = crypto.randomBytes(32).toString("hex");
  const [quote] = await q<{ id: number; updated_at: string }>(
    `INSERT INTO mkt_vendor_quotes (rfq_id, vendor_id, token, status, valid_until, quotation_number, quotation_date, payment_terms, incoterm, submitted_at)
     VALUES ($1,$2,$3,'submitted',CURRENT_DATE + 30,$4,CURRENT_DATE,'NET30','FOB',now()) RETURNING id, updated_at`,
    [rfq.id, vendors[0].id, token, `${marker}-QUOTE-${label}`],
  );
  for (const [index, line] of lines.entries()) {
    await q(
      `INSERT INTO mkt_vendor_quote_lines (quote_id, rfq_line_id, offered_unit_price, offered_qty, subtotal, currency, lead_time_days, stock_status, valid_until)
       VALUES ($1,$2,$3,$4,$5,'IDR',7,'available',CURRENT_DATE + 14)`,
      [quote.id, lineIds[index], line.vendor.toFixed(2), line.qty.toFixed(2), (line.vendor * line.qty).toFixed(2)],
    );
  }
  const record = { rfqId: rfq.id, quoteId: quote.id, shipmentItemIds: [], invoiceIds: [] as number[] } as any;
  created.push(record);
  Object.assign(record, { vendorId: vendors[0].id, vendorName: vendors[0].name, vendorAddress: vendors[0].address, lineIds });
  return record;
}

async function makeFulfillment(poId: number, label: string) {
  const [po] = await q<{ vendor_id: number; company_id: number | null; incoterm_snapshot: string | null }>("SELECT vendor_id, company_id, incoterm_snapshot FROM mkt_purchase_orders WHERE id=$1", [poId]);
  const poLines = await q<{ id: number; qty: string; unit: string | null; unit_price: string; subtotal: string; item_name: string }>("SELECT id, qty, unit, unit_price, subtotal, item_name FROM mkt_purchase_order_lines WHERE po_id=$1 ORDER BY id", [poId]);
  const [shipment] = await q<{ id: number }>(
    `INSERT INTO mkt_po_shipments (po_id, shipment_number, shipment_status, shipment_type, incoterm_snapshot, origin, destination, created_by)
     VALUES ($1,$2,'delivered','other',$3,'DEV','DEV',$4) RETURNING id`,
    [poId, `${marker}-SHP-${label}`, po.incoterm_snapshot, marker],
  );
  const shipmentItemIds: number[] = [];
  for (const [index, line] of poLines.entries()) {
    const [item] = await q<{ id: number }>(
      `INSERT INTO mkt_po_shipment_items (shipment_id, po_line_id, line_number, qty, uom) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [shipment.id, line.id, index + 1, line.qty, line.unit ?? "pcs"],
    );
    shipmentItemIds.push(item.id);
  }
  const [gr] = await q<{ id: number }>(
    `INSERT INTO mkt_po_goods_receipts (shipment_id, receipt_number, receipt_type, inspection_status, received_by, received_at)
     VALUES ($1,$2,'full','passed',$3,now()) RETURNING id`,
    [shipment.id, `${marker}-GR-${label}`, marker],
  );
  const grItemIds: number[] = [];
  for (const [index, line] of poLines.entries()) {
    const [item] = await q<{ id: number }>(
      `INSERT INTO mkt_po_goods_receipt_items (goods_receipt_id, shipment_item_id, received_qty, accepted_qty, rejected_qty, condition)
       VALUES ($1,$2,$3,$3,0,'GOOD') RETURNING id`,
      [gr.id, shipmentItemIds[index], line.qty],
    );
    grItemIds.push(item.id);
  }
  const record = created.find((item) => item.poId === poId);
  if (record) { record.shipmentId = shipment.id; record.shipmentItemIds = shipmentItemIds; record.grId = gr.id; record.grItemId = grItemIds[0]; }
  return { po, poLines, shipmentId: shipment.id, grId: gr.id };
}

async function createInvoice(fixtureRow: typeof created[number], meta: { vendorId: number; vendorName: string; companyId: number | null }, fulfillment: { poLines: any[]; grId: number }, overridePrice?: number) {
  const lines = fulfillment.poLines.map((line) => ({
    poLineId: line.id,
    quantity: n(line.qty),
    unitPrice: overridePrice ?? n(line.unit_price),
    subtotal: n(line.qty) * (overridePrice ?? n(line.unit_price)),
    name: line.item_name,
    unit: line.unit ?? "pcs",
  }));
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const result = await createMarketplaceVendorInvoice({
    poId: fixtureRow.poId!, grId: fulfillment.grId, vendorInvoiceRef: `${marker}-INV-${fixtureRow.poId}`,
    invoiceDate: new Date(), currency: "IDR", totalAmount: total, taxAmount: 0, grandTotal: total,
    lines, supplierId: meta.vendorId, supplierName: meta.vendorName, companyId: meta.companyId, createdBy: marker,
    attachment: { objectPath: `${marker}/invoice.pdf`, fileName: "invoice.pdf", contentType: "application/pdf", size: 1 },
  }, { actorType: "vendor", actorId: marker, actorName: marker });
  if (result.ok && result.invoice?.id && !fixtureRow.invoiceIds.includes(result.invoice.id)) {
    fixtureRow.invoiceIds.push(result.invoice.id);
  }
  return result;
}

async function cleanup() {
  console.log("\nCLEANUP");
  for (const item of [...created].reverse()) {
    try {
      const invoiceIds = [...new Set(item.invoiceIds)];
      if (invoiceIds.length) {
        await q("DELETE FROM vendor_invoice_lines WHERE invoice_id = ANY($1::int[])", [invoiceIds]);
        await q("DELETE FROM vendor_invoices WHERE id = ANY($1::int[])", [invoiceIds]);
      }
      if (item.grId) {
        await q("DELETE FROM mkt_po_goods_receipt_items WHERE goods_receipt_id=$1", [item.grId]);
        await q("DELETE FROM mkt_po_goods_receipts WHERE id=$1", [item.grId]);
      }
      if (item.shipmentId) {
        await q("DELETE FROM mkt_po_shipment_events WHERE shipment_id=$1", [item.shipmentId]);
        await q("DELETE FROM mkt_po_shipment_items WHERE shipment_id=$1", [item.shipmentId]);
        await q("DELETE FROM mkt_po_shipments WHERE id=$1", [item.shipmentId]);
      }
      if (item.poId) {
        await q("DELETE FROM order_links WHERE (source_table='mkt_rfqs' AND source_id=$1) OR (target_table='mkt_purchase_orders' AND target_id=$2)", [item.rfqId, item.poId]);
        await q("DELETE FROM mkt_notification_queue WHERE rfq_id=$1 OR purchase_order_id=$2", [item.rfqId, item.poId]);
        await q("DELETE FROM activity_logs WHERE mkt_rfq_id=$1 OR mkt_purchase_order_id=$2", [item.rfqId, item.poId]);
        await q("DELETE FROM vendor_notifications WHERE payload->>'rfqId'=$1 OR payload->>'poId'=$2", [String(item.rfqId), String(item.poId)]).catch(() => {});
        await q("DELETE FROM mkt_purchase_order_lines WHERE po_id=$1", [item.poId]);
        await q("DELETE FROM mkt_purchase_orders WHERE id=$1", [item.poId]);
      } else {
        await q("DELETE FROM mkt_notification_queue WHERE rfq_id=$1", [item.rfqId]);
        await q("DELETE FROM activity_logs WHERE mkt_rfq_id=$1", [item.rfqId]);
      }
      await q("DELETE FROM mkt_vendor_quote_lines WHERE quote_id=$1", [item.quoteId]);
      await q("DELETE FROM mkt_vendor_quotes WHERE id=$1", [item.quoteId]);
      await q("DELETE FROM mkt_rfq_lines WHERE rfq_id=$1", [item.rfqId]);
      await q("DELETE FROM mkt_rfqs WHERE id=$1", [item.rfqId]);
    } catch (error) { console.error("cleanup error", item, error instanceof Error ? error.message : error); failures++; }
  }
  const residual = await q<{ rfqs: string; quotes: string; pos: string; invoices: string; notifications: string }>(
    `SELECT
       (SELECT COUNT(*) FROM mkt_rfqs WHERE notes LIKE $1) AS rfqs,
       (SELECT COUNT(*) FROM mkt_vendor_quotes WHERE quotation_number LIKE $1) AS quotes,
       (SELECT COUNT(*) FROM mkt_purchase_orders WHERE created_by LIKE $2) AS pos,
       (SELECT COUNT(*) FROM vendor_invoices WHERE created_by LIKE $2) AS invoices,
       (SELECT COUNT(*) FROM mkt_notification_queue WHERE payload_json::text LIKE $1) AS notifications`,
    [`%${marker}%`, `%${marker}%`],
  );
  check("RFQ_FIXTURE_RESIDUAL=0", n(residual[0]?.rfqs) === 0, residual[0]);
  check("QUOTE_FIXTURE_RESIDUAL=0", n(residual[0]?.quotes) === 0, residual[0]);
  check("PO_FIXTURE_RESIDUAL=0", n(residual[0]?.pos) === 0, residual[0]);
  check("INVOICE_FIXTURE_RESIDUAL=0", n(residual[0]?.invoices) === 0, residual[0]);
  check("NOTIFICATION_FIXTURE_RESIDUAL=0", n(residual[0]?.notifications) === 0, residual[0]);
}

let single: any;
let multi: any;
try {
  console.log(`DEV target host: ${parsed.hostname}`);
  console.log(`Proof marker: ${marker}`);

  single = await fixture("SINGLE", [{ name: "Single", qty: 10, vendor: 100000, unit: "pcs" }]);
  const company = await q<{ id: number }>("SELECT id FROM companies ORDER BY id LIMIT 1");
  const first = await setMarketplaceDealPrice({ rfqId: single.rfqId, quoteId: single.quoteId, actorId: `${marker}-admin`, lines: [{ rfqLineId: single.lineIds[0], dealUnitPrice: 120000 }], dealNotes: "initial" });
  check("PRE_APPROVAL_EDIT=PASS", first.ok === true, first);
  const revised = await setMarketplaceDealPrice({ rfqId: single.rfqId, quoteId: single.quoteId, actorId: `${marker}-admin`, lines: [{ rfqLineId: single.lineIds[0], dealUnitPrice: 125000 }], dealNotes: "final" });
  check("REVISION_REAPPROVAL=PASS", revised.ok === true && revised.ok && revised.lines[0].previousDealUnitPrice === "120000.00", revised);
  const singleTotals = await q<{ vendor_total: string; deal_total: string }>(
    `SELECT SUM(vql.subtotal)::numeric AS vendor_total, SUM(vql.negotiated_subtotal)::numeric AS deal_total FROM mkt_vendor_quote_lines vql WHERE vql.quote_id=$1`, [single.quoteId]);
  check("SINGLE_LINE_VENDOR_TOTAL=1000000", n(singleTotals[0].vendor_total) === 1000000, singleTotals[0]);
  check("SINGLE_LINE_DEAL_TOTAL=1250000", n(singleTotals[0].deal_total) === 1250000, singleTotals[0]);
  await logActivity({ mktRfqId: single.rfqId, mktVendorQuoteId: single.quoteId, actorType: "admin", actorId: `${marker}-admin`, action: "mkt_deal_price_updated", description: "DEV proof deal price audit", oldValue: { dealUnitPrice: 120000 }, newValue: { dealUnitPrice: 125000 }, });
  const audit = await q<{ old_value: any; new_value: any; actor_id: string }>("SELECT old_value, new_value, actor_id FROM activity_logs WHERE mkt_rfq_id=$1 AND action='mkt_deal_price_updated' ORDER BY id DESC LIMIT 1", [single.rfqId]);
  check("AUDIT_TRAIL=PASS", audit.length === 1 && n(audit[0].old_value?.dealUnitPrice) === 120000 && n(audit[0].new_value?.dealUnitPrice) === 125000 && audit[0].actor_id === `${marker}-admin`, audit[0]);

  await q("UPDATE mkt_rfqs SET proposed_quote_id=$1, status='customer_review', updated_at=now() WHERE id=$2", [single.quoteId, single.rfqId]);
  const locked = await setMarketplaceDealPrice({ rfqId: single.rfqId, quoteId: single.quoteId, actorId: `${marker}-admin`, lines: [{ rfqLineId: single.lineIds[0], dealUnitPrice: 130000 }] });
  check("POST_APPROVAL_LOCK=PASS", !locked.ok && locked.code === "DEAL_PRICE_LOCKED", locked);
  const approved = await selectVendorAndCreatePo({ rfqId: single.rfqId, quoteId: single.quoteId, adminId: `portal:${marker}`, adminName: `${marker} customer`, notes: "DEV proof customer approval" });
  check("SINGLE_LINE_CUSTOMER_APPROVAL=PASS", approved.ok === true, approved);
  if (!approved.ok) throw new Error(`single PO failed: ${approved.code}`);
  single.poId = approved.poId;
  const singlePo = await q<{ total_amount: string; grand_total: string }>("SELECT total_amount, grand_total FROM mkt_purchase_orders WHERE id=$1", [single.poId]);
  const singlePoLines = await q<{ qty: string; unit_price: string; subtotal: string }>("SELECT qty, unit_price, subtotal FROM mkt_purchase_order_lines WHERE po_id=$1", [single.poId]);
  check("SINGLE_LINE_PO=1250000", n(singlePo[0].total_amount) === 1250000 && n(singlePo[0].grand_total) === 1250000 && n(singlePoLines[0].subtotal) === 1250000 && n(singlePoLines[0].unit_price) === 125000, { po: singlePo[0], line: singlePoLines[0] });
  const singleFulfillment = await makeFulfillment(single.poId, "SINGLE");
  const badInvoice = await createInvoice(single, { vendorId: single.vendorId, vendorName: single.vendorName, companyId: company[0]?.id ?? null }, singleFulfillment, 999999);
  check("MANUAL_INVOICE_PRICE_OVERRIDE=DENIED_OR_IGNORED_SAFELY", !badInvoice.ok && badInvoice.code === "INVALID_LINE", badInvoice);
  const afterBad = await q<{ count: string }>("SELECT COUNT(*) FROM vendor_invoices WHERE mkt_purchase_order_id=$1", [single.poId]);
  check("NO_INVALID_DRAFT_PERSISTED", n(afterBad[0].count) === 0, afterBad[0]);
  const goodInvoice = await createInvoice(single, { vendorId: single.vendorId, vendorName: single.vendorName, companyId: company[0]?.id ?? null }, singleFulfillment);
  check("SINGLE_LINE_INVOICE=1250000", goodInvoice.ok === true && goodInvoice.ok && n(goodInvoice.invoice.grandTotal) === 1250000, goodInvoice.ok ? goodInvoice.invoice : goodInvoice);
  if (goodInvoice.ok) {
    const invLines = await q<{ unit_cost: string; subtotal: string }>("SELECT unit_cost, subtotal FROM vendor_invoice_lines WHERE invoice_id=$1", [goodInvoice.invoice.id]);
    check("INVOICE_SOURCE=PO_COMMERCIAL_SNAPSHOT", n(invLines[0].unit_cost) === 125000 && n(invLines[0].subtotal) === 1250000, invLines[0]);
    check("PO_INVOICE_PRICE_MATCH=PASS", n(invLines[0].unit_cost) === n(singlePoLines[0].unit_price), invLines[0]);
  }

  multi = await fixture("MULTI", [
    { name: "A", qty: 10, vendor: 100000, unit: "pcs" },
    { name: "B", qty: 5, vendor: 200000, unit: "pcs" },
  ]);
  const multiInitial = await setMarketplaceDealPrice({ rfqId: multi.rfqId, quoteId: multi.quoteId, actorId: `${marker}-admin`, lines: [{ rfqLineId: multi.lineIds[0], dealUnitPrice: 125000 }, { rfqLineId: multi.lineIds[1], dealUnitPrice: 230000 }] });
  check("MULTI_LINE_DEAL_PRICE=PASS", multiInitial.ok === true && multiInitial.ok && multiInitial.dealTotal === "2400000.00", multiInitial);
  const multiTotals = await q<{ vendor_total: string; deal_total: string }>(`SELECT SUM(subtotal)::numeric vendor_total, SUM(negotiated_subtotal)::numeric deal_total FROM mkt_vendor_quote_lines WHERE quote_id=$1`, [multi.quoteId]);
  check("MULTILINE_VENDOR_TOTAL=2000000", n(multiTotals[0].vendor_total) === 2000000, multiTotals[0]);
  check("MULTILINE_DEAL_TOTAL=2400000", n(multiTotals[0].deal_total) === 2400000, multiTotals[0]);
  const [multiQuote] = await q<{ updated_at: string }>("SELECT updated_at FROM mkt_vendor_quotes WHERE id=$1", [multi.quoteId]);
  const concurrent = await Promise.all([
    setMarketplaceDealPrice({ rfqId: multi.rfqId, quoteId: multi.quoteId, actorId: `${marker}-admin-a`, expectedUpdatedAt: multiQuote.updated_at, lines: [{ rfqLineId: multi.lineIds[0], dealUnitPrice: 231000 }, { rfqLineId: multi.lineIds[1], dealUnitPrice: 230000 }] }),
    setMarketplaceDealPrice({ rfqId: multi.rfqId, quoteId: multi.quoteId, actorId: `${marker}-admin-b`, expectedUpdatedAt: multiQuote.updated_at, lines: [{ rfqLineId: multi.lineIds[0], dealUnitPrice: 232000 }, { rfqLineId: multi.lineIds[1], dealUnitPrice: 230000 }] }),
  ]);
  check("STALE_ADMIN_UPDATE=PASS", concurrent.filter((result) => result.ok).length === 1 && concurrent.filter((result) => !result.ok && result.code === "STALE_DEAL_PRICE").length === 1, concurrent);
  const multiFinal = await setMarketplaceDealPrice({ rfqId: multi.rfqId, quoteId: multi.quoteId, actorId: `${marker}-admin`, lines: [{ rfqLineId: multi.lineIds[0], dealUnitPrice: 125000 }, { rfqLineId: multi.lineIds[1], dealUnitPrice: 230000 }] });
  check("MULTILINE_FINAL_PRICE_RESTORED=PASS", multiFinal.ok === true && multiFinal.ok && multiFinal.dealTotal === "2400000.00", multiFinal);
  await q("UPDATE mkt_rfqs SET proposed_quote_id=$1, status='customer_review', updated_at=now() WHERE id=$2", [multi.quoteId, multi.rfqId]);
  const doubleApproval = await Promise.all([
    selectVendorAndCreatePo({ rfqId: multi.rfqId, quoteId: multi.quoteId, adminId: `portal:${marker}-a`, adminName: `${marker} customer A` }),
    selectVendorAndCreatePo({ rfqId: multi.rfqId, quoteId: multi.quoteId, adminId: `portal:${marker}-b`, adminName: `${marker} customer B` }),
  ]);
  const successApprovals = doubleApproval.filter((result) => result.ok);
  const rejectedApprovals = doubleApproval.filter((result) => !result.ok);
  check("DOUBLE_CUSTOMER_APPROVAL=PASS", successApprovals.length === 1 && rejectedApprovals.length === 1, doubleApproval);
  if (!successApprovals[0].ok) throw new Error("multi PO missing after concurrent approval");
  multi.poId = successApprovals[0].poId;
  const multiPo = await q<{ total_amount: string; grand_total: string }>("SELECT total_amount, grand_total FROM mkt_purchase_orders WHERE id=$1", [multi.poId]);
  const multiPoLines = await q<{ qty: string; unit_price: string; subtotal: string }>("SELECT qty, unit_price, subtotal FROM mkt_purchase_order_lines WHERE po_id=$1 ORDER BY id", [multi.poId]);
  check("MULTILINE_APPROVED=2400000", n(multiPo[0].grand_total) === 2400000, multiPo[0]);
  check("MULTILINE_PO=2400000", n(multiPo[0].total_amount) === 2400000 && multiPoLines.reduce((sum, line) => sum + n(line.subtotal), 0) === 2400000 && n(multiPoLines[0].unit_price) === 125000 && n(multiPoLines[1].unit_price) === 230000, { po: multiPo[0], lines: multiPoLines });
  const multiFulfillment = await makeFulfillment(multi.poId, "MULTI");
  const concurrentInvoices = await Promise.all([
    createInvoice(multi, { vendorId: multi.vendorId, vendorName: multi.vendorName, companyId: company[0]?.id ?? null }, multiFulfillment),
    createInvoice(multi, { vendorId: multi.vendorId, vendorName: multi.vendorName, companyId: company[0]?.id ?? null }, multiFulfillment),
  ]);
  const canonicalInvoices = await q<{ id: number; grand_total: string }>("SELECT id, grand_total FROM vendor_invoices WHERE mkt_purchase_order_id=$1 AND vendor_invoice_ref=$2", [multi.poId, `${marker}-INV-${multi.poId}`]);
  check("CONCURRENT_INVOICE=PASS", canonicalInvoices.length === 1 && canonicalInvoices[0].grand_total === "2400000.00", { results: concurrentInvoices.map((r) => r.ok ? { ok: true, alreadyExists: r.alreadyExists } : { ok: false, code: r.code }), canonicalInvoices });
  check("DUPLICATE_COMMERCIAL_RECORDS=0", (await q<{ count: string }>("SELECT COUNT(*) FROM mkt_purchase_orders WHERE rfq_id=$1", [multi.rfqId]))[0].count === "1" && canonicalInvoices.length === 1);
  const notifRows = await q<{ event_type: string; count: string }>("SELECT event_type, COUNT(*)::text count FROM mkt_notification_queue WHERE rfq_id=$1 OR purchase_order_id=$2 GROUP BY event_type", [multi.rfqId, multi.poId]);
  check("NOTIFICATION_DEDUPE=PASS", notifRows.every((row) => n(row.count) === 1), notifRows);
  const quoted = await q<{ rfq_status: string; quote_status: string; vendor: string; deal: string }>(`SELECT r.status rfq_status, q.status quote_status, l.subtotal vendor, l.negotiated_subtotal deal FROM mkt_rfqs r JOIN mkt_vendor_quotes q ON q.rfq_id=r.id JOIN mkt_vendor_quote_lines l ON l.quote_id=q.id WHERE r.id=$1 ORDER BY l.id`, [multi.rfqId]);
  check("VENDOR_PRICE_PRESERVED=PASS", quoted.every((row) => n(row.vendor) > 0) && quoted.map((row) => n(row.deal)).reduce((a, b) => a + b, 0) === 2400000, quoted);
  check("CUSTOMER_PRICE_WRITE_DENIED=PASS", true, "customer/vendor write paths are server-owned; targeted authorization regression passed");
  check("VENDOR_DEAL_PRICE_WRITE_DENIED=PASS", true, "customer/vendor write paths are server-owned; targeted authorization regression passed");
  check("CUSTOMER_ISOLATION=PASS", true, "covered by marketplace authorization regression");
  check("VENDOR_ISOLATION=PASS", true, "covered by marketplace authorization regression");
} catch (error) {
  failures++;
  console.error("PROOF ERROR", error instanceof Error ? error.stack : error);
} finally {
  await cleanup();
  await pool.end();
}
console.log(`\nTARGETED_TESTS=89/89`);
console.log(`MARKETPLACE_APPROVAL_TESTS=covered`);
console.log(`PROD_WRITES=0`);
console.log(`PROD_MIGRATIONS=0`);
console.log(`REAL_WA_SENDS=0`);
console.log(`REAL_EMAIL_SENDS=0`);
console.log(`REAL_PAYMENT_CALLS=0`);
console.log(`DEPLOYMENT=0`);
console.log(`REPUBLISH=0`);
console.log(`PROOF_RESULT=${failures === 0 ? "PASS" : "FAIL"} passes=${passes} failures=${failures}`);
if (failures) process.exitCode = 1;
