import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { logger } from "../lib/logger.js";
import {
  optionalCustomerPortalAuth,
  type PortalAuthReq,
} from "../lib/supabaseAuth.js";
import {
  getPortalCustomerContext,
  PortalCustomerContextError,
} from "../lib/services/portalCustomerContextService.js";
import { NotificationService } from "../lib/services/notificationService.js";

export const oceanFreightPublicRouter = Router();


const estimateLimit = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const submitLimit   = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

// ── GET /options ──────────────────────────────────────────────────────────────
oceanFreightPublicRouter.get("/options", async (_req: Request, res: Response) => {
  return res.json({
    trade_types: [
      { v: "domestic",     l: "Domestic" },
      { v: "export",       l: "Export" },
      { v: "import",       l: "Import" },
      { v: "cross_border", l: "Cross Border" },
    ],
    service_modes: [
      { v: "port_to_port",  l: "Port to Port" },
      { v: "door_to_port",  l: "Door to Port" },
      { v: "port_to_door",  l: "Port to Door" },
      { v: "door_to_door",  l: "Door to Door" },
    ],
    shipment_types: [
      { v: "FCL", l: "FCL (Full Container Load)" },
      { v: "LCL", l: "LCL (Less than Container Load)" },
    ],
    container_types: [
      { v: "20ft",       l: "20ft GP",    cbm: 25,  payload: 21800 },
      { v: "40ft",       l: "40ft GP",    cbm: 55,  payload: 26480 },
      { v: "40HC",       l: "40HC",       cbm: 65,  payload: 26480 },
      { v: "reefer_20",  l: "Reefer 20ft",cbm: 25,  payload: 20400 },
      { v: "reefer_40",  l: "Reefer 40ft",cbm: 56,  payload: 24760 },
      { v: "open_top",   l: "Open Top 20ft",cbm: 25, payload: 21600 },
      { v: "flat_rack",  l: "Flat Rack 20ft",cbm: null, payload: 24000 },
    ],
    cargo_conditions: [
      { v: "general",   l: "General Cargo" },
      { v: "dg",        l: "DG Cargo" },
      { v: "reefer",    l: "Reefer" },
      { v: "fragile",   l: "Fragile" },
      { v: "oversize",  l: "Oversize" },
      { v: "high_value",l: "High Value" },
    ],
    incoterms: ["EXW","FOB","CFR","CIF","DAP","DDP"],
    additional_services: [
      "Trucking Pickup","Trucking Delivery","Customs Clearance",
      "Insurance","Fumigation","COO / Certificate","Warehouse Handling",
      "Stuffing","Unstuffing","Surveyor","Document Handling",
    ],
  });
});

// ── Pricing engine ────────────────────────────────────────────────────────────
interface PricingInput {
  origin_port: string;
  destination_port: string;
  trade_type: string;
  service_mode: string;
  shipment_type: string;
  container_type?: string | null;
  container_qty?: number;
  total_cbm?: number;
  gross_weight?: number;
  cargo_condition?: string;
  selected_additional_services?: string[];
  currency_display?: string;
}

interface RateRow {
  id: number;
  rate_source_type: string;
  rate_source_name: string;
  carrier_name: string | null;
  carrier: string | null;
  origin_port: string;
  destination_port: string;
  shipment_type: string;
  service_mode: string;
  container_type: string | null;
  currency: string;
  exchange_rate_to_idr: string;
  ocean_freight_amount: string | null;
  lcl_rate_per_cbm: string | null;
  lcl_minimum_cbm: string | null;
  thc_origin: string;
  thc_destination: string;
  doc_fee: string;
  bl_fee: string;
  do_fee: string;
  handling_fee: string;
  customs_clearance_fee: string;
  trucking_pickup_estimate: string;
  trucking_delivery_estimate: string;
  insurance_percent: string;
  dg_surcharge_percent: string;
  reefer_surcharge: string;
  peak_season_surcharge: string;
  emergency_bunker_surcharge: string;
  currency_adjustment_factor: string;
  transit_days: number | null;
  direct_or_transshipment: string;
  valid_from: string;
  valid_until: string;
  price_status: string;
}

