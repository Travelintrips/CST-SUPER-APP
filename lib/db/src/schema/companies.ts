import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  companyCode: text("company_code").notNull().unique(),
  logoUrl: text("logo_url"),
  address: text("address"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  kodeWilayah: text("kode_wilayah"),
  phone: text("phone"),
  fax: text("fax"),
  email: text("email"),
  website: text("website"),

  // Perpajakan
  npwp: text("npwp"),
  npwpStatus: text("npwp_status"),
  kegiatanUtama: text("kegiatan_utama"),
  jenisWajibPajak: text("jenis_wajib_pajak"),
  bentukBadanHukum: text("bentuk_badan_hukum"),
  tanggalTerdaftar: text("tanggal_terdaftar"),
  tanggalAktivasi: text("tanggal_aktivasi"),
  statusPkp: boolean("status_pkp"),
  tanggalPkp: text("tanggal_pkp"),
  kanwilDjp: text("kanwil_djp"),
  kppTerdaftar: text("kpp_terdaftar"),
  seksiPengawasan: text("seksi_pengawasan"),
  tanggalPembaruanProfil: text("tanggal_pembaruan_profil"),
  kodeKlu: text("kode_klu"),
  deskripsiKlu: text("deskripsi_klu"),

  // Legalitas
  nib: text("nib"),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isHolding: boolean("is_holding").notNull().default(false),
  parentCompanyId: integer("parent_company_id"),
});

export const companyLegalDocumentsTable = pgTable("company_legal_documents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  docType: text("doc_type").notNull(),
  docName: text("doc_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  notes: text("notes"),
  uploadedBy: integer("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Company = typeof companiesTable.$inferSelect;
export type InsertCompany = typeof companiesTable.$inferInsert;
export type CompanyLegalDocument = typeof companyLegalDocumentsTable.$inferSelect;
export type InsertCompanyLegalDocument = typeof companyLegalDocumentsTable.$inferInsert;
