import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { postToAccountingHub } from "../lib/accountingPostingService.js";

const router = Router();

function getCompanyId(req: any): number | null {
  const id = req.user?.companyId ?? req.query.companyId ?? req.body?.companyId;
  return id ? Number(id) : null;
}

function genNo(prefix: string): string {
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900000) + 100000);
  return `${prefix}/${yy}/${mm}/${rand}`;
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

router.get("/dashboard", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const today = new Date().toISOString().slice(0, 10);

    // Saldo per rekening + total
    const accountsQ = await db.execute(sql`
      SELECT
        cba.id, cba.name, cba.account_type, cba.bank_name, cba.account_number,
        cba.currency, cba.currency_code, cba.coa_id,
        coa.code AS coa_code, coa.name AS coa_name,
        COALESCE((
          SELECT SUM(ael.debit) - SUM(ael.credit)
          FROM accounting_entry_lines ael
          JOIN accounting_entries ae ON ae.id = ael.entry_id
          WHERE ael.account_id = cba.coa_id AND ae.status = 'posted'
        ), 0) AS balance
      FROM company_bank_accounts cba
      LEFT JOIN chart_of_accounts coa ON coa.id = cba.coa_id
      WHERE cba.company_id = ${companyId} AND cba.is_active = TRUE
      ORDER BY cba.account_type, cba.name
    `);

    const accounts = accountsQ.rows as any[];
    const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.balance || "0"), 0);

    // Cash In hari ini (dari accounting_entry_lines — debit pada COA kas/bank)
    const cashInQ = await db.execute(sql`
      SELECT COALESCE(SUM(ael.debit), 0) AS total
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN company_bank_accounts cba ON cba.coa_id = ael.account_id
      WHERE ae.status = 'posted'
        AND ae.company_id = ${companyId}
        AND ae.date::date = ${today}::date
        AND cba.company_id = ${companyId}
    `);

    // Cash Out hari ini (kredit pada COA kas/bank)
    const cashOutQ = await db.execute(sql`
      SELECT COALESCE(SUM(ael.credit), 0) AS total
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN company_bank_accounts cba ON cba.coa_id = ael.account_id
      WHERE ae.status = 'posted'
        AND ae.company_id = ${companyId}
        AND ae.date::date = ${today}::date
        AND cba.company_id = ${companyId}
    `);

    // Transfer hari ini
    const transferQ = await db.execute(sql`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
      FROM fund_transfers
      WHERE company_id = ${companyId}
        AND date = ${today}::date
        AND status IN ('COMPLETED', 'posted')
    `);

    // Pending reconciliation
    const pendingReconQ = await db.execute(sql`
      SELECT COUNT(*) AS count
      FROM bank_mutations
      WHERE company_id = ${companyId}
        AND status IN ('unmatched', 'pending')
    `).catch(() => ({ rows: [{ count: 0 }] }));

    // Petty cash balance
    const pettyCashQ = await db.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('CASH_IN','REIMBURSEMENT') THEN amount ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN transaction_type IN ('CASH_OUT','EXPENSE','ADVANCE') THEN amount ELSE 0 END), 0) AS balance
      FROM petty_cash_transactions
      WHERE company_id = ${companyId} AND status = 'COMPLETED'
    `).catch(() => ({ rows: [{ balance: 0 }] }));

    // Saldo 7 hari terakhir (history)
    const historyQ = await db.execute(sql`
      SELECT snapshot_date, SUM(closing_balance) AS total_balance
      FROM cash_bank_balance_history
      WHERE company_id = ${companyId}
        AND snapshot_date >= (CURRENT_DATE - INTERVAL '7 days')
      GROUP BY snapshot_date
      ORDER BY snapshot_date
    `).catch(() => ({ rows: [] }));

    // Balance by type
    const byType: Record<string, number> = {};
    for (const a of accounts) {
      byType[a.account_type] = (byType[a.account_type] || 0) + parseFloat(a.balance || "0");
    }

    res.json({
      total_balance: totalBalance,
      balance_by_type: byType,
      accounts,
      cash_in_today: parseFloat((cashInQ.rows[0] as any)?.total || "0"),
      cash_out_today: parseFloat((cashOutQ.rows[0] as any)?.total || "0"),
      transfer_count_today: parseInt((transferQ.rows[0] as any)?.count || "0"),
      transfer_amount_today: parseFloat((transferQ.rows[0] as any)?.total || "0"),
      pending_reconciliation: parseInt((pendingReconQ.rows[0] as any)?.count || "0"),
      petty_cash_balance: parseFloat((pettyCashQ.rows[0] as any)?.balance || "0"),
      balance_history: historyQ.rows,
    });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] GET dashboard error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ACCOUNTS
// ════════════════════════════════════════════════════════════════════════════

router.get("/accounts", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const rows = await db.execute(sql`
      SELECT
        cba.*,
        coa.code  AS coa_code,
        coa.name  AS coa_name,
        cat.name  AS category_name,
        cat.color AS category_color,
        COALESCE((
          SELECT SUM(ael.debit) - SUM(ael.credit)
          FROM accounting_entry_lines ael
          JOIN accounting_entries ae ON ae.id = ael.entry_id
          WHERE ael.account_id = cba.coa_id AND ae.status = 'posted'
        ), 0) AS balance
      FROM company_bank_accounts cba
      LEFT JOIN chart_of_accounts coa ON coa.id = cba.coa_id
      LEFT JOIN cash_bank_categories cat ON cat.id = cba.category_id
      WHERE cba.company_id = ${companyId}
      ORDER BY cba.is_active DESC, cba.account_type, cba.name
    `);
    res.json({ data: rows.rows });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] GET accounts error");
    res.status(500).json({ error: err.message });
  }
});

router.post("/accounts", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    const {
      name, account_type, bank_name, account_number, account_holder,
      currency, currency_code, coa_id, notes, description,
      opening_balance, minimum_balance, bank_branch, swift_code, iban,
      virtual_account_prefix, reconciliation_method, is_default,
      category_id, branch_id, exchange_rate, base_currency,
    } = req.body;

    if (!companyId || !name || !account_type) {
      return res.status(400).json({ error: "companyId, name, account_type wajib" });
    }

    const result = await db.execute(sql`
      INSERT INTO company_bank_accounts (
        company_id, branch_id, name, account_type, bank_name, account_number,
        account_holder, currency, currency_code, coa_id, notes, description,
        opening_balance, minimum_balance, bank_branch, swift_code, iban,
        virtual_account_prefix, reconciliation_method, is_default, category_id,
        exchange_rate, base_currency, is_active, created_by_id, created_at, updated_at
      ) VALUES (
        ${companyId}, ${branch_id ?? null}, ${name}, ${account_type},
        ${bank_name ?? null}, ${account_number ?? null}, ${account_holder ?? null},
        ${currency ?? currency_code ?? "IDR"}, ${currency_code ?? currency ?? "IDR"},
        ${coa_id ? Number(coa_id) : null}, ${notes ?? null}, ${description ?? null},
        ${opening_balance ?? 0}, ${minimum_balance ?? 0},
        ${bank_branch ?? null}, ${swift_code ?? null}, ${iban ?? null},
        ${virtual_account_prefix ?? null}, ${reconciliation_method ?? "MANUAL"},
        ${is_default ?? false}, ${category_id ? Number(category_id) : null},
        ${exchange_rate ?? 1}, ${base_currency ?? "IDR"},
        TRUE, ${req.user?.email ?? null}, NOW(), NOW()
      ) RETURNING *
    `);
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] POST accounts error");
    res.status(500).json({ error: err.message });
  }
});

router.patch("/accounts/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = getCompanyId(req);
    const sets: string[] = [];
    const allowed = [
      "name","account_type","bank_name","account_number","account_holder",
      "currency","currency_code","coa_id","notes","description","opening_balance",
      "minimum_balance","bank_branch","swift_code","iban","virtual_account_prefix",
      "reconciliation_method","is_default","is_active","category_id","branch_id",
      "exchange_rate","base_currency",
    ];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        const v = req.body[k];
        sets.push(`${k} = ${v === null ? "NULL" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : v}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "Tidak ada field yang diubah" });
    sets.push(`updated_at = NOW()`);
    sets.push(`updated_by = '${req.user?.email ?? "system"}'`);

    const result = await db.execute(sql.raw(
      `UPDATE company_bank_accounts SET ${sets.join(",")} WHERE id = ${id} AND company_id = ${companyId} RETURNING *`
    ));
    if (!result.rows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] PATCH accounts error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════════════════════════════════════════

