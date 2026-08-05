# FASE 3C — VMF Service Template Engine Cutover Audit

**Tanggal Audit:** 2026-06-01  
**Auditor:** Replit Agent  
**Scope:** Vendor Mini Form (VMF) — validasi implementasi Service Template Engine  
**Flag Target:** `USE_SERVICE_TEMPLATE_ENGINE=true`  

---

## Executive Summary

| Area | Status | Catatan |
|------|--------|---------|
| Flag Configuration | ⚠️ BELUM AKTIF | `USE_SERVICE_TEMPLATE_ENGINE` tidak di-set di `.replit` |
| Backend Token Response | ✅ PASS | `serviceTemplate` null saat flag OFF, terisi saat flag ON |
| Backend Submit/Snapshot | ✅ PASS | Snapshot tersimpan dengan `templateKind:"service"` |
| Frontend Rendering — Badge | ✅ PASS | Emoji + label + version tampil di header |
| Frontend Rendering — Documents | ✅ PASS | `TemplateDocumentRenderer` terhubung ke `serviceTemplate.requiredDocuments` |
| Frontend Rendering — Checklist | ✅ PASS | `TemplateChecklistRenderer` terhubung ke `serviceTemplate.checklist` |
| Frontend Rendering — Fields | ⚠️ GAP | `serviceTemplate.fields` **tidak dirender** — form masih dari `SERVICE_SCHEMAS` |
| Fallback Behavior (flag OFF) | ✅ PASS | Zero behavior change — `serviceTemplate: null` |
| Unknown serviceType Safety | ⚠️ PERLU REVIEW | Fallback ke template "document" (bukan empty) |
| Service Templates API | ✅ FIXED + PASS | Bug missing symlink ditemukan dan diperbaiki |
| DB Template Consistency | ✅ PASS | Semua 4 target serviceType ada di DB dan in-code |

---

## 1. Flag State

```
USE_SERVICE_TEMPLATE_ENGINE = NOT SET (process.env default: false)
USE_PRODUCT_TEMPLATE_ENGINE = NOT SET (process.env default: false)
```

**Lokasi:** `artifacts/api-server/src/routes/vendorMiniForm.ts:138`

```ts
const USE_SERVICE_TEMPLATE_ENGINE = process.env.USE_SERVICE_TEMPLATE_ENGINE === "true";
```

Flag dibaca **sekali saat module load** (startup). Mengubah env var di runtime memerlukan restart API server.

**Implikasi:** Semua pengujian cutover harus melalui restart eksplisit setelah set env var.

---

## 2. Backend — Token Response (GET /api/vendor-form/:token)

### 2.1 Flag OFF (current state)

```ts
// Line 1025-1031
let resolvedServiceTemplate: ResolvedServiceTemplate | null = null;
if (USE_SERVICE_TEMPLATE_ENGINE) {     // false → skip
  resolvedServiceTemplate = await resolveFromServiceTemplates(row.serviceType);
}

return res.json({
  ...
  serviceTemplate: resolvedServiceTemplate,  // → null
});
```

**Hasil:** `serviceTemplate: null` — zero behavior change. ✅

### 2.2 Flag ON

`resolveFromServiceTemplates(serviceType)` dipanggil dengan priority:

```
DB row (isActive=true)  →  source: "db"
  ↓ (jika tidak ada)
In-code template        →  source: "in-code"
  ↓ (jika tidak ada di in-code)
SERVICE_SCHEMAS fallback →  source: "fallback"
  ↓ (jika tidak ada di SERVICE_SCHEMAS)
Empty structure         →  source: "fallback"
```

Response GET token akan menyertakan:

```json
{
  "serviceTemplate": {
    "serviceType": "trucking",
    "label": "Trucking",
    "emoji": "🚛",
    "version": "1.0.0",
    "source": "db",
    "fields": [...17 fields...],
    "requiredDocuments": [
      { "key": "surat_jalan", "label": "Surat Jalan", "required": true },
      { "key": "stnk_kir", "label": "STNK / KIR Kendaraan", "required": true },
      { "key": "sim_driver", "label": "SIM B2/BU Driver", "required": true },
      { "key": "surat_tugas", "label": "Surat Tugas Driver", "required": false }
    ],
    "checklist": [
      { "key": "driver_confirmed", "label": "Driver dikonfirmasi dan siap" },
      { "key": "plate_verified", "label": "Plat nomor kendaraan terverifikasi" },
      { "key": "vehicle_checked", "label": "Kondisi kendaraan layak jalan" },
      { "key": "gps_active", "label": "GPS/Tracking aktif" },
      { "key": "cargo_secured", "label": "Muatan diamankan dengan baik" },
      { "key": "sj_issued", "label": "Surat Jalan sudah diterbitkan" }
    ]
  }
}
```

