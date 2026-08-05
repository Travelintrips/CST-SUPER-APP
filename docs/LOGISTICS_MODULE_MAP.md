# LOGISTICS MODULE MAP — BizPortal
> **Dokumen Resmi FASE 9 · Ditetapkan 2026-06-11**
> Dokumen ini adalah **sumber kebenaran tunggal** untuk semua hal terkait modul logistik.
> **WAJIB dibaca** sebelum membuat route, tabel, menu, atau halaman baru yang berhubungan dengan logistik.

---

## DAFTAR ISI
1. [Ringkasan Arsitektur](#1-ringkasan-arsitektur)
2. [Modul Aktif](#2-modul-aktif)
3. [Modul Legacy / Deprecated](#3-modul-legacy--deprecated)
4. [Kapan Pakai Modul Mana?](#4-kapan-pakai-modul-mana)
5. [Standar Penamaan](#5-standar-penamaan)
6. [Checklist Sebelum Merge](#6-checklist-sebelum-merge)
7. [Guardrail: Sebelum Membuat Modul Baru](#7-guardrail-sebelum-membuat-modul-baru)
8. [Inventaris Lengkap: Tabel DB](#8-inventaris-lengkap-tabel-db)
9. [Inventaris Lengkap: API Routes](#9-inventaris-lengkap-api-routes)
10. [Inventaris Lengkap: Halaman BizPortal](#10-inventaris-lengkap-halaman-bizportal)
11. [Anomali & Hutang Teknis](#11-anomali--hutang-teknis)

---

## 1. Ringkasan Arsitektur

```
Customer / Portal ──► logistic_orders (customer request)
                             │
                    Admin mengolah ▼
              ┌──────────────────────────────────────┐
              │       UNIFIED FREIGHT SHIPMENT       │
              │       (freight_shipments)             │
              │  serviceCategory menentukan jalur:   │
              │  FF_UDARA / FF_LAUT / PPJK /         │
              │  TRUCKING / MULTIMODAL                │
              └──────────────────────────────────────┘
                    │              │            │
              Air Freight    Ocean Freight   Trucking
          (air_freight_orders)(ocean_freight_orders)(trucking_booking_requests)
                    │              │            │
              semua bermuara kembali ke freight_shipments
              melalui sourceModule + sourceOrderId

Driver ────► driver_jobs ──► freight_shipments (shipmentId)
```

**Prinsip utama:**
- `freight_shipments` adalah **pusat rekam** semua pengiriman aktif — semua laporan, profitabilitas, dan audit diambil dari sini.
- Modul spesifik (Air, Ocean, Trucking) boleh punya tabel sendiri untuk data domain-spesifik, tetapi **wajib membuat atau menautkan entri di `freight_shipments`** jika sudah dikonfirmasi menjadi pengiriman aktif.
- Semua transaksi revenue/cost wajib terhubung ke Sales Doc / Purchase Doc di sistem akuntansi.

---

## 2. Modul Aktif

### 2.1 Unified Freight Shipment — INTI SISTEM
| Aspek | Detail |
|---|---|
| **Fungsi** | Rekam, tracking, RFQ, quote, profitabilitas semua pengiriman lintas moda |
| **Status** | ✅ Aktif — tulang punggung modul logistik |
| **Kapan dipakai** | Semua jenis pengiriman setelah konfirmasi admin |

**API Routes:**
```
GET    /api/logistics/freight-shipments           — list semua shipment
POST   /api/logistics/freight-shipments           — buat shipment baru (salesDocId opsional)
GET    /api/logistics/freight-shipments/:id       — detail + stages + rfqs + quotes
PUT    /api/logistics/freight-shipments/:id       — update shipment
POST   /api/logistics/freight-shipments/from-portal-order/:orderId  — dari logistic order

POST   /api/logistics/freight-shipments/:id/rfqs  — buat RFQ pada shipment
GET    /api/logistics/freight-rfqs                — list RFQ (filter ?shipmentId=)
GET    /api/logistics/freight-rfqs/:id            — detail RFQ
POST   /api/logistics/freight-rfqs/:id/quotes     — submit quote dari vendor
POST   /api/logistics/freight-quotes/:id/approve  — setujui quote

POST   /api/logistics/freight-shipments/:id/stages       — upsert tahapan pengiriman
GET    /api/logistics/freight-shipments/:id/profitability — profitabilitas per shipment
POST   /api/logistics/freight-shipments/:id/attachments  — upload lampiran
POST   /api/logistics/freight-shipments/:id/customs-docs — upload dokumen bea cukai
```

**Tabel DB:**
- `freight_shipments` — tabel utama, wajib ada entri di sini untuk setiap pengiriman aktif
- `freight_rfqs` — RFQ yang dikirim ke vendor
- `freight_quotes` — penawaran balik dari vendor
- `shipment_stages` — tracking tahapan (pickup, customs, departure, arrival, delivery)
- `freight_attachments` — lampiran dokumen
- `freight_customs_docs` — dokumen kepabeanan
- `freight_shipment_audit_logs` — log perubahan per shipment

**Halaman BizPortal:**
- `/logistics` — unified shipment list (semua moda)
- `/logistics/freight` — PPJK/Customs & filter moda
- `/logistics/freight/new` — form buat shipment baru
- `/logistics/freight/:id` — detail shipment
- `/logistics/freight/:id/edit` — edit shipment
- `/logistics/freight/:id/bl` — Bill of Lading

**Schema file:** `lib/db/src/schema/freightShipments.ts`

---

### 2.2 Air Freight — Modul Spesifik
| Aspek | Detail |
|---|---|
| **Fungsi** | Pengiriman udara — pricing, booking AWB, rate management vendor |
| **Status** | ✅ Aktif |
| **Kapan dipakai** | Order angkutan udara — ekspor/impor via airport |

**API Routes:**
```
GET    /api/air-freight/orders            — list air freight orders
POST   /api/air-freight/orders            — buat order baru
GET    /api/air-freight/orders/:id        — detail order
PATCH  /api/air-freight/orders/:id        — update order
GET    /api/air-freight/rates             — master rates udara
POST   /api/air-freight/rates             — tambah rate
```

**Tabel DB:**
- `air_freight_orders` — order AF spesifik (dengan field airline, AWB, chargeable weight, dll)
- `air_freight_dimensions` — dimensi kargo per order
- `air_freight_rfqs` — RFQ ke maskapai/agen AF
- `air_freight_rate_submissions` — penawaran dari vendor AF
- `air_freight_tracking_events` — event tracking khusus AF

**Halaman BizPortal:**
- `/air-freight/orders` — list order AF
- `/air-freight/orders/:id` — detail order AF
- `/air-freight/rates` — master rate AF

**Schema file:** `lib/db/src/schema/airFreight.ts`

**Catatan penting:** Order AF yang sudah dikonfirmasi **harus ditautkan ke `freight_shipments`** via `sourceModule='air_freight'` + `sourceOrderId=<id>` + `serviceCategory='FF_UDARA'`.

---

### 2.3 Ocean Freight — Modul Spesifik
| Aspek | Detail |
|---|---|
| **Fungsi** | Pengiriman laut — FCL/LCL, rate management kapal, vendor form |
| **Status** | ✅ Aktif |
| **Kapan dipakai** | Order angkutan laut — FCL, LCL, ekspor/impor via pelabuhan |

**API Routes:**
```
GET    /api/ocean-freight/orders           — list OF orders (⚠️ kadang lambat)
POST   /api/ocean-freight/orders           — buat order
GET    /api/ocean-freight/orders/:id       — detail order
PATCH  /api/ocean-freight/orders/:id/status — update status
POST   /api/ocean-freight/orders/:id/blast-rfq — kirim RFQ ke vendor
GET    /api/ocean-freight/rates            — master rates laut
GET    /api/ocean-freight/options          — opsi dropdown (publik)
```

**Legacy redirects (frontend):**
- `/ocean-freight/orders` → `/logistics/ocean-freight-orders`
- `/ocean-freight/rates` → `/logistics/ocean-freight-rates`

**Tabel DB:**
- `ocean_freight_orders` — order OF spesifik
- `ocean_freight_rfqs` — RFQ ke vendor/EMKL
- `ocean_freight_rate_submissions` — penawaran dari vendor
- `ocean_freight_rates` — master rate per lane

**Halaman BizPortal:**
- `/logistics/ocean-freight-orders` — list order OF
- `/logistics/ocean-freight/:id` — detail order OF
- `/logistics/ocean-freight-rates` — master rate OF
- `/ocean-freight-master-data` — master data admin OF

**Schema file:** `lib/db/src/schema/oceanFreight.ts`

---

### 2.4 Trucking — Modul Spesifik
| Aspek | Detail |
|---|---|
| **Fungsi** | Angkutan darat — booking truk, rate per kendaraan, penugasan driver |
| **Status** | ✅ Aktif |
| **Kapan dipakai** | Order angkutan darat dalam/antar kota |

**API Routes:**
```
GET    /api/trucking/bookings              — list booking truk
POST   /api/trucking/bookings             — buat booking
GET    /api/trucking-rates                — rate per jenis kendaraan
POST   /api/trucking-rates               — tambah rate
GET    /api/logistics-units               — unit logistik (satuan muatan)
GET    /api/vendor-trucking-pricing       — pricing vendor trucking
```

**Tabel DB:**
- `trucking_booking_requests` — booking truk (raw SQL boot migration)
- `trucking_vehicle_rates` — rate per jenis kendaraan (raw SQL boot migration)
- `vendor_trucking_pricing` — harga vendor trucking (Drizzle schema)

**Halaman BizPortal:**
- `/logistics/trucking-orders` — list booking trucking
- `/settings/trucking-rates` — master rate kendaraan
- `/settings/logistics-units` — satuan muatan

**Schema file:** `lib/db/src/schema/vendorTruckingPricing.ts`

---

### 2.5 PPJK / Customs Clearance — Via Unified Freight
| Aspek | Detail |
|---|---|
| **Fungsi** | Kepabeanan / bea cukai — impor, ekspor, re-ekspor |
| **Status** | ✅ Aktif — menggunakan sistem Unified Freight Shipment |
| **Kapan dipakai** | Semua urusan bea cukai tanpa pengiriman moda transportasi lain |

**PPJK tidak punya modul/tabel terpisah.** Dibuat langsung sebagai `freight_shipments` dengan:
- `serviceCategory = 'PPJK'`
- `sourceModule = 'manual'` (atau 'air_freight'/'ocean_freight' jika terkait)
- Field khusus bea cukai: `hsCode`, `freightCustomsDocs`

**API:** Sama dengan Unified Freight Shipment (2.1)

**Halaman BizPortal:** `/logistics/freight` (filter PPJK)

---

### 2.6 Logistic Orders — Portal Customer
| Aspek | Detail |
|---|---|
| **Fungsi** | Penerimaan order dari customer portal, RFQ lifecycle, vendor fulfillment |
| **Status** | ✅ Aktif — entry point dari customer/portal |
| **Kapan dipakai** | Order yang masuk dari customer portal atau admin input manual |

**API Routes:**
```
GET    /api/logistic/orders               — list semua order portal
POST   /api/logistic/orders              — buat order baru (admin)
GET    /api/logistic/orders/:id          — detail order
PATCH  /api/logistic/orders/:id          — update order

GET    /api/logistic/vendor-fulfillments/:id    — detail fulfillment vendor
POST   /api/logistic/vendor-fulfillments        — buat fulfillment
PATCH  /api/logistic/vendor-fulfillments/:id/status — update status fulfillment
```

**Tabel DB:**
- `logistic_orders` — order masuk dari portal
- `logistic_order_items` — item per order
- `logistic_order_rfqs` — RFQ yang dibuat admin untuk order ini
- `logistic_order_quotes` — quote dari vendor untuk RFQ
- `vendor_offers` — penawaran vendor (product-first flow)
- `vendor_responses` — respons vendor via WA/form
- `logistic_vendor_fulfillments` — penugasan vendor untuk eksekusi

**Halaman BizPortal:**
- `/logistics/portal-orders` — list order dari portal
- `/logistics/portal-orders/:id` — detail order portal
- `/logistics/rfq` — manajemen RFQ order
- `/logistics/rfq/:id/detail` — detail RFQ
- `/logistics/rfq/:id/comparison` — bandingkan quotes
- `/logistics/vendor-fulfillments` — list vendor fulfillment
- `/logistics/vendor-fulfillments/:id` — detail fulfillment

**Schema file:** `lib/db/src/schema/logisticOrders.ts`, `lib/db/src/schema/logisticVendorFulfillments.ts`

---

### 2.7 Driver Management
| Aspek | Detail |
|---|---|
| **Fungsi** | Data driver, penugasan job, tracking lokasi, performa |
| **Status** | ✅ Aktif |
| **Kapan dipakai** | Manajemen driver internal CST |

**API Routes:**
```
GET    /api/drivers                       — list driver (admin)
POST   /api/drivers                       — tambah driver
GET    /api/drivers/:id                   — detail driver
PUT    /api/drivers/:id                   — update driver
GET    /api/driver/jobs                   — list job driver (driver-facing)
POST   /api/driver/jobs/:id/status        — update status job
```

**Tabel DB:**
- `drivers` — data driver
- `driver_jobs` — penugasan job ke driver
- `driver_job_logs` — log aktivitas per job
- `driver_photos` — foto POD dari driver
- `driver_locations` — histori lokasi GPS driver

**Halaman BizPortal:**
- `/logistics/drivers` — list & kelola driver
- `/logistics/driver-performance` — performa per driver
- `/logistics/drivers/analytics` — analytics driver aggregat

**Schema files:** `lib/db/src/schema/drivers.ts`, `lib/db/src/schema/driverJobs.ts`, `lib/db/src/schema/driverLocations.ts`

---

### 2.8 Rate & Master Data
| Aspek | Detail |
|---|---|
| **Fungsi** | Master rate semua moda, margin rules, vendor pricing |
| **Status** | ✅ Aktif |

**API Routes:**
```
GET/POST  /api/air-freight/rates          — master rate udara
GET/POST  /api/ocean-freight/rates        — master rate laut
GET/POST  /api/trucking-rates             — master rate kendaraan darat
GET/POST  /api/vendor-trucking-pricing    — pricing per vendor trucking
GET/POST  /api/logistics-units            — satuan muatan
```

**Halaman BizPortal:**
- `/air-freight/rates` — rate udara
- `/logistics/ocean-freight-rates` — rate laut
- `/settings/trucking-rates` — rate kendaraan
- `/logistics/margin-rules` — aturan margin otomatis

---

### 2.9 Vendor Intelligence & Reporting
| Aspek | Detail |
|---|---|
| **Fungsi** | Laporan profitabilitas, rekomendasi vendor, analytics komoditas |
| **Status** | ✅ Aktif |

**API Routes:**
```
GET    /api/logistics/freight-shipments/:id/profitability — profit per shipment
GET    /api/accounting/reports/freight-profitability      — laporan akuntansi
```

**Halaman BizPortal:**
- `/accounting/reports/freight-profitability` — laporan profitabilitas freight
- `/logistics/vendor-recommendation` — rekomendasi vendor
- `/logistics/vendor-commodity-intelligence` — kecerdasan vendor × komoditas

---

## 3. Modul Legacy / Deprecated

### 3.1 `shipments` table — ⛔ FROZEN
```
Tabel: shipments
Status: DEPRECATED sejak Phase 4 (2026-05-30)
File: lib/db/src/schema/shipments.ts
```
- **Writer aktif:** TIDAK ADA — logisticsRouter sudah diblokir
- **Reader aktif:** `dashboard.ts` (hanya count, read-only)
- **Pengganti:** `freight_shipments`
- **Rencana:** Update dashboard widget ke `freightShipmentsTable`, lalu DROP tabel + enum `shipment_status`
- **JANGAN** buat kode baru yang menulis ke tabel ini

### 3.2 `logisticsRouter` — ⛔ DINONAKTIFKAN
```
File: artifacts/api-server/src/routes/logistics.ts (masih ada tapi tidak di-mount)
Mount: // router.use("/logistics", logisticsRouter);  ← dikomen di index.ts
```
- Digantikan oleh `freightRouter` yang di-mount di `/logistics`
- **JANGAN** uncomment atau aktifkan kembali tanpa migrasi data penuh

### 3.3 Legacy URL Redirects (Frontend)
URL lama berikut masih ada sebagai redirect, bukan halaman aktif:
```
/ocean-freight/orders     → redirect ke /logistics/ocean-freight-orders
/ocean-freight/rates      → redirect ke /logistics/ocean-freight-rates
/logistics/air-freight    → redirect ke /air-freight/orders
/logistics/air-freight/:id → redirect ke /air-freight/orders/:id
```
**Jangan buat halaman baru di path lama ini.**

---

## 4. Kapan Pakai Modul Mana?

```
┌─────────────────────────────────────────────────────────────────────┐
│               DECISION TREE: Pilih Modul yang Tepat                 │
└─────────────────────────────────────────────────────────────────────┘

Order baru masuk dari customer portal?
  └─► Gunakan LOGISTIC ORDERS (/api/logistic/orders)
      Setelah admin setujui → buat FREIGHT SHIPMENT dari order itu.

Pengiriman dikonfirmasi oleh admin (apapun jenisnya)?
  └─► Buat entri FREIGHT SHIPMENT (freight_shipments)
      dengan serviceCategory yang sesuai.

Moda transportasi UDARA (pesawat, airport, AWB)?
  └─► Gunakan AIR FREIGHT (air_freight_orders)
      Setelah confirmed → tautkan ke freight_shipments (FF_UDARA)

Moda transportasi LAUT (kapal, pelabuhan, BL, container)?
  └─► Gunakan OCEAN FREIGHT (ocean_freight_orders)
      Setelah confirmed → tautkan ke freight_shipments (FF_LAUT)

Moda transportasi DARAT (truk, van, kendaraan)?
  └─► Gunakan TRUCKING (trucking_booking_requests)
      Setelah confirmed → tautkan ke freight_shipments (TRUCKING)
      Driver penugasan via driver_jobs

Hanya pengurusan kepabeanan (tanpa moda transport)?
  └─► Buat langsung FREIGHT SHIPMENT dengan serviceCategory='PPJK'
      Gunakan halaman /logistics/freight

Kombinasi lebih dari satu moda?
  └─► Buat FREIGHT SHIPMENT dengan serviceCategory='MULTIMODAL'
      Tambahkan stages untuk tiap moda yang dipakai

Belum tahu moda / masih negosiasi?
  └─► Buat FREIGHT SHIPMENT dengan serviceCategory='GENERAL_FORWARDING'
      Update serviceCategory saat sudah ditentukan
```

---

## 5. Standar Penamaan

### 5.1 API Routes — WAJIB IKUTI
| Kategori | Pola | Contoh |
|---|---|---|
| Core freight | `/api/logistics/...` | `/api/logistics/freight-shipments` |
| Air freight spesifik | `/api/air-freight/...` | `/api/air-freight/orders` |
| Ocean freight spesifik | `/api/ocean-freight/...` | `/api/ocean-freight/orders` |
| Trucking spesifik | `/api/trucking/...` | `/api/trucking/bookings` |
| Portal/customer orders | `/api/logistic/...` | `/api/logistic/orders` |
| Driver (driver-facing) | `/api/driver/...` | `/api/driver/jobs` |
| Driver (admin) | `/api/drivers/...` | `/api/drivers/:id` |
| Settings logistik | `/api/logistics-units`, `/api/trucking-rates` | |

**❌ JANGAN buat:** `/api/shipping/...`, `/api/delivery/...`, `/api/cargo/...`, `/api/transport/...` — sudah ada padanannya di atas.

### 5.2 Halaman BizPortal — WAJIB IKUTI
| Kategori | Pola | Contoh |
|---|---|---|
| Core / unified | `/logistics/...` | `/logistics`, `/logistics/freight` |
| Air freight | `/air-freight/...` | `/air-freight/orders` |
| Ocean freight | `/logistics/ocean-freight-...` | `/logistics/ocean-freight-orders` |
| Trucking | `/logistics/trucking-...` | `/logistics/trucking-orders` |
| Driver | `/logistics/drivers/...` | `/logistics/drivers/analytics` |
| Settings | `/settings/trucking-rates`, `/settings/logistics-units` | |

**❌ JANGAN buat:** `/shipment/...`, `/delivery/...`, `/cargo/...`, `/transport/...`

### 5.3 Nama File Halaman BizPortal — WAJIB IKUTI
```
artifacts/bizportal/src/pages/
  logistics.tsx                    ← unified list
  logistics-freight.tsx            ← PPJK/freight detail
  logistics-freight-*.tsx          ← sub-halaman freight
  logistics-drivers.tsx            ← driver management
  logistics-driver-*.tsx           ← sub-halaman driver
  logistics-portal-*.tsx           ← portal order pages
  logistics-vendor-*.tsx           ← vendor-related pages
  air-freight/                     ← sub-folder AF
    orders.tsx, order-detail.tsx, rates.tsx, approval.tsx, track.tsx
  ocean-freight/                   ← sub-folder OF
    orders.tsx, order-detail.tsx, rates.tsx
```

**❌ JANGAN buat:** `shipment-list.tsx`, `delivery-page.tsx`, halaman tanpa prefix `logistics-` di luar folder di atas.

### 5.4 Nama Tabel DB — WAJIB IKUTI
| Prefix | Digunakan untuk | Contoh |
|---|---|---|
| `freight_` | Core freight + dokumen | `freight_shipments`, `freight_rfqs`, `freight_quotes` |
| `logistic_` | Portal orders + fulfillment | `logistic_orders`, `logistic_vendor_fulfillments` |
| `air_freight_` | Air freight spesifik | `air_freight_orders`, `air_freight_rfqs` |
| `ocean_freight_` | Ocean freight spesifik | `ocean_freight_orders`, `ocean_freight_rates` |
| `trucking_` | Trucking spesifik | `trucking_booking_requests`, `trucking_vehicle_rates` |
| `driver_` | Driver management | `driver_jobs`, `driver_locations` |
| `drivers` | Tabel master driver | (tanpa prefix — sudah ada, jangan rename) |
| `shipment_` | Tracking stages | `shipment_stages` |
| `vendor_` | Vendor-related (legacy + cross-module) | `vendor_offers`, `vendor_responses` |

**❌ JANGAN buat tabel dengan prefix:** `shipping_`, `delivery_`, `cargo_`, `transport_`, `order_` (sudah ada `logistic_orders`).

### 5.5 Nama Kolom `serviceCategory` di `freight_shipments`
Selalu gunakan nilai enum yang sudah didefinisikan:
```
'FF_UDARA'           → Air Freight Forwarding
'FF_LAUT'            → Sea/Ocean Freight Forwarding
'PPJK'               → Customs Clearance
'TRUCKING'           → Angkutan Darat
'MULTIMODAL'         → Kombinasi moda
'GENERAL_FORWARDING' → Umum / belum dikategorikan
```

---

## 6. Checklist Sebelum Merge

Gunakan checklist ini setiap kali ada PR/commit yang menyentuh modul logistik:

### 6.1 Menu & Navigasi
- [ ] Tidak ada item menu duplikat di `AppShell.tsx` (cek href yang sama muncul lebih dari sekali)
- [ ] Setiap menu baru punya halaman yang sudah di-register di `routes.tsx`
- [ ] URL menu mengikuti standar penamaan (§5.2)
- [ ] Tidak ada route yang overlap (path yang sama di-handle dua komponen berbeda)

### 6.2 API Routes
- [ ] Route baru mengikuti pola URL standar (§5.1)
- [ ] Route baru tidak menduplikasi route yang sudah ada — cek `index.ts` dulu
- [ ] Route admin dilindungi `requireAdmin` atau `requireClerkUser`
- [ ] Route publik tidak membuka data sensitif tanpa auth
- [ ] Tidak ada route yang meng-override route existing tanpa dokumen migrasi

### 6.3 Tabel DB
- [ ] Tidak ada tabel baru tanpa alasan kuat (cek §7 dulu)
- [ ] Nama tabel mengikuti prefix standar (§5.4)
- [ ] Tabel baru dibuat via **Drizzle schema** di `lib/db/src/schema/`, bukan raw SQL di route file
- [ ] Jalankan `drizzle-kit push` dan verifikasi kolom benar-benar ter-apply di DB (jangan percaya output "Changes applied" saja — cek via `information_schema.columns`)
- [ ] Kolom enum baru: verifikasi tipe enum ter-create di DB sebelum mencoba insert

### 6.4 Audit & Akuntansi
- [ ] Setiap create/update/delete data penting memanggil `writeAuditLog` atau `logOrderAudit`
- [ ] Setiap order yang dikonfirmasi masuk ke `freight_shipments` (lewat create langsung atau via `sourceOrderId`)
- [ ] Setiap transaksi revenue/cost terhubung ke Sales Doc atau Purchase Doc
- [ ] Konfirmasi order yang menghasilkan pendapatan membuat entri akuntansi otomatis

### 6.5 Unified Shipment List
- [ ] Order baru yang dikonfirmasi muncul di halaman `/logistics` (unified list)
- [ ] `serviceCategory` dan `sourceModule` diisi dengan benar
- [ ] Jika berasal dari modul lain (AF/OF/Trucking), `sourceOrderId` diisi

### 6.6 Testing Minimal
- [ ] GET list endpoint mengembalikan 200 (bukan 404 atau 500)
- [ ] POST create endpoint mengembalikan 201 dengan data yang benar
- [ ] Auth endpoint: request tanpa session/token mengembalikan 401/403 (bukan 200)
- [ ] Endpoint baru terdaftar di dokumen ini (update §9)

---

## 7. Guardrail: Sebelum Membuat Modul Baru

**Sebelum membuat route, tabel, menu, atau halaman logistik baru, jawab dulu pertanyaan berikut:**

### Pertanyaan 1: Apakah sudah ada tabel yang bisa dipakai?
```
Mau menyimpan data pengiriman baru?
  → Sudah ada: freight_shipments (dengan serviceCategory)
  
Mau menyimpan penawaran vendor?
  → Sudah ada: freight_quotes, logistic_order_quotes, air_freight_rate_submissions, ocean_freight_rate_submissions

Mau menyimpan RFQ?
  → Sudah ada: freight_rfqs, logistic_order_rfqs, air_freight_rfqs, ocean_freight_rfqs

Mau menyimpan tracking tahapan?
  → Sudah ada: shipment_stages (gunakan stageType yang sesuai)

Mau menyimpan dokumen/lampiran?
  → Sudah ada: freight_attachments, freight_customs_docs
```

**Jika jawabannya "sudah ada" → GUNAKAN tabel existing. Jangan buat tabel baru.**

### Pertanyaan 2: Apakah sudah ada route yang bisa dipakai?
Cek `artifacts/api-server/src/routes/index.ts` dan §9 di dokumen ini.
Jika ada route yang sudah 90% sesuai → **extend route existing**, jangan buat router baru.

### Pertanyaan 3: Apakah fitur baru benar-benar domain baru?
Modul baru boleh dibuat **hanya jika** semua kondisi ini terpenuhi:
1. Data yang disimpan punya struktur domain-spesifik yang **tidak bisa** direpresentasikan dengan kolom tambahan di tabel existing
2. Sudah ada keputusan arsitektur yang terdokumentasi di dokumen ini
3. Tabel baru mengikuti prefix naming standard (§5.4)
4. Ada plan untuk menautkan data baru ke `freight_shipments` jika relevan

### Pertanyaan 4: Apakah ini bukan modul duplicate yang sudah pernah dibuat?
Sebelum merge, cek:
```bash
grep -rn "pgTable" lib/db/src/schema/ | grep -i "<kata_kunci>"
grep -rn "router.use" artifacts/api-server/src/routes/index.ts | grep -i "<kata_kunci>"
grep -rn "Route path" artifacts/bizportal/src/routes.tsx | grep -i "<kata_kunci>"
```

---

## 8. Inventaris Lengkap: Tabel DB

### Tabel Aktif — Core Freight
| Tabel | Schema File | Keterangan |
|---|---|---|
| `freight_shipments` | `freightShipments.ts` | **Tabel utama** — semua pengiriman aktif |
| `freight_rfqs` | `freightShipments.ts` | RFQ per shipment |
| `freight_quotes` | `freightShipments.ts` | Quote vendor per RFQ |
| `freight_attachments` | `freightAttachments.ts` | Lampiran dokumen shipment |
| `freight_customs_docs` | `freightCustomsDocs.ts` | Dokumen bea cukai |
| `freight_shipment_audit_logs` | `freightAuditLog.ts` | Log perubahan per shipment |
| `shipment_stages` | `shipmentStages.ts` | Tahapan tracking |

### Tabel Aktif — Air Freight
| Tabel | Schema File | Keterangan |
|---|---|---|
| `air_freight_orders` | `airFreight.ts` | Order AF + field spesifik (AWB, airline) |
| `air_freight_dimensions` | `airFreight.ts` | Dimensi kargo per order |
| `air_freight_rfqs` | `airFreight.ts` | RFQ ke vendor AF |
| `air_freight_rate_submissions` | `airFreight.ts` | Penawaran vendor AF |
| `air_freight_tracking_events` | raw SQL (airFreight route) | Event tracking |

### Tabel Aktif — Ocean Freight
| Tabel | Schema File | Keterangan |
|---|---|---|
| `ocean_freight_orders` | `oceanFreight.ts` | Order OF + field spesifik |
| `ocean_freight_rfqs` | `oceanFreight.ts` | RFQ ke vendor OF |
| `ocean_freight_rate_submissions` | `oceanFreight.ts` | Penawaran vendor OF |
| `ocean_freight_rates` | `oceanFreight.ts` | Master rate per lane |

### Tabel Aktif — Trucking
| Tabel | Schema File | Keterangan |
|---|---|---|
| `trucking_booking_requests` | raw SQL (truckingBookings route) | Booking truk |
| `trucking_vehicle_rates` | raw SQL (truckingRates route) | Rate per kendaraan |
| `vendor_trucking_pricing` | `vendorTruckingPricing.ts` | Pricing vendor trucking |

### Tabel Aktif — Logistic Orders (Portal)
| Tabel | Schema File | Keterangan |
|---|---|---|
| `logistic_orders` | `logisticOrders.ts` | Order dari portal customer |
| `logistic_order_items` | `logisticOrders.ts` | Item per order |
| `logistic_order_rfqs` | `logisticOrders.ts` | RFQ admin per order |
| `logistic_order_quotes` | `logisticOrders.ts` | Quote vendor per RFQ |
| `vendor_offers` | `logisticOrders.ts` | Penawaran vendor (product-first) |
| `vendor_responses` | `logisticOrders.ts` | Respons vendor via form |
| `logistic_vendor_fulfillments` | `logisticVendorFulfillments.ts` | Penugasan vendor |

### Tabel Aktif — Driver
| Tabel | Schema File | Keterangan |
|---|---|---|
| `drivers` | `drivers.ts` | Master data driver |
| `driver_jobs` | `driverJobs.ts` | Penugasan job |
| `driver_job_logs` | `driverJobs.ts` | Log aktivitas per job |
| `driver_photos` | `driverJobs.ts` | Foto POD |
| `driver_locations` | `driverLocations.ts` | Histori GPS |

### Tabel Legacy / Deprecated
| Tabel | Status | Keterangan |
|---|---|---|
| `shipments` | ⛔ FROZEN | Tabel lama — hanya dibaca dashboard.ts untuk count. Ganti ke `freight_shipments`, lalu drop. |
| `rfq_vendor_links` | ⚠️ Cek ulang | Link antara RFQ dan vendor — monitor apakah masih aktif dipakai |
| `rfq_activity_logs` | ⚠️ Cek ulang | Log aktivitas RFQ — monitor apakah masih aktif dipakai |

---

## 9. Inventaris Lengkap: API Routes

### Prefix `/api/logistics/` — Core Freight (freightRouter)
```
GET    /api/logistics/freight-shipments
POST   /api/logistics/freight-shipments
POST   /api/logistics/freight-shipments/from-portal-order/:orderId
GET    /api/logistics/freight-shipments/:id
PUT    /api/logistics/freight-shipments/:id
POST   /api/logistics/freight-shipments/:shipmentId/rfqs
POST   /api/logistics/freight-shipments/:shipmentId/stages
GET    /api/logistics/freight-shipments/:id/profitability
POST   /api/logistics/freight-shipments/:shipmentId/attachments
POST   /api/logistics/freight-shipments/:shipmentId/customs-docs
GET    /api/logistics/freight-rfqs
GET    /api/logistics/freight-rfqs/:id
POST   /api/logistics/freight-rfqs/:rfqId/quotes
POST   /api/logistics/freight-quotes/:id/approve
```

### Prefix `/api/logistic/` — Portal Orders & Fulfillment
```
GET    /api/logistic/orders
POST   /api/logistic/orders
GET    /api/logistic/orders/:id
PATCH  /api/logistic/orders/:id
GET    /api/logistic/vendor-fulfillments/:id
POST   /api/logistic/vendor-fulfillments
PATCH  /api/logistic/vendor-fulfillments/:id/status
```
*Catatan: prefix `/api/logistic/` (tanpa 's') dipertahankan untuk backward compat dengan portal customer.*

### Prefix `/api/air-freight/`
```
GET    /api/air-freight/orders
POST   /api/air-freight/orders
GET    /api/air-freight/orders/:id
PATCH  /api/air-freight/orders/:id
GET    /api/air-freight/rates
POST   /api/air-freight/rates
```

### Prefix `/api/ocean-freight/`
```
GET    /api/ocean-freight/orders            ⚠️ LAMBAT — investigasi query
POST   /api/ocean-freight/orders
GET    /api/ocean-freight/orders/:id
PATCH  /api/ocean-freight/orders/:id/status
POST   /api/ocean-freight/orders/:id/blast-rfq
POST   /api/ocean-freight/orders/:id/final-quote
POST   /api/ocean-freight/orders/:id/confirm-booking
GET    /api/ocean-freight/rates
POST   /api/ocean-freight/rates
GET    /api/ocean-freight/options           (publik)
```

### Prefix `/api/trucking/`
```
GET    /api/trucking/bookings
POST   /api/trucking/bookings
```

### Prefix `/api/drivers/` (admin) dan `/api/driver/` (driver-facing)
```
GET    /api/drivers
POST   /api/drivers
GET    /api/drivers/:id
PUT    /api/drivers/:id
GET    /api/driver/jobs
POST   /api/driver/jobs/:id/status
```

---

## 10. Inventaris Lengkap: Halaman BizPortal

### Unified Freight
| Path | File | Keterangan |
|---|---|---|
| `/logistics` | `logistics.tsx` | Unified shipment list semua moda |
| `/logistics/freight` | `logistics-freight.tsx` | PPJK/Customs + filter moda |
| `/logistics/freight/new` | `logistics-freight-editor.tsx` | Form buat shipment baru |
| `/logistics/freight/:id` | `logistics-freight-detail.tsx` | Detail shipment |
| `/logistics/freight/:id/edit` | `logistics-freight-editor.tsx` | Edit shipment |
| `/logistics/freight/:id/bl` | `logistics-freight-bl.tsx` | Bill of Lading |

### Air Freight
| Path | File | Keterangan |
|---|---|---|
| `/air-freight/orders` | `air-freight/orders.tsx` | List order AF |
| `/air-freight/orders/:id` | `air-freight/order-detail.tsx` | Detail order AF |
| `/air-freight/rates` | `air-freight/rates.tsx` | Master rate AF |
| `/air-freight/approval/:token` | `air-freight/approval.tsx` | Form approval customer (publik) |
| `/air-freight/track/:orderNumber` | `air-freight/track.tsx` | Tracking publik AF |

### Ocean Freight
| Path | File | Keterangan |
|---|---|---|
| `/logistics/ocean-freight-orders` | `ocean-freight/orders.tsx` | List order OF |
| `/logistics/ocean-freight/:id` | `ocean-freight/order-detail.tsx` | Detail order OF |
| `/logistics/ocean-freight-rates` | `ocean-freight/rates.tsx` | Master rate OF |
| `/ocean-freight-master-data` | — | Admin master data OF |

### Portal Orders
| Path | File | Keterangan |
|---|---|---|
| `/logistics/portal-orders` | `logistics-portal-orders.tsx` | List order portal |
| `/logistics/portal-orders/:id` | `logistics-portal-order-detail.tsx` | Detail order portal |
| `/logistics/rfq` | `logistics-rfq-list.tsx` | List RFQ |
| `/logistics/rfq/:id/detail` | `logistics-rfq-detail.tsx` | Detail RFQ |
| `/logistics/rfq/:id/comparison` | `logistics-rfq-comparison.tsx` | Bandingkan quotes |
| `/logistics/vendor-fulfillments` | `logistics-vendor-fulfillments.tsx` | List fulfillment |
| `/logistics/vendor-fulfillments/:id` | `logistics-vendor-fulfillment-detail.tsx` | Detail fulfillment |

### Driver Management
| Path | File | Keterangan |
|---|---|---|
| `/logistics/drivers` | `logistics-drivers.tsx` | List & kelola driver |
| `/logistics/driver-performance` | `logistics-driver-performance.tsx` | Performa driver |
| `/logistics/drivers/analytics` | `logistics-drivers.tsx` (tab) | Analytics driver |

### Trucking
| Path | File | Keterangan |
|---|---|---|
| `/logistics/trucking-orders` | — | Daftar booking trucking |
| `/settings/trucking-rates` | — | Master rate kendaraan |
| `/settings/logistics-units` | — | Satuan muatan |

### Reporting & Intelligence
| Path | Keterangan |
|---|---|
| `/accounting/reports/freight-profitability` | Laporan profitabilitas freight |
| `/logistics/vendor-recommendation` | Rekomendasi vendor |
| `/logistics/vendor-commodity-intelligence` | Analisis vendor × komoditas |
| `/logistics/margin-rules` | Aturan margin otomatis |

---

## 11. Anomali & Hutang Teknis

### 11.1 Duplikasi Definisi Tabel (High Priority)
**Masalah:** `air_freight_orders`, `ocean_freight_orders`, dan tabel terkaitnya didefinisikan **dua kali**:
- Di `lib/db/src/schema/airFreight.ts` dan `lib/db/src/schema/oceanFreight.ts` (Drizzle schema) ✅
- Di dalam route file (`artifacts/api-server/src/routes/airFreight.ts` dan `oceanFreight.ts`) sebagai raw SQL boot migration ⚠️

**Risiko:** Divergensi schema, migration yang tidak sinkron.
**Rekomendasi:** Hapus `CREATE TABLE IF NOT EXISTS` dari route files — biarkan Drizzle yang mengelola schema.

### 11.2 `drizzle-kit push` Gagal Silent untuk Kolom Baru (Medium Priority)
**Masalah:** Saat kolom baru ditambahkan ke schema (termasuk kolom dengan tipe enum baru), `drizzle-kit push` melaporkan "Changes applied" tetapi kolom tidak selalu ter-apply ke DB.
**Workaround:** Setelah `drizzle-kit push`, **selalu verifikasi** via:
```bash
node -e "
const {Pool} = require('pg');
const p = new Pool({connectionString: process.env.SUPABASE_DATABASE_URL});
p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='<TABEL>' ORDER BY ordinal_position\").then(r=>{console.log(r.rows.map(x=>x.column_name)); p.end();});
"
```
Jika kolom tidak muncul, jalankan `ALTER TABLE` manual.

### 11.3 `GET /api/ocean-freight/orders` — Lambat (Medium Priority)
**Masalah:** Request sering timeout (>12s). DB query sendiri OK (<1s) tapi via API server lambat.
**Dugaan:** Deadlock connection pool, atau konflik dengan boot migration raw SQL yang mengambil lock.
**Rekomendasi:** Investigasi dan tambahkan timeout eksplisit + index pada `ocean_freight_orders.created_at`.

### 11.4 `GET /api/logistic/vendor-fulfillments` — 404 (Low Priority)
**Masalah:** Route list tidak ada — router hanya punya `/:id`, `POST /`, dan `PATCH /:id/status`.
**Rekomendasi:** Tambahkan `GET /` (list) ke `logisticVendorFulfillmentAdmin.ts`.

### 11.5 `shipments` table — Belum Di-drop (Low Priority)
**Status:** Sudah ada plan (`@deprecated` di schema file), tapi belum dieksekusi.
**Next step:** Update `dashboard.ts` count widget ke `freight_shipments`, kemudian drop tabel.

---

*Dokumen ini wajib di-update setiap kali ada modul logistik baru yang ditambahkan, diubah, atau dihapus.*
*Last updated: 2026-06-11 oleh FASE 9 governance pass.*
