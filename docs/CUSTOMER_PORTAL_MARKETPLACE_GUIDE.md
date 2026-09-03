# Customer Portal — Panduan Marketplace

**Versi:** 1.0  
**Terakhir diperbarui:** 31 Agustus 2026  
**Bahasa:** Bahasa Indonesia

---

## 1. Tujuan dokumen

Dokumen ini menjelaskan proses **Customer Portal → Marketplace** dari awal sampai selesai:

1. mencari produk atau layanan vendor;
2. mengirim **Request for Quotation (RFQ)**;
3. menjalani persetujuan internal perusahaan bila diperlukan;
4. menerima dan meninjau quotation vendor;
5. menyetujui quotation sehingga **Purchase Order (PO)** dibuat;
6. memantau PO, pengiriman, timeline, dan penerimaan barang.

Panduan ini mengikuti perilaku aplikasi yang berjalan. Istilah “admin” di dalam dokumen berarti tim internal yang mengelola RFQ, vendor, quotation, PO, shipment, dan goods receipt melalui sistem internal.

> **Penting:** Marketplace saat ini menggunakan alur RFQ. Harga yang tampil di katalog adalah referensi harga jual publik bila tersedia, bukan jaminan harga final vendor. Harga dan ketentuan final mengikuti quotation yang dikirim untuk ditinjau customer.

---

## 2. Ringkasan alur end-to-end

```text
Customer membuka Marketplace
        │
        ▼
Cari / filter / bandingkan produk
        │
        ▼
Buka detail item → atur quantity dan kebutuhan
        │
        ▼
Kirim Request Quotation
        │
        ├─ Perlu approval internal?
        │       ├─ Ya: approver approve/reject
        │       └─ Tidak: RFQ langsung diproses
        │
        ▼
Admin mengelola RFQ dan mengundang vendor
        │
        ▼
Vendor mengirim quotation
        │
        ▼
Admin memilih quotation → kirim ke customer review
        │
        ├─ Customer menolak → kembali ke evaluasi quotation
        └─ Customer menyetujui → PO otomatis dibuat
                                  │
                                  ▼
                   Vendor menerima / memproses PO
                                  │
                                  ▼
                Shipment → tracking → delivery
                                  │
                                  ▼
                    Goods receipt → complete → close
```

### Hasil akhir yang diharapkan

- RFQ memiliki nomor referensi dan status yang dapat ditelusuri.
- Quotation vendor yang dipilih dapat direview customer.
- Persetujuan customer menghasilkan nomor PO.
- Customer dapat melihat status PO dan detail shipment.
- Penerimaan barang tercatat sebagai goods receipt ketika dibuat oleh admin.

---

## 3. Aktor dan tanggung jawab

| Aktor | Tanggung jawab utama |
|---|---|
| **Customer / Buyer** | Mencari item, mengirim RFQ, memantau RFQ, meninjau quotation, menyetujui atau menolak quotation, memantau PO. |
| **Guest buyer** | Mengirim RFQ dari katalog tanpa login dengan mengisi identitas dan kontak. Akses pemantauan berbasis akun belum tersedia untuk alur guest. |
| **Approver internal** | Memeriksa RFQ customer dari perusahaan yang sama, lalu approve atau reject dengan alasan bila menolak. |
| **Admin / Procurement** | Mengelola RFQ, menghubungi atau mengundang vendor, memeriksa quotation, memilih quotation, mengirim quotation ke customer review, serta mengelola PO dan shipment. |
| **Vendor** | Membuka link quotation, mengisi harga dan detail penawaran, menyimpan draft, lalu submit quotation. |
| **Penerima barang** | Memeriksa barang yang tiba dan memberikan informasi penerimaan kepada tim admin. Pencatatan goods receipt di portal buyer belum tersedia sebagai aksi mandiri. |

---

## 4. Prasyarat

### 4.1 Untuk melihat Marketplace

Tidak perlu login untuk:

- membuka halaman Marketplace;
- melihat katalog item yang sudah dipublikasikan;
- mencari dan memfilter item;
- membuka halaman detail item;
- melihat harga publik jika tersedia.

Katalog publik hanya menampilkan item vendor yang sudah dipublikasikan. Item draft atau item yang tidak lagi tersedia tidak ditampilkan.

### 4.2 Untuk mengirim RFQ sebagai guest

Guest perlu menyiapkan:

- nama buyer;
- nomor WhatsApp yang aktif;
- nama perusahaan, bila ingin mencantumkannya;
- email bila ada;
- tujuan atau alamat pengiriman;
- tanggal kebutuhan, bila sudah diketahui;
- catatan kebutuhan tambahan.

### 4.3 Untuk menggunakan fitur portal buyer

Login diperlukan untuk:

- membuka **My RFQs**;
- membuka detail RFQ milik sendiri;
- melihat quotation yang sudah dikirim ke customer review;
- menyetujui atau menolak quotation;
- melihat **My Purchase Orders**;
- membuka detail PO, shipment, timeline, dan goods receipt.

Data RFQ dan PO dibatasi berdasarkan customer session. Customer tidak dapat membuka RFQ atau PO milik customer lain hanya dengan mengganti ID pada URL.

### 4.4 Prasyarat akun perusahaan

Customer yang login dan bertindak sebagai perusahaan harus memiliki konteks organisasi yang valid. Sistem membaca perusahaan dari membership canonical, bukan dari nama perusahaan yang diketik di browser.

Status berikut memblokir pengiriman RFQ:

| Status konteks | Dampak | Tindakan |
|---|---|---|
| `legacy_unresolved` | Jenis akun belum ditentukan | Lengkapi pilihan akun Perorangan atau Perusahaan. |
| `company_unresolved` | Data perusahaan belum lengkap | Lengkapi informasi organisasi. |
| `company_pending` | Perusahaan masih menunggu verifikasi admin | Tunggu verifikasi admin. |
| `company_mapped` | Membership perusahaan valid | RFQ dapat dikirim. |
| `individual` | Akun perorangan valid | RFQ dapat dikirim tanpa konteks perusahaan. |

Jika panel RFQ menampilkan bahwa konteks customer sedang dimuat, tunggu sampai proses selesai. Jangan mengirim form sebelum konteks valid.

---

## 5. Membuka Marketplace dan mencari item

### 5.1 Membuka halaman

1. Buka Customer Portal.
2. Pilih **Marketplace** pada navigasi.
3. Halaman katalog menampilkan katalog vendor yang terverifikasi atau sudah dipublikasikan.

URL halaman utama:

```text
/marketplace
```

Detail item menggunakan pola:

```text
/marketplace/:id
```

### 5.2 Menelusuri katalog

Di halaman Marketplace, customer dapat:

- melihat statistik jumlah vendor, item, dan kategori;
- memilih kategori produk;
- mencari berdasarkan kata kunci;
- memfilter berdasarkan kategori, vendor, atau lokasi sesuai data yang tersedia;
- melihat perbandingan harga publik bila data harga tersedia;
- membandingkan maksimal empat item;
- membuka detail item;
- membagikan link detail item.

Kategori yang dapat muncul bergantung pada katalog yang dipublikasikan. Contoh kategori yang pernah tersedia:

- Coffee;
- Coal;
- Palm Oil;
- Seafood;
- Cashew;
- Rice;
- Furniture;
- Chemical;
- Textile.

Kategori bukan daftar tetap; admin dapat mempublikasikan jenis item lain.

### 5.3 Memahami kartu item

Kartu katalog dapat menampilkan:

- nama item;
- nama vendor;
- kategori atau jenis item;
- harga jual publik dan mata uang, bila tersedia;
- satuan;
- MOQ (*minimum order quantity*);
- status atau jumlah stok;
- lead time;
- lokasi atau asal;
- spesifikasi ringkas;
- tombol **Request Quotation**.

Jika harga tidak tersedia, item dapat diberi label harga negosiasi. Customer tetap dapat mengirim RFQ untuk meminta quotation.

---

## 6. Memeriksa detail item

Pada halaman detail, periksa hal-hal berikut sebelum mengirim RFQ:

### 6.1 Informasi item dan vendor

- nama produk atau layanan;
- deskripsi;
- vendor;
- lokasi vendor atau asal;
- harga publik jika ada;
- satuan;
- MOQ;
- jumlah stok atau status stok;
- lead time;
- masa berlaku penawaran publik (`valid until`);
- produk terkait atau produk serupa.

### 6.2 Spesifikasi

Spesifikasi ditampilkan sesuai jenis item. Untuk produk komoditas, contoh field yang dapat muncul adalah:

- komoditas;
- grade atau kualitas;
- asal;
- ukuran;
- kadar air;
- nilai kalori;
- sulfur;
- kadar abu;
- kemasan;
- sertifikasi.

Untuk layanan, contoh field yang dapat muncul adalah:

- jenis layanan;
- rute;
- port of loading;
- port of discharge;
- kapasitas;
- area layanan;
- estimasi waktu;
- maksimum muatan;
- moda angkutan;
- incoterm.

### 6.3 Media dan dokumen

Detail item dapat berisi:

- gambar;
- video yang diunggah;
- link video eksternal, termasuk YouTube;
- dokumen vendor yang dapat dibuka atau diunduh.

Pastikan dokumen dan spesifikasi cukup untuk menyusun kebutuhan RFQ. Jika belum cukup, tuliskan pertanyaan atau requirement tambahan pada kolom catatan.

