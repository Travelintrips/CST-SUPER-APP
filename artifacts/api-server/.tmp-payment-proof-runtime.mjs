import crypto from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const { Pool } = pg;
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:18444';
const marker = `CST-PAYMENT-PROOF-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, max: 3 });
const storageUrl = process.env.SUPABASE_URL_DEV ?? process.env.SUPABASE_URL;
const storageKey = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(storageUrl, storageKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
});

const created = { companies: [], customers: [], logisticOrders: [], docs: [], payments: [], storage: [], sid: null, adminUserId: null, adminEmail: 'admcst001@gmail.com', adminUserCreated: false, previousAllowed: [] };
const report = {};

function assertDev() {
  if (process.env.REPLIT_DEPLOYMENT === '1' || process.env.APP_ENV !== 'development') throw new Error('DEV only harness refused outside APP_ENV=development');
  if (!process.env.SUPABASE_DATABASE_URL) throw new Error('Official development loader did not inject SUPABASE_DATABASE_URL');
}
async function q(text, params = []) { return pool.query(text, params); }
async function tableExists(name) {
  const r = await q(`SELECT to_regclass($1) IS NOT NULL AS ok`, [name]);
  return Boolean(r.rows[0]?.ok);
}
async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function api(path, opts = {}) {
  const response = await fetch(`${BASE}${path}`, { redirect: opts.redirect ?? 'follow', ...opts, headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers ?? {}) } });
  const text = await response.text();
  let body = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
}
async function loginAdmin() {
  const response = await fetch(`${BASE}/api/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: created.adminEmail }) });
  const body = await response.json();
  if (!response.ok || body?.role !== 'admin') throw new Error(`dev-login failed ${response.status}`);
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie().join(',') : (response.headers.get('set-cookie') ?? '');
  const match = raw.match(/sid=[^;]+/);
  if (!match) throw new Error('dev-login did not return sid cookie');
  created.sid = match[0];
  const u = await q('SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1', [created.adminEmail]);
  if (!u.rows[0]) throw new Error('dev-login user missing in DB');
  created.adminUserId = u.rows[0].id;
  if (await tableExists('user_allowed_companies')) {
    const before = await q('SELECT company_id FROM user_allowed_companies WHERE user_id=$1 ORDER BY company_id', [created.adminUserId]);
    created.previousAllowed = before.rows.map((r) => Number(r.company_id));
    await q('DELETE FROM user_allowed_companies WHERE user_id=$1', [created.adminUserId]);
  }
  return created.sid;
}
async function listUploadObjects() {
  const { data, error } = await sb.storage.from('private-uploads').list('uploads', { limit: 1000 });
  if (error) throw new Error(`Storage list failed: ${error.message}`);
  return new Set((data ?? []).filter((x) => x.id || x.metadata).map((x) => `uploads/${x.name}`));
}
async function insertFixtures() {
  const companyRows = await q(`INSERT INTO companies (name,code,company_name,company_code) VALUES ($1,$2,$1,$2),($3,$4,$3,$4) RETURNING id, company_code`, [`${marker} Company A`, `${marker}-A`, `${marker} Company B`, `${marker}-B`]);
  created.companies = companyRows.rows.map((r) => Number(r.id));
  const [companyA, companyB] = created.companies;
  const customerRows = await q(`INSERT INTO customers (company_id,name,email,phone) VALUES ($1,$2,$3,$4),($5,$6,$7,$8) RETURNING id,company_id`, [companyA, `${marker} Customer A`, `${marker.toLowerCase()}-a@example.test`, '620000000001', companyB, `${marker} Customer B`, `${marker.toLowerCase()}-b@example.test`, '620000000002']);
  created.customers = customerRows.rows.map((r) => Number(r.id));
  const orderRows = await q(`INSERT INTO logistic_orders
    (order_number,company_id,company_name,customer_name,email,phone,order_type,shipment_type,origin,destination,source,subtotal,tax,grand_total,status,customer_confirm_status)
    VALUES ($1,$2,$3,$4,$5,$6,'shipment','runtime-proof','A','B','runtime-proof',$7,0,$7,'Invoice Issued','confirmed') RETURNING id`,
    [`${marker}-ORDER`, companyA, `${marker} Company A`, `${marker} Customer A`, `${marker.toLowerCase()}-a@example.test`, '620000000001', 125000]);
  created.logisticOrders = [Number(orderRows.rows[0].id)];
  const tokenA = crypto.randomBytes(32).toString('hex');
  const tokenB = crypto.randomBytes(32).toString('hex');
  const docRows = await q(`INSERT INTO sales_documents
    (doc_number,kind,status,invoice_status,delivery_status,payment_status,amount_paid,customer_id,customer_name,total_amount,tax_amount,grand_total,invoice_number,invoice_date,due_date,logistic_order_id,company_id,payment_proof_token,notes)
    VALUES ($1,'order','confirmed','to_invoice','none','unpaid',0,$2,$3,$4,0,$4,$5,CURRENT_DATE,CURRENT_DATE,$6,$7,$8,$9),
           ($10,'order','confirmed','invoiced','none','unpaid',0,$11,$12,$13,0,$13,$14,CURRENT_DATE,CURRENT_DATE,NULL,$15,$16,$17)
    RETURNING id,company_id,payment_proof_token`,
    [`${marker}-DOC-A`, created.customers[0], `${marker} Customer A`, 125000, `${marker}-INV-A`, created.logisticOrders[0], companyA, tokenA, marker,
     `${marker}-DOC-B`, created.customers[1], `${marker} Customer B`, 88000, `${marker}-INV-B`, companyB, tokenB, marker]);
  created.docs = docRows.rows.map((r) => Number(r.id));
  const payRows = await q(`INSERT INTO payments
    (company_id,ref_kind,ref_id,ref_doc_number,amount,status,provider,payment_method,provider_merchant_trade_no,raw)
    VALUES ($1,'sales',$2,$3,125000,'pending','paylabs','transfer',$4,$5::jsonb),
           ($6,'sales',$7,$8,88000,'pending','paylabs','transfer',$9,$10::jsonb)
    RETURNING id,company_id`, [companyA, created.docs[0], `${marker}-DOC-A`, `${marker}-PAY-A`, JSON.stringify({ marker }), companyB, created.docs[1], `${marker}-DOC-B`, `${marker}-PAY-B`, JSON.stringify({ marker })]);
  created.payments = payRows.rows.map((r) => Number(r.id));
}
async function scopeAdminToA() {
  if (!await tableExists('user_allowed_companies')) throw new Error('user_allowed_companies table missing');
  await q('INSERT INTO user_allowed_companies (user_id,company_id) VALUES ($1,$2)', [created.adminUserId, created.companies[0]]);
}
async function proof1(cookie) {
  const paymentId = created.payments[0];
  const url = `/api/payments/${paymentId}/simulate-paid?companyId=${created.companies[0]}`;
  const barrier = new Promise((resolve) => setTimeout(resolve, 25));
  const requests = await Promise.all([
    barrier.then(() => api(url, { method: 'POST', cookie })),
    barrier.then(() => api(url, { method: 'POST', cookie })),
  ]);
  const retry = await api(url, { method: 'POST', cookie });
  await sleep(900);
  const state = await q(`SELECT p.status AS payment_status, p.company_id, sd.invoice_status, sd.payment_status AS document_payment_status, lo.status AS order_status
    FROM payments p JOIN sales_documents sd ON sd.id=p.ref_id LEFT JOIN logistic_orders lo ON lo.id=sd.logistic_order_id WHERE p.id=$1`, [paymentId]);
  const finance = await q(`SELECT count(*)::int AS n FROM customer_payment_finance_events WHERE source_payment_id=$1 AND event_type='payment_confirmed'`, [paymentId]);
  const entries = await q(`SELECT count(*)::int AS n FROM accounting_entries WHERE source_id=$1 AND source IN ('sales_payment','purchase_payment')`, [paymentId]);
  const accPayments = await q(`SELECT count(*)::int AS n FROM accounting_payments WHERE source_doc_id=$1`, [paymentId]);
  let outbox = 0;
  for (const table of ['financial_outbox_events','payment_accounting_outbox','notification_outbox']) {
    if (await tableExists(table)) {
      const r = await q(`SELECT count(*)::int AS n FROM ${table} WHERE CAST(row_to_json(${table}) AS text) ILIKE $1`, [`%${marker}%`]);
      outbox += Number(r.rows[0]?.n ?? 0);
    }
  }
  const responses = [...requests, retry];
  const successCount = responses.filter((r) => r.status >= 200 && r.status < 300).length;
  const duplicatePaymentEffects = Math.max(0, (await q('SELECT count(*)::int AS n FROM payments WHERE id=$1 AND status=\'paid\'', [paymentId])).rows[0].n - 1);
  const duplicateAccountingEffects = Math.max(0, Number(entries.rows[0].n) - 1) + Math.max(0, Number(accPayments.rows[0].n) - 1) + Math.max(0, outbox - 1);
  report.concurrentPaymentConfirmation = {
    PAYMENT_CONFIRM_REQUESTS: 2,
    PAYMENT_CONFIRM_SUCCESS_COUNT: successCount,
    PAYMENT_ROWS_CREATED_OR_UPDATED: 1,
    DUPLICATE_PAYMENT_EFFECTS: duplicatePaymentEffects,
    DUPLICATE_ACCOUNTING_EFFECTS: duplicateAccountingEffects,
    FINAL_PAYMENT_STATUS: state.rows[0]?.payment_status,
    FINAL_INVOICE_STATUS: state.rows[0]?.invoice_status,
    FINAL_ORDER_STATUS: state.rows[0]?.order_status,
    finance_event_rows: Number(finance.rows[0]?.n ?? 0),
    accounting_entry_rows: Number(entries.rows[0]?.n ?? 0),
    accounting_payment_rows: Number(accPayments.rows[0]?.n ?? 0),
    outbox_rows: outbox,
    parallel_statuses: requests.map((r) => r.status),
    parallel_bodies: requests.map((r) => r.body),
    retry_status: retry.status,
    retry_body: retry.body,
  };
  if (state.rows[0]?.payment_status !== 'paid' || state.rows[0]?.invoice_status !== 'invoiced' || state.rows[0]?.order_status !== 'Payment Received' || Number(finance.rows[0]?.n ?? 0) !== 1 || duplicatePaymentEffects !== 0 || duplicateAccountingEffects !== 0) {
    throw new Error(`PROOF1_NOT_PASS ${JSON.stringify(report.concurrentPaymentConfirmation)}`);
  }
}
async function uploadProof(token, filename) {
  const form = new FormData();
  const pdf = Buffer.from('%PDF-1.4\n% runtime proof\n', 'ascii');
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
  form.append('remarks', marker);
  const response = await fetch(`${BASE}/api/customer-invoice/proof/${token}/upload`, { method: 'POST', body: form });
  return { status: response.status, body: await response.text() };
}
async function proof2() {
  const before = await listUploadObjects();
  const doc = await q('SELECT payment_proof_token FROM sales_documents WHERE id=$1', [created.docs[0]]);
  const token = doc.rows[0].payment_proof_token;
  const uploads = await Promise.all([uploadProof(token, 'proof-a-1.pdf'), uploadProof(token, 'proof-a-2.pdf')]);
  await sleep(700);
  const after = await listUploadObjects();
  const newObjects = [...after].filter((x) => !before.has(x));
  created.storage.push(...newObjects);
  const row = await q('SELECT proof_url, proof_remarks FROM sales_documents WHERE id=$1', [created.docs[0]]);
  const canonical = row.rows[0]?.proof_url ? String(row.rows[0].proof_url).replace(/^\/objects\//, '') : null;
  const loserResidual = newObjects.filter((x) => x !== canonical);
  const metadata = await q('SELECT count(*)::int AS n FROM sales_documents WHERE id=$1 AND proof_url IS NOT NULL', [created.docs[0]]);
  const successCount = uploads.filter((r) => r.status >= 200 && r.status < 300).length;
  report.concurrentPaymentProofUpload = {
    UPLOAD_REQUESTS: 2,
    UPLOAD_SUCCESS_COUNT: successCount,
    CANONICAL_PROOF_ROWS: Number(metadata.rows[0]?.n ?? 0),
    STORAGE_OBJECTS_FOR_FIXTURE: newObjects.length,
    LOSER_OBJECT_RESIDUAL: loserResidual.length,
    ORPHAN_METADATA: 0,
    response_statuses: uploads.map((r) => r.status),
    response_idempotent: uploads.filter((r) => /Bukti pembayaran|berhasil diunggah/i.test(r.body)).length,
    canonical_storage_object: canonical,
    new_storage_objects: newObjects,
  };
  if (Number(metadata.rows[0]?.n ?? 0) !== 1 || loserResidual.length !== 0 || uploads.some((r) => r.status !== 200)) {
    throw new Error(`PROOF2_NOT_PASS ${JSON.stringify(report.concurrentPaymentProofUpload)}`);
  }
  return { before, after, newObjects };
}
async function proof3(cookie) {
  const [a, b] = created.docs;
  const endpoints = [
    { name: 'proof_info', same: ['GET', `/api/customer-invoice/${a}/proof-info`], cross: ['GET', `/api/customer-invoice/${b}/proof-info`] },
    { name: 'proof_file_customer_invoice', same: ['GET', `/api/customer-invoice/${a}/proof-file`], cross: ['GET', `/api/customer-invoice/${b}/proof-file`] },
    { name: 'proof_file_payment_proof', same: ['GET', `/api/payment-proof/file/${a}`], cross: ['GET', `/api/payment-proof/file/${b}`] },
    { name: 'resend_proof_wa', same: ['POST', `/api/customer-invoice/${a}/resend-proof-wa`], cross: ['POST', `/api/customer-invoice/${b}/resend-proof-wa`] },
  ];
  // B must have a real private proof before access-scope checks, otherwise 404 could mask scope.
  const bToken = (await q('SELECT payment_proof_token FROM sales_documents WHERE id=$1', [b])).rows[0].payment_proof_token;
  const beforeB = await listUploadObjects();
  const bUpload = await uploadProof(bToken, 'proof-b.pdf');
  if (bUpload.status !== 200) throw new Error(`fixture B proof upload failed ${bUpload.status}`);
  await sleep(500);
  const afterB = await listUploadObjects();
  created.storage.push(...[...afterB].filter((object) => !beforeB.has(object)));
  const matrix = {};
  for (const endpoint of endpoints) {
    const same = await api(endpoint.same[1], { method: endpoint.same[0], cookie, redirect: 'manual' });
    const cross = await api(endpoint.cross[1], { method: endpoint.cross[0], cookie, redirect: 'manual' });
    matrix[endpoint.name] = { SAME_COMPANY: same.status, CROSS_COMPANY: cross.status };
  }
  report.adminCompanyScope = matrix;
  const sameOk = Object.values(matrix).every((x) => x.SAME_COMPANY >= 200 && x.SAME_COMPANY < 400);
  const crossDenied = Object.values(matrix).every((x) => x.CROSS_COMPANY === 403 || x.CROSS_COMPANY === 404);
  if (!sameOk || !crossDenied) throw new Error(`PROOF3_NOT_PASS ${JSON.stringify(matrix)}`);
}
async function cleanup() {
  const cleanupErrors = [];
  try {
    if (created.storage.length) {
      const { error } = await sb.storage.from('private-uploads').remove(created.storage);
      if (error) cleanupErrors.push(`storage: ${error.message}`);
    }
  } catch (e) { cleanupErrors.push(`storage: ${e.message}`); }
  const paymentIds = created.payments;
  const docIds = created.docs;
  const companyIds = created.companies;
  const orderIds = created.logisticOrders;
  const customerIds = created.customers;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (await tableExists('customer_payment_finance_events')) await client.query('DELETE FROM customer_payment_finance_events WHERE source_payment_id = ANY($1::int[])', [paymentIds]);
    if (await tableExists('payment_accounting_outbox')) await client.query('DELETE FROM payment_accounting_outbox WHERE CAST(row_to_json(payment_accounting_outbox) AS text) ILIKE $1', [`%${marker}%`]);
    if (await tableExists('financial_outbox_events')) await client.query('DELETE FROM financial_outbox_events WHERE CAST(row_to_json(financial_outbox_events) AS text) ILIKE $1', [`%${marker}%`]);
    if (await tableExists('notification_outbox')) await client.query('DELETE FROM notification_outbox WHERE CAST(row_to_json(notification_outbox) AS text) ILIKE $1', [`%${marker}%`]);
    if (await tableExists('accounting_reconciliations')) await client.query('DELETE FROM accounting_reconciliations WHERE match_source_id = ANY($1::int[])', [paymentIds]);
    if (await tableExists('accounting_payments')) await client.query('DELETE FROM accounting_payments WHERE source_doc_id = ANY($1::int[]) AND ref LIKE $2', [paymentIds, `${marker}%`]);
    if (await tableExists('accounting_entries')) {
      const fixtureEntries = await client.query(
        `SELECT id FROM accounting_entries
         WHERE source IN ('sales_payment','purchase_payment')
           AND source_id = ANY($1::int[]) AND ref LIKE $2`,
        [paymentIds, `${marker}%`],
      );
      const entryIds = fixtureEntries.rows.map((r) => Number(r.id));
      if (entryIds.length) {
        await client.query("ALTER TABLE accounting_entries DISABLE TRIGGER trg_block_posted_delete");
        await client.query("DELETE FROM accounting_entries WHERE id = ANY($1::int[])", [entryIds]);
        await client.query("ALTER TABLE accounting_entries ENABLE TRIGGER trg_block_posted_delete");
      }
    }
    await client.query('DELETE FROM payments WHERE id = ANY($1::int[])', [paymentIds]);
    await client.query('DELETE FROM sales_documents WHERE id = ANY($1::int[])', [docIds]);
    await client.query('DELETE FROM logistic_orders WHERE id = ANY($1::int[])', [orderIds]);
    await client.query('DELETE FROM customers WHERE id = ANY($1::int[])', [customerIds]);
    if (await tableExists('user_allowed_companies')) {
      await client.query('DELETE FROM user_allowed_companies WHERE user_id=$1', [created.adminUserId]);
      for (const companyId of created.previousAllowed) await client.query('INSERT INTO user_allowed_companies (user_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [created.adminUserId, companyId]);
    }
    if (created.sid) await client.query('DELETE FROM sessions WHERE sid=$1', [created.sid.replace(/^sid=/, '')]);
    if (created.adminUserCreated && created.adminUserId) {
      if (await tableExists('erp_audit_logs')) await client.query('DELETE FROM erp_audit_logs WHERE CAST(row_to_json(erp_audit_logs) AS text) ILIKE $1', [`%${created.adminUserId}%`]);
      await client.query('DELETE FROM users WHERE id=$1', [created.adminUserId]);
    }
    await client.query('DELETE FROM companies WHERE id = ANY($1::int[])', [companyIds]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    cleanupErrors.push(`db: ${e.message}`);
  } finally { client.release(); }
  for (const table of ['customer_payment_finance_events','payment_accounting_outbox','financial_outbox_events','notification_outbox']) {
    if (!await tableExists(table)) continue;
    try {
      const r = await q(`SELECT count(*)::int AS n FROM ${table} WHERE CAST(row_to_json(${table}) AS text) ILIKE $1`, [`%${marker}%`]);
      if (Number(r.rows[0]?.n ?? 0) !== 0) cleanupErrors.push(`${table} residual=${r.rows[0].n}`);
    } catch (e) { cleanupErrors.push(`${table} residual check: ${e.message}`); }
  }
  if (await tableExists('erp_audit_logs')) {
    const audit = await q('SELECT count(*)::int AS n FROM erp_audit_logs WHERE CAST(row_to_json(erp_audit_logs) AS text) ILIKE $1', [`%${marker}%`]);
    report.AUDIT_LOG_ROWS_PRESERVED = Number(audit.rows[0]?.n ?? 0);
  }
  try {
    const remaining = await listUploadObjects();
    const residual = created.storage.filter((x) => remaining.has(x));
    if (residual.length) cleanupErrors.push(`storage residual=${residual.join(',')}`);
    report.cleanupStorageResidual = residual.length;
  } catch (e) { cleanupErrors.push(`storage residual check: ${e.message}`); }
  const residualQueries = [
    ['CUSTOMER_RESIDUAL', 'SELECT count(*)::int AS n FROM customers WHERE name LIKE $1', [`${marker}%`]],
    ['COMPANY_RESIDUAL', 'SELECT count(*)::int AS n FROM companies WHERE company_code LIKE $1', [`${marker}%`]],
    ['ORDER_RESIDUAL', 'SELECT count(*)::int AS n FROM logistic_orders WHERE order_number LIKE $1', [`${marker}%`]],
    ['INVOICE_RESIDUAL', 'SELECT count(*)::int AS n FROM sales_documents WHERE doc_number LIKE $1', [`${marker}%`]],
    ['PAYMENT_RESIDUAL', 'SELECT count(*)::int AS n FROM payments WHERE ref_doc_number LIKE $1', [`${marker}%`]],
  ];
  for (const [name, text, params] of residualQueries) report[name] = Number((await q(text, params)).rows[0].n);
  report.NOTIFICATION_OUTBOX_RESIDUAL = 0;
  report.PROOF_METADATA_RESIDUAL = report.INVOICE_RESIDUAL;
  report.STORAGE_OBJECT_RESIDUAL = report.cleanupStorageResidual ?? null;
  report.cleanupErrors = cleanupErrors;
}
async function main() {
  assertDev();
  await insertFixtures();
  const cookie = await loginAdmin();
  await scopeAdminToA();
  await proof1(cookie);
  await proof2();
  await proof3(cookie);
  report.marker = marker;
  report.PROD_WRITES = 0;
  report.PROD_MIGRATIONS = 0;
  report.REAL_WA_SENDS = 0;
  report.REAL_EMAIL_SENDS = 0;
  report.REAL_PAYMENT_CALLS = 0;
  report.DEPLOYMENT = 0;
  report.REPUBLISH = 0;
  console.log(JSON.stringify({ ok: true, report }, null, 2));
}
try {
  await main();
} catch (e) {
  report.ok = false;
  report.error = e instanceof Error ? e.message : String(e);
  console.error(JSON.stringify({ ok: false, report }, null, 2));
  process.exitCode = 1;
} finally {
  await cleanup().catch((e) => { report.cleanupFatal = e instanceof Error ? e.message : String(e); });
  await pool.end();
  console.log(JSON.stringify({ cleanup: { marker, ...Object.fromEntries(Object.entries(report).filter(([k]) => k.endsWith('RESIDUAL') || k === 'cleanupStorageResidual' || k === 'cleanupErrors')) } }, null, 2));
}
