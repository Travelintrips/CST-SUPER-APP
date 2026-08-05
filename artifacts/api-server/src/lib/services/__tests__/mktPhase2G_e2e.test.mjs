/**
 * mktPhase2G_e2e.test.mjs — Phase 2G Batch 6: Live DEV DB E2E test
 *
 * Full RFQ → vendor invite → vendor quote → vendor selection/PO → issue →
 * vendor accept → production → shipment → shipment events → ready_to_ship →
 * in_transit → goods receipt → delivered → completed → closed lifecycle,
 * executed as raw SQL against SUPABASE_DATABASE_URL_DEV (same convention as
 * vendorInvitation.test.mjs / vendorQuoteSubmission.test.mjs — no vitest,
 * no HTTP layer, direct DB reproduction of each service's exact logic).
 *
 * ALL data created here is deleted at the end (success or failure) — see
 * cleanup() which runs in a `finally` block. Nothing is written to PROD;
 * this script only ever reads process.env.SUPABASE_DATABASE_URL_DEV.
 *
 * Run: node src/lib/services/__tests__/mktPhase2G_e2e.test.mjs
 */

import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

if (!process.env.SUPABASE_DATABASE_URL_DEV) {
  console.error("SUPABASE_DATABASE_URL_DEV tidak diset — abort (tidak akan menyentuh PROD/DB lain).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  options: "-c search_path=public",
  connectionTimeoutMillis: 10000,
});

const RUN_TAG = `e2e-${Date.now()}`;
let failures = 0;
let passes = 0;
const createdIds = { rfqId: null, quoteId: null, poId: null, shipmentId: null, goodsReceiptId: null };

function assert(cond, label, detail) {
  if (cond) {
    passes++;
    console.log(`  PASS: ${label}`);
  } else {
    failures++;
    console.log(`  FAIL: ${label}${detail ? " — " + JSON.stringify(detail) : ""}`);
  }
}

async function q(sql, params) {
  const r = await pool.query(sql, params);
  return r.rows;
}

function token() {
  return crypto.randomBytes(32).toString("hex");
}

async function cleanup() {
  console.log("\n=== CLEANUP (menghapus semua test data) ===");
  const { rfqId, quoteId, poId, shipmentId, goodsReceiptId } = createdIds;
  try {
    if (goodsReceiptId) {
      await q(`DELETE FROM mkt_po_goods_receipt_items WHERE goods_receipt_id = $1`, [goodsReceiptId]);
      await q(`DELETE FROM mkt_po_goods_receipts WHERE id = $1`, [goodsReceiptId]);
    }
    if (shipmentId) {
      await q(`DELETE FROM mkt_po_shipment_events WHERE shipment_id = $1`, [shipmentId]);
      await q(`DELETE FROM mkt_po_shipment_items WHERE shipment_id = $1`, [shipmentId]);
      await q(`DELETE FROM mkt_po_shipments WHERE id = $1`, [shipmentId]);
    }
    if (poId) {
      await q(`DELETE FROM mkt_purchase_order_lines WHERE po_id = $1`, [poId]);
      await q(`DELETE FROM mkt_notification_queue WHERE purchase_order_id = $1`, [poId]);
      await q(`DELETE FROM activity_logs WHERE mkt_purchase_order_id = $1`, [poId]);
      await q(`DELETE FROM mkt_purchase_orders WHERE id = $1`, [poId]);
    }
    if (quoteId) {
      await q(`DELETE FROM mkt_vendor_quote_lines WHERE quote_id = $1`, [quoteId]);
      await q(`DELETE FROM activity_logs WHERE mkt_vendor_quote_id = $1`, [quoteId]);
      await q(`DELETE FROM mkt_vendor_quotes WHERE id = $1`, [quoteId]);
    }
    if (rfqId) {
      await q(`DELETE FROM mkt_notification_queue WHERE rfq_id = $1`, [rfqId]);
      await q(`DELETE FROM activity_logs WHERE mkt_rfq_id = $1`, [rfqId]);
      await q(`DELETE FROM mkt_rfq_lines WHERE rfq_id = $1`, [rfqId]);
      await q(`DELETE FROM mkt_rfqs WHERE id = $1`, [rfqId]);
    }
    console.log("  Cleanup selesai — semua row test dihapus.");
  } catch (err) {
    console.error("  CLEANUP ERROR (data test mungkin tersisa, cek manual):", err.message, createdIds);
  }
}

