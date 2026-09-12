import { Router, type Request, type Response } from "express";
import multer from "multer";
import { requireAdmin } from "../lib/requireAdmin.js";
import { invalidateAppConfig } from "../lib/appConfig.js";
import { getAdminWa, setAdminWa, getAdminGroupWa, setAdminGroupWa, getAdminPhones, setAdminPhones } from "../lib/adminWa.js";
import { db, portalContentTable } from "@workspace/db";
import { broadcastToPortal } from "../lib/sseManager.js";
import {
  shortLinksTable, waTemplateConfigsTable, notificationLogsTable,
  logisticOrdersTable, salesDocumentsTable, customersTable,
  suppliersTable, freightShipmentsTable, usersTable,
} from "@workspace/db/schema";
import { eq, desc, ilike, or, sql, and, isNull, inArray } from "drizzle-orm";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { getAiIntakeSettings, saveAiIntakeSettings, type VendorFilterMode } from "../lib/aiOrderIntake.js";
import { LOGISTICS_SUBCATEGORIES } from "@workspace/logistics-constants";
import { SECRETS_CATALOG, getSetting, setSetting, maskSecret, invalidateSettingCache } from "../lib/appSecrets.js";
import { uploadToSupabase } from "../lib/supabaseStorage.js";

const router = Router();
const _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CALC_RATES_KEY = "calculator_rates";
const VEHICLE_IMAGES_KEY = "vehicle_images";
const VEHICLE_ORDER_KEY  = "vehicle_order";
const CARGO_TYPES_KEY = "cargo_types";
const DEFAULT_CARGO_TYPES = ["Electronics", "Textiles", "Furniture", "Food & Beverage", "Chemicals", "Machinery", "Automotive Parts", "Medical Supplies", "Paper & Printing", "Raw Materials"];
const LOGISTICS_SUBCATEGORIES_KEY = "logistics_subcategories";

export const DEFAULT_CALC_RATES = {
  airFreight:  { baseCost: 500000,  ratePerKg: 90000,    handlingPct: 5, customsFee: 1200000 },
  seaFreight:  { baseCost: 750000,  ratePerCbm: 2500000, handlingPct: 5, customsFee: 1500000 },
  customs:     { baseCost: 1500000, ratePerKg: 5000,     handlingFee: 500000, customsPct: 0.5 },
  domestic:    { baseCost: 500000,  ratePerKg: 8500,     handlingPct: 5 },
  warehousing: { baseCost: 5000000, ratePerCbm: 2500000, handlingFee: 500000 },
};

// GET /api/settings/notifications — get notification settings (admin)
router.get("/notifications", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const [adminWa, adminGroupWa, adminPhones] = await Promise.all([getAdminWa(), getAdminGroupWa(), getAdminPhones()]);
  return res.json({ adminWa, adminGroupWa, adminPhones });
});

// PUT /api/settings/notifications — update notification settings (admin)
router.put("/notifications", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { adminWa, adminGroupWa, adminPhones } = req.body ?? {};
  if (typeof adminWa !== "string") {
    return res.status(400).json({ message: "adminWa harus berupa string" });
  }
  const saves: Promise<void>[] = [setAdminWa(adminWa)];
  if (typeof adminGroupWa === "string") saves.push(setAdminGroupWa(adminGroupWa));
  if (typeof adminPhones === "string") saves.push(setAdminPhones(adminPhones.split(",").map(s => s.trim()).filter(Boolean)));
  await Promise.all(saves);
  return res.json({
    ok: true,
    adminWa: adminWa.trim(),
    adminGroupWa: typeof adminGroupWa === "string" ? adminGroupWa.trim() : undefined,
    adminPhones: typeof adminPhones === "string" ? adminPhones.trim() : undefined,
  });
});

// GET /api/settings/calculator-rates — get calculator rates (admin)
router.get("/calculator-rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, CALC_RATES_KEY));
    const rates = row ? JSON.parse(row.value) : DEFAULT_CALC_RATES;
    return res.json(rates);
  } catch {
    return res.json(DEFAULT_CALC_RATES);
  }
});

// PUT /api/settings/calculator-rates — update calculator rates (admin)
router.put("/calculator-rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const rates = req.body;
  if (!rates || typeof rates !== "object") {
    return res.status(400).json({ message: "Invalid rates payload" });
  }
  await db
    .insert(portalContentTable)
    .values({ key: CALC_RATES_KEY, value: JSON.stringify(rates), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalContentTable.key,
      set: { value: JSON.stringify(rates), updatedAt: new Date() },
    });
  // Notify Customer Portal: tarif kalkulator diperbarui oleh admin.
  // Listener: calculator.tsx (invalidates ["portal-calculator-rates"])
  broadcastToPortal("price_sync", { ts: Date.now() });
  return res.json({ ok: true });
});

// GET /api/settings/cargo-types — get cargo types list (admin)
router.get("/cargo-types", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, CARGO_TYPES_KEY));
    const types = row ? JSON.parse(row.value) : DEFAULT_CARGO_TYPES;
    return res.json(types);
  } catch {
    return res.json(DEFAULT_CARGO_TYPES);
  }
});

// Idempotent migration: add company_id to whatsapp_template_configs
db.execute(sql`ALTER TABLE whatsapp_template_configs ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id)`).catch(() => {});
db.execute(sql`
  DO $$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'uq_wa_tpl_cfg'
        AND conrelid = 'whatsapp_template_configs'::regclass
    ) THEN
      ALTER TABLE whatsapp_template_configs DROP CONSTRAINT uq_wa_tpl_cfg;
    END IF;
  END $$
`).catch(() => {});
db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_tpl_cfg_company
  ON whatsapp_template_configs (COALESCE(company_id, 0), recipient, workflow)
`).catch(() => {});

// ── WA Template Configs — inline migration ────────────────────────────────────
db.execute(sql`
  ALTER TABLE whatsapp_template_configs
    ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
`).then(() =>
  db.execute(sql`
    DROP INDEX IF EXISTS uq_wa_tpl_cfg
  `)
).then(() =>
  db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_tpl_cfg_v2
    ON whatsapp_template_configs (COALESCE(company_id, 0), recipient, workflow)
  `)
).catch(() => { /* non-fatal */ });

// ── WA Template Configs (workflow-based) ──────────────────────────────────────

