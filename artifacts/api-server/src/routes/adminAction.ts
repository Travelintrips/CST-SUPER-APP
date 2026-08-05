import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { broadcastInvalidation } from "../lib/alertsBroadcast.js";
import { eq, desc, inArray, sql, and, isNull, or } from "drizzle-orm";
import {
  db,
  adminActionLinksTable,
  logisticOrdersTable,
  logisticOrderItemsTable,
  logisticOrderRfqsTable,
  rfqVendorLinksTable,
  suppliersTable,
  vendorCatalogItemsTable,
  customerQuoteLinksTable,
  orderUpdatesTable,
  vendorFulfillmentLinksTable,
  vendorMiniFormLinksTable,
  customerOrderLinksTable,
} from "@workspace/db";
import { requireClerkUser, requireAdmin } from "../lib/requireAdmin.js";
import { logTokenAccess } from "../lib/tokenGuard.js";
import { runDbBackup } from "../lib/dbBackup.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";
import { hashToken } from "../lib/tokenUtils.js";

/**
 * Dual-token WHERE clause: try token_hash first (HMAC-SHA256, secure),
 * fall back to raw token when token_hash IS NULL (legacy rows before P1 hardening).
 * Drop this fallback after all rows have token_hash populated.
 */
function adminTokenWhere(rawToken: string) {
  const hash = hashToken(rawToken);
  return or(
    eq(adminActionLinksTable.tokenHash, hash),
    and(isNull(adminActionLinksTable.tokenHash), eq(adminActionLinksTable.token, rawToken))
  )!;
}
import { TAX_RATE_DECIMAL as PPN_RATE, TAX_RATE_DECIMAL } from "../lib/taxHelper.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { normalizePhone } from "../lib/phoneUtils.js";
import { getAdminWa, getAdminGroupWa } from "../lib/adminWa.js";
import { sendVendorRequestNotification, sendVendorSelectedAdminWa, sendVendorAwardedWa, sendVendorNotSelectedWa, sendVendorAssignmentNotification, resolveTemplateSnapshot, sendCustomerApprovalNotification, type LogisticOrderData } from "../lib/orderNotification.js";
import { generateShortLink } from "../lib/shortLink.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { transitionRfqStatus, transitionVendorLinkStatus } from "../lib/services/rfqStatusService.js";
import { updateOrderProgress } from "../lib/orderProgress.js";

export const adminActionRouter: Router = Router();
export const adminActionPublicRouter = Router();
export const adminActionAdminRouter = Router();

// ── Blast guard: mencegah 2 admin blast RFQ bersamaan ke order yang sama ──────
// In-memory Set; cukup untuk single-process. Jika scale ke multi-process,
// ganti dengan advisory lock atau Redis key dengan TTL.
const blastInProgress = new Set<number>();

/**
 * GET /admin-action/:token
 *
 * Public no-login redirect link sent to admin via WhatsApp.
 *
 * Lookup strategy:
 *   1. Try publicRfqToken column on logistic_orders (new format, 32 hex chars)
 *   2. Fallback: query short_links table for target_url matching this token,
 *      then use ref_id as orderNumber or orderId.
 *   3. Final fallback: redirect to BizPortal logistics orders list.
 */
adminActionRouter.get("/admin-action/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "").trim();
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  // Redirect to the public no-login admin review page on customer portal
  return res.redirect(302, `https://${domain}/admin-review/${token}`);
});

// ─── Boot migration ───────────────────────────────────────────────────────────
let migrationDone = false;
async function ensureTables() {
  if (migrationDone) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_action_links (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        action_type TEXT NOT NULL,
        order_id INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        rfq_id INTEGER REFERENCES logistic_order_rfqs(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    migrationDone = true;
  } catch (err) {
    logger.error({ err }, "adminAction ensureTables error");
  }
}

// ─── Helper: generate admin action link ──────────────────────────────────────
export async function createAdminActionLink(
  orderId: number,
  actionType: string,
  rfqId?: number | null,
  expiresInHours = 72,
): Promise<string> {
  await ensureTables();
  // P0.2 — 256-bit secure token
  const { generateTokenPair } = await import("../lib/tokenUtils.js");
  const { raw, hash } = generateTokenPair();
  const expiresAt = new Date(Date.now() + expiresInHours * 3600_000);

  // P1.1 — Token rotation: revoke any active token for same orderId+actionType
  await db.execute(sql`
    UPDATE admin_action_links
    SET revoked_at = NOW()
    WHERE order_id = ${orderId}
      AND action_type = ${actionType}
      AND revoked_at IS NULL
      AND used_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  `);

  await db.insert(adminActionLinksTable).values({
    token: raw,          // kept for backward-compat lookup during transition
    tokenHash: hash,     // P0.1 — store HMAC-SHA256 hash
    actionType,
    orderId,
    rfqId: rfqId ?? null,
    expiresAt,
  });
  return raw;
}

export function getAdminActionUrl(token: string): string {
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  return `https://${domain}/admin-review/${token}`;
}

// ─── Admin: POST /api/admin-action/db-backup — manual DB backup trigger ──────
adminActionAdminRouter.post("/db-backup", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const result = await runDbBackup();
  return res.status(result.ok ? 200 : 500).json(result);
});

// ─── Admin: POST /api/admin-action/create ────────────────────────────────────
adminActionAdminRouter.post("/create", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const { orderId, actionType, rfqId, expiresInHours = 72 } = req.body as {
    orderId: number;
    actionType: string;
    rfqId?: number;
    expiresInHours?: number;
  };
  if (!orderId || !actionType) {
    return res.status(400).json({ error: "orderId dan actionType wajib" });
  }

  await ensureTables();

  const token = await createAdminActionLink(orderId, actionType, rfqId, expiresInHours);
  const url = getAdminActionUrl(token);
  const shortUrl = await generateShortLink(url, {
    context: "admin_action",
    refType: "order",
    refId: String(orderId),
  });
  return res.json({ ok: true, token, url, shortUrl });
});

// ─── Admin: POST /api/admin-action/resend-confirm-wa ─────────────────────────
adminActionAdminRouter.post("/resend-confirm-wa", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const body = req.body as { orderId?: number };
  if (!body.orderId) return res.status(400).json({ error: "orderId diperlukan" });
  await ensureTables();
  const rows = await db.select({
    id: logisticOrdersTable.id,
    orderNumber: logisticOrdersTable.orderNumber,
    customerName: logisticOrdersTable.customerName,
  }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, Number(body.orderId))).limit(1);
  const order = rows[0];
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  const cfToken = await createAdminActionLink(order.id, "confirm_fulfillment", null, 168);
  const cfUrl = getAdminActionUrl(cfToken);
  const shortUrl = await generateShortLink(cfUrl, { context: "admin_action", refType: "order", refId: order.orderNumber });
  const adminWa = await getAdminWa();
  if (adminWa) {
    const ln = "\n";
    const sep = "-------------------";
    const waMsg = "📦 *[Kirim Ulang] Konfirmasi Fulfillment Vendor*" + ln + sep + ln +
      "No. Order  : *" + order.orderNumber + "*" + ln +
      "Customer   : " + order.customerName + ln + sep + ln +
      "Buka link berikut untuk konfirmasi:" + ln + shortUrl;
    sendWhatsApp(adminWa, waMsg).catch((err2) => logger.warn({ err2 }, "resend-confirm-wa WA failed"));
  }
  return res.json({ ok: true, shortUrl, cfUrl, adminWaSent: !!adminWa });
});

