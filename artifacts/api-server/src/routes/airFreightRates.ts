import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ── Validasi helper ───────────────────────────────────────────────────────────
function validateRate(body: Record<string, unknown>): string | null {
  if (body.valid_until && body.valid_from && body.valid_until < body.valid_from) {
    return "valid_until harus >= valid_from";
  }
  const currency = String(body.currency ?? "IDR");
  if (currency !== "IDR") {
    const rate = Number(body.exchange_rate_to_idr ?? 0);
    if (!rate || rate <= 0) return "exchange_rate_to_idr wajib diisi jika currency bukan IDR";
  }
  const weightBreaks = ["rate_minimum","rate_45","rate_100","rate_250","rate_300","rate_500","rate_1000"];
  const hasAnyWeightBreak = weightBreaks.some(k => body[k] != null && Number(body[k]) > 0);
  if (!hasAnyWeightBreak) return "Minimal salah satu weight break rate wajib diisi";

  const numericFields = [
    "exchange_rate_to_idr","fuel_surcharge_per_kg","security_surcharge_per_kg",
    "xray_fee","awb_fee","handling_fee","doc_fee","edi_fee","customs_clearance_fee",
    "pickup_trucking_estimate","delivery_trucking_estimate","insurance_percent",
    "dg_surcharge_percent","perishable_surcharge_percent","live_animal_surcharge_percent",
    "valuable_surcharge_percent","oversize_surcharge_percent","cold_chain_surcharge",
    "peak_season_surcharge","minimum_charge",
    ...weightBreaks,
  ];
  for (const f of numericFields) {
    const v = body[f];
    if (v != null && Number(v) < 0) return `${f} tidak boleh negatif`;
  }
  return null;
}

// ── GET /rates ────────────────────────────────────────────────────────────────
router.get("/rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const cId           = req.query.companyId      ? Number(req.query.companyId) : null;
    const airline       = (req.query.airline       as string) || null;
    const originAirport = (req.query.origin_airport as string) || null;
    const destAirport   = (req.query.destination_airport as string) || null;
    const serviceLevel  = (req.query.service_level as string) || null;
    const cargoType     = (req.query.cargo_type    as string) || null;
    const tradeType     = (req.query.trade_type    as string) || null;
    const validOnly     = req.query.valid_only !== "false";
    const activeOnly    = req.query.active_only !== "false";
    const search        = (req.query.search        as string) || null;
    const page  = Math.max(1, Number(req.query.page  ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = (page - 1) * limit;

    const today = new Date().toISOString().slice(0, 10);

    const [dataRes, countRes] = await Promise.all([
      db.execute(sql`
        SELECT * FROM air_freight_rates
        WHERE (${cId}::int IS NULL OR company_id = ${cId})
          AND (${airline}::text IS NULL OR airline ILIKE ${'%' + (airline ?? '') + '%'})
          AND (${originAirport}::text IS NULL OR origin_airport = ${originAirport})
          AND (${destAirport}::text IS NULL OR destination_airport = ${destAirport})
          AND (${serviceLevel}::text IS NULL OR service_level = ${serviceLevel})
          AND (${cargoType}::text IS NULL OR cargo_type = ${cargoType})
          AND (${tradeType}::text IS NULL OR trade_type = ${tradeType})
          AND (NOT ${activeOnly} OR is_active = TRUE)
          AND (NOT ${validOnly} OR (valid_from <= ${today}::date AND valid_until >= ${today}::date))
          AND (${search}::text IS NULL OR
               airline ILIKE ${'%' + (search ?? '') + '%'} OR
               origin_airport ILIKE ${'%' + (search ?? '') + '%'} OR
               destination_airport ILIKE ${'%' + (search ?? '') + '%'} OR
               rate_source_name ILIKE ${'%' + (search ?? '') + '%'})
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM air_freight_rates
        WHERE (${cId}::int IS NULL OR company_id = ${cId})
          AND (${airline}::text IS NULL OR airline ILIKE ${'%' + (airline ?? '') + '%'})
          AND (${originAirport}::text IS NULL OR origin_airport = ${originAirport})
          AND (${destAirport}::text IS NULL OR destination_airport = ${destAirport})
          AND (${serviceLevel}::text IS NULL OR service_level = ${serviceLevel})
          AND (${cargoType}::text IS NULL OR cargo_type = ${cargoType})
          AND (${tradeType}::text IS NULL OR trade_type = ${tradeType})
          AND (NOT ${activeOnly} OR is_active = TRUE)
          AND (NOT ${validOnly} OR (valid_from <= ${today}::date AND valid_until >= ${today}::date))
          AND (${search}::text IS NULL OR
               airline ILIKE ${'%' + (search ?? '') + '%'} OR
               origin_airport ILIKE ${'%' + (search ?? '') + '%'} OR
               destination_airport ILIKE ${'%' + (search ?? '') + '%'} OR
               rate_source_name ILIKE ${'%' + (search ?? '') + '%'})
      `),
    ]);
    res.json({
      data: dataRes.rows,
      total: Number((countRes.rows[0] as any)?.cnt ?? 0),
      page,
      limit,
    });
  } catch (err) {
    console.error("[air-freight-rates] GET /rates error:", err);
    res.status(500).json({ error: "Gagal memuat rates" });
  }
});