// GET /api/settings/wa-template-configs — fetch all saved workflow templates
router.get("/wa-template-configs", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const companyId = resolveCompanyId(req);
    const { getWaDefaultTemplatesFlatMap } = await import("../lib/orderNotification.js");
    const rows = await db.select().from(waTemplateConfigsTable)
      .where(or(
        eq(waTemplateConfigsTable.companyId, companyId),
        isNull(waTemplateConfigsTable.companyId)
      ));
    const savedKeys: string[] = [];
    const configs: Record<string, string> = { ...getWaDefaultTemplatesFlatMap() };
    const globalRows = rows.filter(r => r.companyId === null);
    const companyRows = rows.filter(r => r.companyId !== null);
    for (const row of [...globalRows, ...companyRows]) {
      const key = `${row.recipient}__${row.workflow}`;
      if (row.body.trim()) {
        if (!savedKeys.includes(key) || row.companyId != null) {
          configs[key] = row.body;
          if (!savedKeys.includes(key)) savedKeys.push(key);
        }
      }
    }
    return res.json({ configs, savedKeys });
  } catch {
    return res.json({ configs: {}, savedKeys: [] });
  }
});

// PUT /api/settings/wa-template-configs — save/update one workflow template
router.put("/wa-template-configs", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { recipient, workflow, body } = req.body as { recipient?: string; workflow?: string; body?: string };
  if (!recipient || !workflow || typeof body !== "string") {
    return res.status(400).json({ message: "Payload harus berupa { recipient, workflow, body }" });
  }
  if (!body.trim()) {
    return res.status(400).json({ message: "Template tidak boleh kosong. Gunakan tombol 'Reset ke Default' untuk menghapus kustomisasi." });
  }
  const companyId = resolveCompanyId(req);
  const VALID_RECIPIENTS = ["admin_personal", "admin_group", "customer", "vendor"];
  const VALID_WORKFLOWS = [
    // ── Existing logistics & product order workflows ──────────────────────
    "order_new", "vendor_request", "vendor_submission", "vendor_revision",
    "vendor_confirmed", "vendor_rejected",
    "vendor_submit_confirm", "vendor_rfq_forward", "vendor_submission_summary", "revision_fallback",
    "customer_approval", "customer_approved", "customer_options",
    "customer_revised", "customer_rejected",
    "so_created", "op_request", "task_link", "task_update",
    "driver_assigned", "shipment_update", "customs_update",
    "operational_update", "delivery_completed",
    "rfq_vendor_recap", "customer_rejection", "op_confirm_submitted", "customer_rfq_response",
    "product_order_new",
    "product_order_status_update",
    "product_vendor_response", "vendor_awarded", "vendor_selected_admin",
    "quotation_send",
    "invoice_issued",
    // ── PROCUREMENT ───────────────────────────────────────────────────────
    "procurement_purchase_request",
    "procurement_vendor_comparison",
    "procurement_po_release",
    "procurement_goods_receipt",
    "procurement_invoice_matching",
    // ── FINANCE ───────────────────────────────────────────────────────────
    "finance_customer_invoice",
    "finance_vendor_invoice",
    "finance_payment_reminder",
    "finance_payment_confirmation",
    "finance_outstanding_alert",
    // ── DOCUMENT ──────────────────────────────────────────────────────────
    "doc_missing",
    "doc_approved",
    "doc_customs_released",
    "doc_bl_released",
    "doc_coa_uploaded",
    // ── APPROVAL ──────────────────────────────────────────────────────────
    "approval_waiting",
    "approval_approved",
    "approval_rejected",
    "approval_revision_requested",
    // ── OPERATIONS ────────────────────────────────────────────────────────
    "ops_shipment_delayed",
    "ops_truck_arrived",
    "ops_driver_checkin",
    "ops_warehouse_ready",
    // ── SYSTEM ────────────────────────────────────────────────────────────
    "sys_template_updated",
    "sys_required_field_missing",
    "sys_required_doc_missing",
  ];
  if (!VALID_RECIPIENTS.includes(recipient)) return res.status(400).json({ message: "recipient tidak valid" });
  if (!VALID_WORKFLOWS.includes(workflow)) return res.status(400).json({ message: "workflow tidak valid" });

  const [existing] = await db.select({ id: waTemplateConfigsTable.id })
    .from(waTemplateConfigsTable)
    .where(and(
      eq(waTemplateConfigsTable.companyId, companyId),
      eq(waTemplateConfigsTable.recipient, recipient),
      eq(waTemplateConfigsTable.workflow, workflow),
    ));
  if (existing) {
    await db.update(waTemplateConfigsTable)
      .set({ body, updatedAt: new Date() })
      .where(eq(waTemplateConfigsTable.id, existing.id));
  } else {
    await db.insert(waTemplateConfigsTable)
      .values({ companyId, recipient, workflow, body, updatedAt: new Date() });
  }

  try {
    const { invalidateWaTemplateCache } = await import("../lib/orderNotification.js");
    invalidateWaTemplateCache();
  } catch { /* non-fatal */ }

  return res.json({ ok: true });
});

// DELETE /api/settings/wa-template-configs/:recipient/:workflow — reset to default
router.delete("/wa-template-configs/:recipient/:workflow", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { recipient, workflow } = req.params as { recipient: string; workflow: string };
  const companyId = resolveCompanyId(req);
  try {
    await db.delete(waTemplateConfigsTable).where(
      and(
        eq(waTemplateConfigsTable.companyId, companyId),
        eq(waTemplateConfigsTable.recipient, recipient),
        eq(waTemplateConfigsTable.workflow, workflow),
        companyId != null ? eq(waTemplateConfigsTable.companyId, companyId) : isNull(waTemplateConfigsTable.companyId),
      )
    );
  } catch { /* ignore */ }
  return res.json({ ok: true });
});

// PUT /api/settings/cargo-types — update cargo types list (admin)
router.put("/cargo-types", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const types = req.body;
  if (!Array.isArray(types)) {
    return res.status(400).json({ message: "Payload must be an array of strings" });
  }
  const cleaned = types.map((t: unknown) => String(t).trim()).filter(Boolean);
  await db
    .insert(portalContentTable)
    .values({ key: CARGO_TYPES_KEY, value: JSON.stringify(cleaned), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalContentTable.key,
      set: { value: JSON.stringify(cleaned), updatedAt: new Date() },
    });
  return res.json({ ok: true, count: cleaned.length });
});

// GET /api/settings/logistics-subcategories — get subcategory list (admin)
router.get("/logistics-subcategories", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, LOGISTICS_SUBCATEGORIES_KEY));
    const cats = row ? JSON.parse(row.value) : LOGISTICS_SUBCATEGORIES;
    return res.json(cats);
  } catch {
    return res.json(LOGISTICS_SUBCATEGORIES);
  }
});