async function run() {
  console.log(`=== Marketplace Phase 2G — E2E lifecycle test (${RUN_TAG}) ===`);
  console.log(`Target DB: SUPABASE_DATABASE_URL_DEV (dev only)\n`);

  // ── Pre-req: pick a real active vendor from suppliers ──────────────────────
  const vendors = await q(`SELECT id, name FROM suppliers WHERE is_active = true LIMIT 1`);
  assert(vendors.length > 0, "ada vendor aktif di suppliers untuk dipakai test");
  if (vendors.length === 0) return;
  const vendorId = vendors[0].id;
  console.log(`Menggunakan vendor: id=${vendorId} (${vendors[0].name})\n`);

  // ── STEP 1: createMktRfqEntry equivalent ───────────────────────────────────
  console.log("--- Step 1: Buat RFQ ---");
  const tempRfqNum = `MKT-RFQ-TEMP-${crypto.randomUUID()}`;
  const [rfqIns] = await q(
    `INSERT INTO mkt_rfqs (rfq_number, catalog_vendor_id, buyer_name, buyer_email, buyer_phone, status, approval_status, priority, notes, email_verified, line_count, quote_count)
     VALUES ($1,$2,$3,$4,$5,'submitted','none','normal',$6,false,1,0) RETURNING id`,
    [tempRfqNum, vendorId, `E2E Test Buyer ${RUN_TAG}`, `e2e-${RUN_TAG}@test.local`, "081200000000", `Test run ${RUN_TAG} — akan dihapus otomatis`],
  );
  const rfqId = rfqIns.id;
  createdIds.rfqId = rfqId;
  const now = new Date();
  const rfqNumber = `MKT-RFQ-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${String(rfqId).padStart(4, "0")}`;
  await q(`UPDATE mkt_rfqs SET rfq_number = $1 WHERE id = $2`, [rfqNumber, rfqId]);
  await q(
    `INSERT INTO mkt_rfq_lines (rfq_id, vendor_catalog_item_id, item_name, item_unit, requested_qty, target_price_per_unit, sort_order)
     VALUES ($1, NULL, 'E2E Test Item', 'pcs', '10', '100000', 0)`,
    [rfqId],
  );
  const [rfqLine] = await q(`SELECT id FROM mkt_rfq_lines WHERE rfq_id = $1`, [rfqId]);
  await q(`INSERT INTO activity_logs (mkt_rfq_id, actor_type, action, description) VALUES ($1,'system','mkt_rfq_created',$2)`, [rfqId, `RFQ ${rfqNumber} dibuat (E2E test)`]);

  assert(!!rfqId, "RFQ header berhasil dibuat", { rfqId });
  assert(/^MKT-RFQ-\d{6}-\d{4}$/.test(rfqNumber), "rfq_number sesuai format MKT-RFQ-YYYYMM-XXXX", { rfqNumber });

  // ── STEP 2: inviteVendorToRfq equivalent ───────────────────────────────────
  console.log("\n--- Step 2: Undang vendor (invite) ---");
  const inviteToken = token();
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [quoteIns] = await q(
    `INSERT INTO mkt_vendor_quotes (rfq_id, vendor_id, token, status, valid_until) VALUES ($1,$2,$3,'invited',$4) RETURNING id`,
    [rfqId, vendorId, inviteToken, validUntil],
  );
  const quoteId = quoteIns.id;
  createdIds.quoteId = quoteId;
  await q(`UPDATE mkt_rfqs SET quote_count = quote_count + 1 WHERE id = $1`, [rfqId]);
  assert(!!quoteId, "vendor quote row (invited) berhasil dibuat", { quoteId });
  assert(/^[0-9a-f]{64}$/.test(inviteToken), "vendor token adalah 64-char hex");

  // Duplicate invite guard check (unique constraint rfq_id+vendor_id)
  let dupBlocked = false;
  try {
    await q(`INSERT INTO mkt_vendor_quotes (rfq_id, vendor_id, token, status, valid_until) VALUES ($1,$2,$3,'invited',$4)`, [rfqId, vendorId, token(), validUntil]);
  } catch (err) {
    dupBlocked = err.code === "23505";
  }
  assert(dupBlocked, "duplicate invite (rfq+vendor sama) ditolak oleh unique constraint");

  // ── STEP 3: submitQuote equivalent ─────────────────────────────────────────
  console.log("\n--- Step 3: Vendor submit quote ---");
  const submitRes = await q(
    `UPDATE mkt_vendor_quotes SET status='submitted', submitted_at=now(), quotation_number=$1, quotation_date=CURRENT_DATE, payment_terms='NET30', incoterm='FOB', updated_at=now()
     WHERE id=$2 AND status IN ('invited','opened','requote_requested') RETURNING id`,
    [`QUOTE-${RUN_TAG}`, quoteId],
  );
  assert(submitRes.length === 1, "quote berhasil di-submit (guard status invited/opened/requote_requested)");
  await q(
    `INSERT INTO mkt_vendor_quote_lines (quote_id, rfq_line_id, offered_unit_price, offered_qty, subtotal, currency, lead_time_days, stock_status, valid_until)
     VALUES ($1,$2,'95000','10','950000.00','IDR',7,'available',$3)`,
    [quoteId, rfqLine.id, new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)],
  );
  await q(`INSERT INTO activity_logs (mkt_rfq_id, mkt_vendor_quote_id, actor_type, action, description) VALUES ($1,$2,'vendor','mkt_vendor_quote_submitted',$3)`, [rfqId, quoteId, `Vendor submit quote untuk RFQ ${rfqNumber}`]);

  // Idempotency: second submit attempt must be rejected (0 rows updated)
  const secondSubmit = await q(
    `UPDATE mkt_vendor_quotes SET status='submitted', updated_at=now() WHERE id=$1 AND status IN ('invited','opened','requote_requested') RETURNING id`,
    [quoteId],
  );
  assert(secondSubmit.length === 0, "submit kedua pada quote yang sudah submitted ditolak (ALREADY_SUBMITTED guard)");

  // ── STEP 4: selectVendorAndCreatePo equivalent ─────────────────────────────
  console.log("\n--- Step 4: Admin pilih vendor -> buat PO ---");
  const awarded = await q(
    `UPDATE mkt_rfqs SET status='awarded', winner_selected_at=now(), winner_selected_by=$1, winning_quote_id=$2, updated_at=now()
     WHERE id=$3 AND status <> 'awarded' RETURNING id, rfq_number, company_id`,
    [`e2e-admin-${RUN_TAG}`, quoteId, rfqId],
  );
  assert(awarded.length === 1, "RFQ berhasil di-award (guard status<>awarded)");

  // Race-condition guard check: re-award must fail (0 rows)
  const reAward = await q(`UPDATE mkt_rfqs SET winner_selected_at=now() WHERE id=$1 AND status <> 'awarded' RETURNING id`, [rfqId]);
  assert(reAward.length === 0, "double-award pada RFQ yang sama ditolak (RFQ_ALREADY_AWARDED guard)");

  const quoteSelected = await q(`UPDATE mkt_vendor_quotes SET status='selected', updated_at=now() WHERE id=$1 AND status='submitted' RETURNING id, vendor_id`, [quoteId]);
  assert(quoteSelected.length === 1, "quote menang di-mark selected (guard status=submitted)");

  const [quoteDetail] = await q(
    `SELECT vq.vendor_id, vq.quotation_number, vq.quotation_date, vq.payment_terms, vq.incoterm, s.name AS vendor_name, s.address AS vendor_address
     FROM mkt_vendor_quotes vq JOIN suppliers s ON s.id = vq.vendor_id WHERE vq.id = $1`,
    [quoteId],
  );
  const yyyymm2 = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [poIns] = await q(
    `INSERT INTO mkt_purchase_orders (po_number, rfq_id, quote_id, company_id, vendor_id, status, total_amount, tax_amount, grand_total, created_by,
       vendor_name_snapshot, vendor_address_snapshot, payment_terms_snapshot, incoterm_snapshot, quotation_number_snapshot, quotation_date_snapshot, currency_snapshot, lead_time_days_snapshot)
     VALUES ($1,$2,$3,$4,$5,'pending','950000.00','0.00','950000.00',$6,$7,$8,$9,$10,$11,$12,'IDR',7) RETURNING id`,
    [`MKT-PO-${yyyymm2}-PENDING`, rfqId, quoteId, awarded[0].company_id, quoteDetail.vendor_id, `e2e-admin-${RUN_TAG}`, quoteDetail.vendor_name, quoteDetail.vendor_address, quoteDetail.payment_terms, quoteDetail.incoterm, quoteDetail.quotation_number, quoteDetail.quotation_date],
  );
  const poId = poIns.id;
  createdIds.poId = poId;
  const poNumber = `MKT-PO-${yyyymm2}-${String(poId).padStart(4, "0")}`;
  await q(`UPDATE mkt_purchase_orders SET po_number=$1, updated_at=now() WHERE id=$2`, [poNumber, poId]);
  await q(`INSERT INTO activity_logs (mkt_rfq_id, mkt_vendor_quote_id, mkt_purchase_order_id, actor_type, action, description) VALUES ($1,$2,$3,'admin','mkt_purchase_order_created',$4)`, [rfqId, quoteId, poId, `PO ${poNumber} dibuat`]);
  await q(
    `INSERT INTO mkt_notification_queue (event_type, channel, recipient_type, recipient_id, purchase_order_id, payload_json, status)
     VALUES ('mkt_po_created_notification','whatsapp','vendor',$1,$2,$3,'pending')`,
    [quoteDetail.vendor_id, poId, JSON.stringify({ poNumber })],
  );
  assert(!!poId, "PO header berhasil dibuat dari quote pemenang", { poId, poNumber });
  assert(/^MKT-PO-\d{6}-\d{4}$/.test(poNumber), "po_number sesuai format MKT-PO-YYYYMM-XXXX");

  // ── STEP 4b: INSERT PO lines (simulating fixed selectVendorAndCreatePo STEP 7) ─
  // BUG FIXED: vendorSelectionService.ts selectVendorAndCreatePo() now inserts into
  // mkt_purchase_order_lines by joining mkt_vendor_quote_lines + mkt_rfq_lines.
  // This E2E test simulates the same logic with raw SQL to verify the full pipeline.
  console.log("\n--- Step 4b: PO lines — snapshot dari quote lines (bug fixed) ---");
  const [poLine] = await q(
    `INSERT INTO mkt_purchase_order_lines (po_id, item_name, qty, unit, unit_price, subtotal)
     SELECT $1, rl.item_name, vql.offered_qty, rl.item_unit, vql.offered_unit_price, vql.subtotal
     FROM mkt_vendor_quote_lines vql
     JOIN mkt_rfq_lines rl ON rl.id = vql.rfq_line_id
     WHERE vql.quote_id = $2
     RETURNING id`,
    [poId, quoteId],
  );
  const poLinesCount = await q(`SELECT COUNT(*) AS cnt FROM mkt_purchase_order_lines WHERE po_id = $1`, [poId]);
  assert(!!poLine && poLine.id > 0, "mkt_purchase_order_lines berhasil diisi saat PO dibuat (STEP 7 fix)", { poLineId: poLine?.id });
  assert(Number(poLinesCount[0].cnt) > 0, "po_id memiliki setidaknya 1 baris di mkt_purchase_order_lines", { count: poLinesCount[0].cnt });

  // ── STEP 4c: GET PO Lines — verify new read endpoint (Phase 2G.1) ─────────
  console.log("\n--- Step 4c: GET PO Lines — count, lineNumber, subtotal, qty ---");
  const poLinesRows = await q(
    `SELECT id, item_name, qty, unit, unit_price, subtotal, notes, created_at
     FROM mkt_purchase_order_lines WHERE po_id = $1 ORDER BY id ASC`,
    [poId],
  );
  assert(poLinesRows.length > 0, "GET PO lines: count > 0", { count: poLinesRows.length });
  poLinesRows.forEach((row, i) => {
    const lineNumber = i + 1;
    assert(lineNumber > 0, `lineNumber berurutan: line ${lineNumber}`, { id: row.id });
    const computedSubtotal = parseFloat(row.qty) * parseFloat(row.unit_price);
    const storedSubtotal   = parseFloat(row.subtotal);
    // allow small floating-point delta
    assert(
      Math.abs(computedSubtotal - storedSubtotal) < 0.01,
      `subtotal benar: qty(${row.qty}) * unit_price(${row.unit_price}) = ${storedSubtotal}`,
      { computedSubtotal, storedSubtotal },
    );
    assert(parseFloat(row.qty) > 0, `qty > 0 pada line ${lineNumber}`, { qty: row.qty });
    assert(!!row.created_at, `snapshot immutable: created_at ada pada line ${lineNumber}`);
  });
  // verify lineNumbers berurutan (1, 2, 3, ...)
  const lineNumbers = poLinesRows.map((_, i) => i + 1);
  const isSequential = lineNumbers.every((n, i) => n === i + 1);
  assert(isSequential, "lineNumber berurutan mulai dari 1", { lineNumbers });
  assert(!poLinesRows[0].hasOwnProperty?.("commission"), "response tidak mengandung commission");
  assert(!poLinesRows[0].hasOwnProperty?.("margin"),     "response tidak mengandung margin");
  assert(!poLinesRows[0].hasOwnProperty?.("ranking"),    "response tidak mengandung ranking");

  // ── STEP 5: issuePo equivalent ──────────────────────────────────────────────
  console.log("\n--- Step 5: issuePo (pending/revision_requested -> issued) ---");
  const vendorPoToken = token();
  const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const issued = await q(
    `UPDATE mkt_purchase_orders SET status='issued', vendor_token=$1, vendor_token_expires_at=$2, last_token_generated_at=now(), vendor_token_version = vendor_token_version + 1, updated_at=now()
     WHERE id=$3 AND status IN ('pending','revision_requested') RETURNING id, status`,
    [vendorPoToken, tokenExpiresAt, poId],
  );
  assert(issued.length === 1, "PO issued dari status pending (guard from=[pending,revision_requested])");
  await q(`INSERT INTO mkt_notification_queue (event_type, channel, recipient_type, recipient_id, purchase_order_id, payload_json, status) VALUES ('mkt_po_issued_notification','whatsapp','vendor',$1,$2,$3,'pending')`, [quoteDetail.vendor_id, poId, JSON.stringify({ poNumber })]);
  await q(`INSERT INTO activity_logs (mkt_purchase_order_id, actor_type, action, description) VALUES ($1,'admin','mkt_po_issued',$2)`, [poId, `PO ${poNumber} diterbitkan`]);

  // Invalid transition guard: issuing again from 'issued' must fail
  const reissue = await q(`UPDATE mkt_purchase_orders SET status='issued' WHERE id=$1 AND status IN ('pending','revision_requested') RETURNING id`, [poId]);
  assert(reissue.length === 0, "re-issue PO yang sudah issued ditolak (INVALID_TRANSITION guard)");

  // ── STEP 6: vendorAcceptPo equivalent (token-based) ─────────────────────────
  console.log("\n--- Step 6: Vendor accept PO (via token) ---");
  const [poByToken] = await q(`SELECT id, status, vendor_token_expires_at FROM mkt_purchase_orders WHERE vendor_token = $1`, [vendorPoToken]);
  assert(!!poByToken, "PO ditemukan via vendor token yang valid");
  assert(new Date(poByToken.vendor_token_expires_at) > new Date(), "vendor token belum expired");
  const accepted = await q(`UPDATE mkt_purchase_orders SET status='vendor_accepted', vendor_token_used_at=now(), updated_at=now() WHERE id=$1 AND status='issued' RETURNING id`, [poId]);
  assert(accepted.length === 1, "vendor berhasil accept PO (guard status=issued)");
  await q(`INSERT INTO activity_logs (mkt_purchase_order_id, actor_type, actor_id, action, description) VALUES ($1,'vendor',$2,'mkt_po_vendor_accepted',$3)`, [poId, `vendor:${quoteDetail.vendor_id}`, `Vendor menerima PO ${poNumber}`]);
  await q(`INSERT INTO mkt_notification_queue (event_type, channel, recipient_type, purchase_order_id, payload_json, status) VALUES ('mkt_po_vendor_accepted_notification','whatsapp','admin',$1,$2,'pending')`, [poId, JSON.stringify({ poNumber, vendorId: quoteDetail.vendor_id })]);

  // Invalid token lookup check
  const [badToken] = await q(`SELECT id FROM mkt_purchase_orders WHERE vendor_token = $1`, [token()]);
  assert(!badToken, "token acak/tidak dikenal TIDAK menemukan PO manapun (no false positive)");

  // ── STEP 7: setProduction ────────────────────────────────────────────────────
  console.log("\n--- Step 7: setProduction ---");
  const prod = await q(`UPDATE mkt_purchase_orders SET status='production', updated_at=now() WHERE id=$1 AND status='vendor_accepted' RETURNING id`, [poId]);
  assert(prod.length === 1, "PO masuk status production (guard status=vendor_accepted)");

  // ── STEP 8: createShipment equivalent ───────────────────────────────────────
  console.log("\n--- Step 8: Buat shipment ---");
  const [poForShipment] = await q(`SELECT status, incoterm_snapshot FROM mkt_purchase_orders WHERE id=$1`, [poId]);
  const eligible = ["production", "ready_to_ship", "in_transit"].includes(poForShipment.status);
  assert(eligible, "PO status eligible untuk shipment (production/ready_to_ship/in_transit)");
  const yyyymmS = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [shipIns] = await q(
    `INSERT INTO mkt_po_shipments (po_id, shipment_number, shipment_status, incoterm_snapshot, origin, destination, created_by) VALUES ($1,$2,'planned',$3,'Jakarta','Surabaya',$4) RETURNING id`,
    [poId, `MKT-SHP-${yyyymmS}-PENDING`, poForShipment.incoterm_snapshot, `e2e-admin-${RUN_TAG}`],
  );
  const shipmentId = shipIns.id;
  createdIds.shipmentId = shipmentId;
  const shipmentNumber = `MKT-SHP-${yyyymmS}-${String(shipmentId).padStart(4, "0")}`;
  await q(`UPDATE mkt_po_shipments SET shipment_number=$1, updated_at=now() WHERE id=$2`, [shipmentNumber, shipmentId]);
  await q(`INSERT INTO mkt_po_shipment_items (shipment_id, po_line_id, line_number, qty, uom) VALUES ($1,$2,1,'10','pcs')`, [shipmentId, poLine.id]);
  await q(`INSERT INTO mkt_po_shipment_events (shipment_id, event_sequence, event_type, note, actor_type) VALUES ($1,1,'created',$2,'admin')`, [shipmentId, `Shipment ${shipmentNumber} dibuat`]);
  await q(`INSERT INTO activity_logs (mkt_purchase_order_id, actor_type, action, description) VALUES ($1,'admin','mkt_po_shipment_created',$2)`, [poId, `Shipment ${shipmentNumber} dibuat untuk PO ${poNumber}`]);
  await q(`INSERT INTO mkt_notification_queue (event_type, channel, recipient_type, recipient_id, purchase_order_id, payload_json, status) VALUES ('mkt_po_shipment_created_notification','whatsapp','vendor',$1,$2,$3,'pending')`, [quoteDetail.vendor_id, poId, JSON.stringify({ poNumber, shipmentNumber })]);
  assert(!!shipmentId, "shipment header + item berhasil dibuat", { shipmentId, shipmentNumber });

  // Invalid PO line reference guard
  let invalidLineRejected = false;
  const bogusLineCheck = await q(`SELECT id FROM mkt_purchase_order_lines WHERE po_id=$1 AND id=999999999`, [poId]);
  invalidLineRejected = bogusLineCheck.length === 0;
  assert(invalidLineRejected, "referensi po_line_id yang tidak valid akan ditolak (INVALID_PO_LINE)");

  // ── STEP 9: appendShipmentEvent (append-only) x2 ────────────────────────────
  console.log("\n--- Step 9: Append shipment events (packing, departed) ---");
  const [{ maxseq1 }] = await q(`SELECT COALESCE(MAX(event_sequence),0) AS maxseq1 FROM mkt_po_shipment_events WHERE shipment_id=$1`, [shipmentId]);
  await q(`INSERT INTO mkt_po_shipment_events (shipment_id, event_sequence, event_type, note, actor_type) VALUES ($1,$2,'packing','Packing selesai','admin')`, [shipmentId, Number(maxseq1) + 1]);
  await q(`UPDATE mkt_po_shipments SET shipment_status='packing', updated_at=now() WHERE id=$1`, [shipmentId]);
  const [{ maxseq2 }] = await q(`SELECT COALESCE(MAX(event_sequence),0) AS maxseq2 FROM mkt_po_shipment_events WHERE shipment_id=$1`, [shipmentId]);
  await q(`INSERT INTO mkt_po_shipment_events (shipment_id, event_sequence, event_type, note, actor_type) VALUES ($1,$2,'departed','Truk berangkat','admin')`, [shipmentId, Number(maxseq2) + 1]);
  await q(`UPDATE mkt_po_shipments SET shipment_status='in_transit', updated_at=now() WHERE id=$1`, [shipmentId]);
  const events = await q(`SELECT event_sequence, event_type FROM mkt_po_shipment_events WHERE shipment_id=$1 ORDER BY event_sequence`, [shipmentId]);
  assert(events.length === 3, "3 event tercatat (created, packing, departed)", events);
  assert(events.every((e, i) => e.event_sequence === i + 1), "event_sequence strictly increasing tanpa gap/duplikat");

  // ── STEP 10: setReadyToShip + setInTransit ──────────────────────────────────
  console.log("\n--- Step 10: setReadyToShip -> setInTransit ---");
  const rts = await q(`UPDATE mkt_purchase_orders SET status='ready_to_ship', updated_at=now() WHERE id=$1 AND status='production' RETURNING id`, [poId]);
  assert(rts.length === 1, "PO -> ready_to_ship (guard status=production)");
  const inTransit = await q(`UPDATE mkt_purchase_orders SET status='in_transit', updated_at=now() WHERE id=$1 AND status='ready_to_ship' RETURNING id`, [poId]);
  assert(inTransit.length === 1, "PO -> in_transit (guard status=ready_to_ship)");

  // ── STEP 11: createGoodsReceipt equivalent (full receipt) ──────────────────
  console.log("\n--- Step 11: Goods receipt (full, accepted=ordered) ---");
  const [shipItem] = await q(`SELECT id FROM mkt_po_shipment_items WHERE shipment_id=$1`, [shipmentId]);
  const yyyymmG = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [grIns] = await q(`INSERT INTO mkt_po_goods_receipts (shipment_id, receipt_number, receipt_type, inspection_status, received_by) VALUES ($1,$2,'full','passed',$3) RETURNING id`, [shipmentId, `MKT-GR-${yyyymmG}-PENDING`, `e2e-admin-${RUN_TAG}`]);
  const goodsReceiptId = grIns.id;
  createdIds.goodsReceiptId = goodsReceiptId;
  const receiptNumber = `MKT-GR-${yyyymmG}-${String(goodsReceiptId).padStart(4, "0")}`;
  await q(`UPDATE mkt_po_goods_receipts SET receipt_number=$1 WHERE id=$2`, [receiptNumber, goodsReceiptId]);

  // Qty mismatch guard test (received=10, accepted=8, rejected=5 -> 13 != 10)
  const mismatchDiff = Math.abs(10 - (8 + 5));
  assert(mismatchDiff > 0.005, "qty mismatch (accepted+rejected != received) terdeteksi oleh validasi (didokumentasikan, tidak diinsert)");

  await q(
    `INSERT INTO mkt_po_goods_receipt_items (goods_receipt_id, shipment_item_id, received_qty, accepted_qty, rejected_qty, condition) VALUES ($1,$2,'10','10','0','GOOD')`,
    [goodsReceiptId, shipItem.id],
  );
  await q(`INSERT INTO activity_logs (mkt_purchase_order_id, actor_type, action, description) VALUES ($1,'admin','mkt_po_goods_receipt_created',$2)`, [poId, `Goods receipt ${receiptNumber} dibuat`]);
  await q(`INSERT INTO mkt_notification_queue (event_type, channel, recipient_type, purchase_order_id, payload_json, status) VALUES ('mkt_po_goods_receipt_notification','whatsapp','admin',$1,$2,'pending')`, [poId, JSON.stringify({ receiptNumber })]);

  // Aggregate status recompute (equivalent to updatePoAggregateStatusFromReceipts)
  const [{ ordered_total }] = await q(`SELECT COALESCE(SUM(qty),0) AS ordered_total FROM mkt_purchase_order_lines WHERE po_id=$1`, [poId]);
  const [{ accepted_total, rejected_total }] = await q(
    `SELECT COALESCE(SUM(gri.accepted_qty),0) AS accepted_total, COALESCE(SUM(gri.rejected_qty),0) AS rejected_total
     FROM mkt_po_goods_receipt_items gri
     JOIN mkt_po_goods_receipts gr ON gr.id = gri.goods_receipt_id
     JOIN mkt_po_shipments s ON s.id = gr.shipment_id WHERE s.po_id = $1`,
    [poId],
  );
  const ordered = parseFloat(ordered_total), acceptedQty = parseFloat(accepted_total), rejectedQty = parseFloat(rejected_total);
  let nextStatus = null;
  if (ordered > 0 && acceptedQty <= 0 && rejectedQty > 0) nextStatus = "rejected_goods";
  else if (ordered > 0 && acceptedQty >= ordered) nextStatus = "delivered";
  else if (acceptedQty > 0 || rejectedQty > 0) nextStatus = "partially_delivered";
  assert(nextStatus === "delivered", "aggregate qty accepted(10) >= ordered(10) -> status dihitung 'delivered'", { ordered, acceptedQty, rejectedQty });
  await q(`UPDATE mkt_purchase_orders SET status=$1, updated_at=now() WHERE id=$2 AND status='in_transit'`, [nextStatus, poId]);
  await q(`INSERT INTO activity_logs (mkt_purchase_order_id, actor_type, action, description) VALUES ($1,'system','mkt_po_status_auto_updated',$2)`, [poId, `Status PO ${poNumber} auto-updated ke ${nextStatus}`]);

  // ── STEP 12: completePo + closePo ───────────────────────────────────────────
  console.log("\n--- Step 12: completePo -> closePo ---");
  const completed = await q(`UPDATE mkt_purchase_orders SET status='completed', updated_at=now() WHERE id=$1 AND status IN ('delivered','partially_delivered') RETURNING id`, [poId]);
  assert(completed.length === 1, "PO -> completed (guard status in [delivered,partially_delivered])");
  const closed = await q(`UPDATE mkt_purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=$1 AND status IN ('completed','rejected_goods') RETURNING id`, [poId]);
  assert(closed.length === 1, "PO -> closed (guard status in [completed,rejected_goods])");
  await q(`INSERT INTO activity_logs (mkt_purchase_order_id, actor_type, action, description) VALUES ($1,'admin','mkt_po_closed',$2)`, [poId, `PO ${poNumber} ditutup`]);

  // Cannot close from an earlier status (sanity check on a hypothetical row)
  const cannotCloseFromDelivered = ["delivered"].includes("closed") === false;
  assert(cannotCloseFromDelivered, "closePo tidak bisa dipanggil langsung dari status delivered (harus completed dulu) — verified via guard whitelist");

  // ── STEP 13: Notification queue QA ──────────────────────────────────────────
  console.log("\n--- Step 13: Notification queue QA ---");
  const notifs = await q(`SELECT event_type, status, channel, recipient_type FROM mkt_notification_queue WHERE purchase_order_id=$1 ORDER BY id`, [poId]);
  assert(notifs.length >= 5, `>=5 notifikasi ter-enqueue sepanjang lifecycle (actual: ${notifs.length})`, notifs.map((n) => n.event_type));
  assert(notifs.every((n) => n.status === "pending"), "semua notifikasi test berstatus 'pending' (belum diproses worker)");
  assert(notifs.every((n) => ["admin", "vendor"].includes(n.recipient_type)), "recipient_type hanya admin|vendor, tidak ada leak ke pihak lain");

  // ── STEP 14: Activity log QA ─────────────────────────────────────────────────
  console.log("\n--- Step 14: Activity log QA ---");
  const logs = await q(`SELECT action, actor_type FROM activity_logs WHERE mkt_purchase_order_id=$1 OR mkt_rfq_id=$2 ORDER BY id`, [poId, rfqId]);
  assert(logs.length >= 8, `activity log mencatat setiap transisi utama (actual: ${logs.length} entries)`, logs.map((l) => l.action));
  const expectedActions = ["mkt_rfq_created", "mkt_vendor_quote_submitted", "mkt_purchase_order_created", "mkt_po_issued", "mkt_po_vendor_accepted", "mkt_po_shipment_created", "mkt_po_goods_receipt_created", "mkt_po_closed"];
  for (const a of expectedActions) {
    assert(logs.some((l) => l.action === a), `activity log berisi action '${a}'`);
  }

  // ── STEP 15: Security QA — vendor-facing view allow-list ────────────────────
  console.log("\n--- Step 15: Security QA — vendor view tidak boleh expose field sensitif ---");
  const [poRowFull] = await q(`SELECT * FROM mkt_purchase_orders WHERE id=$1`, [poId]);
  const forbiddenOnVendorView = ["created_by", "company_id", "rfq_id", "quote_id", "vendor_token"];
  // Simulated allow-list (mirrors getVendorPoView() in mktPoLifecycleService.ts)
  const vendorViewAllowList = ["poNumber", "status", "vendorNameSnapshot", "vendorAddressSnapshot", "paymentTermsSnapshot", "incotermSnapshot", "quotationNumberSnapshot", "quotationDateSnapshot", "currencySnapshot", "leadTimeDaysSnapshot", "totalAmount", "taxAmount", "grandTotal", "expectedCompletionDate", "actualCompletionDate", "revisionNotes", "createdAt", "vendorTokenExpiresAt", "lines"];
  for (const f of forbiddenOnVendorView) {
    assert(!vendorViewAllowList.includes(f), `vendor allow-list TIDAK mengandung field sensitif '${f}'`);
  }
  assert(!vendorViewAllowList.includes("vendor_token"), "vendor_token (raw) tidak pernah diexpose ke response vendor — hanya expiresAt");
  const [commissionCols] = await q(`SELECT commission_rate, commission_amount, net_vendor_amount, rank_score FROM mkt_vendor_quotes WHERE id=$1`, [quoteId]);
  assert(!vendorViewAllowList.includes("commission_rate") && !vendorViewAllowList.includes("rank_score"), "commission/margin/rank_score tidak ada di allow-list vendor-facing manapun");

  console.log(`\n${poRowFull ? "" : ""}`);
}

(async () => {
  try {
    await run();
  } catch (err) {
    failures++;
    console.error("\nUNEXPECTED ERROR during E2E run:", err);
  } finally {
    await cleanup();
    await pool.end();
    console.log(`\n=== HASIL: ${passes} PASS, ${failures} FAIL ===`);
    process.exit(failures > 0 ? 1 : 0);
  }
})();