function n(v: string | null | undefined): number { return Number(v ?? 0) || 0; }

function calcOption(rate: RateRow, input: PricingInput, label: string) {
  const qty  = Number(input.container_qty ?? 1);
  const cbm  = Number(input.total_cbm ?? 0);
  const er   = n(rate.exchange_rate_to_idr);
  const svc  = input.selected_additional_services ?? [];

  let baseOcean = 0;
  if (input.shipment_type === "FCL") {
    baseOcean = n(rate.ocean_freight_amount) * qty;
  } else {
    const minCbm   = n(rate.lcl_minimum_cbm) || 1;
    const chargCbm = Math.max(cbm, minCbm);
    baseOcean      = chargCbm * n(rate.lcl_rate_per_cbm);
  }

  const originCharges = n(rate.thc_origin) * (input.shipment_type === "FCL" ? qty : 1);
  const destCharges   = n(rate.thc_destination) * (input.shipment_type === "FCL" ? qty : 1);
  const docCharges    = n(rate.doc_fee) + n(rate.bl_fee) + n(rate.do_fee) + n(rate.handling_fee);

  let truckingPickup   = 0;
  let truckingDelivery = 0;
  let customsCharge    = 0;

  if (svc.includes("trucking_pickup"))   truckingPickup   = n(rate.trucking_pickup_estimate);
  if (svc.includes("trucking_delivery")) truckingDelivery = n(rate.trucking_delivery_estimate);
  if (svc.includes("customs_clearance")) customsCharge    = n(rate.customs_clearance_fee);

  // Surcharges
  const surchargeBreakdown: Record<string, number> = {};
  let totalSurcharge = 0;

  if (input.cargo_condition === "dg") {
    const dg = baseOcean * (n(rate.dg_surcharge_percent) / 100);
    surchargeBreakdown["DG Surcharge"] = dg;
    totalSurcharge += dg;
  }
  if (input.cargo_condition === "reefer") {
    surchargeBreakdown["Reefer Surcharge"] = n(rate.reefer_surcharge);
    totalSurcharge += n(rate.reefer_surcharge);
  }
  if (n(rate.peak_season_surcharge) > 0) {
    surchargeBreakdown["Peak Season Surcharge"] = n(rate.peak_season_surcharge);
    totalSurcharge += n(rate.peak_season_surcharge);
  }
  if (n(rate.emergency_bunker_surcharge) > 0) {
    surchargeBreakdown["EBS"] = n(rate.emergency_bunker_surcharge);
    totalSurcharge += n(rate.emergency_bunker_surcharge);
  }
  if (n(rate.currency_adjustment_factor) > 0) {
    surchargeBreakdown["CAF"] = n(rate.currency_adjustment_factor);
    totalSurcharge += n(rate.currency_adjustment_factor);
  }

  const totalOrig = baseOcean + originCharges + destCharges + docCharges +
                    truckingPickup + truckingDelivery + customsCharge + totalSurcharge;
  const totalIdr  = rate.currency === "IDR" ? totalOrig : totalOrig * er;

  return {
    estimate_option:         label,
    rate_id:                 rate.id,
    rate_source_type:        rate.rate_source_type,
    rate_source_name:        rate.rate_source_name,
    carrier:                 rate.carrier_name || rate.carrier || rate.rate_source_name,
    route:                   `${rate.origin_port} → ${rate.destination_port}`,
    shipment_type:           input.shipment_type,
    service_mode:            input.service_mode,
    container_type:          rate.container_type,
    transit_days:            rate.transit_days,
    direct_or_transshipment: rate.direct_or_transshipment,
    base_ocean_freight:      baseOcean,
    origin_charges:          originCharges,
    destination_charges:     destCharges,
    document_charges:        docCharges,
    trucking_charges:        truckingPickup + truckingDelivery,
    customs_charges:         customsCharge,
    surcharge_breakdown:     surchargeBreakdown,
    total_estimate:          totalOrig,
    currency:                rate.currency,
    total_estimate_idr:      totalIdr,
    exchange_rate_to_idr:    er,
    price_status:            rate.price_status,
    validity:                rate.valid_until,
  };
}

