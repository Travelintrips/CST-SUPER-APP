# Unified Logistics Audit Report
Generated: 2026-06-11

## RINGKASAN EKSEKUTIF

Modul logistik terdiri dari **6 namespace route berbeda**, **5 tabel utama yang tumpang-tindih**, dan **20+ halaman BizPortal** yang tidak konsisten namespace-nya. Ada 1 dead import, 1 route collision aktif, dan 2 modul yang masih pakai raw SQL boot migration alih-alih Drizzle schema.

---

## BAGIAN 1 — MODUL AKTIF

| # | Nama Modul | Route API | File Backend | Tabel Utama | Halaman BizPortal | Status |
|---|---|---|---|---|---|---|
| 1 | **General Freight / Forwarding** | `/api/logistics/freight-*` | `freight.ts` | `freight_shipments`, `freight_rfqs`, `freight_quotes`, `freight_customs_docs`, `shipment_stages`, `freight_attachments` | `/logistics`, `/logistics/freight`, `/logistics/freight/:id` | ✅ AKTIF |
| 2 | **Air Freight** | `/api/air-freight/*` | `airFreight.ts` | `air_freight_orders`, `air_freight_dimensions`, `air_freight_rfqs`, `air_freight_rate_submissions` | `/air-freight/orders`, `/air-freight/orders/:id` | ✅ AKTIF |
| 3 | **Air Freight Rates** | `/api/air-freight/*` | `airFreightRates.ts` | (raw SQL) | `/air-freight/rates` | ✅ AKTIF |
| 4 | **Air Freight Public** | `/api/air-freight/*` | `airFreightPublic.ts` | `air_freight_orders` | — (customer portal) | ✅ AKTIF |
| 5 | **Air Freight Vendor Form** | `/api/air-freight-form/*` | `airFreightVendorForm.ts` | `air_freight_rate_submissions` | — (public form) | ✅ AKTIF |
| 6 | **Ocean Freight** | `/api/ocean-freight/*` | `oceanFreight.ts` | `ocean_freight_orders`, `ocean_freight_rfqs`, `ocean_freight_rate_submissions` | `/logistics/ocean-freight-orders`, `/logistics/ocean-freight-orders/:id` | ✅ AKTIF |
| 7 | **Ocean Freight Rates** | `/api/ocean-freight/*` | `oceanFreightRates.ts` | `ocean_freight_rates` | `/logistics/ocean-freight-rates` | ✅ AKTIF |
| 8 | **Ocean Freight Public** | `/api/ocean-freight/*` | `oceanFreightPublic.ts` | `ocean_freight_orders` | — (customer portal) | ✅ AKTIF |
| 9 | **Ocean Freight Vendor Form** | `/api/ocean-freight/vendor-form/*` | `oceanFreightVendorForm.ts` | `ocean_freight_rate_submissions` | — (public form) | ✅ AKTIF |
| 10 | **Ocean Freight Master** | `/api/ocean-freight-master/*` | `oceanFreightMaster.ts` | (master data) | `/ocean-freight-master-data` | ✅ AKTIF |
| 11 | **Logistic Orders / Portal Order** | `/api/logistic/orders/*` | `logisticOrders.ts` | `logistic_orders` | `/logistics/portal-orders`, `/logistics/portal-orders/:id` | ✅ AKTIF |
| 12 | **Logistic RFQ** | `/api/logistic/orders/*` | `logisticRfq.ts` | `logistic_order_rfqs`, `logistic_order_quotes`, `rfq_vendor_links` | `/logistics/rfq-list`, `/logistics/rfq-detail/:id`, `/logistics/rfq-comparison` | ✅ AKTIF |
| 13 | **Logistic RFQ V2** | `/api/logistic/*` | `logisticRfqV2.ts` | `logistic_order_rfqs` | — | ✅ AKTIF (V2 endpoints) |
| 14 | **Product First Flow** | `/api/logistic/orders/*` | `productFirstFlow.ts` | `logistic_orders`, `vendor_catalog_items` | `/logistics/quote-requests` | ✅ AKTIF |
| 15 | **Trucking Orders** | `/api/logistic/orders/*` + `/api/trucking/*` | `logisticOrders.ts`, `truckingBookings.ts` | `logistic_orders` (shipmentType=trucking) | `/logistics/trucking-orders` | ✅ AKTIF |
| 16 | **Trucking Rates** | `/api/trucking-rates/*` | `truckingRates.ts` | (raw SQL) | (via vendor settings) | ✅ AKTIF |
| 17 | **Vendor Fulfillment** | `/api/vendor-fulfillment/*`, `/api/logistic/vendor-fulfillments/*` | `vendorFulfillment.ts`, `logisticVendorFulfillmentAdmin.ts` | `logistic_vendor_fulfillments` | `/logistics/vendor-fulfillments`, `/logistics/vendor-fulfillments/:id` | ✅ AKTIF |

