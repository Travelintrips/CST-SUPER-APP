# Enterprise Business Audit — Advance Management Module

**Scope**: Kasbon/Vendor/Customer/Project/Operational/Purchase/Travel/Other Advances
**Sistem yang diaudit**: `artifacts/api-server/src/routes/advances.ts` (Unified Advance Engine) + `artifacts/api-server/src/routes/cashAdvances.ts` (Legacy Kasbon/Talangan Engine) + skema `lib/db/src/schema/cashAdvances.ts`
**Sifat dokumen**: AUDIT-ONLY. Tidak ada perubahan kode, migrasi, atau data yang dilakukan untuk menghasilkan dokumen ini.
**Tanggal audit**: 6 Juli 2026

---

## 0. Ringkasan Eksekutif

Advance Management saat ini **BUKAN satu sistem tunggal**, melainkan **dua sistem paralel yang aktif bersamaan**:

1. **Legacy Engine** — `/api/cash-advances` (`cashAdvances.ts`, 1139 baris) — kasbon karyawan dengan approval multi-level (`expense_approval_limits`, `expense_approval_requests`), OCR receipt, upload bukti.
2. **Unified Advance Engine** — `/api/advances` (`advances.ts`, 864 baris) — 8 tipe advance (EMPLOYEE/VENDOR/CUSTOMER/PROJECT/PURCHASE/TRAVEL/OPERATIONAL/OTHER), lifecycle 9-status, allocation engine multi-baris.

Kedua router di-mount bersamaan di `routes/index.ts` (baris 364-365) dan sama-sama menulis ke tabel fisik yang sama (`cash_advances`). Ini adalah **temuan arsitektur paling kritis**: dua permukaan API independen memanipulasi baris data yang sama tanpa saling mengetahui state satu sama lain, membuka celah **race condition, double-processing, dan divergensi status**.

Desain allocation engine (multi-baris settlement, allocation types, tipe advance) sudah cukup maju secara konsep dan terdokumentasi baik di `docs/advance-management-design.md`, `docs/allocation-engine.md`, `docs/advance-settlement-accounting.md`. Namun implementasi aktualnya memiliki **kesenjangan signifikan** dari desain yang didokumentasikan: fungsi void/reversal dipanggil dengan signature yang salah, tidak ada integrasi pajak, tidak ada integrasi sales order/purchase order, tidak ada integrasi rekonsiliasi bank, dan approval workflow di engine baru jauh lebih lemah dari legacy.

---

## 1. Business Process & Lifecycle Audit

**Current**: Unified engine mendefinisikan 9 lifecycle status (`draft → pending_approval → approved → disbursed → outstanding → partially_settled → settled/closed/void`), diverifikasi langsung dari kode (`LIFECYCLE_STATUSES` di `advances.ts` baris 29-33). State transition dijaga oleh whitelist per-endpoint (mis. `/settle` hanya menerima `outstanding|partially_settled|disbursed`).

**Temuan**:
- Legacy engine (`cashAdvances.ts`) memakai status berbeda (`active/partial/repaid/void/pending_approval/rejected/accounted`) dan **tidak pernah dimigrasikan** ke `lifecycle_status` secara real-time — hanya ada migrasi satu-kali (`advances.ts` baris 145-166: `WHERE lifecycle_status IS NULL`) saat kolom baru dibuat. Advance baru yang dibuat lewat legacy endpoint (`POST /api/cash-advances`) tidak otomatis mengisi `advance_type`/`lifecycle_status`, sehingga bisa "invisible" ke dashboard Unified Engine (yang selalu filter `advance_type IS NOT NULL`, lihat baris 226, 235, 243, 275).
- Tidak ada status `rejected` eksplisit di `LIFECYCLE_STATUSES` unified — reject di-map langsung ke `void` (baris 542), menghilangkan pembedaan bisnis penting antara "ditolak sebelum cair" vs "dibatalkan setelah cair" untuk keperluan pelaporan/audit trail.
- Transisi `closed` tidak pernah di-set oleh endpoint manapun yang ditemukan di `advances.ts` — status ini terdefinisi di enum tapi tidak ada code path yang menghasilkannya (dead state).

**Assessment**: Lifecycle model cukup baik secara desain tapi eksekusi ganda (dual engine) merusak konsistensinya di level operasional.