// ── POST /calculate ───────────────────────────────────────────────────────────
oceanFreightPublicRouter.post("/calculate", async (req: Request, res: Response) => {
  try {
    const input: PricingInput = req.body;

    // Validate
    if (!input.origin_port || !input.destination_port)
      return res.status(400).json({ error: "Origin dan destination wajib diisi" });
    if (!input.shipment_type)
      return res.status(400).json({ error: "Shipment type wajib dipilih" });
    if (input.shipment_type === "FCL" && !input.container_type)
      return res.status(400).json({ error: "Container type wajib untuk FCL" });
    if (input.shipment_type === "FCL" && !(Number(input.container_qty ?? 0) >= 1))
      return res.status(400).json({ error: "Container qty minimal 1" });
    if (input.shipment_type === "LCL" && !(Number(input.total_cbm ?? 0) > 0) && !(Number(input.gross_weight ?? 0) > 0))
      return res.status(400).json({ error: "CBM atau gross weight wajib untuk LCL" });
    if (Number(input.total_cbm ?? 0) < 0 || Number(input.gross_weight ?? 0) < 0)
      return res.status(400).json({ error: "CBM dan gross weight tidak boleh negatif" });

    const today = new Date().toISOString().slice(0, 10);

    const serviceMode = input.service_mode || "port_to_port";
    const originPct   = `%${input.origin_port}%`;
    const destPct     = `%${input.destination_port}%`;

    let ratesRes;
    if (input.shipment_type === "FCL" && input.container_type) {
      ratesRes = await db.execute(sql`
        SELECT * FROM ocean_freight_rates
        WHERE is_active = TRUE
          AND valid_from  <= ${today}
          AND valid_until >= ${today}
          AND origin_port ILIKE ${originPct}
          AND destination_port ILIKE ${destPct}
          AND shipment_type = ${input.shipment_type}
          AND service_mode  = ${serviceMode}
          AND (container_type = ${input.container_type} OR container_type IS NULL)
        ORDER BY ocean_freight_amount ASC, lcl_rate_per_cbm ASC
      `);
    } else {
      ratesRes = await db.execute(sql`
        SELECT * FROM ocean_freight_rates
        WHERE is_active = TRUE
          AND valid_from  <= ${today}
          AND valid_until >= ${today}
          AND origin_port ILIKE ${originPct}
          AND destination_port ILIKE ${destPct}
          AND shipment_type = ${input.shipment_type}
          AND service_mode  = ${serviceMode}
        ORDER BY ocean_freight_amount ASC, lcl_rate_per_cbm ASC
      `);
    }

    const rates = ratesRes.rows as unknown as RateRow[];

    if (rates.length === 0) {
      return res.json({
        options: [],
        message: "Belum ada rate tersedia untuk rute ini. Silakan hubungi tim kami untuk mendapatkan penawaran.",
      });
    }

    // Build options: Economy (cheapest IDR), Priority (fastest), Standard (balanced)
    const scored = rates.map((r) => ({
      r,
      opt: calcOption(r, input, "economy"),
    })).sort((a, b) => a.opt.total_estimate_idr - b.opt.total_estimate_idr);

    const byTransit = [...rates].sort((a, b) => (a.transit_days ?? 999) - (b.transit_days ?? 999));

    const economyRate  = scored[0]?.r;
    const priorityRate = byTransit[0];
    const standardRate = scored[Math.floor(scored.length / 2)]?.r ?? scored[0]?.r;

    const options = [];
    if (economyRate)  options.push(calcOption(economyRate,  input, "economy"));
    if (priorityRate && priorityRate.id !== economyRate?.id)
      options.push(calcOption(priorityRate, input, "priority"));
    if (standardRate && standardRate.id !== economyRate?.id && standardRate.id !== priorityRate?.id)
      options.push(calcOption(standardRate, input, "standard"));

    // Ensure labels
    if (options.length === 1) options[0].estimate_option = "standard";
    if (options.length === 2) {
      options[0].estimate_option = "economy";
      options[1].estimate_option = "priority";
    }
    if (options.length === 3) {
      options[0].estimate_option = "economy";
      options[1].estimate_option = "priority";
      options[2].estimate_option = "standard";
    }

    res.json({ options, total_rates_found: rates.length });
  } catch (err) {
    logger.error({ err }, "[ocean-freight-public] POST /calculate");
    res.status(500).json({ error: "Gagal menghitung estimasi" });
  }
});

