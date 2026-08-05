# Checklist Audit ERP — BizPortal CST Logistics
> Versi: 1.0 | Sistem: BizPortal ERP | Tanggal Audit: ___________
> Auditor: ___________ | Periode Audit: ___________

---

## CARA PENGGUNAAN
- ✅ = OK / Sesuai
- ❌ = Tidak OK / Ada Masalah
- ⚠️ = Perlu Perhatian / Partial
- N/A = Tidak Berlaku
- Isi kolom **Temuan** dengan catatan spesifik

---

## MODUL 1 — SALES (Penjualan)

### 1.1 Master Data Pelanggan
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 1.1.1 | Data pelanggan lengkap (nama, alamat, kontak, email, NPWP) | | |
| 1.1.2 | Tidak ada duplikasi data pelanggan | | |
| 1.1.3 | Pelanggan non-aktif telah di-flag/dinonaktifkan | | |
| 1.1.4 | Credit limit pelanggan terdefinisi dan diterapkan | | |
| 1.1.5 | Segmentasi pelanggan (kategori/group) sesuai | | |

### 1.2 Quotation (Penawaran)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 1.2.1 | Semua quotation memiliki nomor dokumen unik (format QUO/YYYY/NNNNNN) | | |
| 1.2.2 | Tidak ada quotation dengan status "draft" lebih dari 30 hari | | |
| 1.2.3 | Harga pada quotation sesuai dengan price list yang berlaku | | |
| 1.2.4 | Diskon yang diberikan memiliki otorisasi yang tepat | | |
| 1.2.5 | Quotation yang kadaluarsa telah di-cancel atau diperbarui | | |
| 1.2.6 | AI-generated drafts telah diverifikasi manual sebelum dikirim ke pelanggan | | |
| 1.2.7 | Pajak (PPN) dihitung dengan benar pada setiap baris | | |
| 1.2.8 | UOM (satuan) pada line item sesuai dan konsisten | | |

### 1.3 Sales Order (Pesanan Penjualan)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 1.3.1 | Setiap Sales Order memiliki referensi Quotation yang sah | | |
| 1.3.2 | Sales Order yang dikonfirmasi memiliki tanda tangan/approval yang sesuai | | |
| 1.3.3 | Tidak ada SO dengan status "confirmed" tanpa progres delivery > 14 hari | | |
| 1.3.4 | ETD/ETA tercatat pada setiap SO logistik | | |
| 1.3.5 | SO yang di-cancel memiliki alasan dan otorisasi yang jelas | | |
| 1.3.6 | Linkage SO → Logistic Order berfungsi dan sinkron | | |

### 1.4 Invoice (Faktur Penjualan)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 1.4.1 | Setiap invoice memiliki nomor unik dan berurutan | | |
| 1.4.2 | Invoice terhubung ke SO/Quotation yang valid | | |
| 1.4.3 | Tanggal invoice ≥ tanggal SO | | |
| 1.4.4 | Due date tercatat dan sesuai term of payment | | |
| 1.4.5 | Invoice yang sudah paid statusnya "done" | | |
| 1.4.6 | Tidak ada invoice yang di-edit setelah dikirim ke pelanggan tanpa reversal | | |
| 1.4.7 | Grand total invoice = subtotal + PPN − diskon | | |
| 1.4.8 | Jurnal akuntansi otomatis terposting saat invoice dikonfirmasi (DR: AR, CR: Pendapatan) | | |
| 1.4.9 | Faktur Pajak (e-faktur) diterbitkan untuk setiap invoice ber-PPN | | |

### 1.5 Piutang (Accounts Receivable)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 1.5.1 | AR aging report akurat — saldo sesuai dengan invoice outstanding | | |
| 1.5.2 | Tidak ada piutang overdue > 90 hari tanpa tindakan penagihan | | |
| 1.5.3 | Pembayaran dari pelanggan langsung di-apply ke invoice yang tepat | | |
| 1.5.4 | Advance payment (uang muka) tercatat sebagai hutang ke pelanggan | | |

---

## MODUL 2 — PURCHASE (Pembelian)

