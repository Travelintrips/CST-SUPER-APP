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

## 22. Referensi implementasi

Dokumen ini disusun berdasarkan implementasi Customer Portal dan API Marketplace saat ini, terutama:

- route Customer Portal Marketplace dan halaman detail item;
- halaman My RFQs dan detail RFQ;
- halaman Pending Approvals;
- halaman My Purchase Orders dan detail PO;
- route katalog publik Marketplace;
- route portal buyer RFQ/PO/shipment/goods receipt;
- service submission RFQ, approval, quotation, dan transisi customer review.

Jika implementasi berubah, status, field, endpoint, atau batasan pada dokumen ini perlu ditinjau ulang bersama perubahan kode dan kontrak API.