---

## 7. Menghitung estimasi quantity dan harga

Panel kalkulator pada detail item membantu customer membuat estimasi awal.

### 7.1 Quantity dan satuan

1. Masukkan quantity.
2. Gunakan tombol `−` dan `+` atau input angka.
3. Quantity tidak boleh lebih kecil dari MOQ.
4. Pilih atau koreksi satuan bila field satuan tersedia.

Jika MOQ tidak diisi oleh vendor, sistem menampilkan bahwa MOQ dapat dinegosiasikan.

### 7.2 PPN

Bila harga publik tersedia, customer dapat mengaktifkan **Include PPN**. Perhitungan yang ditampilkan:

```text
Subtotal = harga publik × quantity
PPN      = subtotal × 11%
Total    = subtotal + PPN
```

Contoh:

```text
Harga       : Rp100.000 / unit
Quantity    : 10 unit
Subtotal    : Rp1.000.000
PPN 11%     : Rp110.000
Estimasi total: Rp1.110.000
```

Perhitungan ini adalah estimasi berbasis data katalog. Nilai final, pajak, ongkos kirim, payment terms, incoterm, dan komponen lain mengikuti quotation vendor yang dikirim untuk review.

### 7.3 Jika harga tidak tersedia

Panel menampilkan catatan bahwa harga perlu dikonfirmasi. Customer tetap dapat melanjutkan ke **Request Quotation** dan menjelaskan kebutuhan quantity serta requirement pada form.

---

## 8. Mengirim Request Quotation

### 8.1 Membuka form RFQ

1. Dari kartu katalog atau halaman detail, klik **Request Quotation**.
2. Periksa ringkasan item, vendor, quantity, satuan, dan estimasi total.
3. Isi form RFQ.
4. Klik tombol submit.

Endpoint aplikasi yang dipakai oleh halaman ini adalah:

```http
POST /api/portal/marketplace/:id/quote
```

Pengiriman dibatasi rate limit untuk mencegah submit berulang atau penyalahgunaan.

### 8.2 Field form RFQ

| Field | Wajib | Keterangan |
|---|---:|---|
| **Nama buyer** | Ya | Nama orang yang mengajukan permintaan. |
| **Nama perusahaan** | Guest: opsional | Hanya guest yang dapat mengirim nama perusahaan dari form. Untuk customer login, perusahaan diambil dari membership canonical. |
| **No. WhatsApp** | Ya | Digunakan sebagai kontak buyer. |
| **Email** | Tidak | Email kontak tambahan. Untuk customer login, email akun menjadi sumber utama bila tersedia. |
| **Quantity** | Ya | Mengikuti quantity dari kalkulator dan tidak boleh di bawah MOQ. |
| **Satuan** | Mengikuti item | Satuan item dapat digunakan atau disesuaikan sesuai kebutuhan. |
| **Tujuan / alamat pengiriman** | Opsional pada form | Dapat dipilih dari autocomplete lokasi. Bila lokasi dipilih, sistem dapat menyimpan place ID dan koordinat. |
| **Tanggal kebutuhan** | Tidak | Tanggal barang atau layanan dibutuhkan. |
| **Catatan** | Tidak | Requirement tambahan, spesifikasi, pertanyaan, atau konteks pembelian. |

### 8.3 Validasi nomor WhatsApp

Nomor dinormalisasi dengan menghapus spasi, tanda hubung, tanda kurung, dan titik. Format yang diterima:

- `08123456789`;
- `628123456789`;
- `+628123456789`.

Nomor harus menggunakan awalan seluler Indonesia `08` atau `62` yang diikuti angka operator yang valid. Jika format salah, perbaiki nomor sebelum submit.

### 8.4 Validasi tujuan pengiriman

Jika menggunakan pemilih lokasi, pilih hasil lokasi yang benar dan periksa kembali alamatnya. Sistem dapat menyimpan:

- alamat tujuan;
- Google Place ID;
- latitude;
- longitude.

Informasi ini membantu admin dan vendor menyiapkan quotation yang sesuai. Tujuan yang tidak akurat dapat menyebabkan quotation, ongkos kirim, atau lead time tidak sesuai.

### 8.5 Hasil submit

Jika berhasil:

- sistem menampilkan konfirmasi;
- nomor referensi ditampilkan pada dialog sukses;
- RFQ disimpan sebagai permintaan quotation;
- customer dapat menggunakan nomor tersebut saat berkomunikasi dengan admin.

Pada pipeline Marketplace baru, respons juga dapat memiliki `rfqId` dan `rfqNumber`. Sistem tetap mempertahankan nomor order legacy untuk kompatibilitas.

### 8.6 Perlindungan duplikasi

Retry submit yang sama dapat dikenali sebagai permintaan yang sama berdasarkan item, buyer, kontak, dan waktu. Sistem menggunakan kunci idempotensi bila dikirim oleh client; jika tidak, sistem membangun logical request key.

Karena itu:

- klik submit satu kali dan tunggu respons;
- jika halaman terasa lambat, jangan langsung klik berkali-kali;
- simpan nomor yang sudah ditampilkan;
- bila nomor sudah dibuat tetapi UI gagal menampilkan sukses, cek **My RFQs** atau hubungi admin sebelum membuat RFQ baru.

---

## 9. Melihat dan mengelola RFQ

### 9.1 Membuka My RFQs

Setelah login:

1. buka menu Marketplace;
2. pilih **My RFQs**, atau buka:

```text
/marketplace/my-rfqs
```

3. pilih RFQ untuk membuka detail:

```text
/marketplace/my-rfqs/:rfqId
```

Daftar menampilkan nomor RFQ, perusahaan, tanggal dibuat, tanggal kebutuhan, status RFQ, dan status approval bila ada.

### 9.2 Aksi customer pada RFQ

Customer dapat:

- membuka detail RFQ;
- submit draft RFQ;
- membatalkan RFQ yang masih `draft` atau `submitted`;
- meninjau quotation pada status `customer_review`;
- approve quotation dan membuat PO;
- reject quotation dengan alasan opsional.

RFQ yang sudah awarded atau dibatalkan tidak dapat dibatalkan lagi melalui portal buyer.

### 9.3 Status RFQ

| Status teknis | Label portal | Arti dan tindakan |
|---|---|---|
| `draft` | Draft | RFQ tersimpan sebagai draft. Customer dapat submit atau memperbaiki data bila aksi tersebut tersedia. |
| `submitted` | Diajukan | RFQ sudah dikirim dan siap diproses oleh admin/procurement. |
| `quoting` | Proses Penawaran | Admin sedang memproses kebutuhan atau menunggu quotation vendor. |
| `quoted` | Penawaran Masuk | Quotation tersedia atau proses pemilihan quotation sedang berlangsung. Customer belum selalu dapat menyetujui sampai quotation dikirim ke review. |
| `customer_review` | Menunggu Persetujuan Anda | Quotation terpilih sudah dikirim kepada customer. Customer perlu review lalu approve atau reject. |
| `awarded` | PO Dibuat | Customer menyetujui quotation dan PO berhasil dibuat. |
| `cancelled` | Dibatalkan | RFQ dihentikan dan tidak diproses lebih lanjut. |
| `expired` | Kedaluwarsa | RFQ atau item tidak lagi berlaku. Hubungi admin jika masih membutuhkan barang tersebut. |

### 9.4 Status approval internal

Status approval ditampilkan terpisah dari status RFQ:

| Status approval | Arti |
|---|---|
| `none` | RFQ tidak memerlukan approval internal atau sudah dapat diproses langsung. |
| `pending` | RFQ menunggu persetujuan approver perusahaan. |
| `approved` | Approver menyetujui RFQ; RFQ dapat masuk proses procurement. |
| `rejected` | Approver menolak RFQ. RFQ tetap dapat berada pada status draft agar buyer memperbaiki dan mengirim ulang. |

---

## 10. Approval internal perusahaan

Tahap ini hanya berlaku bila konfigurasi role atau approval level buyer mengharuskannya.

### 10.1 Langkah approver

1. Login dengan akun yang memiliki membership aktif pada perusahaan buyer.
2. Buka:

```text
/marketplace/pending-approvals
```

3. Periksa:
   - nomor RFQ;
   - nama buyer;
   - perusahaan;
   - departemen;
   - tanggal kebutuhan;
   - level approval;
   - catatan dan item yang diminta.
4. Pilih **Approve** bila kebutuhan dapat dilanjutkan.
5. Pilih **Reject** bila tidak dapat disetujui.
6. Jika reject, isi alasan penolakan. Alasan wajib diisi.

### 10.2 Dampak keputusan approver

**Approve:**

- record approval berubah menjadi approved;
- RFQ berpindah ke `submitted`;
- admin dapat melanjutkan pengelolaan RFQ.

**Reject:**

- record approval berubah menjadi rejected;
- RFQ tetap atau kembali ke `draft`;
- buyer dapat memperbaiki RFQ dan melakukan submit ulang;
- alasan penolakan disimpan sebagai catatan.

Approver yang valid adalah member aktif pada perusahaan yang sama dengan role yang diperbolehkan, yaitu role procurement, finance, atau admin.

### 10.3 Endpoint approval

Untuk integrasi internal, route utama yang tersedia:

```http
GET  /api/mkt/portal/rfqs/pending-approvals
POST /api/mkt/portal/rfqs/:id/submit-for-approval
POST /api/mkt/portal/rfqs/:id/approve
POST /api/mkt/portal/rfqs/:id/reject
```

Semua route tetap memeriksa autentikasi, ownership perusahaan, status RFQ, dan kelayakan approver di server.

---

## 11. Proses admin dan procurement

Tahap ini dilakukan oleh tim internal, bukan oleh customer.

### 11.1 Memeriksa RFQ

Admin memeriksa:

- identitas buyer dan perusahaan;
- item dan vendor asal;
- quantity dan satuan;
- tujuan pengiriman;
- tanggal kebutuhan;
- catatan dan spesifikasi;
- status approval;
- apakah item masih aktif dan belum kedaluwarsa.

### 11.2 Mengundang vendor

Admin dapat mengirim permintaan quotation kepada satu atau beberapa vendor yang sesuai. Vendor menerima link quotation berbasis token.

Admin perlu memastikan vendor menerima konteks berikut:

- item yang diminta;
- quantity;
- tujuan pengiriman;
- tanggal kebutuhan;
- spesifikasi;
- catatan tambahan.

### 11.3 Memilih quotation

Setelah quotation vendor masuk, admin membandingkan:

- harga satuan dan total;
- quantity yang sanggup dipenuhi;
- currency;
- stok;
- lead time;
- masa berlaku quotation;
- payment terms;
- incoterm;
- catatan vendor;
- apakah quotation hanya sebagian (*partial quote*).

Admin menetapkan quotation terpilih melalui proses internal. Quotation yang dipilih belum otomatis menjadi PO sebelum customer menyetujuinya.

### 11.4 Mengirim ke customer review

Setelah `proposed_quote_id` tersedia dan RFQ berada pada `quoted`, admin mengirim RFQ ke customer review.

Endpoint internal:

```http
POST /api/mkt/portal/rfqs/:id/select-vendor
POST /api/mkt/portal/rfqs/:id/send-to-customer-review
```

Dampaknya:

- RFQ berubah ke `customer_review`;
- customer mendapat notifikasi bila kanal notifikasi tersedia;
- quotation aman untuk buyer ditampilkan pada detail RFQ;
- customer dapat memilih approve atau reject.

Mengirim RFQ ke customer review tidak dapat dilakukan bila belum ada quotation yang dipilih. Operasi juga dilindungi transisi atomik agar RFQ yang sudah awarded, cancelled, atau customer review tidak diproses ulang.

---

## 12. Proses vendor quotation

Vendor menggunakan link token quotation yang diberikan oleh admin. Vendor tidak perlu memiliki akses ke detail internal customer yang tidak relevan.

### 12.1 Status quotation vendor

| Status teknis | Label | Arti |
|---|---|---|
| `invited` | Undangan Terkirim | Link quotation dibuat dan dikirim ke vendor. |
| `opened` | Link Dibuka | Vendor sudah membuka link. |
| `submitted` | Penawaran Terkirim | Vendor sudah mengirim quotation. |
| `selected` | Dipilih | Quotation dipilih admin untuk dipertimbangkan customer. |
| `rejected` | Tidak Dipilih | Quotation tidak dipilih. |
| `expired` | Kedaluwarsa | Quotation sudah melewati masa berlaku. |
| `withdrawn` | Ditarik | Vendor menarik kembali quotation. |
| `requote_requested` | Revisi Diminta | Admin meminta vendor memperbaiki atau mengirim ulang quotation. |

### 12.2 Field yang diisi vendor

Vendor dapat mengisi atau mengubah:

- harga satuan;
- quantity yang dapat ditawarkan;
- catatan per baris;
- lead time;
- status stok;
- currency yang diperbolehkan;
- catatan quotation;
- payment terms;
- informasi lain yang diminta pada form quotation.

Vendor dapat menyimpan draft terlebih dahulu, lalu submit setelah semua baris benar.

Endpoint quotation vendor:

```http
GET  /api/vendor-quote/:token
POST /api/vendor-quote/:token/save
POST /api/vendor-quote/:token/submit
```

Link token yang invalid atau kedaluwarsa menampilkan halaman error. Vendor harus meminta link baru kepada tim pengadaan; jangan mencoba menebak atau memodifikasi token.

---

## 13. Review quotation oleh customer

Customer mendapat status `customer_review` setelah admin menetapkan quotation dan mengirimkannya untuk ditinjau.

### 13.1 Membuka quotation

1. Buka **My RFQs**.
2. Pilih RFQ dengan label **Menunggu Persetujuan Anda**.
3. Periksa detail quotation vendor.

Detail yang dapat ditampilkan:

- nomor quotation;
- vendor;
- item dan quantity yang ditawarkan;
- harga satuan;
- subtotal per baris;
- total quotation;
- currency;
- stok;
- lead time;
- payment terms;
- incoterm;
- lokasi pengiriman;
- catatan vendor;
- tanggal submit quotation.

### 13.2 Checklist review

Sebelum approve, pastikan:

- vendor yang dipilih benar;
- quantity cukup;
- satuan benar;
- harga dan currency sesuai;
- lead time sesuai tanggal kebutuhan;
- tujuan pengiriman benar;
- payment terms dapat diterima;
- incoterm dipahami;
- quotation masih berlaku;
- catatan dan batasan vendor sudah dipahami.

### 13.3 Approve dan membuat PO

1. Klik **Setujui & Buat PO**.
2. Periksa konfirmasi.
3. Konfirmasi persetujuan.

Endpoint:

```http
POST /api/mkt/portal/rfqs/:id/customer-approve
```

Jika berhasil:

- quotation menjadi dasar award;
- RFQ berubah ke `awarded`;
- PO dibuat secara otomatis;
- sistem mengembalikan nomor PO;
- customer dapat membuka PO dari **My Purchase Orders**.

Approval customer adalah keputusan bisnis. Periksa seluruh nilai sebelum mengonfirmasi.

### 13.4 Menolak quotation

1. Klik **Tolak**.
2. Masukkan alasan bila diperlukan.
3. Konfirmasi penolakan.

Endpoint:

```http
POST /api/mkt/portal/rfqs/:id/customer-reject
```

Dampaknya:

- quotation ditolak pada tahap customer review;
- RFQ kembali ke `quoted`;
- admin dapat mengevaluasi ulang quotation atau meminta alternatif;
- RFQ tidak langsung menjadi cancelled.

Penolakan customer tidak otomatis membuat PO dan tidak otomatis mengakhiri RFQ.

---

## 14. Purchase Order

### 14.1 Membuka daftar PO

Setelah PO dibuat:

1. buka **My Purchase Orders**;
2. atau buka:

```text
/marketplace/my-purchase-orders
```

Daftar dapat difilter berdasarkan:

- pencarian nomor PO;
- nomor RFQ;
- nama vendor;
- status PO;
- vendor;
- rentang 7, 30, atau 90 hari.

### 14.2 Membuka detail PO

Klik PO pada daftar untuk membuka:

```text
/marketplace/my-purchase-orders/:poId
```

Tab yang tersedia:

| Tab | Isi |
|---|---|
| **Overview** | Ringkasan PO, buyer, vendor, RFQ, quotation, payment terms, incoterm, currency, lead time, pajak, dan total. |
| **Items** | Daftar item, quantity, satuan, harga, dan subtotal. |
| **Shipment** | Shipment, status pengiriman, nomor tracking, dan informasi carrier bila tersedia. |
| **Goods Receipt** | Goods receipt yang sudah dicatat admin. |
| **Timeline** | Urutan kejadian shipment atau PO. |
| **Activity Log** | Aktivitas sistem yang tersedia untuk PO. Ketersediaan lengkap pada sisi buyer masih terbatas. |

### 14.3 Status PO

| Status teknis | Label portal | Arti |
|---|---|---|
| `pending` | Pending | PO menunggu proses berikutnya. |
| `draft` | Draft | PO masih disiapkan dan belum diterbitkan. |
| `issued` | Diterbitkan | PO sudah diterbitkan kepada vendor. |
| `vendor_accepted` | Diterima Vendor | Vendor menerima PO. |
| `vendor_rejected` | Ditolak Vendor | Vendor menolak PO. |
| `revision_requested` | Revisi Diminta | Ada permintaan revisi terhadap PO. |
| `production` | Produksi | Vendor memproduksi atau menyiapkan barang. |
| `ready_to_ship` | Siap Kirim | Barang siap diserahkan untuk pengiriman. |
| `in_transit` | Dalam Pengiriman | Barang sedang dalam perjalanan. |
| `delivered` | Terkirim | Pengiriman tercatat sudah diterima atau sampai. |
| `partially_delivered` | Terkirim Sebagian | Sebagian quantity sudah diterima, sebagian masih outstanding. |
| `completed` | Selesai | Pemenuhan PO selesai secara operasional. |
| `closed` | Ditutup | Siklus PO ditutup secara administratif. |
| `cancelled` | Dibatalkan | PO dibatalkan. |
| `rejected_goods` | Barang Ditolak | Barang ditolak pada proses pemeriksaan/penerimaan. |

### 14.4 Transisi operasional yang umum

Alur normal biasanya bergerak sebagai berikut:

```text
issued
  → vendor_accepted
  → production
  → ready_to_ship
  → in_transit
  → delivered / partially_delivered
  → completed
  → closed
```

