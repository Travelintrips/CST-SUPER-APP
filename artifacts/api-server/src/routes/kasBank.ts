import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { postToAccountingHub } from "../lib/accountingPostingService.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();

function generateTransferNumber(): string {
  const now = new Date();
  const yy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900000) + 100000);
  return `TRF/${yy}/${mm}/${rand}`;
}

// ── GET /accounting/kas-bank/accounts ─────────────────────────────────────────
router.get("/accounts", async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId ?? req.query.companyId;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const rows = await db.execute(sql`
      SELECT
        cba.*,
        coa.code  AS coa_code,
        coa.name  AS coa_name,
        coa.type  AS coa_type,
        COALESCE(
          (SELECT SUM(ael.debit) - SUM(ael.credit)
           FROM accounting_entry_lines ael
           JOIN accounting_entries ae ON ae.id = ael.entry_id
           WHERE ael.account_id = cba.coa_id
             AND ae.status = 'posted'),
          0
        ) AS balance
      FROM company_bank_accounts cba
      LEFT JOIN chart_of_accounts coa ON coa.id = cba.coa_id
      WHERE cba.company_id = ${Number(companyId)}
      ORDER BY cba.account_type, cba.name
    `);

    res.json({ data: rows.rows });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] GET accounts error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /accounting/kas-bank/accounts ────────────────────────────────────────
