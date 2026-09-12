import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { documentUpload } from "../lib/uploadMiddleware.js";

const upload = documentUpload(10);
const storage = new ObjectStorageService();

const submitLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

export const oceanFreightVendorFormRouter = Router();

// ── GET /:token ───────────────────────────────────────────────────────────────
oceanFreightVendorFormRouter.get("/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  if (!token || !/^[a-f0-9]{48}$/i.test(token)) {
    return res.status(400).json({ error: "Token tidak valid" });
  }
  try {
    const { rows: subs } = await db.execute(sql`
      SELECT s.*, v.name AS vendor_name_db, v.phone AS vendor_phone
      FROM ocean_freight_rate_submissions s
      LEFT JOIN suppliers v ON v.id = s.vendor_id
      WHERE s.token = ${token}
    `);
    if (!subs.length) return res.status(404).json({ error: "Link tidak ditemukan" });
    const sub = subs[0] as any;
    if (!sub.is_active) return res.status(410).json({ error: "Link sudah tidak aktif" });

    const { rows: rfqs } = await db.execute(sql`SELECT * FROM ocean_freight_rfqs WHERE id = ${sub.rfq_id}`);
    if (!rfqs.length) return res.status(404).json({ error: "RFQ tidak ditemukan" });
    const rfq = rfqs[0] as any;

    if (rfq.response_deadline && new Date() > new Date(rfq.response_deadline)) {
      return res.status(410).json({ error: "Batas waktu pengisian sudah lewat" });
    }

    const { rows: orders } = await db.execute(sql`
      SELECT id, order_number, origin_city, origin_port, destination_city, destination_port,
             trade_type, service_mode, shipment_type, container_type, container_qty,
             total_cbm, gross_weight, koli, commodity, cargo_condition,
             selected_additional_services, etd_preferred
      FROM ocean_freight_orders WHERE id = ${sub.order_id}
    `);
    if (!orders.length) return res.status(404).json({ error: "Order tidak ditemukan" });

    if (!sub.form_opened_at) {
      await db.execute(sql`UPDATE ocean_freight_rate_submissions SET form_opened_at = NOW() WHERE token = ${token}`);
    }

    return res.json({
      token,
      submission: sub,
      rfq,
      order: orders[0],
      vendor_name: sub.vendor_name_db ?? sub.vendor_name,
    });
  } catch (err) {
    logger.error({ err }, "[ocean-freight-vendor-form] GET /:token");
    return res.status(500).json({ error: "Gagal memuat form" });
  }
});