Alur dapat bercabang jika:

- vendor menolak PO;
- vendor meminta revisi;
- pengiriman hanya sebagian;
- barang ditolak.

Status final tidak boleh diasumsikan hanya dari tanggal pengiriman. Gunakan status dan timeline pada detail PO.

---

## 15. Shipment dan tracking

Pada tab **Shipment**, customer dapat melihat shipment yang terkait dengan PO, bila sudah dibuat admin.

Status shipment yang dapat muncul:

| Status | Arti |
|---|---|
| `planned` | Shipment direncanakan. |
| `packing` | Barang sedang dipacking. |
| `loading` | Barang sedang dimuat. |
| `ready_to_ship` | Barang siap dikirim. |
| `in_transit` | Barang sedang dalam perjalanan. |
| `customs` | Barang sedang dalam proses bea cukai. |
| `warehouse` | Barang berada di gudang. |
| `arrived` | Barang sudah tiba di lokasi tujuan. |
| `delivered` | Barang tercatat terkirim. |
| `cancelled` | Shipment dibatalkan. |

Pada timeline, customer dapat melihat event, waktu, status, dan keterangan yang tersedia. Nomor tracking atau carrier dapat ditampilkan bila admin telah mengisinya.

---

## 16. Goods receipt dan penerimaan barang

### 16.1 Yang dapat dilihat customer

Customer dapat melihat goods receipt yang sudah tersedia pada tab **Goods Receipt**, termasuk:

- nomor receipt;
- shipment terkait;
- tipe penerimaan;
- status inspeksi;
- penerima;
- waktu penerimaan;
- catatan.

Tipe penerimaan yang dapat muncul:

| Tipe | Arti |
|---|---|
| `full` | Barang diterima penuh. |
| `partial` | Barang diterima sebagian. |
| `rejected` | Barang ditolak. |

### 16.2 Batasan saat ini

**Portal buyer belum menyediakan endpoint atau tombol untuk membuat goods receipt secara mandiri.** Record goods receipt saat ini dibuat oleh admin melalui alur internal.

Karena itu, penerima barang perlu:

1. memeriksa quantity, kondisi, dan dokumen barang;
2. menyampaikan hasil penerimaan kepada tim admin;
3. memberikan catatan kerusakan, kekurangan, atau penolakan;
4. meminta admin mencatat goods receipt dengan tipe yang benar;
5. memeriksa kembali tab Goods Receipt setelah data tersedia.

Jangan menganggap PO sudah completed hanya karena barang tiba secara fisik. Pastikan goods receipt dan status PO sudah diperbarui.

---

## 17. Activity log

Sistem mencatat aktivitas penting, seperti:

- RFQ dibuat;
- RFQ diajukan untuk approval;
- RFQ disetujui atau ditolak approver;
- quotation vendor dikirim;
- vendor dipilih;
- quotation dikirim ke customer review;
- customer approve atau reject;
- PO dibuat;
- PO diterbitkan;
- vendor menerima PO;
- shipment dibuat;
- goods receipt dibuat;
- PO ditutup.

### Batasan saat ini

**Activity Log pada portal buyer belum sepenuhnya tersedia sebagai backend capability yang lengkap.** Jika suatu aktivitas tidak muncul di tab Activity Log, gunakan status dan timeline PO sebagai sumber utama tampilan operasional, lalu minta admin memeriksa log internal bila diperlukan.

---

## 18. Endpoint teknis

Bagian ini ditujukan untuk tim teknis, QA, dan integrator internal. Semua endpoint portal buyer menggunakan autentikasi dan pemeriksaan ownership di server.

### 18.1 Katalog publik dan RFQ awal

```http
GET  /api/portal/marketplace/stats
GET  /api/portal/marketplace
GET  /api/portal/marketplace/featured
GET  /api/portal/marketplace/hero-tiles
GET  /api/portal/marketplace/:id
POST /api/portal/marketplace/:id/quote
```

Catatan:

- endpoint katalog publik tidak mengekspos `priceBase`;
- hanya item yang dipublikasikan yang dikembalikan;
- detail item yang tidak ada atau belum dipublikasikan mengembalikan error;
- endpoint `POST /order` legacy masih ada untuk kompatibilitas, tetapi frontend Marketplace saat ini menggunakan `/quote`, bukan direct order.

### 18.2 Portal RFQ buyer dan approval

Base path:

```text
/api/mkt/portal
```

Endpoint:

```http
GET  /rfqs
GET  /rfqs/:id
GET  /rfqs/:id/lines
GET  /rfqs/:id/quotation
GET  /rfqs/:id/quotes
GET  /rfqs/:id/purchase-order

POST /rfqs/:id/submit
POST /rfqs/:id/cancel
POST /rfqs/:id/submit-for-approval
POST /rfqs/:id/approve
POST /rfqs/:id/reject
POST /rfqs/:id/customer-approve
POST /rfqs/:id/customer-reject
POST /rfqs/:id/select-vendor
POST /rfqs/:id/send-to-customer-review
```

### 18.3 Portal PO, shipment, dan goods receipt

```http
GET /purchase-orders
GET /purchase-orders/:id
GET /purchase-orders/:id/items
GET /purchase-orders/:id/shipments
GET /shipments/:shipmentId/timeline
GET /shipments/:shipmentId/goods-receipts
```

Endpoint baca goods receipt tersedia untuk customer. Endpoint pembuatan goods receipt dari portal buyer belum tersedia.

### 18.4 Konteks organisasi

Saat membuka form RFQ sebagai customer login, frontend memeriksa:

```http
GET /api/portal/organization
```

Server tetap melakukan validasi ulang ketika RFQ disubmit. Data perusahaan yang dikirim browser tidak boleh digunakan untuk menggantikan membership canonical.

### 18.5 Kontrak respons dan error penting

| HTTP | Kondisi umum |
|---:|---|
| `400` | ID tidak valid, field wajib kosong, nomor telepon invalid, atau body tidak valid. |
| `401` | Belum login atau session tidak lagi valid; frontend mengarahkan ke login. |
| `404` | Item, RFQ, PO, shipment, atau link quotation tidak ditemukan. |
| `409` | Konflik status, duplicate/operasi sudah dilakukan, atau transisi tidak lagi valid. |
| `422` | Konteks perusahaan belum selesai, status belum memenuhi prasyarat, atau validasi bisnis gagal. |
| `500` | Kesalahan server atau dependency; periksa log API server. |

---

## 19. Troubleshooting customer

### 19.1 Marketplace kosong

Periksa:

- koneksi internet;
- filter kategori/vendor/lokasi yang sedang aktif;
- kata kunci pencarian;
- apakah item masih dipublikasikan;
- apakah endpoint katalog mengembalikan error.

Hapus filter dan muat ulang. Jika item tertentu tetap tidak ada, kemungkinan item belum dipublikasikan, sudah kedaluwarsa, atau sudah ditarik vendor.

### 19.2 Detail item tidak ditemukan

Kemungkinan penyebab:

- ID item tidak valid;
- item sudah tidak dipublikasikan;
- item sudah kedaluwarsa;
- link lama digunakan.

Kembali ke `/marketplace` dan cari item dari katalog terbaru.

### 19.3 Tidak bisa mengirim RFQ karena konteks perusahaan

Ikuti pesan pada panel konteks customer:

- selesaikan pilihan jenis akun;
- lengkapi informasi perusahaan;
- tunggu verifikasi admin bila status pending;
- muat ulang halaman setelah perubahan selesai.

Jangan mencoba mengganti nama perusahaan pada form guest saat sudah login. Sistem akan memakai membership canonical.

### 19.4 Nomor WhatsApp ditolak

Gunakan format seluler Indonesia, misalnya:

```text
08123456789
628123456789
+628123456789
```

Hindari huruf, ekstensi, nomor kantor tanpa format seluler, atau nomor dengan kode negara yang salah.

### 19.5 Submit gagal atau muncul “terlalu banyak permintaan”

Lakukan langkah berikut:

1. jangan klik submit berulang kali;
2. catat pesan error;
3. tunggu sampai rate limit berakhir;
4. periksa **My RFQs** untuk memastikan RFQ belum berhasil dibuat;
5. gunakan nomor RFQ/order yang sudah muncul bila ada;
6. hubungi admin jika terjadi debit atau record ganda yang dicurigai.

Sistem memiliki perlindungan idempotensi, tetapi client tetap harus memperlakukan submit sebagai operasi satu kali.

### 19.6 RFQ tidak muncul di My RFQs

Kemungkinan penyebab:

- RFQ dikirim sebagai guest;
- login menggunakan akun yang berbeda;
- session sudah kedaluwarsa;
- RFQ belum berhasil disimpan;
- terjadi gangguan saat sinkronisasi pipeline.

Login dengan akun yang sama, muat ulang, dan cari berdasarkan nomor referensi. Guest perlu memberikan nomor RFQ/order kepada admin untuk ditelusuri.

### 19.7 Tidak bisa approve quotation

Periksa:

- status RFQ harus `customer_review`;
- quotation sudah tersedia;
- customer masih menjadi owner RFQ;
- session belum expired;
- RFQ belum lebih dulu diapprove oleh proses lain.

Jika status sudah `awarded`, PO biasanya sudah dibuat. Buka My Purchase Orders untuk memeriksa nomor PO.