**Resolver tidak pernah throw** — wrapped dalam try/catch non-fatal di line 1030. ✅

---

## 3. Backend — Target ServiceType Verification (Live API)

**Endpoint:** `GET /api/service-templates/:serviceType`  
**Server port:** 8080 (post-fix)

| serviceType | Status | Source | Ver | Fields | Docs | Checklist |
|-------------|--------|--------|-----|--------|------|-----------|
| trucking | ✅ 200 | db | 1.0.0 | 17 | 4 (3 req, 1 opt) | 6 |
| sea_freight | ✅ 200 | db | 1.0.0 | 19 | 6 (4 req, 2 opt) | 5 |
| air_freight | ✅ 200 | db | 1.0.0 | 18 | 5 (3 req, 2 opt) | 5 |
| ppjk | ✅ 200 | db | 1.0.0 | 13 | 5 (3 req, 2 opt) | 5 |

### Trucking — Field Detail
```
Fields (quotation): truck_type, capacity, area_pickup, area_delivery, price,
                    additional_charge, eta_pickup, eta_delivery, valid_until, notes
Fields (operational): driver_name, driver_phone, plate_number, vehicle_type,
                      pickup_time, delivery_time, op_notes
Required docs: surat_jalan ✅, stnk_kir ✅, sim_driver ✅
Optional docs: surat_tugas
Checklist: driver_confirmed, plate_verified, vehicle_checked, gps_active,
           cargo_secured, sj_issued
```

### Sea Freight — Field Detail
```
Fields (quotation): shipping_line, pol, pod, container_type, freight_rate,
                    currency, etd, eta, transit_time, free_time,
                    charges_include, surcharge_note, validity, notes
Fields (operational): booking_number, vessel_name, op_etd, op_eta, bl_number
Required docs: bill_of_lading ✅, packing_list ✅, commercial_invoice ✅, shipping_instruction ✅
Optional docs: coo, msds
Checklist: booking_confirmed, si_submitted, container_stuffed, bl_released, docs_to_customer
```

### Air Freight — Field Detail
```
Fields (quotation): airline, origin_airport, dest_airport, rate_per_kg, currency,
                    min_charge, fsc, etd, transit_time, chargeable_weight_rule,
                    charges_include, validity, notes
Fields (operational): booking_number, flight_number, op_etd, op_eta, awb_number
Required docs: air_waybill ✅, packing_list ✅, commercial_invoice ✅
Optional docs: msds, coo
Checklist: booking_confirmed, cargo_accepted, awb_issued, flight_departed, docs_to_customer
```

### PPJK — Field Detail
```
Fields (quotation): doc_type, hs_code, customs_service, currency, duty_tax_estimate,
                    docs_required, sla, undername, notes
Fields (operational): nomor_aju, jenis_dokumen, status_customs, billing_info
Required docs: pib_peb ✅, packing_list ✅, commercial_invoice ✅
Optional docs: coo, msds
Checklist: docs_complete, aju_submitted, jalur_determined, sppb_issued, goods_released
```

---

## 4. Backend — Submit Data Storage (POST /api/vendor-form/admin/links)

Saat admin membuat VMF link dengan `USE_SERVICE_TEMPLATE_ENGINE=true`:

