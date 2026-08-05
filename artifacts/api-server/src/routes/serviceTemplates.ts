import { Router } from "express";
import { db } from "@workspace/db";
import { serviceTemplatesTable } from "@workspace/db/schema";
import { eq, sql, or, isNull, and } from "drizzle-orm";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import {
  resolveServiceTemplate,
  resolveAllServiceTemplates,
  getAllInCodeServiceTemplates,
  hasInCodeServiceTemplate,
} from "@workspace/service-templates";
import type {
  ServiceTemplateOverride,
  ServiceTemplateField,
  ServiceTemplateDocument,
  ServiceTemplateChecklist,
  ServiceConditionalRule,
  ServiceValidationRule,
} from "@workspace/service-templates";
import { requireAdmin } from "../lib/requireAdmin.js";
import type { Request, Response } from "express";

export const serviceTemplatesRouter = Router();

/* ─── Bootstrap: version history table ───────────────────────────────────── */

db.execute(sql`
  CREATE TABLE IF NOT EXISTS service_template_version_history (
    id            SERIAL PRIMARY KEY,
    service_type  TEXT NOT NULL,
    version       TEXT NOT NULL,
    label         TEXT,
    fields        JSONB NOT NULL DEFAULT '[]',
    required_docs JSONB NOT NULL DEFAULT '[]',
    checklist     JSONB NOT NULL DEFAULT '[]',
    change_note   TEXT,
    changed_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(() => {});

/* ─── Constants ─────────────────────────────────────────────────────────── */

const SERVICE_TYPE_RE = /^[a-z0-9_]+$/;
const VALID_SECTIONS  = new Set(["quotation", "operational", "both"]);
const VALID_FIELD_TYPES = new Set(["text", "number", "select", "textarea", "date"]);

/* ─── Helpers ────────────────────────────────────────────────────────────── */

type DbRow = typeof serviceTemplatesTable.$inferSelect;

function rowToOverride(row: DbRow): ServiceTemplateOverride {
  return {
    serviceType:       row.serviceType,
    label:             row.label,
    emoji:             row.emoji,
    version:           row.version,
    isActive:          row.isActive,
    fields:            (row.fields            as ServiceTemplateOverride["fields"])            ?? null,
    requiredDocuments: (row.requiredDocuments  as ServiceTemplateOverride["requiredDocuments"]) ?? null,
    checklist:         (row.checklist          as ServiceTemplateOverride["checklist"])          ?? null,
    conditionalRules:  (row.conditionalRules   as ServiceTemplateOverride["conditionalRules"])   ?? null,
    validationRules:   (row.validationRules    as ServiceTemplateOverride["validationRules"])    ?? null,
  };
}

function bumpMinor(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return "1.1.0";
  const major = parseInt(parts[0]!, 10) || 1;
  const minor = (parseInt(parts[1]!, 10) || 0) + 1;
  return `${major}.${minor}.0`;
}

function structureChanged(
  oldRow: DbRow,
  newFields: ServiceTemplateField[] | null | undefined,
  newDocs:   ServiceTemplateDocument[] | null | undefined,
  newCl:     ServiceTemplateChecklist[] | null | undefined,
): boolean {
  const s = (v: unknown) => JSON.stringify(v ?? []);
  return (
    s(oldRow.fields)            !== s(newFields) ||
    s(oldRow.requiredDocuments) !== s(newDocs)   ||
    s(oldRow.checklist)         !== s(newCl)
  );
}

async function writeVersionSnapshot(
  row: DbRow,
  opts?: { changeNote?: string; changedBy?: string },
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO service_template_version_history
        (service_type, version, label, fields, required_docs, checklist, change_note, changed_by)
      VALUES (
        ${row.serviceType},
        ${row.version},
        ${row.label},
        ${JSON.stringify(row.fields ?? [])}::jsonb,
        ${JSON.stringify(row.requiredDocuments ?? [])}::jsonb,
        ${JSON.stringify(row.checklist ?? [])}::jsonb,
        ${opts?.changeNote ?? null},
        ${opts?.changedBy ?? null}
      )
    `);
  } catch { }
}