---

## 2. Accounting & Journal Posting Audit

**Current**: Disbursement dan settlement diposting via `postEntry()` (`lib/accounting.ts`), double-entry konsisten (DR Advance Receivable / CR Bank saat disburse; DR Bank / CR Advance Receivable + CR lain-lain saat settle). `sourceModule: "advance_management"` konsisten dipakai untuk traceability GL.

**Temuan Kritis — VOID/REVERSAL RUSAK SECARA SIGNATURE**:
- `advances.ts` baris 759-765 memanggil:
  ```
  assertCanVoidTransaction({ req, res, entryId, companyId })
  createReversalJournal(adv.entry_id, { description, ref, createdBy })
  ```
- Signature asli di `accountingPostingGuard.ts`:
  ```
  export function assertCanVoidTransaction(state: TransactionJournalState): GuardResult
  export async function createReversalJournal(input: CreateReversalJournalInput): Promise<JournalActionResult>
  ```
  Kedua pemanggilan **tidak cocok** dengan signature fungsi asli (parameter shape maupun jumlah argumen berbeda). Ini berarti flow void-setelah-disburse berisiko gagal secara runtime atau — lebih berbahaya — lolos type-check karena longgarnya tipe `any` di sekitar kode (`db.execute<any>`) dan menghasilkan reversal yang tidak benar/tidak lengkap.
- **Dampak**: Fitur "Void setelah Disbursed = wajib reversal" yang didokumentasikan di `advance-settlement-accounting.md` §6 kemungkinan besar **tidak berjalan sesuai desain di produksi**. Ini adalah risiko integritas buku besar tingkat tinggi karena void tanpa reversal yang benar bisa meninggalkan saldo piutang advance yang salah secara permanen.

**Temuan Lain**:
- Tidak ada validasi bahwa `receivable_account_id` dan `bank_account_id` berasal dari COA dengan tipe akun yang benar (asset/receivable, asset/bank) sebelum posting — hanya validasi keberadaan angka ID.
- Repayment (`/repay`) dan Settlement (`/settle`) adalah dua jalur berbeda yang **kedua-duanya mengubah `remaining_amount` dan `lifecycle_status` secara independen** tanpa saling lock — berpotensi race condition bila dua request diproses bersamaan (tidak ada `SELECT ... FOR UPDATE` atau transaksi DB eksplisit yang teramati di kedua endpoint).
- Tidak ada DB transaction wrapper (`db.transaction(...)`) di sekitar rangkaian insert settlement header → insert allocation lines → update cash_advances (baris 684-731). Jika proses gagal di tengah (mis. error di INSERT allocation line ke-2 dari 3), maka settlement header sudah tercatat tapi alokasi tidak lengkap dan status advance sudah ter-update — **integritas data tidak atomik**.

**Assessment**: Desain akuntansi solid di atas kertas, namun eksekusi void/reversal cacat dan atomisitas transaksi settlement tidak terjamin.

---

## 3. Allocation Engine Audit

**Current**: `/settle` menerima array `allocation_lines`, memvalidasi `SUM(lines) === amount_received` (toleransi 0.01), mendukung 7 allocation type, insert ke `advance_allocation_lines`.

**Temuan**:
- Insert allocation line memakai `.catch(() => {})` (baris 709) — **kegagalan insert allocation line DIABAIKAN secara diam-diam**. Jika salah satu baris gagal insert (mis. constraint FK), jurnal akuntansi tetap sudah diposting dan `cash_advances` tetap ter-update, tapi jejak alokasi hilang tanpa error yang terlihat oleh user maupun log. Ini melanggar prinsip "no silent fallbacks" dan menciptakan celah audit trail yang serius.
- Semua `allocation_lines` dalam satu call `/settle` terikat ke **satu `advance_id` yang sama** (dari URL param `:id`, baris 700-707) — engine ini **tidak mendukung** "satu pembayaran melunasi banyak advance sekaligus" (skenario umum: satu transfer bank menutup 2-3 kasbon karyawan berbeda dalam satu batch). Setiap advance harus di-settle dengan call terpisah.
- `reference_doc_id`/`reference_doc_type` untuk `SALES_INVOICE` **hanya disimpan sebagai metadata teks** — tidak ada query/update balik ke tabel invoice/sales order untuk menandai invoice tersebut sebagian/lunas terbayar. Alokasi bersifat satu arah (write-only), bukan integrasi dua arah yang sebenarnya.

