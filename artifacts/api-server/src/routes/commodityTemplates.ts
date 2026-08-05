import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser, requireAdmin } from "../lib/requireAdmin.js";
import type { Request, Response } from "express";

export const commodityTemplatesRouter = Router();

/* ─── Auth wall ─── */
commodityTemplatesRouter.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

/* ─── Row mappers ─── */
function toTemplate(row: Record<string, unknown>) {
  return {
    id: Number(row["id"]),
    key: String(row["key"]),
    name: String(row["name"]),
    icon: row["icon"] != null ? String(row["icon"]) : null,
    description: row["description"] != null ? String(row["description"]) : null,
    sortOrder: Number(row["sort_order"] ?? 0),
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
    fieldCount: row["field_count"] != null ? Number(row["field_count"]) : undefined,
    docCount: row["doc_count"] != null ? Number(row["doc_count"]) : undefined,
    checklistCount: row["checklist_count"] != null ? Number(row["checklist_count"]) : undefined,
  };
}
function toField(row: Record<string, unknown>) {
  return {
    id: Number(row["id"]),
    templateId: Number(row["template_id"]),
    fieldKey: String(row["field_key"]),
    label: String(row["label"]),
    fieldType: String(row["field_type"]),
    unit: row["unit"] != null ? String(row["unit"]) : null,
    required: Boolean(row["required"]),
    options: row["options"] != null ? (row["options"] as string[]) : null,
    sortOrder: Number(row["sort_order"] ?? 0),
  };
}
function toDoc(row: Record<string, unknown>) {
  return {
    id: Number(row["id"]),
    templateId: Number(row["template_id"]),
    docName: String(row["doc_name"]),
    description: row["description"] != null ? String(row["description"]) : null,
    required: Boolean(row["required"]),
    sortOrder: Number(row["sort_order"] ?? 0),
  };
}
function toChecklist(row: Record<string, unknown>) {
  return {
    id: Number(row["id"]),
    templateId: Number(row["template_id"]),
    item: String(row["item"]),
    category: row["category"] != null ? String(row["category"]) : null,
    sortOrder: Number(row["sort_order"] ?? 0),
  };
}

function str(v: unknown): string | undefined {
  return v != null && v !== "" ? String(v) : undefined;
}
function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}
function numId(s: string | undefined): number | null {
  const n = Number(s);
  return isNaN(n) ? null : n;
}

const FIELD_TYPES = new Set(["text", "number", "select", "date", "boolean", "textarea"]);

/* ─────────────── LIST ─────────────── */

commodityTemplatesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT t.*,
        COUNT(DISTINCT f.id) AS field_count,
        COUNT(DISTINCT d.id) AS doc_count,
        COUNT(DISTINCT c.id) AS checklist_count
      FROM commodity_templates t
      LEFT JOIN commodity_template_fields f ON f.template_id = t.id
      LEFT JOIN commodity_required_docs   d ON d.template_id = t.id
      LEFT JOIN commodity_checklists      c ON c.template_id = t.id
      GROUP BY t.id
      ORDER BY t.sort_order ASC, t.name ASC
    `);
    return res.json((result.rows as Record<string, unknown>[]).map(toTemplate));
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengambil template", error: String(err) });
  }
});

/* ─────────────── GET DETAIL ─────────────── */

commodityTemplatesRouter.get("/:id", async (req: Request, res: Response) => {
  const id = numId(req.params["id"] as string);
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  try {
    const tplRes = await db.execute(sql`
      SELECT t.*,
        COUNT(DISTINCT f.id) AS field_count,
        COUNT(DISTINCT d.id) AS doc_count,
        COUNT(DISTINCT c.id) AS checklist_count
      FROM commodity_templates t
      LEFT JOIN commodity_template_fields f ON f.template_id = t.id
      LEFT JOIN commodity_required_docs   d ON d.template_id = t.id
      LEFT JOIN commodity_checklists      c ON c.template_id = t.id
      WHERE t.id = ${id}
      GROUP BY t.id
    `);
    if (!tplRes.rows.length) return res.status(404).json({ message: "Template tidak ditemukan" });

    const [fieldsRes, docsRes, clRes] = await Promise.all([
      db.execute(sql`SELECT * FROM commodity_template_fields WHERE template_id = ${id} ORDER BY sort_order`),
      db.execute(sql`SELECT * FROM commodity_required_docs   WHERE template_id = ${id} ORDER BY sort_order`),
      db.execute(sql`SELECT * FROM commodity_checklists      WHERE template_id = ${id} ORDER BY sort_order`),
    ]);

    return res.json({
      ...toTemplate(tplRes.rows[0] as Record<string, unknown>),
      fields: (fieldsRes.rows as Record<string, unknown>[]).map(toField),
      requiredDocs: (docsRes.rows as Record<string, unknown>[]).map(toDoc),
      checklists: (clRes.rows as Record<string, unknown>[]).map(toChecklist),
    });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengambil detail", error: String(err) });
  }
});

/* ─────────────── CREATE TEMPLATE ─────────────── */

commodityTemplatesRouter.post("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { key, name, icon, description, sortOrder } = req.body as Record<string, unknown>;
  if (!str(key) || !str(name)) return res.status(400).json({ message: "key dan name wajib diisi" });
  if (!/^[a-z0-9_]+$/.test(String(key))) return res.status(400).json({ message: "key hanya boleh huruf kecil, angka, underscore" });

  try {
    const result = await db.execute(sql`
      INSERT INTO commodity_templates (key, name, icon, description, sort_order)
      VALUES (${String(key)}, ${String(name)}, ${str(icon) ?? null}, ${str(description) ?? null}, ${Number(sortOrder) || 0})
      RETURNING *
    `);
    return res.status(201).json(toTemplate(result.rows[0] as Record<string, unknown>));
  } catch (err: unknown) {
    if (String(err).includes("unique")) return res.status(409).json({ message: `Key '${key}' sudah digunakan` });
    return res.status(500).json({ message: "Gagal membuat template", error: String(err) });
  }
});

/* ─────────────── UPDATE TEMPLATE ─────────────── */

commodityTemplatesRouter.put("/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = numId(req.params["id"] as string);
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  const { name, icon, description, sortOrder } = req.body as Record<string, unknown>;
  try {
    const result = await db.execute(sql`
      UPDATE commodity_templates SET
        name        = COALESCE(${str(name) ?? null}, name),
        icon        = COALESCE(${str(icon) ?? null}, icon),
        description = CASE WHEN ${description !== undefined} THEN ${str(description) ?? null} ELSE description END,
        sort_order  = COALESCE(${sortOrder != null ? Number(sortOrder) : null}, sort_order),
        updated_at  = NOW()
      WHERE id = ${id} RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ message: "Template tidak ditemukan" });
    return res.json(toTemplate(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    return res.status(500).json({ message: "Gagal update template", error: String(err) });
  }
});