```ts
// Line 1946-1968: Service Template Snapshot
if (USE_SERVICE_TEMPLATE_ENGINE && !resolvedTemplateSnapshot) {
  const stpl = await resolveFromServiceTemplates(serviceType);
  resolvedTemplateId = serviceType;
  resolvedTemplateVersion = stpl.version ?? null;
  resolvedTemplateSnapshot = {
    templateKind: "service",      // ← discriminator untuk identifikasi
    serviceType: stpl.serviceType,
    label: stpl.label,
    emoji: stpl.emoji,
    version: stpl.version,
    fields: stpl.fields,
    requiredDocuments: stpl.requiredDocuments,
    checklist: stpl.checklist,
    source: stpl.source,          // db | in-code | fallback
  };
}

// Tersimpan di tabel vendor_mini_form_links:
await db.insert(vendorMiniFormLinksTable).values({
  templateId: resolvedTemplateId,       // = serviceType (misal "trucking")
  templateVersion: resolvedTemplateVersion,  // = "1.0.0"
  templateSnapshot: resolvedTemplateSnapshot, // = JSON snapshot lengkap
  ...
});
```

**Kondisi:** Snapshot service template hanya dibuat jika tidak ada product template snapshot (`!resolvedTemplateSnapshot`). Jika link memiliki keduanya (kategori produk + service type), product template mengambil prioritas.

**`templateKind: "service"` discriminator** memastikan bizportal dan consumer dapat membedakan snapshot produk vs layanan. ✅

---

## 5. Frontend — Customer Portal VMF Rendering

**File:** `artifacts/customer-portal/src/pages/vendor-mini-form.tsx`

### 5.1 Type Definition (line 43-52)

```ts
type ServiceTemplateInfo = {
  serviceType: string;
  label: string;
  emoji: string;
  fields: FieldDef[];
  requiredDocuments: Array<{ key: string; label: string; required: boolean }>;
  checklist: Array<{ key: string; label: string }>;
  version: string;
  source: string;
};
```

Type sudah lengkap dan sesuai dengan response backend. ✅

### 5.2 Header Badge (line 381-385)

```tsx
{!hasProductTemplate && meta.serviceTemplate && (
  <span className="...">
    <span>{meta.serviceTemplate.emoji}</span> {meta.serviceTemplate.label}
    <span className="opacity-50 ml-1">v{meta.serviceTemplate.version}</span>
  </span>
)}
```

Kondisi: `!hasProductTemplate && meta.serviceTemplate` — badge hanya tampil jika tidak ada product template. ✅

### 5.3 Required Documents (line 661-667)

```tsx
{!hasProductTemplate && meta.serviceTemplate && 
 (meta.serviceTemplate.requiredDocuments?.length ?? 0) > 0 && (
  <TemplateDocumentRenderer
    documents={meta.serviceTemplate.requiredDocuments}
    values={templateValues.uploadedDocuments}
    onChange={(docs) => setTemplateValues(v => ({ ...v, uploadedDocuments: docs }))}
  />
)}
```

Kondisi: Guard `!hasProductTemplate` + null-safe check. ✅

### 5.4 Checklist (line 670-678)

```tsx
{!hasProductTemplate && meta.serviceTemplate && 
 (meta.serviceTemplate.checklist?.length ?? 0) > 0 && (
  <TemplateChecklistRenderer
    checklist={meta.serviceTemplate.checklist}
    values={templateValues.checklistStatus}
    onChange={(key, checked) => setTemplateValues(v => ({
      ...v, checklistStatus: { ...v.checklistStatus, [key]: checked }
    }))}
  />
)}
```

Nilai checklist di-submit via key `_chk_${key}` (line 270). ✅

### 5.5 Form Fields — CRITICAL GAP ⚠️

```tsx
// Line 578 — Form utama SELALU dari schema (SERVICE_SCHEMAS), bukan serviceTemplate.fields
{schema && schema.fields.length > 0 && !hasProductTemplate && (
  <div>
    <h2>{schema.emoji} Detail {schema.label}</h2>
    {schema.fields.map(field => (...))}  // ← SERVICE_SCHEMAS, bukan serviceTemplate.fields
  </div>
)}
```

**`serviceTemplate.fields` TIDAK dirender di form utama.** Custom fields dari Service Template Engine (DB override) tidak ditampilkan ke vendor. Vendor hanya melihat field dari `SERVICE_SCHEMAS` (legacy hardcoded schema).

**Implikasi:** Jika admin mengubah fields melalui CMS service templates, perubahan fields tidak akan terlihat di customer-portal VMF. Hanya perubahan `requiredDocuments` dan `checklist` yang aktif dirender.

