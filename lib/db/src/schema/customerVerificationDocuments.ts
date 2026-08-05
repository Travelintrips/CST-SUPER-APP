import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { portalCustomerProfilesTable } from "./portalCustomerProfiles";

export const VERIFICATION_DOC_TYPES = [
  "NPWP",
  "NIB",
  "KTP_PIC",
  "AKTA_PERUSAHAAN",
  "SURAT_KUASA",
  "API_U",
  "API_P",
  "NIK_KEPABEANAN",
  "SIUP_NIB_ACTIVITY",
  "OTHER",
] as const;
export type VerificationDocType = (typeof VERIFICATION_DOC_TYPES)[number];

export const VERIFICATION_DOC_STATUSES = [
  "UPLOADED",
  "PENDING_REVIEW",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
] as const;
export type VerificationDocStatus = (typeof VERIFICATION_DOC_STATUSES)[number];

export const CUSTOMER_VERIFICATION_STATUSES = [
  "DRAFT",
  "PENDING_VERIFICATION",
  "NEED_REVISION",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
] as const;
export type CustomerVerificationStatus = (typeof CUSTOMER_VERIFICATION_STATUSES)[number];

export const PPJK_REQUIRED_DOCS: VerificationDocType[] = ["NPWP", "NIB", "KTP_PIC"];

export const customerVerificationDocumentsTable = pgTable("customer_verification_documents", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => portalCustomerProfilesTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  documentNumber: text("document_number"),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name"),
  verificationStatus: text("verification_status").notNull().default("UPLOADED"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  uploadedVersion: integer("uploaded_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const customerVerificationDocumentsRelations = relations(
  customerVerificationDocumentsTable,
  ({ one }) => ({
    profile: one(portalCustomerProfilesTable, {
      fields: [customerVerificationDocumentsTable.profileId],
      references: [portalCustomerProfilesTable.id],
    }),
  }),
);

export type CustomerVerificationDocument = typeof customerVerificationDocumentsTable.$inferSelect;

export const DOC_TYPE_LABELS: Record<VerificationDocType, string> = {
  NPWP: "NPWP",
  NIB: "NIB (Nomor Induk Berusaha)",
  KTP_PIC: "KTP PIC",
  AKTA_PERUSAHAAN: "Akta Perusahaan",
  SURAT_KUASA: "Surat Kuasa",
  API_U: "API-U",
  API_P: "API-P",
  NIK_KEPABEANAN: "NIK Kepabeanan",
  SIUP_NIB_ACTIVITY: "SIUP / NIB Activity",
  OTHER: "Dokumen Lainnya",
};
