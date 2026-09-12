# Customer Portal — Standard Operating Procedure

**Versi:** v1.0 | **Terakhir diperbarui:** 27 Mei 2026

---

## Overview

Customer Portal adalah antarmuka publik untuk customer CST Logistics. Customer dapat membuat order, melacak status pengiriman, menyetujui penawaran, dan mengunduh dokumen — semuanya dari browser tanpa perlu instal aplikasi.

**URL Portal:** `https://<domain>/` (atau sesuai konfigurasi)

---

## A. Cara Customer Membuat Order

### Langkah-langkah:
1. Buka Customer Portal
2. Klik **Book Now** atau navigasi ke **Book Shipment** / **Freight Booking**
3. Isi form order:
   - **Nama & Kontak**: Nama lengkap, email, nomor WhatsApp
   - **Jenis Service**: Pilih dari Trucking, Sea Freight, Air Freight, Custom Clearance, dll.
   - **Rute**: Origin dan destination
   - **Deskripsi Muatan**: Jenis barang, berat estimasi, dimensi
   - **Tanggal Requested**
   - **Catatan Tambahan** (opsional)
4. Klik **Submit Order**
5. Sistem kirim **konfirmasi via WhatsApp** ke nomor yang didaftarkan
6. Catat **Nomor Order** yang tampil (format: `CST/YYYY/NNNNNN`) — digunakan untuk tracking

### Catatan:
- Satu nomor email/WA dibatasi maksimal **10 order per jam** (rate limit sistem)
- Jika form gagal submit, tunggu 60 detik dan coba lagi
- Konfirmasi WA dikirim otomatis dalam beberapa menit setelah submit

---

## B. Upload Attachment saat Booking

Beberapa jenis order memerlukan dokumen pendukung:

1. Di form booking, cari section **Attachments** / **Upload Document**
2. Klik **+ Upload File** atau drag & drop
3. Tipe file yang didukung: PDF, JPG, PNG, DOC, DOCX (maks. 20MB per file)
4. File tersimpan permanen — tidak perlu upload ulang meski halaman di-refresh
5. Klik **Submit Order** setelah semua dokumen terupload

**Dokumen yang biasa diperlukan:**
- Packing list
- Commercial invoice
- Surat jalan / delivery order
- Foto muatan
- Dokumen kepabeanan (untuk Custom Clearance)

---

## C. Approve Quotation (Persetujuan Penawaran)

Ketika admin sudah menyiapkan penawaran harga, customer akan menerima **link approval via WhatsApp**.

### Langkah-langkah:
1. Buka link dari WA (format: `https://<domain>/q/<token>`)
2. Halaman menampilkan:
   - **Detail order** yang telah dibuat
   - **Rincian harga final** (termasuk semua komponen biaya)
   - **Estimasi waktu pengiriman**
3. Review semua informasi dengan seksama
4. Pilih salah satu aksi:

   **✅ Approve**
   - Klik **Approve Quote**
   - Konfirmasi di dialog yang muncul
   - Sales Order otomatis dibuat
   - Customer terima notifikasi WA konfirmasi

   **📝 Request Revision**
   - Klik **Request Revision**
   - Isi form: apa yang perlu direvisi (harga, rute, jadwal, dll.)
   - Submit — admin akan menerima notifikasi dan follow up

   **❌ Reject**
   - Klik **Reject**
   - Isi alasan penolakan (opsional)
   - Submit — admin akan dihubungi untuk diskusi lebih lanjut

### Penting:
- Link approval **hanya bisa digunakan sekali** setelah diapprove/rejected
- Harga yang ditampilkan sudah final — tidak ada biaya tersembunyi
- Jika link expired atau tidak bisa dibuka, hubungi admin untuk generate link baru

---

## D. Lihat Status Order