/* ─── Field-level validation ─────────────────────────────────────────────── */

type VResult = { ok: true } | { ok: false; error: string };

function validateFields(fields: unknown): VResult {
  if (!Array.isArray(fields)) return { ok: false, error: "fields harus berupa array" };
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] as Record<string, unknown>;
    if (!f || typeof f !== "object") return { ok: false, error: `fields[${i}] bukan object` };
    if (!f["key"] || typeof f["key"] !== "string")   return { ok: false, error: `fields[${i}].key wajib diisi` };
    if (!f["label"] || typeof f["label"] !== "string") return { ok: false, error: `fields[${i}].label wajib diisi` };
    if (!f["type"] || !VALID_FIELD_TYPES.has(String(f["type"]))) {
      return { ok: false, error: `fields[${i}].type tidak valid (${f["type"]}). Harus salah satu dari: ${[...VALID_FIELD_TYPES].join(", ")}` };
    }
    if (!f["section"] || !VALID_SECTIONS.has(String(f["section"]))) {
      return { ok: false, error: `fields[${i}].section tidak valid (${f["section"]}). Harus salah satu dari: quotation, operational, both` };
    }
    if (f["isUpload"] !== undefined && typeof f["isUpload"] !== "boolean") {
      return { ok: false, error: `fields[${i}].isUpload harus boolean` };
    }
  }
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC READ ENDPOINTS
═══════════════════════════════════════════════════════════════════════════ */

serviceTemplatesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const companyId = resolveCompanyId(req);
    const dbRows = await db
      .select()
      .from(serviceTemplatesTable)
      .where(or(eq(serviceTemplatesTable.companyId, companyId), isNull(serviceTemplatesTable.companyId)))
      .orderBy(serviceTemplatesTable.sortOrder);

    const globalRows  = dbRows.filter((r) => r.companyId === null);
    const companyRows = dbRows.filter((r) => r.companyId !== null);
    const mergedMap   = new Map(globalRows.map((r) => [r.serviceType, r]));
    for (const r of companyRows) mergedMap.set(r.serviceType, r);
    const effectiveRows = [...mergedMap.values()];

    let templates: Array<ReturnType<typeof resolveServiceTemplate> & { source: "db" | "in-code" }>;
    let source: "db" | "in-code";

    if (effectiveRows.length > 0) {
      const overrides   = effectiveRows.map(rowToOverride);
      const overrideMap = new Map(overrides.map((o) => [o.serviceType, o]));
      templates = resolveAllServiceTemplates(overrides).map((tpl) => ({
        ...tpl,
        source: overrideMap.has(tpl.serviceType) ? ("db" as const) : ("in-code" as const),
      }));
      source = "db";
    } else {
      templates = getAllInCodeServiceTemplates().map((tpl) => ({
        ...tpl,
        source: "in-code" as const,
      }));
      source = "in-code";
    }

    return res.json({ count: templates.length, source, templates });
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil service templates", detail: String(err) });
  }
});

/* GET /api/service-templates/:serviceType/version-history */
serviceTemplatesRouter.get("/:serviceType/version-history", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const serviceType = String(req.params["serviceType"] ?? "").trim();
  if (!serviceType) return res.status(400).json({ error: "serviceType wajib diisi" });

  try {
    const rows = await db.execute(sql`
      SELECT id, service_type, version, label,
             fields, required_docs, checklist,
             change_note, changed_by, created_at
      FROM service_template_version_history
      WHERE service_type = ${serviceType}
      ORDER BY created_at ASC
    `);
    return res.json({ serviceType, history: rows.rows });
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil version history", detail: String(err) });
  }
});