### 2.1 Master Data Vendor/Supplier
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 2.1.1 | Data vendor lengkap (nama, alamat, kontak, NPWP, rekening bank) | | |
| 2.1.2 | Vendor aktif memiliki service type yang benar (purchase/logistics) | | |
| 2.1.3 | Tidak ada duplikasi vendor | | |
| 2.1.4 | Vendor catalog items (etalase) harga dasar, markup, dan harga jual akurat | | |
| 2.1.5 | Vendor non-aktif sudah di-flag `isActive = false` | | |

### 2.2 Purchase Request (PR)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 2.2.1 | PR dibuat oleh requester yang berwenang sesuai departemen | | |
| 2.2.2 | PR memiliki keterangan kebutuhan yang jelas (item, qty, spesifikasi) | | |
| 2.2.3 | PR memiliki approval dari manajer/atasan sebelum menjadi RFQ | | |
| 2.2.4 | Approval rules berdasarkan nilai (amount threshold) berfungsi | | |
| 2.2.5 | PR yang ditolak memiliki alasan yang terdokumentasi | | |
| 2.2.6 | Tidak ada PR dengan status "pending" > 7 hari tanpa tindak lanjut | | |

### 2.3 RFQ (Request for Quotation)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 2.3.1 | Minimum 3 vendor diundang untuk setiap RFQ di atas threshold | | |
| 2.3.2 | RFQ dikirimkan ke vendor via WhatsApp/email dan tercatat di sistem | | |
| 2.3.3 | Vendor response tercatat lengkap (harga, lead time, syarat) | | |
| 2.3.4 | Vendor comparison matrix tersedia dan digunakan | | |
| 2.3.5 | Pemilihan vendor terpilih memiliki justifikasi | | |

### 2.4 Purchase Order (PO)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 2.4.1 | PO hanya dibuat dari RFQ yang sudah disetujui | | |
| 2.4.2 | Harga PO sesuai dengan harga yang disetujui di RFQ | | |
| 2.4.3 | PO memiliki tanda tangan/approval sesuai kewenangan | | |
| 2.4.4 | PO dikirim ke vendor dan ada konfirmasi penerimaan | | |
| 2.4.5 | Perubahan PO (amandemen) melalui proses approval ulang | | |
| 2.4.6 | Expected delivery date tercatat di setiap PO | | |

### 2.5 Goods Receipt (GR) & QC
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 2.5.1 | GR hanya bisa dibuat jika ada PO yang sudah dikonfirmasi | | |
| 2.5.2 | Qty yang diterima dicek dengan PO (tidak lebih dari qty PO) | | |
| 2.5.3 | Proses QC dilakukan sebelum barang masuk gudang resmi | | |
| 2.5.4 | Barang yang reject/tidak sesuai dikembalikan ke vendor (Return PO) | | |
| 2.5.5 | Saat GR dikonfirmasi, stok bertambah otomatis di warehouse | | |
| 2.5.6 | Jurnal GR/IR accrual terposting (DR: Inventory, CR: GR/IR Clearing) | | |

### 2.6 Vendor Bills & Landed Costs
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 2.6.1 | Tagihan vendor di-match dengan PO dan GR sebelum di-approve | | |
| 2.6.2 | Tiga-way matching (PO vs GR vs Bill) berfungsi dan diterapkan | | |
| 2.6.3 | Landed cost (biaya pengiriman, bea cukai, dll.) dialokasikan ke item | | |
| 2.6.4 | Jurnal hutang otomatis terposting saat bill dikonfirmasi (DR: Inventory/Expense, CR: AP) | | |
| 2.6.5 | GR/IR clearing account dibersihkan saat bill diposting | | |

### 2.7 Hutang Usaha (Accounts Payable)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 2.7.1 | AP aging report akurat — saldo sesuai dengan tagihan outstanding | | |
| 2.7.2 | Tidak ada hutang overdue tanpa jadwal pembayaran | | |
| 2.7.3 | Pembayaran ke vendor langsung di-apply ke bill yang tepat | | |
| 2.7.4 | Advance payment ke vendor tercatat sebagai uang muka (prepaid) | | |

---

## MODUL 3 — AKUNTANSI & KEUANGAN