// ── POST /estimate ────────────────────────────────────────────────────────────
oceanFreightPublicRouter.post("/estimate", estimateLimit, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const originPort      = String(b.origin_port ?? "").trim();
    const destinationPort = String(b.destination_port ?? "").trim();
    const shipmentType    = String(b.shipment_type ?? "FCL");
    const serviceMode     = b.service_mode ? String(b.service_mode) : null;
    const tradeType       = b.trade_type   ? String(b.trade_type)   : null;
    const containerType   = shipmentType === "FCL" ? (b.container_type ? String(b.container_type) : null) : null;
    const containerQty    = shipmentType === "FCL" ? Math.max(1, Number(b.container_qty ?? 1)) : 1;
    const totalCbm        = shipmentType === "LCL" ? Math.max(0, Number(b.total_cbm ?? 0)) : 0;
    const cargoCondition  = String(b.cargo_condition ?? "general");
    const selectedServices: string[] = Array.isArray(b.selected_additional_services) ? b.selected_additional_services : [];

    if (!originPort || !destinationPort)
      return res.status(400).json({ error: "origin_port dan destination_port wajib diisi" });
    if (shipmentType === "FCL" && !containerType)
      return res.status(400).json({ error: "container_type wajib untuk FCL" });
    if (shipmentType === "LCL" && totalCbm <= 0 && Number(b.gross_weight ?? 0) <= 0)
      return res.status(400).json({ error: "total_cbm atau gross_weight wajib untuk LCL" });

    const todayStr = new Date().toISOString().slice(0, 10);

    const { rows: rateRows } = await db.execute(sql`
      SELECT * FROM ocean_freight_rates
      WHERE is_active = TRUE
        AND valid_from  <= ${todayStr}::date
        AND valid_until >= ${todayStr}::date
        AND LOWER(origin_port)      = LOWER(${originPort})
        AND LOWER(destination_port) = LOWER(${destinationPort})
        AND UPPER(shipment_type)    = UPPER(${shipmentType})
        AND (${serviceMode}::text IS NULL OR service_mode = ${serviceMode})
        AND (${tradeType}::text IS NULL OR trade_type = ${tradeType})
        AND (${containerType}::text IS NULL OR container_type IS NULL OR UPPER(container_type) = UPPER(${containerType ?? ""}))
      ORDER BY ocean_freight_amount ASC
      LIMIT 20
    `);

    if (!rateRows.length) {
      return res.json({
        options: [],
        message: "Tidak ada rate tersedia untuk rute ini saat ini. Silakan submit inquiry untuk mendapatkan penawaran manual.",
      });
    }

    // ── Calculate per rate ────────────────────────────────────────────────────
    function calcOption(r: any, label: string) {
      const exr    = Number(r.exchange_rate_to_idr ?? 16500);
      const curr   = String(r.currency ?? "USD");

      let base = 0;
      let breakdown: Record<string, number | string> = {};

      if (shipmentType === "FCL") {
        base = Number(r.ocean_freight_amount ?? 0) * containerQty;
        breakdown.ocean_freight = Number(r.ocean_freight_amount ?? 0) * containerQty;
      } else {
        const minCbm        = Number(r.lcl_minimum_cbm ?? 1);
        const chargeableCbm = Math.max(totalCbm, minCbm);
        base = chargeableCbm * Number(r.lcl_rate_per_cbm ?? 0);
        breakdown.ocean_freight = base;
        breakdown.chargeable_cbm = chargeableCbm;
      }

      const originCharges = Number(r.thc_origin ?? 0);
      const destCharges   = Number(r.thc_destination ?? 0);
      const docCharges    = Number(r.doc_fee ?? 0) + Number(r.bl_fee ?? 0) + Number(r.do_fee ?? 0) + Number(r.handling_fee ?? 0);
      breakdown.origin_charges      = originCharges;
      breakdown.destination_charges = destCharges;
      breakdown.document_charges    = docCharges;

      let truckingCharges = 0;
      if (selectedServices.includes("Trucking Pickup"))   { truckingCharges += Number(r.trucking_pickup_estimate ?? 0); breakdown.trucking_pickup = Number(r.trucking_pickup_estimate ?? 0); }
      if (selectedServices.includes("Trucking Delivery"))  { truckingCharges += Number(r.trucking_delivery_estimate ?? 0); breakdown.trucking_delivery = Number(r.trucking_delivery_estimate ?? 0); }
      let customsCharges = 0;
      if (selectedServices.includes("Customs Clearance")) { customsCharges += Number(r.customs_clearance_fee ?? 0); breakdown.customs_clearance = Number(r.customs_clearance_fee ?? 0); }

      let surcharge = 0;
      if (cargoCondition === "dg")    { const s = base * Number(r.dg_surcharge_percent ?? 0) / 100; surcharge += s; breakdown.dg_surcharge = s; }
      if (cargoCondition === "reefer"){ surcharge += Number(r.reefer_surcharge ?? 0); breakdown.reefer_surcharge = Number(r.reefer_surcharge ?? 0); }
      surcharge += Number(r.peak_season_surcharge ?? 0) + Number(r.emergency_bunker_surcharge ?? 0) + Number(r.currency_adjustment_factor ?? 0);
      if (Number(r.peak_season_surcharge ?? 0) > 0) breakdown.peak_season_surcharge = Number(r.peak_season_surcharge ?? 0);
      if (Number(r.emergency_bunker_surcharge ?? 0) > 0) breakdown.emergency_bunker_surcharge = Number(r.emergency_bunker_surcharge ?? 0);

      const total = base + originCharges + destCharges + docCharges + truckingCharges + customsCharges + surcharge;
      const totalIdr = curr === "IDR" ? total : total * exr;

      breakdown.total_estimate = total;
      breakdown.currency = curr;
      breakdown.total_estimate_idr = totalIdr;

      return {
        estimate_option:        label,
        rate_id:                r.id,
        rate_source_name:       r.rate_source_name,
        carrier:                r.carrier ?? r.carrier_name,
        route:                  `${r.origin_port} → ${r.destination_port}`,
        shipment_type:          r.shipment_type,
        service_mode:           r.service_mode,
        container_type:         r.container_type,
        container_qty:          shipmentType === "FCL" ? containerQty : null,
        transit_days:           r.transit_days,
        direct_or_transshipment:r.direct_or_transshipment,
        base_ocean_freight:     base,
        origin_charges:         originCharges,
        destination_charges:    destCharges,
        document_charges:       docCharges,
        trucking_charges:       truckingCharges,
        customs_charges:        customsCharges,
        surcharge_breakdown:    surcharge,
        total_estimate:         total,
        currency:               curr,
        total_estimate_idr:     totalIdr,
        price_status:           r.price_status ?? "estimate",
        validity:               r.valid_until,
        breakdown,
      };
    }

    const sorted    = (rateRows as any[]).slice().sort((a, b) => {
      const tA = Number(a.ocean_freight_amount ?? 0) + Number(a.thc_origin ?? 0) + Number(a.thc_destination ?? 0);
      const tB = Number(b.ocean_freight_amount ?? 0) + Number(b.thc_origin ?? 0) + Number(b.thc_destination ?? 0);
      return tA - tB;
    });
    const byTransit = (rateRows as any[]).slice().sort((a, b) => Number(a.transit_days ?? 99) - Number(b.transit_days ?? 99));

    const economy  = sorted[0]     ? calcOption(sorted[0],     "Economy")  : null;
    const standard = sorted[Math.floor(sorted.length / 2)] ? calcOption(sorted[Math.floor(sorted.length / 2)], "Standard") : null;
    const priority = byTransit[0]  ? calcOption(byTransit[0],  "Priority") : null;

    const options = [economy, standard, priority].filter(Boolean);
    const uniqueOptions = options.filter((o, idx) => options.findIndex(x => x?.rate_id === o?.rate_id) === idx);

    return res.json({ options: uniqueOptions });
  } catch (e) {
    console.error("[ocean-freight-public/estimate]", e);
    return res.status(500).json({ error: "Gagal hitung estimasi" });
  }
});

