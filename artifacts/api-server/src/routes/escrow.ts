import { Router } from "express";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";

export const escrowAdminRouter = Router();
export const escrowPublicRouter = Router();

// ── Boot migration ────────────────────────────────────────────────────────────
db.execute(sql.raw(`
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS escrow_enabled   BOOLEAN     NOT NULL DEFAULT FALSE;
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS dp_percentage    NUMERIC(5,2);
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS dp_amount        NUMERIC(14,2);
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS dp_status        TEXT        NOT NULL DEFAULT 'none';
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS dp_held_at       TIMESTAMPTZ;
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS dp_released_at   TIMESTAMPTZ;
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS customer_confirmed_at TIMESTAMPTZ;
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS escrow_token     TEXT        UNIQUE;
  ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS escrow_notes     TEXT;
`)).catch((e: unknown) => logger.warn({ e }, "[escrow] migration warn"));

// ── Admin auth middleware ─────────────────────────────────────────────────────
escrowAdminRouter.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function idrFormat(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

const DP_STATUS_LABEL: Record<string, string> = {
  none:                   "Belum Diaktifkan",
  dp_pending:             "Menunggu DP Customer",
  dp_held:                "DP Diterima Platform",
  confirmed_by_customer:  "Barang Dikonfirmasi Customer",
  dp_released:            "Dana Dirilis ke Vendor",
  completed:              "Selesai",
};

async function getCustomerPhone(customerId: number | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  try {
    const rows = await db.execute(sql.raw(`
      SELECT phone FROM customers WHERE id = ${customerId} LIMIT 1
    `));
    const r = rows.rows[0] as Record<string, unknown> | undefined;
    const phone = String(r?.phone ?? "").trim();
    return phone || null;
  } catch {
    return null;
  }
}

function buildConfirmUrl(req: { headers: Record<string, string | string[] | undefined> }, token: string) {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}/escrow-confirm/${token}`;
}

// ── GET /api/sales/escrow/:id ─────────────────────────────────────────────────
escrowAdminRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const rows = await db.execute(sql.raw(`
    SELECT id, doc_number, customer_name, customer_id, grand_total,
           escrow_enabled, dp_percentage, dp_amount, dp_status,
           dp_held_at, dp_released_at, customer_confirmed_at,
           escrow_token, escrow_notes
    FROM sales_documents WHERE id = ${id} LIMIT 1
  `));

  const row = rows.rows[0];
  if (!row) return res.status(404).json({ error: "Not found" });

  const r = row as Record<string, unknown>;
  return res.json({
    ...r,
    dp_status_label: DP_STATUS_LABEL[String(r.dp_status ?? "none")] ?? r.dp_status,
    confirm_url: r.escrow_token
      ? buildConfirmUrl(req, String(r.escrow_token))
      : null,
  });
});

// ── POST /api/sales/escrow/:id/enable ────────────────────────────────────────
// Sends WA to customer: "Escrow aktif — silakan transfer DP"
escrowAdminRouter.post("/:id/enable", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { dpPercentage, notes } = req.body ?? {};
  const pct = Number(dpPercentage);
  if (!pct || pct <= 0 || pct > 100) {
    return res.status(400).json({ error: "dpPercentage harus antara 1–100" });
  }

  const docRows = await db.execute(sql.raw(`
    SELECT grand_total, escrow_token, customer_id, customer_name, doc_number
    FROM sales_documents WHERE id = ${id} LIMIT 1
  `));
  const doc = docRows.rows[0] as Record<string, unknown> | undefined;
  if (!doc) return res.status(404).json({ error: "Not found" });

  const dpAmount = ((Number(doc.grand_total) * pct) / 100).toFixed(2);
  const existingToken = doc.escrow_token as string | null;
  const token = existingToken || randomBytes(32).toString("hex");
  const notesVal = notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL";

  await db.execute(sql.raw(`
    UPDATE sales_documents SET
      escrow_enabled = TRUE,
      dp_percentage  = ${pct},
      dp_amount      = ${dpAmount},
      dp_status      = 'dp_pending',
      escrow_token   = COALESCE(escrow_token, '${token}'),
      escrow_notes   = ${notesVal},
      updated_at     = NOW()
    WHERE id = ${id}
  `));

  const confirmUrl = buildConfirmUrl(req, token);

  // Notify customer WA (fire-and-forget)
  getCustomerPhone(Number(doc.customer_id) || null).then((phone) => {
    if (!phone) return;
    sendWhatsApp(
      phone,
      `🔒 *Proteksi Escrow Aktif*\n\nHalo *${doc.customer_name}*,\n\nPesanan Anda *${doc.doc_number}* dilindungi sistem Escrow.\n\n💰 Jumlah DP: *${idrFormat(Number(dpAmount))}* (${pct}%)\n\nSilakan transfer DP ke rekening platform kami. Dana akan ditahan dan baru dirilis ke vendor setelah Anda konfirmasi penerimaan barang/jasa.${notes ? `\n\n📝 ${notes}` : ""}`
    ).catch(() => {});
  }).catch(() => {});

  // Also notify admin group
  getAdminGroupWa().then((waTarget) => {
    if (!waTarget) return;
    sendWhatsApp(
      waTarget,
      `🔒 *Escrow Diaktifkan*\n\n📄 ${doc.doc_number} — ${doc.customer_name}\n💰 DP: ${idrFormat(Number(dpAmount))} (${pct}%)\n\nMenunggu customer melakukan transfer DP.`
    ).catch(() => {});
  }).catch(() => {});

  return res.json({
    ok: true,
    dpAmount: Number(dpAmount),
    token,
    confirm_url: confirmUrl,
  });
});

// ── POST /api/sales/escrow/:id/hold ──────────────────────────────────────────
// Sends WA to customer: "DP diterima — klik link untuk konfirmasi setelah terima barang"
escrowAdminRouter.post("/:id/hold", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const checkRows = await db.execute(sql.raw(`
    SELECT dp_status, escrow_enabled, customer_id, customer_name, doc_number,
           dp_amount, escrow_token
    FROM sales_documents WHERE id = ${id} LIMIT 1
  `));
  const doc = checkRows.rows[0] as Record<string, unknown> | undefined;
  if (!doc) return res.status(404).json({ error: "Not found" });
  if (!doc.escrow_enabled) return res.status(409).json({ error: "Escrow belum diaktifkan" });

  await db.execute(sql.raw(`
    UPDATE sales_documents SET
      dp_status   = 'dp_held',
      dp_held_at  = NOW(),
      updated_at  = NOW()
    WHERE id = ${id}
  `));

  const token = String(doc.escrow_token ?? "");
  const confirmUrl = token ? buildConfirmUrl(req, token) : null;

  // Notify customer WA with confirm link (fire-and-forget)
  getCustomerPhone(Number(doc.customer_id) || null).then((phone) => {
    if (!phone) return;
    const confirmSection = confirmUrl
      ? `\n\nSetelah barang/jasa diterima, silakan konfirmasi melalui link berikut:\n🔗 ${confirmUrl}`
      : "";
    sendWhatsApp(
      phone,
      `✅ *DP Anda Sudah Diterima*\n\nHalo *${doc.customer_name}*,\n\nDP sebesar *${idrFormat(Number(doc.dp_amount))}* untuk pesanan *${doc.doc_number}* telah kami terima dan sedang ditahan oleh platform.\n\nDana akan dirilis ke vendor setelah Anda mengkonfirmasi penerimaan barang/jasa.${confirmSection}`
    ).catch(() => {});
  }).catch(() => {});

  // Notify admin group
  getAdminGroupWa().then((waTarget) => {
    if (!waTarget) return;
    sendWhatsApp(
      waTarget,
      `💰 *DP Escrow Diterima*\n\n📄 ${doc.doc_number} — ${doc.customer_name}\n💰 ${idrFormat(Number(doc.dp_amount))}\n\nDP sudah masuk & ditahan platform. Menunggu konfirmasi customer.`
    ).catch(() => {});
  }).catch(() => {});

  return res.json({ ok: true, dp_status: "dp_held" });
});

// ── POST /api/sales/escrow/:id/release ───────────────────────────────────────
// Sends WA to customer: "Dana dirilis ke vendor, transaksi selesai"
escrowAdminRouter.post("/:id/release", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const checkRows = await db.execute(sql.raw(`
    SELECT dp_status, escrow_enabled, customer_id, customer_name, doc_number, dp_amount
    FROM sales_documents WHERE id = ${id} LIMIT 1
  `));
  const doc = checkRows.rows[0] as Record<string, unknown> | undefined;
  if (!doc) return res.status(404).json({ error: "Not found" });
  if (!doc.escrow_enabled) return res.status(409).json({ error: "Escrow belum diaktifkan" });

  await db.execute(sql.raw(`
    UPDATE sales_documents SET
      dp_status        = 'dp_released',
      dp_released_at   = NOW(),
      updated_at       = NOW()
    WHERE id = ${id}
  `));

  // Notify customer WA (fire-and-forget)
  getCustomerPhone(Number(doc.customer_id) || null).then((phone) => {
    if (!phone) return;
    sendWhatsApp(
      phone,
      `🎉 *Transaksi Escrow Selesai*\n\nHalo *${doc.customer_name}*,\n\nDana DP sebesar *${idrFormat(Number(doc.dp_amount))}* untuk pesanan *${doc.doc_number}* telah dirilis ke vendor.\n\nTerima kasih telah menggunakan layanan B2B Marketplace and Logistic. 🙏`
    ).catch(() => {});
  }).catch(() => {});

  // Notify admin group
  getAdminGroupWa().then((waTarget) => {
    if (!waTarget) return;
    sendWhatsApp(
      waTarget,
      `✅ *Dana DP Dirilis ke Vendor*\n\n📄 ${doc.doc_number} — ${doc.customer_name}\n💰 ${idrFormat(Number(doc.dp_amount))}\n\nEscrow selesai.`
    ).catch(() => {});
  }).catch(() => {});

  return res.json({ ok: true, dp_status: "dp_released" });
});

// ── GET /api/sales/escrow/confirm/:token  (public) ───────────────────────────
escrowPublicRouter.get("/confirm/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
    return res.status(400).json({ error: "Token tidak valid" });
  }

  const rows = await db.execute(sql.raw(`
    SELECT id, doc_number, customer_name, grand_total,
           dp_percentage, dp_amount, dp_status,
           dp_held_at, customer_confirmed_at, escrow_notes
    FROM sales_documents
    WHERE escrow_token = '${token.replace(/'/g, "''")}' AND escrow_enabled = TRUE
    LIMIT 1
  `));

  const row = rows.rows[0] as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: "Link tidak valid atau sudah kedaluwarsa" });

  return res.json({
    ...row,
    dp_status_label: DP_STATUS_LABEL[String(row.dp_status ?? "none")] ?? row.dp_status,
  });
});

// ── POST /api/sales/escrow/confirm/:token  (public — customer confirms receipt)
// Sends WA to: admin group + customer acknowledgement
escrowPublicRouter.post("/confirm/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
    return res.status(400).json({ error: "Token tidak valid" });
  }

  const rows = await db.execute(sql.raw(`
    SELECT id, doc_number, customer_name, customer_id, dp_status, dp_amount, dp_held_at
    FROM sales_documents
    WHERE escrow_token = '${token.replace(/'/g, "''")}' AND escrow_enabled = TRUE
    LIMIT 1
  `));

  const row = rows.rows[0] as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: "Link tidak valid" });

  const status = String(row.dp_status ?? "");

  if (status === "confirmed_by_customer" || status === "dp_released" || status === "completed") {
    return res.status(409).json({ error: "Konfirmasi sudah dilakukan sebelumnya" });
  }
  if (status !== "dp_held") {
    return res.status(409).json({
      error: "DP belum diterima platform. Konfirmasi hanya bisa dilakukan setelah DP masuk.",
    });
  }

  await db.execute(sql.raw(`
    UPDATE sales_documents SET
      customer_confirmed_at = NOW(),
      dp_status             = 'confirmed_by_customer',
      updated_at            = NOW()
    WHERE id = ${row.id}
  `));

  // Notify admin group (fire-and-forget)
  getAdminGroupWa().then((waTarget) => {
    if (!waTarget) return;
    sendWhatsApp(
      waTarget,
      `🔔 *Konfirmasi Penerimaan Barang/Jasa*\n\nCustomer *${row.customer_name}* telah mengkonfirmasi penerimaan untuk:\n📄 ${row.doc_number}\n💰 DP Escrow: ${idrFormat(Number(row.dp_amount))}\n\n✅ Dana DP siap dirilis ke vendor.`
    ).catch(() => {});
  }).catch(() => {});

  // Send acknowledgement WA to customer (fire-and-forget)
  getCustomerPhone(Number(row.customer_id) || null).then((phone) => {
    if (!phone) return;
    sendWhatsApp(
      phone,
      `✅ *Konfirmasi Berhasil*\n\nHalo *${row.customer_name}*,\n\nKonfirmasi penerimaan barang/jasa untuk pesanan *${row.doc_number}* telah kami catat.\n\nDana DP sebesar *${idrFormat(Number(row.dp_amount))}* akan segera dirilis ke vendor oleh tim kami.\n\nTerima kasih! 🙏`
    ).catch(() => {});
  }).catch(() => {});

  return res.json({
    ok: true,
    message: "Konfirmasi berhasil. Admin akan segera merilis dana DP ke vendor.",
  });
});