### 3.1 Chart of Accounts (Bagan Akun)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 3.1.1 | COA sesuai standar akuntansi Indonesia (PSAK) | | |
| 3.1.2 | Tidak ada akun duplikat atau kode akun yang tumpang tindih | | |
| 3.1.3 | Setiap akun memiliki tipe yang benar (asset/liability/equity/revenue/expense) | | |
| 3.1.4 | Akun-akun default pada Accounting Settings sudah dikonfigurasi (AR, AP, Sales, COGS, Bank, Cash) | | |
| 3.1.5 | Akun PPN Input dan PPN Output sudah terdefinisi | | |
| 3.1.6 | GR/IR Clearing Account sudah dikonfigurasi | | |
| 3.1.7 | Akun yang sudah tidak dipakai di-nonaktifkan | | |

### 3.2 Jurnal & Entri Akuntansi
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 3.2.1 | Setiap jurnal memiliki total debit = total kredit (balance) | | |
| 3.2.2 | Jurnal otomatis dari modul lain (sales, purchase, payment) terposting dengan benar | | |
| 3.2.3 | Jurnal manual hanya dibuat oleh user yang berwenang | | |
| 3.2.4 | Tidak ada jurnal yang di-delete — reversal digunakan untuk koreksi | | |
| 3.2.5 | Source reference (source_id, source_type) terhubung ke dokumen asal | | |
| 3.2.6 | Jurnal COGS (DR: COGS, CR: Inventory) terposting saat delivery | | |
| 3.2.7 | Jurnal stock opname dan adjustment tercatat dengan benar | | |
| 3.2.8 | Entri jurnal memiliki description/narasi yang informatif | | |

### 3.3 Pajak (Tax)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 3.3.1 | Rate PPN terkonfigurasi dengan benar (11%) | | |
| 3.3.2 | PPN keluaran (sales) terhitung dan terposting ke akun yang benar | | |
| 3.3.3 | PPN masukan (purchase) terhitung dan terposting ke akun yang benar | | |
| 3.3.4 | Perhitungan PPh (withholding tax) sudah dikonfigurasi jika ada | | |
| 3.3.5 | Rekonsiliasi PPN bulanan dapat dijalankan dari laporan | | |

### 3.4 Pembayaran (Payments)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 3.4.1 | Setiap pembayaran masuk (inbound) terhubung ke invoice AR yang benar | | |
| 3.4.2 | Setiap pembayaran keluar (outbound) terhubung ke bill AP yang benar | | |
| 3.4.3 | Pembayaran via kas dan bank dicatat pada jurnal yang berbeda | | |
| 3.4.4 | Jurnal pembayaran terposting (DR: Cash/Bank, CR: AR) untuk inbound | | |
| 3.4.5 | Jurnal pembayaran terposting (DR: AP, CR: Cash/Bank) untuk outbound | | |
| 3.4.6 | Saldo kas/bank pada sistem sesuai dengan rekening koran aktual | | |
| 3.4.7 | Pembayaran parsial (cicilan) ditangani dengan benar | | |

### 3.5 Rekonsiliasi Bank
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 3.5.1 | Rekonsiliasi bank dilakukan minimal bulanan | | |
| 3.5.2 | Tidak ada transaksi yang sudah lama di "outstanding" di rekonsiliasi | | |
| 3.5.3 | Selisih rekonsiliasi (jika ada) sudah diinvestigasi dan diselesaikan | | |

### 3.6 Laporan Keuangan
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 3.6.1 | **Neraca (Balance Sheet)**: Total Aset = Total Liabilitas + Ekuitas | | |
| 3.6.2 | **Laba Rugi (P&L)**: Pendapatan, COGS, dan Beban diklasifikasi dengan benar | | |
| 3.6.3 | **Trial Balance**: Tidak ada akun dengan saldo yang tidak normal (abnormal balance) | | |
| 3.6.4 | **General Ledger**: Setiap transaksi dapat ditelusuri ke dokumen sumber | | |
| 3.6.5 | Laporan Holding (konsolidasi antar perusahaan) saldo sesuai | | |
| 3.6.6 | Laporan dapat difilter per periode, per perusahaan, per cabang | | |
| 3.6.7 | Laba bersih YTD pada Balance Sheet = Net Income di P&L | | |

---

## MODUL 4 — LOGISTIK & FREIGHT