---

## BAGIAN 2 — MODUL DUPLIKAT / DEPRECATED

| # | File | Status | Alasan | Tindakan |
|---|---|---|---|---|
| 1 | `artifacts/api-server/src/routes/logistics.ts` | ⛔ DEPRECATED — FROZEN | Legacy route yang pakai tabel `shipments` (lama). Sudah dinonaktifkan di index.ts. | Sudah di-comment-out. Jangan mount ulang. |
| 2 | `airFreightRouter` (named export dari `airFreight.js`) | ⛔ DEAD IMPORT | Diimport di index.ts baris 127 tapi TIDAK pernah di-mount. Hanya default export yang dipakai. | Comment out import di index.ts. |
| 3 | Tabel `shipments` (`shipmentsTable`) | ⚠️ LEGACY — AKAN DIHAPUS | Tabel lama sebelum migrasi ke `freight_shipments`. Masih direferensi di `dashboard.ts` untuk count widget. | Freeze. Hapus saat Phase 5 setelah widget di-update. |

---

## BAGIAN 3 — ROUTE YANG OVERLAP / KONFLIK

### 3.1 Triple mount di `/api/logistic/orders`
```
router.use("/logistic/orders", logisticRfqRouter);      ← baris 172
router.use("/logistic/orders", productFirstFlowRouter); ← baris 174
router.use("/logistic/orders", logisticOrdersRouter);   ← baris 175
```
**Risiko:** `logisticRfqRouter` punya handler `GET /` dan `POST /`.
`logisticOrdersRouter` juga punya `GET /` dan `POST /`.
Express hanya panggil handler pertama yang cocok → `logisticOrdersRouter.GET /` tidak pernah tercapai jika `logisticRfqRouter` sudah merespons.

**Status saat ini:** Belum crash karena flow `logisticRfqRouter.GET /` dan `logisticOrdersRouter.GET /` kebetulan tidak konflik dari sisi client (client tahu path mana yang dipanggil). Tapi ini fragil.

### 3.2 Air Freight — dua router di satu namespace
```
router.use("/air-freight", airFreightNewRouter);    ← default export, AKTIF
router.use("/air-freight", airFreightRatesRouter);  ← rates, AKTIF
router.use("/air-freight", airFreightPublicRouter); ← public, AKTIF
```
Order mounting sudah benar (rates dan public duluan, karena airFreightNewRouter punya catch-all), tapi rentan rusak jika ada penambahan route baru di file yang salah.

### 3.3 Ocean Freight — empat router di satu namespace
```
router.use("/ocean-freight", oceanFreightPublicRouter);   ← HARUS pertama
router.use("/ocean-freight", oceanFreightRatesRouter);    ← HARUS kedua
router.use("/ocean-freight", oceanFreightRouter);         ← punya GET /:id catch-all
router.use("/ocean-freight/vendor-form", ...);
```
Order sudah ada komentar di index.ts tapi tidak dijaga secara struktural.

---

## BAGIAN 4 — TABEL YANG OVERLAP

