import {
  pgTable, serial, integer, text, boolean, timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { portalCustomersTable } from "./portalCustomers";

export const portalCustomerProfilesTable = pgTable("portal_customer_profiles", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id"),
  guestEmail: text("guest_email"),
  companyName: text("company_name"),
  npwp: text("npwp"),
  nib: text("nib"),
  companyAddress: text("company_address"),
  picName: text("pic_name"),
  picWhatsapp: text("pic_whatsapp"),
  picEmail: text("pic_email"),
  legalDocUrl: text("legal_doc_url"),
  ktpPicUrl: text("ktp_pic_url"),
  suratKuasaUrl: text("surat_kuasa_url"),
  apiNikIzinUrl: text("api_nik_izin_url"),
  additionalNotes: text("additional_notes"),
  profileStatus: text("profile_status").notNull().default("incomplete"),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  // ── Verification Center (P1A) ─────────────────────────────────────────────
  verificationStatus: text("verification_status").notNull().default("DRAFT"),
  verificationSubmittedAt: timestamp("verification_submitted_at", { withTimezone: true }),
  verificationExpiredAt: timestamp("verification_expired_at", { withTimezone: true }),
  verificationNotes: text("verification_notes"),
  // ─────────────────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const portalCustomerProfilesRelations = relations(
  portalCustomerProfilesTable,
  ({ one }) => ({
    customer: one(portalCustomersTable, {
      fields: [portalCustomerProfilesTable.customerId],
      references: [portalCustomersTable.id],
    }),
  }),
);

export type PortalCustomerProfile = typeof portalCustomerProfilesTable.$inferSelect;

export const PROFILE_REQUIRED_FIELDS: (keyof PortalCustomerProfile)[] = [
  "companyName", "npwp", "nib", "companyAddress", "picName", "picWhatsapp", "picEmail",
];

export function computeProfileStatus(p: Partial<PortalCustomerProfile>): "incomplete" | "partial" | "complete" {
  const filled = PROFILE_REQUIRED_FIELDS.filter((f) => !!(p as Record<string, unknown>)[f]);
  if (filled.length === PROFILE_REQUIRED_FIELDS.length) return "complete";
  if (filled.length > 0) return "partial";
  return "incomplete";
}
