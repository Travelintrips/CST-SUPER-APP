export interface AuditItem {
  id: string;
  text: string;
}

export interface AuditSection {
  id: string;
  title: string;
  items: AuditItem[];
}

export interface AuditModule {
  id: string;
  title: string;
  icon: string;
  sections: AuditSection[];
}

export const AUDIT_MODULES: AuditModule[] = [
  {
    id: "1",
    title: "Sales (Penjualan)",
    icon: "📈",
    sections: [
      {
        id: "1.1",
        title: "Master Data Pelanggan",
        items: [
          { id: "1.1.1", text: "Data pelanggan lengkap (nama, alamat, kontak, email, NPWP)" },
          { id: "1.1.2", text: "Tidak ada duplikasi data pelanggan" },
          { id: "1.1.3", text: "Pelanggan non-aktif telah di-flag/dinonaktifkan" },
          { id: "1.1.4", text: "Credit limit pelanggan terdefinisi dan diterapkan" },
          { id: "1.1.5", text: "Segmentasi pelanggan (kategori/group) sesuai" },
        ],
      },
      {
        id: "1.2",
        title: "Quotation (Penawaran)",
        items: [
          { id: "1.2.1", text: "Semua quotation memiliki nomor dokumen unik (format QUO/YYYY/NNNNNN)" },
          { id: "1.2.2", text: "Tidak ada quotation draft lebih dari 30 hari tanpa tindak lanjut" },
          { id: "1.2.3", text: "Harga pada quotation sesuai dengan price list yang berlaku" },
          { id: "1.2.4", text: "Diskon yang diberikan memiliki otorisasi yang tepat" },
          { id: "1.2.5", text: "Quotation yang kadaluarsa telah di-cancel atau diperbarui" },
          { id: "1.2.6", text: "AI-generated drafts telah diverifikasi manual sebelum dikirim ke pelanggan" },
          { id: "1.2.7", text: "Pajak (PPN) dihitung dengan benar pada setiap baris" },
          { id: "1.2.8", text: "UOM (satuan) pada line item sesuai dan konsisten" },
        ],
      },
      {
        id: "1.3",
        title: "Sales Order (Pesanan Penjualan)",
        items: [
          { id: "1.3.1", text: "Setiap Sales Order memiliki referensi Quotation yang sah" },
          { id: "1.3.2", text: "Sales Order yang dikonfirmasi memiliki approval yang sesuai" },
          { id: "1.3.3", text: "Tidak ada SO confirmed tanpa progres delivery > 14 hari" },
          { id: "1.3.4", text: "ETD/ETA tercatat pada setiap SO logistik" },
          { id: "1.3.5", text: "SO yang di-cancel memiliki alasan dan otorisasi yang jelas" },
          { id: "1.3.6", text: "Linkage SO → Logistic Order berfungsi dan sinkron" },
        ],
      },
      {
        id: "1.4",
        title: "Invoice (Faktur Penjualan)",
        items: [
          { id: "1.4.1", text: "Setiap invoice memiliki nomor unik dan berurutan" },
          { id: "1.4.2", text: "Invoice terhubung ke SO/Quotation yang valid" },
          { id: "1.4.3", text: "Tanggal invoice ≥ tanggal SO" },
          { id: "1.4.4", text: "Due date tercatat dan sesuai term of payment" },
          { id: "1.4.5", text: "Invoice yang sudah paid statusnya 'done'" },
          { id: "1.4.6", text: "Tidak ada invoice yang di-edit setelah dikirim tanpa reversal" },
          { id: "1.4.7", text: "Grand total invoice = subtotal + PPN − diskon" },
          { id: "1.4.8", text: "Jurnal otomatis terposting saat invoice dikonfirmasi (DR: AR, CR: Pendapatan)" },
          { id: "1.4.9", text: "Faktur Pajak (e-faktur) diterbitkan untuk setiap invoice ber-PPN" },
        ],
      },
      {
        id: "1.5",
        title: "Piutang (Accounts Receivable)",
        items: [
          { id: "1.5.1", text: "AR aging report akurat — saldo sesuai dengan invoice outstanding" },
          { id: "1.5.2", text: "Tidak ada piutang overdue > 90 hari tanpa tindakan penagihan" },
          { id: "1.5.3", text: "Pembayaran dari pelanggan langsung di-apply ke invoice yang tepat" },
          { id: "1.5.4", text: "Advance payment (uang muka) tercatat sebagai hutang ke pelanggan" },
        ],
      },
    ],
  },
  {
    id: "2",
    title: "Purchase (Pembelian)",
    icon: "🛒",
    sections: [
      {
        id: "2.1",
        title: "Master Data Vendor/Supplier",
        items: [
          { id: "2.1.1", text: "Data vendor lengkap (nama, alamat, kontak, NPWP, rekening bank)" },
          { id: "2.1.2", text: "Vendor aktif memiliki service type yang benar (purchase/logistics)" },
          { id: "2.1.3", text: "Tidak ada duplikasi vendor" },
          { id: "2.1.4", text: "Vendor catalog items (etalase) harga dasar, markup, dan harga jual akurat" },
          { id: "2.1.5", text: "Vendor non-aktif sudah di-flag isActive = false" },
        ],
      },
      {
        id: "2.2",
        title: "Purchase Request (PR)",
        items: [
          { id: "2.2.1", text: "PR dibuat oleh requester yang berwenang sesuai departemen" },
          { id: "2.2.2", text: "PR memiliki keterangan kebutuhan yang jelas (item, qty, spesifikasi)" },
          { id: "2.2.3", text: "PR memiliki approval dari manajer/atasan sebelum menjadi RFQ" },
          { id: "2.2.4", text: "Approval rules berdasarkan nilai (amount threshold) berfungsi" },
          { id: "2.2.5", text: "PR yang ditolak memiliki alasan yang terdokumentasi" },
          { id: "2.2.6", text: "Tidak ada PR pending > 7 hari tanpa tindak lanjut" },
        ],
      },
      {
        id: "2.3",
        title: "RFQ (Request for Quotation)",
        items: [
          { id: "2.3.1", text: "Minimum 3 vendor diundang untuk setiap RFQ di atas threshold" },
          { id: "2.3.2", text: "RFQ dikirimkan ke vendor via WhatsApp/email dan tercatat di sistem" },
          { id: "2.3.3", text: "Vendor response tercatat lengkap (harga, lead time, syarat)" },
          { id: "2.3.4", text: "Vendor comparison matrix tersedia dan digunakan" },
          { id: "2.3.5", text: "Pemilihan vendor terpilih memiliki justifikasi" },
        ],
      },
      {
        id: "2.4",
        title: "Purchase Order (PO)",
        items: [
          { id: "2.4.1", text: "PO hanya dibuat dari RFQ yang sudah disetujui" },
          { id: "2.4.2", text: "Harga PO sesuai dengan harga yang disetujui di RFQ" },
          { id: "2.4.3", text: "PO memiliki tanda tangan/approval sesuai kewenangan" },
          { id: "2.4.4", text: "PO dikirim ke vendor dan ada konfirmasi penerimaan" },
          { id: "2.4.5", text: "Perubahan PO (amandemen) melalui proses approval ulang" },
          { id: "2.4.6", text: "Expected delivery date tercatat di setiap PO" },
        ],
      },
      {
        id: "2.5",
        title: "Goods Receipt (GR) & QC",
        items: [
          { id: "2.5.1", text: "GR hanya bisa dibuat jika ada PO yang sudah dikonfirmasi" },
          { id: "2.5.2", text: "Qty yang diterima dicek dengan PO (tidak melebihi qty PO)" },
          { id: "2.5.3", text: "Proses QC dilakukan sebelum barang masuk gudang resmi" },
          { id: "2.5.4", text: "Barang yang reject/tidak sesuai dikembalikan ke vendor (Return PO)" },
          { id: "2.5.5", text: "Saat GR dikonfirmasi, stok bertambah otomatis di warehouse" },
          { id: "2.5.6", text: "Jurnal GR/IR accrual terposting (DR: Inventory, CR: GR/IR Clearing)" },
        ],
      },
      {
        id: "2.6",
        title: "Vendor Bills & Landed Costs",
        items: [
          { id: "2.6.1", text: "Tagihan vendor di-match dengan PO dan GR sebelum di-approve" },
          { id: "2.6.2", text: "Tiga-way matching (PO vs GR vs Bill) berfungsi dan diterapkan" },
          { id: "2.6.3", text: "Landed cost (biaya pengiriman, bea cukai, dll.) dialokasikan ke item" },
          { id: "2.6.4", text: "Jurnal hutang otomatis terposting saat bill dikonfirmasi (DR: Inventory, CR: AP)" },
          { id: "2.6.5", text: "GR/IR clearing account dibersihkan saat bill diposting" },
        ],
      },
      {
        id: "2.7",
        title: "Hutang Usaha (Accounts Payable)",
        items: [
          { id: "2.7.1", text: "AP aging report akurat — saldo sesuai dengan tagihan outstanding" },
          { id: "2.7.2", text: "Tidak ada hutang overdue tanpa jadwal pembayaran" },
          { id: "2.7.3", text: "Pembayaran ke vendor langsung di-apply ke bill yang tepat" },
          { id: "2.7.4", text: "Advance payment ke vendor tercatat sebagai uang muka (prepaid)" },
        ],
      },
    ],
  },
  {
    id: "3",
    title: "Akuntansi & Keuangan",
    icon: "📊",
    sections: [
      {
        id: "3.1",
        title: "Chart of Accounts (Bagan Akun)",
        items: [
          { id: "3.1.1", text: "COA sesuai standar akuntansi Indonesia (PSAK)" },
          { id: "3.1.2", text: "Tidak ada akun duplikat atau kode akun yang tumpang tindih" },
          { id: "3.1.3", text: "Setiap akun memiliki tipe yang benar (asset/liability/equity/revenue/expense)" },
          { id: "3.1.4", text: "Akun-akun default pada Accounting Settings sudah dikonfigurasi (AR, AP, Sales, COGS, Bank, Cash)" },
          { id: "3.1.5", text: "Akun PPN Input dan PPN Output sudah terdefinisi" },
          { id: "3.1.6", text: "GR/IR Clearing Account sudah dikonfigurasi" },
          { id: "3.1.7", text: "Akun yang sudah tidak dipakai di-nonaktifkan" },
        ],
      },
      {
        id: "3.2",
        title: "Jurnal & Entri Akuntansi",
        items: [
          { id: "3.2.1", text: "Setiap jurnal memiliki total debit = total kredit (balance)" },
          { id: "3.2.2", text: "Jurnal otomatis dari modul lain (sales, purchase, payment) terposting dengan benar" },
          { id: "3.2.3", text: "Jurnal manual hanya dibuat oleh user yang berwenang" },
          { id: "3.2.4", text: "Tidak ada jurnal yang di-delete — reversal digunakan untuk koreksi" },
          { id: "3.2.5", text: "Source reference (source_id, source_type) terhubung ke dokumen asal" },
          { id: "3.2.6", text: "Jurnal COGS (DR: COGS, CR: Inventory) terposting saat delivery" },
          { id: "3.2.7", text: "Jurnal stock opname dan adjustment tercatat dengan benar" },
          { id: "3.2.8", text: "Entri jurnal memiliki description/narasi yang informatif" },
        ],
      },
      {
        id: "3.3",
        title: "Pajak (Tax)",
        items: [
          { id: "3.3.1", text: "Rate PPN terkonfigurasi dengan benar (11%)" },
          { id: "3.3.2", text: "PPN keluaran (sales) terhitung dan terposting ke akun yang benar" },
          { id: "3.3.3", text: "PPN masukan (purchase) terhitung dan terposting ke akun yang benar" },
          { id: "3.3.4", text: "Perhitungan PPh (withholding tax) sudah dikonfigurasi jika ada" },
          { id: "3.3.5", text: "Rekonsiliasi PPN bulanan dapat dijalankan dari laporan" },
        ],
      },
      {
        id: "3.4",
        title: "Pembayaran (Payments)",
        items: [
          { id: "3.4.1", text: "Setiap pembayaran masuk (inbound) terhubung ke invoice AR yang benar" },
          { id: "3.4.2", text: "Setiap pembayaran keluar (outbound) terhubung ke bill AP yang benar" },
          { id: "3.4.3", text: "Pembayaran via kas dan bank dicatat pada jurnal yang berbeda" },
          { id: "3.4.4", text: "Jurnal pembayaran terposting (DR: Cash/Bank, CR: AR) untuk inbound" },
          { id: "3.4.5", text: "Jurnal pembayaran terposting (DR: AP, CR: Cash/Bank) untuk outbound" },
          { id: "3.4.6", text: "Saldo kas/bank pada sistem sesuai dengan rekening koran aktual" },
          { id: "3.4.7", text: "Pembayaran parsial (cicilan) ditangani dengan benar" },
        ],
      },
      {
        id: "3.5",
        title: "Rekonsiliasi Bank",
        items: [
          { id: "3.5.1", text: "Rekonsiliasi bank dilakukan minimal bulanan" },
          { id: "3.5.2", text: "Tidak ada transaksi yang sudah lama outstanding di rekonsiliasi" },
          { id: "3.5.3", text: "Selisih rekonsiliasi (jika ada) sudah diinvestigasi dan diselesaikan" },
        ],
      },
      {
        id: "3.6",
        title: "Laporan Keuangan",
        items: [
          { id: "3.6.1", text: "Neraca (Balance Sheet): Total Aset = Total Liabilitas + Ekuitas" },
          { id: "3.6.2", text: "Laba Rugi (P&L): Pendapatan, COGS, dan Beban diklasifikasi dengan benar" },
          { id: "3.6.3", text: "Trial Balance: Tidak ada akun dengan saldo abnormal" },
          { id: "3.6.4", text: "General Ledger: Setiap transaksi dapat ditelusuri ke dokumen sumber" },
          { id: "3.6.5", text: "Laporan Holding (konsolidasi antar perusahaan) saldo sesuai" },
          { id: "3.6.6", text: "Laporan dapat difilter per periode, per perusahaan, per cabang" },
          { id: "3.6.7", text: "Laba bersih YTD pada Balance Sheet = Net Income di P&L" },
        ],
      },
    ],
  },
  {
    id: "4",
    title: "Logistik & Freight",
    icon: "🚢",
    sections: [
      {
        id: "4.1",
        title: "Logistic Orders (Pesanan Logistik)",
        items: [
          { id: "4.1.1", text: "Setiap order memiliki nomor unik dan token publik (publicRfqToken)" },
          { id: "4.1.2", text: "Detail shipper dan consignee lengkap" },
          { id: "4.1.3", text: "Status order mengalir secara runtut (new → quoted → confirmed → delivered)" },
          { id: "4.1.4", text: "Order yang dibatalkan memiliki alasan yang terdokumentasi" },
          { id: "4.1.5", text: "Customer portal dapat melacak status order via tracking link" },
          { id: "4.1.6", text: "Notifikasi WhatsApp/email terkirim ke pelanggan pada perubahan status" },
          { id: "4.1.7", text: "Order type (shipment/trucking/dll.) terisi dengan benar" },
        ],
      },
      {
        id: "4.2",
        title: "Freight Forwarding",
        items: [
          { id: "4.2.1", text: "Nomor freight shipment unik dan berurutan" },
          { id: "4.2.2", text: "Mode transportasi (Sea/Air/Land) terisi benar" },
          { id: "4.2.3", text: "Port of loading dan port of discharge terisi" },
          { id: "4.2.4", text: "Vessel/voyage/AWB number tercatat" },
          { id: "4.2.5", text: "Komoditas, berat bruto/netto, dan volume tercatat" },
          { id: "4.2.6", text: "Bill of Lading (BL) dapat digenerate dan sudah diverifikasi" },
          { id: "4.2.7", text: "Stage tracking (milestone) perjalanan tercatat dan akurat" },
          { id: "4.2.8", text: "Dokumen kepabeanan terlampir untuk shipment internasional" },
          { id: "4.2.9", text: "Analisis profitabilitas per shipment (pendapatan vs. biaya operasional) tersedia" },
        ],
      },
      {
        id: "4.3",
        title: "RFQ Vendor Logistik",
        items: [
          { id: "4.3.1", text: "RFQ dikirim ke minimal 2 vendor untuk setiap shipment" },
          { id: "4.3.2", text: "Vendor response (quote) tercatat lengkap di sistem" },
          { id: "4.3.3", text: "Margin rules diterapkan dengan benar pada vendor quote → harga customer" },
          { id: "4.3.4", text: "Perbandingan vendor quote tersedia (RFQ comparison view)" },
          { id: "4.3.5", text: "Vendor yang dipilih dinotifikasi via WhatsApp/email" },
        ],
      },
      {
        id: "4.4",
        title: "Driver & Internal Tasks",
        items: [
          { id: "4.4.1", text: "Driver assignment tercatat dengan jelas per job" },
          { id: "4.4.2", text: "Status job driver mengalir: ASSIGNED → PICKED_UP → DELIVERED" },
          { id: "4.4.3", text: "POD (Proof of Delivery) foto terupload untuk setiap job selesai" },
          { id: "4.4.4", text: "GPS tracking berfungsi dan lokasi driver terekam" },
          { id: "4.4.5", text: "Geofence alerts berfungsi dan diteruskan ke admin" },
          { id: "4.4.6", text: "Laporan performa driver (ketepatan waktu, jumlah job) tersedia" },
          { id: "4.4.7", text: "Internal task terassign dan statusnya terlacak" },
        ],
      },
    ],
  },
  {
    id: "5",
    title: "Inventori & Gudang",
    icon: "📦",
    sections: [
      {
        id: "5.1",
        title: "Master Data Produk",
        items: [
          { id: "5.1.1", text: "Setiap produk memiliki kode/SKU unik" },
          { id: "5.1.2", text: "UOM (Unit of Measure) produk terdefinisi dan ada konversi yang benar" },
          { id: "5.1.3", text: "Kategori produk terklasifikasi dengan benar" },
          { id: "5.1.4", text: "Harga beli (average cost) dan harga jual tersedia dan akurat" },
          { id: "5.1.5", text: "Produk non-aktif sudah di-flag" },
          { id: "5.1.6", text: "Gambar produk (jika ada) terupload di object storage dengan benar" },
        ],
      },
      {
        id: "5.2",
        title: "Stok & Pergerakan Barang",
        items: [
          { id: "5.2.1", text: "Saldo stok pada sistem sesuai dengan stok fisik (cek via opname)" },
          { id: "5.2.2", text: "Setiap pergerakan stok (masuk/keluar) tercatat di stock_movements" },
          { id: "5.2.3", text: "Stok tidak pernah negatif" },
          { id: "5.2.4", text: "Stok reserved (dari SO yang belum deliver) dikalkulasi dengan benar" },
          { id: "5.2.5", text: "Stok available = stok on hand − stok reserved" },
          { id: "5.2.6", text: "Minimum stock level dikonfigurasi dan alert berjalan" },
          { id: "5.2.7", text: "Average cost diupdate dengan benar setiap ada pembelian baru" },
        ],
      },
      {
        id: "5.3",
        title: "Warehouse Management",
        items: [
          { id: "5.3.1", text: "Warehouse aktif terdefinisi dengan tipe yang benar (Central/Branch/Outlet)" },
          { id: "5.3.2", text: "Hak akses gudang per role sudah dibatasi per branch" },
          { id: "5.3.3", text: "Transfer antar gudang dicatat dengan benar (keluar dari sumber, masuk ke tujuan)" },
        ],
      },
      {
        id: "5.4",
        title: "Stock Opname",
        items: [
          { id: "5.4.1", text: "Opname dilakukan secara berkala (minimal per kuartal)" },
          { id: "5.4.2", text: "Selisih opname (variance) dicatat dan diselidiki" },
          { id: "5.4.3", text: "Adjustment stok dari opname memiliki approval dan jurnal yang benar" },
          { id: "5.4.4", text: "Barang rusak (damage) dicatat terpisah dan ada jurnal expense" },
        ],
      },
    ],
  },
  {
    id: "6",
    title: "Thai Tea / F&B",
    icon: "🧋",
    sections: [
      {
        id: "6.1",
        title: "Master Data F&B",
        items: [
          { id: "6.1.1", text: "Semua cabang Thai Tea terdaftar dengan nama dan alamat benar" },
          { id: "6.1.2", text: "Resep (BOM) untuk setiap produk jadi terdefinisi lengkap" },
          { id: "6.1.3", text: "Yield quantity dan unit pada resep akurat" },
          { id: "6.1.4", text: "Ingredient setiap resep lengkap dengan qty dan unit" },
        ],
      },
      {
        id: "6.2",
        title: "Produksi & Konsumsi Bahan",
        items: [
          { id: "6.2.1", text: "Saat produk resep terjual di POS, bahan baku berkurang otomatis" },
          { id: "6.2.2", text: "Konsumsi bahan baku aktual sesuai dengan resep yang terdefinisi" },
          { id: "6.2.3", text: "Produksi tercatat per cabang dan per tanggal" },
          { id: "6.2.4", text: "Stok bahan baku di setiap cabang akurat" },
        ],
      },
      {
        id: "6.3",
        title: "POS (Point of Sale)",
        items: [
          { id: "6.3.1", text: "Kasir hanya bisa akses data cabang yang ditugaskan" },
          { id: "6.3.2", text: "Token kasir tidak bisa dipalsukan atau di-reuse setelah logout" },
          { id: "6.3.3", text: "Transaksi POS tercatat dan terintegrasi ke akuntansi" },
          { id: "6.3.4", text: "Laporan penjualan per cabang dapat diakses oleh manajer" },
          { id: "6.3.5", text: "End-of-day closing (tutup kasir) berjalan dengan benar" },
        ],
      },
    ],
  },
  {
    id: "7",
    title: "Customer Portal",
    icon: "🌐",
    sections: [
      {
        id: "7.1",
        title: "Konten & CMS",
        items: [
          { id: "7.1.1", text: "Konten website (homepage, services, products) dapat diedit via admin CMS" },
          { id: "7.1.2", text: "Perubahan konten CMS langsung terlihat di portal" },
          { id: "7.1.3", text: "Gambar/media di portal tersimpan di object storage dan bisa diakses publik" },
          { id: "7.1.4", text: "Sitemap XML ter-generate otomatis dan akurat" },
          { id: "7.1.5", text: "Portal mendukung multi-bahasa (ID/EN) dengan benar" },
        ],
      },
      {
        id: "7.2",
        title: "Booking & Quote Request",
        items: [
          { id: "7.2.1", text: "Form booking/quote request bisa disubmit pelanggan tanpa login" },
          { id: "7.2.2", text: "Data booking masuk ke sistem sebagai Logistic Order dengan status 'new'" },
          { id: "7.2.3", text: "Notifikasi ke admin terkirim saat ada booking baru" },
          { id: "7.2.4", text: "Kalkulator freight di portal menghitung estimasi biaya dengan benar" },
        ],
      },
      {
        id: "7.3",
        title: "Order Tracking",
        items: [
          { id: "7.3.1", text: "Pelanggan dapat melacak status order via token unik (bukan nomor order)" },
          { id: "7.3.2", text: "Informasi yang ditampilkan ke pelanggan tidak mengekspos data internal" },
          { id: "7.3.3", text: "Status tracking terupdate real-time" },
        ],
      },
      {
        id: "7.4",
        title: "Registrasi & Login Pelanggan",
        items: [
          { id: "7.4.1", text: "Registrasi pelanggan baru memerlukan verifikasi email/OTP" },
          { id: "7.4.2", text: "Login portal menggunakan auth yang terpisah dari session internal BizPortal" },
          { id: "7.4.3", text: "Pelanggan yang login hanya bisa melihat data order mereka sendiri" },
          { id: "7.4.4", text: "Onboarding pelanggan baru memerlukan approval dari admin" },
        ],
      },
    ],
  },
  {
    id: "8",
    title: "Driver App (CST Driver Mobile)",
    icon: "🚗",
    sections: [
      {
        id: "8.1",
        title: "Fungsionalitas Driver",
        items: [
          { id: "8.1.1", text: "Driver hanya bisa melihat job yang di-assign ke mereka" },
          { id: "8.1.2", text: "Driver tidak bisa mengakses data order driver lain" },
          { id: "8.1.3", text: "Update status job dari driver tersinkron ke BizPortal" },
          { id: "8.1.4", text: "Upload foto (POD, general) berfungsi dan tersimpan di object storage" },
          { id: "8.1.5", text: "GPS location tracking aktif dan akurat saat job berlangsung" },
          { id: "8.1.6", text: "Alert geofence berfungsi ketika driver keluar zona" },
        ],
      },
    ],
  },
  {
    id: "9",
    title: "HR & Organisasi",
    icon: "🏢",
    sections: [
      {
        id: "9.1",
        title: "Struktur Organisasi",
        items: [
          { id: "9.1.1", text: "Hierarki organisasi (Holding → Company → Branch → Division → Dept → Section) terdefinisi" },
          { id: "9.1.2", text: "Setiap karyawan terhubung ke unit organisasi yang tepat" },
          { id: "9.1.3", text: "Manager setiap unit terdefinisi dan benar" },
          { id: "9.1.4", text: "Kode unik per unit organisasi tidak ada duplikasi" },
        ],
      },
      {
        id: "9.2",
        title: "Role & Permission (RBAC)",
        items: [
          { id: "9.2.1", text: "Setiap user hanya memiliki satu role utama yang sesuai jabatannya" },
          { id: "9.2.2", text: "Role 'owner' hanya dimiliki oleh pemilik/direktur" },
          { id: "9.2.3", text: "Role 'kasir' hanya bisa akses data cabang sendiri (cross-branch diblokir)" },
          { id: "9.2.4", text: "Role 'gudang' hanya bisa akses modul inventori yang relevan" },
          { id: "9.2.5", text: "Custom roles (jika digunakan) memiliki permission yang tepat dan tidak berlebihan" },
          { id: "9.2.6", text: "User yang sudah tidak aktif/resign sudah di-nonaktifkan" },
          { id: "9.2.7", text: "Tidak ada user dengan akses admin yang tidak seharusnya" },
        ],
      },
      {
        id: "9.3",
        title: "Approval Rules",
        items: [
          { id: "9.3.1", text: "Approval rules untuk PO sudah dikonfigurasi (threshold per amount)" },
          { id: "9.3.2", text: "Approval berjenjang (multi-level) berfungsi dengan benar" },
          { id: "9.3.3", text: "Notifikasi approval dikirim ke approver yang benar" },
          { id: "9.3.4", text: "PO/PR di atas threshold tidak bisa di-confirm tanpa approval" },
        ],
      },
    ],
  },
  {
    id: "10",
    title: "Fitur AI & Integrasi",
    icon: "🤖",
    sections: [
      {
        id: "10.1",
        title: "AI Document Scanning (OCR)",
        items: [
          { id: "10.1.1", text: "OCR scan dokumen menggunakan OpenAI via Replit AI Integrations (bukan raw key)" },
          { id: "10.1.2", text: "Data hasil scan diverifikasi manual sebelum disimpan" },
          { id: "10.1.3", text: "File temp OCR dibersihkan secara otomatis (cleanup scheduler berjalan)" },
          { id: "10.1.4", text: "Rate limiting pada endpoint scan agar tidak overuse API" },
        ],
      },
      {
        id: "10.2",
        title: "AI Chatbot Customer",
        items: [
          { id: "10.2.1", text: "Knowledge base chatbot (FAQ, layanan) sudah diisi dan diperbarui" },
          { id: "10.2.2", text: "Chatbot tidak memberikan informasi yang salah atau menyesatkan" },
          { id: "10.2.3", text: "Session chatbot dibatasi (tidak bisa dipakai sebagai relay proxy ke OpenAI)" },
          { id: "10.2.4", text: "Riwayat chat tersimpan dan bisa diaudit oleh admin" },
        ],
      },
      {
        id: "10.3",
        title: "WhatsApp Integration (Fonnte)",
        items: [
          { id: "10.3.1", text: "FONNTE_TOKEN dan FONNTE_ADMIN_WA terkonfigurasi dengan benar" },
          { id: "10.3.2", text: "Notifikasi WhatsApp terkirim untuk: new order, status update, payment reminder" },
          { id: "10.3.3", text: "Webhook Fonnte memverifikasi autentisitas pengirim sebelum memproses pesan" },
          { id: "10.3.4", text: "Nomor WhatsApp admin/group terdaftar di ADMIN_WA_PHONES" },
          { id: "10.3.5", text: "AI order intake via WhatsApp terproses dengan benar ke logistic order" },
        ],
      },
      {
        id: "10.4",
        title: "Email Integration",
        items: [
          { id: "10.4.1", text: "SMTP terkonfigurasi (SMTP_HOST, SMTP_USER, SMTP_PASS)" },
          { id: "10.4.2", text: "Email notifikasi terkirim untuk: invoice, PO, booking confirmation" },
          { id: "10.4.3", text: "IMAP poller berjalan untuk menerima email masuk (jika dikonfigurasi)" },
          { id: "10.4.4", text: "Email masuk dilog di correspondence module" },
          { id: "10.4.5", text: "Attachment PDF pada email menggunakan generator yang benar" },
        ],
      },
    ],
  },
  {
    id: "11",
    title: "Keamanan & Akses",
    icon: "🔒",
    sections: [
      {
        id: "11.1",
        title: "Autentikasi",
        items: [
          { id: "11.1.1", text: "Login BizPortal (internal) menggunakan Google OIDC (bukan username/password biasa)" },
          { id: "11.1.2", text: "Session cookie memiliki SameSite dan Secure flag yang tepat" },
          { id: "11.1.3", text: "Session expired setelah inaktivitas" },
          { id: "11.1.4", text: "Portal customer menggunakan auth yang terpisah dari internal" },
          { id: "11.1.5", text: "Bearer token portal tidak bisa dipakai untuk akses route internal BizPortal" },
          { id: "11.1.6", text: "Trusted device management berfungsi (jika diaktifkan)" },
        ],
      },
      {
        id: "11.2",
        title: "Otorisasi & Data Isolation",
        items: [
          { id: "11.2.1", text: "Company isolation: user company A tidak bisa akses data company B" },
          { id: "11.2.2", text: "Route admin dilindungi requireAdmin middleware" },
          { id: "11.2.3", text: "Portal admin hanya bisa diakses via email yang ada di PORTAL_ADMIN_EMAILS" },
          { id: "11.2.4", text: "Driver hanya bisa akses endpoint driver yang relevan (tidak bisa akses ERP routes)" },
          { id: "11.2.5", text: "Endpoint publik tidak mengekspos data internal ERP" },
          { id: "11.2.6", text: "Rate limiting aktif pada endpoint yang bisa diakses publik" },
        ],
      },
      {
        id: "11.3",
        title: "Audit Trail",
        items: [
          { id: "11.3.1", text: "Setiap perubahan data penting tercatat di erp_audit_logs (userId, action, oldData, newData)" },
          { id: "11.3.2", text: "Log audit tidak bisa dihapus oleh user biasa" },
          { id: "11.3.3", text: "Activity log untuk logistik (RFQ, order) tersedia dan lengkap" },
          { id: "11.3.4", text: "IP address dan user agent tercatat di audit log" },
          { id: "11.3.5", text: "Log audit dapat dicari/difilter dari BizPortal" },
        ],
      },
      {
        id: "11.4",
        title: "Keamanan Data",
        items: [
          { id: "11.4.1", text: "Semua environment secrets tersimpan di Replit Secrets (bukan di kode/file)" },
          { id: "11.4.2", text: "PORTAL_ADMIN_KEY/PORTAL_ADMIN_EMAILS terkonfigurasi di environment" },
          { id: "11.4.3", text: "CASHIER_TOKEN_SECRET unik dan memiliki entropy yang cukup" },
          { id: "11.4.4", text: "Koneksi database menggunakan SUPABASE_PG_URL yang aman" },
          { id: "11.4.5", text: "Object storage path private tidak bisa diakses tanpa autentikasi" },
          { id: "11.4.6", text: "Security headers aktif (X-Content-Type-Options, CSP, HSTS di prod)" },
        ],
      },
    ],
  },
  {
    id: "12",
    title: "Sistem & Konfigurasi",
    icon: "⚙️",
    sections: [
      {
        id: "12.1",
        title: "Konfigurasi Sistem",
        items: [
          { id: "12.1.1", text: "Nomor dokumen (format PREFIX/YYYY/NNNNNN) terkonfigurasi untuk semua modul" },
          { id: "12.1.2", text: "Settings akuntansi (COA defaults, journal defaults) sudah dikonfigurasi per company" },
          { id: "12.1.3", text: "Currency default terkonfigurasi (IDR)" },
          { id: "12.1.4", text: "Timezone server sesuai (WIB/Asia Jakarta)" },
          { id: "12.1.5", text: "UOM dan konversi antar unit sudah terdefinisi lengkap" },
          { id: "12.1.6", text: "Margin rules logistik sudah dikonfigurasi per rute/layanan" },
        ],
      },
      {
        id: "12.2",
        title: "Notifikasi Sistem",
        items: [
          { id: "12.2.1", text: "Notifikasi in-app berjalan (admin notifications, user notifications)" },
          { id: "12.2.2", text: "ADMIN_EMAILS terdaftar dan menerima notifikasi sistem" },
          { id: "12.2.3", text: "Notification log tersimpan di database" },
        ],
      },
      {
        id: "12.3",
        title: "Media & Object Storage",
        items: [
          { id: "12.3.1", text: "Object storage bucket terkonfigurasi (DEFAULT_OBJECT_STORAGE_BUCKET_ID)" },
          { id: "12.3.2", text: "File public (gambar produk, logo) dapat diakses tanpa autentikasi" },
          { id: "12.3.3", text: "File private (dokumen invoice, BL) memerlukan autentikasi untuk diakses" },
          { id: "12.3.4", text: "Media manager berfungsi untuk upload/delete/view aset" },
          { id: "12.3.5", text: "Tidak ada file orphan (file di storage yang tidak terhubung ke data apapun)" },
        ],
      },
      {
        id: "12.4",
        title: "Short Links & QR Code",
        items: [
          { id: "12.4.1", text: "Short link untuk tracking order berfungsi (/q/[token])" },
          { id: "12.4.2", text: "Token RFQ vendor (publicRfqToken) berupa string acak yang tidak bisa ditebak" },
          { id: "12.4.3", text: "QR code yang digenerate akurat dan dapat discan" },
        ],
      },
    ],
  },
  {
    id: "13",
    title: "Holding & Multi-Company",
    icon: "🏗️",
    sections: [
      {
        id: "13.1",
        title: "Struktur Holding",
        items: [
          { id: "13.1.1", text: "CST-GROUP (holding) dan semua anak perusahaan terdefinisi" },
          { id: "13.1.2", text: "Data setiap company ter-isolasi (tidak bisa diakses company lain)" },
          { id: "13.1.3", text: "User dapat di-assign ke multiple company jika diperlukan" },
        ],
      },
      {
        id: "13.2",
        title: "Laporan Konsolidasi",
        items: [
          { id: "13.2.1", text: "Holding P&L Report mengagregasi data semua anak perusahaan dengan benar" },
          { id: "13.2.2", text: "Holding Cash Flow Report akurat" },
          { id: "13.2.3", text: "Ownership percentage dikonfigurasi dan mempengaruhi laporan konsolidasi" },
          { id: "13.2.4", text: "Eliminasi transaksi antar-perusahaan (intercompany) diterapkan" },
        ],
      },
    ],
  },
  {
    id: "14",
    title: "Korespondensi",
    icon: "✉️",
    sections: [
      {
        id: "14.1",
        title: "Email & Korespondensi",
        items: [
          { id: "14.1.1", text: "Email masuk (inbox) tercatat di modul korespondensi" },
          { id: "14.1.2", text: "Email masuk dapat di-link ke Sales Order / Logistic Order yang relevan" },
          { id: "14.1.3", text: "Attachment pada email tersimpan dan dapat diakses" },
          { id: "14.1.4", text: "AI dapat memproses email masuk menjadi draft order secara otomatis" },
          { id: "14.1.5", text: "Korespondensi dapat dicari berdasarkan pengirim, subjek, atau tanggal" },
        ],
      },
    ],
  },
];

export const TOTAL_ITEMS = AUDIT_MODULES.reduce(
  (sum, m) => sum + m.sections.reduce((s2, sec) => s2 + sec.items.length, 0),
  0,
);

export function getAllItems(): AuditItem[] {
  return AUDIT_MODULES.flatMap(m => m.sections.flatMap(s => s.items));
}

export const STATUS_CONFIG = {
  ok:      { label: "OK",       emoji: "✅", color: "bg-green-100 text-green-800 border-green-300", ring: "ring-green-500" },
  not_ok:  { label: "Masalah",  emoji: "❌", color: "bg-red-100 text-red-800 border-red-300",      ring: "ring-red-500"   },
  warning: { label: "Perlu Perhatian", emoji: "⚠️", color: "bg-yellow-100 text-yellow-800 border-yellow-300", ring: "ring-yellow-500" },
  na:      { label: "N/A",      emoji: "—",  color: "bg-gray-100 text-gray-600 border-gray-300",   ring: "ring-gray-400"  },
} as const;

export type ItemStatus = keyof typeof STATUS_CONFIG;
