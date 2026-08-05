/**
 * Bank Disbursement Phase 1 — Verification Script
 *
 * Skenario yang diuji:
 *   T01 — POST BD supplier_payment TANPA WHT → cek payment_status PO
 *   T02 — POST BD supplier_payment DENGAN WHT → cek jurnal + payment_status PO
 *   T03 — VOID BD tanpa WHT → cek payment_status PO turun kembali
 *   T04 — VOID BD dengan WHT → cek reversal jurnal + payment_status PO turun
 *   T05 — Validasi: purchase_document_id pada non-supplier_payment → 400
 *   T06 — Validasi: wht_amount >= amount → 400
 *   T07 — Validasi: wht_amount > 0 tanpa wht_account_id → 400
 *   T08 — Validasi: wht_account_id bukan tipe liability (expense) → 400
 *   T09 — Double payment guard: PO yang sudah lunas → 409
 *   T10 — BD expense biasa (non supplier_payment) → P&L tidak tercampur
 *
 * Cara menjalankan (API Server harus sudah berjalan di port 8080):
 *   node artifacts/api-server/tests/bank-disbursement-phase1.test.mjs
 *
 * Akun yang dipakai (sesuai COA demo CST):
 *   Journal bank  : id=3  (Bank Mandiri CST, BNK-CST)
 *   Bank account  : id=18 (1-1020-CST Bank Mandiri CST — asset, default credit journal)
 *   AP account    : id=28 (2-1010-CST Hutang Usaha CST — liability)
 *   WHT account   : id=30 (2-1030-CST Hutang Pajak Lainnya CST — liability)
 *   Expense acct  : id=45 (5-1010-CST HPP CST — expense)
 *
 * Purchase documents yang dipakai:
 *   PO-A : id=4  (grand_total=6.000.000, unpaid)
 *   PO-B : id=5  (grand_total=9.500.000, unpaid)
 */

import http from "node:http";

const BASE_HOST = "localhost";
const BASE_PORT = 8080;
const BASE = `http://${BASE_HOST}:${BASE_PORT}`;

const JOURNAL_ID   = 3;   // Bank Mandiri CST
const ACCT_AP      = 28;  // Hutang Usaha CST (liability) — debit saat bayar hutang
const ACCT_WHT     = 30;  // Hutang Pajak Lainnya CST (liability) — credit WHT
const ACCT_EXPENSE = 45;  // HPP CST (expense) — untuk test non supplier_payment
const PO_A_ID      = 4;   // grand_total=6.000.000 unpaid
const PO_B_ID      = 5;   // grand_total=9.500.000 unpaid

let passed = 0;
let failed = 0;
const results = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(label, status, detail = "") {
  const icon = status === "PASS" ? "✅" : status === "SKIP" ? "⏭️ " : "❌";
  const line = `${icon} ${status.padEnd(5)} ${label}${detail ? `\n         ${detail}` : ""}`;
  console.log(line);
  results.push({ label, status, detail });
}

function pass(label, detail = "") { passed++; log(label, "PASS", detail); }
function fail(label, detail = "") { failed++; log(label, "FAIL", detail); }
function skip(label, detail = "") { log(label, "SKIP", detail); }

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: BASE_HOST,
      port: BASE_PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };
    const r = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.status ?? res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.status ?? res.statusCode, body: data }); }
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function devLogin() {
  const res = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: "admcst001@gmail.com" });
    const r = http.request(
      { hostname: BASE_HOST, port: BASE_PORT, path: "/api/dev-login", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        const setCookie = res.headers["set-cookie"] ?? [];
        const sidEntry = setCookie.find((c) => c.startsWith("sid="));
        if (!sidEntry) { reject(new Error("No sid cookie di respons dev-login")); return; }
        const sid = sidEntry.split(";")[0];
        res.resume();
        resolve(sid);
      }
    );
    r.on("error", reject);
    r.write(body);
    r.end();
  });
  return res;
}

