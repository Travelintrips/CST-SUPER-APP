# SUBMISSION TO CATALOG REPORT
**Fase 3 — Vendor Submission → Catalog Draft**
**Tanggal:** 2026-06-06
**Status:** ✅ SELESAI

---

## Ringkasan

Setiap kali vendor berhasil submit (atau revisi) via mini form, sistem sekarang secara otomatis membuat atau memperbarui baris di `vendor_catalog_items` dengan `status='pending_review'`. Item **tidak pernah dipublikasikan otomatis** — admin harus secara eksplisit mengubah status ke `published` dan `is_published=true`.

---

## Arsitektur

```
POST /:token   (vendorMiniForm.ts)
  │
  ├── Validasi + simpan vendor_mini_form_submissions (INSERT / UPDATE)
  │
  ├── ▶ upsertCatalogDraftFromSubmission()   [BARU — fire-and-forget]
  │     │
  │     ├── Guard: vendorId ada?         → skip jika tidak ada
  │     ├── Guard: vendorPrice > 0?      → skip jika tidak ada
  │     ├── Guard: formData ada?         → skip jika tidak ada
  │     │
  │     ├── Resolve templateKind, categoryKey, pricing, specValues
  │     ├── Cari existing row by source_submission_id
  │     │     ├── Ada  → UPDATE (mendukung revisi vendor)
  │     │     └── Baru → INSERT
  │     │
  │     └── Set status='pending_review', is_published=false
  │
  └── WA notifications, response ke vendor
```

---

## File Baru

### `artifacts/api-server/src/lib/vendorCatalogDraft.ts`

Helper utama. Non-blocking, semua error diabaikan (warn log saja).

**Interface input:**
```typescript
interface SubmissionForCatalog {
  id: number;
  supplierId: number | null | undefined;
  vendorName: string | null | undefined;
  serviceType: string;
  formData: Record<string, unknown> | null | undefined;
  vendorPrice: string | null | undefined;   // numeric as string (Drizzle)
  currency: string | null | undefined;
  attachmentUrl: string | null | undefined;
  templateId: string | null | undefined;
  templateVersion: string | null | undefined;
  templateSnapshot: Record<string, unknown> | null | undefined;
}

interface LinkForCatalog {
  supplierId: number | null | undefined;
  vendorName: string | null | undefined;
  serviceType: string;
  categoryKey: string | null | undefined;
  templateId: string | null | undefined;
  templateVersion: string | null | undefined;
  templateSnapshot: Record<string, unknown> | null | undefined;
}
```

---

## Field yang Dicopy ke vendor_catalog_items

| Field Catalog | Sumber | Catatan |
|---|---|---|
| `vendor_id` | `submission.supplierId` atau `link.supplierId` | Wajib ada — jika tidak ada, skip |
| `vendor_name` | `submission.vendorName` → `link.vendorName` → DB lookup | |
| `template_kind` | `link.serviceType === "product"` → `"product"`, else `"service"` | |
| `category_key` | `link.categoryKey` | |
| `service_type` | `submission.serviceType` | |
| `template_id` | `submission.templateId` → `link.templateId` | |
| `template_version` | `submission.templateVersion` → `link.templateVersion` | |
| `template_snapshot` | `submission.templateSnapshot` → `link.templateSnapshot` | |
| `spec_values` | semua `formData` kecuali key yang diawali `_` | |
| `name` | `formData.product_name` → `formData.service_name` → `formData.item_name` → `formData.name` → fallback | |
| `description` | `formData.notes` → `formData.description` | |
| `unit` | `formData.unit` | |
| `moq` | `formData.min_order` → `formData.moq` → default `1` | |
| `price_base` | `submission.vendorPrice` | ⚠️ INTERNAL ONLY |
| `markup_pct` | 15% (product) / 20% (service) | |
| `price_sell` | `priceBase × (1 + markup)` | Boleh diekspos ke customer |
| `currency` | `submission.currency` → default `"IDR"` | |
| `stock_status` | `formData.stock_status` → `formData.stock_confirmation` → `"available"` | |
| `stock_qty` | `formData.qty_available` → `formData.stock_qty` | |
| `lead_time` | `formData.lead_time` → `formData.eta` | |
| `validity_date` | `formData.valid_until` → `formData.validity` → `formData.validity_date` | |
| `location` | `formData.location` → `formData.area_pickup` | |
| `origin` | `formData.origin` → `formData.pol` | |
| `documents` | `[{ name, url, type }]` dari `attachmentUrl` jika ada | |
| `source_submission_id` | `submission.id` | FK ke submissions — kunci upsert |
| `status` | `"pending_review"` | **Tidak pernah auto-publish** |
| `is_published` | `false` | Admin yang publish manual |