// PUT /api/settings/logistics-subcategories — update subcategory list (admin)
router.put("/logistics-subcategories", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const cats = req.body;
  if (!Array.isArray(cats)) {
    return res.status(400).json({ message: "Payload must be an array of strings" });
  }
  const cleaned = cats.map((c: unknown) => String(c).trim()).filter(Boolean);
  await db
    .insert(portalContentTable)
    .values({ key: LOGISTICS_SUBCATEGORIES_KEY, value: JSON.stringify(cleaned), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalContentTable.key,
      set: { value: JSON.stringify(cleaned), updatedAt: new Date() },
    });
  return res.json({ ok: true, count: cleaned.length });
});

// GET /api/settings/ai-intake — get AI intake settings (admin)
router.get("/ai-intake", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const settings = await getAiIntakeSettings();
  return res.json(settings);
});

// PUT /api/settings/ai-intake — update AI intake settings (admin)
router.put("/ai-intake", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { enabled, replyWaTemplate, replyEmailSubject, replyEmailBody, vendorFilterMode } = req.body ?? {};
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled harus boolean" });
  }
  const validFilterModes: VendorFilterMode[] = ["all", "by-service-type"];
  if (vendorFilterMode !== undefined && !validFilterModes.includes(vendorFilterMode as VendorFilterMode)) {
    return res.status(400).json({ message: "vendorFilterMode harus 'all' atau 'by-service-type'" });
  }
  await saveAiIntakeSettings({
    enabled: enabled ?? true,
    replyWaTemplate: typeof replyWaTemplate === "string" ? replyWaTemplate : undefined,
    replyEmailSubject: typeof replyEmailSubject === "string" ? replyEmailSubject : undefined,
    replyEmailBody: typeof replyEmailBody === "string" ? replyEmailBody : undefined,
    vendorFilterMode: vendorFilterMode as VendorFilterMode | undefined,
  });
  return res.json({ message: "Pengaturan AI intake disimpan." });
});

const NAV_COMPANY_CONFIG_KEY = "nav_company_config";

// GET /api/settings/nav-company-config — load nav item company restrictions (admin)
router.get("/nav-company-config", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, NAV_COMPANY_CONFIG_KEY));
    return res.json(row ? JSON.parse(row.value) : {});
  } catch {
    return res.json({});
  }
});

// PUT /api/settings/nav-company-config — save nav item company restrictions (admin)
router.put("/nav-company-config", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const config = req.body;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return res.status(400).json({ message: "Payload harus berupa object" });
  }
  await db
    .insert(portalContentTable)
    .values({ key: NAV_COMPANY_CONFIG_KEY, value: JSON.stringify(config), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalContentTable.key,
      set: { value: JSON.stringify(config), updatedAt: new Date() },
    });
  return res.json({ ok: true });
});

// ── Short Links Management (admin) ─────────────────────────────────────────

// GET /api/settings/wa-logs?page=1&pageSize=30&status=&search=
router.get("/wa-logs", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const page     = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
  const status   = String(req.query.status ?? "").trim();
  const search   = String(req.query.search  ?? "").trim();
  const offset   = (page - 1) * pageSize;
  try {
    const conditions: ReturnType<typeof eq>[] = [eq(notificationLogsTable.channel, "wa")];
    if (status === "sent" || status === "failed") conditions.push(eq(notificationLogsTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(notificationLogsTable.recipient, `%${search}%`),
          ilike(notificationLogsTable.refId,     `%${search}%`),
          ilike(notificationLogsTable.context,   `%${search}%`),
        ) as ReturnType<typeof eq>,
      );
    }
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);
    const [rows, countResult] = await Promise.all([
      db.select({
        id: notificationLogsTable.id,
        recipient: notificationLogsTable.recipient,
        message: notificationLogsTable.message,
        status: notificationLogsTable.status,
        errorMsg: notificationLogsTable.errorMsg,
        context: notificationLogsTable.context,
        refType: notificationLogsTable.refType,
        refId: notificationLogsTable.refId,
        createdAt: notificationLogsTable.createdAt,
      }).from(notificationLogsTable).where(where).orderBy(desc(notificationLogsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(notificationLogsTable).where(where),
    ]);
    return res.json({ data: rows, total: countResult[0]?.count ?? 0, page, pageSize });
  } catch (err) {
    req.log?.error({ err }, "wa-logs list error");
    return res.status(500).json({ message: "Gagal memuat log WA" });
  }
});

// GET /api/settings/wa-logs/stats — summary counts for 7d and 30d
router.get("/wa-logs/stats", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const now = new Date();
    const d7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [rows7, rows30, rowsAll] = await Promise.all([
      db.select({
        status: notificationLogsTable.status,
        count: sql<number>`count(*)::int`,
      }).from(notificationLogsTable)
        .where(and(eq(notificationLogsTable.channel, "wa"), sql`${notificationLogsTable.createdAt} >= ${d7}`))
        .groupBy(notificationLogsTable.status),
      db.select({
        status: notificationLogsTable.status,
        count: sql<number>`count(*)::int`,
      }).from(notificationLogsTable)
        .where(and(eq(notificationLogsTable.channel, "wa"), sql`${notificationLogsTable.createdAt} >= ${d30}`))
        .groupBy(notificationLogsTable.status),
      db.select({
        status: notificationLogsTable.status,
        count: sql<number>`count(*)::int`,
      }).from(notificationLogsTable)
        .where(eq(notificationLogsTable.channel, "wa"))
        .groupBy(notificationLogsTable.status),
    ]);

    const tally = (rows: { status: string; count: number }[]) => ({
      sent:   rows.find(r => r.status === "sent")?.count   ?? 0,
      failed: rows.find(r => r.status === "failed")?.count ?? 0,
    });

    return res.json({ d7: tally(rows7), d30: tally(rows30), all: tally(rowsAll) });
  } catch (err) {
    req.log?.error({ err }, "wa-logs stats error");
    return res.status(500).json({ message: "Gagal memuat statistik WA" });
  }
});

