# Admin User Guide — BizPortal ERP

**Versi:** v1.0 | **Terakhir diperbarui:** 27 Mei 2026

Panduan ini ditujukan untuk admin internal yang mengelola operasional harian via BizPortal.

---

## Akses BizPortal

URL: `https://<domain>/bizportal/`
Login menggunakan akun yang sudah terdaftar di sistem. Gunakan Google OAuth atau email/password yang diberikan oleh IT.

---

## A. Product & Service Management

### Tambah Product Baru
1. Buka menu **Trading → Products**
2. Klik tombol **+ Add Product**
3. Isi: Nama, Kategori, Harga, Satuan (UOM), Deskripsi
4. Upload gambar produk (opsional)
5. Klik **Save**

### Tambah Jasa (Service)
1. Buka menu **Trading → Services**
2. Klik **+ Add Service**
3. Isi: Nama Jasa, Kategori, Harga Dasar, Satuan
4. Set status **Active**
5. Klik **Save**

### Update Harga
1. Buka daftar produk/jasa
2. Klik baris produk → **Edit**
3. Ubah field **Harga** atau **Harga Dasar**
4. Klik **Save** — harga baru aktif segera

### Nonaktifkan / Sembunyikan Item
1. Buka produk/jasa → **Edit**
2. Toggle **Active** menjadi OFF
3. Klik **Save** — item tidak akan muncul di portal customer

### Vendor Etalase (Katalog per Vendor)
1. Buka **Purchase → Vendors**
2. Klik icon toko (🏪) pada baris vendor
3. Di halaman Etalase, klik **+ Add Item**
4. Isi: Tipe (Product/Service), Nama, Harga Dasar, Markup %
5. **Harga Jual** dihitung otomatis = Harga Dasar × (1 + Markup%)

---

## B. Customer Order Flow

### Lihat Order Masuk
1. Buka menu **Logistics → Orders** (atau dashboard)
2. Order baru tampil dengan status **New Order**
3. Klik baris order untuk lihat detail: data customer, rute, service yang diminta, lampiran

### Approve / Review Order
1. Di halaman detail order, cek semua informasi
2. Klik **Move to Review** untuk ubah status ke `admin_review`
3. Tambahkan catatan internal jika diperlukan
4. Lanjutkan ke proses RFQ (lihat bagian C)

### Update Status Order
1. Di halaman detail order, klik dropdown **Status**
2. Pilih status baru sesuai progres operasional
3. Isi catatan update (opsional — akan muncul di timeline customer)
4. Klik **Update**

---

## C. Vendor Mini Form

### Generate Link VMF
1. Buka **Logistics → Shipments** → pilih order/shipment
2. Klik tab **Vendor Quotes** atau **RFQ**
3. Klik **+ Create Vendor Form Link**
4. Pilih:
   - **Vendor** (dari daftar supplier)
   - **Mode**: Rate Collection atau Order Confirmation
   - **Service Type**: Trucking / Sea Freight / Air Freight / dll.
5. Klik **Generate** — link bertoken dibuat

### Kirim WA ke Vendor
1. Setelah link dibuat, klik **Send via WhatsApp**
2. Sistem akan kirim template WA ke nomor vendor secara otomatis
3. Atau klik **Copy Link** dan kirim manual

### Lihat Submission Vendor
1. Di halaman order/RFQ, buka tab **Vendor Submissions**
2. Setiap submission tampil dengan: vendor name, harga yang diajukan, catatan, attachment
3. Status: `pending` → `submitted` → `selected` / `rejected`

### Pilih Vendor
1. Review semua submission yang masuk
2. Klik **Select** pada submission terbaik
3. Status order berubah ke `assigned_to_vendor`
4. Lanjutkan ke Customer Approval (lihat bagian D)

### Revisi Harga
Jika vendor perlu revisi:
1. Klik **Request Revision** pada submission
2. Isi catatan revisi
3. Sistem kirim WA ke vendor dengan link form yang sama
4. Vendor bisa submit ulang dengan harga baru

---

## D. Customer Approval

