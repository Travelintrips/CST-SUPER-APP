import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendWhatsApp } from "../lib/fonnte.js";
import { getAdminGroupWa, getAdminWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";

import { logTokenAccess } from "../lib/tokenGuard.js";

const router = Router();

// ── POST /public/estimate — public rate estimation (no auth) ──────────────────
router.post("/public/estimate", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const originAirport  = String(body.origin_airport  ?? "").trim().toUpperCase();
    const destAirport    = String(body.destination_airport ?? "").trim().toUpperCase();
    const grossWeight    = Math.max(0, Number(body.gross_weight  ?? 0));
    const tradeType      = String(body.trade_type     ?? "export");
    const serviceMode    = body.service_mode   ? String(body.service_mode)  : null;
    const serviceLevel   = body.service_level  ? String(body.service_level) : null;
    const cargoType      = body.cargo_type     ? String(body.cargo_type)    : null;
    const dimensionRows: { length: number; width: number; height: number; koli: number }[] =
      Array.isArray(body.dimension_rows) ? body.dimension_rows : [];

    if (!originAirport || !destAirport) {
      return res.status(400).json({ error: "origin_airport dan destination_airport wajib diisi" });
    }

    // ── Weight calculation ──
    const totalVolumetric = dimensionRows.reduce((sum, d) => {
      const l = Math.max(0, Number(d.length ?? 0));
      const w = Math.max(0, Number(d.width  ?? 0));
      const h = Math.max(0, Number(d.height ?? 0));
      const k = Math.max(1, Number(d.koli   ?? 1));
      return sum + (l * w * h * k) / 1_000_000 * 167;
    }, 0);

    const chargeableWeight = Math.max(grossWeight, totalVolumetric);

    function weightBreakLabel(cw: number): string {
      if (cw < 45)   return "M (<45 kg)";
      if (cw < 100)  return "+45 kg";
      if (cw < 250)  return "+100 kg";
      if (cw < 300)  return "+250 kg";
      if (cw < 500)  return "+300 kg";
      if (cw < 1000) return "+500 kg";
      return "+1000 kg";
    }

    function pickRatePerKg(r: any, cw: number): number {
      if (cw < 45   && r.rate_minimum != null) return Number(r.rate_minimum);
      if (cw < 100  && r.rate_45      != null) return Number(r.rate_45);
      if (cw < 250  && r.rate_100     != null) return Number(r.rate_100);
      if (cw < 300  && r.rate_250     != null) return Number(r.rate_250);
      if (cw < 500  && r.rate_300     != null) return Number(r.rate_300);
      if (cw < 1000 && r.rate_500     != null) return Number(r.rate_500);
      return Number(r.rate_1000 ?? r.rate_500 ?? r.rate_300 ?? r.rate_250 ??
                    r.rate_100 ?? r.rate_45 ?? r.rate_minimum ?? 0);
    }

    const today = new Date().toISOString().slice(0, 10);

    const ratesRes = await db.execute(sql`
      SELECT * FROM air_freight_rates
      WHERE is_active    = TRUE
        AND price_status = 'active'
        AND origin_airport      = ${originAirport}
        AND destination_airport = ${destAirport}
        AND valid_from  <= ${today}::date
        AND valid_until >= ${today}::date
        AND (${tradeType}::text IS NULL OR trade_type = ${tradeType})
        AND (${serviceMode}::text  IS NULL OR service_mode  = ${serviceMode})
        AND (${serviceLevel}::text IS NULL OR service_level = ${serviceLevel})
        AND (${cargoType}::text    IS NULL OR cargo_type    = ${cargoType})
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const options = (ratesRes.rows as any[]).map((r) => {
      const ratePerKg       = pickRatePerKg(r, chargeableWeight);
      const freightBase     = ratePerKg * chargeableWeight;
      const fuelSurcharge   = Number(r.fuel_surcharge_per_kg     ?? 0) * chargeableWeight;
      const secSurcharge    = Number(r.security_surcharge_per_kg ?? 0) * chargeableWeight;
      const fixedFees       = Number(r.xray_fee    ?? 0)
                            + Number(r.awb_fee     ?? 0)
                            + Number(r.handling_fee ?? 0)
                            + Number(r.doc_fee     ?? 0)
                            + Number(r.edi_fee     ?? 0);
      const minCharge       = Number(r.minimum_charge ?? 0);
      const totalEstimate   = Math.max(minCharge, freightBase + fuelSurcharge + secSurcharge + fixedFees);

      return {
        rate_id:               r.id,
        airline:               r.airline,
        rate_source_name:      r.rate_source_name,
        routing_type:          r.routing_type,
        transit_days:          r.transit_days,
        flight_number:         r.flight_number,
        etd:                   r.etd,
        eta:                   r.eta,
        service_mode:          r.service_mode,
        service_level:         r.service_level,
        currency:              r.currency,
        exchange_rate_to_idr:  r.exchange_rate_to_idr,
        rate_per_kg:           ratePerKg,
        weight_break:          weightBreakLabel(chargeableWeight),
        freight_base:          freightBase,
        fuel_surcharge:        fuelSurcharge,
        security_surcharge:    secSurcharge,
        fixed_fees:            fixedFees,
        minimum_charge:        minCharge,
        total_estimate_idr:    totalEstimate * Number(r.exchange_rate_to_idr ?? 1),
      };
    });

    res.json({
      gross_weight:       grossWeight,
      volumetric_weight:  parseFloat(totalVolumetric.toFixed(3)),
      chargeable_weight:  parseFloat(chargeableWeight.toFixed(3)),
      weight_break:       weightBreakLabel(chargeableWeight),
      options,
    });
  } catch (err) {
    console.error("[air-freight-public] POST /public/estimate error:", err);
    res.status(500).json({ error: "Gagal menghitung estimasi" });
  }
});

// ── POST /public/orders — create order from customer portal (no admin auth) ──
router.post("/public/orders", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    const REQUIRED = ["customer_name","customer_phone","origin_airport","destination_airport","chargeable_weight"];
    for (const f of REQUIRED) {
      if (!body[f] && body[f] !== 0) {
        return res.status(400).json({ error: `Field ${f} wajib diisi` });
      }
    }

    const year = new Date().getFullYear();
    const countRes = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM air_freight_orders
      WHERE EXTRACT(YEAR FROM created_at) = ${year}
    `);
    const seq = Number((countRes.rows[0] as any)?.cnt ?? 0) + 1;
    const orderNumber = `AFO/${year}/${String(seq).padStart(5, "0")}`;

    const r = await db.execute(sql`
      INSERT INTO air_freight_orders (
        order_number,
        customer_name, customer_phone, customer_email,
        origin_city, origin_airport, destination_city, destination_airport,
        trade_type, service_mode, service_level, incoterm,
        commodity, cargo_type,
        gross_weight, total_volumetric_weight, chargeable_weight, koli,
        dimension_rows,
        selected_rate_id, estimated_price, estimated_price_idr,
        currency, pricing_breakdown,
        selected_additional_services,
        admin_notes, price_status, status, source
      ) VALUES (
        ${orderNumber},
        ${String(body.customer_name ?? "")},
        ${String(body.customer_phone ?? "")},
        ${String(body.customer_email ?? "")},
        ${String(body.origin_city ?? "")},
        ${String(body.origin_airport ?? "").toUpperCase()},
        ${String(body.destination_city ?? "")},
        ${String(body.destination_airport ?? "").toUpperCase()},
        ${String(body.trade_type     ?? "export")},
        ${String(body.service_mode   ?? "airport_to_airport")},
        ${String(body.service_level  ?? "standard")},
        ${String(body.incoterm       ?? "EXW")},
        ${String(body.commodity ?? "")},
        ${String(body.cargo_type ?? "general")},
        ${Number(body.gross_weight             ?? 0)},
        ${Number(body.total_volumetric_weight  ?? 0)},
        ${Number(body.chargeable_weight        ?? 0)},
        ${Number(body.koli ?? 0)},
        ${JSON.stringify(body.dimension_rows ?? [])}::jsonb,
        ${body.selected_rate_id ?? null},
        ${body.estimated_price     ?? null},
        ${body.estimated_price_idr ?? null},
        ${String(body.currency ?? "IDR")},
        ${JSON.stringify(body.pricing_breakdown ?? {})}::jsonb,
        ${JSON.stringify(body.selected_additional_services ?? [])}::jsonb,
        ${body.notes ?? null},
        'estimate',
        'waiting_rate',
        'customer_portal'
      ) RETURNING *
    `);

    const order = r.rows[0] as any;

    res.status(201).json({ ok: true, order_number: order.order_number, id: order.id });

    // ── Notifikasi WA ke admin (fire-and-forget) ──────────────────────────────
    Promise.all([getAdminGroupWa(), getAdminWa(), getPreferredDomain()]).then(([groupWa, personalWa, domain]) => {
      const idr = (v: number | null | undefined) =>
        v == null ? "-" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(v));

      const adminUrl = `https://${domain}/bizportal/air-freight/orders/${order.id}`;
      const msg = [
        `✈️ *Inquiry Air Freight Baru*`,
        ``,
        `📋 No. Order : *${order.order_number}*`,
        `👤 Customer  : ${order.customer_name}`,
        `📱 Phone     : ${order.customer_phone || "-"}`,
        `📍 Rute      : ${order.origin_airport} → ${order.destination_airport}`,
        `📦 Komoditi  : ${order.commodity || "-"}`,
        `⚖️ Berat     : ${order.chargeable_weight ?? 0} kg · ${order.koli ?? 0} koli`,
        order.estimated_price_idr
          ? `💰 Est. Harga: ${idr(order.estimated_price_idr)}`
          : `💰 Est. Harga: Belum ada`,
        ``,
        `🔗 ${adminUrl}`,
      ].join("\n");

      const opts = { context: "air_freight_new_order", refType: "air_freight_order", refId: String(order.id) };

      if (groupWa) {
        sendWhatsApp(groupWa, msg, opts).catch((e: unknown) =>
          console.error("[air-freight-public] WA group notif failed:", e)
        );
      }
      if (personalWa && personalWa !== groupWa) {
        sendWhatsApp(personalWa, msg, opts).catch((e: unknown) =>
          console.error("[air-freight-public] WA personal notif failed:", e)
        );
      }
    }).catch((e: unknown) => console.error("[air-freight-public] Admin WA fetch failed:", e));

  } catch (err) {
    console.error("[air-freight-public] POST /public/orders error:", err);
    res.status(500).json({ error: "Gagal membuat order" });
  }
});

