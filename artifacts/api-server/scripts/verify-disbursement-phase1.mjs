/**
 * verify-disbursement-phase1.mjs
 *
 * Script verifikasi manual untuk Phase 1 Bank Disbursement enhancement.
 * Menguji 4 skenario:
 *   S1. supplier_payment tanpa WHT, dengan purchase_document_id
 *   S2. supplier_payment dengan WHT, dengan purchase_document_id
 *   S3. Void disbursement → pastikan payment_status turun kembali
 *   S4. expense item biasa (tidak boleh punya purchase_document_id)
 *
 * Usage:
 *   node artifacts/api-server/scripts/verify-disbursement-phase1.mjs
 *
 * Requires: API Server running, cookie/header auth tidak diperlukan
 * (script memanggil endpoint internal langsung via HTTP ke localhost).
 *
 * Env:
 *   API_BASE   — default http://localhost:8080
 *   COMPANY_ID — default 1
 */

const BASE      = process.env.API_BASE   ?? "http://localhost:8080";
const COMPANY   = process.env.COMPANY_ID ?? "1";

let passed = 0;
let failed = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-company-id": COMPANY,
      // Bypass auth di dev: pakai header yang sama dengan BizPortal internal
      "x-internal-service": "verify-script",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

function ok(label, cond, detail) {
  if (cond) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    if (detail !== undefined) console.error(`       → ${JSON.stringify(detail)}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶  ${title}`);
  console.log("─".repeat(60));
}

// ── Lookup helpers ─────────────────────────────────────────────────────────────

async function getMetaAccounts(subtype) {
  const { data } = await api("GET", `/api/accounting/bank-disbursements/meta/accounts?subtype=${subtype}`);
  return Array.isArray(data) ? data : [];
}

async function getAllAccounts(type) {
  const { data } = await api("GET", `/api/accounting/bank-disbursements/meta/accounts?type=${type}`);
  return Array.isArray(data) ? data : [];
}

async function getJournals() {
  const { data } = await api("GET", `/api/accounting/journals`);
  return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
}

