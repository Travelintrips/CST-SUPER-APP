/**
 * Verify Bank Disbursement Phase 1
 *
 * Tests:
 *   1. Schema — tabel bank_disbursements & bank_disbursement_items dengan kolom Phase 1 ada
 *   2. POST /   — basic disbursement tanpa WHT berhasil
 *   3. POST /   — wht_amount > 0 tanpa wht_account_id → 400
 *   4. POST /   — wht_account_id bertipe expense → 400 (BARU: expense dilarang)
 *   5. POST /   — wht_account_id bertipe liability → 201 (jurnal WHT benar)
 *   6. POST /   — wht_amount >= amount → 400
 *   7. POST /   — wht_amount pada non-supplier_payment → 400
 *   8. POST /   — purchase_document_id pada non-supplier_payment → 400
 *   9. Jurnal   — compound entry benar: DR Hutang, CR WHT Payable, CR Bank
 *  10. GET /:id — whtAmount & whtAccountId di-return dengan benar
 *
 * Run: node scripts/verify-bank-disbursement-phase1.mjs
 */

import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const connStr =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!connStr) {
  console.error('❌  Set SUPABASE_DATABASE_URL_DEV / SUPABASE_DATABASE_URL / DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, max: 3 });

// ── Auth session ──────────────────────────────────────────────────────────────
// Ambil admin user nyata dari DB supaya middleware requireAdmin bisa verifikasi ke DB
const adminRes = await pool.query(
  `SELECT id, email, first_name, last_name, role, company_id
   FROM users WHERE role = 'admin' AND company_id IS NOT NULL LIMIT 1`
);
if (adminRes.rows.length === 0) {
  // fallback: any admin user
  const adminRes2 = await pool.query(`SELECT id, email, first_name, last_name, role FROM users WHERE role = 'admin' LIMIT 1`);
  if (adminRes2.rows.length === 0) {
    console.error('❌  Tidak ada admin user di tabel users. Setup user admin terlebih dahulu.');
    process.exit(1);
  }
  adminRes.rows.push(adminRes2.rows[0]);
}
const adminDbUser = adminRes.rows[0];
const ADMIN_USER = {
  id: adminDbUser.id,
  email: adminDbUser.email,
  firstName: adminDbUser.first_name ?? 'Admin',
  lastName: adminDbUser.last_name ?? 'Test',
  profileImageUrl: null,
  role: 'admin',
  companyId: adminDbUser.company_id ?? 1,
};
console.log(`\n   ✦ Using admin user: ${ADMIN_USER.email} (id=${ADMIN_USER.id})`);

const sid = crypto.randomBytes(32).toString('hex');
await pool.query(
  'INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3) ON CONFLICT (sid) DO NOTHING',
  [sid, JSON.stringify({ user: ADMIN_USER }), new Date(Date.now() + 3_600_000)],
);

// ── API helpers ───────────────────────────────────────────────────────────────
const BASE = 'http://localhost:8080/api';
const req = async (method, path, body) => {
  const opts = { method, headers: { 'Content-Type': 'application/json', Cookie: `sid=${sid}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json };
};

// ── Result tracker ────────────────────────────────────────────────────────────
const results = [];
const chk = (name, cond, detail) => {
  results.push({ ok: cond, name });
  console.log((cond ? '✅' : '❌') + ' ' + name);
  if (!cond && detail) console.log('   →', String(detail).slice(0, 300));
};

// ────────────────────────────────────────────────────────────────────────────
// 1. SCHEMA CHECK
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. Schema ───────────────────────────────────────────────');

const tblDisb = await pool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_name = 'bank_disbursements'`
);
chk('1a. Tabel bank_disbursements ada', tblDisb.rows.length > 0);

const tblItems = await pool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_name = 'bank_disbursement_items'`
);
chk('1b. Tabel bank_disbursement_items ada', tblItems.rows.length > 0);

const phase1Cols = await pool.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'bank_disbursement_items'
    AND column_name IN ('purchase_document_id','wht_amount','wht_account_id')
`);
const colNames = phase1Cols.rows.map(r => r.column_name);
chk('1c. Kolom purchase_document_id ada', colNames.includes('purchase_document_id'));
chk('1d. Kolom wht_amount ada',           colNames.includes('wht_amount'));
chk('1e. Kolom wht_account_id ada',       colNames.includes('wht_account_id'));

// ── Resolve test fixtures ────────────────────────────────────────────────────
// Journal bank
const jRes = await pool.query(`
  SELECT j.id, j.default_credit_account_id, j.default_debit_account_id
  FROM accounting_journals j
  WHERE (j.type = 'bank' OR j.type = 'cash')
    AND (j.default_credit_account_id IS NOT NULL OR j.default_debit_account_id IS NOT NULL)
  LIMIT 1
`);
if (jRes.rows.length === 0) {
  console.error('\n⚠️  Tidak ada accounting journal bertipe bank/cash dengan default account. Setup jurnal terlebih dahulu.');
  process.exit(1);
}
const journal = jRes.rows[0];
const journalId = journal.id;
console.log(`   ✦ Using journal id=${journalId}`);

// Liability account (e.g. Hutang Usaha) for debit
const liabRes = await pool.query(`
  SELECT id, name FROM chart_of_accounts
  WHERE type = 'liability' AND is_active = true
  LIMIT 1
`);
if (liabRes.rows.length === 0) {
  console.error('\n⚠️  Tidak ada akun COA bertipe liability. Seed COA terlebih dahulu.');
  process.exit(1);
}
const liabAcct = liabRes.rows[0];
console.log(`   ✦ Liability account: id=${liabAcct.id} "${liabAcct.name}"`);

// WHT Payable account (liability) for wht_account_id
const whtPayableRes = await pool.query(`
  SELECT id, name FROM chart_of_accounts
  WHERE type = 'liability' AND is_active = true
    AND (name ILIKE '%wht%' OR name ILIKE '%pajak%' OR name ILIKE '%pph%' OR name ILIKE '%ppn%' OR name ILIKE '%hutang pajak%')
  LIMIT 1
`);
const whtPayableAcct = whtPayableRes.rows[0] ?? liabAcct;
console.log(`   ✦ WHT Payable account: id=${whtPayableAcct.id} "${whtPayableAcct.name}"`);

// Expense account (should be REJECTED as wht_account_id)
const expRes = await pool.query(`
  SELECT id, name FROM chart_of_accounts
  WHERE type = 'expense' AND is_active = true
  LIMIT 1
`);
const expAcct = expRes.rows[0];
console.log(`   ✦ Expense account: id=${expAcct?.id} "${expAcct?.name}"`);

const TODAY = new Date().toISOString().slice(0, 10);
const RUN_ID = Date.now().toString(36).slice(-5).toUpperCase(); // unique per run

// ────────────────────────────────────────────────────────────────────────────
// 2. BASIC DISBURSEMENT — no WHT
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 2. POST Basic (tanpa WHT) ───────────────────────────────');

const r2 = await req('POST', '/accounting/bank-disbursements', {
  journalId,
  date: TODAY,
  ref: `TEST-NO-WHT-${RUN_ID}`,
  memo: 'Verify Phase1 — no WHT',
  items: [{
    transactionType: 'supplier_payment',
    accountId: liabAcct.id,
    description: 'Bayar hutang vendor',
    amount: 1_000_000,
  }],
});
chk('2. POST tanpa WHT → 201', r2.status === 201, r2.body?.message ?? JSON.stringify(r2.body));
const disbNoWhtId = r2.body?.id;

// ────────────────────────────────────────────────────────────────────────────
// 3. wht_amount > 0 tanpa wht_account_id → 400
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. WHT > 0 tanpa wht_account_id ────────────────────────');

const r3 = await req('POST', '/accounting/bank-disbursements', {
  journalId,
  date: TODAY,
  ref: `TEST-WHT-NO-ACCT-${RUN_ID}`,
  items: [{
    transactionType: 'supplier_payment',
    accountId: liabAcct.id,
    amount: 5_000_000,
    whtAmount: 250_000,
    // whtAccountId omitted intentionally
  }],
});
chk(
  '3. wht_amount > 0 tanpa wht_account_id → 400',
  r3.status === 400,
  r3.body?.message,
);
chk(
  '3b. Pesan error menyebut wht_account_id wajib',
  r3.body?.message?.includes('wht_account_id'),
  r3.body?.message,
);

// ────────────────────────────────────────────────────────────────────────────
// 4. wht_account_id bertipe EXPENSE → 400 (INTI REVISI)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 4. wht_account_id expense → 400 ────────────────────────');

if (!expAcct) {
  chk('4. SKIP — tidak ada akun expense di COA', true, 'skipped');
} else {
  const r4 = await req('POST', '/accounting/bank-disbursements', {
    journalId,
    date: TODAY,
    ref: `TEST-WHT-EXP-${RUN_ID}`,
    items: [{
      transactionType: 'supplier_payment',
      accountId: liabAcct.id,
      amount: 5_000_000,
      whtAmount: 250_000,
      whtAccountId: expAcct.id,    // ← EXPENSE: harus ditolak
    }],
  });
  chk(
    '4. wht_account_id expense → 400',
    r4.status === 400,
    r4.body?.message,
  );
  chk(
    '4b. Pesan menyebut expense dilarang / harus liability',
    r4.body?.message?.toLowerCase().includes('liability') ||
    r4.body?.message?.toLowerCase().includes('utang') ||
    r4.body?.message?.toLowerCase().includes('kewajiban'),
    r4.body?.message,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. wht_account_id bertipe LIABILITY → 201, jurnal benar
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 5. wht_account_id liability → 201 ──────────────────────');

const GROSS   = 10_000_000;
const WHT_AMT =    500_000;
const NET_BANK = GROSS - WHT_AMT;

const r5 = await req('POST', '/accounting/bank-disbursements', {
  journalId,
  date: TODAY,
  ref: `TEST-WHT-OK-${RUN_ID}`,
  memo: 'Verify Phase1 — WHT valid',
  items: [{
    transactionType: 'supplier_payment',
    accountId: liabAcct.id,
    amount: GROSS,
    whtAmount: WHT_AMT,
    whtAccountId: whtPayableAcct.id,
  }],
});
chk('5a. POST dengan WHT liability → 201', r5.status === 201, r5.body?.message ?? JSON.stringify(r5.body));

if (r5.status === 201) {
  chk('5b. _meta.totalAmount benar',  r5.body?._meta?.totalAmount  === GROSS,   r5.body?._meta?.totalAmount);
  chk('5c. _meta.totalWht benar',     r5.body?._meta?.totalWht     === WHT_AMT, r5.body?._meta?.totalWht);
  chk('5d. _meta.bankCredit benar',   r5.body?._meta?.bankCredit   === NET_BANK, r5.body?._meta?.bankCredit);

  const disbWhtId = r5.body?.id;

  // ── Verify journal lines ──────────────────────────────────────────────
  const entryId = r5.body?.entryId;
  if (entryId) {
    const linesRes = await pool.query(`
      SELECT ael.account_id, ael.debit, ael.credit, coa.type, coa.name
      FROM accounting_entry_lines ael
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      WHERE ael.entry_id = $1
      ORDER BY ael.id
    `, [entryId]);
    const lines = linesRes.rows;

    const drLines = lines.filter(l => Number(l.debit) > 0);
    const crLines = lines.filter(l => Number(l.credit) > 0);

    chk('5e. Ada setidaknya 1 debit line (Hutang Usaha)', drLines.length >= 1, drLines.map(l => `${l.name}:${l.debit}`).join(','));
    chk('5f. Ada setidaknya 2 credit line (WHT + Bank)',  crLines.length >= 2, crLines.map(l => `${l.name}:${l.credit}`).join(','));

    const drTotal  = drLines.reduce((s, l) => s + Number(l.debit), 0);
    const crTotal  = crLines.reduce((s, l) => s + Number(l.credit), 0);
    chk('5g. Total debit == Total credit (balanced)',      Math.round(drTotal) === Math.round(crTotal), `DR=${drTotal} CR=${crTotal}`);

    const whtCrLine = crLines.find(l => l.account_id === whtPayableAcct.id || l.type === 'liability');
    chk('5h. Credit line WHT ke akun liability',           !!whtCrLine,       crLines.map(l => `${l.name}(${l.type}):${l.credit}`).join(','));

    if (whtCrLine) {
      chk('5i. Jumlah WHT credit == wht_amount',           Number(whtCrLine.credit) === WHT_AMT, whtCrLine.credit);
    }

    const bankAccountId = journal.default_credit_account_id ?? journal.default_debit_account_id;
    const bankCrLine = crLines.find(l => Number(l.account_id) === Number(bankAccountId));
    chk('5j. Credit line bank ada',                        !!bankCrLine,       `bankAccountId=${bankAccountId}, crLines=${crLines.map(l=>l.account_id).join(',')}`);
    if (bankCrLine) {
      chk('5k. Jumlah bank credit == net bank amount',     Number(bankCrLine.credit) === NET_BANK, bankCrLine.credit);
    }
  } else {
    chk('5e–5k. entryId tersedia di response', false, 'entryId missing from response');
  }

  // ── GET /:id verifikasi whtAmount dikembalikan ────────────────────────
  console.log('\n── 10. GET /:id whtAmount & whtAccountId ───────────────────');
  const rGet = await req('GET', `/accounting/bank-disbursements/${disbWhtId}`);
  chk('10a. GET /:id → 200', rGet.status === 200, rGet.body?.message);
  const item0 = rGet.body?.items?.[0];
  chk('10b. items[0].whtAmount benar',     item0?.whtAmount    === WHT_AMT,         item0?.whtAmount);
  chk('10c. items[0].whtAccountId benar',  item0?.whtAccountId === whtPayableAcct.id, item0?.whtAccountId);
}

// ────────────────────────────────────────────────────────────────────────────
// 6. wht_amount >= amount → 400
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 6. wht_amount >= amount → 400 ───────────────────────────');

const r6 = await req('POST', '/accounting/bank-disbursements', {
  journalId,
  date: TODAY,
  items: [{
    transactionType: 'supplier_payment',
    accountId: liabAcct.id,
    amount: 1_000_000,
    whtAmount: 1_000_000,       // sama = invalid
    whtAccountId: whtPayableAcct.id,
  }],
});
chk('6. wht_amount == amount → 400', r6.status === 400, r6.body?.message);

// ────────────────────────────────────────────────────────────────────────────
// 7. wht_amount pada non-supplier_payment → 400
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 7. WHT pada bukan supplier_payment → 400 ────────────────');

const r7 = await req('POST', '/accounting/bank-disbursements', {
  journalId,
  date: TODAY,
  items: [{
    transactionType: 'expense',      // expense tidak boleh punya WHT
    accountId: expAcct?.id ?? liabAcct.id,
    amount: 2_000_000,
    whtAmount: 100_000,
    whtAccountId: whtPayableAcct.id,
  }],
});
chk('7. WHT pada expense → 400', r7.status === 400, r7.body?.message);

// ────────────────────────────────────────────────────────────────────────────
// 8. purchase_document_id pada non-supplier_payment → 400
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── 8. purchase_document_id pada bukan supplier_payment → 400');

const r8 = await req('POST', '/accounting/bank-disbursements', {
  journalId,
  date: TODAY,
  items: [{
    transactionType: 'expense',
    accountId: expAcct?.id ?? liabAcct.id,
    amount: 500_000,
    purchaseDocumentId: 99999,        // dummy PO ID, type salah
  }],
});
chk('8. purchase_document_id pada expense → 400', r8.status === 400, r8.body?.message);

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────
await pool.end();

const total  = results.length;
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);

console.log(`\n${'─'.repeat(60)}`);
console.log(`TOTAL: ${passed}/${total} passed`);
if (failed.length > 0) {
  console.log(`\nFAILED:`);
  failed.forEach(r => console.log(`  ❌  ${r.name}`));
  process.exit(1);
} else {
  console.log('All Phase 1 tests passed ✅');
  process.exit(0);
}