serviceTemplatesRouter.get("/:serviceType", async (req: Request, res: Response) => {
  const serviceType = String(req.params["serviceType"] ?? "").trim();
  if (!serviceType) return res.status(400).json({ error: "serviceType wajib diisi" });

  try {
    const companyId = resolveCompanyId(req);
    const rows = await db
      .select()
      .from(serviceTemplatesTable)
      .where(and(
        eq(serviceTemplatesTable.serviceType, serviceType),
        or(eq(serviceTemplatesTable.companyId, companyId), isNull(serviceTemplatesTable.companyId)),
      ));

    const companyRow = rows.find((r) => r.companyId !== null);
    const globalRow  = rows.find((r) => r.companyId === null);
    const bestRow    = companyRow ?? globalRow ?? null;

    const dbOverride   = bestRow ? rowToOverride(bestRow) : null;
    const inCodeExists = hasInCodeServiceTemplate(serviceType);
    const source: "db" | "in-code" | "fallback" = dbOverride ? "db" : inCodeExists ? "in-code" : "fallback";
    const resolved = resolveServiceTemplate(serviceType, dbOverride);

    return res.json({ ...resolved, source });
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil service template", detail: String(err) });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN WRITE ENDPOINTS
═══════════════════════════════════════════════════════════════════════════ */

serviceTemplatesRouter.post("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const body        = req.body as Record<string, unknown>;
  const serviceType = String(body["serviceType"] ?? "").trim().toLowerCase();
  const label       = String(body["label"] ?? "").trim();

  if (!serviceType) return res.status(400).json({ error: "serviceType wajib diisi" });
  if (!SERVICE_TYPE_RE.test(serviceType)) {
    return res.status(400).json({ error: "serviceType hanya boleh huruf kecil a-z, angka 0-9, dan underscore (_)" });
  }
  if (!label) return res.status(400).json({ error: "label wajib diisi" });

  const fields            = (body["fields"]            ?? []) as ServiceTemplateField[];
  const requiredDocuments = (body["requiredDocuments"]  ?? []) as ServiceTemplateDocument[];
  const checklist         = (body["checklist"]          ?? []) as ServiceTemplateChecklist[];
  const conditionalRules  = (body["conditionalRules"]   ?? []) as ServiceConditionalRule[];
  const validationRules   = (body["validationRules"]    ?? []) as ServiceValidationRule[];

  const fieldCheck = validateFields(fields);
  if (!fieldCheck.ok) return res.status(400).json({ error: fieldCheck.error });

  const emoji       = String(body["emoji"]       ?? "📋").trim() || "📋";
  const version     = String(body["version"]     ?? "1.0.0").trim() || "1.0.0";
  const isActive    = body["isActive"] !== false;
  const description = body["description"] != null ? String(body["description"]).trim() : null;
  const sortOrder   = body["sortOrder"]  != null ? Number(body["sortOrder"]) : 0;

  const companyId = resolveCompanyId(req);
  try {
    const existing = await db
      .select({ id: serviceTemplatesTable.id })
      .from(serviceTemplatesTable)
      .where(and(
        eq(serviceTemplatesTable.serviceType, serviceType),
        eq(serviceTemplatesTable.companyId, companyId),
      ))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: `serviceType '${serviceType}' sudah ada untuk perusahaan ini` });
    }

    const inserted = await db
      .insert(serviceTemplatesTable)
      .values({
        companyId,
        serviceType,
        label,
        emoji,
        version,
        isActive,
        description,
        sortOrder,
        fields:            fields            as unknown as typeof serviceTemplatesTable.$inferInsert["fields"],
        requiredDocuments: requiredDocuments as unknown as typeof serviceTemplatesTable.$inferInsert["requiredDocuments"],
        checklist:         checklist         as unknown as typeof serviceTemplatesTable.$inferInsert["checklist"],
        conditionalRules:  conditionalRules  as unknown as typeof serviceTemplatesTable.$inferInsert["conditionalRules"],
        validationRules:   validationRules   as unknown as typeof serviceTemplatesTable.$inferInsert["validationRules"],
      })
      .returning();

    await writeVersionSnapshot(inserted[0]!, { changeNote: "Template dibuat" });

    return res.status(201).json({ ...rowToOverride(inserted[0]!), source: "db" });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: `serviceType '${serviceType}' sudah ada` });
    }
    return res.status(500).json({ error: "Gagal membuat service template", detail: msg });
  }
});