// GET /api/settings/wa-logs/export?status=&search= — download as CSV
router.get("/wa-logs/export", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const status = String(req.query.status ?? "").trim();
  const search = String(req.query.search  ?? "").trim();
  try {
    const conditions: ReturnType<typeof eq>[] = [eq(notificationLogsTable.channel, "wa")];
    if (status === "sent" || status === "failed") conditions.push(eq(notificationLogsTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(notificationLogsTable.recipient, `%${search}%`),
          ilike(notificationLogsTable.refId,     `%${search}%`),
          ilike(notificationLogsTable.context,   `%${search}%`),
        ) as ReturnType<typeof eq>,
      );
    }
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);
    const rawLimit = parseInt(String(req.query.limit ?? "100"), 10);
    const exportLimit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 100 : rawLimit, 500);
    const rows = await db.select({
      id: notificationLogsTable.id,
      recipient: notificationLogsTable.recipient,
      status: notificationLogsTable.status,
      errorMsg: notificationLogsTable.errorMsg,
      context: notificationLogsTable.context,
      refType: notificationLogsTable.refType,
      refId: notificationLogsTable.refId,
      message: notificationLogsTable.message,
      createdAt: notificationLogsTable.createdAt,
    }).from(notificationLogsTable).where(where).orderBy(desc(notificationLogsTable.createdAt)).limit(exportLimit);

    const escape = (v: unknown) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    };
    const header = ["id", "tanggal", "penerima", "status", "error", "context", "refType", "refId", "pesan"];
    const csvRows = [
      header.join(","),
      ...rows.map(r => [
        r.id,
        new Date(r.createdAt).toLocaleString("id-ID"),
        escape(r.recipient),
        escape(r.status),
        escape(r.errorMsg),
        escape(r.context),
        escape(r.refType),
        escape(r.refId),
        escape(r.message),
      ].join(",")),
    ];
    const csv = csvRows.join("\r\n");
    const filename = `wa-log-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-cache");
    return res.send("\uFEFF" + csv); // BOM for Excel UTF-8
  } catch (err) {
    req.log?.error({ err }, "wa-logs export error");
    return res.status(500).json({ message: "Gagal export log WA" });
  }
});

// GET /api/settings/short-links?page=1&pageSize=20&search=xxx
router.get("/short-links", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const search = String(req.query.search ?? "").trim();
  const offset = (page - 1) * pageSize;

  try {
    const where = search
      ? or(
          ilike(shortLinksTable.code, `%${search}%`),
          ilike(shortLinksTable.targetUrl, `%${search}%`),
          ilike(shortLinksTable.context, `%${search}%`),
          ilike(shortLinksTable.refId, `%${search}%`),
        )
      : undefined;

    const [rows, countResult] = await Promise.all([
      db.select().from(shortLinksTable)
        .where(where)
        .orderBy(desc(shortLinksTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(shortLinksTable).where(where),
    ]);

    return res.json({
      data: rows,
      total: countResult[0]?.count ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    req.log?.error({ err }, "short-links list error");
    return res.status(500).json({ message: "Gagal memuat short links" });
  }
});

// DELETE /api/settings/short-links/:id
router.delete("/short-links/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (!id) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.delete(shortLinksTable).where(eq(shortLinksTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "short-link delete error");
    return res.status(500).json({ message: "Gagal menghapus" });
  }
});

// PATCH /api/settings/short-links/:id/deactivate — set expiresAt to now (expired)
router.patch("/short-links/:id/deactivate", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (!id) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.update(shortLinksTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shortLinksTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "short-link deactivate error");
    return res.status(500).json({ message: "Gagal menonaktifkan" });
  }
});

// PATCH /api/settings/short-links/:id/reactivate — clear expiresAt
router.patch("/short-links/:id/reactivate", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (!id) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.update(shortLinksTable)
      .set({ expiresAt: null })
      .where(eq(shortLinksTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "short-link reactivate error");
    return res.status(500).json({ message: "Gagal mengaktifkan kembali" });
  }
});

// ── Page Content (konten teks halaman publik) ────────────────────────────────
const PAGE_CONTENT_KEY = "page_content";

export const DEFAULT_PAGE_CONTENT = {
  admin_review: {
    pageTitle: "Review & Blast Vendor",
    pageSubtitle: "B2B Marketplace and Logistic — Admin Panel",
    deadlineLabel: "Batas Waktu Respon Vendor",
    vendorSectionTitle: "Pilih Vendor",
    blastHint: "Vendor akan menerima WA dengan link form penawaran",
  },
};

// GET /api/settings/page-content — public (dipakai customer portal)
router.get("/page-content", async (req: Request, res: Response) => {
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, PAGE_CONTENT_KEY));
    const content = row ? JSON.parse(row.value) : DEFAULT_PAGE_CONTENT;
    return res.json({ ...DEFAULT_PAGE_CONTENT, ...content });
  } catch {
    return res.json(DEFAULT_PAGE_CONTENT);
  }
});

// PUT /api/settings/page-content — admin only
router.put("/page-content", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const content = req.body;
  if (!content || typeof content !== "object") {
    return res.status(400).json({ message: "Invalid payload" });
  }
  await db
    .insert(portalContentTable)
    .values({ key: PAGE_CONTENT_KEY, value: JSON.stringify(content), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalContentTable.key,
      set: { value: JSON.stringify(content), updatedAt: new Date() },
    });
  return res.json({ ok: true });
});

// ── Freight Stage Labels ──────────────────────────────────────────────────────
const FREIGHT_STAGE_LABELS_KEY = "freight_stage_labels";

export const DEFAULT_FREIGHT_STAGE_LABELS: Record<string, string> = {
  booking: "Booking",
  trucking: "Trucking",
  handling: "Handling",
  customs: "Customs Clearance",
};

// GET /api/settings/freight-stage-labels — no auth required (used by authenticated BizPortal pages)
router.get("/freight-stage-labels", async (_req: Request, res: Response) => {
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, FREIGHT_STAGE_LABELS_KEY));
    const stored: Record<string, string> = row ? JSON.parse(row.value) as Record<string, string> : {};
    return res.json({ labels: { ...DEFAULT_FREIGHT_STAGE_LABELS, ...stored } });
  } catch {
    return res.json({ labels: DEFAULT_FREIGHT_STAGE_LABELS });
  }
});

// PUT /api/settings/freight-stage-labels — admin only
router.put("/freight-stage-labels", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { labels } = req.body as { labels?: Record<string, string> };
  if (!labels || typeof labels !== "object") return res.status(400).json({ message: "Invalid payload" });
  const filtered: Record<string, string> = {};
  for (const k of Object.keys(DEFAULT_FREIGHT_STAGE_LABELS)) {
    if (typeof labels[k] === "string" && labels[k].trim()) filtered[k] = labels[k].trim();
  }
  await db
    .insert(portalContentTable)
    .values({ key: FREIGHT_STAGE_LABELS_KEY, value: JSON.stringify(filtered), updatedAt: new Date() })
    .onConflictDoUpdate({ target: portalContentTable.key, set: { value: JSON.stringify(filtered), updatedAt: new Date() } });
  return res.json({ ok: true, labels: { ...DEFAULT_FREIGHT_STAGE_LABELS, ...filtered } });
});

// ── Document Templates ────────────────────────────────────────────────────────

const DOC_TEMPLATE_KEY = (type: string) => `doc_template:${type}`;

export const DOCUMENT_TYPES = [
  "invoice", "quotation", "po", "delivery_note", "packing_list",
  "mou", "kontrak", "nda", "sla",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  invoice:       "Invoice",
  quotation:     "Penawaran / Quotation",
  po:            "Purchase Order (PO)",
  delivery_note: "Surat Jalan (Delivery Note)",
  packing_list:  "Packing List",
  mou:           "MOU",
  kontrak:       "Kontrak",
  nda:           "NDA",
  sla:           "SLA",
};

export const DOCUMENT_BUSINESS_LINES = [
  "Logistic/Forwarder", "Export/Import", "PPJK", "Trading",
  "Sport Center", "POS", "Legal",
];

export interface DocumentTemplateConfig {
  documentType: string;
  businessLine: string;
  logoUrl: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  headerText: string;
  footerText: string;
  primaryColor: string;
  accentColor: string;
  fontSize: number;
  defaultTerms: string;
  defaultNotes: string;
  dueDays: number;
  showTax: boolean;
  showSignature: boolean;
  showStamp: boolean;
  templateFormat: "pdf" | "html";
  updatedAt: string;
}

const DEFAULT_DOC_TEMPLATE = (type: string): DocumentTemplateConfig => ({
  documentType: type,
  businessLine: "Logistic/Forwarder",
  logoUrl: "",
  companyName: "PT B2B Marketplace and Logistic",
  companyAddress: "Jl. Logistik No. 1, Jakarta",
  companyPhone: "+62 21 1234 5678",
  companyEmail: "info@b2bmarketplace.co.id",
  headerText: "",
  footerText: "Terima kasih atas kepercayaan Anda.",
  primaryColor: "#1e40af",
  accentColor: "#3b82f6",
  fontSize: 11,
  defaultTerms: type === "invoice"
    ? "Pembayaran dalam 14 hari kerja sejak tanggal invoice."
    : type === "quotation"
    ? "Penawaran berlaku 7 hari sejak tanggal dokumen."
    : "",
  defaultNotes: "",
  dueDays: type === "invoice" ? 14 : 7,
  showTax: true,
  showSignature: true,
  showStamp: false,
  templateFormat: "pdf",
  updatedAt: new Date().toISOString(),
});

// GET /api/settings/documents — list all document templates
router.get("/documents", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const keys = DOCUMENT_TYPES.map((t) => DOC_TEMPLATE_KEY(t));
    const rows = await db
      .select()
      .from(portalContentTable)
      .where(inArray(portalContentTable.key, [...keys]));
    const stored = new Map(rows.map((r) => [r.key, JSON.parse(r.value)]));
    const templates = DOCUMENT_TYPES.map((t) => ({
      ...DEFAULT_DOC_TEMPLATE(t),
      ...(stored.get(DOC_TEMPLATE_KEY(t)) ?? {}),
      documentType: t,
    }));
    return res.json(templates);
  } catch (err) {
    return res.status(500).json({ error: "Gagal memuat template" });
  }
});

// GET /api/settings/documents/:documentType — get one template
router.get("/documents/:documentType", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const documentType = String(req.params.documentType ?? "");
  if (!DOCUMENT_TYPES.includes(documentType as DocumentType)) {
    return res.status(400).json({ error: "document_type tidak valid" });
  }
  try {
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, DOC_TEMPLATE_KEY(documentType)));
    const stored = row ? JSON.parse(row.value) : {};
    return res.json({ ...DEFAULT_DOC_TEMPLATE(documentType), ...stored, documentType });
  } catch {
    return res.json(DEFAULT_DOC_TEMPLATE(documentType));
  }
});

// PATCH /api/settings/documents/:documentType — update template
router.patch("/documents/:documentType", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const documentType = String(req.params.documentType ?? "");
  if (!DOCUMENT_TYPES.includes(documentType as DocumentType)) {
    return res.status(400).json({ error: "document_type tidak valid" });
  }
  const allowed: (keyof DocumentTemplateConfig)[] = [
    "businessLine", "logoUrl", "companyName", "companyAddress",
    "companyPhone", "companyEmail", "headerText", "footerText",
    "primaryColor", "accentColor", "fontSize", "defaultTerms",
    "defaultNotes", "dueDays", "showTax", "showSignature", "showStamp",
    "templateFormat",
  ];
  const payload: Partial<DocumentTemplateConfig> = {};
  for (const k of allowed) {
    if (k in req.body) (payload as any)[k] = req.body[k];
  }
  try {
    const [existing] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, DOC_TEMPLATE_KEY(documentType)));
    const prev = existing ? JSON.parse(existing.value) : DEFAULT_DOC_TEMPLATE(documentType);
    const merged = { ...prev, ...payload, documentType, updatedAt: new Date().toISOString() };
    await db
      .insert(portalContentTable)
      .values({ key: DOC_TEMPLATE_KEY(documentType), value: JSON.stringify(merged), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: portalContentTable.key,
        set: { value: JSON.stringify(merged), updatedAt: new Date() },
      });
    return res.json({ ok: true, template: merged });
  } catch (err) {
    return res.status(500).json({ error: "Gagal menyimpan template" });
  }
});

// POST /api/settings/documents/:documentType/preview — generate HTML preview (dummy data)
router.post("/documents/:documentType/preview", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const documentType = String(req.params.documentType ?? "");
  if (!DOCUMENT_TYPES.includes(documentType as DocumentType)) {
    return res.status(400).json({ error: "document_type tidak valid" });
  }
  const body = req.body ?? {};
  const tpl: DocumentTemplateConfig = {
    ...DEFAULT_DOC_TEMPLATE(documentType),
    ...body,
    documentType,
  };

  // Canvas settings from request body
  const paperSize: string = body.paperSize ?? "A4";
  const orientation: string = body.orientation ?? "portrait";
  const margin: { top: number; right: number; bottom: number; left: number } =
    body.margin ?? { top: 15, right: 15, bottom: 15, left: 15 };
  const customVariables: { name: string; value: string; desc: string }[] =
    body.customVariables ?? [];

  // Paper dimensions in px (96dpi equivalent)
  const paperWidths: Record<string, number> = { A4: 794, Letter: 816, A5: 559 };
  const paperHeights: Record<string, number> = { A4: 1123, Letter: 1056, A5: 794 };
  const baseW = paperWidths[paperSize] ?? 794;
  const baseH = paperHeights[paperSize] ?? 1123;
  const docW = orientation === "landscape" ? baseH : baseW;

  // Build custom variable substitution map
  const customVarMap: Record<string, string> = {};
  for (const cv of customVariables) {
    if (cv.name) customVarMap[`{${cv.name}}`] = cv.value || `{${cv.name}}`;
  }

  const docLabel = DOCUMENT_TYPE_LABELS[documentType] ?? documentType.toUpperCase();
  const dummyRows = [
    { name: "Jasa Pengiriman Internasional", qty: 1, unit: "Shipment", unitPrice: 15000000, subtotal: 15000000 },
    { name: "Biaya Handling & Custom Clearance", qty: 2, unit: "Pax", unitPrice: 2500000, subtotal: 5000000 },
    { name: "Asuransi Kargo", qty: 1, unit: "Paket", unitPrice: 750000, subtotal: 750000 },
  ];
  const subtotal = dummyRows.reduce((s, r) => s + r.subtotal, 0);
  const tax = tpl.showTax ? Math.round(subtotal * 0.11) : 0;
  const grandTotal = subtotal + tax;
  const fmt = (n: number) => "Rp " + n.toLocaleString("id-ID");
  const today = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const dueDate = new Date(Date.now() + tpl.dueDays * 86400000).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  const tableRows = dummyRows.map(r => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${r.name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.qty} ${r.unit}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmt(r.unitPrice)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmt(r.subtotal)}</td>
    </tr>`).join("");

  const mmToPx = (mm: number) => Math.round(mm * 3.7795);
  const padTop    = mmToPx(margin.top);
  const padRight  = mmToPx(margin.right);
  const padBottom = mmToPx(margin.bottom);
  const padLeft   = mmToPx(margin.left);

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preview ${docLabel}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:${tpl.fontSize}pt;color:#1f2937;margin:0;padding:16px;background:#f3f4f6;}
  .doc{background:#fff;width:${docW}px;margin:0 auto;padding:${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;box-shadow:0 1px 8px rgba(0,0,0,.1);box-sizing:border-box;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${tpl.primaryColor};padding-bottom:20px;margin-bottom:24px;}
  .logo{max-height:64px;max-width:160px;}
  .doc-title{text-align:right;}
  .doc-title h1{margin:0;font-size:22pt;color:${tpl.primaryColor};letter-spacing:.5px;}
  .doc-title .num{color:${tpl.accentColor};font-size:12pt;font-weight:600;margin-top:4px;}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;}
  .meta-box h3{margin:0 0 6px;font-size:9pt;text-transform:uppercase;letter-spacing:.5px;color:${tpl.accentColor};}
  .meta-box p{margin:2px 0;font-size:${tpl.fontSize}pt;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  thead tr{background:${tpl.primaryColor};color:#fff;}
  thead th{padding:10px;text-align:left;font-size:10pt;}
  thead th:last-child,thead th:nth-child(3){text-align:right;}
  thead th:nth-child(2){text-align:center;}
  .totals{text-align:right;margin-bottom:24px;}
  .totals table{width:auto;margin-left:auto;}
  .totals td{padding:4px 12px;font-size:${tpl.fontSize}pt;}
  .totals .grand{font-weight:700;font-size:13pt;color:${tpl.primaryColor};border-top:2px solid ${tpl.primaryColor};}
  .terms{background:#f9fafb;border-left:4px solid ${tpl.accentColor};padding:12px 16px;border-radius:4px;margin-bottom:20px;font-size:10pt;color:#4b5563;}
  .footer{text-align:center;color:#9ca3af;font-size:9pt;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:24px;}
  .sig{display:flex;gap:48px;margin:24px 0;}
  .sig-box{text-align:center;flex:1;}
  .sig-box .line{border-bottom:1px solid #374151;margin-bottom:4px;height:48px;}
  .sig-box p{font-size:9pt;color:#6b7280;margin:0;}
  .badge{display:inline-block;background:${tpl.accentColor};color:#fff;padding:2px 10px;border-radius:12px;font-size:9pt;margin-top:4px;}
  .header-text{font-size:10pt;color:#6b7280;margin-bottom:8px;}
</style>
</head>
<body>
<div class="doc">
  <div class="header">
    <div>
      ${tpl.logoUrl ? `<img src="${tpl.logoUrl}" class="logo" alt="Logo"/>` : `<div style="font-size:18pt;font-weight:700;color:${tpl.primaryColor};">${tpl.companyName}</div>`}
      <p style="margin:6px 0 0;color:#6b7280;font-size:10pt;">${tpl.companyAddress}</p>
      <p style="margin:2px 0;color:#6b7280;font-size:10pt;">${tpl.companyPhone} · ${tpl.companyEmail}</p>
    </div>
    <div class="doc-title">
      <h1>${docLabel}</h1>
      <div class="num">No: ${documentType.toUpperCase()}/2026/000123</div>
      <div style="font-size:10pt;color:#6b7280;margin-top:4px;">Tanggal: ${today}</div>
      ${documentType === "invoice" || documentType === "quotation" ? `<div style="font-size:10pt;color:#6b7280;">Jatuh Tempo: ${dueDate}</div>` : ""}
      <div><span class="badge">PREVIEW</span></div>
    </div>
  </div>
  ${tpl.headerText ? `<div class="header-text">${tpl.headerText}</div>` : ""}
  <div class="meta">
    <div class="meta-box">
      <h3>Dari</h3>
      <p><strong>${tpl.companyName}</strong></p>
      <p>${tpl.companyAddress}</p>
      <p>${tpl.companyPhone}</p>
    </div>
    <div class="meta-box">
      <h3>Kepada</h3>
      <p><strong>PT Contoh Customer Indonesia</strong></p>
      <p>Jl. Pelanggan No. 42, Surabaya</p>
      <p>+62 31 9876 5432</p>
    </div>
  </div>
  ${["mou","kontrak","nda","sla"].includes(documentType) ? `
  <div style="background:#f0f4ff;border-radius:8px;padding:20px 24px;margin-bottom:20px;font-size:${tpl.fontSize}pt;line-height:1.7;color:#374151;">
    <p><strong>PASAL 1 — RUANG LINGKUP</strong></p>
    <p>Para Pihak sepakat untuk mengikatkan diri dalam perjanjian ini berdasarkan ketentuan dan syarat-syarat yang tercantum di bawah ini. (Konten contoh — akan diganti dengan isi dokumen nyata)</p>
    <p><strong>PASAL 2 — KEWAJIBAN PARA PIHAK</strong></p>
    <p>Masing-masing pihak berkewajiban untuk melaksanakan ketentuan yang telah disepakati dalam dokumen ini dengan itikad baik.</p>
  </div>` : `
  <table>
    <thead><tr>
      <th>Deskripsi</th><th style="text-align:center;">Qty / Satuan</th>
      <th style="text-align:right;">Harga Satuan</th><th style="text-align:right;">Subtotal</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="totals">
    <table>
      <tr><td>Subtotal</td><td style="text-align:right;">${fmt(subtotal)}</td></tr>
      ${tpl.showTax ? `<tr><td>PPN 11%</td><td style="text-align:right;">${fmt(tax)}</td></tr>` : ""}
      <tr class="grand"><td>TOTAL</td><td style="text-align:right;">${fmt(grandTotal)}</td></tr>
    </table>
  </div>`}
  ${tpl.defaultTerms ? `<div class="terms"><strong>Syarat & Ketentuan:</strong><br/>${tpl.defaultTerms}</div>` : ""}
  ${tpl.defaultNotes ? `<div style="margin-bottom:16px;font-size:10pt;color:#4b5563;"><strong>Catatan:</strong> ${tpl.defaultNotes}</div>` : ""}
  ${tpl.showSignature ? `
  <div class="sig">
    <div class="sig-box"><div class="line"></div><p>Dibuat oleh</p><p><strong>${tpl.companyName}</strong></p></div>
    <div class="sig-box"><div class="line"></div><p>Disetujui oleh</p><p><strong>PT Contoh Customer Indonesia</strong></p></div>
  </div>` : ""}
  <div class="footer">${tpl.footerText}</div>
</div>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

// --- app_config table bootstrap (inline migration) ---
db.execute(sql`
  CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    is_secret  BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(() => {});

// GET /api/settings/app-config — daftar konfigurasi DB (admin only)
router.get("/app-config", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await db.execute(sql`SELECT * FROM app_config ORDER BY key ASC`);
  return res.json(rows.rows);
});

// POST /api/settings/app-config — tambah entry baru
router.post("/app-config", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { key, value, description, is_secret } = req.body ?? {};
  if (!key || typeof key !== "string") return res.status(400).json({ message: "key wajib diisi" });
  if (typeof value !== "string") return res.status(400).json({ message: "value wajib diisi" });
  try {
    await db.execute(sql`
      INSERT INTO app_config (key, value, description, is_secret, updated_at)
      VALUES (${key.trim()}, ${value}, ${description ?? ""}, ${!!is_secret}, NOW())
    `);
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ message: "Key sudah ada" });
    throw err;
  }
});

// PUT /api/settings/app-config/:key — update entry
router.put("/app-config/:key", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const key = String(req.params.key ?? "");
  const { value, description, is_secret } = req.body ?? {};
  if (typeof value !== "string") return res.status(400).json({ message: "value wajib diisi" });
  await db.execute(sql`
    UPDATE app_config SET value=${value}, description=${description ?? ""}, is_secret=${!!is_secret}, updated_at=NOW()
    WHERE key=${key}
  `);
  invalidateAppConfig(key);
  return res.json({ ok: true });
});

// DELETE /api/settings/app-config/:key — hapus entry
router.delete("/app-config/:key", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  await db.execute(sql`DELETE FROM app_config WHERE key=${String(req.params.key)}`);
  invalidateAppConfig(String(req.params.key));
  return res.json({ ok: true });
});

// ── App Secrets (admin) ────────────────────────────────────────────────────

// GET /api/settings/secrets — list all secrets with masked values
router.get("/secrets", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const results = await Promise.all(
      SECRETS_CATALOG.map(async (def) => {
        const envValue = (
          process.env[def.envFallback]?.trim() ||
          def.envFallbackAlt?.map(k => process.env[k]?.trim()).find(v => !!v) ||
          ""
        );
        const dbValue = await (async () => {
          try {
            const [row] = await db
              .select()
              .from(portalContentTable)
              .where(eq(portalContentTable.key, def.key));
            return row?.value?.trim() ?? "";
          } catch {
            return "";
          }
        })();
        const effectiveValue = dbValue || envValue;
        return {
          key: def.key,
          label: def.label,
          description: def.description,
          group: def.group,
          sensitive: def.sensitive,
          hasDbValue: !!dbValue,
          hasEnvValue: !!envValue,
          maskedValue: def.sensitive ? maskSecret(effectiveValue) : effectiveValue,
        };
      })
    );
    return res.json(results);
  } catch (err) {
    req.log?.error({ err }, "secrets list error");
    return res.status(500).json({ message: "Gagal memuat secrets" });
  }
});

// PUT /api/settings/secrets/:key — update a secret value
router.put("/secrets/:key", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { key } = req.params as { key: string };
  const { value } = req.body as { value?: string };
  if (typeof value !== "string") {
    return res.status(400).json({ message: "value harus berupa string" });
  }
  const def = SECRETS_CATALOG.find((d) => d.key === key);
  if (!def) {
    return res.status(400).json({ message: `Key '${key}' tidak dikenal` });
  }
  await setSetting(key, value);
  invalidateSettingCache(key);
  return res.json({ ok: true, key });
});

// DELETE /api/settings/secrets/:key — remove DB override (fall back to env)
router.delete("/secrets/:key", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { key } = req.params as { key: string };
  const def = SECRETS_CATALOG.find((d) => d.key === key);
  if (!def) {
    return res.status(400).json({ message: `Key '${key}' tidak dikenal` });
  }
  try {
    await db.delete(portalContentTable).where(eq(portalContentTable.key, key));
    invalidateSettingCache(key);
  } catch { /* ignore */ }
  return res.json({ ok: true, key });
});

// POST /api/settings/secrets/test-whatsapp — send test WA message
router.post("/secrets/test-whatsapp", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { target } = req.body as { target?: string };
  if (!target?.trim()) {
    return res.status(400).json({ message: "target (nomor WA) diperlukan" });
  }
  try {
    const token = await getSetting("fonnte_token", process.env.FONNTE_TOKEN ?? "");
    if (!token) return res.status(400).json({ message: "FONNTE_TOKEN belum dikonfigurasi" });
    const res2 = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ target: target.trim(), message: "✅ Test pesan dari BizPortal — konfigurasi WhatsApp berhasil!" }).toString(),
    });
    const body = await res2.json() as Record<string, unknown>;
    if (!res2.ok || body.status === false) {
      return res.status(400).json({ message: `Fonnte error: ${JSON.stringify(body)}` });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: String(err) });
  }
});

// POST /api/settings/secrets/test-email — send test email
router.post("/secrets/test-email", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { to } = req.body as { to?: string };
  if (!to?.trim()) {
    return res.status(400).json({ message: "to (email tujuan) diperlukan" });
  }
  try {
    const { sendMail } = await import("../lib/mailer.js");
    await sendMail({
      to: to.trim(),
      subject: "✅ Test Email dari BizPortal",
      html: "<p>Konfigurasi email berhasil! Pesan ini dikirim dari BizPortal.</p>",
      text: "Konfigurasi email berhasil! Pesan ini dikirim dari BizPortal.",
      context: "test-email",
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: String(err) });
  }
});

// GET /api/settings/company-pickup-address — public (dipakai customer portal untuk auto-fill alamat pickup)
router.get("/company-pickup-address", async (_req: Request, res: Response) => {
  try {
    const key = DOC_TEMPLATE_KEY("quotation");
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, key));
    const tpl = row ? { ...DEFAULT_DOC_TEMPLATE("quotation"), ...(JSON.parse(row.value) as Partial<DocumentTemplateConfig>) } : DEFAULT_DOC_TEMPLATE("quotation");
    return res.json({
      companyName:    tpl.companyName,
      companyAddress: tpl.companyAddress,
      companyPhone:   tpl.companyPhone,
      originCity:     "Jakarta",
      originAirport:  "CGK",
      originPort:     "Tanjung Priok, Jakarta",
    });
  } catch {
    const d = DEFAULT_DOC_TEMPLATE("quotation");
    return res.json({
      companyName: d.companyName, companyAddress: d.companyAddress, companyPhone: d.companyPhone,
      originCity: "Jakarta", originAirport: "CGK", originPort: "Tanjung Priok, Jakarta",
    });
  }
});

// ── Bank Transfer Info ────────────────────────────────────────────────────────
const BANK_TRANSFER_KEY = "bank_transfer_info";
const DEFAULT_BANK_INFO = {
  bankName: "BCA",
  accountNumber: "123-456-7890",
  accountName: "PT B2B Marketplace and Logistic",
  branch: "Jakarta Pusat",
  notes: "Cantumkan nomor pesanan sebagai keterangan transfer.",
};

// GET /api/settings/bank-transfer-info — public (dipakai customer portal step pembayaran)
router.get("/bank-transfer-info", async (_req: Request, res: Response) => {
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, BANK_TRANSFER_KEY));
    const info = row ? { ...DEFAULT_BANK_INFO, ...(JSON.parse(row.value) as Partial<typeof DEFAULT_BANK_INFO>) } : DEFAULT_BANK_INFO;
    return res.json(info);
  } catch {
    return res.json(DEFAULT_BANK_INFO);
  }
});

// PUT /api/settings/bank-transfer-info — admin only
router.put("/bank-transfer-info", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const { bankName, accountNumber, accountName, branch, notes } = req.body as Record<string, string>;
    const value = JSON.stringify({ bankName: bankName?.trim(), accountNumber: accountNumber?.trim(), accountName: accountName?.trim(), branch: branch?.trim(), notes: notes?.trim() });
    await db.execute(sql`
      INSERT INTO portal_content (key, value) VALUES (${BANK_TRANSFER_KEY}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: String(err) });
  }
});

// GET /api/settings/quick-stats — ringkasan jumlah item utama ERP (admin)
router.get("/quick-stats", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const companyId = await resolveCompanyId(req);
    const [[orders], [salesOrders], [customers], [vendors], [shipments], [staff]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(logisticOrdersTable).where(eq(logisticOrdersTable.companyId, companyId)),
      db.select({ count: sql<number>`count(*)::int` }).from(salesDocumentsTable).where(and(eq(salesDocumentsTable.companyId, companyId), eq(salesDocumentsTable.kind, "order"))),
      db.select({ count: sql<number>`count(*)::int` }).from(customersTable).where(eq(customersTable.companyId, companyId)),
      db.select({ count: sql<number>`count(*)::int` }).from(suppliersTable).where(eq(suppliersTable.companyId, companyId)),
      db.select({ count: sql<number>`count(*)::int` }).from(freightShipmentsTable).where(eq(freightShipmentsTable.companyId, companyId)),
      db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.companyId, companyId)),
    ]);
    return res.json({
      logisticOrders: orders?.count ?? 0,
      salesOrders:    salesOrders?.count ?? 0,
      customers:      customers?.count ?? 0,
      vendors:        vendors?.count ?? 0,
      shipments:      shipments?.count ?? 0,
      staff:          staff?.count ?? 0,
    });
  } catch (err) {
    return res.status(500).json({ message: String(err) });
  }
});

