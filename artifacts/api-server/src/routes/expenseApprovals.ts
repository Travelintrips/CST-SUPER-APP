import { Router, type Request } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline migration ────────────────────────────────────────────────────────
async function ensureTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS expense_approval_limits (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      category TEXT NOT NULL,
      user_id TEXT,
      max_auto_approve NUMERIC(14,2) NOT NULL DEFAULT 0,
      l1_approver_id TEXT,
      l2_approver_id TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expense_approval_requests (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      ref_type TEXT NOT NULL,
      ref_id INTEGER,
      description TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      requester_id TEXT,
      requester_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      l1_approver_id TEXT,
      l1_approver_name TEXT,
      l1_status TEXT,
      l1_notes TEXT,
      l1_at TIMESTAMPTZ,
      l2_approver_id TEXT,
      l2_approver_name TEXT,
      l2_status TEXT,
      l2_notes TEXT,
      l2_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `));
}

let migrated = false;
async function runMigration() { if (!migrated) { await ensureTables(); migrated = true; } }

// ─── WA Notification helper ──────────────────────────────────────────────────
async function notifyApproverWa(ar: any, action: "created" | "approved" | "rejected") {
  try {
    const { getAdminGroupWa } = await import("../lib/adminWa.js");
    const { sendWhatsApp } = await import("../lib/fonnte.js");
    const adminGroup = await getAdminGroupWa();
    if (!adminGroup) return;

    const idr = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
    const catLabels: Record<string, string> = {
      kasbon: "Kasbon", talangan: "Dana Talangan", expense: "Expense",
      bank_loan: "Hutang Bank", vendor_installment: "Cicilan Vendor",
    };
    const catLabel = catLabels[ar.ref_type] ?? ar.ref_type;

    let msg = "";
    if (action === "created") {
      const approverInfo = ar.l1_approver_name ? `\nApprover L1: *${ar.l1_approver_name}*` : "";
      msg = `🔔 *Permintaan Approval Baru*\n\nKategori: ${catLabel}\nDeskripsi: ${ar.description}\nNominal: ${idr(Number(ar.amount))}\nPemohon: ${ar.requester_name ?? ar.requester_id ?? "-"}${approverInfo}\n\nBuka BizPortal → Expense → Approval untuk memproses.`;
    } else if (action === "approved") {
      msg = `✅ *Permintaan Disetujui*\n\nKategori: ${catLabel}\nDeskripsi: ${ar.description}\nNominal: ${idr(Number(ar.amount))}\nPemohon: ${ar.requester_name ?? "-"}\n\nDana sudah dapat dicairkan.`;
    } else if (action === "rejected") {
      msg = `❌ *Permintaan Ditolak*\n\nKategori: ${catLabel}\nDeskripsi: ${ar.description}\nNominal: ${idr(Number(ar.amount))}\nPemohon: ${ar.requester_name ?? "-"}`;
    }
    if (msg) {
      sendWhatsApp(adminGroup, msg, { context: `expense_approval_${action}`, refId: String(ar.id) }).catch(() => {});
    }
  } catch { /* non-fatal */ }
}

// ─── Activate kasbon/talangan after approval ─────────────────────────────────
async function activateCashAdvance(refId: number) {
  try {
    const { postCashAdvanceJournal } = await import("./cashAdvances.js");
    await postCashAdvanceJournal(refId);
  } catch (e) {
    console.error("[expenseApprovals] activateCashAdvance error:", e);
  }
}

// ─── Activate expense (quick) after approval ─────────────────────────────────
async function activateExpense(refId: number) {
  try {
    const { postQuickExpenseJournal } = await import("./expenses.js");
    await postQuickExpenseJournal(refId);
  } catch (e) {
    console.error("[expenseApprovals] activateExpense error:", e);
  }
}

// ─── Reject kasbon/talangan ───────────────────────────────────────────────────
async function rejectCashAdvance(refId: number, reason: string | null) {
  const reasonEsc = reason ? `'${String(reason).replace(/'/g, "''")}'` : "NULL";
  await db.execute(sql.raw(
    `UPDATE cash_advances SET status = 'rejected', rejection_reason = ${reasonEsc}, updated_at = NOW() WHERE id = ${refId}`
  ));
}