// ─── Public: GET /api/admin-action/:token ────────────────────────────────────
adminActionPublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  await ensureTables();

  try {
    let link = (await db.select().from(adminActionLinksTable)
      .where(adminTokenWhere(token)))[0];

    const ORDER_COLS = {
      id: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      companyName: logisticOrdersTable.companyName,
      customerName: logisticOrdersTable.customerName,
      email: logisticOrdersTable.email,
      phone: logisticOrdersTable.phone,
      orderType: logisticOrdersTable.orderType,
      shipmentType: logisticOrdersTable.shipmentType,
      origin: logisticOrdersTable.origin,
      destination: logisticOrdersTable.destination,
      commodity: logisticOrdersTable.commodity,
      cargoDescription: logisticOrdersTable.cargoDescription,
      grossWeight: logisticOrdersTable.grossWeight,
      volumeCbm: logisticOrdersTable.volumeCbm,
      jumlahKoli: logisticOrdersTable.jumlahKoli,
      requiredDate: logisticOrdersTable.requiredDate,
      jamOrder: logisticOrdersTable.jamOrder,
      notes: logisticOrdersTable.notes,
      paymentType: logisticOrdersTable.paymentType,
      status: logisticOrdersTable.status,
      publicRfqToken: logisticOrdersTable.publicRfqToken,
      grandTotal: logisticOrdersTable.grandTotal,
      createdAt: logisticOrdersTable.createdAt,
    };

    // Fallback: token mungkin adalah publicRfqToken dari logistic_orders
    let orderFromPublicToken: typeof ORDER_COLS extends Record<string, unknown> ? any : any;
    if (!link) {
      const [ord] = await db.select(ORDER_COLS).from(logisticOrdersTable)
        .where(eq(logisticOrdersTable.publicRfqToken, token))
        .limit(1);
      if (!ord) {
        logTokenAccess({ tokenType: "admin_action", tokenRef: token, action: "view", outcome: "denied_not_found", req });
        return res.status(404).json({ error: "Link tidak ditemukan" });
      }
      orderFromPublicToken = ord;
      logTokenAccess({ tokenType: "admin_action", tokenRef: token, entityId: ord.id, action: "view", outcome: "ok", req });
    }

    if (link && link.expiresAt && link.expiresAt < new Date()) {
      logTokenAccess({ tokenType: "admin_action", tokenRef: token, entityId: link.id, action: "view", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link sudah kadaluarsa", isExpired: true });
    }
    if (link && link.revokedAt) {
      logTokenAccess({ tokenType: "admin_action", tokenRef: token, entityId: link.id, action: "view", outcome: "denied_revoked", req });
      return res.status(403).json({ error: "Link ini telah dicabut", isRevoked: true, revokedAt: link.revokedAt.toISOString() });
    }

    logTokenAccess({ tokenType: "admin_action", tokenRef: token, entityId: link?.id ?? null, action: "view", outcome: "ok", req });

    const order = orderFromPublicToken ?? (await db.select(ORDER_COLS).from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link!.orderId))
      .limit(1))[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const actionType = link?.actionType ?? "review_order";

    // Fetch order items untuk ditampilkan di OrderCard (nama produk/layanan yang dipesan)
    const orderItemRows = await db.select({
      serviceName: logisticOrderItemsTable.serviceName,
      category: logisticOrderItemsTable.category,
      subtotal: logisticOrderItemsTable.subtotal,
      inputData: logisticOrderItemsTable.inputData,
      calculatorType: logisticOrderItemsTable.calculatorType,
    }).from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, order.id));

    // Helper: ekstrak qty & unit dari inputData item
    const extractItemQty = (input: Record<string, unknown> | null): number | null => {
      if (!input) return null;
      const v = input.qty ?? input.quantity;
      const n = parseFloat(String(v ?? ""));
      return isNaN(n) || n <= 0 ? null : n;
    };
    const extractItemUnit = (input: Record<string, unknown> | null): string | null => {
      if (!input) return null;
      return input.unit != null ? String(input.unit) : null;
    };
    const extractItemUnitPrice = (input: Record<string, unknown> | null): number | null => {
      if (!input) return null;
      const pRaw = input.price ?? input.productPrice ?? input.unitPrice ?? input.sellingPrice ?? null;
      if (typeof pRaw === "number") return pRaw > 0 ? pRaw : null;
      if (typeof pRaw === "string") { const n = parseFloat(pRaw); return !isNaN(n) && n > 0 ? n : null; }
      return null;
    };

    // Hitung total qty untuk estimasi harga vendor (hanya berlaku jika semua item satu unit)
    let totalQtyForVendor: number | null = null;
    let orderUnitForVendor: string | null = null;
    if (orderItemRows.length === 1) {
      const inp = orderItemRows[0].inputData as Record<string, unknown> | null;
      totalQtyForVendor = extractItemQty(inp);
      orderUnitForVendor = extractItemUnit(inp);
    } else if (orderItemRows.length > 1) {
      let sumQty = 0;
      let firstUnit: string | null = null;
      let sameUnit = true;
      for (const it of orderItemRows) {
        const inp = it.inputData as Record<string, unknown> | null;
        const q = extractItemQty(inp);
        const u = extractItemUnit(inp);
        if (q == null) { sameUnit = false; break; }
        if (firstUnit == null) firstUnit = u;
        else if (u !== firstUnit) sameUnit = false;
        sumQty += q;
      }
      if (sameUnit && sumQty > 0) { totalQtyForVendor = sumQty; orderUnitForVendor = firstUnit; }
    }

    // Compute tax breakdown — source of truth for all views
    // Hitung subtotal per item dengan benar: unitPrice × qty (bukan raw DB subtotal yang bisa jadi unit price saja)
    const _itemsSubtotal = orderItemRows.reduce((sum, it) => {
      const inp = it.inputData as Record<string, unknown> | null;
      const qty = extractItemQty(inp);
      const unitPrice = extractItemUnitPrice(inp);
      const dbSubtotal = it.subtotal != null ? parseFloat(String(it.subtotal)) : 0;
      const computed = (unitPrice != null && qty != null) ? unitPrice * qty : dbSubtotal;
      return sum + computed;
    }, 0);
    const _grandTotalNum = order.grandTotal ? parseFloat(String(order.grandTotal)) : null;
    const _TAX_RATE = 11;
    let _subtotalBeforeTax: number | null = null;
    let _taxAmount: number | null = null;
    if (_itemsSubtotal > 0) {
      // Items subtotal IS the DPP (pre-tax). PPN dihitung di atas DPP.
      _subtotalBeforeTax = _itemsSubtotal;
      _taxAmount = Math.round(_itemsSubtotal * _TAX_RATE / 100);
    } else if (_grandTotalNum != null && _grandTotalNum > 0) {
      // grandTotal adalah DPP (harga dasar sebelum PPN). PPN dihitung di atas (exclusive).
      _subtotalBeforeTax = _grandTotalNum;
      _taxAmount = Math.round(_grandTotalNum * _TAX_RATE / 100);
    }

    const base = {
      token,
      actionType,
      isUsed: link ? !!link.usedAt : false,
      usedAt: link?.usedAt?.toISOString() ?? null,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        companyName: order.companyName ?? null,
        email: order.email ?? null,
        phone: (order as any).phone ?? null,
        orderType: (order as any).orderType ?? null,
        serviceType: order.shipmentType,
        origin: order.origin,
        destination: order.destination,
        commodity: order.commodity ?? null,
        cargoDescription: order.cargoDescription ?? null,
        grossWeight: order.grossWeight ? String(order.grossWeight) : null,
        volumeCbm: order.volumeCbm ? String(order.volumeCbm) : null,
        jumlahKoli: (order as any).jumlahKoli ?? null,
        requiredDate: (order as any).requiredDate ?? null,
        notes: (order as any).notes ?? null,
        paymentType: (order as any).paymentType ?? null,
        grandTotal: (_subtotalBeforeTax != null && _taxAmount != null)
          ? String(Math.round(_subtotalBeforeTax + _taxAmount))
          : (order.grandTotal ? String(order.grandTotal) : null),
        subtotalBeforeTax: _subtotalBeforeTax != null ? String(_subtotalBeforeTax) : null,
        taxRate: _TAX_RATE,
        taxAmount: _taxAmount != null ? String(_taxAmount) : null,
        status: order.status,
        items: orderItemRows.map((it) => {
          const inp = it.inputData as Record<string, unknown> | null;
          const qty = extractItemQty(inp);
          const unit = extractItemUnit(inp);
          const unitPrice = extractItemUnitPrice(inp);
          const dbSubtotal = it.subtotal != null ? Number(it.subtotal) : null;
          const subtotal = (unitPrice != null && qty != null) ? unitPrice * qty : dbSubtotal;
          return {
            serviceName: it.serviceName ?? "",
            category: it.category ?? "",
            subtotal: subtotal != null ? String(subtotal) : null,
            quantity: qty != null ? String(qty) : null,
            unit: unit ?? null,
            unitPrice: unitPrice != null ? String(unitPrice) : null,
          };
        }),
      },
    };

    // review_order: get list of all vendors + matching flag for blast
    if (actionType === "review_order") {
      const allVendors = await db.select({
        id: suppliersTable.id,
        name: suppliersTable.name,
        phone: suppliersTable.phone,
        email: suppliersTable.contactEmail,
        serviceType: suppliersTable.serviceType,
        eta: suppliersTable.eta,
        fee: suppliersTable.fee,
        note: suppliersTable.note,
      }).from(suppliersTable)
        .where(eq(suppliersTable.isActive, true))
        .orderBy(suppliersTable.name);

      // Normalize shipment type for matching (check all words, not just first)
      const shipType = (order.shipmentType ?? "").toLowerCase().trim();
      const shipKeywords = shipType.split(/[\s,]+/).filter((k: string) => k.length > 1);

      // Semua vendor aktif (dengan/tanpa phone); marking hasPhone untuk blast WA
      const allWithPhone = allVendors;

      // Fetch catalog items for all vendors in one query to check commodity match
      const vendorIdList = allWithPhone.map((v) => v.id);
      const catalogItems = vendorIdList.length
        ? await db.select({
            vendorId: vendorCatalogItemsTable.vendorId,
            name: vendorCatalogItemsTable.name,
            type: vendorCatalogItemsTable.type,
            isCommodityTag: vendorCatalogItemsTable.isCommodityTag,
            priceBase: vendorCatalogItemsTable.priceBase,
          }).from(vendorCatalogItemsTable)
            .where(and(
              inArray(vendorCatalogItemsTable.vendorId, vendorIdList),
              eq(vendorCatalogItemsTable.isActive, true),
            ))
        : [];

      // Build sets: vendor dengan commodity match & vendor yang punya item PRODUK di etalase
      // Derive keywords dari order.commodity + serviceName/category tiap item order
      const commodityKeyword = (order.commodity ?? "").toLowerCase().trim();
      const itemKwSet = new Set<string>();
      for (const it of orderItemRows) {
        for (const src of [it.serviceName ?? "", it.category ?? ""]) {
          for (const w of src.toLowerCase().split(/[\s,/()\-]+/)) {
            if (w.length > 2) itemKwSet.add(w);
          }
        }
      }
      const commodityKwParts = Array.from(new Set([
        ...commodityKeyword.split(/\s+/).filter((k: string) => k.length > 2),
        ...itemKwSet,
      ]));
      const hasOrderKeywords = commodityKwParts.length > 0 || commodityKeyword.length > 0;
      const vendorIdsWithCommodity   = new Set<number>();
      const vendorIdsWithProductItem = new Set<number>(); // hanya type='product'
      // Map vendorId → priceBase: PREFER item yang match dengan order; fallback ke item product pertama
      const vendorPriceBaseMap = new Map<number, number | null>();
      const vendorMatchedItemName = new Map<number, string>();

      for (const item of catalogItems) {
        if (item.type === "product") {
          vendorIdsWithProductItem.add(item.vendorId);
        }

        const itemName = item.name.toLowerCase();
        const nameMatches = hasOrderKeywords && (
          (commodityKeyword && itemName.includes(commodityKeyword)) ||
          commodityKwParts.some((kw: string) => itemName.includes(kw))
        );

        if (nameMatches) {
          vendorIdsWithCommodity.add(item.vendorId);
          // Item yang match selalu menang untuk priceBase
          if (!vendorMatchedItemName.has(item.vendorId)) {
            vendorPriceBaseMap.set(item.vendorId, item.priceBase != null ? Number(item.priceBase) : null);
            vendorMatchedItemName.set(item.vendorId, item.name);
          }
        } else if (!vendorPriceBaseMap.has(item.vendorId) && item.type === "product") {
          vendorPriceBaseMap.set(item.vendorId, item.priceBase != null ? Number(item.priceBase) : null);
        } else if (!vendorPriceBaseMap.has(item.vendorId)) {
          vendorPriceBaseMap.set(item.vendorId, item.priceBase != null ? Number(item.priceBase) : null);
        }
      }

      // Service type matching: vendor's serviceType must contain at least one of the ship keywords
      const isServiceMatch = (vendorServiceType: string | null): boolean => {
        if (!vendorServiceType || shipKeywords.length === 0) return false;
        const vst = vendorServiceType.toLowerCase();
        return shipKeywords.some((kw: string) => vst.includes(kw));
      };

      const allWithFlag = allWithPhone.map((v) => {
        const pb = vendorPriceBaseMap.get(v.id) ?? null;
        let vendorEstSubtotal: number | null = null;
        let vendorEstTax: number | null = null;
        let vendorEstTotal: number | null = null;
        if (pb != null && totalQtyForVendor != null) {
          vendorEstSubtotal = Math.round(pb * totalQtyForVendor);
          vendorEstTax = Math.round(vendorEstSubtotal * _TAX_RATE / 100);
          vendorEstTotal = vendorEstSubtotal + vendorEstTax;
        }
        return {
          ...v,
          hasPhone: !!v.phone,
          isMatching: isServiceMatch(v.serviceType),
          hasCommodityMatch: vendorIdsWithCommodity.has(v.id),
          hasProductItem: vendorIdsWithProductItem.has(v.id),
          priceBase: pb,
          orderQty: totalQtyForVendor,
          orderUnit: orderUnitForVendor,
          vendorEstSubtotal,
          vendorEstTax,
          vendorEstTotal,
          taxRate: _TAX_RATE,
        };
      });

      const commodityMatched  = allWithFlag.filter((v) => v.hasCommodityMatch);
      const serviceMatched    = allWithFlag.filter((v) => v.isMatching && !v.hasCommodityMatch);
      const productVendors    = allWithFlag.filter((v) => v.hasProductItem);

      // ── Filter strategy ──────────────────────────────────────────────────
      // 1. shipmentType ada + ada match → hanya vendor yg match (service + commodity)
      // 2. shipmentType ada + tak ada match → semua vendor berserviceType + warning
      // 3. shipmentType kosong + commodity ada + ada commodity match → hanya vendor dg commodity match
      // 4. shipmentType kosong + commodity ada + ada product vendors → filter product vendors by commodity
      // 5. shipmentType kosong + commodity kosong + ada etalase → hanya vendor yg punya etalase
      // 6. shipmentType kosong + commodity kosong + tak ada etalase → vendor berserviceType (fallback)
      let vendors: typeof allWithFlag;
      let vendorFilterApplied = false;
      let filterMode: "service" | "commodity" | "etalase" | "none" = "none";

      if (shipType) {
        const hasMatch = commodityMatched.length > 0 || serviceMatched.length > 0;
        if (hasMatch) {
          vendors = [...commodityMatched, ...serviceMatched];
          vendorFilterApplied = true;
          filterMode = "service";
        } else {
          vendors = allWithFlag.filter((v) => !!(v.serviceType && v.serviceType.trim()));
        }
      } else if (hasOrderKeywords && commodityMatched.length > 0) {
        // Ada keyword order + ada vendor yg punya item matching di etalase
        vendors = commodityMatched;
        vendorFilterApplied = true;
        filterMode = "commodity";
      } else if (hasOrderKeywords) {
        // Ada keyword order tapi tidak ada vendor yang relevan → JANGAN tampilkan vendor tidak relevan
        vendors = [];
        vendorFilterApplied = true;
        filterMode = "commodity";
      } else if (productVendors.length > 0) {
        // Tidak ada keyword order, tampilkan semua vendor yg punya etalase produk
        vendors = productVendors;
        vendorFilterApplied = true;
        filterMode = "etalase";
      } else {
        // Tidak ada vendor dengan produk di etalase → fallback ke vendor berserviceType
        vendors = allWithFlag.filter((v) => !!(v.serviceType && v.serviceType.trim()));
      }

      // Get existing RFQs for this order
      const rfqs = await db.select({
        id: logisticOrderRfqsTable.id,
        rfqNumber: logisticOrderRfqsTable.rfqNumber,
        status: logisticOrderRfqsTable.status,
        createdAt: logisticOrderRfqsTable.createdAt,
      }).from(logisticOrderRfqsTable)
        .where(eq(logisticOrderRfqsTable.orderId, order.id))
        .orderBy(desc(logisticOrderRfqsTable.createdAt));

      return res.json({
        ...base,
        vendors,
        rfqs,
        vendorFilterApplied,
        filterMode,
        shipmentType: order.shipmentType,
        commodity: order.commodity,
      });
    }

    // compare_vendors: show vendor quotes for an RFQ
    if (link.actionType === "compare_vendors") {
      if (!link.rfqId) return res.status(400).json({ error: "rfqId diperlukan untuk compare_vendors" });

      const [rfq] = await db.select().from(logisticOrderRfqsTable)
        .where(eq(logisticOrderRfqsTable.id, link.rfqId));
      if (!rfq) return res.status(404).json({ error: "RFQ tidak ditemukan" });

      const vendorLinks = await db.select().from(rfqVendorLinksTable)
        .where(eq(rfqVendorLinksTable.rfqId, link.rfqId))
        .orderBy(sql`created_at ASC`);

      const vendorIds = vendorLinks.map((l) => l.vendorId);
      const vendors = vendorIds.length
        ? await db.select({ id: suppliersTable.id, name: suppliersTable.name, phone: suppliersTable.phone })
            .from(suppliersTable).where(inArray(suppliersTable.id, vendorIds))
        : [];
      const vendorMap = new Map(vendors.map((v) => [v.id, v]));

      const vendorRows = vendorLinks
        .sort((a, b) => {
          const pa = Number(a.offeredPrice ?? a.basicPrice ?? 9e9);
          const pb = Number(b.offeredPrice ?? b.basicPrice ?? 9e9);
          return pa - pb;
        })
        .map((l) => ({
          linkId: l.id,
          vendorId: l.vendorId,
          vendorName: vendorMap.get(l.vendorId)?.name ?? `Vendor #${l.vendorId}`,
          status: l.status,
          basicPrice: l.basicPrice ? Number(l.basicPrice) : null,
          offeredPrice: l.offeredPrice ? Number(l.offeredPrice) : null,
          eta: l.eta ?? null,
          notes: l.notes ?? null,
          submittedAt: l.submittedAt?.toISOString() ?? null,
        }));

      return res.json({
        ...base,
        rfq: {
          id: rfq.id,
          rfqNumber: rfq.rfqNumber,
          status: rfq.status,
        },
        vendors: vendorRows,
      });
    }

    // confirm_fulfillment: show vendor's submitted data for admin to confirm
    if (link && link.actionType === "confirm_fulfillment") {
      const [_vfLinkRow] = await db.select().from(vendorFulfillmentLinksTable)
        .where(eq(vendorFulfillmentLinksTable.orderId, order.id))
        .orderBy(desc(vendorFulfillmentLinksTable.createdAt))
        .limit(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vfLink = _vfLinkRow as any;

      // Build item breakdown for product orders
      let orderItemsBreakdown: {
        name: string; qty: number; unit: string;
        priceBase: number | null; subtotal: number | null; ppn: number | null; total: number | null;
      }[] = [];

      const rawItems = await db.select({
        serviceName: logisticOrderItemsTable.serviceName,
        category: logisticOrderItemsTable.category,
        inputData: logisticOrderItemsTable.inputData,
      }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));

      if (rawItems.length > 0 && vfLink?.vendorId) {
        const vendorCatalog = await db.select({
          name: vendorCatalogItemsTable.name,
          priceBase: vendorCatalogItemsTable.priceBase,
          unit: vendorCatalogItemsTable.unit,
        }).from(vendorCatalogItemsTable)
          .where(and(eq(vendorCatalogItemsTable.vendorId, vfLink.vendorId), eq(vendorCatalogItemsTable.isActive, true)));

        const isSingle = rawItems.length === 1;
        const revisedTotal = (vfLink.priceConfirmed === "revised" && vfLink.revisedPrice)
          ? Number(vfLink.revisedPrice) : null;

        orderItemsBreakdown = rawItems.map((item) => {
          const inputData = (item.inputData as Record<string, unknown>) ?? {};
          const qty = (() => {
            const q = inputData.qty ?? inputData.quantity ?? inputData.jumlah;
            return q != null ? (Number(q) || 1) : 1;
          })();
          const name = item.serviceName || item.category || "—";
          const nameLower = name.toLowerCase().trim();
          const catItem = vendorCatalog.find((c) => {
            const cn = c.name.toLowerCase().trim();
            return cn.includes(nameLower) || nameLower.includes(cn);
          }) ?? vendorCatalog[0];
          const priceBase = catItem ? parseFloat(String(catItem.priceBase)) : null;
          const unit = String(inputData.unit ?? catItem?.unit ?? "Unit");
          let subtotal: number | null = null;
          if (isSingle && revisedTotal != null) subtotal = revisedTotal;
          else if (priceBase != null) subtotal = Math.round(priceBase * qty);
          const ppn = subtotal != null ? Math.round(subtotal * PPN_RATE) : null;
          const total = subtotal != null && ppn != null ? subtotal + ppn : null;
          return { name, qty, unit, priceBase, subtotal, ppn, total };
        });
      }

      return res.json({
        ...base,
        orderItems: orderItemsBreakdown,
        vendorFulfillmentLink: vfLink ? {
          id: vfLink.id,
          serviceType: vfLink.serviceType,
          status: vfLink.status,
          stockConfirmed: vfLink.stockConfirmed ?? null,
          qtyConfirmed: vfLink.qtyConfirmed ?? null,
          readyDate: vfLink.readyDate ?? null,
          leadTime: vfLink.leadTime ?? null,
          warehouseLocation: vfLink.warehouseLocation ?? null,
          priceConfirmed: vfLink.priceConfirmed ?? null,
          revisedPrice: vfLink.revisedPrice ? Number(vfLink.revisedPrice) : null,
          notes: vfLink.notes ?? null,
          stockPhotoUrl: vfLink.stockPhotoUrl ?? null,
          invoiceUrl: vfLink.invoiceUrl ?? null,
          supportingDocUrl: vfLink.supportingDocUrl ?? null,
          submittedAt: vfLink.submittedAt?.toISOString() ?? null,
        } : null,
      });
    }

    // forward_vendor: show order + selected vendor to create fulfillment task
    if (link.actionType === "forward_vendor") {
      if (!link.rfqId) return res.status(400).json({ error: "rfqId diperlukan untuk forward_vendor" });

      const [rfq] = await db.select().from(logisticOrderRfqsTable)
        .where(eq(logisticOrderRfqsTable.id, link.rfqId));

      const selectedLinks = await db.select().from(rfqVendorLinksTable)
        .where(eq(rfqVendorLinksTable.rfqId, link.rfqId!));

      const selected = selectedLinks.find((l) => l.status === "selected");
      let selectedVendor = null;
      if (selected) {
        const [v] = await db.select({ id: suppliersTable.id, name: suppliersTable.name, phone: suppliersTable.phone })
          .from(suppliersTable).where(eq(suppliersTable.id, selected.vendorId));
        selectedVendor = v ?? null;
      }

      // Override harga order dengan catalog vendor — JANGAN tampilkan harga jual ke vendor
      let vendorAdjustedOrder = base.order;
      if (selected?.vendorId) {
        const catItems = await db.select({
          name: vendorCatalogItemsTable.name,
          kategori: vendorCatalogItemsTable.kategori,
          priceBase: vendorCatalogItemsTable.priceBase,
        }).from(vendorCatalogItemsTable)
          .where(and(eq(vendorCatalogItemsTable.vendorId, selected.vendorId), eq(vendorCatalogItemsTable.isActive, true)));

        if (catItems.length > 0) {
          const findVendorPrice = (svcName: string, catName: string): number | null => {
            const svc = svcName.toLowerCase().trim();
            const cat = catName.toLowerCase().trim();
            const match = catItems.find(c =>
              c.name.toLowerCase().trim() === svc ||
              c.name.toLowerCase().trim() === cat ||
              (c.kategori ?? "").toLowerCase().trim() === cat
            );
            if (match) return Number(match.priceBase);
            if (catItems.length === 1) return Number(catItems[0].priceBase);
            return null;
          };

          const vendorItems = base.order.items.map((it) => {
            const vp = findVendorPrice(it.serviceName, it.category);
            const qty = it.quantity != null ? parseFloat(it.quantity) : 1;
            const vendorSubtotal = vp != null ? vp * qty : null;
            return {
              ...it,
              unitPrice: vp != null ? String(vp) : null,
              subtotal: vendorSubtotal != null ? String(vendorSubtotal) : it.subtotal,
            };
          });

          const vendorPrices = vendorItems.map(i => i.subtotal != null ? parseFloat(i.subtotal) : null);
          const allPriced = vendorPrices.length > 0 && vendorPrices.every(v => v != null);
          const vendorGrandTotal = allPriced
            ? vendorPrices.reduce((s, v) => s + (v ?? 0), 0)
            : (order.grandTotal ? parseFloat(String(order.grandTotal)) : 0);

          // Exclusive PPN: vendorGrandTotal IS the DPP (base price), PPN dihitung di atasnya
          const vendorDpp = vendorGrandTotal > 0 ? vendorGrandTotal : null;
          const vendorTax = vendorDpp != null ? Math.round(vendorDpp * _TAX_RATE / 100) : null;
          const vendorGrandWithTax = vendorDpp != null && vendorTax != null ? vendorDpp + vendorTax : vendorGrandTotal;

          vendorAdjustedOrder = {
            ...base.order,
            items: vendorItems,
            grandTotal: String(vendorGrandWithTax),
            subtotalBeforeTax: vendorDpp != null ? String(vendorDpp) : base.order.subtotalBeforeTax,
            taxAmount: vendorTax != null ? String(vendorTax) : base.order.taxAmount,
          };
        }
      }

      return res.json({
        ...base,
        order: vendorAdjustedOrder,
        rfq: rfq ? { id: rfq.id, rfqNumber: rfq.rfqNumber, status: rfq.status } : null,
        selectedVendor,
        selectedVendorLink: selected ?? null,
      });
    }

    return res.json(base);
  } catch (err) {
    logger.error({ err }, "admin-action GET error");
    return res.status(500).json({ error: "Gagal memuat data" });
  }
});