// ── Vehicle Order ─────────────────────────────────────────────────────────────

// GET /api/settings/vehicle-order — public, returns string[] of vehicleIds
router.get("/vehicle-order", async (_req: Request, res: Response) => {
  const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, VEHICLE_ORDER_KEY));
  return res.json(row ? JSON.parse(row.value) : []);
});

// PUT /api/settings/vehicle-order — admin only, save ordered array
router.put("/vehicle-order", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const order = Array.isArray(req.body) ? req.body : [];
  await db.insert(portalContentTable)
    .values({ key: VEHICLE_ORDER_KEY, value: JSON.stringify(order) })
    .onConflictDoUpdate({ target: portalContentTable.key, set: { value: JSON.stringify(order), updatedAt: new Date() } });
  return res.json({ ok: true });
});

// ── Vehicle Images ────────────────────────────────────────────────────────────

// GET /api/settings/vehicle-images — public, returns { vehicleId: imageUrl }
router.get("/vehicle-images", async (_req: Request, res: Response) => {
  const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, VEHICLE_IMAGES_KEY));
  return res.json(row ? JSON.parse(row.value) : {});
});

// PUT /api/settings/vehicle-images — admin only, save full map
router.put("/vehicle-images", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const images = req.body ?? {};
  await db.insert(portalContentTable)
    .values({ key: VEHICLE_IMAGES_KEY, value: JSON.stringify(images) })
    .onConflictDoUpdate({ target: portalContentTable.key, set: { value: JSON.stringify(images), updatedAt: new Date() } });
  return res.json({ ok: true });
});