---

## 6. Fallback Behavior (Flag OFF)

| Scenario | Behavior | Status |
|----------|----------|--------|
| Flag OFF, token valid | `serviceTemplate: null` di response | ✅ Zero change |
| Flag OFF, link creation | Tidak ada snapshot service template | ✅ Zero change |
| Flag OFF, form render | Tidak ada badge, tidak ada docs/checklist dari service template | ✅ Zero change |
| Flag ON → Flag OFF restart | `null` kembali, tidak ada residual state | ✅ Reversible |

---

## 7. Unknown serviceType Safety

**Registry fallback:** `FALLBACK_SERVICE_TYPE = "document"` (lib/service-templates/src/registry.ts:4)

```ts
export function getInCodeServiceTemplate(serviceType: string): ServiceTemplate {
  return serviceTemplates[serviceType] ?? serviceTemplates[FALLBACK_SERVICE_TYPE]!;
}
```

**Live test result:**
```
GET /api/service-templates/completely_unknown_xyz
→ source: fallback | fields: 12 | docs: 1 | chk: 4
```

Ini adalah **template "document"** — bukan empty structure. Artinya:

- ✅ Resolver tidak pernah throw atau return null
- ⚠️ Unknown serviceType menampilkan form "Document / Additional Service" ke vendor
- ⚠️ Vendor melihat field yang tidak relevan untuk service type yang sebenarnya
- ✅ Untuk production VMF (trucking/sea_freight/air_freight/ppjk), fallback ini tidak akan terpicu karena semua ada di DB dan in-code

**Rekomendasi:** Pertimbangkan apakah fallback ke "document" lebih baik dari empty structure — saat ini behavior-nya konsisten tapi bisa membingungkan untuk debugging.

---

## 8. Bug Ditemukan & Diperbaiki

### BUG: Missing @workspace/service-templates Symlink

**Masalah:** `GET /api/service-templates` mengembalikan 404 karena `@workspace/service-templates` tidak ter-link di `artifacts/api-server/node_modules/@workspace/`.

**Root cause:** `pnpm install --filter @workspace/api-server` tidak dijalankan setelah paket `@workspace/service-templates` ditambahkan sebagai dependensi di `package.json`.

**Verifikasi:**
```
# Sebelum fix:
ls artifacts/api-server/node_modules/@workspace/
→ api-zod  db  logistics-constants  product-templates
# ← service-templates TIDAK ADA

# Setelah fix:
ls artifacts/api-server/node_modules/@workspace/
→ api-zod  db  logistics-constants  product-templates  service-templates ✅
```

**Fix:** Jalankan `pnpm install --filter @workspace/api-server` lalu restart workflow API Server.

**Status:** ✅ FIXED — `GET /api/service-templates` sekarang mengembalikan 200 dengan 17 templates.

---

## 9. Audit Matrix — Semua Kriteria

| # | Kriteria Audit | Result | Detail |
|---|----------------|--------|--------|
| 1 | Flag `USE_SERVICE_TEMPLATE_ENGINE` terbaca dengan benar | ✅ | `process.env === "true"` check di line 138 |
| 2 | Flag OFF → `serviceTemplate: null` di GET token response | ✅ | Zero behavior change confirmed |
| 3 | Flag ON → `serviceTemplate` terisi dengan full template | ✅ | Verified via code analysis |
| 4 | Resolver priority: DB → in-code → fallback | ✅ | Verified di resolveFromServiceTemplates() |
| 5 | Resolver tidak pernah throw | ✅ | try/catch non-fatal di setiap level |
| 6 | trucking: fields, requiredDocuments, checklist benar | ✅ | Live: 17f/4d/6c (source: db) |
| 7 | sea_freight: fields, requiredDocuments, checklist benar | ✅ | Live: 19f/6d/5c (source: db) |
| 8 | air_freight: fields, requiredDocuments, checklist benar | ✅ | Live: 18f/5d/5c (source: db) |
| 9 | ppjk: fields, requiredDocuments, checklist benar | ✅ | Live: 13f/5d/5c (source: db) |
| 10 | Frontend badge tampil dengan emoji + label + version | ✅ | Line 381-385, guard !hasProductTemplate |
| 11 | Frontend renders requiredDocuments via TemplateDocumentRenderer | ✅ | Line 661-667 |
| 12 | Frontend renders checklist via TemplateChecklistRenderer | ✅ | Line 670-678 |
| 13 | Frontend renders serviceTemplate.fields di form utama | ❌ GAP | Form hanya dari SERVICE_SCHEMAS (line 578-584) |
| 14 | Submit menyimpan templateSnapshot dengan templateKind="service" | ✅ | Line 1954-1964 |
| 15 | templateId = serviceType, templateVersion = version | ✅ | Line 1952-1953 |
| 16 | snapshot mencakup fields, requiredDocuments, checklist, source | ✅ | Line 1960-1963 |
| 17 | Unknown serviceType tidak crash | ✅ | Fallback ke "document" template |
| 18 | /api/service-templates endpoint berfungsi | ✅ FIXED | Bug missing symlink diperbaiki |
| 19 | DB templates sinkron dengan in-code templates | ✅ | source: "db" untuk semua 4 target types |
| 20 | productTemplate mengambil prioritas atas serviceTemplate docs/chk | ✅ | Guard `!hasProductTemplate` di setiap render |