const fmtRp = (n: number | null | string | undefined) => {
  const num = Number(n ?? 0);
  return `Rp ${Math.round(num).toLocaleString("id-ID")}`;
};

// ─── Public: POST /api/admin-action/:token ───────────────────────────────────
adminActionPublicRouter.post("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  await ensureTables();

  let _blastGuardOrderId: number | null = null;
  try {
    let link = (await db.select().from(adminActionLinksTable)
      .where(adminTokenWhere(token)))[0] ?? null;

    // Fallback: token mungkin publicRfqToken dari logistic_orders (WA direct link)
    let orderFromPublicToken: any = null;
    if (!link) {
      const ORDER_COLS = {
        id: logisticOrdersTable.id,
        orderNumber: logisticOrdersTable.orderNumber,
        companyName: logisticOrdersTable.companyName,
        customerName: logisticOrdersTable.customerName,
        email: logisticOrdersTable.email,
        phone: logisticOrdersTable.phone,
        shipmentType: logisticOrdersTable.shipmentType,
        origin: logisticOrdersTable.origin,
        destination: logisticOrdersTable.destination,
        commodity: logisticOrdersTable.commodity,
        status: logisticOrdersTable.status,
        publicRfqToken: logisticOrdersTable.publicRfqToken,
        grandTotal: logisticOrdersTable.grandTotal,
      };
      const [ord] = await db.select(ORDER_COLS).from(logisticOrdersTable)
        .where(eq(logisticOrdersTable.publicRfqToken, token))
        .limit(1);
      if (!ord) return res.status(404).json({ error: "Link tidak ditemukan" });
      orderFromPublicToken = ord;
    }

    if (link && link.expiresAt && link.expiresAt < new Date()) {
      logTokenAccess({ tokenType: "admin_action", tokenRef: token, entityId: link.id, action: "submit", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link sudah kadaluarsa" });
    }
    if (link && link.revokedAt) {
      logTokenAccess({ tokenType: "admin_action", tokenRef: token, entityId: link.id, action: "submit", outcome: "denied_revoked", req });
      return res.status(403).json({ error: "Link ini telah dicabut", isRevoked: true, revokedAt: link.revokedAt.toISOString() });
    }
    // compare_vendors and forward_vendor are single-use; review_order is multi-use
    if (link && link.actionType !== "review_order" && link.usedAt) {
      logTokenAccess({ tokenType: "admin_action", tokenRef: token, entityId: link.id, action: "submit", outcome: "denied_used", req });
      return res.status(409).json({ error: "Link sudah digunakan", isUsed: true, usedAt: link.usedAt?.toISOString() });
    }

    const order = orderFromPublicToken ?? (await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, link!.orderId)))[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const actionType = link?.actionType ?? "review_order";

    // ── review_order: create RFQ + blast to selected vendors ──────────────
    if (actionType === "review_order") {
      const { vendorIds, deadlineHours = 48 } = req.body as {
        vendorIds: number[];
        deadlineHours?: number;
      };
      if (!vendorIds?.length) return res.status(400).json({ error: "vendorIds wajib diisi" });

      // Guard: tolak jika blast untuk order yang sama sedang berlangsung
      // (mencegah 2 admin klik blast bersamaan → vendor terima WA ganda)
      if (blastInProgress.has(order.id)) {
        return res.status(409).json({
          error: "Blast RFQ untuk order ini sedang diproses. Tunggu beberapa detik lalu coba lagi.",
          code: "BLAST_IN_PROGRESS",
        });
      }
      blastInProgress.add(order.id);
      _blastGuardOrderId = order.id;
      // Auto-release setelah 60 detik sebagai safety net jika proses error
      const blastTimer = setTimeout(() => { blastInProgress.delete(order.id); _blastGuardOrderId = null; }, 60_000);

      // Create or reuse RFQ
      let rfq = await db.select().from(logisticOrderRfqsTable)
        .where(eq(logisticOrderRfqsTable.orderId, order.id))
        .then((r) => r[0]);

      if (!rfq) {
        const yr = new Date().getFullYear();
        const seq = Date.now().toString().slice(-5);
        const rfqNumber = `RFQ/${yr}/${seq}`;
        const [inserted] = await db.insert(logisticOrderRfqsTable).values({
          orderId: order.id,
          rfqNumber,
          status: "draft",
          vendorIds: vendorIds,
        }).returning();
        rfq = inserted!;
      }

      const vendors = await db.select().from(suppliersTable)
        .where(inArray(suppliersTable.id, vendorIds));
      const eligible = vendors.filter((v) => v.phone);

      const expiredAt = new Date(Date.now() + deadlineHours * 3600_000);
      const domain = getPreferredDomain() || "cstlogistic.co.id";

      const results: { vendorId: number; vendorName: string; sent: boolean }[] = [];

      for (const vendor of eligible) {
        const existing = await db.select().from(rfqVendorLinksTable)
          .where(eq(rfqVendorLinksTable.rfqId, rfq.id))
          .then((r) => r.find((l) => l.vendorId === vendor.id));

        let linkToken: string;
        if (existing) {
          linkToken = existing.token;
        } else {
          const { generateSecureToken } = await import("../lib/tokenUtils.js");
          linkToken = generateSecureToken();

          // Hitung basicPrice dari katalog vendor agar vendor lihat harga dasar, BUKAN harga jual
          const catItemsForVendor = await db.select({
            name: vendorCatalogItemsTable.name,
            kategori: vendorCatalogItemsTable.kategori,
            priceBase: vendorCatalogItemsTable.priceBase,
          }).from(vendorCatalogItemsTable)
            .where(and(eq(vendorCatalogItemsTable.vendorId, vendor.id), eq(vendorCatalogItemsTable.isActive, true)));

          let basicPriceForLink: string | null = null;
          if (catItemsForVendor.length > 0) {
            const rawItemsForPrice = await db.select({ serviceName: logisticOrderItemsTable.serviceName })
              .from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));
            const matchPrice = (svcName: string): number | null => {
              const svc = (svcName ?? "").toLowerCase().trim();
              const match = catItemsForVendor.find(c => c.name.toLowerCase().trim() === svc || (c.kategori ?? "").toLowerCase().trim() === svc);
              if (match) return Number(match.priceBase);
              if (catItemsForVendor.length === 1) return Number(catItemsForVendor[0].priceBase);
              return null;
            };
            const prices = rawItemsForPrice.map(i => matchPrice(i.serviceName ?? ""));
            if (prices.length > 0 && prices.every(p => p != null)) {
              basicPriceForLink = String(prices.reduce((s, p) => s + (p ?? 0), 0));
            } else if (catItemsForVendor.length === 1) {
              basicPriceForLink = String(catItemsForVendor[0].priceBase);
            }
          }

          await db.insert(rfqVendorLinksTable).values({
            rfqId: rfq.id,
            vendorId: vendor.id,
            token: linkToken,
            status: "waiting_response",
            expiredAt,
            basicPrice: basicPriceForLink ?? undefined,
          });
        }

        const formUrl = `https://${domain}/vendor-form/${linkToken}`;
        const shortUrl = await generateShortLink(formUrl, { context: "vendor_rfq", refType: "rfq", refId: String(rfq.id) });

        const rawItems = await db.select({
          serviceName: logisticOrderItemsTable.serviceName,
          subtotal: logisticOrderItemsTable.subtotal,
          inputData: logisticOrderItemsTable.inputData,
        }).from(logisticOrderItemsTable)
          .where(eq(logisticOrderItemsTable.orderId, order.id));

        const isProductOrder = (order.orderType ?? "") === "product";
        const serviceList = rawItems.length
          ? rawItems.map(i => `• ${i.serviceName}`).join("\n")
          : "";
        const orderItems = rawItems.length
          ? rawItems.map(i => {
              const inp = (i.inputData as Record<string, unknown> | null) ?? {};
              const qtyRaw = inp.qty ?? inp.quantity ?? inp.jumlah;
              return {
                name: i.serviceName ?? "",
                qty: qtyRaw != null ? Number(qtyRaw) || null : null,
                unit: inp.unit ? String(inp.unit) : null,
                subtotal: i.subtotal != null ? parseFloat(String(i.subtotal)) : null,
              };
            })
          : undefined;

        const orderData: LogisticOrderData = {
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName ?? "",
          companyName: order.companyName ?? "",
          email: order.email ?? "",
          phone: order.phone ?? "",
          orderType: order.orderType ?? undefined,
          shipmentType: order.shipmentType ?? "",
          origin: order.origin ?? "",
          destination: order.destination ?? "",
          commodity: order.commodity,
          cargoDescription: order.cargoDescription,
          grossWeight: !isProductOrder && order.grossWeight != null ? parseFloat(String(order.grossWeight)) : null,
          volumeCbm: !isProductOrder && order.volumeCbm != null ? parseFloat(String(order.volumeCbm)) : null,
          jumlahKoli: !isProductOrder ? (order.jumlahKoli ?? null) : null,
          grandTotal: order.grandTotal != null ? parseFloat(String(order.grandTotal)) : 0,
          serviceList,
          orderItems,
          requiredDate: order.requiredDate ?? null,
          notes: order.notes,
          jamOrder: order.jamOrder ?? null,
          createdAt: order.createdAt,
          publicRfqToken: order.publicRfqToken,
        };

        try {
          await sendVendorRequestNotification(orderData, vendor.name!, vendor.phone!, shortUrl);
          results.push({ vendorId: vendor.id, vendorName: vendor.name, sent: true });
        } catch (_e) {
          results.push({ vendorId: vendor.id, vendorName: vendor.name, sent: false });
        }
      }

      await db.update(logisticOrderRfqsTable).set({
        vendorIds,
        responseDeadline: expiredAt,
      }).where(eq(logisticOrderRfqsTable.id, rfq.id));
      await transitionRfqStatus(rfq.id, "vendor_blasted", { source: "adminAction:rfq_blast", actorType: "admin", force: true, forceReason: "RFQ blast membutuhkan force karena status awal bisa bervariasi" });

      // Activity log
      const sentNames = results.filter(r => r.sent).map(r => r.vendorName).join(", ");
      await db.insert(orderUpdatesTable).values({
        orderId: order.id,
        actorType: "admin",
        actorName: "Admin",
        status: "vendor_blasted",
        notes: `RFQ ${rfq.rfqNumber} di-blast ke ${results.filter(r => r.sent).length} vendor via mini form: ${sentNames}`,
        isPublic: false,
      }).catch(() => {});

      if (link) {
        // P0 atomic: conditional WHERE prevents double-submit race
        const consumed = await db.update(adminActionLinksTable)
          .set({ usedAt: new Date() })
          .where(and(
            adminTokenWhere(token),
            isNull(adminActionLinksTable.usedAt),
            isNull(adminActionLinksTable.revokedAt),
          ))
          .returning({ id: adminActionLinksTable.id });
        if (consumed.length === 0) {
          return res.status(409).json({ error: "Link sudah digunakan atau tidak valid" });
        }
      }

      // Create compare_vendors link for next step
      const compareToken = await createAdminActionLink(order.id, "compare_vendors", rfq.id, 72);
      const compareUrl = getAdminActionUrl(compareToken);
      const compareShort = await generateShortLink(compareUrl, { context: "admin_action", refType: "rfq", refId: String(rfq.id) });

      const adminGroupWa = await getAdminGroupWa();
      if (adminGroupWa) {
        const sentCount = results.filter((r) => r.sent).length;
        sendWhatsApp(adminGroupWa,
          `✅ RFQ ${rfq.rfqNumber} telah di-blast ke ${sentCount} vendor\n` +
          `Order: ${order.orderNumber}`
        ).catch(() => {});
      }

      // Release blast guard
      clearTimeout(blastTimer);
      blastInProgress.delete(order.id);

      broadcastInvalidation("rfq", order.id);
      broadcastInvalidation("logistic_orders", order.id);
      return res.json({ ok: true, rfqId: rfq.id, rfqNumber: rfq.rfqNumber, results, compareUrl: compareShort });
    }

    // ── compare_vendors: select vendor + (optionally) send customer quote ──
    if (actionType === "compare_vendors") {
      const { linkId, sellingPrice, quoteNotes, sendQuoteToCustomer = false } = req.body as {
        linkId: number;
        sellingPrice?: number;
        quoteNotes?: string;
        sendQuoteToCustomer?: boolean;
      };
      if (!linkId) return res.status(400).json({ error: "linkId wajib diisi" });
      if (!link.rfqId) return res.status(400).json({ error: "rfqId tidak ada di link ini" });

      const [vendorLink] = await db.select().from(rfqVendorLinksTable)
        .where(eq(rfqVendorLinksTable.id, linkId));
      if (!vendorLink) return res.status(404).json({ error: "Vendor link tidak ditemukan" });
      // Scope check: vendorLink must belong to the RFQ tied to this token
      if (vendorLink.rfqId !== link.rfqId) {
        return res.status(403).json({ error: "Vendor link tidak sesuai dengan RFQ pada token ini" });
      }

      const [rfq] = await db.select().from(logisticOrderRfqsTable)
        .where(eq(logisticOrderRfqsTable.id, link.rfqId));
      if (!rfq) return res.status(404).json({ error: "RFQ tidak ditemukan" });

      const [vendor] = await db.select().from(suppliersTable)
        .where(eq(suppliersTable.id, vendorLink.vendorId));

      // P0 atomic claim — BEFORE any mutations (single-use token; prevents TOCTOU double-submit)
      const claimed = await db.update(adminActionLinksTable)
        .set({ usedAt: new Date() })
        .where(and(
          adminTokenWhere(token),
          isNull(adminActionLinksTable.usedAt),
          isNull(adminActionLinksTable.revokedAt),
        ))
        .returning({ id: adminActionLinksTable.id });
      if (claimed.length === 0) {
        return res.status(409).json({ error: "Link sudah digunakan atau tidak valid" });
      }

      // Mark selected
      await transitionVendorLinkStatus(linkId, "selected", { source: "adminAction:compare_vendors_select", actorType: "admin", force: true, forceReason: "Admin memilih vendor pemenang dari halaman compare vendors" });

      const otherLinks = await db.select({
        id: rfqVendorLinksTable.id,
        status: rfqVendorLinksTable.status,
        vendorId: rfqVendorLinksTable.vendorId,
      }).from(rfqVendorLinksTable)
        .where(eq(rfqVendorLinksTable.rfqId, link.rfqId!));

      // Status yang menandakan vendor sudah berikan penawaran (layak dapat notifikasi)
      const RESPONDED_STATUSES = ["accepted_basic_price", "counter_offer", "late_response"];

      for (const other of otherLinks) {
        if (other.id !== linkId && !["rejected", "expired", "late_response"].includes(other.status)) {
          await transitionVendorLinkStatus(other.id, "not_selected", { source: "adminAction:compare_vendors_deselect", actorType: "admin", force: true, forceReason: "Admin memilih vendor lain; vendor ini dinonaktifkan dari kompetisi" });
          // Kirim WA notif hanya ke vendor yang sudah merespons dengan penawaran
          if (RESPONDED_STATUSES.includes(other.status) && other.vendorId) {
            db.select({ name: suppliersTable.name, phone: suppliersTable.phone })
              .from(suppliersTable)
              .where(eq(suppliersTable.id, other.vendorId))
              .then(([vRow]) => {
                if (vRow?.phone) {
                  sendVendorNotSelectedWa({
                    vendorName: vRow.name ?? `Vendor #${other.vendorId}`,
                    vendorPhone: vRow.phone,
                    rfqNumber: rfq.rfqNumber,
                    orderNumber: order.orderNumber,
                    route: `${order.origin ?? "—"} → ${order.destination ?? "—"}`,
                  }).catch(() => {});
                }
              })
              .catch(() => {});
          }
        }
      }

      await transitionRfqStatus(link.rfqId!, "vendor_selected", { source: "adminAction:compare_vendors", actorType: "admin", force: true, forceReason: "Admin menyelesaikan pemilihan vendor; RFQ dipindahkan ke vendor_selected" });

      if (sellingPrice) {
        await db.update(logisticOrdersTable)
          .set({ finalSellingPrice: String(sellingPrice), approvedVendorId: vendorLink.vendorId })
          .where(eq(logisticOrdersTable.id, order.id));
      }

      // Optionally send quote to customer
      let quoteToken: string | null = null;
      let quoteShortUrl: string | null = null;
      let waSent = false;
      if (sendQuoteToCustomer && sellingPrice) {
        const finalPrice = sellingPrice;
        const yr = new Date().getFullYear();
        const seq = Date.now().toString().slice(-5);
        const quotationNumber = `QUO/${yr}/${seq}`;
        const { generateSecureToken: genQuoteTok } = await import("../lib/tokenUtils.js");
        quoteToken = genQuoteTok();

        await db.insert(customerQuoteLinksTable).values({
          rfqId: rfq.id,
          orderId: order.id,
          token: quoteToken,
          status: "pending",
          finalCustomerPrice: String(finalPrice),
          vendorCost: String(vendorLink.offeredPrice ?? vendorLink.basicPrice ?? 0),
          quoteNotes: quoteNotes ?? null,
          eta: vendorLink.eta ?? null,
          quotationNumber,
        } as any);

        await db.execute(sql`
          UPDATE logistic_order_rfqs
          SET status = 'customer_quoted', quoted_price = ${finalPrice}, quoted_at = NOW(), quote_notes = ${quoteNotes ?? null}
          WHERE id = ${link.rfqId}
        `);

        const domain = getPreferredDomain() || "cstlogistic.co.id";
        const quoteUrl = `https://${domain}/customer-quote/${quoteToken}`;
        quoteShortUrl = await generateShortLink(quoteUrl, { context: "customer_quote", refType: "rfq", refId: String(rfq.id) });

        const _ppnNominal = Math.round(finalPrice * PPN_RATE / (1 + PPN_RATE));
        const _orderData: LogisticOrderData = {
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName ?? "",
          companyName: order.companyName ?? "",
          email: order.email ?? "",
          phone: order.phone ?? "",
          orderType: order.orderType ?? undefined,
          shipmentType: order.shipmentType ?? "",
          origin: order.origin ?? "",
          destination: order.destination ?? "",
          commodity: order.commodity ?? null,
          grandTotal: finalPrice,
          serviceList: "",
        };
        await sendCustomerApprovalNotification(
          _orderData,
          fmtRp(finalPrice),
          quoteShortUrl!,
          { sellingPriceNum: finalPrice, ppnNominalNum: _ppnNominal, ppnPct: 11 },
        ).then(() => { waSent = true; }).catch(() => {});
      }

      // Activity log
      await db.insert(orderUpdatesTable).values({
        orderId: order.id,
        actorType: "admin",
        actorName: "Admin",
        status: "vendor_selected",
        notes: `Vendor dipilih: ${vendor?.name ?? `#${vendorLink.vendorId}`}${sellingPrice ? ` | Harga jual: ${fmtRp(sellingPrice)}` : ""}${sendQuoteToCustomer ? " | Penawaran terkirim ke customer" : ""}`,
        isPublic: false,
      }).catch(() => {});

      // Create forward_vendor link for next step
      const fwdToken = await createAdminActionLink(order.id, "forward_vendor", rfq.id, 72);
      const fwdUrl = getAdminActionUrl(fwdToken);
      const fwdShort = await generateShortLink(fwdUrl, { context: "admin_action", refType: "rfq", refId: String(rfq.id) });


      if (vendor?.phone) {
        const _awardDomain = getPreferredDomain() || "cstlogistic.co.id";
        const _vendorFormUrl = `https://${_awardDomain}/vendor-form/${vendorLink.token}`;
        const _vendorFormShort = await generateShortLink(_vendorFormUrl, {
          context: "vendor_rfq",
          refType: "rfq",
          refId: String(rfq.id),
        }).catch(() => _vendorFormUrl);
        sendVendorAwardedWa({
          vendorName: vendor.name ?? `Vendor #${vendorLink.vendorId}`,
          vendorPhone: vendor.phone,
          rfqNumber: rfq.rfqNumber,
          orderNumber: order.orderNumber,
          shipmentType: order.shipmentType ?? "—",
          origin: order.origin ?? "—",
          destination: order.destination ?? "—",
          vendorCost: vendorLink.offeredPrice ?? vendorLink.basicPrice,
          eta: vendorLink.eta ?? null,
          notes: vendorLink.notes ?? null,
          fulfillUrl: _vendorFormShort,
        }).catch(() => {});
      }

      return res.json({
        ok: true,
        vendorName: vendor?.name,
        sellingPrice,
        quoteToken,
        quoteUrl: quoteShortUrl,
        forwardVendorUrl: fwdShort,
        waSent,
      });
    }

    // ── forward_vendor: create fulfillment task link for vendor ───────────
    if (actionType === "forward_vendor") {
      const { vendorId, serviceType, expiresInHours = 72 } = req.body as {
        vendorId: number;
        serviceType: string;
        expiresInHours?: number;
      };
      if (!vendorId || !serviceType) {
        return res.status(400).json({ error: "vendorId dan serviceType wajib" });
      }

      const { vendorFulfillmentLinksTable } = await import("@workspace/db");
      const { generateSecureToken: genFulfillTok } = await import("../lib/tokenUtils.js");
      const fulfillToken = genFulfillTok();
      const expiresAt = new Date(Date.now() + expiresInHours * 3600_000);

      // P0 atomic claim — BEFORE any mutations (single-use token; prevents TOCTOU double-submit)
      const claimedFwd = await db.update(adminActionLinksTable)
        .set({ usedAt: new Date() })
        .where(and(
          adminTokenWhere(token),
          isNull(adminActionLinksTable.usedAt),
          isNull(adminActionLinksTable.revokedAt),
        ))
        .returning({ id: adminActionLinksTable.id });
      if (claimedFwd.length === 0) {
        return res.status(409).json({ error: "Link sudah digunakan atau tidak valid" });
      }

      const [insertedFulfillLink] = await db.insert(vendorFulfillmentLinksTable).values({
        token: fulfillToken,
        orderId: order.id,
        vendorId,
        serviceType,
        status: "pending",
        expiresAt,
      }).returning({ id: vendorFulfillmentLinksTable.id });

      // Phase 3D: order_links — logistic_order → vendor_fulfillment_link (fire-and-forget)
      if (insertedFulfillLink?.id) {
        void import("../lib/services/orderLinkService.js").then(({ createOrderLink }) =>
          createOrderLink({
            sourceTable: "logistic_orders",
            sourceId: order.id,
            targetTable: "vendor_fulfillment_links",
            targetId: insertedFulfillLink.id,
            linkType: "logistic_order_to_fulfillment_link",
            createdBy: "adminAction:forward_vendor",
          })
        ).catch(() => {}); // non-fatal
      }

      const domain = getPreferredDomain() || "cstlogistic.co.id";
      const fulfillUrl = `https://${domain}/vendor-fulfillment/${fulfillToken}`;
      const shortUrl = await generateShortLink(fulfillUrl, {
        context: "vendor_fulfillment",
        refType: "order",
        refId: order.orderNumber,
      });

      const [vendor] = await db.select().from(suppliersTable)
        .where(eq(suppliersTable.id, vendorId));

      // Fetch items untuk breakdown harga di WA vendor
      const _fwdItemRows = await db.select({
        serviceName: logisticOrderItemsTable.serviceName,
        subtotal: logisticOrderItemsTable.subtotal,
        inputData: logisticOrderItemsTable.inputData,
      }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, order.id));
      const _fxPrice = (inp: Record<string, unknown> | null): number | null => { if (!inp) return null; const p = inp.price ?? inp.productPrice ?? inp.unitPrice ?? inp.sellingPrice ?? inp.basicPrice ?? null; if (typeof p === "number") return p > 0 ? p : null; if (typeof p === "string") { const n = parseFloat(p); return !isNaN(n) && n > 0 ? n : null; } return null; };
      const _fwdItems = _fwdItemRows.flatMap((row) => {
        const inp = row.inputData as Record<string, unknown> | null;
        const qty = (() => { if (!inp) return 1; const v = inp.qty ?? inp.quantity; const n = parseFloat(String(v ?? "")); return isNaN(n) || n <= 0 ? 1 : n; })();
        const subtotalVal = Number(row.subtotal ?? 0);
        const price = _fxPrice(inp) ?? (subtotalVal > 0 && qty > 0 ? Math.round(subtotalVal / qty) : null);
        if (!price) return [];
        const unit = inp?.unit != null ? String(inp.unit) : "unit";
        return [{ name: row.serviceName ?? "Produk", qty, unit, basicPrice: price, taxRate: TAX_RATE_DECIMAL }];
      });

      const _resolvedSnapshot = await resolveTemplateSnapshot(order.id, order.templateSnapshot as Record<string, unknown> | null);
      if (vendor?.phone) {
        sendVendorAssignmentNotification(
          order.orderNumber,
          order.origin ?? "—",
          order.destination ?? "—",
          order.shipmentType ?? serviceType,
          shortUrl,
          vendor.phone,
          undefined,
          _fwdItems,
          undefined,
          undefined,
          undefined,
          _resolvedSnapshot,
        ).catch(() => {});
      }

      // Activity log
      await db.insert(orderUpdatesTable).values({
        orderId: order.id,
        actorType: "admin",
        actorName: "Admin",
        status: "assigned_to_vendor",
        notes: `Link fulfillment dikirim ke vendor ${vendor?.name ?? `#${vendorId}`} (${serviceType}) via mini form`,
        isPublic: false,
      }).catch(() => {});

      return res.json({ ok: true, fulfillToken, fulfillUrl: shortUrl, vendorName: vendor?.name });
    }

    // confirm_fulfillment: update order → "In Progress" + WA to customer + WA to admin group
    if (actionType === "confirm_fulfillment") {
      if ((order as any).status === "In Progress") {
        return res.status(409).json({ error: "Order sudah dikonfirmasi sebelumnya." });
      }

      // P0 atomic claim — BEFORE any mutations (single-use token; prevents TOCTOU double-submit)
      if (link) {
        const claimedCf = await db.update(adminActionLinksTable)
          .set({ usedAt: new Date() })
          .where(and(
            adminTokenWhere(token),
            isNull(adminActionLinksTable.usedAt),
            isNull(adminActionLinksTable.revokedAt),
          ))
          .returning({ id: adminActionLinksTable.id });
        if (claimedCf.length === 0) {
          return res.status(409).json({ error: "Link sudah digunakan atau tidak valid" });
        }
      }

      await transitionLogisticOrderStatus(order.id, "In Progress", { source: "adminAction:confirm_fulfillment", actorType: "admin", force: true, forceReason: "Admin mengkonfirmasi fulfillment via action link; status dipaksa ke In Progress" });
      updateOrderProgress(order.id, "IN_PROGRESS", "admin", "Admin", "Admin mengkonfirmasi fulfillment vendor. Order sedang diproses.").catch(() => {});
      await transitionLogisticOrderStatus(order.id, "In Progress", { source: "adminAction:confirm_fulfillment", actorType: "admin" });

      await db.insert(orderUpdatesTable).values({
        orderId: order.id,
        actorType: "admin",
        actorName: "Admin",
        status: "In Progress",
        notes: "Admin mengkonfirmasi fulfillment vendor via mini form. Order sedang diproses.",
        isPublic: true,
      });

      // Ambil data vendor fulfillment untuk dimasukkan ke WA admin
      const [_vfLinkRow2] = await db.select().from(vendorFulfillmentLinksTable)
        .where(eq(vendorFulfillmentLinksTable.orderId, order.id))
        .orderBy(desc(vendorFulfillmentLinksTable.createdAt))
        .limit(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vfLink = _vfLinkRow2 as any;

      let vendorNameForMsg: string | null = null;
      if (vfLink?.vendorId) {
        const [vRow] = await db.select({ name: suppliersTable.name })
          .from(suppliersTable).where(eq(suppliersTable.id, vfLink.vendorId));
        vendorNameForMsg = vRow?.name ?? null;
      }

      const domain = getPreferredDomain() || "cstlogistic.co.id";

      // Cari vendor fulfillment link terbaru untuk order ini
      const [vfLinkForUrl] = await db.select({
        token: vendorFulfillmentLinksTable.token,
      }).from(vendorFulfillmentLinksTable)
        .where(eq(vendorFulfillmentLinksTable.orderId, order.id))
        .orderBy(desc(vendorFulfillmentLinksTable.createdAt))
        .limit(1);

      // Cari short link vendor fulfillment dari tabel short_links
      let detailOrderUrl: string;
      if (vfLinkForUrl?.token) {
        const { shortLinksTable } = await import("@workspace/db/schema");
        const vfLongUrl = `https://${domain}/vendor-fulfillment/${vfLinkForUrl.token}`;
        const [sl] = await db.select({ code: shortLinksTable.code })
          .from(shortLinksTable)
          .where(eq(shortLinksTable.targetUrl, vfLongUrl))
          .limit(1);
        detailOrderUrl = sl?.code
          ? `https://${domain}/q/${sl.code}`
          : vfLongUrl;
      } else {
        detailOrderUrl = `https://${domain}/bizportal/logistics/orders/${order.id}`;
      }

      // WA ke admin group
      const adminGroupWa3 = await getAdminGroupWa();
      if (adminGroupWa3) {
        const ln = "\n";
        const sep = "━━━━━━━━━━━━━━━━━━";
        let fulfillSummary = "";
        if (vfLink) {
          const STOCK_LABEL: Record<string, string> = {
            all: "Tersedia Semua ✅", partial: "Tersedia Sebagian ⚠️", none: "Tidak Tersedia ❌",
          };
          const lines: string[] = [];
          if (vfLink.stockConfirmed) lines.push(`📦 Stok       : ${STOCK_LABEL[vfLink.stockConfirmed as string] ?? vfLink.stockConfirmed}`);
          if (vfLink.readyDate)      lines.push(`📅 Siap Kirim : ${vfLink.readyDate}`);
          if (vfLink.leadTime)       lines.push(`⏱ Lead Time  : ${vfLink.leadTime}`);
          if (vfLink.driverName)     lines.push(`👤 Driver     : ${vfLink.driverName}`);
          if (vfLink.plateNumber)    lines.push(`🚛 Plat       : ${vfLink.plateNumber}`);
          if (vfLink.pickupTime)     lines.push(`⏰ Pickup     : ${vfLink.pickupTime}`);
          if (vfLink.carrierName)    lines.push(`🏢 Carrier    : ${vfLink.carrierName}`);
          if (vfLink.awbBlNumber)    lines.push(`📄 AWB/BL     : ${vfLink.awbBlNumber}`);
          if (vfLink.etd)            lines.push(`📅 ETD        : ${vfLink.etd}`);
          if (vfLink.eta)            lines.push(`📅 ETA        : ${vfLink.eta}`);
          if ((vfLink as any).priceConfirmed === "agree")   lines.push(`💰 Harga      : Setuju harga asal`);
          else if ((vfLink as any).priceConfirmed === "revised") lines.push(`💰 Revisi Harga: ${fmtRp((vfLink as any).revisedPrice)}`);
          if (vfLink.notes)          lines.push(`📝 Catatan    : ${vfLink.notes}`);
          if (lines.length > 0) fulfillSummary = lines.join(ln) + ln;
        }

        const adminWaMsg =
          `✅ *Fulfillment Dikonfirmasi — Order In Progress*` + ln + sep + ln +
          `No. Order  : \`${order.orderNumber}\`` + ln +
          `Customer   : ${order.customerName}` + ln +
          ((order.origin && order.destination) ? `Rute       : ${order.origin} → ${order.destination}` + ln : "") +
          (vendorNameForMsg ? `Vendor     : *${vendorNameForMsg}*` + ln : "") +
          sep + ln +
          fulfillSummary +
          sep + ln +
          `📋 Detail order:\n${detailOrderUrl}`;

        sendWhatsApp(adminGroupWa3, adminWaMsg).catch((e) =>
          logger.warn({ e }, "confirm_fulfillment WA to admin group failed")
        );
      }

      // WA ke customer — sertakan link tracking spesifik order
      const customerPhone = ((order as any).phone ?? "").trim();
      if (customerPhone) {
        // Ambil atau buat customer tracking token
        let trackingUrl = `https://${domain}/track`;
        try {
          let [existingLink] = await db.select({ token: customerOrderLinksTable.token })
            .from(customerOrderLinksTable)
            .where(eq(customerOrderLinksTable.orderId, order.id))
            .orderBy(desc(customerOrderLinksTable.createdAt))
            .limit(1);
          if (!existingLink) {
            const { generateSecureToken: genTrackTok } = await import("../lib/tokenUtils.js");
            const newToken = genTrackTok();
            await db.insert(customerOrderLinksTable).values({ orderId: order.id, token: newToken });
            existingLink = { token: newToken };
          }
          trackingUrl = `https://${domain}/order-track/${existingLink.token}`;
        } catch (e) {
          logger.warn({ e }, "confirm_fulfillment: gagal ambil/buat tracking token, pakai fallback URL");
        }

        // Ringkasan fulfillment yang relevan untuk customer
        const STOCK_LABEL_C: Record<string, string> = {
          all: "Tersedia Semua ✅", partial: "Tersedia Sebagian ⚠️", none: "Tidak Tersedia ❌",
        };
        const fulfillLines: string[] = [];
        if (vfLink?.stockConfirmed) fulfillLines.push(`📦 Status Stok  : ${STOCK_LABEL_C[vfLink.stockConfirmed as string] ?? vfLink.stockConfirmed}`);
        if (vfLink?.readyDate)     fulfillLines.push(`📅 Siap Kirim   : ${vfLink.readyDate}`);
        if (vfLink?.leadTime)      fulfillLines.push(`⏱ Lead Time    : ${vfLink.leadTime}`);
        if (vfLink?.driverName)    fulfillLines.push(`👤 Driver       : ${vfLink.driverName}`);
        if (vfLink?.plateNumber)   fulfillLines.push(`🚛 Plat Nomor   : ${vfLink.plateNumber}`);
        if (vfLink?.pickupTime)    fulfillLines.push(`⏰ Est. Pickup  : ${vfLink.pickupTime}`);
        if (vfLink?.carrierName)   fulfillLines.push(`🏢 Carrier      : ${vfLink.carrierName}`);
        if (vfLink?.awbBlNumber)   fulfillLines.push(`📄 AWB/BL No.   : ${vfLink.awbBlNumber}`);
        if (vfLink?.etd)           fulfillLines.push(`📅 ETD          : ${vfLink.etd}`);
        if (vfLink?.eta)           fulfillLines.push(`📅 ETA          : ${vfLink.eta}`);
        if (vfLink?.notes)         fulfillLines.push(`📝 Catatan      : ${vfLink.notes}`);
        const fulfillSummaryC = fulfillLines.length > 0
          ? `\n━━━━━━━━━━━━━━━━━━\n${fulfillLines.join("\n")}\n━━━━━━━━━━━━━━━━━━`
          : "";

        const waMsg =
          `🚀 *Order Anda Sedang Diproses — B2B Marketplace and Logistic*\n\n` +
          `Halo ${order.customerName},\n\n` +
          `Order *${order.orderNumber}* (${order.shipmentType || "—"}) telah dikonfirmasi dan sedang diproses.\n` +
          ((order.origin && order.destination) ? `Rute: ${order.origin} → ${order.destination}\n` : "") +
          fulfillSummaryC +
          `\n\nPantau status order Anda:\n${trackingUrl}`;
        sendWhatsApp(customerPhone, waMsg).catch((e) =>
          logger.warn({ e }, "confirm_fulfillment WA to customer failed")
        );
      }

      // WA ke driver (jika driverPhone tersedia di vendor fulfillment link)
      if (vfLink?.driverPhone) {
        const driverPhoneNorm = normalizePhone(vfLink.driverPhone);
        const { generateSecureToken: genDriverTok } = await import("../lib/tokenUtils.js");
        const driverToken = genDriverTok();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS driver_progress_tokens (
            id           SERIAL PRIMARY KEY,
            token        TEXT NOT NULL UNIQUE,
            order_id     INTEGER NOT NULL,
            driver_name  TEXT,
            driver_phone TEXT,
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            expires_at   TIMESTAMPTZ NOT NULL
          )
        `);
        await db.execute(sql`
          INSERT INTO driver_progress_tokens (token, order_id, driver_name, driver_phone, expires_at)
          VALUES (${driverToken}, ${order.id}, ${vfLink.driverName ?? null}, ${driverPhoneNorm}, ${expiresAt})
          ON CONFLICT (token) DO NOTHING
        `);
        const driverLink = `https://${process.env.REPLIT_DEV_DOMAIN || domain}/driver-progress/${driverToken}`;
        const driverWaMsg =
          `🚚 *Tugas Pengiriman — B2B Marketplace and Logistic*\n\n` +
          `Halo${vfLink.driverName ? ` ${vfLink.driverName}` : ""},\n\n` +
          `Order *${order.orderNumber}* siap untuk proses pengiriman.\n` +
          ((order.origin && order.destination) ? `Rute: ${order.origin} → ${order.destination}\n` : "") +
          `\nUpdate status pengiriman via link berikut:\n${driverLink}`;
        sendWhatsApp(driverPhoneNorm, driverWaMsg).catch((e) =>
          logger.warn({ e, driverPhoneNorm }, "confirm_fulfillment WA to driver failed")
        );
      }

      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "actionType tidak dikenal" });
  } catch (err) {
    if (_blastGuardOrderId !== null) blastInProgress.delete(_blastGuardOrderId);
    logger.error({ err }, "admin-action POST error");
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Gagal memproses aksi", detail: msg });
  }
});