// ── GET /public/track/:orderNumber — public tracking (no auth) ───────────────
router.get("/public/track/:orderNumber", async (req: Request, res: Response) => {
  try {
    const orderNumber = String(req.params.orderNumber ?? "");
    const r = await db.execute(sql`
      SELECT
        o.order_number, o.customer_name,
        o.origin_city, o.origin_airport, o.destination_city, o.destination_airport,
        o.chargeable_weight, o.koli, o.commodity, o.status, o.tracking_status,
        o.booking_number, o.mawb, o.hawb,
        o.approved_at, o.booking_confirmed_at, o.quoted_at,
        o.grand_total, o.final_price_idr,
        r.airline, r.flight_number, r.etd, r.eta, r.transit_days
      FROM air_freight_orders o
      LEFT JOIN air_freight_rates r ON r.id = o.final_rate_id
      WHERE o.order_number = ${orderNumber}
      LIMIT 1
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });

    const events = await db.execute(sql`
      SELECT event_type, note, created_at
      FROM air_freight_tracking_events
      WHERE order_id = (SELECT id FROM air_freight_orders WHERE order_number = ${orderNumber} LIMIT 1)
      ORDER BY created_at ASC
    `);

    res.json({ order: r.rows[0], events: events.rows });
  } catch (err) {
    console.error("[air-freight-public] GET /public/track error:", err);
    res.status(500).json({ error: "Gagal memuat tracking" });
  }
});

// ── GET /approval/:token — data order untuk review customer ───────────────────
router.get("/approval/:token", async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token ?? "");
    if (!token || !/^[a-f0-9]{32,}$/i.test(token)) {
      return res.status(400).json({ error: "Token tidak valid" });
    }
    const r = await db.execute(sql`
      SELECT
        o.id, o.order_number, o.customer_name, o.customer_email, o.customer_phone,
        o.origin_city, o.origin_airport, o.destination_city, o.destination_airport,
        o.trade_type, o.service_level, o.commodity, o.cargo_type,
        o.gross_weight, o.chargeable_weight, o.koli,
        o.pickup_date, o.preferred_flight_date, o.target_arrival_date,
        o.estimated_price_idr, o.currency,
        o.final_price, o.final_price_idr, o.markup_amount, o.ppn_amount, o.grand_total,
        o.final_breakdown, o.admin_notes, o.status, o.price_status,
        o.quoted_at, o.approved_at, o.declined_at,
        r.airline, r.flight_number, r.etd, r.eta, r.transit_days,
        r.routing_type, r.rate_source_name, r.service_mode
      FROM air_freight_orders o
      LEFT JOIN air_freight_rates r ON r.id = o.final_rate_id
      WHERE o.approval_token = ${token}
      LIMIT 1
    `);
    if (!r.rows.length) {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, action: "view", outcome: "denied_not_found", req });
      return res.status(404).json({ error: "Link tidak valid atau sudah kedaluwarsa" });
    }
    const order = r.rows[0] as any;
    // Check approval_token_expires_at jika sudah ada (ditambahkan via token security migration)
    if (order.approval_token_expires_at && new Date(order.approval_token_expires_at) < new Date()) {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "view", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link persetujuan sudah kadaluarsa" });
    }
    if (["cancelled","completed"].includes(order.status)) {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "view", outcome: "denied_used", req });
      return res.status(410).json({ error: "Order ini sudah selesai atau dibatalkan" });
    }
    logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "view", outcome: "ok", req });
    // Safelist: only return fields the customer is authorized to see.
    // Internal fields (markup_amount, admin_notes, final_breakdown, final_price) are intentionally excluded.
    const safeOrder = {
      id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      origin_city: order.origin_city,
      origin_airport: order.origin_airport,
      destination_city: order.destination_city,
      destination_airport: order.destination_airport,
      trade_type: order.trade_type,
      service_level: order.service_level,
      commodity: order.commodity,
      cargo_type: order.cargo_type,
      gross_weight: order.gross_weight,
      chargeable_weight: order.chargeable_weight,
      koli: order.koli,
      pickup_date: order.pickup_date,
      preferred_flight_date: order.preferred_flight_date,
      target_arrival_date: order.target_arrival_date,
      estimated_price_idr: order.estimated_price_idr,
      currency: order.currency,
      final_price_idr: order.final_price_idr,
      ppn_amount: order.ppn_amount,
      grand_total: order.grand_total,
      status: order.status,
      price_status: order.price_status,
      quoted_at: order.quoted_at,
      approved_at: order.approved_at,
      declined_at: order.declined_at,
      airline: order.airline,
      flight_number: order.flight_number,
      etd: order.etd,
      eta: order.eta,
      transit_days: order.transit_days,
      routing_type: order.routing_type,
      rate_source_name: order.rate_source_name,
      service_mode: order.service_mode,
    };
    res.json(safeOrder);
  } catch (err) {
    console.error("[air-freight-public] GET /approval/:token error:", err);
    res.status(500).json({ error: "Gagal memuat data" });
  }
});

// ── POST /approval/:token/approve ─────────────────────────────────────────────
router.post("/approval/:token/approve", async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token ?? "");
    if (!token || !/^[a-f0-9]{32,}$/i.test(token)) {
      return res.status(400).json({ error: "Token tidak valid" });
    }
    const existing = await db.execute(sql`
      SELECT id, status, approval_token_expires_at FROM air_freight_orders WHERE approval_token = ${token} LIMIT 1
    `);
    if (!existing.rows.length) {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, action: "approve", outcome: "denied_not_found", req });
      return res.status(404).json({ error: "Link tidak ditemukan" });
    }
    const order = existing.rows[0] as any;
    if (order.approval_token_expires_at && new Date(order.approval_token_expires_at) < new Date()) {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "approve", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link persetujuan sudah kadaluarsa" });
    }
    if (order.status !== "quoted") {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "approve", outcome: "denied_used", req });
      return res.status(409).json({
        error: `Order tidak dalam status quoted (status saat ini: ${order.status})`
      });
    }
    logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "approve", outcome: "ok", req });
    await db.execute(sql`
      UPDATE air_freight_orders
      SET status = 'approved', approved_at = NOW(), updated_at = NOW()
      WHERE id = ${order.id}
    `);
    await db.execute(sql`
      INSERT INTO air_freight_tracking_events (order_id, event_type, note)
      VALUES (${order.id}, 'approved', 'Customer menyetujui harga final')
    `).catch(() => {});
    res.json({ ok: true, message: "Order disetujui. Tim kami akan segera memproses booking." });
  } catch (err) {
    console.error("[air-freight-public] POST /approval/:token/approve error:", err);
    res.status(500).json({ error: "Gagal memproses persetujuan" });
  }
});

// ── POST /approval/:token/decline ─────────────────────────────────────────────
router.post("/approval/:token/decline", async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token ?? "");
    if (!token || !/^[a-f0-9]{32,}$/i.test(token)) {
      return res.status(400).json({ error: "Token tidak valid" });
    }
    const existing = await db.execute(sql`
      SELECT id, status, approval_token_expires_at FROM air_freight_orders WHERE approval_token = ${token} LIMIT 1
    `);
    if (!existing.rows.length) {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, action: "decline", outcome: "denied_not_found", req });
      return res.status(404).json({ error: "Link tidak ditemukan" });
    }
    const order = existing.rows[0] as any;
    if (order.approval_token_expires_at && new Date(order.approval_token_expires_at) < new Date()) {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "decline", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link persetujuan sudah kadaluarsa" });
    }
    if (order.status !== "quoted") {
      logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "decline", outcome: "denied_used", req });
      return res.status(409).json({
        error: `Order tidak dalam status quoted (status saat ini: ${order.status})`
      });
    }
    logTokenAccess({ tokenType: "air_freight_approval", tokenRef: token, entityId: String(order.id), action: "decline", outcome: "ok", req });
    const reason = (req.body?.reason as string | undefined)?.slice(0, 1000) ?? null;
    await db.execute(sql`
      UPDATE air_freight_orders
      SET status = 'quote_declined',
          decline_reason = ${reason},
          declined_at = NOW(),
          updated_at = NOW()
      WHERE id = ${order.id}
    `);
    await db.execute(sql`
      INSERT INTO air_freight_tracking_events (order_id, event_type, note)
      VALUES (${order.id}, 'quote_declined', ${reason ? `Alasan: ${reason}` : 'Customer menolak harga final'})
    `).catch(() => {});
    res.json({ ok: true, message: "Penolakan diterima. Tim kami akan menghubungi Anda." });
  } catch (err) {
    console.error("[air-freight-public] POST /approval/:token/decline error:", err);
    res.status(500).json({ error: "Gagal memproses penolakan" });
  }
});

// ── GET /track/:orderNumber — public tracking ─────────────────────────────────
router.get("/track/:orderNumber", async (req: Request, res: Response) => {
  try {
    const orderNumber = String(req.params.orderNumber ?? "");
    const r = await db.execute(sql`
      SELECT
        o.order_number, o.customer_name,
        o.origin_city, o.origin_airport, o.destination_city, o.destination_airport,
        o.chargeable_weight, o.koli, o.commodity,
        o.status, o.tracking_status,
        o.booking_number, o.mawb, o.hawb,
        o.approved_at, o.booking_confirmed_at,
        r.airline, r.flight_number, r.etd, r.eta, r.transit_days
      FROM air_freight_orders o
      LEFT JOIN air_freight_rates r ON r.id = o.final_rate_id
      WHERE o.order_number = ${orderNumber}
      LIMIT 1
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    const order = r.rows[0] as any;

    const events = await db.execute(sql`
      SELECT event_type, note, created_at
      FROM air_freight_tracking_events
      WHERE order_id = (SELECT id FROM air_freight_orders WHERE order_number = ${orderNumber})
      ORDER BY created_at ASC
    `);
    res.json({ order, events: events.rows });
  } catch (err) {
    console.error("[air-freight-public] GET /track/:orderNumber error:", err);
    res.status(500).json({ error: "Gagal memuat tracking" });
  }
});

export default router;