| Tabel | Modul | Drizzle Schema | Status |
|---|---|---|---|
| `shipments` | logistics.ts (legacy) | `lib/db/src/schema/shipments.ts` | ⛔ FROZEN — jangan tambah data baru |
| `freight_shipments` | freight.ts (AKTIF) | `lib/db/src/schema/freightShipments.ts` | ✅ MASTER TABLE |
| `logistic_orders` | logisticOrders.ts (AKTIF) | `lib/db/src/schema/logisticOrders.ts` | ✅ AKTIF — trucking + portal orders |
| `air_freight_orders` | airFreight.ts | ❌ Raw SQL boot migration (tidak di lib/db) | ⚠️ PERLU MIGRASI KE DRIZZLE |
| `ocean_freight_orders` | oceanFreight.ts | ❌ Raw SQL boot migration (tidak di lib/db) | ⚠️ PERLU MIGRASI KE DRIZZLE |
| `ocean_freight_rates` | oceanFreightRates.ts | ❌ Raw SQL boot migration | ⚠️ PERLU MIGRASI KE DRIZZLE |
| `air_freight_rfqs` | airFreight.ts | ❌ Raw SQL boot migration | ⚠️ PERLU MIGRASI KE DRIZZLE |
| `ocean_freight_rfqs` | oceanFreight.ts | ❌ Raw SQL boot migration | ⚠️ PERLU MIGRASI KE DRIZZLE |

---

## BAGIAN 5 — MENU SIDEBAR YANG DUPLIKAT / TIDAK KONSISTEN

### 5.1 Dua entry yang menampilkan data SAMA
```
{ titleKey: "shipments",        href: "/logistics" }         → freight_shipments
{ titleKey: "freightForwarding", href: "/logistics/freight" } → freight_shipments (SAMA!)
```
**Masalah:** Dua menu berbeda, data identik.

### 5.2 Namespace tidak konsisten (Air vs Ocean)
```
Air Freight  → href: "/air-freight/orders"           ← namespace /air-freight/
Ocean Freight → href: "/logistics/ocean-freight-orders" ← namespace /logistics/
```
**Masalah:** Air Freight punya namespace sendiri (`/air-freight/`), Ocean Freight "menumpang" di `/logistics/`.

### 5.3 RFQ yang tumpang-tindih
```
{ titleKey: "RFQ Vendor",    href: "/logistics/rfq" }           → logistic_order_rfqs
{ titleKey: "Request Quote", href: "/logistics/quote-requests" } → logistic_orders (Product First Flow)
```
Ini sebenarnya berbeda fungsi tapi nama dan posisi menu sangat mirip → membingungkan user.

---

## BAGIAN 6 — UNIFIED SHIPMENT CORE (FASE 2)

### Field baru yang ditambahkan ke `freight_shipments`:

| Field | Tipe | Nilai | Tujuan |
|---|---|---|---|
| `service_category` | ENUM (nullable) | `FF_UDARA`, `FF_LAUT`, `PPJK`, `TRUCKING`, `MULTIMODAL`, `GENERAL_FORWARDING` | Kategorisasi jenis layanan forwarding |
| `source_module` | TEXT (nullable) | `air_freight`, `ocean_freight`, `logistic_order`, `freight`, `manual` | Asal pembuatan shipment |
| `source_order_id` | INTEGER (nullable) | ID dari tabel sumber | Traceability ke order asal |

Data lama tidak rusak — semua kolom nullable dengan default NULL.

---

## RENCANA TINDAK LANJUT (BACKLOG)

| Prioritas | Item | Estimasi |
|---|---|---|
| 🔴 Segera | Fix dead import `airFreightRouter` di index.ts | Done ✅ |
| 🔴 Segera | Tambah field unified ke `freight_shipments` | Done ✅ |
| 🟡 Sprint berikutnya | Pisahkan sub-path `/logistic/orders` agar tidak triple-mount | Medium |
| 🟡 Sprint berikutnya | Migrasi `air_freight_*` dan `ocean_freight_*` raw SQL → Drizzle schema di lib/db | Medium |
| 🟡 Sprint berikutnya | Hapus duplikat menu "Logistic Shipments" (merge ke "Freight Forwarding") | Small |
| 🟡 Sprint berikutnya | Pindah halaman Ocean Freight dari `/logistics/ocean-*` ke `/ocean-freight/` (konsistensi namespace) | Medium |
| 🟢 Future | Phase 5: hapus tabel `shipments` (legacy) setelah dashboard widget di-update | Large |
| 🟢 Future | Buat unified shipment list view yang gabung air + ocean + freight + trucking | Large |