router.get("/categories", async (req: any, res: any) => {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM cash_bank_categories
      WHERE (company_id IS NULL OR company_id = ${getCompanyId(req) ?? 0})
        AND is_active = TRUE
      ORDER BY sort_order, name
    `);
    res.json({ data: rows.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/categories", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    const { name, description, color } = req.body;
    if (!name) return res.status(400).json({ error: "name wajib" });
    const result = await db.execute(sql`
      INSERT INTO cash_bank_categories (company_id, name, description, color, created_by, created_at, updated_at)
      VALUES (${companyId}, ${name}, ${description ?? null}, ${color ?? "#6B7280"}, ${req.user?.email ?? null}, NOW(), NOW())
      RETURNING *
    `);
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// MUTATIONS (riwayat transaksi per rekening)
// ════════════════════════════════════════════════════════════════════════════

router.get("/mutations", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const { account_id, from, to, page = "1", limit = "50" } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let filter = `ae.company_id = ${companyId} AND ae.status = 'posted'`;
    if (account_id) filter += ` AND cba.id = ${Number(account_id)}`;
    if (from) filter += ` AND ae.date >= '${from}'`;
    if (to) filter += ` AND ae.date <= '${to}'`;

    const rows = await db.execute(sql.raw(`
      SELECT
        ae.id AS entry_id, ae.entry_number, ae.date, ae.description AS entry_desc,
        ae.source, ae.source_id, ae.ref,
        ael.id AS line_id, ael.debit, ael.credit, ael.description AS line_desc,
        ael.account_id, coa.code AS coa_code, coa.name AS coa_name,
        cba.id AS bank_account_id, cba.name AS bank_account_name,
        cba.bank_name, cba.account_number, cba.account_type
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      JOIN company_bank_accounts cba ON cba.coa_id = ael.account_id AND cba.company_id = ${companyId}
      WHERE ${filter}
      ORDER BY ae.date DESC, ae.id DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `));

    const countQ = await db.execute(sql.raw(`
      SELECT COUNT(*) AS total
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      JOIN company_bank_accounts cba ON cba.coa_id = ael.account_id AND cba.company_id = ${companyId}
      WHERE ${filter}
    `));

    // Running balance per akun
    const mutationsWithBalance: any[] = [];
    let runningBalance = 0;
    for (const row of (rows.rows as any[]).reverse()) {
      runningBalance += parseFloat(row.debit || "0") - parseFloat(row.credit || "0");
      mutationsWithBalance.unshift({ ...row, running_balance: runningBalance });
    }

    res.json({
      data: mutationsWithBalance,
      total: parseInt((countQ.rows[0] as any)?.total || "0"),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] GET mutations error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TRANSFERS
// ════════════════════════════════════════════════════════════════════════════

router.get("/transfers", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const { from, to, status, page = "1", limit = "50" } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let filter = `ft.company_id = ${companyId}`;
    if (from) filter += ` AND ft.date >= '${from}'`;
    if (to) filter += ` AND ft.date <= '${to}'`;
    if (status) filter += ` AND ft.status = '${status}'`;

    const rows = await db.execute(sql.raw(`
      SELECT
        ft.*,
        fa.name AS from_account_name, fa.bank_name AS from_bank, fa.account_number AS from_number,
        ta.name AS to_account_name,   ta.bank_name AS to_bank,   ta.account_number AS to_number
      FROM fund_transfers ft
      LEFT JOIN company_bank_accounts fa ON fa.id = ft.from_account_id
      LEFT JOIN company_bank_accounts ta ON ta.id = ft.to_account_id
      WHERE ${filter}
      ORDER BY ft.date DESC, ft.id DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `));

    const countQ = await db.execute(sql.raw(
      `SELECT COUNT(*) AS total FROM fund_transfers ft WHERE ${filter}`
    ));

    res.json({
      data: rows.rows,
      total: parseInt((countQ.rows[0] as any)?.total || "0"),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] GET transfers error");
    res.status(500).json({ error: err.message });
  }
});

router.post("/transfers", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const { from_account_id, to_account_id, amount, date, description, notes } = req.body;
    if (!from_account_id || !to_account_id || !amount || !date) {
      return res.status(400).json({ error: "from_account_id, to_account_id, amount, date wajib" });
    }
    if (Number(from_account_id) === Number(to_account_id)) {
      return res.status(400).json({ error: "Rekening asal dan tujuan tidak boleh sama" });
    }

    const transferNumber = genNo("TRF");
    const result = await db.execute(sql`
      INSERT INTO fund_transfers (
        company_id, transfer_number, from_account_id, to_account_id,
        amount, date, description, notes, status, created_by_id, created_at, updated_at
      ) VALUES (
        ${companyId}, ${transferNumber}, ${Number(from_account_id)}, ${Number(to_account_id)},
        ${Number(amount)}, ${date}::date, ${description ?? null}, ${notes ?? null},
        'DRAFT', ${req.user?.email ?? null}, NOW(), NOW()
      ) RETURNING *
    `);
    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] POST transfers error");
    res.status(500).json({ error: err.message });
  }
});

router.patch("/transfers/:id/approve", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = getCompanyId(req);
    const result = await db.execute(sql`
      UPDATE fund_transfers
      SET status = 'APPROVED', approved_by = ${req.user?.email ?? "system"}, approved_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId} AND status = 'DRAFT'
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Transfer tidak ditemukan atau status tidak valid" });
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/transfers/:id/complete", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = getCompanyId(req);

    // Ambil transfer data
    const trQ = await db.execute(sql`
      SELECT ft.*, fa.coa_id AS from_coa, ta.coa_id AS to_coa
      FROM fund_transfers ft
      LEFT JOIN company_bank_accounts fa ON fa.id = ft.from_account_id
      LEFT JOIN company_bank_accounts ta ON ta.id = ft.to_account_id
      WHERE ft.id = ${id} AND ft.company_id = ${companyId} AND ft.status IN ('DRAFT','APPROVED')
    `);
    if (!trQ.rows.length) return res.status(404).json({ error: "Transfer tidak ditemukan atau status tidak valid" });
    const tr = trQ.rows[0] as any;

    if (!tr.from_coa || !tr.to_coa) {
      return res.status(400).json({ error: "Rekening asal/tujuan belum terhubung ke COA. Lengkapi mapping COA terlebih dahulu." });
    }

    // Posting jurnal: Debit to_account COA, Credit from_account COA
    const entryResult = await postToAccountingHub({
      ctx: { companyId: companyId ?? 0, sourceModule: "fund_transfer", sourceId: Number(tr.id), sourceRef: `TRANSFER-${tr.transfer_number}` },
      date: tr.date,
      ref: tr.transfer_number,
      description: tr.description ?? `Transfer ${tr.transfer_number}`,
      entrySource: "fund_transfer",
      lines: [
        { accountId: Number(tr.to_coa),   debit: String(tr.amount), credit: "0", description: `Transfer masuk dari ${tr.transfer_number}` },
        { accountId: Number(tr.from_coa), debit: "0", credit: String(tr.amount), description: `Transfer keluar ${tr.transfer_number}` },
      ],
    });

    const entryId = entryResult?.entryId ?? null;

    const result = await db.execute(sql`
      UPDATE fund_transfers
      SET status = 'COMPLETED', completed_at = NOW(), entry_id = ${entryId}, updated_at = NOW(), updated_by = ${req.user?.email ?? "system"}
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING *
    `);
    res.json({ data: result.rows[0], journal_entry_id: entryId });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] PATCH complete transfer error");
    res.status(500).json({ error: err.message });
  }
});