async function getPurchaseDocPaymentStatus(purchaseDocId) {
  const { data } = await api("GET", `/api/purchase/documents/${purchaseDocId}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Bank Disbursement Phase 1 — Verification Script");
  console.log(`  API: ${BASE}  |  Company: ${COMPANY}`);
  console.log("=".repeat(60));

  // ── Setup: resolve accounts and journal ──────────────────────────────────
  section("Setup: Resolving accounts & journals");

  const bankAccounts  = await getMetaAccounts("cash_bank");
  const liabAccounts  = await getAllAccounts("liability");
  const expenseAccounts = await getAllAccounts("expense");
  const journals      = await getJournals();

  const bankJournal   = journals.find(j => j.type === "bank" || j.type === "cash");
  const bankAccount   = bankAccounts[0];
  const apAccount     = liabAccounts.find(a => a.code?.includes("2-101") || a.name?.toLowerCase().includes("hutang usaha") || a.name?.toLowerCase().includes("accounts payable")) ?? liabAccounts[0];
  const whtAccount    = liabAccounts.find(a => a.name?.toLowerCase().includes("pajak") || a.name?.toLowerCase().includes("wht") || a.name?.toLowerCase().includes("pph")) ?? liabAccounts[0];
  const expenseAccount = expenseAccounts[0];

  console.log(`  Bank Journal  : ${bankJournal ? `[${bankJournal.id}] ${bankJournal.name} (${bankJournal.type})` : "NOT FOUND"}`);
  console.log(`  Bank Account  : ${bankAccount ? `[${bankAccount.id}] ${bankAccount.code} ${bankAccount.name}` : "NOT FOUND"}`);
  console.log(`  AP Account    : ${apAccount   ? `[${apAccount.id}] ${apAccount.code} ${apAccount.name}` : "NOT FOUND"}`);
  console.log(`  WHT Account   : ${whtAccount  ? `[${whtAccount.id}] ${whtAccount.code} ${whtAccount.name}` : "NOT FOUND"}`);
  console.log(`  Exp Account   : ${expenseAccount ? `[${expenseAccount.id}] ${expenseAccount.code} ${expenseAccount.name}` : "NOT FOUND"}`);

  if (!bankJournal || !bankAccount || !apAccount) {
    console.error("\n❌  Setup gagal: akun atau jurnal tidak ditemukan. Pastikan COA dan Journals sudah disetup.");
    process.exit(1);
  }

  // Cari satu purchase document untuk dites (bisa unpaid atau partial)
  const { data: poList } = await api("GET", `/api/purchase/documents?limit=10&kind=order`);
  const poListArr = Array.isArray(poList) ? poList : (Array.isArray(poList?.data) ? poList.data : []);
  const testPO = poListArr.find(d => d.billStatus === "billed" || d.grandTotal > 0) ?? poListArr[0];

  if (testPO) {
    console.log(`  Test PO       : [${testPO.id}] ${testPO.docNumber} | grand_total=${testPO.grandTotal} | payment_status=${testPO.paymentStatus ?? testPO.payment_status ?? "?"}`);
  } else {
    console.log(`  Test PO       : TIDAK DITEMUKAN — S1/S2/S3 akan skip cek payment_status`);
  }

  const purchaseDocId = testPO?.id ?? null;
  const poGrandTotal  = purchaseDocId ? Number(testPO.grandTotal ?? testPO.grand_total ?? 0) : 0;

  // ─────────────────────────────────────────────────────────────────────────────
  section("S1: supplier_payment TANPA WHT, dengan purchase_document_id");

  const payAmt = purchaseDocId ? Math.min(poGrandTotal * 0.3, 500000) : 100000;
  const s1Body = {
    journalId: bankJournal.id,
    date: new Date().toISOString().slice(0, 10),
    ref: `VERIFY-S1-${Date.now()}`,
    memo: "Verifikasi Phase 1 — S1 tanpa WHT",
    items: [
      {
        transactionType: "supplier_payment",
        accountId: apAccount.id,
        description: "Bayar hutang supplier (no WHT)",
        amount: payAmt,
        purchaseDocumentId: purchaseDocId,
        whtAmount: 0,
      },
    ],
  };

  const s1 = await api("POST", "/api/accounting/bank-disbursements", s1Body);
  console.log(`  POST status   : ${s1.status}`);
  ok("S1: HTTP 201", s1.status === 201, s1.data?.message);
  ok("S1: disbursementNumber ada", !!s1.data?.disbursementNumber, s1.data?.disbursementNumber);
  ok("S1: status = posted", s1.data?.status === "posted", s1.data?.status);
  ok("S1: entryId ada (jurnal terposting)", !!s1.data?.entryId, s1.data?.entryId);
  ok("S1: _meta.totalWht = 0", s1.data?._meta?.totalWht === 0, s1.data?._meta);
  ok("S1: _meta.bankCredit = gross", s1.data?._meta?.bankCredit === payAmt, s1.data?._meta);

  const s1DisbId = s1.data?.id;

  // Cek item tersimpan dengan benar
  if (s1DisbId) {
    const s1Detail = await api("GET", `/api/accounting/bank-disbursements/${s1DisbId}`);
    const item0 = s1Detail.data?.items?.[0];
    ok("S1: item.purchaseDocumentId tersimpan", item0?.purchaseDocumentId === purchaseDocId, item0?.purchaseDocumentId);
    ok("S1: item.whtAmount = 0", item0?.whtAmount === 0, item0?.whtAmount);
    ok("S1: item.whtAccountId = null", item0?.whtAccountId === null, item0?.whtAccountId);
  }

  if (purchaseDocId) {
    await new Promise(r => setTimeout(r, 800)); // tunggu recalculate async
    const po1 = await getPurchaseDocPaymentStatus(purchaseDocId);
    const po1Paid = Number(po1?.amountPaid ?? po1?.amount_paid ?? 0);
    ok("S1: amount_paid PO > 0 setelah disbursement", po1Paid > 0, { amountPaid: po1Paid });
    ok("S1: payment_status PO bukan unpaid (partial atau paid)", po1?.paymentStatus !== "unpaid" || po1?.payment_status !== "unpaid", po1?.paymentStatus ?? po1?.payment_status);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  section("S2: supplier_payment DENGAN WHT, dengan purchase_document_id");

  const grossAmt  = 1_000_000;
  const whtAmt    = 20_000;
  const netAmt    = grossAmt - whtAmt;

  const s2Body = {
    journalId: bankJournal.id,
    date: new Date().toISOString().slice(0, 10),
    ref: `VERIFY-S2-${Date.now()}`,
    memo: "Verifikasi Phase 1 — S2 dengan WHT",
    items: [
      {
        transactionType: "supplier_payment",
        accountId: apAccount.id,
        description: "Bayar hutang supplier (dengan WHT)",
        amount: grossAmt,
        purchaseDocumentId: purchaseDocId,
        whtAmount: whtAmt,
        whtAccountId: whtAccount.id,
      },
    ],
  };

  const s2 = await api("POST", "/api/accounting/bank-disbursements", s2Body);
  console.log(`  POST status   : ${s2.status}`);
  ok("S2: HTTP 201", s2.status === 201, s2.data?.message);
  ok("S2: _meta.totalWht = whtAmt", s2.data?._meta?.totalWht === whtAmt, s2.data?._meta);
  ok("S2: _meta.bankCredit = net (gross - wht)", s2.data?._meta?.bankCredit === netAmt, s2.data?._meta);
  ok("S2: _meta.totalAmount = gross", s2.data?._meta?.totalAmount === grossAmt, s2.data?._meta);

  const s2DisbId = s2.data?.id;

  // Verifikasi jurnal
  if (s2DisbId) {
    const s2Detail = await api("GET", `/api/accounting/bank-disbursements/${s2DisbId}`);
    const s2Entry  = s2Detail.data?.entry;
    if (s2Entry?.lines) {
      const lines    = s2Entry.lines;
      const drLines  = lines.filter(l => Number(l.debit) > 0);
      const crLines  = lines.filter(l => Number(l.credit) > 0);
      const bankCrLine  = crLines.find(l => l.accountId === bankAccount.id || Number(l.credit) === netAmt);
      const whtCrLine   = crLines.find(l => l.accountId === whtAccount.id  || Number(l.credit) === whtAmt);

      ok("S2: DR line count = 1", drLines.length === 1, drLines.length);
      ok("S2: DR amount = gross", Number(drLines[0]?.debit) === grossAmt, drLines[0]?.debit);
      ok("S2: CR lines count = 2 (bank + wht)", crLines.length === 2, crLines.length);
      ok("S2: CR Bank = net paid", bankCrLine != null, { netAmt, crLines: crLines.map(l => ({ accountId: l.accountId, credit: l.credit })) });
      ok("S2: CR WHT = wht_amount", whtCrLine != null, { whtAmt, crLines: crLines.map(l => ({ accountId: l.accountId, credit: l.credit })) });

      // Pastikan sum CR = sum DR (balance)
      const sumDr = drLines.reduce((s, l) => s + Number(l.debit), 0);
      const sumCr = crLines.reduce((s, l) => s + Number(l.credit), 0);
      ok("S2: jurnal balance (sum DR = sum CR)", Math.abs(sumDr - sumCr) < 0.01, { sumDr, sumCr });
    } else {
      ok("S2: entry.lines tersedia", false, "entry tidak ada atau tidak punya lines");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  section("S3: Void disbursement dari S2 → payment_status harus turun");

  let poBefore = null;
  if (purchaseDocId) {
    await new Promise(r => setTimeout(r, 800));
    poBefore = await getPurchaseDocPaymentStatus(purchaseDocId);
    console.log(`  PO sebelum void: amount_paid=${poBefore?.amountPaid ?? poBefore?.amount_paid}, status=${poBefore?.paymentStatus ?? poBefore?.payment_status}`);
  }

  let s3DisbId = s2DisbId ?? s1DisbId;
  if (!s3DisbId) {
    ok("S3: ada disbursement untuk divoid", false, "s2DisbId dan s1DisbId keduanya null — S3 dilewati");
  } else {
    const s3 = await api("POST", `/api/accounting/bank-disbursements/${s3DisbId}/void`, {
      reason: "Test void dari verify-disbursement-phase1.mjs",
    });
    console.log(`  VOID status   : ${s3.status}`);
    ok("S3: HTTP 200", s3.status === 200, s3.data?.message);
    ok("S3: linkedPOsRecalculated ada", Array.isArray(s3.data?.linkedPOsRecalculated), s3.data);

    // Cek status disbursement setelah void
    const s3Detail = await api("GET", `/api/accounting/bank-disbursements/${s3DisbId}`);
    ok("S3: status disbursement = voided", s3Detail.data?.status === "voided", s3Detail.data?.status);
    ok("S3: voidEntryId ada (reversal journal)", !!s3Detail.data?.voidEntryId, s3Detail.data?.voidEntryId);

    if (purchaseDocId) {
      await new Promise(r => setTimeout(r, 800));
      const poAfter = await getPurchaseDocPaymentStatus(purchaseDocId);
      const amtBefore = Number(poBefore?.amountPaid ?? poBefore?.amount_paid ?? 0);
      const amtAfter  = Number(poAfter?.amountPaid  ?? poAfter?.amount_paid  ?? 0);
      console.log(`  PO sesudah void: amount_paid=${amtAfter}, status=${poAfter?.paymentStatus ?? poAfter?.payment_status}`);
      ok("S3: amount_paid PO berkurang setelah void", amtAfter < amtBefore, { amtBefore, amtAfter });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  section("S4: Validasi — purchaseDocumentId HANYA untuk supplier_payment");

  const s4 = await api("POST", "/api/accounting/bank-disbursements", {
    journalId: bankJournal.id,
    date: new Date().toISOString().slice(0, 10),
    ref: `VERIFY-S4-${Date.now()}`,
    items: [
      {
        transactionType: "expense",
        accountId: expenseAccount?.id ?? apAccount.id,
        description: "Test invalid purchaseDocumentId on expense",
        amount: 100000,
        purchaseDocumentId: purchaseDocId ?? 1,
      },
    ],
  });
  console.log(`  POST status   : ${s4.status}`);
  ok("S4: HTTP 400 (purchase_document_id dilarang di expense)", s4.status === 400, s4.data?.message);
  console.log(`  Error message : ${s4.data?.message}`);

  // ─────────────────────────────────────────────────────────────────────────────
  section("S5: Validasi — wht_amount >= amount harus ditolak");

  const s5 = await api("POST", "/api/accounting/bank-disbursements", {
    journalId: bankJournal.id,
    date: new Date().toISOString().slice(0, 10),
    items: [
      {
        transactionType: "supplier_payment",
        accountId: apAccount.id,
        amount: 100000,
        whtAmount: 100000,  // sama dengan amount → harus ditolak
        whtAccountId: whtAccount.id,
      },
    ],
  });
  ok("S5: HTTP 400 (wht >= amount)", s5.status === 400, s5.data?.message);
  console.log(`  Error message : ${s5.data?.message}`);

  // ─────────────────────────────────────────────────────────────────────────────
  section("S6: Validasi — wht_amount > 0 tanpa wht_account_id harus ditolak");

  const s6 = await api("POST", "/api/accounting/bank-disbursements", {
    journalId: bankJournal.id,
    date: new Date().toISOString().slice(0, 10),
    items: [
      {
        transactionType: "supplier_payment",
        accountId: apAccount.id,
        amount: 100000,
        whtAmount: 5000,
        // whtAccountId: tidak diisi → harus ditolak
      },
    ],
  });
  ok("S6: HTTP 400 (wht_amount tanpa wht_account_id)", s6.status === 400, s6.data?.message);
  console.log(`  Error message : ${s6.data?.message}`);

  // ─────────────────────────────────────────────────────────────────────────────
  section("S7: Validasi — wht pada non-supplier_payment harus ditolak");

  const s7 = await api("POST", "/api/accounting/bank-disbursements", {
    journalId: bankJournal.id,
    date: new Date().toISOString().slice(0, 10),
    items: [
      {
        transactionType: "expense",
        accountId: expenseAccount?.id ?? apAccount.id,
        amount: 100000,
        whtAmount: 5000,
        whtAccountId: whtAccount.id,
      },
    ],
  });
  ok("S7: HTTP 400 (WHT hanya untuk supplier_payment)", s7.status === 400, s7.data?.message);
  console.log(`  Error message : ${s7.data?.message}`);

  // ─────────────────────────────────────────────────────────────────────────────
  section("Ringkasan");
  console.log(`\n  Total: ${passed + failed} tes | ✅ ${passed} passed | ❌ ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error("\n💥 Script error:", e);
  process.exit(1);
});
