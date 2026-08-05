import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Boot: create table + ensure rate_code unique constraint ───────────────────
(async () => {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ocean_freight_rates (
      id SERIAL PRIMARY KEY,
      rate_code TEXT,
      rate_source_type TEXT NOT NULL DEFAULT 'shipping_line',
      rate_source_name TEXT NOT NULL DEFAULT '',
      vendor_id INTEGER,
      carrier_name TEXT,
      origin_city TEXT NOT NULL DEFAULT '',
      origin_port TEXT NOT NULL DEFAULT '',
      destination_city TEXT NOT NULL DEFAULT '',
      destination_port TEXT NOT NULL DEFAULT '',
      trade_type TEXT NOT NULL DEFAULT 'export',
      shipment_type TEXT NOT NULL DEFAULT 'FCL',
      service_mode TEXT NOT NULL DEFAULT 'port_to_port',
      container_type TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      exchange_rate_to_idr NUMERIC(15,4) NOT NULL DEFAULT 16500,
      ocean_freight_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      lcl_rate_per_cbm NUMERIC(15,2),
      lcl_minimum_cbm NUMERIC(10,2),
      thc_origin NUMERIC(12,2) NOT NULL DEFAULT 0,
      thc_destination NUMERIC(12,2) NOT NULL DEFAULT 0,
      doc_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      bl_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      do_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      handling_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      customs_clearance_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      trucking_pickup_estimate NUMERIC(12,2) NOT NULL DEFAULT 0,
      trucking_delivery_estimate NUMERIC(12,2) NOT NULL DEFAULT 0,
      insurance_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
      dg_surcharge_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
      reefer_surcharge NUMERIC(12,2) NOT NULL DEFAULT 0,
      peak_season_surcharge NUMERIC(12,2) NOT NULL DEFAULT 0,
      emergency_bunker_surcharge NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency_adjustment_factor NUMERIC(12,2) NOT NULL DEFAULT 0,
      valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
      valid_until DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '90 days'),
      transit_days INTEGER,
      carrier TEXT,
      vessel_name TEXT,
      voyage TEXT,
      direct_or_transshipment TEXT NOT NULL DEFAULT 'direct',
      price_status TEXT NOT NULL DEFAULT 'estimate',
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      company_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)).catch((e: unknown) => console.warn("ofr rates boot:", e));

  // Add unique constraint on rate_code (idempotent)
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ocean_freight_rates_rate_code_uq'
      ) THEN
        ALTER TABLE ocean_freight_rates
          ADD CONSTRAINT ocean_freight_rates_rate_code_uq UNIQUE (rate_code);
      END IF;
    END $$
  `)).catch((e: unknown) => console.warn("ofr rate_code constraint:", e));

  // Fix old 'Westport' destination_port → 'Port Klang'
  await db.execute(sql.raw(`
    UPDATE ocean_freight_rates SET destination_port = 'Port Klang', destination_city = 'Port Klang'
    WHERE destination_port = 'Westport'
  `)).catch(() => {});

  // Cleanup old anonymous seed records (rate_code IS NULL = seeded before uniqueness was added)
  await db.execute(sql.raw(`
    DELETE FROM ocean_freight_rates WHERE rate_code IS NULL
  `)).catch(() => {});

  // ── Seed: insert full set with rate_code ──────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const in90  = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);

  await db.execute(sql.raw(`
    INSERT INTO ocean_freight_rates
      (rate_code,rate_source_type,rate_source_name,carrier_name,
       origin_city,origin_port,destination_city,destination_port,
       trade_type,shipment_type,service_mode,container_type,
       currency,exchange_rate_to_idr,ocean_freight_amount,
       lcl_rate_per_cbm,lcl_minimum_cbm,
       thc_origin,thc_destination,doc_fee,bl_fee,do_fee,handling_fee,
       customs_clearance_fee,transit_days,direct_or_transshipment,
       price_status,is_active,valid_from,valid_until)
    VALUES

      /* ── TANJUNG PRIOK (Jakarta) ─────────────────────────────────────── */
      ('PRIOK-SG-20FT','shipping_line','CMA CGM','CMA CGM',
       'Jakarta','Tanjung Priok','Singapore','PSA Singapore',
       'export','FCL','port_to_port','20ft',
       'USD',16500,380,NULL,NULL,160,180,50,35,45,75,100,4,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-SG-40FT','shipping_line','CMA CGM','CMA CGM',
       'Jakarta','Tanjung Priok','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40ft',
       'USD',16500,650,NULL,NULL,160,180,50,35,45,75,100,4,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-SG-40HC','shipping_line','Evergreen','Evergreen',
       'Jakarta','Tanjung Priok','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40HC',
       'USD',16500,700,NULL,NULL,160,180,50,35,45,75,100,4,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-SG-LCL','nvocc','NVOCC Partner','Via NVOCC',
       'Jakarta','Tanjung Priok','Singapore','PSA Singapore',
       'export','LCL','port_to_port',NULL,
       'USD',16500,0,28,1,80,100,50,35,45,55,100,7,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-PKG-20FT','shipping_line','Evergreen','Evergreen',
       'Jakarta','Tanjung Priok','Port Klang','Port Klang',
       'export','FCL','port_to_port','20ft',
       'USD',16500,280,NULL,NULL,160,160,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-PKG-40FT','shipping_line','Evergreen','Evergreen',
       'Jakarta','Tanjung Priok','Port Klang','Port Klang',
       'export','FCL','port_to_port','40ft',
       'USD',16500,480,NULL,NULL,160,160,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-SHA-20FT','shipping_line','Yang Ming','Yang Ming',
       'Jakarta','Tanjung Priok','Shanghai','Shanghai Yangshan',
       'export','FCL','port_to_port','20ft',
       'USD',16500,850,NULL,NULL,160,200,50,35,45,75,100,14,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-SHA-40FT','shipping_line','Yang Ming','Yang Ming',
       'Jakarta','Tanjung Priok','Shanghai','Shanghai Yangshan',
       'export','FCL','port_to_port','40ft',
       'USD',16500,1400,NULL,NULL,160,200,50,35,45,75,100,14,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-NBO-20FT','shipping_line','Yang Ming','Yang Ming',
       'Jakarta','Tanjung Priok','Ningbo','Ningbo Port',
       'export','FCL','port_to_port','20ft',
       'USD',16500,900,NULL,NULL,160,200,50,35,45,75,100,14,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-NBO-40FT','shipping_line','CMA CGM','CMA CGM',
       'Jakarta','Tanjung Priok','Ningbo','Ningbo Port',
       'export','FCL','port_to_port','40ft',
       'USD',16500,1500,NULL,NULL,160,200,50,35,45,75,100,15,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-BUS-20FT','shipping_line','Evergreen','Evergreen',
       'Jakarta','Tanjung Priok','Busan','Busan New Port',
       'export','FCL','port_to_port','20ft',
       'USD',16500,1000,NULL,NULL,160,220,50,35,45,75,100,16,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-BUS-40FT','shipping_line','Evergreen','Evergreen',
       'Jakarta','Tanjung Priok','Busan','Busan New Port',
       'export','FCL','port_to_port','40ft',
       'USD',16500,1800,NULL,NULL,160,220,50,35,45,75,100,16,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PRIOK-HKG-20FT','shipping_line','SITC','SITC',
       'Jakarta','Tanjung Priok','Hong Kong','Hong Kong',
       'export','FCL','port_to_port','20ft',
       'USD',16500,550,NULL,NULL,160,190,50,35,45,75,100,8,'direct','estimate',TRUE,'${today}','${in90}'),

      /* ── TANJUNG PERAK (Surabaya) ─────────────────────────────────────── */
      ('PERAK-SG-20FT','shipping_line','Samudera','Samudera',
       'Surabaya','Tanjung Perak','Singapore','PSA Singapore',
       'export','FCL','port_to_port','20ft',
       'USD',16500,350,NULL,NULL,150,180,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-SG-40FT','shipping_line','Samudera','Samudera',
       'Surabaya','Tanjung Perak','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40ft',
       'USD',16500,600,NULL,NULL,150,180,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-SG-40HC','shipping_line','Wan Hai','Wan Hai',
       'Surabaya','Tanjung Perak','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40HC',
       'USD',16500,660,NULL,NULL,150,180,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-SG-LCL','nvocc','NVOCC Partner','Via NVOCC',
       'Surabaya','Tanjung Perak','Singapore','PSA Singapore',
       'export','LCL','port_to_port',NULL,
       'USD',16500,0,30,1,80,100,50,35,45,60,100,6,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-PKG-20FT','shipping_line','Wan Hai','Wan Hai',
       'Surabaya','Tanjung Perak','Port Klang','Port Klang',
       'export','FCL','port_to_port','20ft',
       'USD',16500,300,NULL,NULL,150,160,50,35,45,75,100,6,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-PKG-40FT','shipping_line','Wan Hai','Wan Hai',
       'Surabaya','Tanjung Perak','Port Klang','Port Klang',
       'export','FCL','port_to_port','40ft',
       'USD',16500,520,NULL,NULL,150,160,50,35,45,75,100,6,'direct','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-SHA-20FT','shipping_line','SITC','SITC',
       'Surabaya','Tanjung Perak','Shanghai','Shanghai Yangshan',
       'export','FCL','port_to_port','20ft',
       'USD',16500,900,NULL,NULL,150,200,50,35,45,75,100,15,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-SHA-40FT','shipping_line','SITC','SITC',
       'Surabaya','Tanjung Perak','Shanghai','Shanghai Yangshan',
       'export','FCL','port_to_port','40ft',
       'USD',16500,1500,NULL,NULL,150,200,50,35,45,75,100,15,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-NBO-20FT','shipping_line','SITC','SITC',
       'Surabaya','Tanjung Perak','Ningbo','Ningbo Port',
       'export','FCL','port_to_port','20ft',
       'USD',16500,950,NULL,NULL,150,200,50,35,45,75,100,16,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-NBO-40FT','shipping_line','SITC','SITC',
       'Surabaya','Tanjung Perak','Ningbo','Ningbo Port',
       'export','FCL','port_to_port','40ft',
       'USD',16500,1600,NULL,NULL,150,200,50,35,45,75,100,16,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-BUS-20FT','shipping_line','RCL','RCL',
       'Surabaya','Tanjung Perak','Busan','Busan New Port',
       'export','FCL','port_to_port','20ft',
       'USD',16500,1100,NULL,NULL,150,220,50,35,45,75,100,17,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('PERAK-BUS-40FT','shipping_line','RCL','RCL',
       'Surabaya','Tanjung Perak','Busan','Busan New Port',
       'export','FCL','port_to_port','40ft',
       'USD',16500,1900,NULL,NULL,150,220,50,35,45,75,100,17,'transshipment','estimate',TRUE,'${today}','${in90}'),

      /* ── BELAWAN (Medan) ─────────────────────────────────────────────── */
      ('BLAW-SG-20FT','shipping_line','Samudera','Samudera',
       'Medan','Belawan','Singapore','PSA Singapore',
       'export','FCL','port_to_port','20ft',
       'USD',16500,280,NULL,NULL,140,180,50,35,45,75,100,3,'direct','estimate',TRUE,'${today}','${in90}'),

      ('BLAW-SG-40FT','shipping_line','Samudera','Samudera',
       'Medan','Belawan','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40ft',
       'USD',16500,480,NULL,NULL,140,180,50,35,45,75,100,3,'direct','estimate',TRUE,'${today}','${in90}'),

      ('BLAW-SG-LCL','nvocc','NVOCC Partner','Via NVOCC',
       'Medan','Belawan','Singapore','PSA Singapore',
       'export','LCL','port_to_port',NULL,
       'USD',16500,0,25,1,80,100,50,35,45,55,100,4,'direct','estimate',TRUE,'${today}','${in90}'),

      ('BLAW-PKG-20FT','shipping_line','Samudera','Samudera',
       'Medan','Belawan','Port Klang','Port Klang',
       'export','FCL','port_to_port','20ft',
       'USD',16500,220,NULL,NULL,140,160,50,35,45,75,100,2,'direct','estimate',TRUE,'${today}','${in90}'),

      ('BLAW-PKG-40FT','shipping_line','PIL','PIL',
       'Medan','Belawan','Port Klang','Port Klang',
       'export','FCL','port_to_port','40ft',
       'USD',16500,380,NULL,NULL,140,160,50,35,45,75,100,3,'direct','estimate',TRUE,'${today}','${in90}'),

      ('BLAW-SHA-20FT','shipping_line','SITC','SITC',
       'Medan','Belawan','Shanghai','Shanghai Yangshan',
       'export','FCL','port_to_port','20ft',
       'USD',16500,800,NULL,NULL,140,200,50,35,45,75,100,12,'transshipment','estimate',TRUE,'${today}','${in90}'),

      /* ── MAKASSAR ─────────────────────────────────────────────────────── */
      ('MKS-SG-20FT','shipping_line','Meratus','Meratus',
       'Makassar','Makassar','Singapore','PSA Singapore',
       'export','FCL','port_to_port','20ft',
       'USD',16500,420,NULL,NULL,150,180,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('MKS-SG-40FT','shipping_line','Meratus','Meratus',
       'Makassar','Makassar','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40ft',
       'USD',16500,720,NULL,NULL,150,180,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('MKS-SG-LCL','nvocc','NVOCC Partner','Via NVOCC',
       'Makassar','Makassar','Singapore','PSA Singapore',
       'export','LCL','port_to_port',NULL,
       'USD',16500,0,32,1,80,100,50,35,45,55,100,7,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('MKS-PKG-20FT','shipping_line','Meratus','Meratus',
       'Makassar','Makassar','Port Klang','Port Klang',
       'export','FCL','port_to_port','20ft',
       'USD',16500,380,NULL,NULL,150,160,50,35,45,75,100,6,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('MKS-JKT-20FT','shipping_line','Meratus','Meratus',
       'Makassar','Makassar','Jakarta','Tanjung Priok',
       'domestic','FCL','port_to_port','20ft',
       'IDR',1,2500000,NULL,NULL,500000,500000,250000,175000,225000,375000,500000,4,'direct','estimate',TRUE,'${today}','${in90}'),

      ('MKS-JKT-40FT','shipping_line','Meratus','Meratus',
       'Makassar','Makassar','Jakarta','Tanjung Priok',
       'domestic','FCL','port_to_port','40ft',
       'IDR',1,4500000,NULL,NULL,500000,500000,250000,175000,225000,375000,500000,4,'direct','estimate',TRUE,'${today}','${in90}'),

      /* ── BALIKPAPAN ───────────────────────────────────────────────────── */
      ('BPN-SG-20FT','shipping_line','Meratus','Meratus',
       'Balikpapan','Balikpapan','Singapore','PSA Singapore',
       'export','FCL','port_to_port','20ft',
       'USD',16500,480,NULL,NULL,155,180,50,35,45,75,100,6,'direct','estimate',TRUE,'${today}','${in90}'),

      ('BPN-SG-40FT','shipping_line','Meratus','Meratus',
       'Balikpapan','Balikpapan','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40ft',
       'USD',16500,820,NULL,NULL,155,180,50,35,45,75,100,6,'direct','estimate',TRUE,'${today}','${in90}'),

      ('BPN-PKG-20FT','shipping_line','PIL','PIL',
       'Balikpapan','Balikpapan','Port Klang','Port Klang',
       'export','FCL','port_to_port','20ft',
       'USD',16500,400,NULL,NULL,155,160,50,35,45,75,100,7,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('BPN-PKG-40FT','shipping_line','PIL','PIL',
       'Balikpapan','Balikpapan','Port Klang','Port Klang',
       'export','FCL','port_to_port','40ft',
       'USD',16500,700,NULL,NULL,155,160,50,35,45,75,100,7,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('BPN-SHA-20FT','shipping_line','SITC','SITC',
       'Balikpapan','Balikpapan','Shanghai','Shanghai Yangshan',
       'export','FCL','port_to_port','20ft',
       'USD',16500,950,NULL,NULL,155,200,50,35,45,75,100,16,'transshipment','estimate',TRUE,'${today}','${in90}'),

      /* ── SEMARANG (Tanjung Emas) ─────────────────────────────────────── */
      ('SMG-SG-20FT','shipping_line','Evergreen','Evergreen',
       'Semarang','Tanjung Emas','Singapore','PSA Singapore',
       'export','FCL','port_to_port','20ft',
       'USD',16500,360,NULL,NULL,150,180,50,35,45,75,100,4,'direct','estimate',TRUE,'${today}','${in90}'),

      ('SMG-SG-40FT','shipping_line','Evergreen','Evergreen',
       'Semarang','Tanjung Emas','Singapore','PSA Singapore',
       'export','FCL','port_to_port','40ft',
       'USD',16500,620,NULL,NULL,150,180,50,35,45,75,100,4,'direct','estimate',TRUE,'${today}','${in90}'),

      ('SMG-SG-LCL','nvocc','NVOCC Partner','Via NVOCC',
       'Semarang','Tanjung Emas','Singapore','PSA Singapore',
       'export','LCL','port_to_port',NULL,
       'USD',16500,0,29,1,80,100,50,35,45,55,100,6,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('SMG-PKG-20FT','shipping_line','Yang Ming','Yang Ming',
       'Semarang','Tanjung Emas','Port Klang','Port Klang',
       'export','FCL','port_to_port','20ft',
       'USD',16500,290,NULL,NULL,150,160,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('SMG-PKG-40FT','shipping_line','Yang Ming','Yang Ming',
       'Semarang','Tanjung Emas','Port Klang','Port Klang',
       'export','FCL','port_to_port','40ft',
       'USD',16500,500,NULL,NULL,150,160,50,35,45,75,100,5,'direct','estimate',TRUE,'${today}','${in90}'),

      ('SMG-SHA-20FT','shipping_line','Yang Ming','Yang Ming',
       'Semarang','Tanjung Emas','Shanghai','Shanghai Yangshan',
       'export','FCL','port_to_port','20ft',
       'USD',16500,880,NULL,NULL,150,200,50,35,45,75,100,14,'transshipment','estimate',TRUE,'${today}','${in90}'),

      ('SMG-BUS-20FT','shipping_line','Evergreen','Evergreen',
       'Semarang','Tanjung Emas','Busan','Busan New Port',
       'export','FCL','port_to_port','20ft',
       'USD',16500,1050,NULL,NULL,150,220,50,35,45,75,100,16,'transshipment','estimate',TRUE,'${today}','${in90}')

    ON CONFLICT (rate_code) DO NOTHING
  `)).catch((e: unknown) => console.warn("ofr rates seed:", e));
})();

// ── CSV utilities ──────────────────────────────────────────────────────────────
function csvEsc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r"))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsvRow(fields: unknown[]): string { return fields.map(csvEsc).join(","); }

function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++; let val = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { val += line[i++]; }
      }
      result.push(val);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { result.push(line.slice(i)); break; }
      result.push(line.slice(i, end)); i = end + 1;
    }
  }
  return result;
}

function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCsvRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h.trim()] = vals[idx] ?? ""; });
    return obj;
  }).filter(r => Object.values(r).some(v => v.trim()));
}

function csvTextParser(req: Request, _res: Response, next: NextFunction) {
  const ct = String(req.headers["content-type"] ?? "");
  if (!ct.includes("text/csv") && !ct.includes("text/plain") && !ct.includes("application/octet-stream")) return next();
  let data = ""; req.setEncoding("utf8");
  req.on("data", (chunk: string) => { data += chunk; });
  req.on("end", () => { (req as any).body = data; next(); });
  req.on("error", () => next(new Error("Failed to read CSV body")));
}

const RATE_HEADERS = [
  "rate_code","rate_source_type","rate_source_name","carrier_name",
  "origin_city","origin_port","destination_city","destination_port",
  "trade_type","shipment_type","service_mode","container_type",
  "currency","exchange_rate_to_idr","ocean_freight_amount",
  "lcl_rate_per_cbm","lcl_minimum_cbm",
  "thc_origin","thc_destination","doc_fee","bl_fee","do_fee","handling_fee",
  "customs_clearance_fee","trucking_pickup_estimate","trucking_delivery_estimate",
  "insurance_percent","dg_surcharge_percent","reefer_surcharge",
  "peak_season_surcharge","emergency_bunker_surcharge","currency_adjustment_factor",
  "valid_from","valid_until","transit_days","carrier","vessel_name","voyage",
  "direct_or_transshipment","price_status","notes","is_active",
];

// ── Validation ─────────────────────────────────────────────────────────────────
function validateRate(b: Record<string, unknown>): string | null {
  if (!b.currency) return "currency wajib diisi";
  const currency = String(b.currency);
  if (currency !== "IDR") {
    const exr = Number(b.exchange_rate_to_idr ?? 0);
    if (!exr || exr <= 0) return "exchange_rate_to_idr wajib diisi jika currency bukan IDR";
  }
  if (b.valid_until && b.valid_from && String(b.valid_until) < String(b.valid_from))
    return "valid_until harus >= valid_from";
  const shipType = String(b.shipment_type ?? "FCL");
  if (shipType === "FCL") {
    if (!b.container_type) return "container_type wajib untuk FCL";
    if (Number(b.ocean_freight_amount ?? 0) < 0) return "ocean_freight_amount tidak boleh negatif";
  }
  if (shipType === "LCL") {
    if (Number(b.lcl_rate_per_cbm ?? 0) <= 0) return "lcl_rate_per_cbm wajib untuk LCL";
    if (Number(b.lcl_minimum_cbm ?? 0) < 0) return "lcl_minimum_cbm tidak boleh negatif";
  }
  return null;
}

// ── GET /rates ────────────────────────────────────────────────────────────────
router.get("/rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const cId        = req.query.companyId ? Number(req.query.companyId) : null;
    const originPort = (req.query.origin_port as string) || null;
    const destPort   = (req.query.destination_port as string) || null;
    const shipType   = (req.query.shipment_type as string) || null;
    const contType   = (req.query.container_type as string) || null;
    const svcMode    = (req.query.service_mode as string) || null;
    const srcType    = (req.query.rate_source_type as string) || null;
    const currency   = (req.query.currency as string) || null;
    const tradeType  = (req.query.trade_type as string) || null;
    const validOnly  = req.query.valid_only !== "false";
    const activeOnly = req.query.active_only !== "false";
    const search     = (req.query.search as string) || null;
    const page       = Math.max(1, Number(req.query.page ?? 1));
    const limit      = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const offset     = (page - 1) * limit;
    const today      = new Date().toISOString().slice(0, 10);

    const where = [
      cId != null ? `company_id = ${cId}` : "TRUE",
      originPort ? `origin_port ILIKE '%${originPort.replace(/'/g, "''")}%'` : "TRUE",
      destPort   ? `destination_port ILIKE '%${destPort.replace(/'/g, "''")}%'` : "TRUE",
      shipType   ? `shipment_type = '${shipType.replace(/'/g, "''")}'` : "TRUE",
      contType   ? `container_type = '${contType.replace(/'/g, "''")}'` : "TRUE",
      svcMode    ? `service_mode = '${svcMode.replace(/'/g, "''")}'` : "TRUE",
      srcType    ? `rate_source_type = '${srcType.replace(/'/g, "''")}'` : "TRUE",
      currency   ? `currency = '${currency.replace(/'/g, "''")}'` : "TRUE",
      tradeType  ? `trade_type = '${tradeType.replace(/'/g, "''")}'` : "TRUE",
      activeOnly ? "is_active = TRUE" : "TRUE",
      validOnly  ? `(valid_from <= '${today}' AND valid_until >= '${today}')` : "TRUE",
      search     ? `(rate_source_name ILIKE '%${search.replace(/'/g, "''")}%' OR carrier_name ILIKE '%${search.replace(/'/g, "''")}%' OR origin_port ILIKE '%${search.replace(/'/g, "''")}%' OR destination_port ILIKE '%${search.replace(/'/g, "''")}%')` : "TRUE",
    ].join(" AND ");

    const [dataRes, cntRes] = await Promise.all([
      db.execute(sql.raw(`SELECT * FROM ocean_freight_rates WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`)),
      db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM ocean_freight_rates WHERE ${where}`)),
    ]);
    res.json({ data: dataRes.rows, total: Number((cntRes.rows[0] as any)?.cnt ?? 0), page, limit });
  } catch (err) {
    logger.error({ err }, "[ocean-freight-rates] GET /rates");
    res.status(500).json({ error: "Gagal memuat rates" });
  }
});

// ── POST /rates ───────────────────────────────────────────────────────────────
router.post("/rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const b = req.body as Record<string, unknown>;
    const err = validateRate(b);
    if (err) return res.status(400).json({ error: err });

    const fields = [
      "rate_code","rate_source_type","rate_source_name","vendor_id","carrier_name",
      "origin_city","origin_port","destination_city","destination_port","trade_type",
      "shipment_type","service_mode","container_type","currency","exchange_rate_to_idr",
      "ocean_freight_amount","lcl_rate_per_cbm","lcl_minimum_cbm","thc_origin","thc_destination",
      "doc_fee","bl_fee","do_fee","handling_fee","customs_clearance_fee",
      "trucking_pickup_estimate","trucking_delivery_estimate","insurance_percent",
      "dg_surcharge_percent","reefer_surcharge","peak_season_surcharge",
      "emergency_bunker_surcharge","currency_adjustment_factor",
      "valid_from","valid_until","transit_days","carrier","vessel_name","voyage",
      "direct_or_transshipment","price_status","notes","is_active",
    ];
    const cols: string[] = [];
    const vals: string[] = [];
    for (const f of fields) {
      if (b[f] === undefined || b[f] === null) continue;
      cols.push(f);
      const v = b[f];
      if (typeof v === "boolean") vals.push(v ? "TRUE" : "FALSE");
      else if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v !== "")) vals.push(String(Number(v)));
      else vals.push(`'${String(v).replace(/'/g, "''")}'`);
    }

    const res2 = await db.execute(sql.raw(`INSERT INTO ocean_freight_rates (${cols.join(",")}) VALUES (${vals.join(",")}) RETURNING *`));
    res.status(201).json(res2.rows[0]);
  } catch (err) {
    logger.error({ err }, "[ocean-freight-rates] POST /rates");
    res.status(500).json({ error: "Gagal membuat rate" });
  }
});

// ── PUT /rates/:id ────────────────────────────────────────────────────────────
router.put("/rates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const b  = req.body as Record<string, unknown>;
    const err = validateRate(b);
    if (err) return res.status(400).json({ error: err });

    const updatable = [
      "rate_code","rate_source_type","rate_source_name","vendor_id","carrier_name",
      "origin_city","origin_port","destination_city","destination_port","trade_type",
      "shipment_type","service_mode","container_type","currency","exchange_rate_to_idr",
      "ocean_freight_amount","lcl_rate_per_cbm","lcl_minimum_cbm","thc_origin","thc_destination",
      "doc_fee","bl_fee","do_fee","handling_fee","customs_clearance_fee",
      "trucking_pickup_estimate","trucking_delivery_estimate","insurance_percent",
      "dg_surcharge_percent","reefer_surcharge","peak_season_surcharge",
      "emergency_bunker_surcharge","currency_adjustment_factor",
      "valid_from","valid_until","transit_days","carrier","vessel_name","voyage",
      "direct_or_transshipment","price_status","notes","is_active",
    ];
    const sets: string[] = [];
    for (const f of updatable) {
      if (!(f in b)) continue;
      const v = b[f];
      if (typeof v === "boolean") sets.push(`${f} = ${v ? "TRUE" : "FALSE"}`);
      else if (v === null) sets.push(`${f} = NULL`);
      else if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v !== "")) sets.push(`${f} = ${Number(v)}`);
      else sets.push(`${f} = '${String(v).replace(/'/g, "''")}'`);
    }
    if (!sets.length) return res.status(400).json({ error: "Tidak ada field untuk diupdate" });
    sets.push("updated_at = NOW()");

    const res2 = await db.execute(sql.raw(`UPDATE ocean_freight_rates SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
    if (!res2.rows[0]) return res.status(404).json({ error: "Rate tidak ditemukan" });
    res.json(res2.rows[0]);
  } catch (err) {
    logger.error({ err }, "[ocean-freight-rates] PUT /rates/:id");
    res.status(500).json({ error: "Gagal update rate" });
  }
});

// ── DELETE /rates/:id ─────────────────────────────────────────────────────────
router.delete("/rates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    await db.execute(sql.raw(`DELETE FROM ocean_freight_rates WHERE id = ${id}`));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ocean-freight-rates] DELETE /rates/:id");
    res.status(500).json({ error: "Gagal hapus rate" });
  }
});

// ── PATCH /rates/:id/toggle ───────────────────────────────────────────────────
router.patch("/rates/:id/toggle", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const res2 = await db.execute(sql.raw(`UPDATE ocean_freight_rates SET is_active = NOT is_active, updated_at = NOW() WHERE id = ${id} RETURNING is_active`));
    if (!res2.rows[0]) return res.status(404).json({ error: "Rate tidak ditemukan" });
    res.json({ ok: true, is_active: (res2.rows[0] as any).is_active });
  } catch (err) {
    logger.error({ err }, "[ocean-freight-rates] PATCH /rates/:id/toggle");
    res.status(500).json({ error: "Gagal toggle rate" });
  }
});

const today = new Date().toISOString().slice(0, 10);
const in90  = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);

// GET /api/ocean-freight-rates — list
router.get("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const origin = req.query.origin_port ? String(req.query.origin_port) : null;
    const dest   = req.query.destination_port ? String(req.query.destination_port) : null;
    const { rows } = await db.execute(sql`
      SELECT r.*, s.name AS vendor_name
      FROM ocean_freight_rates r
      LEFT JOIN suppliers s ON s.id = r.vendor_id
      WHERE (${origin}::text IS NULL OR LOWER(r.origin_port) = LOWER(${origin}))
        AND (${dest}::text IS NULL OR LOWER(r.destination_port) = LOWER(${dest}))
      ORDER BY r.origin_port, r.destination_port, r.shipment_type, r.container_type
    `);
    return res.json(rows);
  } catch (e) {
    console.error("[ocean-freight-rates/list]", e);
    return res.status(500).json({ error: "Gagal ambil data rate" });
  }
});

// GET /api/ocean-freight-rates/export
router.get("/export", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.execute(sql`SELECT * FROM ocean_freight_rates ORDER BY origin_port, destination_port, shipment_type, container_type`);
    const lines = [RATE_HEADERS.join(",")];
    for (const r of rows as Record<string, unknown>[]) lines.push(toCsvRow(RATE_HEADERS.map(h => r[h])));
    const filename = `ocean-freight-rates-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + lines.join("\n"));
  } catch (e) {
    console.error("[ofr/export]", e);
    return res.status(500).json({ error: "Gagal export rates" });
  }
});