router.patch("/transfers/:id/cancel", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = getCompanyId(req);
    const { reason } = req.body;
    const result = await db.execute(sql`
      UPDATE fund_transfers
      SET status = 'CANCELLED', cancelled_at = NOW(), void_reason = ${reason ?? null},
          updated_at = NOW(), updated_by = ${req.user?.email ?? "system"}
      WHERE id = ${id} AND company_id = ${companyId} AND status IN ('DRAFT','APPROVED')
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Transfer tidak ditemukan atau status tidak valid" });
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/transfers/:id/void", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = getCompanyId(req);
    const { reason } = req.body;
    const result = await db.execute(sql`
      UPDATE fund_transfers
      SET status = 'VOID', voided_at = NOW(), void_reason = ${reason ?? null},
          updated_at = NOW(), updated_by = ${req.user?.email ?? "system"}
      WHERE id = ${id} AND company_id = ${companyId} AND status = 'COMPLETED'
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Transfer tidak ditemukan atau sudah di-void" });
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PETTY CASH
// ════════════════════════════════════════════════════════════════════════════

router.get("/petty-cash", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const { account_id, from, to, type, status, page = "1", limit = "50" } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let filter = `pct.company_id = ${companyId}`;
    if (account_id) filter += ` AND pct.account_id = ${Number(account_id)}`;
    if (from) filter += ` AND pct.date >= '${from}'`;
    if (to) filter += ` AND pct.date <= '${to}'`;
    if (type) filter += ` AND pct.transaction_type = '${type}'`;
    if (status) filter += ` AND pct.status = '${status}'`;

    const rows = await db.execute(sql.raw(`
      SELECT pct.*, cba.name AS account_name, cba.bank_name
      FROM petty_cash_transactions pct
      LEFT JOIN company_bank_accounts cba ON cba.id = pct.account_id
      WHERE ${filter}
      ORDER BY pct.date DESC, pct.id DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `));

    const countQ = await db.execute(sql.raw(
      `SELECT COUNT(*) AS total FROM petty_cash_transactions pct WHERE ${filter}`
    ));

    // Summary: saldo per tipe
    const summaryQ = await db.execute(sql.raw(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type IN ('CASH_IN','REIMBURSEMENT') THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN transaction_type IN ('CASH_OUT','EXPENSE','ADVANCE') THEN amount ELSE 0 END), 0) AS total_out
      FROM petty_cash_transactions
      WHERE company_id = ${companyId} AND status = 'COMPLETED'
    `));
    const sum = summaryQ.rows[0] as any;

    res.json({
      data: rows.rows,
      total: parseInt((countQ.rows[0] as any)?.total || "0"),
      summary: {
        total_in: parseFloat(sum?.total_in || "0"),
        total_out: parseFloat(sum?.total_out || "0"),
        balance: parseFloat(sum?.total_in || "0") - parseFloat(sum?.total_out || "0"),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] GET petty-cash error");
    res.status(500).json({ error: err.message });
  }
});

router.post("/petty-cash", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const { account_id, transaction_type, date, amount, description, category, recipient, receipt_no, notes } = req.body;
    if (!transaction_type || !date || !amount) {
      return res.status(400).json({ error: "transaction_type, date, amount wajib" });
    }

    const validTypes = ["CASH_IN","CASH_OUT","REIMBURSEMENT","SETTLEMENT","ADVANCE","EXPENSE"];
    if (!validTypes.includes(transaction_type)) {
      return res.status(400).json({ error: `transaction_type harus salah satu: ${validTypes.join(", ")}` });
    }

    const txNo = genNo("PC");
    const result = await db.execute(sql`
      INSERT INTO petty_cash_transactions (
        company_id, account_id, transaction_no, transaction_type, date,
        amount, description, category, recipient, receipt_no, notes,
        status, created_by, created_at, updated_at
      ) VALUES (
        ${companyId}, ${account_id ? Number(account_id) : null}, ${txNo},
        ${transaction_type}, ${date}::date, ${Number(amount)},
        ${description ?? null}, ${category ?? null}, ${recipient ?? null},
        ${receipt_no ?? null}, ${notes ?? null},
        'DRAFT', ${req.user?.email ?? null}, NOW(), NOW()
      ) RETURNING *
    `);
    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] POST petty-cash error");
    res.status(500).json({ error: err.message });
  }
});

router.patch("/petty-cash/:id/approve", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = getCompanyId(req);
    const result = await db.execute(sql`
      UPDATE petty_cash_transactions
      SET status = 'APPROVED', approved_by = ${req.user?.email ?? "system"}, approved_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId} AND status = 'DRAFT'
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/petty-cash/:id/complete", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = getCompanyId(req);

    const txQ = await db.execute(sql`
      SELECT pct.*, cba.coa_id
      FROM petty_cash_transactions pct
      LEFT JOIN company_bank_accounts cba ON cba.id = pct.account_id
      WHERE pct.id = ${id} AND pct.company_id = ${companyId} AND pct.status IN ('DRAFT','APPROVED')
    `);
    if (!txQ.rows.length) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
    const tx = txQ.rows[0] as any;

    let entryId: number | null = null;

    if (tx.coa_id) {
      // Tentukan debit/credit berdasarkan tipe transaksi
      const isCashIn = ["CASH_IN","REIMBURSEMENT"].includes(tx.transaction_type);
      const lines = isCashIn
        ? [
            { accountId: Number(tx.coa_id), debit: String(tx.amount), credit: "0", description: tx.description ?? tx.transaction_type },
            { accountId: Number(tx.coa_id), debit: "0", credit: String(tx.amount), description: "Contra entry" },
          ]
        : [
            { accountId: Number(tx.coa_id), debit: "0", credit: String(tx.amount), description: tx.description ?? tx.transaction_type },
            { accountId: Number(tx.coa_id), debit: String(tx.amount), credit: "0", description: "Contra entry" },
          ];

      // Untuk petty cash yang terhubung ke COA — gunakan akun kas kecil dan expense
      // Simplified: hanya posting jika ada COA yang valid
      const ent = await postToAccountingHub({
        ctx: { companyId: companyId ?? 0, sourceModule: "petty_cash", sourceId: id, sourceRef: `PC-${id}` },
        date: tx.date,
        ref: tx.transaction_no,
        description: tx.description ?? `Petty Cash ${tx.transaction_type} ${tx.transaction_no}`,
        entrySource: "petty_cash",
        lines: [
          { accountId: Number(tx.coa_id), debit: isCashIn ? String(tx.amount) : "0", credit: isCashIn ? "0" : String(tx.amount), description: tx.description ?? tx.transaction_type },
          { accountId: Number(tx.coa_id), debit: isCashIn ? "0" : String(tx.amount), credit: isCashIn ? String(tx.amount) : "0", description: "Contra - Expense/Income" },
        ],
      }).catch(() => null);
      entryId = ent?.entryId ?? null;
    }

    const result = await db.execute(sql`
      UPDATE petty_cash_transactions
      SET status = 'COMPLETED', settled_at = NOW(), settled_by = ${req.user?.email ?? "system"},
          entry_id = ${entryId}, updated_at = NOW(), updated_by = ${req.user?.email ?? "system"}
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING *
    `);
    res.json({ data: result.rows[0], journal_entry_id: entryId });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] PATCH petty-cash complete error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// IMPORTS (alias ke bank_mutation_import_batches)
// ════════════════════════════════════════════════════════════════════════════

router.get("/imports", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const { page = "1", limit = "30" } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const rows = await db.execute(sql.raw(`
      SELECT b.*, COUNT(r.id) AS row_count_actual
      FROM bank_mutation_import_batches b
      LEFT JOIN bank_mutation_import_rows r ON r.batch_id = b.id
      WHERE b.company_id = ${companyId}
      GROUP BY b.id
      ORDER BY b.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `)).catch(() => ({ rows: [] }));

    res.json({ data: rows.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /import — buat batch import baru, delegate ke tabel existing
router.post("/import", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const userId = req.user?.id ?? null;
    const { filename, rows, column_mapping, notes, bank_account_id, import_mode = "MANUAL_IMPORT" } = req.body as any;

    if (!filename) return res.status(400).json({ error: "filename required" });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "rows required" });

    // Buat batch
    const batchQ = await db.execute(sql`
      INSERT INTO bank_mutation_import_batches
        (company_id, filename, status, column_mapping, row_count, created_by, notes, import_mode, created_at, updated_at)
      VALUES
        (${companyId}, ${filename}, 'DRAFT_IMPORT', ${JSON.stringify(column_mapping ?? {})},
         ${rows.length}, ${userId}, ${notes ?? null}, ${import_mode}, NOW(), NOW())
      RETURNING id
    `);
    const batchId = (batchQ.rows[0] as any).id;

    // Insert rows
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await db.execute(sql`
        INSERT INTO bank_mutation_import_rows
          (batch_id, row_index, date, description, debit, credit, balance, raw, status, created_at)
        VALUES
          (${batchId}, ${i}, ${r.date ?? null}, ${r.description ?? null},
           ${r.debit ?? 0}, ${r.credit ?? 0}, ${r.balance ?? null},
           ${JSON.stringify(r)}, 'DRAFT', NOW())
      `).catch(() => {});
    }

    logger.info({ batchId, rowCount: rows.length, companyId }, "[cashBank] Import batch created");
    res.json({ success: true, batchId, rowCount: rows.length });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] POST /import error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RECONCILIATION (alias ke bank_mutations)
// ════════════════════════════════════════════════════════════════════════════

router.get("/reconciliation", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const { status, from, to, page = "1", limit = "50" } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let filter = `bm.company_id = ${companyId}`;
    if (status) filter += ` AND bm.status = '${status}'`;
    if (from) filter += ` AND bm.transaction_date >= '${from}'`;
    if (to) filter += ` AND bm.transaction_date <= '${to}'`;

    const rows = await db.execute(sql.raw(`
      SELECT bm.*, mba.account_name, mba.bank_name AS master_bank_name
      FROM bank_mutations bm
      LEFT JOIN master_bank_accounts mba ON mba.id = bm.bank_account_id
      WHERE ${filter}
      ORDER BY bm.transaction_date DESC, bm.id DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `)).catch(() => ({ rows: [] }));

    const countQ = await db.execute(sql.raw(
      `SELECT COUNT(*) AS total FROM bank_mutations bm WHERE ${filter}`
    )).catch(() => ({ rows: [{ total: 0 }] }));

    // Summary stats
    const statsQ = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'matched') AS matched_count,
        COUNT(*) FILTER (WHERE status IN ('unmatched','pending')) AS unmatched_count,
        COUNT(*) AS total_count
      FROM bank_mutations WHERE company_id = ${companyId}
    `)).catch(() => ({ rows: [{ matched_count: 0, unmatched_count: 0, total_count: 0 }] }));

    res.json({
      data: rows.rows,
      total: parseInt((countQ.rows[0] as any)?.total || "0"),
      stats: statsQ.rows[0],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reconciliation/match — manual match mutation ke transaksi
router.post("/reconciliation/match", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const userId = req.user?.id ?? "system";
    const { mutation_id, candidate_type, candidate_id, notes } = req.body as any;

    if (!mutation_id || !candidate_type || !candidate_id) {
      return res.status(400).json({ error: "mutation_id, candidate_type, dan candidate_id wajib diisi" });
    }

    // Verifikasi mutation milik company ini
    const mutQ = await db.execute(sql`
      SELECT id, status FROM bank_mutations WHERE id = ${mutation_id} AND company_id = ${companyId}
    `);
    if (!mutQ.rows.length) return res.status(404).json({ error: "Mutasi tidak ditemukan" });
    const mut = mutQ.rows[0] as any;
    if (mut.status === "matched") return res.status(409).json({ error: "Mutasi sudah dicocokkan" });

    // Upsert ke bank_reconciliation_matches
    await db.execute(sql`
      INSERT INTO bank_reconciliation_matches
        (mutation_id, candidate_type, candidate_id, match_score, match_reason, status, created_at)
      VALUES
        (${mutation_id}, ${candidate_type}, ${candidate_id}, 100, ${notes ?? 'Manual match'}, 'approved', NOW())
      ON CONFLICT (mutation_id) DO UPDATE
        SET candidate_type = EXCLUDED.candidate_type,
            candidate_id   = EXCLUDED.candidate_id,
            match_score    = 100,
            match_reason   = EXCLUDED.match_reason,
            status         = 'approved'
    `).catch(async () => {
      await db.execute(sql`
        INSERT INTO bank_reconciliation_matches
          (mutation_id, candidate_type, candidate_id, match_score, match_reason, status, created_at)
        VALUES
          (${mutation_id}, ${candidate_type}, ${candidate_id}, 100, ${notes ?? 'Manual match'}, 'approved', NOW())
      `);
    });

    // Update status mutasi ke matched
    await db.execute(sql`
      UPDATE bank_mutations
      SET status = 'matched',
          linked_transaction_type = ${candidate_type},
          linked_transaction_id   = ${candidate_id},
          reconciliation_status   = 'matched',
          updated_at = NOW()
      WHERE id = ${mutation_id}
    `);

    logger.info({ mutation_id, candidate_type, candidate_id, companyId, userId }, "[cashBank] Manual reconciliation match");
    res.json({ success: true, mutation_id, candidate_type, candidate_id });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] POST /reconciliation/match error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FORECAST
// ════════════════════════════════════════════════════════════════════════════

router.get("/forecast", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const { horizon = "30" } = req.query as any;

    // Ambil snapshot terbaru
    const latestQ = await db.execute(sql`
      SELECT * FROM cash_flow_forecasts
      WHERE company_id = ${companyId} AND horizon_days = ${parseInt(horizon)}
      ORDER BY generated_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));

    if (latestQ.rows.length) {
      return res.json({ data: latestQ.rows[0], source: "snapshot" });
    }

    res.json({ data: null, source: "none", message: "Belum ada snapshot forecast. Gunakan POST /forecast/generate untuk generate." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/forecast/generate", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const { horizon_days = 30 } = req.body;

    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + horizon_days * 86400000).toISOString().slice(0, 10);

    // Current balance dari semua rekening
    const balQ = await db.execute(sql`
      SELECT COALESCE(SUM(
        COALESCE((
          SELECT SUM(ael.debit) - SUM(ael.credit)
          FROM accounting_entry_lines ael
          JOIN accounting_entries ae ON ae.id = ael.entry_id
          WHERE ael.account_id = cba.coa_id AND ae.status = 'posted'
        ), 0)
      ), 0) AS total_balance
      FROM company_bank_accounts cba
      WHERE cba.company_id = ${companyId} AND cba.is_active = TRUE
    `);
    const openingBalance = parseFloat((balQ.rows[0] as any)?.total_balance || "0");

    // Expected inflow: AR outstanding
    const arQ = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(ae.total_credit - ae.total_debit), 0) AS ar_total
      FROM accounting_entries ae
      WHERE ae.company_id = ${companyId} AND ae.status = 'posted'
        AND ae.source IN ('invoice','sales_order')
        AND ae.date::date <= '${endDate}'::date
    `)).catch(() => ({ rows: [{ ar_total: 0 }] }));

    // Expected outflow: AP outstanding
    const apQ = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(ae.total_debit - ae.total_credit), 0) AS ap_total
      FROM accounting_entries ae
      WHERE ae.company_id = ${companyId} AND ae.status = 'posted'
        AND ae.source IN ('purchase_order','vendor_invoice')
        AND ae.date::date <= '${endDate}'::date
    `)).catch(() => ({ rows: [{ ap_total: 0 }] }));

    const expectedInflow = parseFloat((arQ.rows[0] as any)?.ar_total || "0");
    const expectedOutflow = parseFloat((apQ.rows[0] as any)?.ap_total || "0");
    const netCashFlow = expectedInflow - expectedOutflow;
    const closingBalance = openingBalance + netCashFlow;

    const sourceBreakdown = {
      ar: expectedInflow,
      ap: expectedOutflow,
      net: netCashFlow,
    };

    const result = await db.execute(sql`
      INSERT INTO cash_flow_forecasts (
        company_id, forecast_date, horizon_days,
        opening_balance, expected_inflow, expected_outflow, net_cash_flow, closing_balance,
        source_breakdown, status, created_by, created_at, updated_at
      ) VALUES (
        ${companyId}, ${today}::date, ${parseInt(String(horizon_days))},
        ${openingBalance}, ${expectedInflow}, ${expectedOutflow}, ${netCashFlow}, ${closingBalance},
        ${JSON.stringify(sourceBreakdown)}::jsonb, 'published',
        ${req.user?.email ?? "system"}, NOW(), NOW()
      ) RETURNING *
    `);

    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] POST forecast/generate error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// BALANCE HISTORY (snapshot harian)