// ── POST /api/ocean-freight-public/inquiry ────────────────────────────────────
oceanFreightPublicRouter.post("/inquiry", submitLimit, optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const portalCustomerId = (req as Partial<PortalAuthReq>).portalCustomerId;
    let context: Awaited<ReturnType<typeof getPortalCustomerContext>> | null = null;
    if (portalCustomerId) {
      try {
        context = await getPortalCustomerContext(portalCustomerId);
      } catch (error) {
        if (error instanceof PortalCustomerContextError) {
          return res.status(error.statusCode).json({ error: error.message });
        }
        throw error;
      }
      if (!context.customerType) {
        return res.status(422).json({ error: "Profil customer belum menyelesaikan tipe akun." });
      }
      if (context.customerType === "company" && !context.companyId) {
        return res.status(422).json({ error: "Customer Portal belum memiliki membership perusahaan aktif." });
      }
    }
    const customerName = context?.customer.name ?? String(b.customer_name ?? "");
    const customerPhone = context?.customer.phone ?? b.customer_phone ?? null;
    const customerEmail = context?.customer.email ?? b.customer_email ?? null;
    const customerCompany = context
      ? context.company?.name ?? "Individual"
      : b.customer_company ?? null;

    // Validasi wajib
    if (!b.origin_port || !b.destination_port) return res.status(400).json({ error: "origin_port dan destination_port wajib" });
    if (!b.shipment_type) return res.status(400).json({ error: "shipment_type wajib" });
    if (!customerName.trim()) return res.status(400).json({ error: "customer_name wajib" });
    if (String(b.shipment_type) === "FCL" && !b.container_type) return res.status(400).json({ error: "container_type wajib untuk FCL" });
    if (String(b.shipment_type) === "FCL" && Number(b.container_qty ?? 0) < 1) return res.status(400).json({ error: "container_qty minimal 1" });

    const orderNumber = `OFR/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 999999)).padStart(6, "0")}`;
    const quoteToken  = randomBytes(24).toString("hex");
    const pricingBreakdown = b.pricing_breakdown ? JSON.stringify(b.pricing_breakdown) : null;
    const additionalSvc    = b.selected_additional_services ? JSON.stringify(b.selected_additional_services) : "[]";
    const candidateRateIds = b.candidate_rate_ids ? JSON.stringify(b.candidate_rate_ids) : "[]";

    const { rows } = await db.execute(sql`
      INSERT INTO ocean_freight_orders (
        order_number, company_id, portal_customer_id,
        customer_name, customer_phone, customer_email, customer_company,
        origin_city, origin_port, destination_city, destination_port,
        trade_type, service_mode, shipment_type, container_type, container_qty,
        total_cbm, gross_weight, koli, commodity, hs_code, cargo_value,
        cargo_condition, incoterm, etd_preferred, eta_target,
        selected_additional_services, selected_estimate_option,
        estimated_price, estimated_price_idr, currency,
        pricing_breakdown, candidate_rate_ids, selected_rate_id,
        status, source
      ) VALUES (
        ${orderNumber},
        ${context?.companyId ?? null}, ${context?.customer.id ?? null},
        ${customerName.trim()},
        ${customerPhone}, ${customerEmail}, ${customerCompany},
        ${b.origin_city ?? ""}, ${b.origin_port ?? ""}, ${b.destination_city ?? ""}, ${b.destination_port ?? ""},
        ${b.trade_type ?? "export"}, ${b.service_mode ?? "port_to_port"},
        ${b.shipment_type ?? "FCL"}, ${b.container_type ?? null},
        ${b.container_qty ? Number(b.container_qty) : 1},
        ${b.total_cbm ? Number(b.total_cbm) : null},
        ${b.gross_weight ? Number(b.gross_weight) : null},
        ${b.koli ? Number(b.koli) : null},
        ${b.commodity ?? "General Cargo"}, ${b.hs_code ?? null},
        ${b.cargo_value ? Number(b.cargo_value) : null},
        ${b.cargo_condition ?? "general"}, ${b.incoterm ?? null},
        ${b.etd_preferred ?? null}, ${b.eta_target ?? null},
        ${JSON.stringify(b.selected_additional_services ?? [])}::jsonb,
        ${b.selected_estimate_option ?? null},
        ${b.estimated_price ? Number(b.estimated_price) : null},
        ${b.estimated_price_idr ? Number(b.estimated_price_idr) : null},
        ${b.currency ?? "IDR"},
        ${pricingBreakdown}::jsonb,
        ${candidateRateIds}::jsonb,
        ${b.selected_rate_id ? Number(b.selected_rate_id) : null},
        'waiting_rate', 'customer_portal'
      ) RETURNING id, order_number
    `);

    const order = rows[0] as any;

    void NotificationService.saveAndBroadcast("admin_notification", {
      type: "portal_service_submitted",
      orderId: order.id,
      orderNumber: order.order_number,
      customerName,
      companyName: customerCompany,
      title: "Inquiry Ocean Freight baru",
      body: `${customerName} mengirim inquiry Ocean Freight ${order.order_number}.`,
      serviceKey: "ocean-freight",
      dedupeKey: `portal-service:ocean-freight:${order.id}:submitted`,
    });

    // Notify admin
    try {
      const adminWa = await getAdminGroupWa();
      if (adminWa) {
         const msg = `*Ocean Freight Inquiry Baru*\n• Order: ${order.order_number}\n• Customer: ${customerName}\n• Rute: ${b.origin_port} → ${b.destination_port}\n• Jenis: ${b.shipment_type}${b.container_type ? ` / ${b.container_type}` : ""}\n• Status: Menunggu Rate\n\nCek di admin panel untuk blast RFQ.`;
        await sendWhatsApp(adminWa, msg);
      }
    } catch {}

    res.status(201).json({ ok: true, order_number: order.order_number, id: order.id });
  } catch (err) {
    logger.error({ err }, "[ocean-freight-public] POST /inquiry");
    res.status(500).json({ error: "Gagal submit inquiry" });
  }
});