### 19.8 Quotation ditolak tetapi status tidak cancelled

Itu adalah perilaku yang diharapkan. Penolakan customer mengembalikan RFQ ke `quoted` agar admin dapat mengevaluasi quotation lain atau meminta penawaran baru.

### 19.9 PO belum muncul setelah approve

1. tunggu notifikasi sukses dari halaman RFQ;
2. simpan nomor PO bila ditampilkan;
3. buka My Purchase Orders dan refresh;
4. periksa kembali detail RFQ;
5. jika RFQ `awarded` tetapi PO tidak terlihat, hubungi admin dengan nomor RFQ.

### 19.10 Shipment atau goods receipt kosong

Data tersebut baru muncul setelah admin membuat shipment atau goods receipt. Customer tidak dapat membuat goods receipt dari portal buyer saat ini.

### 19.11 Activity Log tidak lengkap

Activity Log buyer masih merupakan capability yang terbatas. Gunakan status PO, tab Timeline, nomor shipment, dan konfirmasi admin sebagai sumber verifikasi operasional.

### 19.12 Harga katalog berbeda dari quotation

Harga katalog adalah harga jual publik atau estimasi awal. Quotation dapat berbeda karena:

- quantity;
- MOQ;
- stok aktual;
- tujuan pengiriman;
- lead time;
- currency;
- payment terms;
- incoterm;
- biaya logistik atau komponen lain.

Gunakan quotation final sebagai dasar keputusan approve.

---

## 20. Batasan dan hal yang belum tersedia

1. **Direct order bukan alur utama Marketplace.** Frontend Marketplace menggunakan RFQ; endpoint direct order lama masih dipertahankan untuk kompatibilitas.
2. **Guest tidak memiliki daftar RFQ berbasis akun.** Guest menerima nomor referensi saat submit, tetapi fitur My RFQs membutuhkan login dan ownership session.
3. **Harga publik tidak selalu tersedia.** Item dengan harga nego tetap dapat dimintakan quotation.
4. **Harga dasar vendor tidak ditampilkan ke customer.** Katalog publik hanya mengekspos harga jual publik yang diizinkan.
5. **Goods receipt creation belum tersedia di portal buyer.** Admin harus membuat record goods receipt.
6. **Activity Log buyer belum lengkap.** Tidak semua aktivitas dijamin tampil di tab Activity Log.
7. **Notifikasi bergantung pada layanan notifikasi.** Transisi data utama tidak boleh dianggap gagal hanya karena notifikasi terlambat; cek status di portal.
8. **Filter PO saat ini beroperasi pada data yang dimuat portal.** Jika jumlah data sangat besar atau membutuhkan pencarian historis lengkap, admin perlu memakai modul internal.
9. **Perusahaan customer login ditentukan dari membership canonical.** Nama perusahaan yang diketik pada browser tidak dapat menggantikan konteks organisasi.
10. **RFQ yang sama tidak boleh dibuat berulang hanya karena UI lambat.** Periksa nomor referensi dan daftar RFQ terlebih dahulu.

---

## 21. Checklist operasional

### Checklist customer sebelum submit RFQ

- [ ] Item dan vendor sudah benar.
- [ ] Quantity tidak lebih kecil dari MOQ.
- [ ] Satuan sudah benar.
- [ ] Nomor WhatsApp aktif dan valid.
- [ ] Email sudah benar bila diisi.
- [ ] Tujuan pengiriman sudah benar.
- [ ] Tanggal kebutuhan sudah benar.
- [ ] Spesifikasi dan catatan tambahan sudah lengkap.
- [ ] Estimasi harga dipahami sebagai estimasi, bukan harga final.
- [ ] Jika login sebagai perusahaan, konteks perusahaan sudah valid.

### Checklist approver

- [ ] RFQ milik perusahaan yang sama.
- [ ] Buyer dan departemen dapat diverifikasi.
- [ ] Quantity, tanggal kebutuhan, dan tujuan masuk akal.
- [ ] Budget atau approval level sesuai kebijakan perusahaan.
- [ ] Alasan penolakan diisi dengan jelas bila reject.

### Checklist admin/procurement

- [ ] Approval internal sudah selesai bila diperlukan.
- [ ] Vendor yang relevan sudah diundang.
- [ ] Quotation vendor dibandingkan secara apple-to-apple.
- [ ] Masa berlaku quotation masih aktif.
- [ ] Quotation yang dipilih memiliki data harga, quantity, lead time, dan terms yang cukup.
- [ ] Quotation sudah dikirim ke customer review.
- [ ] PO hanya diterbitkan setelah customer approve pada pipeline yang berlaku.
- [ ] Shipment dan tracking diperbarui.
- [ ] Goods receipt dibuat berdasarkan hasil pemeriksaan penerima.
- [ ] PO ditutup hanya setelah pemenuhan selesai.

### Checklist penerima barang

- [ ] Nomor PO dan shipment cocok.
- [ ] Quantity diterima sudah dihitung.
- [ ] Kondisi dan spesifikasi barang sudah diperiksa.
- [ ] Kekurangan atau kerusakan dicatat.
- [ ] Status full, partial, atau rejected ditentukan.
- [ ] Hasil pemeriksaan disampaikan ke admin untuk pencatatan goods receipt.
- [ ] Status PO diperiksa kembali setelah pencatatan.

---

## 22. Arsitektur dan penyimpanan data Marketplace

Bab ini menjelaskan lokasi penyimpanan data dan hubungan antar-record. Ini
melengkapi penjelasan operasional pada bab sebelumnya: halaman Customer Portal
adalah antarmuka, sedangkan sumber kebenaran proses Marketplace berada di
database PostgreSQL runtime dan layanan API.

### 22.1 Prinsip penyimpanan

Marketplace menggunakan beberapa lapisan penyimpanan berikut:

1. **Database relasional runtime** menyimpan identitas, status, angka
   kuantitas/harga, relasi, snapshot histori, token metadata, dan audit trail.
2. **Supabase Storage/Object Storage privat** menyimpan bytes dokumen atau
   gambar. Database hanya menyimpan path, reference, nama file, metadata, atau
   signed/public URL yang diperlukan untuk menampilkan berkas.
3. **API server** menjadi boundary untuk validasi, ownership, perhitungan,
   transaksi database, signed access ke berkas privat, dan penyaringan field
   internal. Browser tidak boleh menulis langsung ke tabel Marketplace.
4. **Notification queue** menerima event setelah perubahan data utama berhasil.
   Kegagalan notifikasi tidak membatalkan transaksi data utama.

Database dev dan production adalah runtime yang berbeda. Karena itu, record
yang terlihat di preview tidak otomatis sama dengan record production. Untuk
tracing atau audit, pastikan environment database yang diperiksa sesuai dengan
nomor RFQ/PO dan deployment yang sedang dibahas.

### 22.2 Diagram relasi data

Diagram berikut menunjukkan pipeline kanonik. Panah `1:N` berarti satu record
header dapat memiliki banyak detail atau event.

```text
companies ───────────────┐
                         │
portal_customers ────────┼──> mkt_rfqs ──1:N──> mkt_rfq_lines
portal_company_members ──┘       │  │
                                 │  ├─1:N──> mkt_rfq_approvals
                                 │  │
                                 │  ├─1:N──> mkt_vendor_quotes ──1:N──> mkt_vendor_quote_lines
                                 │  │                 │
                                 │  │                 └──> suppliers
                                 │  │
                                 │  └──────────────> mkt_purchase_orders
                                 │                                  │
                                 │                                  ├─1:N──> mkt_purchase_order_lines
                                 │                                  ├─1:N──> mkt_po_shipments
                                 │                                  │             ├─1:N──> mkt_po_shipment_items
                                 │                                  │             ├─1:N──> mkt_po_shipment_events
                                 │                                  │             └─1:N──> mkt_po_goods_receipts
                                 │                                  │                            └─1:N──> mkt_po_goods_receipt_items
                                 │                                  │
                                 │                                  └──> purchase_documents (opsional ERP link)
                                 │
                                 ├──> mkt_rfq_guest_claims
                                 ├──> activity_logs
                                 └──> mkt_dual_write_log ───> portal_product_orders
                                                                  └─1:N──> portal_product_order_items

suppliers ──1:N──> vendor_catalog_items ──1:N──> product_media
products ───────────────(masterItemId / legacy product reference)
```

Beberapa relasi audit bersifat nullable dan tidak digambarkan sebagai parent
ownership. Misalnya, `activity_logs.mkt_rfq_id`,
`activity_logs.mkt_vendor_quote_id`, dan `activity_logs.mkt_purchase_order_id`
dapat mengarah ke entity Marketplace yang sesuai. Jika entity dihapus sesuai
kebijakan database, foreign key audit menggunakan `ON DELETE SET NULL` agar
catatan aktivitas tidak ikut menghapus histori.

### 22.3 Data store dan tanggung jawab