// ════════════════════════════════════════════════════════════════════════════

router.get("/history", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const { account_id, from, to } = req.query as any;

    let filter = `company_id = ${companyId}`;
    if (account_id) filter += ` AND account_id = ${Number(account_id)}`;
    if (from) filter += ` AND snapshot_date >= '${from}'`;
    if (to) filter += ` AND snapshot_date <= '${to}'`;

    const rows = await db.execute(sql.raw(`
      SELECT h.*, cba.name AS account_name, cba.bank_name
      FROM cash_bank_balance_history h
      LEFT JOIN company_bank_accounts cba ON cba.id = h.account_id
      WHERE ${filter}
      ORDER BY h.snapshot_date DESC, h.account_id
    `));
    res.json({ data: rows.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/history/snapshot", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const snapshotDate = (req.body.date ?? new Date().toISOString().slice(0, 10)) as string;

    // Ambil semua rekening aktif
    const accountsQ = await db.execute(sql`
      SELECT cba.id, cba.coa_id, cba.name, cba.opening_balance
      FROM company_bank_accounts cba
      WHERE cba.company_id = ${companyId} AND cba.is_active = TRUE AND cba.coa_id IS NOT NULL
    `);

    const results = [];
    for (const acc of accountsQ.rows as any[]) {
      // Saldo penutup = opening + semua transaksi s/d tanggal
      const balQ = await db.execute(sql.raw(`
        SELECT
          COALESCE(SUM(ael.debit), 0) AS total_debit,
          COALESCE(SUM(ael.credit), 0) AS total_credit,
          COUNT(DISTINCT ae.id) AS tx_count
        FROM accounting_entry_lines ael
        JOIN accounting_entries ae ON ae.id = ael.entry_id
        WHERE ael.account_id = ${acc.coa_id}
          AND ae.status = 'posted'
          AND ae.date::date = '${snapshotDate}'::date
      `));
      const b = balQ.rows[0] as any;
      const cashIn = parseFloat(b?.total_debit || "0");
      const cashOut = parseFloat(b?.total_credit || "0");

      // Saldo penutup kumulatif
      const cumQ = await db.execute(sql.raw(`
        SELECT COALESCE(SUM(ael.debit) - SUM(ael.credit), 0) AS cum_balance
        FROM accounting_entry_lines ael
        JOIN accounting_entries ae ON ae.id = ael.entry_id
        WHERE ael.account_id = ${acc.coa_id}
          AND ae.status = 'posted'
          AND ae.date::date <= '${snapshotDate}'::date
      `));
      const closingBalance = parseFloat(acc.opening_balance || "0") + parseFloat((cumQ.rows[0] as any)?.cum_balance || "0");
      const openingBalance = closingBalance - cashIn + cashOut;

      await db.execute(sql.raw(`
        INSERT INTO cash_bank_balance_history
          (company_id, account_id, snapshot_date, opening_balance, closing_balance, total_cash_in, total_cash_out, transaction_count, created_at, updated_at)
        VALUES
          (${companyId}, ${acc.id}, '${snapshotDate}', ${openingBalance}, ${closingBalance}, ${cashIn}, ${cashOut}, ${parseInt(b?.tx_count || "0")}, NOW(), NOW())
        ON CONFLICT (account_id, snapshot_date)
        DO UPDATE SET opening_balance = EXCLUDED.opening_balance, closing_balance = EXCLUDED.closing_balance,
          total_cash_in = EXCLUDED.total_cash_in, total_cash_out = EXCLUDED.total_cash_out,
          transaction_count = EXCLUDED.transaction_count, updated_at = NOW()
      `));
      results.push({ account_id: acc.id, name: acc.name, closing_balance: closingBalance });
    }

    res.json({ data: results, snapshot_date: snapshotDate });
  } catch (err: any) {
    logger.error({ err }, "[cashBank] POST history/snapshot error");
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════

router.get("/settings", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const [accountsQ, categoriesQ] = await Promise.all([
      db.execute(sql`
        SELECT cba.*, coa.code AS coa_code, coa.name AS coa_name,
               cat.name AS category_name
        FROM company_bank_accounts cba
        LEFT JOIN chart_of_accounts coa ON coa.id = cba.coa_id
        LEFT JOIN cash_bank_categories cat ON cat.id = cba.category_id
        WHERE cba.company_id = ${companyId}
        ORDER BY cba.account_type, cba.name
      `),
      db.execute(sql`
        SELECT * FROM cash_bank_categories
        WHERE company_id IS NULL OR company_id = ${companyId}
        ORDER BY sort_order, name
      `),
    ]);

    res.json({
      accounts: accountsQ.rows,
      categories: categoriesQ.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// COA cash_bank untuk dropdown
router.get("/coa-options", async (req: any, res: any) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db.execute(sql`
      SELECT id, code, name, type, subtype
      FROM chart_of_accounts
      WHERE (company_id = ${companyId ?? 1} OR company_id IS NULL)
        AND subtype IN ('cash_bank','cash','bank')
        AND is_active = TRUE
      ORDER BY code
    `);
    res.json({ data: rows.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════

router.get("/health", async (req: any, res: any) => {
  const companyId = getCompanyId(req);
  const checks: Record<string, { ok: boolean; count?: number; error?: string }> = {};
  const start = Date.now();

  await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS n FROM company_bank_accounts WHERE company_id = ${companyId ?? 0}`)
      .then(r => { checks.accounts = { ok: true, count: Number((r.rows[0] as any)?.n ?? 0) }; })
      .catch(e => { checks.accounts = { ok: false, error: e.message }; }),

    db.execute(sql`SELECT COUNT(*) AS n FROM bank_mutations WHERE company_id = ${companyId ?? 0}`)
      .then(r => { checks.mutations = { ok: true, count: Number((r.rows[0] as any)?.n ?? 0) }; })
      .catch(e => { checks.mutations = { ok: false, error: e.message }; }),

    db.execute(sql`SELECT COUNT(*) AS n FROM bank_mutations WHERE company_id = ${companyId ?? 0} AND reconciliation_status = 'unmatched'`)
      .then(r => { checks.unmatched = { ok: true, count: Number((r.rows[0] as any)?.n ?? 0) }; })
      .catch(e => { checks.unmatched = { ok: false, error: e.message }; }),

    db.execute(sql`SELECT COUNT(*) AS n FROM petty_cash_transactions WHERE company_id = ${companyId ?? 0} AND status = 'draft'`)
      .then(r => { checks.petty_cash_pending = { ok: true, count: Number((r.rows[0] as any)?.n ?? 0) }; })
      .catch(e => { checks.petty_cash_pending = { ok: false, error: e.message }; }),

    db.execute(sql`SELECT COUNT(*) AS n FROM cash_flow_forecasts WHERE company_id = ${companyId ?? 0}`)
      .then(r => { checks.forecasts = { ok: true, count: Number((r.rows[0] as any)?.n ?? 0) }; })
      .catch(e => { checks.forecasts = { ok: false, error: e.message }; }),

    db.execute(sql`SELECT COUNT(*) AS n FROM cash_bank_balance_history WHERE company_id = ${companyId ?? 0}`)
      .then(r => { checks.balance_history = { ok: true, count: Number((r.rows[0] as any)?.n ?? 0) }; })
      .catch(e => { checks.balance_history = { ok: false, error: e.message }; }),
  ]);

  const allOk = Object.values(checks).every(c => c.ok);
  const latencyMs = Date.now() - start;

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    latency_ms: latencyMs,
    company_id: companyId,
    checks,
    ts: new Date().toISOString(),
  });
});

export { router as cashBankRouter };
