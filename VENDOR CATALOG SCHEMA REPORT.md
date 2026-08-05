# VENDOR CATALOG SCHEMA REPORT
**Fase 2 — Vendor Catalog Schema**
**Tanggal:** 2026-06-06
**Status:** ✅ SELESAI — 38 kolom terverifikasi di database

---

## Ringkasan

Tabel `vendor_catalog_items` telah diperluas secara idempotent untuk mendukung template engine, spec values, pricing bertingkat (internal vs publik), stock, lead time, validity, dokumen pendukung, dan lifecycle status. Semua ALTER TABLE memakai `ADD COLUMN IF NOT EXISTS` sehingga aman dijalankan berulang kali.

---

## Skema Lengkap

### Identitas Vendor
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `id` | SERIAL | auto | Primary key |
| `vendor_id` | INTEGER NOT NULL | — | FK → suppliers(id) ON DELETE CASCADE |
| `vendor_name` | TEXT | — | Nama vendor (denormalisasi untuk query cepat) |

### Legacy / Kompatibilitas (existing, dipertahankan)
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `master_item_id` | INTEGER | — | FK → products(id) ON DELETE SET NULL |
| `type` | TEXT NOT NULL | `'service'` | **Legacy** — pakai `template_kind` untuk data baru |
| `name` | TEXT NOT NULL | — | Nama item |
| `description` | TEXT | — | Deskripsi bebas |
| `kategori` | TEXT | — | **Legacy** — pakai `category_key` untuk data baru |
| `subcategory` | TEXT | — | Subkategori legacy |
| `is_commodity_tag` | BOOLEAN NOT NULL | `false` | Untuk blast auto-matching |
| `is_active` | BOOLEAN NOT NULL | `true` | Aktif/nonaktif di etalase internal |
| `sort_order` | INTEGER NOT NULL | `0` | Urutan tampil |

### Template Engine
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `template_kind` | TEXT | `'service'` | `product` atau `service` |
| `category_key` | TEXT | — | Kunci kategori template (e.g. `sea_freight`) |
| `service_type` | TEXT | — | Tipe layanan turunan template |
| `template_id` | TEXT | — | ID template yang dipakai |
| `template_version` | TEXT | — | Versi snapshot template |
| `template_snapshot` | JSONB | — | Snapshot lengkap template saat item dibuat |
| `spec_values` | JSONB | — | Nilai spec diisi vendor (field dinamis per template) |

### Pricing
| Kolom | Tipe | Default | Visibilitas | Keterangan |
|---|---|---|---|---|
| `price_base` | NUMERIC(15,2) NOT NULL | `0` | **INTERNAL ONLY** | Harga pokok — **TIDAK BOLEH diekspos ke customer/portal API** |
| `markup_pct` | NUMERIC(5,2) NOT NULL | `0` | **INTERNAL ONLY** | Markup dalam persen |
| `price_sell` | NUMERIC(15,2) | — | ✅ Publik | Harga jual final yang boleh ditampilkan ke customer |
| `currency` | TEXT NOT NULL | `'IDR'` | ✅ Publik | Mata uang |

> ⚠️ **Aturan keamanan pricing:** Route API untuk customer/portal **wajib** menggunakan `SELECT` yang mengecualikan `price_base` dan `markup_pct`. Kolom ini hanya boleh dibaca oleh route internal BizPortal dengan `requireAdmin` atau `requireClerkUser`.

### Unit & Kuantitas
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `unit` | TEXT | — | Satuan (kg, m³, CBM, trip, dll) |
| `moq` | INTEGER | `1` | Minimum Order Quantity |

### Stock
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `stock_status` | TEXT | `'available'` | `available` / `limited` / `out_of_stock` |
| `stock_qty` | INTEGER | — | Jumlah stok aktual (null = tidak dilacak) |

### Lead Time & Validity
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `lead_time` | TEXT | — | Deskripsi lead time (e.g. `"3-5 hari kerja"`) |
| `validity_date` | TIMESTAMP | — | Tanggal kedaluwarsa penawaran/harga |

### Asal & Lokasi
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `location` | TEXT | — | Lokasi stok/pickup |
| `origin` | TEXT | — | Negara/kota asal barang |

### Dokumen Pendukung
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `documents` | JSONB NOT NULL | `[]` | Array dokumen: `[{ name, url, type, uploadedAt }]` |

### Lifecycle Status
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `status` | TEXT NOT NULL | `'draft'` | `draft` / `pending_review` / `published` / `archived` |
| `is_published` | BOOLEAN NOT NULL | `false` | Shortcut flag — true jika status = published |
| `source_submission_id` | INTEGER | — | FK → vendor_mini_form_submissions(id) asal data |
| `published_at` | TIMESTAMP | — | Waktu dipublikasikan |

### Timestamps
| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| `created_at` | TIMESTAMP NOT NULL | `NOW()` | Dibuat |
| `updated_at` | TIMESTAMP NOT NULL | `NOW()` | Terakhir diupdate |

---

## Indexes

| Nama Index | Kolom | Tujuan |
|---|---|---|
| `vci_vendor_id_idx` | `vendor_id` | Query item per vendor |
| `vci_template_kind_idx` | `template_kind` | Filter product vs service |
| `vci_category_key_idx` | `category_key` | Filter per kategori |
| `vci_status_idx` | `status` | Filter lifecycle |
| `vci_is_published_idx` | `is_published` | Query etalase publik |
| `vci_source_submission_id_idx` | `source_submission_id` | Trace ke submission asal |

---

## File yang Diubah

| File | Perubahan |
|---|---|
| `lib/db/src/schema/suppliers.ts` | Drizzle schema `vendorCatalogItemsTable` diperluas dengan semua kolom baru; import `jsonb` ditambahkan |
| `artifacts/api-server/src/lib/vendorCatalogSchemaMigration.ts` | **Baru** — migration idempotent dengan `ADD COLUMN IF NOT EXISTS` + index |
| `artifacts/api-server/src/index.ts` | Import + registrasi `runVendorCatalogSchemaMigration` di chain startup |

---

## Verifikasi DB

Migration dijalankan saat server restart dan menghasilkan log:
```
[16:38:50.560] INFO: Vendor catalog schema migration: ok
```

Query `information_schema.columns` mengkonfirmasi **38 kolom** tersedia di tabel `vendor_catalog_items`.

---

## Aturan API (untuk implementasi berikutnya)

```typescript
// ✅ Benar — untuk customer/portal (price_base TIDAK termasuk)
const publicFields = {
  id: true, vendorId: true, vendorName: true,
  name: true, description: true, templateKind: true,
  categoryKey: true, serviceType: true, specValues: true,
  priceSell: true, currency: true, unit: true, moq: true,
  stockStatus: true, stockQty: true, leadTime: true,
  validityDate: true, location: true, origin: true,
  documents: true, status: true, isPublished: true,
};

// ❌ Salah — priceBase dan markupPct TIDAK boleh masuk response publik
// priceBase, markupPct → hanya di route BizPortal dengan requireAdmin
```

---

*Dibuat otomatis oleh Replit Agent — Fase 2 Vendor Catalog Schema*