**Assessment**: Allocation engine untuk kasus "satu advance, banyak tujuan pembayaran" berfungsi baik, tapi bukan allocation engine enterprise-grade karena tidak atomik, silent-fail pada baris alokasi, dan tidak benar-benar terintegrasi dua arah ke dokumen referensi.

---

## 4. Multi-Service / Multi-Invoice / Multi-Project Settlement

**Current**: `ALLOCATION_TYPES` termasuk `SALES_INVOICE`, `DIRECT_REVENUE`, `OTHER_RECEIVABLE` — cukup untuk mencatat kelebihan bayar dialokasikan ke beberapa akun revenue/piutang berbeda dalam satu settlement (lihat pola "Multi-service Revenue" di `allocation-engine.md`).

**Gap**:
- Tidak ada field `project_id`/`cost_center_id` di `advance_allocation_lines` — schema hanya punya `department_id`/`division_id` di level header `cash_advances`, bukan per-baris alokasi. Advance tipe `PROJECT` tidak bisa dipecah alokasinya ke banyak proyek berbeda dalam satu settlement.
- Tidak ditemukan validasi bahwa `reference_doc_id` untuk `SALES_INVOICE` benar-benar merujuk invoice milik `company_id` yang sama (celah tenant isolation potensial jika field ini nanti dipakai untuk query balik).

---

## 5. Multi-Company / Multi-Currency

**Current**: Setiap query di `advances.ts` konsisten memfilter `WHERE company_id = ${companyId}` (46 occurrence dari grep) via `resolveCompanyId(req)`. `currency`/`exchange_rate` ada di `cash_advances` dan `advance_settlements`.

**Gap**:
- **Tidak ada logika FX gain/loss**. Jika advance dibuat dalam USD dengan `exchange_rate` X, lalu disettle saat `exchange_rate` berbeda, sistem tidak menghitung selisih kurs sama sekali — `exchange_rate` pada settlement disimpan tapi tidak dipakai dalam kalkulasi jurnal manapun yang ditemukan (jurnal settlement selalu pakai `amount_received` mentah, bukan hasil konversi). Untuk perusahaan multi-currency, ini berarti **saldo advance dalam mata uang asing tidak pernah direkonsiliasi dengan benar** ke IDR functional currency.
- `assertCompanyAccess` diimpor tapi tidak terlihat dipanggil secara eksplisit di semua endpoint tulis (`POST/PATCH/DELETE`) — perlu verifikasi lebih lanjut apakah proteksi cross-company access konsisten di semua 9 endpoint atau hanya sebagian.

---

## 6. Tax (PPN/PPh) Integration

**Current**: **NIHIL.** Grep menyeluruh pada `advances.ts` untuk `tax|PPN|PPh|pajak` tidak menghasilkan satupun match.

**Gap — KRITIS untuk konteks Indonesia**:
- Advance tipe `VENDOR`/`PURCHASE` (uang muka ke vendor) secara umum berpotensi kena PPh 23/PPh Final tergantung jenis jasa, dan uang muka proyek/pembelian bisa memerlukan PPN dibayar dimuka (DP invoice). Sistem ini sama sekali tidak punya field, validasi, atau jurnal otomatis untuk PPN Masukan/Keluaran atau pemotongan PPh pada advance maupun settlement-nya.
- Tidak ada nomor bukti potong (bupot) atau referensi ke modul pajak yang sudah ada di ERP (jika ada, area ini butuh integrasi eksplisit, bukan diasumsikan).

---

## 7. Sales Order & Procurement Integration

**Current**: **NIHIL.** Tidak ada satupun referensi `sales_order`, `purchase_order`, `mktPurchaseOrder`, `vendor_advance`, atau `customer_advance` di `advances.ts`.