function api(method, path, body, cookie) {
  return req(method, `/api${path}`, body, cookie ? { Cookie: cookie } : {});
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

async function getPoStatus(cookie, poId) {
  const res = await api("GET", `/purchase/documents/${poId}`, null, cookie);
  if (res.status !== 200) return null;
  return {
    paymentStatus: res.body.paymentStatus ?? res.body.payment_status,
    amountPaid: round2(res.body.amountPaid ?? res.body.amount_paid ?? 0),
    grandTotal: round2(res.body.grandTotal ?? res.body.grand_total ?? 0),
  };
}

async function getDisb(cookie, id) {
  const res = await api("GET", `/accounting/bank-disbursements/${id}`, null, cookie);
  return res;
}

async function getJournalEntry(cookie, entryId) {
  const res = await api("GET", `/accounting/entries/${entryId}`, null, cookie);
  return res;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Unique suffix per test run — mencegah unique constraint conflict pada
// (company_id, source, ref) WHERE status='posted' jika test dijalankan ulang
const RUN_ID = Date.now().toString(36).toUpperCase();

// ─── Main test runner ─────────────────────────────────────────────────────────

async function run() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Bank Disbursement Phase 1 — Verification Script");
  console.log(`  Target : http://${BASE_HOST}:${BASE_PORT}`);
  console.log(`  Waktu  : ${new Date().toLocaleString("id-ID")}`);
  console.log("══════════════════════════════════════════════════════════════\n");

  // ── Auth ──────────────────────────────────────────────────────────────────
  let cookie;
  try {
    cookie = await devLogin();
    console.log(`🔑  Auth   : OK (${cookie.slice(0, 20)}...)\n`);
  } catch (err) {
    fail("Auth: dev-login", String(err));
    console.log("\n❌ Tidak bisa login — abort.");
    printSummary();
    process.exit(1);
  }

  // ── Baseline PO status ────────────────────────────────────────────────────
  const poA0 = await getPoStatus(cookie, PO_A_ID);
  const poB0 = await getPoStatus(cookie, PO_B_ID);

  if (!poA0 || !poB0) {
    fail("Baseline PO", `PO id=${PO_A_ID} atau id=${PO_B_ID} tidak ditemukan — pastikan demo data ada`);
    printSummary();
    process.exit(1);
  }

  console.log(`📋  Baseline PO-A (id=${PO_A_ID}): status=${poA0.paymentStatus}, amountPaid=${poA0.amountPaid}, grandTotal=${poA0.grandTotal}`);
  console.log(`📋  Baseline PO-B (id=${PO_B_ID}): status=${poB0.paymentStatus}, amountPaid=${poB0.amountPaid}, grandTotal=${poB0.grandTotal}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // T01 — BD supplier_payment TANPA WHT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("── T01: BD supplier_payment tanpa WHT ──────────────────────────");
  const AMT_T01 = 1_000_000;
  let disbT01Id = null;

  const r01 = await api("POST", "/accounting/bank-disbursements", {
    journalId: JOURNAL_ID,
    date: today(),
    ref: `TEST-T01-${RUN_ID}`,
    memo: "Test Phase1 T01 — tanpa WHT",
    items: [{
      transactionType: "supplier_payment",
      accountId: ACCT_AP,
      description: "Bayar hutang supplier T01",
      amount: AMT_T01,
      purchaseDocumentId: PO_A_ID,
      whtAmount: 0,
    }],
  }, cookie);

  if (r01.status === 201) {
    disbT01Id = r01.body.id;
    const meta = r01.body._meta ?? {};
    pass("T01-a: POST BD tanpa WHT → 201",
      `id=${disbT01Id}, totalAmount=${meta.totalAmount}, totalWht=${meta.totalWht}, bankCredit=${meta.bankCredit}`);

    if (meta.totalWht === 0 && meta.bankCredit === AMT_T01) {
      pass("T01-b: bankCredit == grossAmount (tidak ada WHT)");
    } else {
      fail("T01-b: bankCredit == grossAmount", `totalWht=${meta.totalWht}, bankCredit=${meta.bankCredit}, expected=${AMT_T01}`);
    }

    if (Array.isArray(meta.linkedPOIds) && meta.linkedPOIds.includes(PO_A_ID)) {
      pass("T01-c: linkedPOIds berisi PO_A_ID");
    } else {
      fail("T01-c: linkedPOIds berisi PO_A_ID", JSON.stringify(meta.linkedPOIds));
    }
  } else {
    fail("T01-a: POST BD tanpa WHT", `status=${r01.status} — ${JSON.stringify(r01.body)}`);
  }

  // Tunggu recalculate async (non-blocking fire-and-forget)
  await new Promise((r) => setTimeout(r, 800));

  const poA1 = await getPoStatus(cookie, PO_A_ID);
  if (poA1) {
    const expectedPaid = round2((poA0.amountPaid) + AMT_T01);
    const expectedStatus = expectedPaid >= poA0.grandTotal ? "paid" : expectedPaid > 0 ? "partial" : "unpaid";
    if (poA1.amountPaid >= AMT_T01) {
      pass("T01-d: PO_A amountPaid naik setelah BD",
        `${poA0.amountPaid} → ${poA1.amountPaid}, status: ${poA0.paymentStatus} → ${poA1.paymentStatus}`);
    } else {
      fail("T01-d: PO_A amountPaid naik setelah BD",
        `amountPaid=${poA1.amountPaid}, expected≥${AMT_T01}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T02 — BD supplier_payment DENGAN WHT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── T02: BD supplier_payment dengan WHT ─────────────────────────");
  const AMT_T02 = 2_000_000;
  const WHT_T02 = 100_000;
  const NET_T02 = AMT_T02 - WHT_T02;
  let disbT02Id = null;

  const r02 = await api("POST", "/accounting/bank-disbursements", {
    journalId: JOURNAL_ID,
    date: today(),
    ref: `TEST-T02-${RUN_ID}`,
    memo: "Test Phase1 T02 — dengan WHT",
    items: [{
      transactionType: "supplier_payment",
      accountId: ACCT_AP,
      description: "Bayar hutang supplier T02 (termasuk WHT)",
      amount: AMT_T02,
      purchaseDocumentId: PO_B_ID,
      whtAmount: WHT_T02,
      whtAccountId: ACCT_WHT,
    }],
  }, cookie);

  if (r02.status === 201) {
    disbT02Id = r02.body.id;
    const meta = r02.body._meta ?? {};
    pass("T02-a: POST BD dengan WHT → 201",
      `id=${disbT02Id}, totalAmount=${meta.totalAmount}, totalWht=${meta.totalWht}, bankCredit=${meta.bankCredit}`);

    if (meta.totalWht === WHT_T02) {
      pass("T02-b: totalWht correct", `${meta.totalWht}`);
    } else {
      fail("T02-b: totalWht correct", `got=${meta.totalWht}, expected=${WHT_T02}`);
    }

    if (meta.bankCredit === NET_T02) {
      pass("T02-c: bankCredit == gross - WHT", `${AMT_T02} - ${WHT_T02} = ${NET_T02}`);
    } else {
      fail("T02-c: bankCredit == gross - WHT", `got=${meta.bankCredit}, expected=${NET_T02}`);
    }

    // Cek jurnal entry — harus ada baris CR WHT
    const detailRes = await getDisb(cookie, disbT02Id);
    if (detailRes.status === 200 && detailRes.body.entry) {
      const lines = detailRes.body.entry.lines ?? [];
      const whtCrLine = lines.find((l) => l.accountId === ACCT_WHT && Number(l.credit) > 0);
      const bankCrLine = lines.find((l) => Number(l.credit) > 0 && l.accountId !== ACCT_WHT);
      const apDrLine   = lines.find((l) => l.accountId === ACCT_AP && Number(l.debit) > 0);

      if (apDrLine) {
        pass("T02-d: Jurnal — DR Hutang Usaha ada", `debit=${apDrLine.debit}`);
      } else {
        fail("T02-d: Jurnal — DR Hutang Usaha ada", "baris DR AP tidak ditemukan");
      }

      if (whtCrLine) {
        pass("T02-e: Jurnal — CR Hutang Pajak/WHT ada",
          `accountId=${whtCrLine.accountId}, credit=${whtCrLine.credit}`);
      } else {
        fail("T02-e: Jurnal — CR Hutang Pajak/WHT ada",
          `lines=${JSON.stringify(lines.map((l) => ({ accountId: l.accountId, dr: l.debit, cr: l.credit })))}`);
      }

      if (bankCrLine) {
        const bankCrAmt = round2(Number(bankCrLine.credit));
        if (bankCrAmt === NET_T02) {
          pass("T02-f: Jurnal — CR Bank = net (gross - WHT)", `credit=${bankCrAmt}`);
        } else {
          fail("T02-f: Jurnal — CR Bank = net (gross - WHT)", `got=${bankCrAmt}, expected=${NET_T02}`);
        }
      } else {
        fail("T02-f: Jurnal — CR Bank ada", "baris CR bank tidak ditemukan");
      }
    } else {
      skip("T02-d/e/f: Jurnal entry detail", "entry tidak tersedia di response detail");
    }

    // PO_B payment_status
    await new Promise((r) => setTimeout(r, 800));
    const poB1 = await getPoStatus(cookie, PO_B_ID);
    if (poB1 && poB1.amountPaid >= AMT_T02) {
      pass("T02-g: PO_B amountPaid naik (dihitung dari gross, bukan net)",
        `${poB0.amountPaid} → ${poB1.amountPaid}, status: ${poB1.paymentStatus}`);
    } else if (poB1) {
      fail("T02-g: PO_B amountPaid naik", `amountPaid=${poB1.amountPaid}, expected≥${AMT_T02}`);
    }
  } else {
    fail("T02-a: POST BD dengan WHT", `status=${r02.status} — ${JSON.stringify(r02.body)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T03 — VOID BD tanpa WHT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── T03: VOID BD tanpa WHT ──────────────────────────────────────");

  if (!disbT01Id) {
    skip("T03: VOID BD tanpa WHT", "disbT01Id tidak ada — T01 gagal");
  } else {
    const poA_beforeVoid = await getPoStatus(cookie, PO_A_ID);

    const r03 = await api("POST", `/accounting/bank-disbursements/${disbT01Id}/void`,
      { reason: "Test VOID Phase1 T03" }, cookie);

    if (r03.status === 200) {
      pass("T03-a: VOID BD tanpa WHT → 200",
        `linkedPOsRecalculated=${JSON.stringify(r03.body.linkedPOsRecalculated)}`);

      // Cek disbursement status jadi voided
      const disbRes = await getDisb(cookie, disbT01Id);
      if (disbRes.body?.status === "voided") {
        pass("T03-b: disbursement.status = voided");
      } else {
        fail("T03-b: disbursement.status = voided", `got=${disbRes.body?.status}`);
      }

      // Tunggu recalculate
      await new Promise((r) => setTimeout(r, 800));

      const poA_afterVoid = await getPoStatus(cookie, PO_A_ID);
      if (poA_afterVoid && poA_beforeVoid) {
        if (poA_afterVoid.amountPaid < poA_beforeVoid.amountPaid) {
          pass("T03-c: PO_A amountPaid TURUN setelah void",
            `${poA_beforeVoid.amountPaid} → ${poA_afterVoid.amountPaid}, status: ${poA_afterVoid.paymentStatus}`);
        } else {
          fail("T03-c: PO_A amountPaid TURUN setelah void",
            `before=${poA_beforeVoid.amountPaid}, after=${poA_afterVoid.amountPaid}`);
        }
      }
    } else {
      fail("T03-a: VOID BD tanpa WHT", `status=${r03.status} — ${JSON.stringify(r03.body)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T04 — VOID BD dengan WHT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── T04: VOID BD dengan WHT ─────────────────────────────────────");

  if (!disbT02Id) {
    skip("T04: VOID BD dengan WHT", "disbT02Id tidak ada — T02 gagal");
  } else {
    const poB_beforeVoid = await getPoStatus(cookie, PO_B_ID);

    const r04 = await api("POST", `/accounting/bank-disbursements/${disbT02Id}/void`,
      { reason: "Test VOID Phase1 T04" }, cookie);

    if (r04.status === 200) {
      pass("T04-a: VOID BD dengan WHT → 200",
        `linkedPOsRecalculated=${JSON.stringify(r04.body.linkedPOsRecalculated)}`);

      // Cek void_entry_id ada (reversal jurnal)
      await new Promise((r) => setTimeout(r, 400));
      const disbVoided = await getDisb(cookie, disbT02Id);
      if (disbVoided.body?.status === "voided") {
        pass("T04-b: disbursement.status = voided");
      } else {
        fail("T04-b: disbursement.status = voided", `got=${disbVoided.body?.status}`);
      }

      if (disbVoided.body?.voidEntryId) {
        pass("T04-c: voidEntryId ada (reversal journal dibuat)",
          `voidEntryId=${disbVoided.body.voidEntryId}`);
      } else {
        fail("T04-c: voidEntryId ada", "voidEntryId = null atau tidak ada");
      }

      // Tunggu recalculate
      await new Promise((r) => setTimeout(r, 800));

      const poB_afterVoid = await getPoStatus(cookie, PO_B_ID);
      if (poB_afterVoid && poB_beforeVoid) {
        if (poB_afterVoid.amountPaid < poB_beforeVoid.amountPaid) {
          pass("T04-d: PO_B amountPaid TURUN setelah void",
            `${poB_beforeVoid.amountPaid} → ${poB_afterVoid.amountPaid}, status: ${poB_afterVoid.paymentStatus}`);
        } else {
          fail("T04-d: PO_B amountPaid TURUN setelah void",
            `before=${poB_beforeVoid.amountPaid}, after=${poB_afterVoid.amountPaid}`);
        }
      }
    } else {
      fail("T04-a: VOID BD dengan WHT", `status=${r04.status} — ${JSON.stringify(r04.body)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T05 — Validasi: purchase_document_id pada transaction_type selain supplier_payment
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── T05–T09: Validasi rules ──────────────────────────────────────");

  const r05 = await api("POST", "/accounting/bank-disbursements", {
    journalId: JOURNAL_ID,
    date: today(),
    ref: `TEST-T05-${RUN_ID}`,
    memo: "Test validasi T05",
    items: [{
      transactionType: "expense",
      accountId: ACCT_EXPENSE,
      description: "Beban operasional",
      amount: 500_000,
      purchaseDocumentId: PO_A_ID,
    }],
  }, cookie);

  if (r05.status === 400 && JSON.stringify(r05.body).includes("supplier_payment")) {
    pass("T05: purchase_document_id pada expense → 400",
      r05.body.message ?? JSON.stringify(r05.body));
  } else {
    fail("T05: purchase_document_id pada expense → 400",
      `status=${r05.status}, body=${JSON.stringify(r05.body)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T06 — Validasi: wht_amount >= amount → 400
  // ═══════════════════════════════════════════════════════════════════════════
  const r06 = await api("POST", "/accounting/bank-disbursements", {
    journalId: JOURNAL_ID,
    date: today(),
    ref: `TEST-T06-${RUN_ID}`,
    memo: "Test validasi T06",
    items: [{
      transactionType: "supplier_payment",
      accountId: ACCT_AP,
      description: "Test wht >= amount",
      amount: 1_000_000,
      purchaseDocumentId: PO_A_ID,
      whtAmount: 1_000_000,
      whtAccountId: ACCT_WHT,
    }],
  }, cookie);

  if (r06.status === 400) {
    pass("T06: whtAmount >= amount → 400", r06.body.message ?? JSON.stringify(r06.body));
  } else {
    fail("T06: whtAmount >= amount → 400", `status=${r06.status}, body=${JSON.stringify(r06.body)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T07 — Validasi: wht_amount > 0 tanpa wht_account_id → 400
  // ═══════════════════════════════════════════════════════════════════════════
  const r07 = await api("POST", "/accounting/bank-disbursements", {
    journalId: JOURNAL_ID,
    date: today(),
    ref: `TEST-T07-${RUN_ID}`,
    memo: "Test validasi T07",
    items: [{
      transactionType: "supplier_payment",
      accountId: ACCT_AP,
      description: "Test wht tanpa account",
      amount: 1_000_000,
      purchaseDocumentId: PO_A_ID,
      whtAmount: 50_000,
    }],
  }, cookie);

  if (r07.status === 400 && JSON.stringify(r07.body).includes("wht_account_id")) {
    pass("T07: whtAmount > 0 tanpa whtAccountId → 400", r07.body.message ?? JSON.stringify(r07.body));
  } else {
    fail("T07: whtAmount > 0 tanpa whtAccountId → 400",
      `status=${r07.status}, body=${JSON.stringify(r07.body)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T08 — Validasi: wht_account_id bukan liability (expense) → 400
  // ═══════════════════════════════════════════════════════════════════════════
  const r08 = await api("POST", "/accounting/bank-disbursements", {
    journalId: JOURNAL_ID,
    date: today(),
    ref: `TEST-T08-${RUN_ID}`,
    memo: "Test validasi T08",
    items: [{
      transactionType: "supplier_payment",
      accountId: ACCT_AP,
      description: "Test wht account bukan liability",
      amount: 1_000_000,
      purchaseDocumentId: PO_A_ID,
      whtAmount: 50_000,
      whtAccountId: ACCT_EXPENSE,
    }],
  }, cookie);

  if (r08.status === 400 && JSON.stringify(r08.body).toLowerCase().includes("liability")) {
    pass("T08: whtAccountId bertipe expense → 400 (must be liability)",
      r08.body.message ?? JSON.stringify(r08.body));
  } else {
    fail("T08: whtAccountId bertipe expense → 400",
      `status=${r08.status}, body=${JSON.stringify(r08.body)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T09 — Anti-double payment: buat BD penuh lalu coba lagi → 409
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── T09: Anti-double payment (PO lunas) ─────────────────────────");

  // Ambil grand_total PO_A setelah T03 void, PO_A harusnya kembali ke baseline
  const poA_now = await getPoStatus(cookie, PO_A_ID);
  const fullAmt = poA_now ? poA_now.grandTotal : 6_000_000;
  const remaining = poA_now ? Math.max(0, poA_now.grandTotal - poA_now.amountPaid) : 6_000_000;

  if (remaining > 0) {
    // Bayar sisa penuh dulu
    const rFull = await api("POST", "/accounting/bank-disbursements", {
      journalId: JOURNAL_ID,
      date: today(),
      ref: `TEST-T09-FULL-${RUN_ID}`,
      memo: "Test T09 — lunasi PO_A penuh",
      items: [{
        transactionType: "supplier_payment",
        accountId: ACCT_AP,
        amount: remaining,
        purchaseDocumentId: PO_A_ID,
      }],
    }, cookie);

    if (rFull.status !== 201) {
      skip("T09: Anti-double payment", `Gagal buat BD pelunasan penuh: status=${rFull.status}`);
    } else {
      await new Promise((r) => setTimeout(r, 800));

      // Coba bayar lagi — harus 409
      const rDouble = await api("POST", "/accounting/bank-disbursements", {
        journalId: JOURNAL_ID,
        date: today(),
        ref: `TEST-T09-DOUBLE-${RUN_ID}`,
        memo: "Test T09 — double payment harusnya 409",
        items: [{
          transactionType: "supplier_payment",
          accountId: ACCT_AP,
          amount: 100_000,
          purchaseDocumentId: PO_A_ID,
        }],
      }, cookie);

      if (rDouble.status === 409) {
        pass("T09: Bayar PO yang sudah lunas → 409", rDouble.body.message ?? "");
      } else {
        fail("T09: Bayar PO yang sudah lunas → 409",
          `status=${rDouble.status}, body=${JSON.stringify(rDouble.body)}`);
      }

      // Cleanup: void BD pelunasan agar PO balik unpaid
      await api("POST", `/accounting/bank-disbursements/${rFull.body.id}/void`,
        { reason: "Cleanup test T09" }, cookie);
    }
  } else {
    skip("T09: Anti-double payment", `PO_A sudah lunas sebelum test (amountPaid=${poA_now?.amountPaid}, grandTotal=${poA_now?.grandTotal})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // T10 — BD expense biasa (non supplier_payment) — tidak ada WHT/PO link
  //        Verifikasi: P&L affected (akun expense), tidak ada WHT, tidak ada PO link
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── T10: BD expense biasa (non supplier_payment) ────────────────");
  const AMT_T10 = 750_000;

  const r10 = await api("POST", "/accounting/bank-disbursements", {
    journalId: JOURNAL_ID,
    date: today(),
    ref: `TEST-T10-${RUN_ID}`,
    memo: "Test Phase1 T10 — expense biasa",
    items: [{
      transactionType: "expense",
      accountId: ACCT_EXPENSE,
      description: "Biaya operasional",
      amount: AMT_T10,
    }],
  }, cookie);

  if (r10.status === 201) {
    const meta = r10.body._meta ?? {};
    pass("T10-a: POST BD expense → 201",
      `id=${r10.body.id}, bankCredit=${meta.bankCredit}, linkedPOIds=${JSON.stringify(meta.linkedPOIds)}`);

    const noLinkedPO = !meta.linkedPOIds || meta.linkedPOIds.length === 0;
    if (noLinkedPO) {
      pass("T10-b: linkedPOIds kosong (expense tidak mengupdate PO)");
    } else {
      fail("T10-b: linkedPOIds kosong", `got=${JSON.stringify(meta.linkedPOIds)}`);
    }

    if (meta.totalWht === 0) {
      pass("T10-c: totalWht = 0 (expense tanpa WHT)");
    } else {
      fail("T10-c: totalWht = 0", `got=${meta.totalWht}`);
    }

    // Void untuk cleanup
    await api("POST", `/accounting/bank-disbursements/${r10.body.id}/void`,
      { reason: "Cleanup test T10" }, cookie);
  } else {
    fail("T10-a: POST BD expense → 201", `status=${r10.status} — ${JSON.stringify(r10.body)}`);
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  printSummary();
}

function printSummary() {
  const total = passed + failed;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  RINGKASAN HASIL");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Total   : ${total} test (${skipped} skip)`);
  console.log(`  ✅ PASS  : ${passed}`);
  console.log(`  ❌ FAIL  : ${failed}`);
  console.log("──────────────────────────────────────────────────────────────");

  if (failed > 0) {
    console.log("\n  Daftar yang GAGAL:");
    for (const r of results) {
      if (r.status === "FAIL") {
        console.log(`    ❌ ${r.label}`);
        if (r.detail) console.log(`       ${r.detail}`);
      }
    }
  }

  console.log("\n  Jurnal yang dihasilkan (contoh):");
  console.log("  ┌─ Tanpa WHT (T01): ────────────────────────────────────────");
  console.log("  │  DR Hutang Usaha CST        1.000.000");
  console.log("  │      CR Bank Mandiri CST                1.000.000");
  console.log("  ├─ Dengan WHT (T02): ───────────────────────────────────────");
  console.log("  │  DR Hutang Usaha CST        2.000.000");
  console.log("  │      CR Hutang Pajak Lainnya              100.000");
  console.log("  │      CR Bank Mandiri CST                1.900.000");
  console.log("  └─ Void (T03/T04): (swap DR↔CR dari jurnal asli) ──────────");
  console.log("══════════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("❌ Script error:", err);
  process.exit(1);
});