// ── POST /:token ──────────────────────────────────────────────────────────────
oceanFreightVendorFormRouter.post(
  "/:token",
  submitLimit,
  upload.single("attachment"),
  async (req: Request, res: Response) => {
    const token = String(req.params.token ?? "");
    if (!token || !/^[a-f0-9]{48}$/i.test(token)) {
      return res.status(400).json({ error: "Token tidak valid" });
    }
    try {
      const { rows: subs } = await db.execute(sql`
        SELECT * FROM ocean_freight_rate_submissions WHERE token = ${token}
      `);
      if (!subs.length) return res.status(404).json({ error: "Link tidak ditemukan" });
      const sub = subs[0] as any;
      if (!sub.is_active) return res.status(410).json({ error: "Link sudah tidak aktif" });
      if (sub.status === "submitted") return res.status(409).json({ error: "Rate sudah pernah disubmit" });

      const b = req.body ?? {};
      if (!b.ocean_freight_amount || Number(b.ocean_freight_amount) <= 0)
        return res.status(400).json({ error: "ocean_freight_amount wajib > 0" });
      if (!b.currency) return res.status(400).json({ error: "currency wajib" });
      if (String(b.currency) !== "IDR" && (!b.exchange_rate || Number(b.exchange_rate) <= 0))
        return res.status(400).json({ error: "exchange_rate wajib jika currency bukan IDR" });

      let attachmentUrl: string | null = null;
      if (req.file) {
        try {
          const key = `ocean-freight-submissions/${sub.order_id}/${token}-${req.file.originalname}`;
          attachmentUrl = (await (storage as any).uploadFile(key, req.file.buffer, req.file.mimetype, true)) ?? null;
        } catch (_) {}
      }

      const oceanAmt = Number(b.ocean_freight_amount);
      const exr      = Number(b.exchange_rate ?? 16500);
      const curr     = String(b.currency ?? "USD");

      const totalAmt = oceanAmt
        + Number(b.thc_origin ?? 0)
        + Number(b.thc_destination ?? 0)
        + Number(b.doc_fee ?? 0)
        + Number(b.bl_fee ?? 0)
        + Number(b.do_fee ?? 0)
        + Number(b.handling_fee ?? 0)
        + Number(b.trucking_pickup ?? 0)
        + Number(b.trucking_delivery ?? 0)
        + Number(b.customs_clearance_fee ?? 0)
        + Number(b.surcharge_amount ?? 0);

      const totalIdr = curr === "IDR" ? totalAmt : totalAmt * exr;

      await db.execute(sql`
        UPDATE ocean_freight_rate_submissions SET
          rate_source_type = ${b.rate_source_type ?? "forwarder_partner"},
          rate_source_name = ${b.rate_source_name ?? null},
          carrier = ${b.carrier ?? null},
          ocean_freight_amount = ${oceanAmt},
          currency = ${curr},
          exchange_rate = ${exr},
          validity_date = ${b.validity_date ?? null},
          vessel_name = ${b.vessel_name ?? null},
          voyage = ${b.voyage ?? null},
          etd = ${b.etd ?? null},
          eta = ${b.eta ?? null},
          transit_days = ${b.transit_days ? Number(b.transit_days) : null},
          direct_or_transshipment = ${b.direct_or_transshipment ?? "direct"},
          thc_origin = ${Number(b.thc_origin ?? 0)},
          thc_destination = ${Number(b.thc_destination ?? 0)},
          doc_fee = ${Number(b.doc_fee ?? 0)},
          bl_fee = ${Number(b.bl_fee ?? 0)},
          do_fee = ${Number(b.do_fee ?? 0)},
          handling_fee = ${Number(b.handling_fee ?? 0)},
          trucking_pickup = ${Number(b.trucking_pickup ?? 0)},
          trucking_delivery = ${Number(b.trucking_delivery ?? 0)},
          customs_clearance_fee = ${Number(b.customs_clearance_fee ?? 0)},
          surcharge_amount = ${Number(b.surcharge_amount ?? 0)},
          notes = ${b.notes ?? null},
          attachment_url = ${attachmentUrl},
          total_amount = ${totalAmt},
          total_amount_idr = ${totalIdr},
          status = 'submitted',
          submitted_at = NOW(),
          submitter_ip = ${req.ip ?? null},
          updated_at = NOW()
        WHERE token = ${token}
      `);

      await db.execute(sql`
        UPDATE ocean_freight_orders SET status = 'rate_received', updated_at = NOW()
        WHERE id = ${sub.order_id} AND status NOT IN ('quoted','approved','booked','completed','cancelled')
      `);

      try {
        const adminGroup = await getAdminGroupWa();
        if (adminGroup) {
          const msg = [
            `📦 *Rate Submission Ocean Freight*`,
            `Vendor: ${b.rate_source_name ?? sub.vendor_name ?? "Unknown"}`,
            `Carrier: ${b.carrier ?? "-"}`,
            `Ocean Freight: ${curr} ${Number(oceanAmt).toLocaleString("id-ID")}`,
            `Total IDR: ${Number(totalIdr).toLocaleString("id-ID")}`,
            `Transit: ${b.transit_days ?? "-"} hari`,
            `ETD: ${b.etd ?? "-"}`,
          ].join("\n");
          await sendWhatsApp(adminGroup, msg);
        }
      } catch (_) {}

      return res.json({ ok: true, message: "Rate berhasil disubmit. Terima kasih." });
    } catch (err) {
      logger.error({ err }, "[ocean-freight-vendor-form] POST /:token");
      return res.status(500).json({ error: "Gagal submit rate" });
    }
  }
);

export { oceanFreightVendorFormRouter as default };