// ─── Reject expense ───────────────────────────────────────────────────────────
async function rejectExpense(refId: number, reason: string | null) {
  const reasonEsc = reason ? `'${String(reason).replace(/'/g, "''")}'` : "NULL";
  await db.execute(sql.raw(
    `UPDATE expenses SET status = 'rejected', rejection_reason = ${reasonEsc}, updated_at = NOW() WHERE id = ${refId}`
  ));
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL LIMITS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/limits", async (req: Request, res) => {
  await runMigration();
  const companyId = await resolveCompanyId(req);
  const rows = await db.execute(sql.raw(
    `SELECT l.*, u1.name AS l1_name, u2.name AS l2_name
     FROM expense_approval_limits l
     LEFT JOIN users u1 ON u1.id = l.l1_approver_id
     LEFT JOIN users u2 ON u2.id = l.l2_approver_id
     ${companyId ? `WHERE l.company_id = ${companyId}` : ""}
     ORDER BY l.category, l.id`
  ));
  res.json(rows.rows);
});

router.post("/limits", async (req: Request, res) => {
  await runMigration();
  const companyId = await resolveCompanyId(req);
  const { category, userId = null, maxAutoApprove = 0, l1ApproverId = null, l2ApproverId = null, notes } = req.body;
  if (!category) return res.status(400).json({ message: "Kategori wajib diisi." });

  const result = await db.execute(sql.raw(`
    INSERT INTO expense_approval_limits
      (company_id, category, user_id, max_auto_approve, l1_approver_id, l2_approver_id, notes)
    VALUES
      (${companyId ?? "NULL"}, '${category}',
       ${userId ? `'${userId}'` : "NULL"},
       ${parseFloat(maxAutoApprove) || 0},
       ${l1ApproverId ? `'${l1ApproverId}'` : "NULL"},
       ${l2ApproverId ? `'${l2ApproverId}'` : "NULL"},
       ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"})
    RETURNING *
  `));
  res.status(201).json(result.rows[0]);
});

router.put("/limits/:id", async (req: Request, res) => {
  await runMigration();
  const id = parseInt(String(req.params.id));
  const { category, userId = null, maxAutoApprove = 0, l1ApproverId = null, l2ApproverId = null, notes } = req.body;
  if (!category) return res.status(400).json({ message: "Kategori wajib diisi." });

  await db.execute(sql.raw(`
    UPDATE expense_approval_limits SET
      category = '${category}',
      user_id = ${userId ? `'${userId}'` : "NULL"},
      max_auto_approve = ${parseFloat(maxAutoApprove) || 0},
      l1_approver_id = ${l1ApproverId ? `'${l1ApproverId}'` : "NULL"},
      l2_approver_id = ${l2ApproverId ? `'${l2ApproverId}'` : "NULL"},
      notes = ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"},
      updated_at = NOW()
    WHERE id = ${id}
  `));
  const result = await db.execute(sql.raw(`SELECT * FROM expense_approval_limits WHERE id = ${id}`));
  res.json(result.rows[0]);
});

router.delete("/limits/:id", async (req: Request, res) => {
  await runMigration();
  await db.execute(sql.raw(`DELETE FROM expense_approval_limits WHERE id = ${parseInt(String(req.params.id))}`));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/requests", async (req: Request, res) => {
  await runMigration();
  const companyId = await resolveCompanyId(req);
  const { status } = req.query;

  let where = companyId ? `WHERE r.company_id = ${companyId}` : "WHERE 1=1";
  if (status && status !== "all") where += ` AND r.status = '${status}'`;

  const rows = await db.execute(sql.raw(
    `SELECT r.*,
       u1.name AS l1_approver_display,
       u2.name AS l2_approver_display
     FROM expense_approval_requests r
     LEFT JOIN users u1 ON u1.id = r.l1_approver_id
     LEFT JOIN users u2 ON u2.id = r.l2_approver_id
     ${where}
     ORDER BY r.created_at DESC LIMIT 200`
  ));
  res.json(rows.rows);
});