// POST /api/settings/vehicle-images/upload — admin only, upload single image
router.post("/vehicle-images/upload", _upload.single("file"), async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  if (!req.file) return res.status(400).json({ error: "Tidak ada file" });
  const mime = req.file.mimetype;
  if (!mime.startsWith("image/")) return res.status(400).json({ error: "Hanya file gambar yang diizinkan" });
  try {
    const { publicUrl } = await uploadToSupabase(req.file.buffer, mime, "vehicle-images");
    return res.json({ url: publicUrl });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/settings/secrets/:key — single secret (untuk halaman WA Gateway settings)
router.get("/secrets/:key", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { key } = req.params as { key: string };
  const def = SECRETS_CATALOG.find((d) => d.key === key);
  if (!def) return res.status(404).json({ message: `Key '${key}' tidak dikenal` });
  try {
    const envValue = (
      process.env[def.envFallback]?.trim() ||
      def.envFallbackAlt?.map(k => process.env[k]?.trim()).find(v => !!v) ||
      ""
    );
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, key));
    const dbValue = row?.value?.trim() ?? "";
    const effectiveValue = dbValue || envValue;
    return res.json({
      key,
      hasValue: !!effectiveValue,
      maskedValue: def.sensitive ? maskSecret(effectiveValue) : effectiveValue,
      source: dbValue ? "db" : envValue ? "env" : "",
    });
  } catch (err) {
    return res.status(500).json({ message: String(err) });
  }
});

export default router;
