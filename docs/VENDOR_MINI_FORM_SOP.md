# Vendor Mini Form — Standard Operating Procedure

**Versi:** v1.0 | **Terakhir diperbarui:** 27 Mei 2026

---

## Overview

Vendor Mini Form (VMF) adalah sistem pengumpulan harga/konfirmasi dari vendor menggunakan link bertoken yang dikirim via WhatsApp. Vendor **tidak perlu login** — cukup buka link dan isi form.

---

## Dua Mode VMF

| Mode | Kapan Digunakan | Hasil |
|------|-----------------|-------|
| **Rate Collection** | Ketika admin ingin kumpulkan harga pasar dari beberapa vendor untuk satu order | Vendor submit harga, admin pilih terbaik |
| **Order Confirmation** | Ketika vendor sudah dipilih dan perlu konfirmasi operasional | Vendor konfirmasi detail teknis (truck, vessel, dll.) |

---

## Flow Lengkap VMF

```
[Admin] Generate Link VMF
         ↓
[Sistem] Buat token unik di vendor_mini_form_links
         ↓
[Admin] Kirim WA ke vendor (otomatis atau manual)
         ↓
[Vendor] Buka link, isi form (tanpa login)
         ↓
[Sistem] Simpan submission di vendor_mini_form_submissions
         ↓
[Admin] Review semua submission di BizPortal
         ↓
    [Admin] Pilih vendor terbaik
         ↓
    [Sistem] Update status order → vendor_selected
         ↓
    (Lanjut ke Customer Approval Flow)
```

---

## Langkah 1: Generate Link VMF

**Di BizPortal:**
1. Buka order/shipment yang membutuhkan vendor quote
2. Navigasi ke tab **Vendor Quotes** atau **RFQ**
3. Klik **+ Create Vendor Form Link**
4. Isi form generate link:
   - **Vendor**: Pilih dari daftar supplier aktif
   - **Mode**: Rate Collection / Order Confirmation
   - **Service Type**: Trucking / Sea Freight / Air Freight / Custom Clearance / Warehousing / Other
   - **Notes** (opsional): Instruksi khusus untuk vendor
5. Klik **Generate Link**

**Link yang dibuat:**
```
https://<domain>/vendor-form/<token>
```
Token berupa random string high-entropy — tidak bisa di-guess.

---

## Langkah 2: Kirim WA ke Vendor

### Cara Otomatis
- Setelah generate, klik **Send via WhatsApp**
- Sistem kirim via Fonnte ke nomor WA vendor yang terdaftar
- Template WA otomatis diisi dengan nama vendor, jenis service, dan link pendek

### Cara Manual
- Klik **Copy Link** di halaman link VMF
- Kirim ke vendor via WA/email secara manual
- Atau klik **Copy WA Message** untuk copy pesan lengkap siap kirim

---

## Langkah 3: Vendor Mengisi Form

Vendor membuka link, melihat form yang berisi:
- **Service yang diminta** (sudah terisi dari admin)
- **Field harga**: Harga per unit, total estimasi
- **Field detail teknis** (tergantung service type):
  - Trucking: Jenis truk, plat, nama driver
  - Sea Freight: Nama vessel, ETD, ETA
  - Air Freight: Maskapai, flight number, ETD
- **Catatan tambahan**
- **Upload attachment**: Quotation dokumen, foto, dll.

**Aturan submission:**
- Satu vendor hanya bisa submit **satu kali** per link (dibatasi oleh constraint DB)
- Jika vendor perlu revisi setelah submit, admin harus trigger "Request Revision"

---

## Langkah 4: Admin Review Submission

1. Di BizPortal, buka tab **Vendor Submissions** pada order/RFQ
2. Tampil semua submission dengan:
   - Nama vendor
   - Harga yang diajukan
   - Detail teknis
   - Attachment (jika ada)
   - Waktu submit
3. Bandingkan penawaran antar vendor

---

## Langkah 5: Pilih Vendor

1. Klik **Select** pada submission terbaik
2. Sistem otomatis:
   - Update status order → `vendor_selected`
   - Catat di activity log
   - Siapkan data untuk Customer Approval
3. Vendor yang tidak dipilih statusnya berubah ke `rejected` (tidak ada notifikasi otomatis — admin bisa kirim WA manual)

---

## Langkah 6: Revisi Harga (Jika Diperlukan)

Jika harga vendor perlu direvisi sebelum dikirim ke customer:

1. Klik **Request Revision** pada submission vendor
2. Isi catatan revisi: apa yang perlu diubah
3. Klik **Send Revision Request**
4. Sistem kirim WA ke vendor dengan link form yang sama
5. Vendor bisa submit ulang — submission lama di-replace dengan yang baru
6. Admin review ulang

---

## Langkah 7: Konfirmasi Operasional (Mode Order Confirmation)

Setelah vendor dipilih dan customer approve:

1. Sistem atau admin generate link VMF mode **Order Confirmation**
2. Vendor konfirmasi detail operasional:
   - Konfirmasi ketersediaan
   - Detail teknis final (plat truk, nama driver, dll.)
   - Perkiraan waktu
3. Admin terima konfirmasi → update status ke `confirmed`

---

## Troubleshooting

### Vendor tidak bisa buka link
- Pastikan link dikirim lengkap (tidak terpotong di WA)
- Coba copy link dari BizPortal dan kirim ulang
- Cek apakah token masih valid (belum expired)
- Cek apakah link belum di-expired manual oleh admin

### Vendor tidak bisa submit (tombol submit tidak muncul)
- Vendor mungkin sudah pernah submit sebelumnya (constraint duplikat)
- Cek di BizPortal → Vendor Submissions apakah sudah ada submission dari vendor ini
- Jika perlu submit ulang, admin harus klik **Request Revision** terlebih dahulu

### Submission masuk tapi attachment tidak bisa dibuka
- Cek di BizPortal apakah file tersedia
- Kemungkinan upload gagal di tengah jalan — minta vendor upload ulang via Request Revision
- Cek kapasitas storage jika error konsisten

### WA tidak terkirim ke vendor
- Cek FONNTE_TOKEN masih valid di Replit Secrets
- Cek nomor WA vendor terdaftar di profil supplier
- Cek log WA di tab Timeline order
- Kirim link secara manual sebagai fallback

### Admin tidak bisa generate link
- Pastikan user memiliki role admin atau permission yang sesuai
- Pastikan vendor (supplier) sudah aktif di sistem
- Refresh halaman dan coba lagi

---

## Status VMF

| Status Link | Arti |
|-------------|------|
| `active` | Link bisa diakses dan diisi vendor |
| `submitted` | Vendor sudah submit |
| `selected` | Vendor ini dipilih admin |
| `rejected` | Vendor ini tidak dipilih |
| `expired` | Link sudah tidak bisa diakses |