| Data store / tabel | Tanggung jawab | Isi yang penting untuk tracing |
|---|---|---|
| `companies` | Master perusahaan dan tenant buyer | `id`, nama perusahaan, atribut organisasi |
| `portal_customers` | Identitas customer portal | ID customer yang menjadi owner RFQ login |
| `portal_company_members` | Membership dan hak organisasi | customer/company, role, department, cost center, approval level |
| `suppliers` | Master vendor | `id`, nama, alamat, status, profil vendor, status publik Marketplace |
| `vendor_catalog_items` | Katalog item yang dipublikasikan | vendor, nama, unit, kategori, `price_sell`, currency, stok, MOQ, lead time, status publik |
| `product_media` | Metadata media item | item, tipe media, visibility, `storage_path`, URL/reference, urutan tampil |
| `mkt_rfqs` | Header pipeline RFQ kanonik | nomor RFQ, buyer, company/customer, status, tujuan, snapshot organisasi, token guest, counter |
| `mkt_rfq_lines` | Item yang diminta pada RFQ | item katalog, snapshot nama/deskripsi/unit, quantity, target price, notes |
| `mkt_rfq_approvals` | Request approval internal | level, approver/responder member, status, notes, waktu request/response |
| `mkt_vendor_quotes` | Header quotation vendor | RFQ, vendor, token akses, status, masa berlaku, terms, delivery, attachment reference, metadata komersial |
| `mkt_vendor_quote_lines` | Harga dan pemenuhan per item | RFQ line, unit price, offered quantity, subtotal, currency, MOQ, valid until, lead time, stock status |
| `mkt_purchase_orders` | Header PO Marketplace | nomor PO, RFQ, quote, company/vendor, status, total/tax/grand total, snapshot terms, token vendor, tanggal lifecycle |
| `mkt_purchase_order_lines` | Snapshot baris PO | nama item, quantity, unit, harga, subtotal, notes dari quotation pemenang |
| `mkt_po_shipments` | Header pengiriman | PO, nomor shipment, status, carrier, tracking, kendaraan/container, asal/tujuan, tanggal, incoterm snapshot |
| `mkt_po_shipment_items` | Alokasi sebagian/seluruh PO ke shipment | PO line, quantity, UOM, berat/volume, package count |
| `mkt_po_shipment_events` | Timeline append-only shipment | sequence, event type, catatan, lokasi, actor, attachment path privat |
| `mkt_po_goods_receipts` | Header penerimaan barang | shipment, nomor receipt, full/partial/rejected, inspection status, penerima, waktu fisik |
| `mkt_po_goods_receipt_items` | Hasil penerimaan per shipment item | received/accepted/rejected quantity, kondisi, notes |
| `mkt_rfq_guest_claims` | Audit claim RFQ guest | RFQ, email/token guest, user yang claim, status, expiry |
| `mkt_dual_write_log` | Ledger reliability dan idempotensi | payload snapshot, idempotency key, status retry, RFQ canonical, legacy order, error/resolution |
| `portal_product_orders` | Projection order legacy | order number, buyer/contact/alamat, total, status, company, template/payment fields |
| `portal_product_order_items` | Detail projection legacy | product, nama/SKU/unit, qty, harga, subtotal, dimensi/spec pengiriman |
| `activity_logs` | Audit lintas pipeline | actor, action, before/after JSON, deskripsi, IP, FK nullable ke RFQ/quote/PO |
| `purchase_documents` | Link opsional ke modul pembelian ERP | dokumen pembelian dan status receive/bill/payment; `mkt_purchase_order_id` menghubungkan PO |

#### Catatan tabel yang sering tertukar

- `vendor_catalog_items.price_base` adalah biaya internal dan **tidak boleh
  dikirim ke customer**. Harga publik yang diizinkan berasal dari field public
  seperti `price_sell`; quotation vendor tetap menjadi dasar harga final.
- `mkt_rfq_lines` menyimpan snapshot nama/deskripsi/unit saat RFQ dibuat.
  Foreign key ke item katalog boleh menjadi `NULL` bila item katalog dihapus,
  tetapi histori RFQ tetap dapat dibaca dari snapshot.
- `mkt_purchase_order_lines` bukan live view quotation. Baris ini adalah
  snapshot immutable dari quotation yang dipilih saat PO dibuat.
- `mkt_purchase_orders` terpisah dari `purchase_documents`. Link ke dokumen
  ERP hanya dibuat bila proses ERP membutuhkannya; membuat PO Marketplace tidak
  berarti semua field di `purchase_documents` otomatis terisi.
- `mkt_po_shipment_events` bersifat append-only. Perubahan status shipment
  dilakukan dengan event baru dan update status teragregasi pada header, bukan
  dengan mengedit event lama.

### 22.4 Aliran data saat membuka katalog

1. Browser memanggil endpoint katalog publik.
2. API memilih `vendor_catalog_items` yang aktif dan dipublikasikan, lalu
   menggabungkan informasi vendor dari `suppliers`.
3. Media dapat berasal dari `product_media` atau manifest/media metadata pada
   item. API menyaring URL/path sesuai visibility dan kebutuhan publik.
4. API membentuk response buyer-safe. `price_base`, komisi, margin, ranking
   internal, dan field supplier internal tidak ikut dikirim.
5. Frontend memakai response itu untuk kartu, filter, comparison, detail,
   kalkulator quantity, dan form RFQ. Membuka detail tidak mengunci harga atau
   stok; validasi final dilakukan lagi saat submit.

Dengan demikian, angka pada kartu katalog bukan salinan permanen ke PO.
Quotation dan PO memiliki data komersial serta snapshot sendiri agar perubahan
catalog setelah RFQ tidak mengubah histori transaksi.

### 22.5 Urutan transaksi submit RFQ

Urutan berikut adalah model konseptual dari `POST /api/portal/marketplace/:id/quote`
dan service RFQ. Beberapa aktivitas/notifikasi sengaja dilakukan setelah
commit agar kegagalan efek samping tidak membatalkan transaksi inti.

```text
1. Terima request dan idempotency key
2. Rate limit + validasi body/nomor WhatsApp/quantity
3. Baca item katalog dan vendor; pastikan item eligible untuk publik
4. Resolusi buyer:
   - login: portal customer + membership/company canonical dari session
   - guest: identity yang dikirim + guest token baru
5. Klaim atau buat mkt_dual_write_log bila dual-write pipeline aktif
6. BEGIN transaction
7. INSERT mkt_rfqs
   - generate rfq_number
   - simpan buyer dan company/customer ownership
   - simpan snapshot role/department/cost center/approval level
   - simpan delivery data dan token guest hash/expiry bila guest
8. INSERT semua mkt_rfq_lines
   - simpan snapshot nama/deskripsi/unit
   - simpan requested quantity dan notes
9. Set counter line_count dan state approval awal
10. INSERT mkt_rfq_approvals jika approval internal diperlukan
11. COMMIT transaksi kanonik
12. Tulis atau lengkapi portal_product_orders + items sebagai projection legacy
13. Link hasil canonical dan legacy pada mkt_dual_write_log
14. Tulis activity log dan enqueue notification secara non-fatal
15. Kembalikan rfq number, legacy order number bila ada, status, dan guest access
```

Jika langkah 7–10 gagal, transaksi kanonik di-rollback sehingga tidak boleh
ada RFQ parsial tanpa line yang sah. Jika langkah projection legacy gagal
setelah canonical commit, canonical RFQ tidak dihapus. `mkt_dual_write_log`
menyimpan failure/retry state untuk recovery dan mencegah submit ulang
membuat transaksi ganda.

#### Contoh bentuk data RFQ yang tersimpan

```text
mkt_rfqs
  id = 481
  rfq_number = MKT-RFQ-202608-0481
  portal_customer_id = 72
  company_id = 9
  buyer_name/email/phone = snapshot kontak saat submit
  buyer_role = procurement
  buyer_department = Procurement
  buyer_cost_center = CC-OPS-01
  buyer_approval_level = 2
  status = draft | submitted
  approval_status = pending | none
  required_delivery_date = tanggal kebutuhan
  delivery_address = tujuan pengiriman

mkt_rfq_lines
  rfq_id = 481
  vendor_catalog_item_id = 233
  item_name/item_description/item_unit = snapshot katalog
  requested_qty = 100
  target_price_per_unit = opsional
```

Nilai contoh di atas hanya ilustrasi struktur, bukan record produksi.

### 22.6 Perbedaan jalur login dan guest

#### Buyer login

- `portalCustomerId` berasal dari session yang telah diautentikasi.
- API mengambil company dan membership canonical dari server.
- Nama perusahaan yang dikirim browser hanya input tampilan atau fallback
  informasi; tidak dapat mengganti `company_id`.
- Role, department, cost center, dan approval level disalin sebagai snapshot ke
  `mkt_rfqs` supaya keputusan masa lalu tetap dapat diaudit walaupun membership
  berubah kemudian.
- Query My RFQs, quotation, dan PO harus selalu memeriksa ownership server-side.

#### Guest buyer

- `company_id` dan `portal_customer_id` dapat `NULL` sampai guest diklaim.
- Sistem membuat token akses dan menyimpan bentuk hash serta expiry untuk lookup
  aman. Token mentah hanya diberikan melalui response/link yang memang
  memerlukannya.
- `mkt_rfq_guest_claims` mencatat upaya claim dan statusnya. Setelah guest
  login/register, RFQ dapat diklaim ke akun customer sesuai aturan service.
- Guest tidak otomatis memperoleh daftar My RFQs berbasis session.

### 22.7 Lifecycle data setelah RFQ