// ── GET /track/:orderNumber ───────────────────────────────────────────────────
oceanFreightPublicRouter.get("/track/:orderNumber", async (req: Request, res: Response) => {
  try {
    const orderNumber = String(req.params.orderNumber ?? "");
    const res2 = await db.execute(sql`SELECT order_number, customer_name, origin_city, origin_port, destination_city, destination_port, shipment_type, container_type, container_qty, total_cbm, carrier, vessel_name, voyage, etd, eta, booking_number, bl_number, tracking_status, status, created_at FROM ocean_freight_orders WHERE order_number = ${orderNumber}`);
    const order = res2.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json(order);
  } catch (err) {
    logger.error({ err }, "[ocean-freight-public] GET /track/:orderNumber");
    res.status(500).json({ error: "Gagal memuat tracking" });
  }
});

// ── GET /api/ocean-freight-public/quote/:token ────────────────────────────────
oceanFreightPublicRouter.get("/quote/:token", async (req: Request, res: Response) => {
  try {
    const token = String(String(req.params.token) ?? "").trim();
    if (!token) return res.status(400).json({ error: "Token tidak valid" });

    const { rows } = await db.execute(sql`
      SELECT * FROM ocean_freight_orders WHERE quote_token = ${token}
    `);
    if (!rows.length) return res.status(404).json({ error: "Quote tidak ditemukan" });

    const order = rows[0] as any;
    // Don't expose internal vendor margin
    const safeOrder = { ...order };
    delete safeOrder.markup_amount;

    return res.json(safeOrder);
  } catch (e) {
    return res.status(500).json({ error: "Gagal ambil quote" });
  }
});

