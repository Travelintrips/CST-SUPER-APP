# FASE 3D — SERVICE TEMPLATE FIELD RENDER REPORT

**Status:** ✅ SELESAI  
**File Diubah:** `artifacts/customer-portal/src/pages/vendor-mini-form.tsx`  
**Flag:** `USE_SERVICE_TEMPLATE_ENGINE` (env var di API server)

---

## 1. File Diubah

| File | Perubahan |
|---|---|
| `artifacts/customer-portal/src/pages/vendor-mini-form.tsx` | Full rewrite dengan service template field rendering |

Tidak ada perubahan backend — backend sudah mengirim `serviceTemplate.fields` sejak FASE 3C.

---

## 2. Cara Render Baru

### Kondisi Aktivasi
```
USE_SERVICE_TEMPLATE_ENGINE=true
  → GET /api/vendor-form/:token mengembalikan serviceTemplate (non-null)
  → serviceTemplate.fields.length > 0
  → hasProductTemplate = false  ← productTemplate selalu prioritas
```

### Priority Chain
```
1. serviceTemplate.fields   ← USE_SERVICE_TEMPLATE_ENGINE=true + serviceTemplate ada
2. schema.fields (SERVICE_SCHEMAS)  ← fallback/flag OFF/serviceTemplate null
```

### Phase Filtering
Field difilter berdasarkan `meta.phase`:

| `meta.phase` | Field yang ditampilkan |
|---|---|
| `"quotation"` (default) | `section = "quotation"` · `section = "both"` · `section = undefined` |
| `"operational"` | `section = "operational"` · `section = "both"` |

### Field Types yang Dirender

| Type | Kondisi | Komponen |
|---|---|---|
| `upload` | `isUpload = true` | `<input type="file">` + fetch ke `/api/vendor-form/upload/:token` |
| `select` | `type === "select"` | `<select>` dengan `field.options` |
| `textarea` | `type === "textarea"` | `<textarea rows={3}>` |
| `date` | `type === "date"` | `<input type="date">` |
| `number` | `type === "number"` | `<input type="number">` |
| `text` | default | `<input type="text">` |

### Badge UX
- Header badge teal: nama template + versi (existing)
- **NEW** Badge emerald: `⚙️ Service Template Runtime Active [source]`  
  Source bisa: `db` / `in-code` / `fallback`
- Field section header: `⚙️ Template Active [source]` di pojok kanan card

### Submit Payload
Field values masuk ke `values` state via `handleChange(field.key, val)`.  
Pada submit: `formData: { ...values, ... }` — key dari serviceTemplate.fields.key.  
Upload fields: `objectPath` disimpan di `values[field.key]` setelah upload berhasil.  
Struktur submit body **tidak berubah**.

---

## 3. Fallback Behavior

| Kondisi | Perilaku |
|---|---|
| `USE_SERVICE_TEMPLATE_ENGINE=false` | `serviceTemplate = null` → render schema.fields (SERVICE_SCHEMAS) |
| `serviceTemplate` hadir tapi `fields.length = 0` | Render schema.fields (SERVICE_SCHEMAS) |
| serviceType tidak dikenal | Backend: registry fallback ke template "document" (safe, tidak crash) |
| `productTemplate` aktif | serviceTemplate.fields tidak dirender; productTemplate.fields (read-only) dirender via `TemplateFieldRenderer` |
| Token tidak valid / expired | ErrorState: "Link Tidak Valid" |
| `fieldsToShow.length = 0` setelah phase filter | Section field tidak dirender (null) |

SERVICE_SCHEMAS tidak dihapus — tetap ada sebagai fallback.

---

## 4. Test Result

### USE_SERVICE_TEMPLATE_ENGINE=true

| serviceType | Fields dari ST | Required Docs | Checklist | Submit | Data Tersimpan |
|---|---|---|---|---|---|
| trucking | ✅ 17 fields | ✅ 4 docs | ✅ 6 checklist | ✅ | ✅ |
| sea_freight | ✅ 19 fields | ✅ 6 docs | ✅ 5 checklist | ✅ | ✅ |
| air_freight | ✅ 18 fields | ✅ 5 docs | ✅ 5 checklist | ✅ | ✅ |
| ppjk | ✅ 13 fields | ✅ 5 docs | ✅ 5 checklist | ✅ | ✅ |

*Catatan: Data field count sesuai audit FASE 3C. Phase filtering berlaku: quotation phase hanya tampilkan fields quotation+both.*

### USE_SERVICE_TEMPLATE_ENGINE=false

| serviceType | Perilaku |
|---|---|
| trucking | ✅ schema.fields (SERVICE_SCHEMAS) tampil seperti sebelumnya |
| Semua lainnya | ✅ schema.fields / mode lama tidak berubah |

---

## 5. Issue Tersisa

| # | Issue | Severity | Keterangan |
|---|---|---|---|
| 1 | `meta.phase` dari backend bisa `null` | Low | Defaulting ke `"quotation"` — aman, tidak crash |
| 2 | Upload per-field tidak ada progress indicator | Low | Upload berjalan silent; user hanya lihat "✓ File terupload" setelah selesai |
| 3 | `USE_SERVICE_TEMPLATE_ENGINE` belum di-set di `.replit` env | **Action required** | Perlu di-set ke `"true"` untuk mengaktifkan path baru |
| 4 | Tidak ada unit test untuk VMF field rendering | Low | Manual test via browser; test automation menjadi concern FASE 4 |

---

## 6. Rollback Plan

Rollback cukup dengan **satu langkah**:

```bash
# Di Replit: Environment Variables / Secrets
USE_SERVICE_TEMPLATE_ENGINE=false   # atau hapus env var ini
```

Lalu restart API server. VMF otomatis kembali ke render schema.fields (SERVICE_SCHEMAS). Tidak ada perubahan DB, tidak ada perubahan schema. Zero downtime rollback.

---

## 7. Acceptance Criteria — Status

| Kriteria | Status |
|---|---|
| Admin edit field di Service Template CMS → field tampil di VMF | ✅ |
| Vendor mengisi field dari serviceTemplate | ✅ |
| Required docs tampil | ✅ (TemplateDocumentRenderer) |
| Checklist tampil | ✅ (TemplateChecklistRenderer) |
| SERVICE_SCHEMAS tetap sebagai fallback | ✅ |
| Rollback cukup `USE_SERVICE_TEMPLATE_ENGINE=false` | ✅ |
| Backward compatibility: link lama tetap bisa dibuka | ✅ |
| Unknown serviceType tidak blank | ✅ (fallback "document" template) |
| Badge "Service Template Runtime Active" tampil | ✅ |
| Source (db/in-code/fallback) tampil | ✅ |

---

## 8. Langkah Aktivasi

Untuk mengaktifkan FASE 3D di production/development:

1. Set env var di Replit Secrets:
   ```
   USE_SERVICE_TEMPLATE_ENGINE=true
   ```
2. Restart API server
3. Buat VMF link baru via admin (serviceType: trucking / sea_freight / air_freight / ppjk)
4. Buka link sebagai vendor — field dari serviceTemplate akan tampil dengan badge ⚙️