router.post("/accounts", async (req: any, res: any) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name, account_type, bank_name, account_number, currency, coa_id, notes } = req.body;

    if (!companyId || !name || !account_type) {
      return res.status(400).json({ error: "companyId, name, account_type wajib diisi" });
    }

    const result = await db.execute(sql`
      INSERT INTO company_bank_accounts
        (company_id, name, account_type, bank_name, account_number, currency, coa_id, notes, created_by_id)
      VALUES
        (${Number(companyId)}, ${name}, ${account_type}, ${bank_name ?? null},
         ${account_number ?? null}, ${currency ?? "IDR"}, ${coa_id ? Number(coa_id) : null},
         ${notes ?? null}, ${req.user?.id ?? null})
      RETURNING *
    `);

    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] POST accounts error");
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /accounting/kas-bank/accounts/:id ─────────────────────────────────────
router.put("/accounts/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name, account_type, bank_name, account_number, currency, coa_id, notes, is_active } = req.body;

    const result = await db.execute(sql`
      UPDATE company_bank_accounts SET
        name           = COALESCE(${name ?? null}, name),
        account_type   = COALESCE(${account_type ?? null}, account_type),
        bank_name      = ${bank_name ?? null},
        account_number = ${account_number ?? null},
        currency       = COALESCE(${currency ?? null}, currency),
        coa_id         = ${coa_id ? Number(coa_id) : null},
        notes          = ${notes ?? null},
        is_active      = COALESCE(${is_active != null ? Boolean(is_active) : null}, is_active),
        updated_at     = NOW()
      WHERE id = ${Number(id)}
      RETURNING *
    `);

    if (!result.rows[0]) return res.status(404).json({ error: "Rekening tidak ditemukan" });
    res.json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] PUT accounts error");
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /accounting/kas-bank/accounts/:id ──────────────────────────────────
router.delete("/accounts/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    await db.execute(sql`
      UPDATE company_bank_accounts SET is_active = FALSE, updated_at = NOW()
      WHERE id = ${Number(id)}
    `);
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] DELETE accounts error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /accounting/kas-bank/summary ──────────────────────────────────────────
router.get("/summary", async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId ?? req.query.companyId;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const rows = await db.execute(sql`
      SELECT
        cba.account_type,
        COUNT(cba.id)::int AS jumlah_rekening,
        COALESCE(SUM(
          (SELECT SUM(ael.debit) - SUM(ael.credit)
           FROM accounting_entry_lines ael
           JOIN accounting_entries ae ON ae.id = ael.entry_id
           WHERE ael.account_id = cba.coa_id
             AND ae.status = 'posted')
        ), 0) AS total_saldo
      FROM company_bank_accounts cba
      WHERE cba.company_id = ${Number(companyId)} AND cba.is_active = TRUE
      GROUP BY cba.account_type
    `);

    res.json({ data: rows.rows });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] GET summary error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /accounting/kas-bank/mutations ────────────────────────────────────────
router.get("/mutations", async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId ?? req.query.companyId;
    const { accountId, startDate, endDate, limit = "50", offset = "0" } = req.query;

    if (!companyId || !accountId) {
      return res.status(400).json({ error: "companyId dan accountId required" });
    }

    const rows = await db.execute(sql`
      SELECT
        ae.date,
        ae.entry_number,
        ae.ref,
        ae.description,
        ae.source,
        ae.source_module,
        ael.debit,
        ael.credit,
        ael.description AS line_description,
        SUM(ael.debit - ael.credit) OVER (
          ORDER BY ae.date, ae.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS saldo_berjalan
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN company_bank_accounts cba ON cba.coa_id = ael.account_id
      WHERE cba.id = ${Number(accountId)}
        AND ae.status = 'posted'
        AND (${startDate ? sql`ae.date >= ${startDate}::date` : sql`TRUE`})
        AND (${endDate ? sql`ae.date <= ${endDate}::date` : sql`TRUE`})
      ORDER BY ae.date DESC, ae.id DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `);

    res.json({ data: rows.rows });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] GET mutations error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /accounting/kas-bank/transfers ────────────────────────────────────────
router.get("/transfers", async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId ?? req.query.companyId;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const rows = await db.execute(sql`
      SELECT
        ft.*,
        fa.name  AS from_account_name,
        fa.bank_name AS from_bank_name,
        ta.name  AS to_account_name,
        ta.bank_name AS to_bank_name
      FROM fund_transfers ft
      JOIN company_bank_accounts fa ON fa.id = ft.from_account_id
      JOIN company_bank_accounts ta ON ta.id = ft.to_account_id
      WHERE ft.company_id = ${Number(companyId)}
      ORDER BY ft.date DESC, ft.id DESC
      LIMIT 100
    `);

    res.json({ data: rows.rows });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] GET transfers error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /accounting/kas-bank/transfers ───────────────────────────────────────
router.post("/transfers", async (req: any, res: any) => {
  try {
    const companyId = resolveCompanyId(req);
    const { from_account_id, to_account_id, amount, date, description } = req.body;

    if (!companyId || !from_account_id || !to_account_id || !amount || !date) {
      return res.status(400).json({ error: "from_account_id, to_account_id, amount, date wajib diisi" });
    }

    if (Number(from_account_id) === Number(to_account_id)) {
      return res.status(400).json({ error: "Rekening asal dan tujuan tidak boleh sama" });
    }

    // Ambil COA dari kedua rekening
    const accounts = await db.execute(sql`
      SELECT id, name, coa_id FROM company_bank_accounts
      WHERE id IN (${Number(from_account_id)}, ${Number(to_account_id)})
        AND company_id = ${Number(companyId)}
    `);

    const fromAcc = accounts.rows.find((r: any) => r.id === Number(from_account_id));
    const toAcc = accounts.rows.find((r: any) => r.id === Number(to_account_id));

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "Rekening tidak ditemukan" });
    }

    if (!fromAcc.coa_id || !toAcc.coa_id) {
      return res.status(400).json({ error: "Rekening asal/tujuan belum dikaitkan ke akun COA" });
    }

    const transferNumber = generateTransferNumber();
    const amountStr = String(Number(amount).toFixed(2));
    const desc = description ?? `Transfer: ${fromAcc.name} → ${toAcc.name}`;

    // Buat journal entry: debit rekening tujuan, credit rekening asal
    const entry = await postToAccountingHub({
      ctx: {
        companyId: Number(companyId),
        sourceModule: "kas_bank",
        sourceSchema: "public",
        sourceTable: "fund_transfers",
        sourceRef: transferNumber,
      },
      date,
      ref: transferNumber,
      description: desc,
      entrySource: "manual",
      lines: [
        { accountId: Number(toAcc.coa_id),   debit: amountStr, credit: "0",       description: `Transfer masuk — ${toAcc.name}` },
        { accountId: Number(fromAcc.coa_id),  debit: "0",       credit: amountStr, description: `Transfer keluar — ${fromAcc.name}` },
      ],
    });

    const result = await db.execute(sql`
      INSERT INTO fund_transfers
        (company_id, transfer_number, from_account_id, to_account_id, amount, date, description, entry_id, created_by_id)
      VALUES
        (${Number(companyId)}, ${transferNumber}, ${Number(from_account_id)}, ${Number(to_account_id)},
         ${amountStr}, ${date}::date, ${desc}, ${entry?.entryId ?? null}, ${req.user?.id ?? null})
      RETURNING *
    `);

    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] POST transfers error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /accounting/kas-bank/coa-cash-bank ────────────────────────────────────
// Daftar akun COA dengan subtype cash_bank untuk dipilih sebagai rekening
router.get("/coa-cash-bank", async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId ?? req.query.companyId;
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    const rows = await db.execute(sql`
      SELECT id, code, name, type, subtype
      FROM chart_of_accounts
      WHERE company_id = ${Number(companyId)}
        AND is_active = TRUE
        AND (subtype = 'cash_bank' OR type = 'asset')
      ORDER BY code
    `);

    res.json({ data: rows.rows });
  } catch (err: any) {
    logger.error({ err }, "[kasBank] GET coa-cash-bank error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
