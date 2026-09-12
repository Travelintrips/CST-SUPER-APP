---
name: Vendor Profile Hardening — Phase Final
description: Arsitektur dan keputusan dari implementasi PHASE FINAL Vendor Profile Hardening. Mencakup file baru, perubahan schema, dan aturan yang harus dipertahankan.
---

## Apa yang diimplementasikan

### File baru
- `artifacts/api-server/src/lib/schemas/vendor/index.ts` — 9 Zod schemas untuk semua vendor operations
- `artifacts/api-server/src/lib/middleware/validateBody.ts` — Generic Zod body validation middleware
- `artifacts/api-server/src/lib/middleware/requireVendorOwnership.ts` — Ownership guard (FK lookup, bukan email/phone)
- `artifacts/api-server/src/lib/services/vendorAuditLogService.ts` — Audit trail service (non-fatal write)
- `artifacts/api-server/src/lib/vendorProfileMigration.ts` — Boot migration untuk Phase Final

### Schema changes (lib/db/src/schema/suppliers.ts)
- `suppliersTable` → +`updatedAt` (optimistic locking)
- `supplierDocumentsTable` → +`deletedAt`, +`deletedBy` (soft delete)
- New `vendorAuditLogsTable` (audit trail)

### Route changes
- `vendorStatus.ts` — full rewrite: Zod validation, audit log, soft delete, optimistic locking, fixed uploadToSupabase arg order
- `portal.ts` → +`PATCH /vendor/profile` (vendor self-edit), +rate limiters for public-profile + vendor-invite
- `vendorMiniForm.ts` — admin/links + admin/submissions: `requireClerkUser` → `requireAdmin`

## Aturan yang harus dipertahankan

**P0 — resolveVendorSupplierId**: WAJIB menggunakan FK lookup via `vendor_profiles.supplier_id`. JANGAN kembali ke email/phone heuristic. Kolom supplierId diisi oleh `runVendorApprovedInTx`.

**Storage upload arg order**: `uploadToSupabase(buffer, mimetype, folder)` — urutan ini BENAR. Sebelum fix: arg 2 dan 3 tertukar (path dikirim sebagai contentType), sudah diperbaiki di vendorStatus.ts.

**Soft delete dokumen**: GET /documents WAJIB filter `isNull(deletedAt)`. Jangan hard delete dari supplier_documents. File di storage dipertahankan untuk histori.

**Optimistic locking**: `expectedUpdatedAt` bersifat OPSIONAL (backward compat). Jika disertakan dan berbeda > 1 detik dari `suppliers.updated_at` → HTTP 409. Jika tidak disertakan → proceed normal.

**Audit log**: Semua write operations di vendorStatus.ts dan portal vendor self-edit harus memanggil `logVendorAudit`. Non-fatal — `.catch()` sudah di dalam service, tidak perlu try/catch di caller.

**isActive/status consistency**: Single source of truth = `updateSupplierStatus()` di supplierStatusService.ts. Boot migration menambahkan `CHECK CONSTRAINT NOT VALID` sebagai safety net. Jangan bypass service layer untuk update status.

**Auth consolidation**: Admin vendor form routes (admin/links, admin/submissions di vendorMiniForm.ts) menggunakan `requireAdmin`, bukan `requireClerkUser`. Admin/schemas dan admin/orders masih pakai requireClerkUser (general staff tools, bukan vendor-profile specific).

## Migration
Boot migration `runVendorProfileMigration` dijalankan dalam chain utama (sebelum featured product migration). Idempotent — semua DDL menggunakan IF NOT EXISTS/IF EXISTS guard. Setiap statement dieksekusi terpisah (pgBouncer compatibility).