### 4.1 Logistic Orders (Pesanan Logistik)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 4.1.1 | Setiap order memiliki nomor unik dan token publik (publicRfqToken) | | |
| 4.1.2 | Detail shipper dan consignee lengkap | | |
| 4.1.3 | Status order mengalir secara runtut (new → quoted → confirmed → delivered) | | |
| 4.1.4 | Order yang dibatalkan memiliki alasan yang terdokumentasi | | |
| 4.1.5 | Customer portal dapat melacak status order via tracking link | | |
| 4.1.6 | Notifikasi WhatsApp/email terkirim ke pelanggan pada perubahan status | | |
| 4.1.7 | Order type (shipment/trucking/dll.) terisi dengan benar | | |

### 4.2 Freight Forwarding
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 4.2.1 | Nomor freight shipment unik dan berurutan | | |
| 4.2.2 | Mode transportasi (Sea/Air/Land) terisi benar | | |
| 4.2.3 | Port of loading dan port of discharge terisi | | |
| 4.2.4 | Vessel/voyage/AWB number tercatat | | |
| 4.2.5 | Komoditas, berat bruto/netto, dan volume tercatat | | |
| 4.2.6 | Bill of Lading (BL) dapat digenerate dan sudah diverifikasi | | |
| 4.2.7 | Stage tracking (milestone) perjalanan tercatat dan akurat | | |
| 4.2.8 | Dokumen kepabeanan (customs docs) terlampir untuk shipment internasional | | |
| 4.2.9 | Analisis profitabilitas per shipment (pendapatan vs. biaya operasional) tersedia | | |

### 4.3 RFQ Vendor Logistik
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 4.3.1 | RFQ dikirim ke minimal 2 vendor untuk setiap shipment | | |
| 4.3.2 | Vendor response (quote) tercatat lengkap di sistem | | |
| 4.3.3 | Margin rules diterapkan dengan benar pada vendor quote → harga customer | | |
| 4.3.4 | Perbandingan vendor quote tersedia (RFQ comparison view) | | |
| 4.3.5 | Vendor yang dipilih dinotifikasi via WhatsApp/email | | |

### 4.4 Driver & Internal Tasks
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 4.4.1 | Driver assignment tercatat dengan jelas per job | | |
| 4.4.2 | Status job driver mengalir: ASSIGNED → PICKED_UP → DELIVERED | | |
| 4.4.3 | POD (Proof of Delivery) foto terupload untuk setiap job selesai | | |
| 4.4.4 | GPS tracking berfungsi dan lokasi driver terekam | | |
| 4.4.5 | Geofence alerts berfungsi dan diteruskan ke admin | | |
| 4.4.6 | Laporan performa driver (ketepatan waktu, jumlah job) tersedia | | |
| 4.4.7 | Internal task (tugas non-driver) terassign dan statusnya terlacak | | |

---

## MODUL 5 — INVENTORI & GUDANG

### 5.1 Master Data Produk
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 5.1.1 | Setiap produk memiliki kode/SKU unik | | |
| 5.1.2 | UOM (Unit of Measure) produk terdefinisi dan ada konversi yang benar | | |
| 5.1.3 | Kategori produk terklasifikasi dengan benar | | |
| 5.1.4 | Harga beli (average cost) dan harga jual tersedia dan akurat | | |
| 5.1.5 | Produk non-aktif sudah di-flag | | |
| 5.1.6 | Gambar produk (jika ada) terupload di object storage dengan benar | | |

### 5.2 Stok & Pergerakan Barang
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 5.2.1 | Saldo stok pada sistem sesuai dengan stok fisik (cek via opname) | | |
| 5.2.2 | Setiap pergerakan stok (masuk/keluar) tercatat di stock_movements | | |
| 5.2.3 | Stok tidak pernah negatif (kecuali ada setting khusus) | | |
| 5.2.4 | Stok reserved (dari SO yang belum deliver) dikalkulasi dengan benar | | |
| 5.2.5 | Stok available = stok on hand − stok reserved | | |
| 5.2.6 | Minimum stock level dikonfigurasi dan alert berjalan | | |
| 5.2.7 | Average cost diupdate dengan benar setiap ada pembelian baru (moving average) | | |