serviceTemplatesRouter.put("/:serviceType", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const serviceType = String(req.params["serviceType"] ?? "").trim();
  if (!serviceType) return res.status(400).json({ error: "serviceType wajib diisi" });

  const companyId = resolveCompanyId(req);
  const existing = await db
    .select()
    .from(serviceTemplatesTable)
    .where(and(
      eq(serviceTemplatesTable.serviceType, serviceType),
      or(eq(serviceTemplatesTable.companyId, companyId), isNull(serviceTemplatesTable.companyId)),
    ));

  if (existing.length === 0) {
    return res.status(404).json({ error: `serviceType '${serviceType}' tidak ditemukan` });
  }

  const companyRow = existing.find((r) => r.companyId !== null && r.companyId === companyId);
  const globalRow  = existing.find((r) => r.companyId === null);

  if (!companyRow && !globalRow) {
    return res.status(404).json({ error: `serviceType '${serviceType}' tidak ditemukan` });
  }

  const body    = req.body as Record<string, unknown>;

  const newFields  = body["fields"]            !== undefined ? (body["fields"] as ServiceTemplateField[])               : undefined;
  const newDocs    = body["requiredDocuments"]  !== undefined ? (body["requiredDocuments"] as ServiceTemplateDocument[])  : undefined;
  const newCl      = body["checklist"]          !== undefined ? (body["checklist"] as ServiceTemplateChecklist[])         : undefined;
  const newCRules  = body["conditionalRules"]   !== undefined ? (body["conditionalRules"] as ServiceConditionalRule[])    : undefined;
  const newVRules  = body["validationRules"]    !== undefined ? (body["validationRules"] as ServiceValidationRule[])      : undefined;

  if (newFields !== undefined) {
    const fieldCheck = validateFields(newFields);
    if (!fieldCheck.ok) return res.status(400).json({ error: fieldCheck.error });
  }

  try {
    if (companyRow) {
      let resolvedVersion = body["version"] != null ? String(body["version"]).trim() : undefined;
      const didStructureChange = structureChanged(companyRow, newFields, newDocs, newCl);
      if (!resolvedVersion && didStructureChange) resolvedVersion = bumpMinor(companyRow.version);

      const updatePayload: Partial<typeof serviceTemplatesTable.$inferInsert> = { updatedAt: new Date() };
      if (body["label"]       != null) updatePayload.label       = String(body["label"]).trim();
      if (body["emoji"]       != null) updatePayload.emoji       = String(body["emoji"]).trim();
      if (body["isActive"]    != null) updatePayload.isActive    = Boolean(body["isActive"]);
      if (body["description"] != null) updatePayload.description = String(body["description"]).trim();
      if (body["sortOrder"]   != null) updatePayload.sortOrder   = Number(body["sortOrder"]);
      if (resolvedVersion)             updatePayload.version     = resolvedVersion;
      if (newFields  !== undefined)    updatePayload.fields            = newFields  as unknown as typeof updatePayload["fields"];
      if (newDocs    !== undefined)    updatePayload.requiredDocuments = newDocs    as unknown as typeof updatePayload["requiredDocuments"];
      if (newCl      !== undefined)    updatePayload.checklist         = newCl      as unknown as typeof updatePayload["checklist"];
      if (newCRules  !== undefined)    updatePayload.conditionalRules  = newCRules  as unknown as typeof updatePayload["conditionalRules"];
      if (newVRules  !== undefined)    updatePayload.validationRules   = newVRules  as unknown as typeof updatePayload["validationRules"];

      await writeVersionSnapshot(companyRow, {
        changeNote: didStructureChange ? "Sebelum update struktur" : "Sebelum update metadata",
      });

      const updated = await db
        .update(serviceTemplatesTable)
        .set(updatePayload)
        .where(eq(serviceTemplatesTable.id, companyRow.id))
        .returning();

      const versionBumped = resolvedVersion !== undefined && resolvedVersion !== companyRow.version;
      return res.json({
        ...rowToOverride(updated[0]!),
        source: "db",
        versionBumped,
        previousVersion: versionBumped ? companyRow.version : undefined,
      });
    }

    const src = globalRow!;
    const overrideVersion = body["version"] != null ? String(body["version"]).trim() : src.version;
    const inserted = await db
      .insert(serviceTemplatesTable)
      .values({
        companyId,
        serviceType,
        label:             body["label"]       != null ? String(body["label"]).trim()       : src.label,
        emoji:             body["emoji"]       != null ? String(body["emoji"]).trim()       : (src.emoji ?? "📋"),
        version:           overrideVersion,
        isActive:          body["isActive"]    != null ? Boolean(body["isActive"])          : src.isActive,
        description:       body["description"] != null ? String(body["description"]).trim() : (src.description ?? null),
        sortOrder:         body["sortOrder"]   != null ? Number(body["sortOrder"])          : (src.sortOrder ?? 0),
        fields:            newFields  !== undefined ? (newFields  as unknown as typeof serviceTemplatesTable.$inferInsert["fields"])            : src.fields,
        requiredDocuments: newDocs    !== undefined ? (newDocs    as unknown as typeof serviceTemplatesTable.$inferInsert["requiredDocuments"]) : src.requiredDocuments,
        checklist:         newCl      !== undefined ? (newCl      as unknown as typeof serviceTemplatesTable.$inferInsert["checklist"])         : src.checklist,
        conditionalRules:  newCRules  !== undefined ? (newCRules  as unknown as typeof serviceTemplatesTable.$inferInsert["conditionalRules"])  : src.conditionalRules,
        validationRules:   newVRules  !== undefined ? (newVRules  as unknown as typeof serviceTemplatesTable.$inferInsert["validationRules"])   : src.validationRules,
      })
      .returning();

    await writeVersionSnapshot(inserted[0]!, { changeNote: "Override perusahaan dibuat dari template global" });

    return res.status(201).json({
      ...rowToOverride(inserted[0]!),
      source: "db",
      createdOverride: true,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: `serviceType '${serviceType}' sudah ada untuk perusahaan ini` });
    }
    return res.status(500).json({ error: "Gagal update service template", detail: msg });
  }
});

