# Audit End-to-End Pembayaran Vendor

Tanggal audit: 2026-09-05

## Ringkasan

Sistem sudah memiliki alur utama:

1. Upload/OCR invoice melalui `invoiceOcr.ts`.
2. Draft vendor invoice dan line item melalui `purchaseWorkflow.ts`.
3. Validasi PPN header melalui `invoiceTaxEngine.ts` dan `invoiceTaxPostingPolicy.ts`.
4. Posting invoice ke jurnal pembelian/AP.
5. Pembayaran invoice posted melalui Bank Disbursement.
6. Handoff marketplace yang idempotent melalui `mktApPreparationService.ts` dan `mktAccountingHandoffService.ts`.
7. Rekonsiliasi accounting/payment/bank melalui route reconciliation dan unified matching engine.
8. Pelaporan PPN/PPh dan bukti potong melalui `transaction_taxes` serta SPT builder.

## Duplicate logic yang ditemukan

- `purchaseWorkflow.ts` adalah jalur admin/manual invoice.
- `purchaseMiniFormRoute.ts` memiliki jalur auto-post kedua dengan logika jurnal yang hampir sama.
- Jalur marketplace menggunakan 3-way match dan accounting handoff terpisah.
- Jalur OCR sebelumnya hanya ekstraksi stateless; penyimpanan invoice tetap dilakukan oleh `purchaseWorkflow.ts`.

Konsekuensi: perubahan jurnal/tax harus diuji pada ketiga jalur. Jalur mini-form sebelumnya dapat menandai invoice `posted` walau journal gagal; sekarang invoice tetap `draft`.

## Gap dan status perbaikan

### Diperbaiki dengan minimal diff

- Duplicate invoice check sekarang dibatasi `company_id`.
- Supplier yang dipakai invoice divalidasi terhadap company aktif; supplier global (`company_id IS NULL`) tetap diperbolehkan.
- PO dan GR yang dilink harus berada pada company aktif.
- Cancel lintas company tidak lagi mengubah row sebelum ownership check.
- Invoice posted/locked tidak dapat dihapus atau dibatalkan langsung.
- Detail/delete legacy `vendor_payments` dibatasi `company_id`.
- OCR mengembalikan line item terpisah dengan `coa_hint` non-posting; hint tidak diperlakukan sebagai COA final.
- OCR mendeteksi sinyal PPh secara terpisah dari PPN dan menyimpan `tax_review_status`.
- Invoice dengan PPh/tax object yang belum direview ditolak oleh endpoint posting dan tidak boleh auto-post.
- Kegagalan journal mini-form mempertahankan invoice sebagai `draft`, sehingga retry tidak membuat false-posted invoice.

### Masih tersedia dan dipakai

- PPN Masukan memakai account setting company, bukan akun tax sebagai COA utama.
- Journal posting memakai source invoice/company dan sudah memiliki guard status draft.
- Bank Disbursement hanya mengambil vendor invoice posted yang masih memiliki saldo.
- Marketplace accounting handoff memakai business idempotency key dan payload fingerprint.
- SPT builder sudah memiliki bucket PPh 21, PPh 23, PPh 15, PPh 4(2), dan bukti potong.

## Hal yang belum boleh di-auto-post

- `coa_hint` OCR masih merupakan saran klasifikasi, bukan account ID postable.
- PPh belum memiliki kontrak lengkap untuk menghitung AP bersih, Utang PPh per jenis, nomor bukti potong, dan reversal/reconciliation-nya sebagai satu transaksi vendor invoice.
- Nilai PPh yang terlihat pada OCR tidak cukup untuk menentukan tax object atau tarif final.
- Legacy `company_id IS NULL` pada sebagian data reconciliation masih memerlukan kebijakan apakah masuk consolidated view atau harus diisolasi.

## Keputusan owner yang diperlukan sebelum fase berikutnya

1. COA ditetapkan pada level invoice, line item, atau hanya saat payment/approval.
2. Tax object dan tarif PPh yang sah untuk setiap jenis vendor/transaksi.
3. Model jurnal PPh: AP bersih + Utang PPh, akun Utang PPh per jenis, dan timing bukti potong.
4. Apakah mismatch 3-way match boleh diposting sebagai exception atau wajib approval.
5. Kebijakan supplier global versus supplier per company dan visibilitas row legacy tanpa company.