**Gap**:
- Advance tipe `CUSTOMER` (uang muka pelanggan) seharusnya terhubung ke Sales Order agar saat SO di-invoice, sistem otomatis menyarankan/menerapkan sisa advance sebagai pengurang piutang. Saat ini hubungan itu murni manual — staf harus tahu secara manual bahwa "Customer X punya advance outstanding" saat membuat invoice.
- Advance tipe `PURCHASE`/`VENDOR` seharusnya terhubung ke Purchase Order/vendor bill (down payment vendor) agar saat vendor invoice masuk, DP otomatis dipotongkan. Tidak ditemukan mekanisme ini.
- Modul marketplace/PO (`mkt_po_*`, dicatat di memori proyek sebagai modul terpisah) tampaknya berjalan sepenuhnya independen dari Advance Management — dua modul finansial besar (procurement dan advance) tidak saling bicara.

---

## 8. Bank Reconciliation Integration

**Current**: **NIHIL langsung.** Tidak ada referensi `bank_mutation`/`reconciliation` di `advances.ts`. Settlement/disbursement memposting jurnal langsung ke `accounting_journals` bertipe `bank`/`cash` tanpa melalui alur `bank_mutations → unifiedMatchingEngine → approveAndCreateJournal` yang menjadi arsitektur rekonsiliasi bank terpadu proyek ini (lihat memori `bank-recon-unified`).

**Gap**:
- Ini berarti mutasi bank riil (dari statement bank yang diimpor) dan mutasi yang tercipta dari Advance Management **berjalan di dua alur berbeda** — berpotensi menyebabkan duplikasi transaksi bank saat proses rekonsiliasi bulanan (petugas rekonsiliasi bisa mencocokkan mutasi bank asli dengan jurnal manual advance secara manual/ad-hoc, di luar sistem pencocokan otomatis yang sudah dibangun untuk modul lain).

---

## 9. Approval Workflow Audit

**Current — DIVERGENSI SIGNIFIKAN ANTARA DUA ENGINE**:
- **Legacy (`cashAdvances.ts`)**: memiliki `checkApprovalLimit()` yang query tabel `expense_approval_limits`, insert ke `expense_approval_requests`, ada kolom `approval_request_id` di `cash_advances`, kirim notifikasi WhatsApp ke admin group saat butuh approval (baris 210-462). ini adalah implementasi approval **multi-level berbasis limit nominal** yang cukup matang.
- **Unified (`advances.ts`)**: endpoint `/approve` dan `/reject` (baris 511-551) **hanya mengecek `requireAdmin`** tanpa ada limit approval bertingkat, tanpa referensi ke `expense_approval_limits`/`expense_approval_requests` sama sekali. Siapapun dengan role admin bisa approve advance bernilai berapapun tanpa jenjang otorisasi tambahan.

**Assessment**: Ini adalah **regresi kapabilitas**, bukan peningkatan — sistem baru yang dimaksudkan sebagai "Unified Engine" justru kehilangan kontrol approval bertingkat yang sudah ada di sistem lama untuk kategori-kategori advance baru (VENDOR/CUSTOMER/PROJECT/PURCHASE/TRAVEL/OPERATIONAL/OTHER). Hanya `EMPLOYEE` (dipetakan dari legacy) yang punya jejak approval limit.

---

## 10. Security & RBAC Audit

**Current**: Semua route di `advances.ts` menggunakan satu middleware: `requireAdmin` (hanya 1 pemanggilan eksplisit ditemukan di baris 207 — untuk endpoint dashboard/reporting; endpoint-endpoint CRUD lain seperti create/approve/disburse/settle/void/repay/delete **tidak terlihat dibungkus middleware serupa** dalam grep pola `requireAdmin` — kemungkinan diterapkan di level router-mount pada `routes/index.ts`, bukan per-route; perlu diverifikasi eksplisit sebelum dianggap aman).

**Gap**:
- Tidak ada pemisahan permission granular (mis. `advance.create` vs `advance.approve` vs `advance.void` vs `advance.settle`) — model RBAC saat ini adalah biner (admin vs bukan admin), bukan matriks peran sesuai prinsip pemisahan tugas (segregation of duties) yang lazim di ERP: idealnya orang yang membuat advance tidak boleh menjadi orang yang sama yang meng-approve dan mencairkannya.
- Endpoint `/void` melakukan reversal jurnal finansial — operasi berdampak tinggi ini seharusnya butuh otorisasi setingkat lebih tinggi dari create/list biasa, tapi tidak ada differensiasi role yang ditemukan.
- Sejalan dengan `threat_model.md` — prinsip "role internal seperti POS/dashboard harus dibatasi server-side sesuai matriks role bisnis, bukan hanya di UI" **belum terpenuhi** untuk modul Advance Management.