serviceTemplatesRouter.post("/:serviceType/duplicate", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const sourceType     = String(req.params["serviceType"] ?? "").trim();
  const body           = req.body as Record<string, unknown>;
  const newServiceType = String(body["newServiceType"] ?? "").trim().toLowerCase();
  const newLabel       = String(body["newLabel"]       ?? "").trim();

  if (!newServiceType) return res.status(400).json({ error: "newServiceType wajib diisi" });
  if (!SERVICE_TYPE_RE.test(newServiceType)) {
    return res.status(400).json({ error: "newServiceType hanya boleh huruf kecil a-z, angka 0-9, dan underscore (_)" });
  }
  if (!newLabel) return res.status(400).json({ error: "newLabel wajib diisi" });

  const companyId = resolveCompanyId(req);
  try {
    const sourceRows = await db
      .select()
      .from(serviceTemplatesTable)
      .where(and(
        eq(serviceTemplatesTable.serviceType, sourceType),
        or(eq(serviceTemplatesTable.companyId, companyId), isNull(serviceTemplatesTable.companyId)),
      ))
      .limit(1);

    if (sourceRows.length === 0) {
      return res.status(404).json({ error: `sourceType '${sourceType}' tidak ditemukan` });
    }
    const src = sourceRows[0]!;

    const targetExists = await db
      .select({ id: serviceTemplatesTable.id })
      .from(serviceTemplatesTable)
      .where(and(
        eq(serviceTemplatesTable.serviceType, newServiceType),
        eq(serviceTemplatesTable.companyId, companyId),
      ))
      .limit(1);

    if (targetExists.length > 0) {
      return res.status(409).json({ error: `serviceType '${newServiceType}' sudah ada untuk perusahaan ini` });
    }

    const inserted = await db
      .insert(serviceTemplatesTable)
      .values({
        companyId,
        serviceType:       newServiceType,
        label:             newLabel,
        emoji:             src.emoji,
        version:           "1.0.0",
        isActive:          true,
        description:       src.description ? `Duplikat dari ${sourceType}: ${src.description}` : `Duplikat dari ${sourceType}`,
        sortOrder:         (src.sortOrder ?? 0) + 1,
        fields:            src.fields,
        requiredDocuments: src.requiredDocuments,
        checklist:         src.checklist,
        conditionalRules:  src.conditionalRules,
        validationRules:   src.validationRules,
      })
      .returning();

    await writeVersionSnapshot(inserted[0]!, { changeNote: `Duplikat dari ${sourceType}` });

    return res.status(201).json({
      ...rowToOverride(inserted[0]!),
      source: "db",
      duplicatedFrom: sourceType,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: `serviceType '${newServiceType}' sudah ada` });
    }
    return res.status(500).json({ error: "Gagal duplicate service template", detail: msg });
  }
});

