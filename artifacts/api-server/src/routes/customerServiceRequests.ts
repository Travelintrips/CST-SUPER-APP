import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  customerServiceRequestsTable,
  customerServiceRequestItemsTable,
  customerServiceRequestDocumentsTable,
  portalCustomersTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  optionalCustomerPortalAuth,
  requireCustomerPortalAuth,
  type PortalAuthReq,
} from "../lib/supabaseAuth.js";
import { logger } from "../lib/logger.js";
import {
  getPortalCustomerContext,
  PortalCustomerContextError,
} from "../lib/services/portalCustomerContextService.js";
import {
  getCustomerServiceRequestOwnership,
  hasCustomerServiceRequestAccess,
} from "../lib/services/portalServiceRequestOwnership.js";

export const customerServiceRequestsRouter = Router();

// ── Idempotent migration ──────────────────────────────────────────────────────
db.execute(sql`
  CREATE TABLE IF NOT EXISTS customer_service_requests (
    id SERIAL PRIMARY KEY,
    request_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    customer_company TEXT,
    request_type TEXT NOT NULL DEFAULT 'service',
    trade_type TEXT NOT NULL,
    order_mode TEXT NOT NULL DEFAULT 'ITEM_MANDIRI',
    package_id INTEGER,
    package_name_snapshot TEXT,
    pricing_mode TEXT NOT NULL DEFAULT 'PER_ITEM',
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    admin_notes TEXT,
    handled_by TEXT,
    total_estimated_price NUMERIC(14,2),
    total_quoted_price NUMERIC(14,2),
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {});

db.execute(sql`
  CREATE TABLE IF NOT EXISTS customer_service_request_items (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    service_category TEXT,
    sequence_no INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    description TEXT,
    form_data JSONB DEFAULT '{}',
    required_documents JSONB DEFAULT '[]',
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'pending',
    estimated_price NUMERIC(14,2),
    quoted_price NUMERIC(14,2),
    vendor_id INTEGER,
    vendor_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {});

db.execute(sql`
  CREATE TABLE IF NOT EXISTS customer_service_request_documents (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    request_item_id INTEGER,
    document_type TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_name TEXT,
    file_size INTEGER,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    uploaded_by TEXT,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`).catch(() => {});

db.execute(sql`
  ALTER TABLE customer_service_requests
    ADD COLUMN IF NOT EXISTS portal_customer_id INTEGER,
    ADD COLUMN IF NOT EXISTS company_id INTEGER
`).catch(() => {});

function contextErrorResponse(res: Response, error: unknown): boolean {
  if (error instanceof PortalCustomerContextError) {
    res.status(error.statusCode).json({ error: error.message });
    return true;
  }
  return false;
}

// ── Number generator ──────────────────────────────────────────────────────────
async function generateRequestNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CSR/${year}/`;
  const result = await db.execute(
    sql`SELECT COUNT(*)::int as cnt FROM customer_service_requests WHERE request_number LIKE ${prefix + "%"}`
  );
  const cnt = Number((result.rows[0] as Record<string, unknown>)?.cnt ?? 0) + 1;
  return `${prefix}${String(cnt).padStart(5, "0")}`;
}

// ── POST /api/customer-service-requests ──────────────────────────────────────
// Create a new draft request (auth optional — allows guest draft, customer saves to profile)
customerServiceRequestsRouter.post("/", optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const portalCustomerId = (req as Partial<PortalAuthReq>).portalCustomerId ?? null;
    const {
      customerName, customerEmail, customerPhone, customerCompany,
      tradeType, orderMode, pricingMode, notes,
    } = req.body as Record<string, string>;

    let context: Awaited<ReturnType<typeof getPortalCustomerContext>> | null = null;
    if (portalCustomerId) {
      context = await getPortalCustomerContext(portalCustomerId);
      if (!context.customerType) {
        return res.status(422).json({ error: "Profil customer belum menyelesaikan tipe akun." });
      }
      if (context.customerType === "company" && !context.companyId) {
        return res.status(422).json({ error: "Customer Portal belum memiliki membership perusahaan aktif." });
      }
    }

    if ((!context && (!customerName || !customerEmail)) || !tradeType) {
      return res.status(400).json({ error: "customerName, customerEmail, tradeType wajib diisi" });
    }
    if (!["EXPORT", "IMPORT", "DOMESTIC"].includes(String(tradeType).toUpperCase())) {
      return res.status(400).json({ error: "tradeType harus EXPORT, IMPORT, atau DOMESTIC" });
    }

    const requestNumber = await generateRequestNumber();

    const [inserted] = await db
      .insert(customerServiceRequestsTable)
      .values({
        requestNumber,
        customerId: portalCustomerId,
        customerName: context?.customer.name ?? customerName!.trim(),
        customerEmail: context?.customer.email ?? customerEmail!.toLowerCase().trim(),
        customerPhone: context?.customer.phone ?? customerPhone ?? null,
        customerCompany: context?.company?.name ?? (context ? null : customerCompany ?? null),
        tradeType: String(tradeType).toUpperCase(),
        orderMode: orderMode ?? "ITEM_MANDIRI",
        pricingMode: pricingMode ?? "PER_ITEM",
        status: "draft",
        notes: notes ?? null,
      })
      .returning();

    if (portalCustomerId) {
      await db.execute(sql`
        UPDATE customer_service_requests
           SET portal_customer_id = ${portalCustomerId},
               company_id = ${context?.companyId ?? null}
         WHERE id = ${inserted.id}
      `);
    }

    logger.info({ requestNumber: inserted.requestNumber }, "[CSR] draft request created");
    return res.status(201).json(inserted);
  } catch (err) {
    logger.error({ err }, "[CSR] create error");
    return res.status(500).json({ error: "Gagal membuat request" });
  }
});

// ── GET /api/customer-service-requests/:id ───────────────────────────────────
customerServiceRequestsRouter.get("/:id", requireCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(String(req.params.id));
    if (!Number.isInteger(id) || !(await hasCustomerServiceRequestAccess(req, id))) {
      return res.status(404).json({ error: "Request tidak ditemukan" });
    }
    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, id))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });

    const items = await db
      .select()
      .from(customerServiceRequestItemsTable)
      .where(eq(customerServiceRequestItemsTable.requestId, id))
      .orderBy(customerServiceRequestItemsTable.sequenceNo);

    const documents = await db
      .select()
      .from(customerServiceRequestDocumentsTable)
      .where(eq(customerServiceRequestDocumentsTable.requestId, id));

    return res.json({ ...request, items, documents });
  } catch (err) {
    if (contextErrorResponse(res, err)) return;
    logger.error({ err }, "[CSR] get error");
    return res.status(500).json({ error: "Gagal mengambil request" });
  }
});

// ── GET /api/customer-service-requests/by-number/:number ─────────────────────
customerServiceRequestsRouter.get("/by-number/:number", requireCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.requestNumber, String(req.params.number)))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });
    if (!(await hasCustomerServiceRequestAccess(req, request.id))) {
      return res.status(404).json({ error: "Request tidak ditemukan" });
    }

    const items = await db
      .select()
      .from(customerServiceRequestItemsTable)
      .where(eq(customerServiceRequestItemsTable.requestId, request.id))
      .orderBy(customerServiceRequestItemsTable.sequenceNo);

    const documents = await db
      .select()
      .from(customerServiceRequestDocumentsTable)
      .where(eq(customerServiceRequestDocumentsTable.requestId, request.id));

    return res.json({ ...request, items, documents });
  } catch (err) {
    if (contextErrorResponse(res, err)) return;
    logger.error({ err }, "[CSR] get-by-number error");
    return res.status(500).json({ error: "Gagal mengambil request" });
  }
});

// ── GET /api/customer-service-requests (my requests, auth required) ──────────
customerServiceRequestsRouter.get("/", requireCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const ownership = await getCustomerServiceRequestOwnership(req);
    const requests = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(ownership)
      .orderBy(desc(customerServiceRequestsTable.createdAt))
      .limit(50);
    return res.json(requests);
  } catch (err) {
    logger.error({ err }, "[CSR] list error");
    return res.status(500).json({ error: "Gagal mengambil daftar request" });
  }
});

// ── POST /api/customer-service-requests/:id/items ────────────────────────────
customerServiceRequestsRouter.post("/:id/items", optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const requestId = Number(String(req.params.id));
    if (!(await hasCustomerServiceRequestAccess(req, requestId, { allowGuest: true }))) {
      return res.status(404).json({ error: "Request tidak ditemukan" });
    }
    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, requestId))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });
    if (!["draft"].includes(request.status)) {
      return res.status(400).json({ error: "Tidak bisa menambah item — request sudah disubmit" });
    }

    const { itemType, title, description, formData, requiredDocuments, estimatedPrice } = req.body as Record<string, unknown>;
    if (!itemType || !title) {
      return res.status(400).json({ error: "itemType dan title wajib diisi" });
    }

    // auto sequence_no
    const seqResult = await db.execute(
      sql`SELECT COALESCE(MAX(sequence_no),0)+1 as next FROM customer_service_request_items WHERE request_id = ${requestId}`
    );
    const sequenceNo = Number((seqResult.rows[0] as Record<string, unknown>)?.next ?? 1);

    const [item] = await db
      .insert(customerServiceRequestItemsTable)
      .values({
        requestId,
        itemType: String(itemType),
        serviceCategory: String(itemType),
        sequenceNo,
        title: String(title),
        description: description ? String(description) : null,
        formData: (formData as Record<string, unknown>) ?? {},
        requiredDocuments: (requiredDocuments as string[]) ?? [],
        estimatedPrice: estimatedPrice ? String(estimatedPrice) : null,
        status: "pending",
      })
      .returning();

    logger.info({ requestId, itemId: item.id, itemType }, "[CSR] item added");
    return res.status(201).json(item);
  } catch (err) {
    logger.error({ err }, "[CSR] add-item error");
    return res.status(500).json({ error: "Gagal menambah item" });
  }
});

// ── PUT /api/customer-service-requests/:id/items/:itemId ─────────────────────
customerServiceRequestsRouter.put("/:id/items/:itemId", optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const requestId = Number(String(req.params.id));
    const itemId = Number(String(req.params.itemId));
    if (!(await hasCustomerServiceRequestAccess(req, requestId, { allowGuest: true }))) {
      return res.status(404).json({ error: "Request tidak ditemukan" });
    }

    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, requestId))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });
    if (!["draft"].includes(request.status)) {
      return res.status(400).json({ error: "Tidak bisa mengubah item — request sudah disubmit" });
    }

    const { title, description, formData, requiredDocuments, estimatedPrice } = req.body as Record<string, unknown>;

    const [updated] = await db
      .update(customerServiceRequestItemsTable)
      .set({
        title: title ? String(title) : undefined,
        description: description ? String(description) : undefined,
        formData: (formData as Record<string, unknown>) ?? undefined,
        requiredDocuments: (requiredDocuments as string[]) ?? undefined,
        estimatedPrice: estimatedPrice ? String(estimatedPrice) : undefined,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerServiceRequestItemsTable.id, itemId),
          eq(customerServiceRequestItemsTable.requestId, requestId),
        )
      )
      .returning();

    if (!updated) return res.status(404).json({ error: "Item tidak ditemukan" });
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "[CSR] update-item error");
    return res.status(500).json({ error: "Gagal mengubah item" });
  }
});

// ── DELETE /api/customer-service-requests/:id/items/:itemId ──────────────────
customerServiceRequestsRouter.delete("/:id/items/:itemId", optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const requestId = Number(String(req.params.id));
    const itemId = Number(String(req.params.itemId));
    if (!(await hasCustomerServiceRequestAccess(req, requestId, { allowGuest: true }))) {
      return res.status(404).json({ error: "Request tidak ditemukan" });
    }

    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, requestId))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });
    if (!["draft"].includes(request.status)) {
      return res.status(400).json({ error: "Tidak bisa menghapus item — request sudah disubmit" });
    }

    await db
      .delete(customerServiceRequestItemsTable)
      .where(
        and(
          eq(customerServiceRequestItemsTable.id, itemId),
          eq(customerServiceRequestItemsTable.requestId, requestId),
        )
      );

    // renumber sequences
    const remaining = await db
      .select()
      .from(customerServiceRequestItemsTable)
      .where(eq(customerServiceRequestItemsTable.requestId, requestId))
      .orderBy(customerServiceRequestItemsTable.sequenceNo);
    for (let i = 0; i < remaining.length; i++) {
      await db
        .update(customerServiceRequestItemsTable)
        .set({ sequenceNo: i + 1 })
        .where(eq(customerServiceRequestItemsTable.id, remaining[i].id));
    }

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[CSR] delete-item error");
    return res.status(500).json({ error: "Gagal menghapus item" });
  }
});

// ── POST /api/customer-service-requests/:id/submit ───────────────────────────
customerServiceRequestsRouter.post("/:id/submit", optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const requestId = Number(String(req.params.id));
    if (!(await hasCustomerServiceRequestAccess(req, requestId, { allowGuest: true }))) {
      return res.status(404).json({ error: "Request tidak ditemukan" });
    }
    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, requestId))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });
    if (request.status !== "draft") {
      return res.status(400).json({ error: "Request sudah disubmit sebelumnya" });
    }

    const items = await db
      .select()
      .from(customerServiceRequestItemsTable)
      .where(eq(customerServiceRequestItemsTable.requestId, requestId));

    if (items.length === 0) {
      return res.status(400).json({ error: "Tambahkan minimal 1 item layanan sebelum submit" });
    }

    const [updated] = await db
      .update(customerServiceRequestsTable)
      .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(customerServiceRequestsTable.id, requestId))
      .returning();

    logger.info({ requestNumber: updated.requestNumber, itemCount: items.length }, "[CSR] submitted");
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "[CSR] submit error");
    return res.status(500).json({ error: "Gagal submit request" });
  }
});
