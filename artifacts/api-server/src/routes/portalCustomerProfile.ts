import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  portalCustomerProfilesTable,
  portalCustomersTable,
  computeProfileStatus,
  PROFILE_REQUIRED_FIELDS,
} from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { requirePortalAuth, type PortalAuthReq } from "../lib/supabaseAuth.js";
import { logger } from "../lib/logger.js";

export const portalCustomerProfileRouter = Router();

// ── Idempotent migration ──────────────────────────────────────────────────────
db.execute(sql`
  CREATE TABLE IF NOT EXISTS portal_customer_profiles (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER,
    guest_email TEXT,
    company_name TEXT,
    npwp TEXT,
    nib TEXT,
    company_address TEXT,
    pic_name TEXT,
    pic_whatsapp TEXT,
    pic_email TEXT,
    legal_doc_url TEXT,
    ktp_pic_url TEXT,
    surat_kuasa_url TEXT,
    api_nik_izin_url TEXT,
    additional_notes TEXT,
    profile_status TEXT NOT NULL DEFAULT 'incomplete',
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by TEXT,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {});

// ── Helper ────────────────────────────────────────────────────────────────────
async function findOrCreateProfile(customerId?: number | null, email?: string | null) {
  const where = customerId
    ? eq(portalCustomerProfilesTable.customerId, customerId)
    : email
      ? eq(portalCustomerProfilesTable.guestEmail, email.toLowerCase().trim())
      : null;
  if (!where) return null;

  const [existing] = await db.select().from(portalCustomerProfilesTable).where(where).limit(1);
  return existing ?? null;
}

// ── GET /api/portal/customer-profile  (auth required) ────────────────────────
portalCustomerProfileRouter.get("/", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as PortalAuthReq;
    const profile = await findOrCreateProfile(authReq.portalCustomerId);
    if (!profile) return res.json({ profileStatus: "incomplete", filledFields: 0, totalRequired: PROFILE_REQUIRED_FIELDS.length });
    const status = computeProfileStatus(profile);
    const filledFields = PROFILE_REQUIRED_FIELDS.filter((f) => !!(profile as Record<string, unknown>)[f]).length;
    return res.json({ ...profile, profileStatus: status, filledFields, totalRequired: PROFILE_REQUIRED_FIELDS.length });
  } catch (err) {
    logger.error({ err }, "[customerProfile] get error");
    return res.status(500).json({ error: "Gagal mengambil profil" });
  }
});

// ── GET /api/portal/customer-profile/by-email?email=...  (no auth — for CSR draft) ──
portalCustomerProfileRouter.get("/by-email", async (req: Request, res: Response) => {
  try {
    const email = req.query.email as string | undefined;
    if (!email) return res.status(400).json({ error: "email wajib diisi" });

    const [customer] = await db
      .select({ id: portalCustomersTable.id })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.email, email.toLowerCase().trim()))
      .limit(1);

    const profile = await findOrCreateProfile(customer?.id ?? null, email);
    if (!profile) return res.json({ profileStatus: "incomplete", filledFields: 0, totalRequired: PROFILE_REQUIRED_FIELDS.length });

    const status = computeProfileStatus(profile);
    const filledFields = PROFILE_REQUIRED_FIELDS.filter((f) => !!(profile as Record<string, unknown>)[f]).length;
    return res.json({ ...profile, profileStatus: status, filledFields, totalRequired: PROFILE_REQUIRED_FIELDS.length });
  } catch (err) {
    logger.error({ err }, "[customerProfile] by-email error");
    return res.status(500).json({ error: "Gagal mengambil profil" });
  }
});

// ── PUT /api/portal/customer-profile  (auth or email-based) ──────────────────
portalCustomerProfileRouter.put("/", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    let customerId: number | null = null;
    let guestEmail: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      try {
        (req as PortalAuthReq).portalCustomerId;
      } catch { /* not auth req */ }
      const { requirePortalAuth: auth } = await import("../lib/supabaseAuth.js");
    }

    const {
      companyName, npwp, nib, companyAddress,
      picName, picWhatsapp, picEmail,
      legalDocUrl, ktpPicUrl, suratKuasaUrl, apiNikIzinUrl,
      additionalNotes, email: bodyEmail,
    } = req.body as Record<string, string>;

    const email = bodyEmail?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "email wajib diisi" });

    const [customer] = await db
      .select({ id: portalCustomersTable.id })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.email, email))
      .limit(1);

    customerId = customer?.id ?? null;
    guestEmail = customerId ? null : email;

    const profileData = {
      customerId,
      guestEmail,
      companyName: companyName?.trim() || null,
      npwp: npwp?.trim() || null,
      nib: nib?.trim() || null,
      companyAddress: companyAddress?.trim() || null,
      picName: picName?.trim() || null,
      picWhatsapp: picWhatsapp?.trim() || null,
      picEmail: picEmail?.trim() || null,
      legalDocUrl: legalDocUrl?.trim() || null,
      ktpPicUrl: ktpPicUrl?.trim() || null,
      suratKuasaUrl: suratKuasaUrl?.trim() || null,
      apiNikIzinUrl: apiNikIzinUrl?.trim() || null,
      additionalNotes: additionalNotes?.trim() || null,
      updatedAt: new Date(),
    };

    const profileStatus = computeProfileStatus(profileData);

    const where = customerId
      ? eq(portalCustomerProfilesTable.customerId, customerId)
      : eq(portalCustomerProfilesTable.guestEmail, email);

    const [existing] = await db.select({ id: portalCustomerProfilesTable.id })
      .from(portalCustomerProfilesTable).where(where).limit(1);

    let saved;
    if (existing) {
      [saved] = await db.update(portalCustomerProfilesTable)
        .set({ ...profileData, profileStatus })
        .where(eq(portalCustomerProfilesTable.id, existing.id))
        .returning();
    } else {
      [saved] = await db.insert(portalCustomerProfilesTable)
        .values({ ...profileData, profileStatus })
        .returning();
    }

    const filledFields = PROFILE_REQUIRED_FIELDS.filter((f) => !!(saved as Record<string, unknown>)[f]).length;
    logger.info({ profileId: saved.id, profileStatus }, "[customerProfile] updated");
    return res.json({ ...saved, filledFields, totalRequired: PROFILE_REQUIRED_FIELDS.length });
  } catch (err) {
    logger.error({ err }, "[customerProfile] put error");
    return res.status(500).json({ error: "Gagal menyimpan profil" });
  }
});