---

## 11. Reporting & Analytics Audit

**Current**: `/dashboard` (ringkasan status + per-tipe), `/aging` (bucket umur piutang) sudah tersedia dan cukup baik untuk kebutuhan dasar finance.

**Gap**:
- Tidak ada laporan per-approver / audit trail siapa approve apa (karena approval tidak tercatat granular di unified engine).
- Tidak ada laporan rekonsiliasi silang legacy vs unified (berapa banyak advance masih di sistem lama vs baru) — penting untuk memantau progres migrasi yang menurut `advance-migration-plan.md` seharusnya sedang berjalan.
- Tidak ada export/dokumentasi untuk kebutuhan audit eksternal (auditor independen) seperti advance ledger per-period yang bisa direkonsiliasi ke GL.

---

## 12. Database Design Audit

**Current**: `cash_advances` diperluas secara additive (kolom baru ditambah via `ALTER TABLE ADD COLUMN IF NOT EXISTS`, sesuai konvensi proyek). `advance_settlements` dan `advance_allocation_lines` adalah tabel baru dengan FK ke `cash_advances`/`advance_settlements`.

**Gap**:
- Skema dibuat lewat raw SQL string di dalam route file (`advances.ts` baris 60-135-an), **bukan Drizzle schema resmi** di `lib/db/src/schema/`. Ini artinya tabel `advance_settlements`/`advance_allocation_lines` tidak terlihat oleh Drizzle ORM type-safety, tidak masuk `drizzle-kit generate`, dan berisiko drift dari skema Drizzle yang sudah dikonvensikan proyek (lihat `replit.md`: "DB schema: lib/db/src/schema/").
- Tidak ditemukan index eksplisit pada `advance_allocation_lines.reference_doc_id`/`reference_doc_type` (dipakai untuk lookup potensial ke invoice/PO) — berisiko full-table-scan saat data besar jika nanti dipakai untuk join balik.
- Tidak ada constraint CHECK di level DB untuk `lifecycle_status IN (...)` atau `advance_type IN (...)` — validasi murni di level aplikasi (kode Express), sehingga insert langsung ke DB (mis. dari script migrasi lain, atau dari `cashAdvances.ts` legacy) bisa menghasilkan kombinasi status ilegal tanpa dicegah oleh DB.

---

## 13. UX / Operational Flow Audit

**Current**: Frontend di `artifacts/bizportal/src/pages/finance/advance-management.tsx` dengan 3 tab (Daftar Advance, Laporan Aging, Rekapitulasi) menurut `advance-management-design.md`.

**Gap** (berdasarkan API yang tersedia, tanpa membaca detail frontend secara menyeluruh dalam audit ini):
- Tidak ada indikasi UI untuk memilih/menandai "advance ini terhubung ke Sales Order/PO yang mana" karena API-nya sendiri tidak menyediakan link tersebut (lihat §7).
- User yang bekerja di dua sistem (legacy kasbon vs unified advance) berpotensi bingung karena kedua-duanya kemungkinan punya rute UI/menu berbeda yang keduanya "hidup" bersamaan.

---

## 14–21. Area Tambahan (Tax detail, Currency detail, Notification, Audit Log, dsb.)

- **Audit log**: `auditFromReq` dipanggil pada create dan settle (baris 501, 733) — TIDAK dipanggil pada approve/reject/disburse/void/repay/delete. Jejak audit tidak lengkap untuk operasi paling sensitif (void, disburse, repay).
- **Notifikasi**: Tidak ditemukan notifikasi (WhatsApp/email) di unified engine untuk approve/disburse/settle — berbeda dari legacy yang mengirim WhatsApp ke admin group saat butuh approval. Regresi UX operasional untuk tipe advance baru.
- **Idempotency**: Tidak ada idempotency key pada `/disburse` atau `/settle` — retry dari client (mis. karena timeout network) berisiko double-posting jurnal, hanya dicegah sebagian oleh guard `entry_id` di disburse (baris tidak eksplisit dikutip tapi disebut di `advance-settlement-accounting.md` §1 "Hanya bisa diposting SATU KALI"). `/settle` tidak punya guard serupa — retry settle dengan payload sama berpotensi membuat 2 settlement record dan 2 jurnal untuk pembayaran yang sama.