---

## Logika Pricing

```
priceSell = priceBase × (1 + markup_default)

Markup default:
  product → 15%  (0.15)
  service → 20%  (0.20)

Contoh:
  priceBase = 5.000.000 (trucking, serviceType="trucking" → service)
  markup = 20%
  priceSell = 5.000.000 × 1.20 = 6.000.000
```

> ⚠️ `priceBase` dan `markupPct` **TIDAK BOLEH** dikembalikan oleh route publik / customer portal.
> Hanya `priceSell` yang boleh ditampilkan ke customer.

---

## Logika Upsert

Tidak menggunakan ON CONFLICT — menggunakan eksplisit SELECT → INSERT/UPDATE:

```
1. SELECT id FROM vendor_catalog_items WHERE source_submission_id = $submissionId LIMIT 1
   ├── Ada  → UPDATE SET ... WHERE id = $existingId
   └── Baru → INSERT INTO vendor_catalog_items (...) VALUES (...)
```

Ini memastikan revisi vendor (resubmit) memperbarui catalog draft yang sama, bukan membuat duplikat.

---

## Guard & Backward Compatibility

| Kondisi | Behavior |
|---|---|
| `vendorId` tidak ada (anonim / null) | Skip — tidak ada catalog item, submission tetap tersimpan |
| `vendorPrice` nol atau tidak ada | Skip — tidak ada pricing yang cukup untuk catalog |
| `formData` tidak ada / bukan object | Skip — tidak ada data untuk spec values |
| `templateSnapshot` tidak ada | Lanjut — field template dibiarkan null |
| `stockStatus` tidak ada di formData | Default `"available"` |
| `leadTime` tidak ada | `null` — field opsional |
| Error DB apapun | Log warn, skip — tidak melempar error ke vendor |

---

## Behavior di Sisi Vendor & Admin

| Peran | Apa yang Terjadi |
|---|---|
| **Vendor** | Submit form → response sukses seperti biasa. Catalog draft dibuat di background. |
| **Vendor (revisi)** | Resubmit → catalog draft diperbarui (UPDATE by source_submission_id). |
| **Customer Portal** | Tidak melihat item — `is_published=false`, `status='pending_review'`. |
| **Admin BizPortal** | Dapat melihat draft di daftar `vendor_catalog_items` dengan status `pending_review`. Untuk publish: ubah `status='published'` dan `is_published=true` secara manual. |

---

## File yang Dimodifikasi

| File | Perubahan |
|---|---|
| `artifacts/api-server/src/lib/vendorCatalogDraft.ts` | **Baru** — helper `upsertCatalogDraftFromSubmission()` |
| `artifacts/api-server/src/routes/vendorMiniForm.ts` | Import helper + panggil setelah submission berhasil (fire-and-forget, non-blocking) |

---

## Log Runtime

Saat catalog draft berhasil dibuat/diperbarui:
```
[catalog-draft] submission=123 → catalogItemId=45 status=pending_review
```

Saat skip (data kurang):
```
(tidak ada log — silent skip)
```

Saat error DB:
```
[vendorCatalogDraft] upsert error (non-fatal): <error message>
```

---

## Acceptance Check

| Kriteria | Status |
|---|---|
| Vendor submit → catalog draft terbuat dengan `status='pending_review'` | ✅ |
| Vendor revisi → catalog draft yang sama diperbarui (bukan duplikat) | ✅ |
| Customer tidak melihat item sebelum admin publish | ✅ (`is_published=false`) |
| `priceBase` tidak terekspos ke customer | ✅ (hanya `priceSell` yang publik) |
| Backward compatible: submission tanpa vendorId/priceBase tetap berhasil | ✅ (silent skip) |
| Tidak blocking response vendor | ✅ (fire-and-forget dengan `.catch(() => {})`) |

---

*Dibuat otomatis oleh Replit Agent — Fase 3 Vendor Submission to Catalog Draft*