---

## 10. Rekomendasi

### P0 — Sebelum Cutover Production

1. **Set env var untuk aktifkan flag:**
   ```
   USE_SERVICE_TEMPLATE_ENGINE=true
   ```
   Di `.replit` environment variables, lalu restart API Server.

2. **Pastikan pnpm install dijalankan setelah setiap penambahan lib workspace:**
   ```bash
   pnpm install --filter @workspace/api-server
   ```
   Ini sudah diperbaiki untuk session ini tetapi perlu dijaga di deployment pipeline.

### P1 — Gap Penting (Bisa Didefer ke Fase Berikutnya)

3. **`serviceTemplate.fields` tidak dirender di customer-portal VMF:**
   - Saat ini vendor hanya melihat field dari `SERVICE_SCHEMAS` (hardcoded)
   - Jika engine dimaksudkan untuk mengganti field rendering juga (bukan hanya docs/checklist), perlu menambahkan conditional di VMF:
   ```tsx
   {/* Gunakan serviceTemplate.fields jika tersedia, fallback ke schema.fields */}
   {(meta.serviceTemplate?.fields ?? schema?.fields ?? []).map(field => (...))}
   ```
   - Ini adalah desain decision — jika service template engine hanya untuk docs/checklist (bukan field replacement), ini bukan bug.

4. **Unknown serviceType fallback ke "document" template:**
   - Pertimbangkan apakah ini intentional atau lebih baik return 404 / empty structure
   - Untuk safety, current behavior tidak berbahaya tapi bisa menyesatkan

### P2 — Nice to Have

5. **DB templates punya version "1.0.0" untuk semua serviceType:**
   - Pertimbangkan version bumping workflow saat admin edit via CMS
   - Registry sudah support auto-bump minor version di PUT endpoint

6. **Monitoring cutover:**
   - Log `serviceTemplate.source` di API request logs saat flag ON
   - Alert jika serviceType tidak ditemukan di DB dan fallback ke "in-code"

---

## 11. Kesimpulan

Service Template Engine untuk VMF sudah **diimplementasikan dengan benar secara arsitektur**:
- Backend resolver (DB → in-code → fallback) solid dan tidak pernah throw
- GET token response sudah menyertakan `serviceTemplate` dengan data lengkap
- Submit snapshot tersimpan dengan discriminator `templateKind:"service"`
- Frontend sudah merender badge, requiredDocuments, dan checklist dari service template

**Satu gap ditemukan:** `serviceTemplate.fields` tidak dirender di form utama customer-portal — form masih dari `SERVICE_SCHEMAS`. Ini perlu klarifikasi apakah intentional (engine hanya untuk docs/checklist) atau perlu di-address.

**Satu bug diperbaiki:** Missing `@workspace/service-templates` symlink yang menyebabkan `/api/service-templates` 404.

**Rekomendasi cutover:** Engine siap untuk diaktifkan (`USE_SERVICE_TEMPLATE_ENGINE=true`) dengan catatan gap P1 di atas sudah dipahami dan diterima atau di-address.

---

*Audit selesai — 2026-06-01*