### 5.3 Warehouse Management
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 5.3.1 | Warehouse aktif terdefinisi dengan tipe yang benar (Central/Branch/Outlet) | | |
| 5.3.2 | Hak akses gudang per role (gudang staff hanya bisa akses branch-nya sendiri) | | |
| 5.3.3 | Transfer antar gudang dicatat dengan benar (keluar dari sumber, masuk ke tujuan) | | |

### 5.4 Stock Opname
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 5.4.1 | Opname dilakukan secara berkala (minimal per kuartal) | | |
| 5.4.2 | Selisih opname (variance) dicatat dan diselidiki | | |
| 5.4.3 | Adjustment stok dari opname memiliki approval dan jurnal yang benar | | |
| 5.4.4 | Barang rusak (damage) dicatat terpisah dan ada jurnal expense | | |

---

## MODUL 6 — THAI TEA / F&B

### 6.1 Master Data F&B
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 6.1.1 | Semua cabang Thai Tea terdaftar dengan nama dan alamat benar | | |
| 6.1.2 | Resep (BOM) untuk setiap produk jadi terdefinisi lengkap | | |
| 6.1.3 | Yield quantity dan unit pada resep akurat | | |
| 6.1.4 | Ingredient setiap resep lengkap dengan qty dan unit | | |

### 6.2 Produksi & Konsumsi Bahan
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 6.2.1 | Saat produk resep terjual di POS, bahan baku berkurang otomatis | | |
| 6.2.2 | Konsumsi bahan baku aktual sesuai dengan resep yang terdefinisi | | |
| 6.2.3 | Produksi tercatat per cabang dan per tanggal | | |
| 6.2.4 | Stok bahan baku di setiap cabang akurat | | |

### 6.3 POS (Point of Sale) Thai Tea
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 6.3.1 | Kasir hanya bisa akses data cabang yang ditugaskan | | |
| 6.3.2 | Token kasir tidak bisa dipalsukan atau di-reuse setelah logout | | |
| 6.3.3 | Transaksi POS tercatat dan terintegrasi ke akuntansi | | |
| 6.3.4 | Laporan penjualan per cabang dapat diakses oleh manajer | | |
| 6.3.5 | End-of-day closing (tutup kasir) berjalan dengan benar | | |

---

## MODUL 7 — CUSTOMER PORTAL

### 7.1 Konten & CMS
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 7.1.1 | Konten website (homepage, services, products) dapat diedit via admin CMS | | |
| 7.1.2 | Perubahan konten CMS langsung terlihat di portal | | |
| 7.1.3 | Gambar/media di portal tersimpan di object storage dan bisa diakses publik | | |
| 7.1.4 | Sitemap XML ter-generate otomatis dan akurat | | |
| 7.1.5 | Portal mendukung multi-bahasa (ID/EN) dengan benar | | |

### 7.2 Booking & Quote Request
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 7.2.1 | Form booking/quote request bisa disubmit oleh pelanggan tanpa login | | |
| 7.2.2 | Data booking masuk ke sistem sebagai Logistic Order dengan status "new" | | |
| 7.2.3 | Notifikasi ke admin terkirim saat ada booking baru | | |
| 7.2.4 | Kalkulator freight di portal menghitung estimasi biaya dengan benar | | |

### 7.3 Order Tracking
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 7.3.1 | Pelanggan dapat melacak status order via token unik (bukan nomor order yang mudah ditebak) | | |
| 7.3.2 | Informasi yang ditampilkan ke pelanggan tidak mengekspos data internal | | |
| 7.3.3 | Status tracking terupdate real-time | | |

### 7.4 Registrasi & Login Pelanggan
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 7.4.1 | Registrasi pelanggan baru memerlukan verifikasi email/OTP | | |
| 7.4.2 | Login portal menggunakan Supabase Auth yang terpisah dari session internal BizPortal | | |
| 7.4.3 | Pelanggan yang login hanya bisa melihat data order mereka sendiri | | |
| 7.4.4 | Onboarding pelanggan baru memerlukan approval dari admin | | |

---

## MODUL 8 — DRIVER APP (CST Driver Mobile)

