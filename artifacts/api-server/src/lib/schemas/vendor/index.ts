/**
 * vendor/index.ts — Runtime Zod schemas untuk semua Vendor Profile operations.
 * Semua endpoint PATCH/POST wajib menggunakan schema ini via validateBody().
 */

import { z } from "zod";

// ── Admin: ubah status lifecycle vendor ───────────────────────────────────────
export const VendorStatusSchema = z.object({
  status: z.enum(["pending", "active", "inactive", "suspended", "blacklisted", "archived"]),
  reason: z.string().max(500).optional().nullable(),
});
export type VendorStatusInput = z.infer<typeof VendorStatusSchema>;

// ── Admin: verifikasi vendor ───────────────────────────────────────────────────
export const VendorVerificationSchema = z.object({
  note: z.string().max(500).optional().nullable(),
});
export type VendorVerificationInput = z.infer<typeof VendorVerificationSchema>;

// ── Admin: ubah marketplace status ────────────────────────────────────────────
export const MarketplaceStatusSchema = z.object({
  marketplaceStatus: z.enum(["draft", "published", "unpublished"]),
});
export type MarketplaceStatusInput = z.infer<typeof MarketplaceStatusSchema>;

// ── Admin: update profil marketplace vendor ───────────────────────────────────
export const VendorProfileAdminSchema = z.object({
  descriptionPublic: z.string().max(2000).optional().nullable(),
  serviceAreas: z.array(z.string().max(100)).max(50).optional().nullable(),
  isPremium: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  /**
   * Optimistic locking (optional — backward compat).
   * Jika disertakan, server akan menolak update jika suppliers.updated_at
   * sudah berubah sejak client membaca data (HTTP 409 Conflict).
   */
  expectedUpdatedAt: z.string().datetime().optional(),
});
export type VendorProfileAdminInput = z.infer<typeof VendorProfileAdminSchema>;

// ── Admin: upload dokumen — hanya metadata (file via multipart) ───────────────
export const VendorDocumentSchema = z.object({
  documentType: z.string().min(1).max(50),
  documentNumber: z.string().max(100).optional().nullable(),
  documentName: z.string().max(200).optional().nullable(),
  issuedAt: z.string().max(20).optional().nullable(),
  expiresAt: z.string().max(20).optional().nullable(),
});
export type VendorDocumentInput = z.infer<typeof VendorDocumentSchema>;

// ── Admin: verifikasi / tolak dokumen ─────────────────────────────────────────
export const VendorDocumentVerifySchema = z.object({
  verificationStatus: z.enum(["pending", "verified", "rejected"]),
  rejectionReason: z.string().max(500).optional().nullable(),
});
export type VendorDocumentVerifyInput = z.infer<typeof VendorDocumentVerifySchema>;

// ── Admin: moderasi review vendor ─────────────────────────────────────────────
export const VendorReviewModerationSchema = z.object({
  moderationStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  isPublished: z.boolean().optional(),
}).refine(
  (d) => d.moderationStatus !== undefined || d.isPublished !== undefined,
  { message: "Minimal satu field (moderationStatus atau isPublished) harus disertakan" },
);
export type VendorReviewModerationInput = z.infer<typeof VendorReviewModerationSchema>;

// ── Portal Vendor: edit profil sendiri ────────────────────────────────────────
// NOTE: `website` tidak termasuk karena suppliersTable belum memiliki kolom website.
// Tambahkan setelah kolom ditambahkan via migration.
export const VendorSelfProfileSchema = z.object({
  picName: z.string().min(1).max(200).optional().nullable(),
  phone: z.string().min(5).max(30).regex(/^[0-9+().\-\s]+$/, "Format nomor telepon tidak valid").optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  fullAddress: z.string().max(500).optional().nullable(),
  province: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  postalCode: z.string().regex(/^[0-9A-Za-z\s-]{3,20}$/, "Format kode pos tidak valid").optional().nullable(),
  bankName: z.string().max(100).optional().nullable(),
  bankAccountName: z.string().max(200).optional().nullable(),
  bankAccountNumber: z.string().max(50).optional().nullable(),
  companyDescription: z.string().max(2000).optional().nullable(),
  logoUrl: z.string().max(1000).optional().nullable(),
  /** Optimistic locking — opsional, backward compat */
  expectedUpdatedAt: z.string().datetime().optional(),
}).refine(
  (d) => Object.entries(d).filter(([k]) => k !== "expectedUpdatedAt").some(([, v]) => v !== undefined),
  { message: "Minimal satu field profil harus disertakan" },
);
export type VendorSelfProfileInput = z.infer<typeof VendorSelfProfileSchema>;

// ── Onboarding: complete onboarding ───────────────────────────────────────────
export const CompleteOnboardingSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().min(5).max(30),
  address: z.string().min(1).max(500),
  accountType: z.enum(["vendor", "driver", "employee", "customer"]),
  ktpUrl: z.string().max(1000).optional(),
  ocrData: z.object({
    nik: z.string().max(20).optional(),
    name: z.string().max(200).optional(),
  }).optional(),
  vendor: z.object({
    companyName: z.string().max(200).optional(),
    nib: z.string().max(50).optional(),
    npwp: z.string().max(50).optional(),
    serviceType: z.string().max(100).optional(),
    legalityDocUrl: z.string().max(1000).optional(),
  }).optional(),
  driver: z.object({
    licenseNumber: z.string().max(50).optional(),
    vehicleType: z.string().max(100).optional(),
    plateNumber: z.string().max(20).optional(),
    simUrl: z.string().max(1000).optional(),
    stnkUrl: z.string().max(1000).optional(),
  }).optional(),
  employee: z.object({
    companyName: z.string().max(200).optional(),
    branch: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    division: z.string().max(100).optional(),
    position: z.string().max(100).optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  if (data.accountType === "vendor" && !data.vendor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vendor"],
      message: "Data perusahaan vendor wajib diisi",
    });
  }
});
export type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingSchema>;

// ── Public: vendor invite accept ──────────────────────────────────────────────
// Field names match the existing portal.ts handler body (backward compat with public form).
export const VendorInviteAcceptSchema = z.object({
  contact_name: z.string().min(1).max(200).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  company_name: z.string().max(200).optional().nullable(),
  message: z.string().max(2000).optional().nullable(),
  products: z
    .array(
      z.object({
        name: z.string().max(200).optional().default(""),
        description: z.string().max(2000).optional().default(""),
        category: z.string().max(100).optional().default(""),
        mediaUrls: z.array(z.string().max(1000)).max(8).optional().default([]),
      })
    )
    .max(10)
    .optional()
    .default([]),
});
export type VendorInviteAcceptInput = z.infer<typeof VendorInviteAcceptSchema>;
