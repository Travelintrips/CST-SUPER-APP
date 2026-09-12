import {
  pgTable, serial, integer, text, timestamp, boolean,
} from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portalCustomers";

// ── User Profiles ────────────────────────────────────────────────────────────
export const userProfilesTable = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  phone: text("phone"),
  address: text("address"),
  accountType: text("account_type").notNull().default("customer"),
  status: text("status").notNull().default("incomplete"),
  ktpUrl: text("ktp_url"),
  rejectionReason: text("rejection_reason"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Identity Documents ────────────────────────────────────────────────────────
export const identityDocumentsTable = pgTable("identity_documents", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(),
  url: text("url").notNull(),
  fileName: text("file_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── OCR Results ──────────────────────────────────────────────────────────────
export const ocrResultsTable = pgTable("ocr_results", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull().default("ktp"),
  nik: text("nik"),
  name: text("name"),
  birthPlace: text("birth_place"),
  birthDate: text("birth_date"),
  address: text("address"),
  rt: text("rt"),
  rw: text("rw"),
  kelurahan: text("kelurahan"),
  kecamatan: text("kecamatan"),
  kabupaten: text("kabupaten"),
  provinsi: text("provinsi"),
  gender: text("gender"),
  religion: text("religion"),
  maritalStatus: text("marital_status"),
  occupation: text("occupation"),
  nationality: text("nationality"),
  rawJson: text("raw_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Vendor Profiles ──────────────────────────────────────────────────────────
export const vendorProfilesTable = pgTable("vendor_profiles", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),

  // ── Company ────────────────────────────────────────────────────────────────
  companyName: text("company_name"),
  businessType: text("business_type"),
  companyLogo: text("company_logo"),
  companyDescription: text("company_description"),

  // ── Legal ──────────────────────────────────────────────────────────────────
  nib: text("nib"),
  npwp: text("npwp"),
  siup: text("siup"),
  tdp: text("tdp"),
  legalityDocUrl: text("legality_doc_url"),

  // ── Contact ────────────────────────────────────────────────────────────────
  picName: text("pic_name"),
  picPosition: text("pic_position"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),

  // ── Address ────────────────────────────────────────────────────────────────
  province: text("province"),
  city: text("city"),
  district: text("district"),
  postalCode: text("postal_code"),
  fullAddress: text("full_address"),

  // ── Finance ────────────────────────────────────────────────────────────────
  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),

  // ── Service type (existing) ────────────────────────────────────────────────
  serviceType: text("service_type"),

  // ── Marketplace bridge ─────────────────────────────────────────────────────
  supplierId: integer("supplier_id"),
  catalogSubmissionLinkId: integer("catalog_submission_link_id"),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  approvedAt: timestamp("approved_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Driver Profiles ──────────────────────────────────────────────────────────
export const driverProfilesTable = pgTable("driver_profiles", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  licenseNumber: text("license_number"),
  vehicleType: text("vehicle_type"),
  plateNumber: text("plate_number"),
  simUrl: text("sim_url"),
  stnkUrl: text("stnk_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Employee Profiles ────────────────────────────────────────────────────────
export const employeeProfilesTable = pgTable("employee_profiles", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  companyName: text("company_name"),
  branch: text("branch"),
  department: text("department"),
  division: text("division"),
  position: text("position"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Onboarding Approvals ─────────────────────────────────────────────────────
export const onboardingApprovalsTable = pgTable("onboarding_approvals", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  accountType: text("account_type").notNull(),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  notified: boolean("notified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserProfile = typeof userProfilesTable.$inferSelect;
export type IdentityDocument = typeof identityDocumentsTable.$inferSelect;
export type OcrResult = typeof ocrResultsTable.$inferSelect;
export type VendorProfile = typeof vendorProfilesTable.$inferSelect;
export type DriverProfile = typeof driverProfilesTable.$inferSelect;
export type EmployeeProfile = typeof employeeProfilesTable.$inferSelect;
export type OnboardingApproval = typeof onboardingApprovalsTable.$inferSelect;