### 8.1 Fungsionalitas Driver
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 8.1.1 | Driver hanya bisa melihat job yang di-assign ke mereka | | |
| 8.1.2 | Driver tidak bisa mengakses data order driver lain | | |
| 8.1.3 | Update status job dari driver tersinkron ke BizPortal | | |
| 8.1.4 | Upload foto (POD, general) berfungsi dan tersimpan di object storage | | |
| 8.1.5 | GPS location tracking aktif dan akurat saat job berlangsung | | |
| 8.1.6 | Alert geofence berfungsi ketika driver keluar zona | | |

---

## MODUL 9 — HR & ORGANISASI

### 9.1 Struktur Organisasi
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 9.1.1 | Hierarki organisasi (Holding → Company → Branch → Division → Department → Section) terdefinisi | | |
| 9.1.2 | Setiap karyawan terhubung ke unit organisasi yang tepat | | |
| 9.1.3 | Manager setiap unit terdefinisi dan benar | | |
| 9.1.4 | Kode unik per unit organisasi tidak ada duplikasi | | |

### 9.2 Role & Permission (RBAC)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 9.2.1 | Setiap user hanya memiliki satu role utama yang sesuai jabatannya | | |
| 9.2.2 | Role `owner` hanya dimiliki oleh pemilik/direktur | | |
| 9.2.3 | Role `kasir` hanya bisa akses data cabang sendiri (cross-branch diblokir) | | |
| 9.2.4 | Role `gudang` hanya bisa akses modul inventori yang relevan | | |
| 9.2.5 | Custom roles (jika digunakan) memiliki permission yang tepat dan tidak berlebihan | | |
| 9.2.6 | User yang sudah tidak aktif/resign sudah di-nonaktifkan | | |
| 9.2.7 | Tidak ada user dengan akses admin yang tidak seharusnya | | |

### 9.3 Approval Rules
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 9.3.1 | Approval rules untuk PO sudah dikonfigurasi (threshold per amount) | | |
| 9.3.2 | Approval berjenjang (multi-level) berfungsi dengan benar | | |
| 9.3.3 | Notifikasi approval dikirim ke approver yang benar | | |
| 9.3.4 | PO/PR di atas threshold tidak bisa di-confirm tanpa approval | | |

---

## MODUL 10 — FITUR AI & INTEGRASI

### 10.1 AI Document Scanning (OCR)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 10.1.1 | OCR scan dokumen menggunakan OpenAI via Replit AI Integrations (bukan raw key) | | |
| 10.1.2 | Data hasil scan diverifikasi manual sebelum disimpan | | |
| 10.1.3 | File temp OCR dibersihkan secara otomatis (cleanup scheduler berjalan) | | |
| 10.1.4 | Rate limiting pada endpoint scan agar tidak overuse API | | |

### 10.2 AI Chatbot Customer
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 10.2.1 | Knowledge base chatbot (FAQ, layanan) sudah diisi dan diperbarui | | |
| 10.2.2 | Chatbot tidak memberikan informasi yang salah atau menyesatkan | | |
| 10.2.3 | Session chatbot dibatasi (tidak bisa dipakai sebagai relay proxy ke OpenAI) | | |
| 10.2.4 | Riwayat chat tersimpan dan bisa diaudit oleh admin | | |

### 10.3 WhatsApp Integration (Fonnte)
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 10.3.1 | FONNTE_TOKEN dan FONNTE_ADMIN_WA terkonfigurasi dengan benar | | |
| 10.3.2 | Notifikasi WhatsApp terkirim untuk: new order, status update, payment reminder | | |
| 10.3.3 | Webhook Fonnte memverifikasi autentisitas pengirim sebelum memproses pesan | | |
| 10.3.4 | Nomor WhatsApp admin/group terdaftar di ADMIN_WA_PHONES | | |
| 10.3.5 | AI order intake via WhatsApp terproses dengan benar ke logistic order | | |

### 10.4 Email Integration
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 10.4.1 | SMTP terkonfigurasi (SMTP_HOST, SMTP_USER, SMTP_PASS) | | |
| 10.4.2 | Email notifikasi terkirim untuk: invoice, PO, booking confirmation | | |
| 10.4.3 | IMAP poller berjalan untuk menerima email masuk (jika dikonfigurasi) | | |
| 10.4.4 | Email masuk dilog di correspondence module | | |
| 10.4.5 | Attachment PDF pada email menggunakan generator yang benar | | |

