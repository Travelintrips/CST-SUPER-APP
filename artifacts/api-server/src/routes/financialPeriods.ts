import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";

const router = Router();

// GET /api/accounting/periods?company_id=X&year=Y
router.get("/", async (req, res) => {
  const companyId = req.query.company_id ? parseInt(String(req.query.company_id), 10) : null;
  const year      = req.query.year       ? parseInt(String(req.query.year),       10) : null;

  let where = "1=1";
  if (companyId) where += ` AND company_id = ${companyId}`;
  if (year)      where += ` AND year = ${year}`;

  try {
    const { rows } = await db.execute(sql.raw(
      `SELECT * FROM financial_periods WHERE ${where} ORDER BY year DESC, month DESC`
    ));
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil data periode keuangan." });
  }
});

// POST /api/accounting/periods — buat periode baru
router.post("/", requireAdmin, async (req, res) => {
  const { company_id, month, year, is_closed = false } = req.body as {
    company_id: number;
    month: number;
    year: number;
    is_closed?: boolean;
  };

  if (!company_id || !month || !year) {
    return res.status(400).json({ error: "company_id, month, year wajib diisi." });
  }
  if (month < 1 || month > 12) {
    return res.status(400).json({ error: "month harus antara 1–12." });
  }

  try {
    const { rows } = await db.execute(sql.raw(`
      INSERT INTO financial_periods (company_id, month, year, is_closed)
      VALUES (${company_id}, ${month}, ${year}, ${is_closed})
      ON CONFLICT (company_id, month, year) DO NOTHING
      RETURNING *
    `));
    if (!rows.length) {
      return res.status(409).json({ error: "Periode sudah ada." });
    }
    return res.status(201).json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Gagal membuat periode keuangan." });
  }
});

// PATCH /api/accounting/periods/:id — tutup/buka periode
router.patch("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

  // IDOR guard — verify period ownership before update
  {
    const { rows: _p } = await db.execute(sql.raw(
      `SELECT company_id FROM financial_periods WHERE id = ${id}`
    ));
    if (!_p.length) return res.status(404).json({ error: "Periode tidak ditemukan." });
    const _cid = resolveCompanyId(req as any);
    if (!await assertCompanyAccess(Number((_p[0] as any).company_id), _cid, req as any, res, {
      resourceType: "financial_period", resourceId: id,
    })) return;
  }

  const actor = (req as any).user?.email ?? "system";
  const { is_closed, override_allowed } = req.body as {
    is_closed?: boolean;
    override_allowed?: boolean;
  };

  const sets: string[] = [];
  if (is_closed !== undefined) {
    sets.push(`is_closed = ${is_closed}`);
    if (is_closed) {
      sets.push(`closed_at = NOW()`);
      sets.push(`closed_by = '${actor.replace(/'/g, "''")}'`);
    } else {
      sets.push(`closed_at = NULL`);
      sets.push(`closed_by = NULL`);
    }
  }
  if (override_allowed !== undefined) {
    sets.push(`override_allowed = ${override_allowed}`);
  }

  if (!sets.length) return res.status(400).json({ error: "Tidak ada field yang diupdate." });

  try {
    const { rows } = await db.execute(sql.raw(
      `UPDATE financial_periods SET ${sets.join(", ")} WHERE id = '${id}' RETURNING *`
    ));
    if (!rows.length) return res.status(404).json({ error: "Periode tidak ditemukan." });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengupdate periode keuangan." });
  }
});

// DELETE /api/accounting/periods/:id — hapus periode (hanya yang belum closed)
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

  try {
    const { rows: check } = await db.execute(sql.raw(
      `SELECT is_closed, company_id FROM financial_periods WHERE id = ${id}`
    ));
    if (!check.length) return res.status(404).json({ error: "Periode tidak ditemukan." });

    // IDOR guard — verify period ownership before delete
    {
      const _cid = resolveCompanyId(req as any);
      if (!await assertCompanyAccess(Number((check[0] as any).company_id), _cid, req as any, res, {
        resourceType: "financial_period", resourceId: id,
      })) return;
    }

    if ((check[0] as any).is_closed) {
      return res.status(400).json({ error: "Periode yang sudah ditutup tidak bisa dihapus." });
    }
    await db.execute(sql.raw(`DELETE FROM financial_periods WHERE id = '${id}'`));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Gagal menghapus periode keuangan." });
  }
});

// GET /api/accounting/periods/audit — riwayat audit_accounting_events
router.get("/audit", async (req, res) => {
  const companyId = req.query.company_id ? parseInt(String(req.query.company_id), 10) : null;
  const action    = req.query.action ? String(req.query.action) : null;
  const limit     = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);

  let where = "1=1";
  if (companyId) where += ` AND company_id = ${companyId}`;
  if (action)    where += ` AND action = '${action.replace(/'/g, "''")}'`;

  try {
    const { rows } = await db.execute(sql.raw(
      `SELECT * FROM audit_accounting_events WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`
    ));
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil audit events." });
  }
});

// GET /api/accounting/periods/coa-versions?erp_category=X&company_id=Y
router.get("/coa-versions", async (req, res) => {
  const companyId   = req.query.company_id   ? parseInt(String(req.query.company_id), 10) : null;
  const erpCategory = req.query.erp_category ? String(req.query.erp_category) : null;

  let where = "1=1";
  if (companyId)   where += ` AND (company_id = ${companyId} OR company_id IS NULL)`;
  if (erpCategory) where += ` AND erp_category = '${erpCategory.replace(/'/g, "''")}'`;

  try {
    const { rows } = await db.execute(sql.raw(
      `SELECT * FROM master_coa_mapping_versioned WHERE ${where} ORDER BY erp_category, valid_from DESC`
    ));
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil COA versioning." });
  }
});

// POST /api/accounting/periods/coa-versions — tambah versi COA baru
router.post("/coa-versions", requireAdmin, async (req, res) => {
  const { erp_category, coa_code, company_id, valid_from, valid_to, accounting_class } = req.body as {
    erp_category: string;
    coa_code: string;
    company_id?: number | null;
    valid_from?: string;
    valid_to?: string | null;
    accounting_class?: string;
  };

  if (!erp_category || !coa_code) {
    return res.status(400).json({ error: "erp_category dan coa_code wajib diisi." });
  }

  const actor = (req as any).user?.email ?? "system";
  const fromDate = valid_from ?? new Date().toISOString().split('T')[0];

  try {
    // Tutup versi lama jika ada (set valid_to = valid_from - 1 day)
    if (company_id) {
      await db.execute(sql.raw(`
        UPDATE master_coa_mapping_versioned
        SET valid_to = '${fromDate}'::date - INTERVAL '1 day', is_active = FALSE
        WHERE erp_category = '${erp_category.replace(/'/g, "''")}'
          AND company_id = ${company_id}
          AND valid_to IS NULL AND is_active = TRUE
      `));
    }

    const { rows } = await db.execute(sql.raw(`
      INSERT INTO master_coa_mapping_versioned
        (erp_category, coa_code, company_id, valid_from, valid_to, is_active, created_by)
      VALUES (
        '${erp_category.replace(/'/g, "''")}',
        '${coa_code.replace(/'/g, "''")}',
        ${company_id ?? 'NULL'},
        '${fromDate}',
        ${valid_to ? `'${valid_to}'` : 'NULL'},
        TRUE,
        '${actor.replace(/'/g, "''")}'
      )
      RETURNING *
    `));
    return res.status(201).json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Gagal menambah COA version." });
  }
});

export default router;