serviceTemplatesRouter.patch("/:serviceType/toggle-active", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const serviceType = String(req.params["serviceType"] ?? "").trim();
  if (!serviceType) return res.status(400).json({ error: "serviceType wajib diisi" });

  const body = req.body as Record<string, unknown>;
  if (body["isActive"] === undefined) {
    return res.status(400).json({ error: "isActive wajib dikirim (true atau false)" });
  }
  const isActive = Boolean(body["isActive"]);
  const companyId = resolveCompanyId(req);

  try {
    const rows = await db.select()
      .from(serviceTemplatesTable)
      .where(and(
        eq(serviceTemplatesTable.serviceType, serviceType),
        or(eq(serviceTemplatesTable.companyId, companyId), isNull(serviceTemplatesTable.companyId)),
      ));

    if (rows.length === 0) return res.status(404).json({ error: `serviceType '${serviceType}' tidak ditemukan` });

    const companyTarget = rows.find((r) => r.companyId !== null && r.companyId === companyId);
    const globalTarget  = rows.find((r) => r.companyId === null);

    if (companyTarget) {
      const updated = await db
        .update(serviceTemplatesTable)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(serviceTemplatesTable.id, companyTarget.id))
        .returning();

      if (updated.length === 0) return res.status(404).json({ error: `serviceType '${serviceType}' tidak ditemukan` });
    } else if (globalTarget) {
      await db
        .insert(serviceTemplatesTable)
        .values({
          companyId,
          serviceType,
          label:             globalTarget.label,
          emoji:             globalTarget.emoji ?? "📋",
          version:           globalTarget.version,
          isActive,
          description:       globalTarget.description ?? null,
          sortOrder:         globalTarget.sortOrder ?? 0,
          fields:            globalTarget.fields,
          requiredDocuments: globalTarget.requiredDocuments,
          checklist:         globalTarget.checklist,
          conditionalRules:  globalTarget.conditionalRules,
          validationRules:   globalTarget.validationRules,
        });
    } else {
      return res.status(404).json({ error: `serviceType '${serviceType}' tidak ditemukan` });
    }

    return res.json({
      serviceType,
      isActive,
      message: isActive ? `Template '${serviceType}' diaktifkan` : `Template '${serviceType}' dinonaktifkan`,
    });
  } catch (err) {
    return res.status(500).json({ error: "Gagal toggle isActive", detail: String(err) });
  }
});