// ── POST /api/ocean-freight-public/quote/:token/approve ──────────────────────
oceanFreightPublicRouter.post("/quote/:token/approve", async (req: Request, res: Response) => {
  try {
    const token = String(String(req.params.token) ?? "");
    const { rows: existing } = await db.execute(sql`
      SELECT id, status FROM ocean_freight_orders WHERE quote_token = ${token}
    `);
    if (!existing.length) return res.status(404).json({ error: "Quote tidak ditemukan" });
    const ord = existing[0] as any;
    if (ord.status !== "quoted") return res.status(400).json({ error: "Quote belum siap untuk di-approve" });

    await db.execute(sql`
      UPDATE ocean_freight_orders SET status = 'approved', updated_at = NOW()
      WHERE id = ${ord.id}
    `);

    // Notify admin
    try {
      const adminGroup = await getAdminGroupWa();
      if (adminGroup) {
        await sendWhatsApp(adminGroup, `✅ *Ocean Freight Diapprove*\nCustomer telah menyetujui quote untuk order tersebut.\nSilakan lakukan konfirmasi booking.`);
      }
    } catch (_) {}

    return res.json({ ok: true, message: "Quote diapprove. Admin akan menghubungi Anda untuk konfirmasi booking." });
  } catch (e) {
    return res.status(500).json({ error: "Gagal approve quote" });
  }
});

// ── POST /api/ocean-freight-public/quote/:token/decline ──────────────────────
oceanFreightPublicRouter.post("/quote/:token/decline", async (req: Request, res: Response) => {
  try {
    const token = String(String(req.params.token) ?? "");
    const { rows: existing } = await db.execute(sql`
      SELECT id, status FROM ocean_freight_orders WHERE quote_token = ${token}
    `);
    if (!existing.length) return res.status(404).json({ error: "Quote tidak ditemukan" });
    const ord = existing[0] as any;
    if (ord.status !== "quoted") return res.status(400).json({ error: "Tidak bisa decline pada status ini" });

    const reason = String(req.body?.reason ?? "");
    await db.execute(sql`
      UPDATE ocean_freight_orders SET status = 'quote_declined', admin_notes = COALESCE(admin_notes, '') || ${reason ? '\nDecline reason: ' + reason : ''}, updated_at = NOW()
      WHERE id = ${ord.id}
    `);

    return res.json({ ok: true, message: "Quote telah didecline." });
  } catch (e) {
    return res.status(500).json({ error: "Gagal decline quote" });
  }
});

export default oceanFreightPublicRouter;