// ── POST /rates ───────────────────────────────────────────────────────────────
router.post("/rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const body = req.body;
    const validErr = validateRate(body);
    if (validErr) return res.status(400).json({ error: validErr });

    const companyId = body.company_id ? Number(body.company_id) : null;
    const createdBy = (req.user as { id: string } | undefined)?.id ?? null;

    const r = await db.execute(sql`
      INSERT INTO air_freight_rates (
        rate_source_type, rate_source_name, airline,
        origin_city, origin_airport, destination_city, destination_airport,
        trade_type, service_mode, service_level, currency, exchange_rate_to_idr,
        rate_minimum, rate_45, rate_100, rate_250, rate_300, rate_500, rate_1000,
        fuel_surcharge_per_kg, security_surcharge_per_kg,
        xray_fee, awb_fee, handling_fee, doc_fee, edi_fee, customs_clearance_fee,
        pickup_trucking_estimate, delivery_trucking_estimate, insurance_percent,
        dg_surcharge_percent, perishable_surcharge_percent, live_animal_surcharge_percent,
        valuable_surcharge_percent, oversize_surcharge_percent,
        cold_chain_surcharge, peak_season_surcharge, minimum_charge,
        transit_days, flight_number, etd, eta, routing_type, cargo_type,
        valid_from, valid_until, price_status, is_active, company_id, created_by
      ) VALUES (
        ${body.rate_source_type ?? 'agent'},
        ${body.rate_source_name ?? ''},
        ${body.airline ?? ''},
        ${body.origin_city ?? ''},
        ${body.origin_airport ?? ''},
        ${body.destination_city ?? ''},
        ${body.destination_airport ?? ''},
        ${body.trade_type ?? 'export'},
        ${body.service_mode ?? 'door_to_door'},
        ${body.service_level ?? 'standard'},
        ${body.currency ?? 'IDR'},
        ${body.exchange_rate_to_idr ?? 1},
        ${body.rate_minimum ?? null},
        ${body.rate_45 ?? null},
        ${body.rate_100 ?? null},
        ${body.rate_250 ?? null},
        ${body.rate_300 ?? null},
        ${body.rate_500 ?? null},
        ${body.rate_1000 ?? null},
        ${body.fuel_surcharge_per_kg ?? 0},
        ${body.security_surcharge_per_kg ?? 0},
        ${body.xray_fee ?? 0},
        ${body.awb_fee ?? 0},
        ${body.handling_fee ?? 0},
        ${body.doc_fee ?? 0},
        ${body.edi_fee ?? 0},
        ${body.customs_clearance_fee ?? 0},
        ${body.pickup_trucking_estimate ?? 0},
        ${body.delivery_trucking_estimate ?? 0},
        ${body.insurance_percent ?? 0},
        ${body.dg_surcharge_percent ?? 0},
        ${body.perishable_surcharge_percent ?? 0},
        ${body.live_animal_surcharge_percent ?? 0},
        ${body.valuable_surcharge_percent ?? 0},
        ${body.oversize_surcharge_percent ?? 0},
        ${body.cold_chain_surcharge ?? 0},
        ${body.peak_season_surcharge ?? 0},
        ${body.minimum_charge ?? 0},
        ${body.transit_days ?? null},
        ${body.flight_number ?? null},
        ${body.etd ?? null},
        ${body.eta ?? null},
        ${body.routing_type ?? 'direct'},
        ${body.cargo_type ?? 'general'},
        ${body.valid_from ?? new Date().toISOString().slice(0,10)},
        ${body.valid_until ?? new Date(Date.now() + 30*86400000).toISOString().slice(0,10)},
        ${body.price_status ?? 'active'},
        ${body.is_active !== false},
        ${companyId},
        ${createdBy}
      ) RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight-rates] POST /rates error:", err);
    res.status(500).json({ error: "Gagal membuat rate" });
  }
});

// ── GET /rates/:id ────────────────────────────────────────────────────────────
router.get("/rates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const r = await db.execute(sql`SELECT * FROM air_freight_rates WHERE id = ${id} LIMIT 1`);
    if (!r.rows.length) return res.status(404).json({ error: "Rate tidak ditemukan" });
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight-rates] GET /rates/:id error:", err);
    res.status(500).json({ error: "Gagal" });
  }
});

// ── PUT /rates/:id ────────────────────────────────────────────────────────────
router.put("/rates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id   = Number(req.params.id);
    const body = req.body;

    const existing = await db.execute(sql`SELECT id FROM air_freight_rates WHERE id = ${id} LIMIT 1`);
    if (!existing.rows.length) return res.status(404).json({ error: "Rate tidak ditemukan" });

    const validErr = validateRate({ ...existing.rows[0] as Record<string,unknown>, ...body });
    if (validErr) return res.status(400).json({ error: validErr });

    const r = await db.execute(sql`
      UPDATE air_freight_rates SET
        rate_source_type             = COALESCE(${body.rate_source_type ?? null}, rate_source_type),
        rate_source_name             = COALESCE(${body.rate_source_name ?? null}, rate_source_name),
        airline                      = COALESCE(${body.airline ?? null}, airline),
        origin_city                  = COALESCE(${body.origin_city ?? null}, origin_city),
        origin_airport               = COALESCE(${body.origin_airport ?? null}, origin_airport),
        destination_city             = COALESCE(${body.destination_city ?? null}, destination_city),
        destination_airport          = COALESCE(${body.destination_airport ?? null}, destination_airport),
        trade_type                   = COALESCE(${body.trade_type ?? null}, trade_type),
        service_mode                 = COALESCE(${body.service_mode ?? null}, service_mode),
        service_level                = COALESCE(${body.service_level ?? null}, service_level),
        currency                     = COALESCE(${body.currency ?? null}, currency),
        exchange_rate_to_idr         = COALESCE(${body.exchange_rate_to_idr ?? null}::numeric, exchange_rate_to_idr),
        rate_minimum                 = COALESCE(${body.rate_minimum ?? null}::numeric, rate_minimum),
        rate_45                      = COALESCE(${body.rate_45 ?? null}::numeric, rate_45),
        rate_100                     = COALESCE(${body.rate_100 ?? null}::numeric, rate_100),
        rate_250                     = COALESCE(${body.rate_250 ?? null}::numeric, rate_250),
        rate_300                     = COALESCE(${body.rate_300 ?? null}::numeric, rate_300),
        rate_500                     = COALESCE(${body.rate_500 ?? null}::numeric, rate_500),
        rate_1000                    = COALESCE(${body.rate_1000 ?? null}::numeric, rate_1000),
        fuel_surcharge_per_kg        = COALESCE(${body.fuel_surcharge_per_kg ?? null}::numeric, fuel_surcharge_per_kg),
        security_surcharge_per_kg    = COALESCE(${body.security_surcharge_per_kg ?? null}::numeric, security_surcharge_per_kg),
        xray_fee                     = COALESCE(${body.xray_fee ?? null}::numeric, xray_fee),
        awb_fee                      = COALESCE(${body.awb_fee ?? null}::numeric, awb_fee),
        handling_fee                 = COALESCE(${body.handling_fee ?? null}::numeric, handling_fee),
        doc_fee                      = COALESCE(${body.doc_fee ?? null}::numeric, doc_fee),
        edi_fee                      = COALESCE(${body.edi_fee ?? null}::numeric, edi_fee),
        customs_clearance_fee        = COALESCE(${body.customs_clearance_fee ?? null}::numeric, customs_clearance_fee),
        pickup_trucking_estimate     = COALESCE(${body.pickup_trucking_estimate ?? null}::numeric, pickup_trucking_estimate),
        delivery_trucking_estimate   = COALESCE(${body.delivery_trucking_estimate ?? null}::numeric, delivery_trucking_estimate),
        insurance_percent            = COALESCE(${body.insurance_percent ?? null}::numeric, insurance_percent),
        dg_surcharge_percent         = COALESCE(${body.dg_surcharge_percent ?? null}::numeric, dg_surcharge_percent),
        perishable_surcharge_percent = COALESCE(${body.perishable_surcharge_percent ?? null}::numeric, perishable_surcharge_percent),
        live_animal_surcharge_percent = COALESCE(${body.live_animal_surcharge_percent ?? null}::numeric, live_animal_surcharge_percent),
        valuable_surcharge_percent   = COALESCE(${body.valuable_surcharge_percent ?? null}::numeric, valuable_surcharge_percent),
        oversize_surcharge_percent   = COALESCE(${body.oversize_surcharge_percent ?? null}::numeric, oversize_surcharge_percent),
        cold_chain_surcharge         = COALESCE(${body.cold_chain_surcharge ?? null}::numeric, cold_chain_surcharge),
        peak_season_surcharge        = COALESCE(${body.peak_season_surcharge ?? null}::numeric, peak_season_surcharge),
        minimum_charge               = COALESCE(${body.minimum_charge ?? null}::numeric, minimum_charge),
        transit_days                 = COALESCE(${body.transit_days ?? null}::int, transit_days),
        flight_number                = COALESCE(${body.flight_number ?? null}, flight_number),
        etd                          = COALESCE(${body.etd ?? null}, etd),
        eta                          = COALESCE(${body.eta ?? null}, eta),
        routing_type                 = COALESCE(${body.routing_type ?? null}, routing_type),
        cargo_type                   = COALESCE(${body.cargo_type ?? null}, cargo_type),
        valid_from                   = COALESCE(${body.valid_from ?? null}::date, valid_from),
        valid_until                  = COALESCE(${body.valid_until ?? null}::date, valid_until),
        price_status                 = COALESCE(${body.price_status ?? null}, price_status),
        is_active                    = COALESCE(${body.is_active ?? null}::boolean, is_active),
        updated_at                   = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight-rates] PUT /rates/:id error:", err);
    res.status(500).json({ error: "Gagal mengupdate rate" });
  }
});

// ── PATCH /rates/:id/toggle ───────────────────────────────────────────────────
router.patch("/rates/:id/toggle", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const r = await db.execute(sql`
      UPDATE air_freight_rates
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, is_active
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Rate tidak ditemukan" });
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight-rates] PATCH /rates/:id/toggle error:", err);
    res.status(500).json({ error: "Gagal toggle rate" });
  }
});

// ── DELETE /rates/:id ─────────────────────────────────────────────────────────
router.delete("/rates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    await db.execute(sql`DELETE FROM air_freight_rates WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[air-freight-rates] DELETE /rates/:id error:", err);
    res.status(500).json({ error: "Gagal menghapus rate" });
  }
});

export default router;