router.post("/requests", async (req: Request, res) => {
  await runMigration();
  const companyId = await resolveCompanyId(req);
  const userId = (req as any).userId ?? null;
  const {
    refType, refId = null, description, amount,
    requesterName = null, l1ApproverId = null, l2ApproverId = null, notes,
  } = req.body;

  if (!refType) return res.status(400).json({ message: "refType wajib diisi." });
  if (!description) return res.status(400).json({ message: "Deskripsi wajib diisi." });
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ message: "Nominal harus lebih dari 0." });

  // Auto-detect l1/l2 from limits if not specified
  let finalL1 = l1ApproverId;
  let finalL2 = l2ApproverId;
  if (!finalL1) {
    const limitResult = await db.execute(sql.raw(
      `SELECT * FROM expense_approval_limits WHERE category = '${refType}'
       AND (user_id = ${userId ? `'${userId}'` : "NULL"} OR user_id IS NULL)
       AND (company_id = ${companyId ?? "NULL"} OR company_id IS NULL)
       ORDER BY user_id NULLS LAST LIMIT 1`
    ));
    const limit = limitResult.rows[0] as any;
    if (limit) { finalL1 = limit.l1_approver_id; finalL2 = limit.l2_approver_id; }
  }

  let l1Name = null, l2Name = null;
  if (finalL1) {
    const r = await db.execute(sql.raw(`SELECT name FROM users WHERE id = '${finalL1}' LIMIT 1`));
    l1Name = (r.rows[0] as any)?.name ?? null;
  }
  if (finalL2) {
    const r = await db.execute(sql.raw(`SELECT name FROM users WHERE id = '${finalL2}' LIMIT 1`));
    l2Name = (r.rows[0] as any)?.name ?? null;
  }

  const result = await db.execute(sql.raw(`
    INSERT INTO expense_approval_requests
      (company_id, ref_type, ref_id, description, amount, requester_id, requester_name,
       status, l1_approver_id, l1_approver_name, l1_status,
       l2_approver_id, l2_approver_name, l2_status, notes)
    VALUES
      (${companyId ?? "NULL"}, '${refType}', ${refId ?? "NULL"},
       '${String(description).replace(/'/g, "''")}', ${amt},
       ${userId ? `'${userId}'` : "NULL"},
       ${requesterName ? `'${String(requesterName).replace(/'/g, "''")}'` : "NULL"},
       'pending',
       ${finalL1 ? `'${finalL1}'` : "NULL"},
       ${l1Name ? `'${String(l1Name).replace(/'/g, "''")}'` : "NULL"},
       ${finalL1 ? "'pending'" : "NULL"},
       ${finalL2 ? `'${finalL2}'` : "NULL"},
       ${l2Name ? `'${String(l2Name).replace(/'/g, "''")}'` : "NULL"},
       ${finalL2 ? "'pending'" : "NULL"},
       ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"})
    RETURNING *
  `));
  const ar = result.rows[0] as any;
  notifyApproverWa(ar, "created").catch(() => {});
  res.status(201).json(ar);
});

// ─── POST /api/expense-approvals/requests/:id/action ─────────────────────────
router.post("/requests/:id/action", async (req: Request, res) => {
  await runMigration();
  const id = parseInt(String(req.params.id));
  const { action, notes } = req.body; // action: approve | reject
  const userId = (req as any).userId ?? null;

  const reqResult = await db.execute(sql.raw(`SELECT * FROM expense_approval_requests WHERE id = ${id}`));
  const ar = reqResult.rows[0] as any;
  if (!ar) return res.status(404).json({ message: "Permintaan tidak ditemukan." });
  if (ar.status === "approved" || ar.status === "rejected") {
    return res.status(400).json({ message: "Permintaan sudah diproses." });
  }

  const now = new Date().toISOString();
  const notesEsc = notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL";

  let finalStatus = ar.status;

  // Tentukan level approver
  if (ar.l1_approver_id === userId && ar.l1_status === "pending") {
    if (action === "reject") {
      await db.execute(sql.raw(`
        UPDATE expense_approval_requests
        SET l1_status = 'rejected', l1_notes = ${notesEsc}, l1_at = NOW(), status = 'rejected', updated_at = NOW()
        WHERE id = ${id}
      `));
      finalStatus = "rejected";
    } else {
      const l2Needed = !!ar.l2_approver_id;
      const newStatus = l2Needed ? "l1_approved" : "approved";
      const l2Status = l2Needed ? "pending" : "skipped";
      await db.execute(sql.raw(`
        UPDATE expense_approval_requests
        SET l1_status = 'approved', l1_notes = ${notesEsc}, l1_at = NOW(),
            l2_status = '${l2Status}', status = '${newStatus}', updated_at = NOW()
        WHERE id = ${id}
      `));
      finalStatus = newStatus;
    }
  } else if (ar.l2_approver_id === userId && ar.l2_status === "pending") {
    const newStatus = action === "reject" ? "rejected" : "approved";
    const l2NewStatus = action === "reject" ? "rejected" : "approved";
    await db.execute(sql.raw(`
      UPDATE expense_approval_requests
      SET l2_status = '${l2NewStatus}', l2_notes = ${notesEsc}, l2_at = NOW(), status = '${newStatus}', updated_at = NOW()
      WHERE id = ${id}
    `));
    finalStatus = newStatus;
  } else {
    // Admin force-approve/reject
    const newStatus = action === "reject" ? "rejected" : "approved";
    await db.execute(sql.raw(`
      UPDATE expense_approval_requests
      SET status = '${newStatus}', updated_at = NOW()
      WHERE id = ${id}
    `));
    finalStatus = newStatus;
  }

  const updated = await db.execute(sql.raw(`SELECT * FROM expense_approval_requests WHERE id = ${id}`));
  const updatedAr = updated.rows[0] as any;

  // ── Side effects saat final approved / rejected ───────────────────────────
  if (updatedAr.ref_id) {
    const refId = Number(updatedAr.ref_id);
    const refType = updatedAr.ref_type;

    if (finalStatus === "approved") {
      if (refType === "kasbon" || refType === "talangan") {
        await activateCashAdvance(refId);
      } else if (refType === "expense") {
        await activateExpense(refId);
      }
      notifyApproverWa(updatedAr, "approved").catch(() => {});
    } else if (finalStatus === "rejected") {
      if (refType === "kasbon" || refType === "talangan") {
        await rejectCashAdvance(refId, notes ?? null);
      } else if (refType === "expense") {
        await rejectExpense(refId, notes ?? null);
      }
      notifyApproverWa(updatedAr, "rejected").catch(() => {});
    }
  }

  res.json(updatedAr);
});

// ─── GET /api/expense-approvals/users — daftar user untuk dropdown approver ──
router.get("/users", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);

  // Gabung users (non-tenant) + employees table supaya dropdown lengkap
  const rows = await db.execute(sql.raw(`
    SELECT id::text AS id, name, email, company_id::text AS company_id
    FROM users
    WHERE name IS NOT NULL AND name <> ''
      AND role NOT IN ('tenant_user', 'cashier')
      AND email NOT LIKE '%@wa.local'
      AND name NOT LIKE '[TEST:%'
    UNION
    SELECT id::text AS id,
           TRIM(first_name || ' ' || last_name) AS name,
           email,
           company_id::text AS company_id
    FROM employees
    WHERE status != 'inactive' OR status IS NULL
    ORDER BY name
    LIMIT 300
  `));
  res.json(rows.rows);
});

export default router;