### Via Nomor Order:
1. Buka Customer Portal
2. Klik **Track Shipment** di menu atau homepage
3. Masukkan **Nomor Order** (format: `CST/YYYY/NNNNNN`)
4. Klik **Track**
5. Tampil:
   - Status terkini
   - Timeline progress (New → Review → Quoted → Approved → In Progress → Completed)
   - Update terakhir dari tim CST

### Status yang Ditampilkan:

| Status | Artinya |
|--------|---------|
| New Order | Order diterima, menunggu review admin |
| Under Review | Tim CST sedang proses |
| Quoted | Penawaran sudah dikirim ke customer |
| Approved | Customer sudah approve, order dikonfirmasi |
| In Progress | Pengiriman sedang berjalan |
| Completed | Pengiriman selesai |

### Via Login Customer Portal:
1. Login dengan akun customer
2. Buka menu **My Orders**
3. Semua order tampil dengan status terkini
4. Klik order untuk lihat detail lengkap dan timeline

---

## E. Download Dokumen

### Cara Download:
1. Di halaman detail order (login diperlukan) atau via link yang dikirim admin
2. Buka tab **Documents** / **Attachments**
3. Dokumen yang tersedia:
   - **Bill of Lading** (B/L)
   - **Sales Order / Invoice**
   - **Packing List**
   - **Proof of Delivery (POD)**
   - Dokumen lain yang diupload admin
4. Klik nama dokumen → terbuka di tab baru
5. Klik **Download** untuk simpan ke perangkat

### Catatan:
- Dokumen tersimpan permanen di cloud — bisa diakses kapanpun
- Jika dokumen belum tersedia, hubungi admin untuk request
- Beberapa dokumen hanya tersedia setelah pengiriman selesai (contoh: POD)

---

## F. Kalkulator Freight

Untuk estimasi biaya sebelum membuat order resmi:

1. Buka menu **Calculator** di Customer Portal
2. Isi:
   - Jenis service
   - Rute origin → destination
   - Berat dan dimensi muatan
3. Klik **Calculate**
4. Tampil estimasi harga berdasarkan rate terkini
5. Estimasi ini **tidak mengikat** — harga final ditentukan setelah proses quotation

---

## Troubleshooting

### Order tidak bisa disubmit
- Pastikan semua field wajib terisi (ditandai `*`)
- Cek koneksi internet
- Jika muncul error "Too many requests", tunggu 1 jam dan coba lagi
- Cek nomor WA valid (format Indonesia: 08xx atau 628xx)

### WA konfirmasi tidak diterima
- Cek folder spam/blocked di WA
- Pastikan nomor WA yang diisi saat order benar
- Tunggu maksimal 5 menit — jika tidak masuk, hubungi admin
- Simpan nomor order dari halaman sukses booking sebagai cadangan

### Link approval expired atau error
- Link approval berlaku selama 7 hari
- Jika expired, hubungi admin untuk generate link baru
- Jangan share link approval ke orang lain — bersifat personal

### Tidak bisa login ke Customer Portal
- Gunakan email yang sama saat register
- Klik **Forgot Password** untuk reset
- Jika masih gagal, hubungi admin untuk reset akun

### File tidak bisa diupload
- Pastikan ukuran file di bawah 20MB
- Format yang didukung: PDF, JPG, PNG, DOC, DOCX
- Coba compress file jika terlalu besar
- Gunakan browser terbaru (Chrome/Firefox terbaru direkomendasikan)

### Dokumen tidak bisa didownload
- Coba klik kanan → Save As
- Coba di browser lain
- Pastikan popup blocker tidak memblokir download
- Hubungi admin jika dokumen belum tersedia

---

## Kontak Support

Jika mengalami kendala yang tidak tertangani oleh panduan ini:
- **WhatsApp Admin**: Hubungi nomor admin CST Logistics
- **Email**: Kirim ke alamat email support yang tertera di portal
- **Jam Operasional**: Senin–Jumat, 08.00–17.00 WIB