/* ─────────────── DELETE TEMPLATE ─────────────── */

commodityTemplatesRouter.delete("/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = numId(req.params["id"] as string);
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  try {
    const result = await db.execute(sql`DELETE FROM commodity_templates WHERE id = ${id} RETURNING id`);
    if (!result.rows.length) return res.status(404).json({ message: "Template tidak ditemukan" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal hapus template", error: String(err) });
  }
});

/* ─────────────── FIELDS ─────────────── */

commodityTemplatesRouter.post("/:id/fields", async (req: Request, res: Response) => {
  const id = numId(req.params["id"] as string);
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  const { fieldKey, label, fieldType, unit, required, options, sortOrder } = req.body as Record<string, unknown>;
  if (!str(fieldKey) || !str(label)) return res.status(400).json({ message: "fieldKey dan label wajib" });
  if (!/^[a-z0-9_]+$/.test(String(fieldKey))) return res.status(400).json({ message: "fieldKey hanya huruf kecil, angka, underscore" });
  const ft = str(fieldType) ?? "text";
  if (!FIELD_TYPES.has(ft)) return res.status(400).json({ message: `fieldType tidak valid: ${ft}` });

  const opts = Array.isArray(options) ? JSON.stringify(options) : null;
  try {
    const result = await db.execute(sql`
      INSERT INTO commodity_template_fields (template_id, field_key, label, field_type, unit, required, options, sort_order)
      VALUES (${id}, ${String(fieldKey)}, ${String(label)}, ${ft}, ${str(unit) ?? null}, ${bool(required, false)}, ${opts}, ${Number(sortOrder) || 0})
      RETURNING *
    `);
    return res.status(201).json(toField(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    return res.status(500).json({ message: "Gagal tambah field", error: String(err) });
  }
});

commodityTemplatesRouter.put("/fields/:fieldId", async (req: Request, res: Response) => {
  const fieldId = numId(req.params["fieldId"] as string);
  if (!fieldId) return res.status(400).json({ message: "ID tidak valid" });

  const { label, fieldType, unit, required, options, sortOrder } = req.body as Record<string, unknown>;
  const ft = str(fieldType);
  if (ft && !FIELD_TYPES.has(ft)) return res.status(400).json({ message: `fieldType tidak valid: ${ft}` });
  const opts = Array.isArray(options) ? JSON.stringify(options) : options === null ? null : undefined;

  try {
    const result = await db.execute(sql`
      UPDATE commodity_template_fields SET
        label      = COALESCE(${str(label) ?? null}, label),
        field_type = COALESCE(${ft ?? null}, field_type),
        unit       = CASE WHEN ${unit !== undefined} THEN ${str(unit) ?? null} ELSE unit END,
        required   = COALESCE(${required != null ? bool(required, false) : null}, required),
        options    = CASE WHEN ${opts !== undefined} THEN ${opts ?? null} ELSE options END,
        sort_order = COALESCE(${sortOrder != null ? Number(sortOrder) : null}, sort_order)
      WHERE id = ${fieldId} RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ message: "Field tidak ditemukan" });
    return res.json(toField(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    return res.status(500).json({ message: "Gagal update field", error: String(err) });
  }
});

commodityTemplatesRouter.delete("/fields/:fieldId", async (req: Request, res: Response) => {
  const fieldId = numId(req.params["fieldId"] as string);
  if (!fieldId) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.execute(sql`DELETE FROM commodity_template_fields WHERE id = ${fieldId}`);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal hapus field", error: String(err) });
  }
});

/* ─────────────── REQUIRED DOCS ─────────────── */

commodityTemplatesRouter.post("/:id/docs", async (req: Request, res: Response) => {
  const id = numId(req.params["id"] as string);
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  const { docName, description, required, sortOrder } = req.body as Record<string, unknown>;
  if (!str(docName)) return res.status(400).json({ message: "docName wajib diisi" });

  try {
    const result = await db.execute(sql`
      INSERT INTO commodity_required_docs (template_id, doc_name, description, required, sort_order)
      VALUES (${id}, ${String(docName)}, ${str(description) ?? null}, ${bool(required, true)}, ${Number(sortOrder) || 0})
      RETURNING *
    `);
    return res.status(201).json(toDoc(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    return res.status(500).json({ message: "Gagal tambah dokumen wajib", error: String(err) });
  }
});

commodityTemplatesRouter.put("/docs/:docId", async (req: Request, res: Response) => {
  const docId = numId(req.params["docId"] as string);
  if (!docId) return res.status(400).json({ message: "ID tidak valid" });

  const { docName, description, required, sortOrder } = req.body as Record<string, unknown>;
  try {
    const result = await db.execute(sql`
      UPDATE commodity_required_docs SET
        doc_name    = COALESCE(${str(docName) ?? null}, doc_name),
        description = CASE WHEN ${description !== undefined} THEN ${str(description) ?? null} ELSE description END,
        required    = COALESCE(${required != null ? bool(required, true) : null}, required),
        sort_order  = COALESCE(${sortOrder != null ? Number(sortOrder) : null}, sort_order)
      WHERE id = ${docId} RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ message: "Dokumen tidak ditemukan" });
    return res.json(toDoc(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    return res.status(500).json({ message: "Gagal update dokumen", error: String(err) });
  }
});

commodityTemplatesRouter.delete("/docs/:docId", async (req: Request, res: Response) => {
  const docId = numId(req.params["docId"] as string);
  if (!docId) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.execute(sql`DELETE FROM commodity_required_docs WHERE id = ${docId}`);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal hapus dokumen", error: String(err) });
  }
});

/* ─────────────── CHECKLISTS ─────────────── */

commodityTemplatesRouter.post("/:id/checklists", async (req: Request, res: Response) => {
  const id = numId(req.params["id"] as string);
  if (!id) return res.status(400).json({ message: "ID tidak valid" });

  const { item, category, sortOrder } = req.body as Record<string, unknown>;
  if (!str(item)) return res.status(400).json({ message: "item wajib diisi" });

  try {
    const result = await db.execute(sql`
      INSERT INTO commodity_checklists (template_id, item, category, sort_order)
      VALUES (${id}, ${String(item)}, ${str(category) ?? null}, ${Number(sortOrder) || 0})
      RETURNING *
    `);
    return res.status(201).json(toChecklist(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    return res.status(500).json({ message: "Gagal tambah checklist", error: String(err) });
  }
});

commodityTemplatesRouter.put("/checklists/:itemId", async (req: Request, res: Response) => {
  const itemId = numId(String(req.params["itemId"] ?? ""));
  if (!itemId) return res.status(400).json({ message: "ID tidak valid" });

  const { item, category, sortOrder } = req.body as Record<string, unknown>;
  try {
    const result = await db.execute(sql`
      UPDATE commodity_checklists SET
        item       = COALESCE(${str(item) ?? null}, item),
        category   = CASE WHEN ${category !== undefined} THEN ${str(category) ?? null} ELSE category END,
        sort_order = COALESCE(${sortOrder != null ? Number(sortOrder) : null}, sort_order)
      WHERE id = ${itemId} RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ message: "Item tidak ditemukan" });
    return res.json(toChecklist(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    return res.status(500).json({ message: "Gagal update checklist", error: String(err) });
  }
});

commodityTemplatesRouter.delete("/checklists/:itemId", async (req: Request, res: Response) => {
  const itemId = numId(String(req.params["itemId"] ?? ""));
  if (!itemId) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.execute(sql`DELETE FROM commodity_checklists WHERE id = ${itemId}`);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal hapus checklist", error: String(err) });
  }
});