| Tahap | Perubahan utama | Record yang menjadi sumber |
|---|---|---|
| Draft | Buyer menyimpan RFQ sebelum final submit | `mkt_rfqs.status = draft`, `mkt_rfq_lines` |
| Internal approval | Approver merespons request | `mkt_rfq_approvals`, `mkt_rfqs.approval_status`, `activity_logs` |
| Submitted/quoting | RFQ siap diproses admin dan vendor | `mkt_rfqs.status`, `line_count`, `quote_count` |
| Vendor invited | Admin mengundang vendor | `mkt_vendor_quotes.status = invited`, token quote |
| Vendor opened | Vendor membuka link | `mkt_vendor_quotes.status/opened_at` dan activity |
| Quotation submitted | Vendor mengisi header dan seluruh line | `mkt_vendor_quotes`, `mkt_vendor_quote_lines` |
| Quoted | RFQ memiliki quotation yang dapat dibandingkan | RFQ status + quote statuses |
| Vendor proposal | Route portal buyer menyimpan quote yang diusulkan, tetapi belum membuat PO | kolom proposal pada runtime RFQ, `winner_selected_*`, activity |
| Customer review | Admin mengirim quotation terpilih ke customer | status RFQ dan quote, activity/notification |
| Awarded | Customer approve; PO dibuat atomik dari quote | `mkt_purchase_orders`, `mkt_purchase_order_lines`, RFQ awarded |
| Issued/vendor accepted | Admin menerbitkan PO; vendor menerima lewat token | `mkt_purchase_orders.status`, token vendor, activity |
| Production/fulfillment | Admin/vendor mengubah status operasional | PO status + `activity_logs` |
| Shipment | Shipment dan alokasi line dibuat | `mkt_po_shipments`, `mkt_po_shipment_items`, event awal |
| Tracking | Setiap perubahan perjalanan ditambahkan | append-only `mkt_po_shipment_events` + shipment status |
| Delivered | Shipment memiliki status delivered dan POD bila diwajibkan | shipment header/event, private attachment path |
| Goods receipt | Admin/internal mencatat quantity dan inspeksi | `mkt_po_goods_receipts`, receipt items |
| Partially delivered/delivered/rejected goods | Status PO dihitung dari seluruh receipt | aggregate accepted/rejected quantity pada receipt items |
| Completed/closed | Pemenuhan selesai dan PO ditutup | `mkt_purchase_orders`, lifecycle activity |

Route customer-facing `POST /api/mkt/portal/rfqs/:id/select-vendor`
menyimpan proposal vendor dan belum membuat PO. Setelah itu quotation dikirim
ke customer review dan `customer-approve` menjadi titik pembuatan PO pada alur
portal. Ada juga route admin operasional lama yang dapat menjalankan service
selection sekaligus membuat PO; kedua route tidak boleh dipahami sebagai
kontrak yang sama ketika melakukan debugging.

### 22.8 Pembuatan PO dan snapshot komersial

Saat approval customer berhasil:

1. server memverifikasi ownership customer, status RFQ,
   `customer_review`, dan quote yang dipilih;
2. quote harus milik RFQ yang sama dan berada pada status yang dapat dipilih;
3. `mkt_purchase_orders` dibuat dengan unique guard pada `rfq_id` dan
   `quote_id`, sehingga approve berulang tidak membuat PO kedua;
4. total, pajak, grand total, vendor, dan terms disalin dari quote;
5. delapan field komersial penting disimpan sebagai snapshot PO, termasuk nama
   vendor, alamat, payment terms, incoterm, quotation number/date, currency,
   dan lead time;
6. semua quote lines yang dipilih disalin ke
   `mkt_purchase_order_lines`;
7. RFQ ditandai `awarded`, quote menjadi `selected`, dan activity/notification
   diproses setelah perubahan inti berhasil.

PO selanjutnya membaca line dan commercial snapshot sendiri. Perubahan vendor,
quotation, atau katalog setelah PO dibuat tidak boleh mengubah isi PO historis.

### 22.9 Shipment, event, POD, dan goods receipt

#### Shipment

Satu PO dapat memiliki beberapa shipment. Ini diperlukan untuk partial shipment,
beberapa kendaraan, container, AWB/BL, atau pengiriman bertahap. Saat shipment
dibuat:

- server mengunci PO untuk memvalidasi status dan line;
- header `mkt_po_shipments` dan seluruh `mkt_po_shipment_items` dibuat dalam
  satu transaksi;
- `incoterm_snapshot` disalin dari PO;
- event `created` menjadi event sequence pertama;
- aktivitas dan notifikasi dibuat setelah commit.

Setiap shipment item menunjuk ke satu `mkt_purchase_order_lines`, bukan langsung
ke RFQ line. Dengan begitu quantity yang dikirim dapat menjadi subset quantity
PO.

#### Event dan proof of delivery

`mkt_po_shipment_events` adalah timeline append-only. Service mengunci shipment,
menentukan `event_sequence` berikutnya, dan menjaga unique index
`(shipment_id, event_sequence)`. Event dapat menyimpan actor, lokasi, koordinat,
catatan, serta `attachment_object_path`.

Proof of Delivery (POD) bukan tabel terpisah. File diunggah ke storage privat,
kemudian direferensikan oleh event `pod_uploaded`. Jika race atau transaksi
gagal, object privat yang tidak terpakai dihapus. Ini mencegah orphan file dan
menjaga satu pipeline evidence.

#### Goods receipt

Goods receipt dibuat terhadap shipment, bukan langsung terhadap RFQ:

```text
mkt_po_goods_receipts.shipment_id
        └── mkt_po_goods_receipt_items.shipment_item_id
                                      └── mkt_po_shipment_items.po_line_id
                                                               └── PO
```

Satu shipment dapat memiliki beberapa receipt untuk penerimaan bertahap.
Service mensyaratkan shipment delivered dan POD tersedia, lalu menyimpan:

- received quantity;
- accepted quantity;
- rejected quantity;
- condition (`GOOD`, `DAMAGED`, `SHORTAGE`, `REJECTED`);
- inspection status pada header;
- penerima, waktu fisik penerimaan, dan notes.

Secara default berlaku `accepted_qty + rejected_qty = received_qty`. Setelah
commit, service mengagregasi seluruh receipt pada PO:

- accepted mencukupi seluruh ordered quantity tanpa rejection → `delivered`;
- ada accepted/rejected tetapi masih ada outstanding → `partially_delivered`;
- seluruh kuantitas yang diterima ditolak → `rejected_goods`.

Pembuatan receipt dari Customer Portal buyer belum tersedia; data ini dibuat
melalui alur admin/internal, lalu endpoint customer hanya membacanya.

### 22.10 Canonical pipeline dan legacy projection

#### Pipeline kanonik

Tabel `mkt_*` adalah sumber utama untuk lifecycle Marketplace baru:

```text
RFQ → approval → vendor quote → customer review
    → purchase order → shipment → goods receipt → close
```

Relasi antartahap menggunakan foreign key dan ID internal. Nomor bisnis
(`MKT-RFQ-...`, `MKT-PO-...`, `MKT-SHP-...`, `MKT-GR-...`) dipakai untuk
komunikasi manusia dan tracing.

#### Projection legacy

`portal_product_orders` dan `portal_product_order_items` masih ditulis untuk
kompatibilitas dengan modul lama, laporan, atau proses downstream yang belum
bermigrasi ke `mkt_*`. Projection ini bukan alasan untuk menganggap direct
order sebagai alur utama Marketplace.

Karakteristik penting:

- row legacy boleh memiliki status/field yang berbeda karena modelnya lebih
  lama;
- jangan membuat keputusan lifecycle Marketplace hanya dari `portal_product_orders`;
- `mkt_dual_write_log` menyimpan hubungan canonical RFQ dengan legacy order;
- bila canonical berhasil tetapi projection gagal, status ledger menjadi
  `failed`/retrying dan perlu direkonsiliasi, bukan membuat RFQ kedua;
- payload ledger menyimpan snapshot request agar retry tidak bergantung pada
  harga atau katalog yang sudah berubah;
- row legacy tanpa `idempotency_key` dianggap legacy dan tidak boleh dipaksa
  masuk ke auto-retry tanpa pemeriksaan manual.

### 22.11 Pemetaan UI → endpoint → tabel