---

## MODUL 11 — KEAMANAN & AKSES

### 11.1 Autentikasi
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 11.1.1 | Login BizPortal (internal) menggunakan Google OIDC (bukan username/password) | | |
| 11.1.2 | Session cookie memiliki SameSite dan Secure flag yang tepat | | |
| 11.1.3 | Session expired setelah inaktivitas | | |
| 11.1.4 | Portal customer menggunakan Supabase Auth yang terpisah dari internal | | |
| 11.1.5 | Bearer token portal tidak bisa dipakai untuk akses route internal BizPortal | | |
| 11.1.6 | Trusted device management berfungsi (jika diaktifkan) | | |

### 11.2 Otorisasi & Data Isolation
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 11.2.1 | Company isolation: user company A tidak bisa akses data company B | | |
| 11.2.2 | Route admin dilindungi `requireAdmin` middleware | | |
| 11.2.3 | Portal admin hanya bisa diakses via email yang ada di PORTAL_ADMIN_EMAILS | | |
| 11.2.4 | Driver hanya bisa akses endpoint driver yang relevan (tidak bisa akses ERP routes) | | |
| 11.2.5 | Endpoint publik tidak mengekspos data internal ERP | | |
| 11.2.6 | Rate limiting aktif pada endpoint yang bisa diakses publik | | |

### 11.3 Audit Trail
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 11.3.1 | Setiap perubahan data penting tercatat di `erp_audit_logs` (userId, action, oldData, newData) | | |
| 11.3.2 | Log audit tidak bisa dihapus oleh user biasa | | |
| 11.3.3 | Activity log untuk logistik (RFQ, order) tersedia dan lengkap | | |
| 11.3.4 | IP address dan user agent tercatat di audit log | | |
| 11.3.5 | Log audit dapat dicari/difilter dari BizPortal | | |

### 11.4 Keamanan Data
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 11.4.1 | Semua environment secrets tersimpan di Replit Secrets (bukan di kode/file) | | |
| 11.4.2 | PORTAL_ADMIN_KEY/PORTAL_ADMIN_EMAILS terkonfigurasi di environment | | |
| 11.4.3 | CASHIER_TOKEN_SECRET unik dan memiliki entropy yang cukup | | |
| 11.4.4 | Koneksi database menggunakan SUPABASE_PG_URL yang aman | | |
| 11.4.5 | Object storage path private tidak bisa diakses tanpa autentikasi | | |
| 11.4.6 | Security headers aktif (X-Content-Type-Options, CSP, HSTS di prod) | | |

---

## MODUL 12 — SISTEM & KONFIGURASI

### 12.1 Konfigurasi Sistem
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 12.1.1 | Nomor dokumen (format PREFIX/YYYY/NNNNNN) terkonfigurasi untuk semua modul | | |
| 12.1.2 | Settings akuntansi (COA defaults, journal defaults) sudah dikonfigurasi per company | | |
| 12.1.3 | Currency default terkonfigurasi (IDR) | | |
| 12.1.4 | Timezone server sesuai (WIB/Asia Jakarta) | | |
| 12.1.5 | UOM dan konversi antar unit sudah terdefinisi lengkap | | |
| 12.1.6 | Margin rules logistik sudah dikonfigurasi per rute/layanan | | |

### 12.2 Notifikasi Sistem
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 12.2.1 | Notifikasi in-app berjalan (admin notifications, user notifications) | | |
| 12.2.2 | ADMIN_EMAILS terdaftar dan menerima notifikasi sistem | | |
| 12.2.3 | Notification log tersimpan di database | | |

### 12.3 Media & Object Storage
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 12.3.1 | Object storage bucket terkonfigurasi (DEFAULT_OBJECT_STORAGE_BUCKET_ID) | | |
| 12.3.2 | File public (gambar produk, logo) dapat diakses tanpa autentikasi | | |
| 12.3.3 | File private (dokumen invoice, BL) memerlukan autentikasi untuk diakses | | |
| 12.3.4 | Media manager berfungsi untuk upload/delete/view aset | | |
| 12.3.5 | Tidak ada file orphan (file di storage yang tidak terhubung ke data apapun) | | |