// POST /api/ocean-freight-rates/import
router.post("/import", requireAdmin, csvTextParser, async (req: Request, res: Response) => {
  try {
    const csvRows = parseCsvText(String(req.body ?? ""));
    if (!csvRows.length) return res.status(400).json({ error: "File CSV kosong atau format tidak valid" });
    let processed = 0;
    const errors: string[] = [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const in90Str  = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    for (const r of csvRows) {
      try {
        const isActive = r.is_active !== "false" && r.is_active !== "0" && r.is_active !== "";
        if (r.rate_code) {
          await db.execute(sql`
            INSERT INTO ocean_freight_rates (
              rate_code,rate_source_type,rate_source_name,carrier_name,
              origin_city,origin_port,destination_city,destination_port,
              trade_type,shipment_type,service_mode,container_type,
              currency,exchange_rate_to_idr,ocean_freight_amount,
              lcl_rate_per_cbm,lcl_minimum_cbm,
              thc_origin,thc_destination,doc_fee,bl_fee,do_fee,handling_fee,
              customs_clearance_fee,trucking_pickup_estimate,trucking_delivery_estimate,
              insurance_percent,dg_surcharge_percent,reefer_surcharge,
              peak_season_surcharge,emergency_bunker_surcharge,currency_adjustment_factor,
              valid_from,valid_until,transit_days,carrier,vessel_name,voyage,
              direct_or_transshipment,price_status,notes,is_active,updated_at
            ) VALUES (
              ${r.rate_code},${r.rate_source_type||"shipping_line"},${r.rate_source_name||""},${r.carrier_name||null},
              ${r.origin_city||""},${r.origin_port||""},${r.destination_city||""},${r.destination_port||""},
              ${r.trade_type||"export"},${r.shipment_type||"FCL"},${r.service_mode||"port_to_port"},${r.container_type||null},
              ${r.currency||"USD"},${Number(r.exchange_rate_to_idr)||16500},${Number(r.ocean_freight_amount)||0},
              ${r.lcl_rate_per_cbm?Number(r.lcl_rate_per_cbm):null},${r.lcl_minimum_cbm?Number(r.lcl_minimum_cbm):null},
              ${Number(r.thc_origin)||0},${Number(r.thc_destination)||0},${Number(r.doc_fee)||0},${Number(r.bl_fee)||0},
              ${Number(r.do_fee)||0},${Number(r.handling_fee)||0},${Number(r.customs_clearance_fee)||0},
              ${Number(r.trucking_pickup_estimate)||0},${Number(r.trucking_delivery_estimate)||0},
              ${Number(r.insurance_percent)||0},${Number(r.dg_surcharge_percent)||0},${Number(r.reefer_surcharge)||0},
              ${Number(r.peak_season_surcharge)||0},${Number(r.emergency_bunker_surcharge)||0},${Number(r.currency_adjustment_factor)||0},
              ${r.valid_from||todayStr}::date,${r.valid_until||in90Str}::date,
              ${r.transit_days?Number(r.transit_days):null},${r.carrier||null},${r.vessel_name||null},${r.voyage||null},
              ${r.direct_or_transshipment||"direct"},${r.price_status||"estimate"},${r.notes||null},${isActive},NOW()
            )
            ON CONFLICT (rate_code) DO UPDATE SET
              rate_source_type=EXCLUDED.rate_source_type,rate_source_name=EXCLUDED.rate_source_name,
              carrier_name=EXCLUDED.carrier_name,origin_city=EXCLUDED.origin_city,origin_port=EXCLUDED.origin_port,
              destination_city=EXCLUDED.destination_city,destination_port=EXCLUDED.destination_port,
              trade_type=EXCLUDED.trade_type,shipment_type=EXCLUDED.shipment_type,service_mode=EXCLUDED.service_mode,
              container_type=EXCLUDED.container_type,currency=EXCLUDED.currency,
              exchange_rate_to_idr=EXCLUDED.exchange_rate_to_idr,ocean_freight_amount=EXCLUDED.ocean_freight_amount,
              lcl_rate_per_cbm=EXCLUDED.lcl_rate_per_cbm,lcl_minimum_cbm=EXCLUDED.lcl_minimum_cbm,
              thc_origin=EXCLUDED.thc_origin,thc_destination=EXCLUDED.thc_destination,
              doc_fee=EXCLUDED.doc_fee,bl_fee=EXCLUDED.bl_fee,do_fee=EXCLUDED.do_fee,
              handling_fee=EXCLUDED.handling_fee,customs_clearance_fee=EXCLUDED.customs_clearance_fee,
              trucking_pickup_estimate=EXCLUDED.trucking_pickup_estimate,trucking_delivery_estimate=EXCLUDED.trucking_delivery_estimate,
              insurance_percent=EXCLUDED.insurance_percent,dg_surcharge_percent=EXCLUDED.dg_surcharge_percent,
              reefer_surcharge=EXCLUDED.reefer_surcharge,peak_season_surcharge=EXCLUDED.peak_season_surcharge,
              emergency_bunker_surcharge=EXCLUDED.emergency_bunker_surcharge,currency_adjustment_factor=EXCLUDED.currency_adjustment_factor,
              valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,transit_days=EXCLUDED.transit_days,
              carrier=EXCLUDED.carrier,vessel_name=EXCLUDED.vessel_name,voyage=EXCLUDED.voyage,
              direct_or_transshipment=EXCLUDED.direct_or_transshipment,price_status=EXCLUDED.price_status,
              notes=EXCLUDED.notes,is_active=EXCLUDED.is_active,updated_at=NOW()
          `);
        } else {
          await db.execute(sql`
            INSERT INTO ocean_freight_rates (
              rate_source_type,rate_source_name,carrier_name,
              origin_city,origin_port,destination_city,destination_port,
              trade_type,shipment_type,service_mode,container_type,
              currency,exchange_rate_to_idr,ocean_freight_amount,
              lcl_rate_per_cbm,lcl_minimum_cbm,
              thc_origin,thc_destination,doc_fee,bl_fee,do_fee,handling_fee,
              customs_clearance_fee,trucking_pickup_estimate,trucking_delivery_estimate,
              insurance_percent,dg_surcharge_percent,reefer_surcharge,
              peak_season_surcharge,emergency_bunker_surcharge,currency_adjustment_factor,
              valid_from,valid_until,transit_days,carrier,vessel_name,voyage,
              direct_or_transshipment,price_status,notes,is_active,updated_at
            ) VALUES (
              ${r.rate_source_type||"shipping_line"},${r.rate_source_name||""},${r.carrier_name||null},
              ${r.origin_city||""},${r.origin_port||""},${r.destination_city||""},${r.destination_port||""},
              ${r.trade_type||"export"},${r.shipment_type||"FCL"},${r.service_mode||"port_to_port"},${r.container_type||null},
              ${r.currency||"USD"},${Number(r.exchange_rate_to_idr)||16500},${Number(r.ocean_freight_amount)||0},
              ${r.lcl_rate_per_cbm?Number(r.lcl_rate_per_cbm):null},${r.lcl_minimum_cbm?Number(r.lcl_minimum_cbm):null},
              ${Number(r.thc_origin)||0},${Number(r.thc_destination)||0},${Number(r.doc_fee)||0},${Number(r.bl_fee)||0},
              ${Number(r.do_fee)||0},${Number(r.handling_fee)||0},${Number(r.customs_clearance_fee)||0},
              ${Number(r.trucking_pickup_estimate)||0},${Number(r.trucking_delivery_estimate)||0},
              ${Number(r.insurance_percent)||0},${Number(r.dg_surcharge_percent)||0},${Number(r.reefer_surcharge)||0},
              ${Number(r.peak_season_surcharge)||0},${Number(r.emergency_bunker_surcharge)||0},${Number(r.currency_adjustment_factor)||0},
              ${r.valid_from||todayStr}::date,${r.valid_until||in90Str}::date,
              ${r.transit_days?Number(r.transit_days):null},${r.carrier||null},${r.vessel_name||null},${r.voyage||null},
              ${r.direct_or_transshipment||"direct"},${r.price_status||"estimate"},${r.notes||null},${isActive},NOW()
            )
          `);
        }
        processed++;
      } catch (e: any) {
        errors.push(`${r.rate_code || "(no code)"}: ${e.message}`);
      }
    }
    return res.json({ total: csvRows.length, processed, errors });
  } catch (e) {
    console.error("[ofr/import]", e);
    return res.status(500).json({ error: "Gagal import rates" });
  }
});

// GET /api/ocean-freight-rates/:id
router.get("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { rows } = await db.execute(sql`
      SELECT * FROM ocean_freight_rates WHERE id = ${Number(req.params.id)}
    `);
    if (!rows.length) return res.status(404).json({ error: "Rate tidak ditemukan" });
    return res.json(rows[0]);
  } catch (e) {
    return res.status(500).json({ error: "Gagal ambil rate" });
  }
});

// POST /api/ocean-freight-rates
router.post("/", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const err = validateRate(b);
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await db.execute(sql`
      INSERT INTO ocean_freight_rates (
        rate_code, rate_source_type, rate_source_name, vendor_id, carrier_name,
        origin_city, origin_port, destination_city, destination_port,
        trade_type, shipment_type, service_mode, container_type,
        currency, exchange_rate_to_idr, ocean_freight_amount,
        lcl_rate_per_cbm, lcl_minimum_cbm,
        thc_origin, thc_destination, doc_fee, bl_fee, do_fee, handling_fee,
        customs_clearance_fee, trucking_pickup_estimate, trucking_delivery_estimate,
        insurance_percent, dg_surcharge_percent, reefer_surcharge,
        peak_season_surcharge, emergency_bunker_surcharge, currency_adjustment_factor,
        valid_from, valid_until, transit_days, carrier, vessel_name, voyage,
        direct_or_transshipment, price_status, notes, is_active,
        created_at, updated_at
      ) VALUES (
        ${b.rate_code ?? null}, ${b.rate_source_type ?? "shipping_line"}, ${b.rate_source_name ?? ""},
        ${b.vendor_id ? Number(b.vendor_id) : null}, ${b.carrier_name ?? null},
        ${b.origin_city ?? ""}, ${b.origin_port ?? ""}, ${b.destination_city ?? ""}, ${b.destination_port ?? ""},
        ${b.trade_type ?? "export"}, ${b.shipment_type ?? "FCL"}, ${b.service_mode ?? "port_to_port"},
        ${b.container_type ?? null},
        ${b.currency ?? "USD"}, ${Number(b.exchange_rate_to_idr ?? 16500)}, ${Number(b.ocean_freight_amount ?? 0)},
        ${b.lcl_rate_per_cbm ? Number(b.lcl_rate_per_cbm) : null},
        ${b.lcl_minimum_cbm ? Number(b.lcl_minimum_cbm) : null},
        ${Number(b.thc_origin ?? 0)}, ${Number(b.thc_destination ?? 0)},
        ${Number(b.doc_fee ?? 0)}, ${Number(b.bl_fee ?? 0)}, ${Number(b.do_fee ?? 0)},
        ${Number(b.handling_fee ?? 0)}, ${Number(b.customs_clearance_fee ?? 0)},
        ${Number(b.trucking_pickup_estimate ?? 0)}, ${Number(b.trucking_delivery_estimate ?? 0)},
        ${Number(b.insurance_percent ?? 0)}, ${Number(b.dg_surcharge_percent ?? 0)},
        ${Number(b.reefer_surcharge ?? 0)}, ${Number(b.peak_season_surcharge ?? 0)},
        ${Number(b.emergency_bunker_surcharge ?? 0)}, ${Number(b.currency_adjustment_factor ?? 0)},
        ${b.valid_from ?? today}::date, ${b.valid_until ?? in90}::date,
        ${b.transit_days ? Number(b.transit_days) : null},
        ${b.carrier ?? null}, ${b.vessel_name ?? null}, ${b.voyage ?? null},
        ${b.direct_or_transshipment ?? "direct"}, ${b.price_status ?? "estimate"},
        ${b.notes ?? null}, ${b.is_active !== false},
        NOW(), NOW()
      ) RETURNING *
    `);
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error("[ocean-freight-rates/create]", e);
    return res.status(500).json({ error: "Gagal buat rate" });
  }
});

// PUT /api/ocean-freight-rates/:id
router.put("/:id", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const err = validateRate(b);
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await db.execute(sql`
      UPDATE ocean_freight_rates SET
        rate_code = ${b.rate_code ?? null},
        rate_source_type = ${b.rate_source_type ?? "shipping_line"},
        rate_source_name = ${b.rate_source_name ?? ""},
        vendor_id = ${b.vendor_id ? Number(b.vendor_id) : null},
        carrier_name = ${b.carrier_name ?? null},
        origin_city = ${b.origin_city ?? ""},
        origin_port = ${b.origin_port ?? ""},
        destination_city = ${b.destination_city ?? ""},
        destination_port = ${b.destination_port ?? ""},
        trade_type = ${b.trade_type ?? "export"},
        shipment_type = ${b.shipment_type ?? "FCL"},
        service_mode = ${b.service_mode ?? "port_to_port"},
        container_type = ${b.container_type ?? null},
        currency = ${b.currency ?? "USD"},
        exchange_rate_to_idr = ${Number(b.exchange_rate_to_idr ?? 16500)},
        ocean_freight_amount = ${Number(b.ocean_freight_amount ?? 0)},
        lcl_rate_per_cbm = ${b.lcl_rate_per_cbm ? Number(b.lcl_rate_per_cbm) : null},
        lcl_minimum_cbm = ${b.lcl_minimum_cbm ? Number(b.lcl_minimum_cbm) : null},
        thc_origin = ${Number(b.thc_origin ?? 0)},
        thc_destination = ${Number(b.thc_destination ?? 0)},
        doc_fee = ${Number(b.doc_fee ?? 0)},
        bl_fee = ${Number(b.bl_fee ?? 0)},
        do_fee = ${Number(b.do_fee ?? 0)},
        handling_fee = ${Number(b.handling_fee ?? 0)},
        customs_clearance_fee = ${Number(b.customs_clearance_fee ?? 0)},
        trucking_pickup_estimate = ${Number(b.trucking_pickup_estimate ?? 0)},
        trucking_delivery_estimate = ${Number(b.trucking_delivery_estimate ?? 0)},
        insurance_percent = ${Number(b.insurance_percent ?? 0)},
        dg_surcharge_percent = ${Number(b.dg_surcharge_percent ?? 0)},
        reefer_surcharge = ${Number(b.reefer_surcharge ?? 0)},
        peak_season_surcharge = ${Number(b.peak_season_surcharge ?? 0)},
        emergency_bunker_surcharge = ${Number(b.emergency_bunker_surcharge ?? 0)},
        currency_adjustment_factor = ${Number(b.currency_adjustment_factor ?? 0)},
        valid_from = ${b.valid_from ?? today}::date,
        valid_until = ${b.valid_until ?? in90}::date,
        transit_days = ${b.transit_days ? Number(b.transit_days) : null},
        carrier = ${b.carrier ?? null},
        vessel_name = ${b.vessel_name ?? null},
        voyage = ${b.voyage ?? null},
        direct_or_transshipment = ${b.direct_or_transshipment ?? "direct"},
        price_status = ${b.price_status ?? "estimate"},
        notes = ${b.notes ?? null},
        is_active = ${b.is_active !== false},
        updated_at = NOW()
      WHERE id = ${Number(req.params.id)}
      RETURNING *
    `);
    if (!rows.length) return res.status(404).json({ error: "Rate tidak ditemukan" });
    return res.json(rows[0]);
  } catch (e) {
    console.error("[ocean-freight-rates/update]", e);
    return res.status(500).json({ error: "Gagal update rate" });
  }
});

// DELETE /api/ocean-freight-rates/:id
router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    await db.execute(sql`DELETE FROM ocean_freight_rates WHERE id = ${Number(req.params.id)}`);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Gagal hapus rate" });
  }
});

export default router;