### Generate Approval Link
1. Setelah vendor dipilih, di halaman order klik **Generate Customer Quote**
2. Sistem hitung harga final (harga vendor + markup)
3. Link bertoken dibuat — customer **tidak melihat** harga vendor asli

### Kirim ke Customer
1. Klik **Send to Customer via WhatsApp** — sistem kirim otomatis
2. Atau klik **Copy Link** untuk kirim manual (email/WA)

### Monitor Approve / Reject
1. Buka tab **Customer Approval** di halaman order
2. Status: `pending` → `approved` / `revised` / `rejected`
3. Jika **Revised**: customer kirim catatan → baca dan tindak lanjuti
4. Jika **Approved**: SO dibuat otomatis (lihat bagian E)
5. Jika **Rejected**: buka diskusi ulang dengan customer

---

## E. Sales Order (SO)

### Cek SO yang Dibuat Otomatis
1. Buka **Sales → Documents**
2. Filter by Type = **Order**
3. SO dengan nomor `SO/YYYY/NNNNNN` sudah tercipta otomatis setelah customer approve

### Detail SO
- Klik nomor SO untuk lihat detail
- Tab **Items**: daftar service/product
- Tab **Accounting**: jurnal yang sudah diposting
- Tab **Attachments**: dokumen terkait

### Monitor Operational Flow
1. Gunakan **Logistics → Shipments** untuk tracking progres operasional
2. Update status secara berkala agar customer bisa tracking
3. Upload POD (Proof of Delivery) di tab **Attachments** saat selesai

---

## F. WhatsApp Template Settings

### Edit Template
1. Buka **Settings → WhatsApp Templates**
2. Pilih template berdasarkan **Recipient** (admin/customer/vendor) dan **Workflow**
3. Klik **Edit**
4. Ubah teks template

### Variable Usage
Gunakan double curly brace untuk variabel dinamis:
```
Halo {{customerName}},
Order Anda {{orderNumber}} sudah kami terima.
Estimasi: {{etaDate}}
```
Variabel tersedia tergantung workflow — lihat dokumentasi variable di halaman edit template.

### Conditional Block
Untuk menampilkan bagian teks hanya jika kondisi terpenuhi:
```
{{#if trucking}}
Detail trucking: {{truckType}} - {{truckPlate}}
{{/if}}
{{#if seaFreight}}
Vessel: {{vesselName}} - ETD {{etd}}
{{/if}}
```

### Preview Template
1. Setelah edit, klik **Preview**
2. Isi nilai sampel untuk variabel
3. Cek hasil render sebelum save
4. Klik **Save** jika sudah sesuai

---

## G. Attachment Handling

### Upload File
1. Di halaman order/shipment/SO, buka tab **Attachments**
2. Klik **Upload File** atau drag & drop
3. Pilih tipe: POD / Photo / Document / Quote / Other
4. File tersimpan permanen di cloud storage

### Lihat & Download Attachment
1. Di tab **Attachments**, klik nama file
2. File akan terbuka di tab baru (untuk image/PDF) atau auto-download
3. Klik icon **Download** untuk simpan lokal

### Catatan Storage
- File tersimpan di Replit Object Storage (persistent, tidak hilang saat restart)
- File privat: hanya bisa diakses dengan signed URL yang valid
- File publik (gambar produk, dll.): dapat diakses langsung via URL

---

## H. Timeline & Logs

### Cek Activity Log Order
1. Di halaman detail order, buka tab **Timeline** atau **Activity Log**
2. Tampil chronological: siapa, apa yang dilakukan, kapan
3. Log internal (teknikal) dan log publik (visible ke customer) dipisah

### Cek WA Log
1. Di tab Timeline, filter by **Type = WhatsApp**
2. Tampil: kapan WA dikirim, ke siapa, status (sent/failed)
3. Jika ada WA yang gagal, bisa retry manual dari halaman ini

### Cek Notification History
1. Buka **Settings → Notification Log** (jika tersedia)
2. Atau lihat di activity log per order
3. Sistem mencatat semua notifikasi — berguna untuk audit jika customer klaim tidak dapat notifikasi