### 12.4 Short Links & QR Code
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 12.4.1 | Short link untuk tracking order berfungsi (/q/[token]) | | |
| 12.4.2 | Token RFQ vendor (publicRfqToken) berupa string acak yang tidak bisa ditebak | | |
| 12.4.3 | QR code yang digenerate akurat dan dapat discan | | |

---

## MODUL 13 — HOLDING & MULTI-COMPANY

### 13.1 Struktur Holding
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 13.1.1 | CST-GROUP (holding) dan semua anak perusahaan terdefinisi | | |
| 13.1.2 | Data setiap company ter-isolasi (tidak bisa diakses company lain) | | |
| 13.1.3 | User dapat di-assign ke multiple company jika diperlukan | | |

### 13.2 Laporan Konsolidasi
| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 13.2.1 | Holding P&L Report mengagregasi data semua anak perusahaan dengan benar | | |
| 13.2.2 | Holding Cash Flow Report akurat | | |
| 13.2.3 | Ownership percentage dikonfigurasi dan mempengaruhi laporan konsolidasi | | |
| 13.2.4 | Eliminasi transaksi antar-perusahaan (intercompany) diterapkan | | |

---

## MODUL 14 — KORESPONDENSI & CORRESPONDENCE

| # | Item Audit | Status | Temuan |
|---|-----------|--------|--------|
| 14.1 | Email masuk (inbox) tercatat di modul korespondensi | | |
| 14.2 | Email masuk dapat di-link ke Sales Order / Logistic Order yang relevan | | |
| 14.3 | Attachment pada email tersimpan dan dapat diakses | | |
| 14.4 | AI dapat memproses email masuk menjadi draft order secara otomatis | | |
| 14.5 | Korespondensi dapat dicari berdasarkan pengirim, subjek, atau tanggal | | |

---

## RINGKASAN TEMUAN AUDIT

| Modul | Total Item | ✅ OK | ❌ Masalah | ⚠️ Perhatian | N/A |
|-------|-----------|-------|-----------|------------|-----|
| 1. Sales | | | | | |
| 2. Purchase | | | | | |
| 3. Akuntansi | | | | | |
| 4. Logistik | | | | | |
| 5. Inventori | | | | | |
| 6. Thai Tea | | | | | |
| 7. Customer Portal | | | | | |
| 8. Driver App | | | | | |
| 9. HR & Org | | | | | |
| 10. AI & Integrasi | | | | | |
| 11. Keamanan | | | | | |
| 12. Sistem | | | | | |
| 13. Holding | | | | | |
| 14. Korespondensi | | | | | |
| **TOTAL** | | | | | |

---

## DAFTAR TEMUAN KRITIS

> Isi tabel ini hanya untuk item dengan status ❌ atau ⚠️ yang memerlukan tindak lanjut segera.

| # | No. Checklist | Deskripsi Temuan | Tingkat Risiko | Rekomendasi | Deadline | PIC |
|---|--------------|-----------------|---------------|------------|---------|-----|
| 1 | | | Tinggi/Sedang/Rendah | | | |
| 2 | | | | | | |
| 3 | | | | | | |

---

## REKOMENDASI PERBAIKAN

### Prioritas Tinggi (Harus diselesaikan dalam 7 hari)
1. 
2. 

### Prioritas Sedang (Harus diselesaikan dalam 30 hari)
1. 
2. 

### Prioritas Rendah (Dapat dijadwalkan)
1. 
2. 

---

## KESIMPULAN AUDIT

**Skor Kepatuhan Keseluruhan:** _____ / 100

**Status:**
- [ ] LULUS — Sistem berjalan sesuai standar
- [ ] LULUS BERSYARAT — Ada temuan minor yang perlu diperbaiki
- [ ] TIDAK LULUS — Ada temuan kritis yang harus segera ditangani

**Catatan Auditor:**

_______________________________________________
_______________________________________________
_______________________________________________

---

**Tanda Tangan:**

| Auditor | Direktur/Pengesah |
|---------|------------------|
| | |
| Nama: ___________ | Nama: ___________ |
| Tanggal: _________ | Tanggal: _________ |

---
*Dokumen ini dibuat otomatis berdasarkan analisis sistem BizPortal ERP — CST Logistics*
