# Release Notes — BizPortal ERP v1.0

**Tanggal Rilis:** 27 Mei 2026
**Commit:** `6a6c394`
**Environment:** Production (Replit + Supabase PostgreSQL + Replit Object Storage)

---

## Ringkasan

Rilis pertama BizPortal ERP sebagai sistem manajemen operasional logistik terpadu. Mencakup seluruh siklus order — dari customer membuat order, proses RFQ ke vendor, persetujuan customer, hingga pembuatan Sales Order otomatis dan pencatatan akuntansi.

---

## Fitur Utama yang Selesai

### 1. Vendor Mini Form (VMF)
- Admin dapat membuat link form bertoken yang dikirim ke vendor via WhatsApp
- Dua mode: **Rate Collection** (kumpul harga pasar) dan **Order Confirmation** (vendor konfirmasi order spesifik)
- Vendor mengisi form tanpa login — hanya butuh link
- Support multi-service: Trucking, Sea Freight, Air Freight, Custom Clearance, Warehousing
- Vendor bisa lampirkan dokumen/foto sebagai attachment
- Admin review semua submission di BizPortal dan pilih vendor terbaik

### 2. Customer Approval Flow
- Admin generate link approval bertoken dari RFQ yang sudah ada submission-nya
- Customer melihat harga final (sudah include markup) tanpa melihat harga vendor asli
- Tiga pilihan: **Approve**, **Revise** (kirim catatan revisi), atau **Reject**
- Status approval disimpan di tabel `customer_approvals`
- Activity log dicatat setiap perubahan status

### 3. Sales Order Auto-Creation
- Ketika customer approve, sistem otomatis membuat record di `sales_documents` (kind=`order`)
- **Idempoten**: tidak membuat SO duplikat jika approval diproses ulang
- SO number format: `SO/YYYY/NNNNNN-XXXX` (dengan random suffix anti-duplikat)
- Integrasi akuntansi: otomatis posting jurnal Debit AR / Credit Revenue

### 4. Price Sync via SSE (Server-Sent Events)
- Real-time connection melalui `sseManager` untuk admin, driver, dan portal
- Tiga channel koneksi terpisah: `adminConnections`, `driverConnections`, `portalConnections`
- Heartbeat 30 detik untuk menjaga koneksi tetap hidup
- Frontend invalidate query otomatis saat menerima event (tanpa manual refresh)
- Event types: `new_logistic_order`, `order_update`, `price_sync`

### 5. WhatsApp Template System
- Template tersimpan di DB tabel `whatsapp_template_configs` per `(recipient, workflow)`
- Mendukung variable substitution: `{{customerName}}`, `{{orderNumber}}`, dll.
- Mendukung conditional block: `{{#if trucking}}...{{/if}}`
- Deduplication guard: notifikasi sama tidak dikirim ulang dalam 30 menit
- Gateway: Fonnte API
- Recipients: admin, customer, vendor
- Workflows: `order_new`, `quotation_send`, `vendor_form_sent`, `customer_approval_sent`, dll.

### 6. Attachment Persistence
- Upload file ke Replit Object Storage (bukan temp storage)
- Pemisahan bucket publik dan privat via environment variable
- Support tipe: POD (Proof of Delivery), foto unit, dokumen quote, lampiran korespondensi
- `UploadGuardSession`: cleanup otomatis file oversized (>100MB) setelah presigned URL expired
- Download/view via signed URL dengan ACL check

### 7. Order Lifecycle Management
Status alur order:
```
New Order → admin_review → rfq_blasted → customer_quoted
  → customer_approved → assigned_to_vendor → confirmed
  → in_progress → completed
```
- Setiap transisi status dicatat di `order_updates` dan `activity_logs`
- Public tracking endpoint (`/track/:orderNumber`) hanya tampilkan status — PII dan data finansial di-strip

### 8. Duplicate Prevention
- **Order publik**: Rate limiting berbasis IP (10 order/jam) + window check 60 detik untuk email yang sama
- **VMF submission**: Unique constraint `(link_id, supplier_id)` — satu vendor tidak bisa submit dua kali untuk link yang sama
- **SO creation**: Idempotency check via `logisticOrderId` sebelum insert

### 9. Timeline & Activity Logging
- `activity_logs`: log teknikal granular (actor, action, old value, new value)
- `order_updates`: history human-readable untuk tampilan timeline di UI
- Log notifikasi WA tersimpan — bisa dilihat kapan pesan terakhir dikirim

### 10. Vendor Etalase (Katalog)
- Setiap vendor punya katalog produk/jasa sendiri (`vendor_catalog_items`)
- Field: nama, deskripsi, unit, harga dasar, markup %, harga jual (computed)
- Dikelola via halaman detail vendor di BizPortal

### 11. Multi-channel Notifications
- WhatsApp via Fonnte (primary)
- Email via Nodemailer/SMTP (opsional, perlu konfigurasi)
- Web Push Notification via VAPID (customer/driver)
- In-app SSE real-time

### 12. Customer Portal CMS
- Konten halaman (homepage, services, products) dapat diedit admin via portal CMS
- Default hardcoded sebagai fallback jika DB kosong
- Mendukung i18n (EN/ID)

---

## Perbaikan Penting

- **Stabilisasi build**: `web-push` dipindah ke external dependencies esbuild — mencegah crash saat bundling
- **Session migration**: Tabel `sessions` dibuat otomatis saat startup
- **Company migration**: `company_id` ditambahkan ke semua tabel utama dengan index
- **Accounting migration**: Kolom due date, penomoran invoice/bill/payment
- **UOM migration**: Tabel unit of measure + seed default
- **Freight audit log**: Tabel audit log shipment ditambahkan
- **Custom roles**: Sistem role kustom dengan permission JSONB

---

## Security Improvements

- Token VMF dan customer approval menggunakan random high-entropy string (bukan sequential ID)
- SO number menggunakan random suffix 4 karakter untuk mencegah enumeration
- Public tracking endpoint strip semua PII dan data finansial sebelum response
- Auth middleware membedakan internal session (cookie) vs portal/mobile (bearer token)
- Rate limiting di semua public mutation endpoint
- `requireAdmin` mendukung custom roles JSONB — tidak perlu semua user jadi system admin

---

## Breaking Changes

Tidak ada breaking change untuk data existing. Semua migration bersifat additive (tambah kolom/tabel, tidak drop).

---

## Migrations yang Dijalankan (Auto saat Startup)

| Migration | Deskripsi |
|-----------|-----------|
| Pre-start schema | Schema awal |
| Sessions | Tabel session management |
| Companies | `company_id` di semua tabel + NOT NULL + index |
| Holding | Seed CST-GROUP company |
| Portal | Role column, portal_content, quote_requests, media_assets |
| Accounting | Invoice/bill/payment numbering, due date, reversal enum |
| OAuth state | Tabel oauth_states |
| Knowledge base | Tabel chatbot_knowledge_base |
| Custom roles | Sistem role kustom |
| UOM | Tabel & kolom unit of measure + seed |
| Freight audit log | Tabel audit log shipment |
| Audit fix | Critical/medium schema fixes |

---

## Fitur Deprecated

Tidak ada fitur yang di-deprecated di rilis ini.

---

## Known Limitations

Lihat `docs/DEVELOPER_MAINTENANCE_GUIDE.md` section "Known Limitations".