| UI / aksi | Endpoint utama | Baca/tulis data |
|---|---|---|
| Kartu dan filter Marketplace | `GET /api/portal/marketplace`, `/stats`, `/featured` | Baca `vendor_catalog_items`, `suppliers`, media |
| Detail item | `GET /api/portal/marketplace/:id` | Baca item, vendor, spesifikasi, media; field internal disaring |
| Request Quotation | `POST /api/portal/marketplace/:id/quote` | Tulis `mkt_dual_write_log`, `mkt_rfqs`, `mkt_rfq_lines`, approval/legacy projection |
| My RFQs | `GET /api/mkt/portal/rfqs` | Baca RFQ milik session dan status approval |
| Detail RFQ/timeline | `GET /api/mkt/portal/rfqs/:id`, lines, quotation, quotes | Baca RFQ, lines, quote buyer-safe, activity |
| Submit/cancel RFQ | `POST /api/mkt/portal/rfqs/:id/submit`, `/cancel` | Update status RFQ dan audit |
| Approval internal | `POST /api/mkt/portal/rfqs/:id/submit-for-approval`, `/approve`, `/reject` | Update `mkt_rfq_approvals` dan state RFQ |
| Pilih vendor proposal | `POST /api/mkt/portal/rfqs/:id/select-vendor` | Update proposal quote pada RFQ, activity; belum membuat PO |
| Kirim ke customer review | `POST /api/mkt/portal/rfqs/:id/send-to-customer-review` | Update status RFQ dan activity |
| Approve/reject quotation | `POST /api/mkt/portal/rfqs/:id/customer-approve`, `/customer-reject` | Buat PO atau kembalikan RFQ; tulis activity |
| My Purchase Orders | `GET /api/mkt/portal/purchase-orders` | Baca `mkt_purchase_orders` dengan ownership company/customer |
| Detail PO | `GET /api/mkt/portal/purchase-orders/:id`, `/items` | Baca PO dan immutable PO lines |
| Shipment PO | `GET /api/mkt/portal/purchase-orders/:id/shipments` | Baca shipment dan alokasi shipment items |
| Timeline shipment | `GET /api/mkt/portal/shipments/:shipmentId/timeline` | Baca event append-only; akses attachment lewat API |
| Goods receipt PO | `GET /api/mkt/portal/shipments/:shipmentId/goods-receipts` | Baca receipt dan receipt items |
| Vendor quotation link | route vendor berbasis token | Tulis quote header/lines; token menjadi otoritas akses |
| PO vendor confirmation | route vendor berbasis `vendorToken` | Update PO vendor transition; commission/internal field disaring |

Nama route admin dapat memiliki kontrak berbeda dari route portal buyer.
Gunakan ownership dan actor pada route yang aktual ketika mengaudit sebuah
perubahan, bukan hanya mencocokkan nama tombol di UI.

### 22.12 Aturan integritas, security, dan idempotensi

1. **Ownership selalu server-side.** ID pada URL adalah selector, bukan bukti
   bahwa user berhak melihat atau mengubah record.
2. **Tenant context berasal dari session/membership.** `buyer_company` atau
   nama organisasi dari browser dapat disimpan sebagai informasi, tetapi tidak
   mengalahkan `company_id` canonical.
3. **Status transition guarded.** Service memeriksa status saat ini di dalam
   klausa update. Dua request bersamaan tidak boleh sama-sama berhasil
   melakukan transition yang sama.
4. **Unique business guards.** RFQ dan quote yang sama tidak boleh menghasilkan
   lebih dari satu PO; idempotency key mencegah retry submit membuat request
   baru.
5. **Transaction boundary jelas.** RFQ header dan lines harus atomic; shipment
   header/items/events awal atomic; goods receipt header/items dan perhitungan
   status PO atomic.
6. **Snapshot dipakai untuk histori.** RFQ line snapshot menjaga permintaan
   awal; PO snapshot menjaga terms pemenang; shipment snapshot menjaga incoterm.
7. **Token opaque dan terbatas.** Guest, vendor quote, dan vendor PO memakai
   token akses; token tidak boleh diperlakukan sebagai data business yang dapat
   ditebak atau dibagikan ke actor lain.
8. **Response allow-list.** Data vendor-facing dan buyer-facing hanya memilih
   field yang boleh terlihat; jangan menambahkan internal field dengan pola
   exclude-list yang mudah lupa diperbarui.
9. **Event audit tidak diedit.** Koreksi timeline dilakukan dengan event baru
   dan alasan, bukan update/delete histori.
10. **File privat tidak menjadi sumber status.** Status shipment/receipt berada
    di database; attachment hanya evidence yang direferensikan oleh record.

### 22.13 Panduan tracing berdasarkan nomor RFQ atau PO

Gunakan nomor bisnis sebagai entry point, lalu ikuti ID internal. Query di bawah
adalah pseudocode read-only; nama schema/connection harus disesuaikan dengan
environment yang sedang diaudit.

#### Tracing RFQ sampai PO

```sql
SELECT
  r.id AS rfq_id,
  r.rfq_number,
  r.status AS rfq_status,
  r.approval_status,
  r.portal_customer_id,
  r.company_id,
  r.created_at,
  po.id AS po_id,
  po.po_number,
  po.status AS po_status,
  po.quote_id
FROM mkt_rfqs r
LEFT JOIN mkt_purchase_orders po ON po.rfq_id = r.id
WHERE r.rfq_number = :rfq_number;
```

#### Tracing quote dan line

```sql
SELECT
  q.id AS quote_id,
  q.status AS quote_status,
  q.vendor_id,
  q.quotation_number,
  q.submitted_at,
  ql.rfq_line_id,
  ql.offered_unit_price,
  ql.offered_qty,
  ql.subtotal,
  ql.currency,
  ql.lead_time_days,
  ql.stock_status
FROM mkt_vendor_quotes q
JOIN mkt_vendor_quote_lines ql ON ql.quote_id = q.id
JOIN mkt_rfqs r ON r.id = q.rfq_id
WHERE r.rfq_number = :rfq_number
ORDER BY q.id, ql.id;
```

#### Tracing PO sampai penerimaan

```sql
SELECT
  po.po_number,
  po.status AS po_status,
  s.shipment_number,
  s.shipment_status,
  e.event_sequence,
  e.event_type,
  e.created_at AS event_created_at,
  gr.receipt_number,
  gr.receipt_type,
  gri.received_qty,
  gri.accepted_qty,
  gri.rejected_qty,
  gri.condition
FROM mkt_purchase_orders po
LEFT JOIN mkt_po_shipments s ON s.po_id = po.id
LEFT JOIN mkt_po_shipment_events e ON e.shipment_id = s.id
LEFT JOIN mkt_po_goods_receipts gr ON gr.shipment_id = s.id
LEFT JOIN mkt_po_goods_receipt_items gri ON gri.goods_receipt_id = gr.id
WHERE po.po_number = :po_number
ORDER BY s.id, e.event_sequence, gr.id, gri.id;
```

Untuk tracing dual-write, cari `mkt_dual_write_log` berdasarkan `mkt_rfq_number`,
`mkt_rfq_id`, `portal_order_number`, atau `idempotency_key`. Jangan melakukan
UPDATE manual pada ledger hanya untuk membuat status terlihat sukses; gunakan
recovery service atau prosedur manual yang menyimpan resolution dan alasan.

### 22.14 Penyimpanan dokumen dan media

| Jenis berkas | Metadata database | Lokasi bytes / akses |
|---|---|---|
| Gambar katalog | `product_media` atau `vendor_catalog_items.media_assets` | Storage yang dikonfigurasi; public/signed reference sesuai visibility |
| Dokumen item/vendor | field `documents`, `supplier_documents`, atau attachment reference | Storage; jangan menganggap JSON field berisi bytes |
| Attachment quotation | `mkt_vendor_quotes.attachment_url` dan filename | Reference ke storage/URL sesuai service, dengan filter buyer/vendor |
| POD shipment | `mkt_po_shipment_events.attachment_object_path` pada event `pod_uploaded` | Object storage privat; akses melalui service, bukan public URL mentah |
| Dokumen legacy order | `portal_product_orders.uploaded_documents` | Reference object storage dan label; bukan isi file |

Aturan praktis:

- jangan commit gambar atau dokumen biner ke repository;
- jangan menyimpan signed URL permanen sebagai identitas utama bila service
  dapat menyimpan object path;
- gunakan extension yang sesuai bytes hasil kompresi untuk public CMS upload;
- hapus object privat yang dibuat oleh request gagal atau duplicate bila tidak
  lagi direferensikan;
- saat memindahkan data dev ke production, pastikan object benar-benar ada di
  bucket production; asset dev tidak otomatis ikut dipromosikan.

### 22.15 Matriks sumber kebenaran saat data berbeda

| Situasi | Sumber utama | Jangan gunakan sebagai sumber utama |
|---|---|---|
| Status RFQ | `mkt_rfqs` | status order legacy |
| Item yang diminta | `mkt_rfq_lines` | item katalog live setelah katalog berubah |
| Status approval | `mkt_rfq_approvals` + `mkt_rfqs.approval_status` | notifikasi saja |
| Harga final buyer | selected `mkt_vendor_quotes` dan quote lines | harga katalog |
| Isi PO | `mkt_purchase_orders` + PO lines/snapshot | supplier profile live |
| Perjalanan shipment | shipment header + append-only events | teks status pada notification |
| Quantity diterima | goods receipt items | status shipment saja |
| Audit aktor/perubahan | `activity_logs` dan event tables | timestamp UI |
| Kesehatan dual-write | `mkt_dual_write_log` | keberadaan row legacy saja |

Jika Activity Log tidak lengkap, gunakan entity state dan timeline yang menjadi
sumber operasional masing-masing. Jangan mengarang event audit retroaktif
tanpa menandainya sebagai recovery/manual action.

---

## 23. Referensi implementasi

Dokumen ini disusun berdasarkan implementasi Customer Portal dan API Marketplace saat ini, terutama:

- route Customer Portal Marketplace dan halaman detail item;
- halaman My RFQs dan detail RFQ;
- halaman Pending Approvals;
- halaman My Purchase Orders dan detail PO;
- route katalog publik Marketplace;
- route portal buyer RFQ/PO/shipment/goods receipt;
- service submission RFQ, approval, quotation, dan transisi customer review.

Jika implementasi berubah, status, field, endpoint, atau batasan pada dokumen ini perlu ditinjau ulang bersama perubahan kode dan kontrak API.