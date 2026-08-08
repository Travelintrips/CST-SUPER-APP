# Sprint 09

## Objective

Mendokumentasikan logical next phase Marketplace setelah lifecycle Sprint 8
berakhir pada `waiting_payment`, tanpa menetapkan requirement implementasi yang
belum didukung repository.

**Specification requires business clarification.**

## BUSINESS DECISION REQUIRED

### BD-09-001

**Topic**
Payment lifecycle

**Current Evidence**
`mktApPreparationService` hanya membentuk alur
`ap_preparation → finance_review → waiting_payment`. Repository belum memiliki
transisi Marketplace setelah `waiting_payment`. Repository memiliki
`paymentRequestsTable` generik dengan status, approver, jumlah pembayaran,
tanggal pembayaran, dan `journalEntryId`, tetapi tidak ada bukti bahwa tabel
tersebut menjadi lifecycle canonical untuk `mkt_ap_preparations`.

**Why clarification is required**
Nama fase, urutan status, terminal state, dan boundary antara AP preparation,
payment request, payment execution, settlement, dan accounting belum
ditetapkan. Keputusan ini menjadi dasar untuk semua keputusan BD-09-002 sampai
BD-09-012.

**Possible Options**

**Option A**
`waiting_payment → payment_requested → payment_approved → payment_executed →
settled`, dengan failure/cancellation sebagai terminal atau corrective state.

**Option B**
`waiting_payment` langsung di-handoff ke lifecycle payment existing, tanpa
menambahkan lifecycle payment Marketplace baru.

**Option C**
`waiting_payment` tetap menjadi status akhir Sprint 9 dan payment diproses
sebagai proses eksternal/manual di luar lifecycle Marketplace.

**Impact**
Menentukan status machine, entity/link canonical, API/UI scope, audit event,
idempotency key, notification, accounting boundary, dan regression scope.

**Recommendation**
Jangan implementasikan opsi apa pun sebelum business owner memilih lifecycle
resmi dan menyetujui status serta terminal state-nya.

**Decision Owner**
Business Owner Marketplace bersama Finance Process Owner (nama pemilik belum
ditetapkan).

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-002

**Topic**
Payment approval hierarchy

**Current Evidence**
AP preparation memiliki tahap `finance_review` sebelum `waiting_payment`, dan
menyimpan `financeReviewedBy` serta `financeReviewedAt`. `paymentRequestsTable`
generik juga memiliki `requestedBy`, `approvedBy`, dan `approvedAt`.
Repository belum menetapkan apakah finance review sama dengan payment approval,
atau apakah payment membutuhkan approval tambahan.

**Why clarification is required**
Tanpa hierarki yang dipilih, sistem tidak dapat menentukan siapa yang boleh
menyetujui, apakah approval tunggal cukup, kapan approval dianggap sah, dan
bagaimana segregation of duties diterapkan.

**Possible Options**

**Option A**
Finance review pada AP preparation menjadi satu-satunya approval pembayaran.

**Option B**
AP preparation finance review tetap wajib, kemudian payment membutuhkan approval
kedua dari role/level finance berdasarkan nominal atau company.

**Option C**
Approval mengikuti workflow approval existing di luar Marketplace, dengan
Marketplace hanya menyimpan referensi dan hasil approval.

**Impact**
Memengaruhi role matrix, authorization scope, status transition, audit trail,
approval metadata, notifikasi, dan pengujian separation of duties.

**Recommendation**
Tetapkan pemisahan yang eksplisit antara finance review dan payment approval,
atau nyatakan secara resmi bahwa keduanya adalah satu kontrol yang sama.

**Decision Owner**
Finance Controller dan Business Owner Marketplace.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-003

**Topic**
Payment execution authority

**Current Evidence**
Repository belum memiliki payment execution Marketplace setelah
`waiting_payment`. Komponen payment existing mencakup payment routes dan
accounting payment ingestion, tetapi tidak membuktikan actor Marketplace yang
berwenang mengeksekusi pembayaran vendor Marketplace.

**Why clarification is required**
Execution authority berbeda dari approval authority dan berdampak langsung pada
risiko pembayaran tidak sah, segregation of duties, serta integrasi bank atau
payment provider.

**Possible Options**

**Option A**
Treasury/cashier internal mengeksekusi payment setelah approval.

**Option B**
Finance approver yang sama mengeksekusi payment melalui payment provider atau
bank integration.

**Option C**
Execution dilakukan di sistem bank/provider di luar aplikasi; aplikasi hanya
mencatat handoff dan hasil settlement.

**Impact**
Menentukan endpoint/actor, credential boundary, approval guard, audit event,
provider integration, failure handling, dan kebutuhan rekonsiliasi.

**Recommendation**
Tetapkan actor eksekusi yang berbeda dari actor approval kecuali business owner
secara eksplisit menyetujui pengecualian dan kontrol penggantinya.

**Decision Owner**
Treasury/Finance Operations Owner bersama Security atau Compliance Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-004

**Topic**
Partial payment

**Current Evidence**
`paymentRequestsTable` generik memiliki `totalAmount` dan `paidAmount`, dan
payment status existing mengenal `unpaid`, `partial`, `paid`, dan `overdue`.
Namun, belum ada keputusan bahwa status dan field tersebut berlaku untuk
`mkt_ap_preparations` atau vendor invoice Marketplace.

**Why clarification is required**
Partial payment memengaruhi outstanding amount, status invoice/AP, approval
limit, 3-Way Match, duplicate protection, journal posting, dan reconciliation.

**Possible Options**

**Option A**
Partial payment dilarang; satu AP preparation harus dibayar penuh dalam satu
execution.

**Option B**
Partial payment diperbolehkan sebagai installment terhadap satu AP preparation
dan outstanding balance dihitung server-side.

**Option C**
Partial payment hanya diperbolehkan untuk kondisi bisnis tertentu dengan
approval tambahan dan reason wajib.

**Impact**
Menentukan status (`partial` atau padanan lain), payment allocation, jumlah
payment record, approval ulang, accounting entry, dan acceptance tests.

**Recommendation**
Business owner harus memilih apakah installment merupakan proses resmi atau
exception; jangan menurunkan perilaku dari payment status generik yang ada.

**Decision Owner**
Finance Process Owner dan Marketplace Procurement Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-005

**Topic**
Multi-payment

**Current Evidence**
`paymentRequestItemsTable` dapat menghubungkan payment request ke
`vendorInvoicesTable`, sedangkan `mkt_ap_preparations` terkait ke satu vendor
invoice. Repository belum menetapkan apakah beberapa payment boleh mengacu ke
satu AP preparation, atau satu payment boleh membayar beberapa AP preparation.

**Why clarification is required**
Cardinality payment-to-invoice/AP menentukan data model, allocation, approval,
idempotency, duplicate detection, reporting, dan rekonsiliasi.

**Possible Options**

**Option A**
Satu AP preparation menghasilkan tepat satu payment.

**Option B**
Satu AP preparation dapat memiliki beberapa payment sampai lunas.

**Option C**
Satu payment batch dapat membayar beberapa AP preparation/vendor invoice dengan
allocation per item.

**Impact**
Memengaruhi relasi database, payment batch, allocation lines, status aggregate,
approval scope, journal lines, dan bank reconciliation.

**Recommendation**
Tetapkan cardinality canonical terlebih dahulu; jangan mengandalkan
`paymentRequestItemsTable` generik sebagai keputusan Marketplace.

**Decision Owner**
Finance Process Owner bersama Accounting Owner dan Marketplace Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-006

**Topic**
Failed payment

**Current Evidence**
Repository memiliki payment/provider routes dan job/failure utilities, tetapi
tidak ada status atau kontrak failure khusus untuk payment vendor Marketplace
setelah `waiting_payment`. `mktApPreparationService` sendiri tidak memiliki
payment failure transition.

**Why clarification is required**
Failure dapat terjadi sebelum submission, saat provider menolak, setelah bank
mengembalikan error, atau setelah debit tetapi settlement belum terkonfirmasi.
Masing-masing membutuhkan perlakuan bisnis dan audit yang berbeda.

**Possible Options**

**Option A**
Payment gagal kembali ke status siap dieksekusi dan dapat diproses ulang.

**Option B**
Payment gagal masuk `failed/manual_review` dan hanya dapat dilanjutkan setelah
review serta tindakan manual.

**Option C**
Payment gagal dianggap tidak mengubah AP preparation; failure hanya dicatat pada
payment attempt/provider record di luar lifecycle AP.

**Impact**
Menentukan status, notification, retry eligibility, outstanding balance,
provider evidence, audit, dan apakah approval harus diulang.

**Recommendation**
Bedakan failure teknis, rejection bisnis, dan debit tanpa settlement sebelum
menetapkan satu state atau satu jalur pemulihan.

**Decision Owner**
Treasury/Finance Operations Owner dan Accounting Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-007

**Topic**
Retry

**Current Evidence**
Notification queue existing menggunakan deduplication key, dan repository
memiliki utility idempotency/failure untuk domain finansial. Belum ada
requirement retry untuk payment Marketplace atau definisi apakah retry membuat
attempt baru.

**Why clarification is required**
Retry payment berisiko membuat double debit jika status provider belum pasti.
Sistem harus membedakan retry request yang sama, payment attempt baru, dan
reconciliation terhadap transaksi yang sudah berhasil.

**Possible Options**

**Option A**
Retry memakai idempotency key yang sama dan mengulang request terhadap payment
attempt yang sama.

**Option B**
Retry membuat attempt baru yang terhubung ke attempt sebelumnya, dengan guard
bahwa attempt lama tidak sedang pending/settled.

**Option C**
Retry otomatis dilarang; hanya actor berwenang yang boleh memulai retry setelah
status provider dikonfirmasi.

**Impact**
Memengaruhi idempotency, provider integration, concurrency lock, audit,
notification, duplicate prevention, dan operational runbook.

**Recommendation**
Tetapkan perlakuan khusus untuk status provider yang tidak diketahui sebelum
mengizinkan retry otomatis.

**Decision Owner**
Treasury/Finance Operations Owner bersama Payment Integration Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-008

**Topic**
Duplicate payment

**Current Evidence**
Repository mencegah duplicate vendor invoice berdasarkan supplier, reference,
dan PO; AP preparation duplicate dicegah berdasarkan vendor invoice. Belum ada
anti-duplicate payment contract untuk `mkt_ap_preparations`. Payment generik
memiliki payment request number, tetapi belum dibuktikan sebagai key duplicate
Marketplace.

**Why clarification is required**
Duplicate payment dapat terjadi karena double-click, concurrent request, retry
setelah timeout, duplicate provider callback, atau pembayaran sah untuk
installment. Guard harus membedakan kasus-kasus tersebut.

**Possible Options**

**Option A**
Blokir payment kedua untuk vendor invoice/AP preparation yang sama sampai
payment pertama berstatus terminal.

**Option B**
Izinkan beberapa payment hanya jika allocation/outstanding balance membuktikan
bahwa pembayaran belum lunas.

**Option C**
Gunakan payment provider reference atau bank reference sebagai canonical
duplicate key, dengan idempotency key aplikasi sebagai guard tambahan.

**Impact**
Menentukan unique constraint/locking, request idempotency, provider callback
handling, partial payment, alerting, dan recovery atas false positive.

**Recommendation**
Business owner harus menyetujui kombinasi business key dan provider key; nominal
dan invoice reference saja tidak cukup untuk semua retry/concurrency scenario.

**Decision Owner**
Finance Controller, Treasury Owner, dan Payment Integration Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-009

**Topic**
Cancellation

**Current Evidence**
`paymentRequestsTable` generik memiliki `cancelledAt`, dan lifecycle Marketplace
memiliki current-status guards pada AP transition. Belum ada aturan pembatalan
payment Marketplace atau batas waktu pembatalan setelah payment dikirim ke
provider/bank.

**Why clarification is required**
Pembatalan sebelum execution, saat provider pending, dan setelah settlement
memiliki konsekuensi berbeda. Pembatalan juga harus menentukan nasib approval,
outstanding balance, dan audit.

**Possible Options**

**Option A**
Cancellation hanya boleh sebelum payment execution dimulai.

**Option B**
Cancellation boleh sampai provider/bank menerima request, tetapi tidak setelah
payment settled.

**Option C**
Cancellation selalu membutuhkan manual finance review dan dapat membuat
corrective/reversal process jika payment sudah bergerak.

**Impact**
Memengaruhi status machine, authorization, provider cancellation, accounting,
notification, audit, dan concurrency behavior.

**Recommendation**
Definisikan state boundary yang tidak dapat dibatalkan dan prosedur corrective
action secara terpisah dari tombol cancellation.

**Decision Owner**
Finance Controller dan Treasury/Finance Operations Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-010

**Topic**
Reversal

**Current Evidence**
Arsitektur accounting repository memperlakukan journal posted sebagai immutable
dan menggunakan reversal untuk koreksi. Repository juga memiliki konsep
void/reversal pada domain pembayaran existing. Belum ada keputusan apakah
reversal payment Marketplace berarti refund/provider reversal, reversal journal,
atau keduanya.

**Why clarification is required**
Payment yang sudah settled tidak dapat diperlakukan sama dengan payment yang
belum settled. Tanpa definisi, sistem dapat salah membalik cash, liability,
expense, atau status AP.

**Possible Options**

**Option A**
Reversal hanya berupa accounting reversal; pergerakan dana ditangani di luar
Marketplace.

**Option B**
Reversal harus memulai refund/return-of-funds melalui provider/bank, lalu
accounting reversal diposting berdasarkan hasilnya.

**Option C**
Payment tidak dapat direversal; koreksi dilakukan melalui payment baru,
credit/debit adjustment, dan proses accounting terpisah.

**Impact**
Menentukan journal policy, cash movement, AP outstanding, status settlement,
authorization, audit, reconciliation, dan legal/financial reporting.

**Recommendation**
Pisahkan definisi payment reversal, provider refund, dan accounting journal
reversal sebelum menetapkan status atau endpoint.

**Decision Owner**
Accounting Owner bersama Treasury/Finance Operations Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-011

**Topic**
Relationship dengan Accounting

**Current Evidence**
`paymentRequestsTable` generik memiliki `journalEntryId`, dan
`ingestModulePayment`/accounting payment flows menghubungkan payment ke journal.
Arsitektur accounting juga mewajibkan posted journal immutable. Namun, belum ada
mapping Marketplace dari `mkt_ap_preparations` atau vendor invoice ke payment
record dan jurnal canonical.

**Why clarification is required**
Harus diputuskan kapan liability/AP diakui, kapan cash disbursement diposting,
akun apa yang digunakan, siapa yang boleh posting, dan apakah payment execution
boleh berhasil tanpa journal.

**Possible Options**

**Option A**
Payment execution membuat atau menghubungkan journal accounting secara atomik
sebelum payment dianggap berhasil.

**Option B**
Payment execution/settlement menjadi source event, lalu accounting posting
mengonsumsi event tersebut secara asynchronous dan idempotent.

**Option C**
Sprint 9 hanya membuat payment handoff/record; accounting posting tetap menjadi
proses finance/accounting terpisah.

**Impact**
Memengaruhi transaction boundary, failure semantics, COA mapping, journal
reuse/reversal, reporting, audit, dan deployment dependency.

**Recommendation**
Tetapkan canonical source of truth untuk amount, settlement, dan journal sebelum
menentukan integrasi; jangan menganggap `journalEntryId` generik sebagai kontrak
Marketplace.

**Decision Owner**
Chief/Head of Accounting bersama Finance Process Owner dan Marketplace Owner.

**Status**
PENDING

## BUSINESS DECISION REQUIRED

### BD-09-012

**Topic**
Relationship dengan Bank Reconciliation

**Current Evidence**
Repository memiliki `bankReconciliation` routes, canonical payment-source rules,
dan matching engine untuk domain payment yang sudah ada. Belum ada bukti bahwa
`mkt_ap_preparations` atau payment Marketplace menjadi candidate/source canonical
untuk bank reconciliation, maupun definisi reference yang harus dibawa ke bank
mutation.

**Why clarification is required**
Tanpa keputusan ini, payment dapat tercatat ganda sebagai payment source,
accounting payment, atau bank candidate. Rekonsiliasi juga perlu membedakan
payment submitted, settled, returned, dan reversed.

**Possible Options**

**Option A**
Payment Marketplace menjadi canonical payment source; bank reconciliation
menautkan bank mutation ke payment berdasarkan provider/bank reference.

**Option B**
Accounting journal/payment entry menjadi canonical source; bank reconciliation
menautkan bank mutation ke jurnal yang sudah diposting.

**Option C**
Bank reconciliation hanya dilakukan manual/di luar Sprint 9; Marketplace hanya
menyimpan settlement reference untuk handoff.

**Impact**
Memengaruhi source uniqueness, matching keys, settlement status, accounting
posting, exception handling, duplicate prevention, dan operational ownership.

**Recommendation**
Tetapkan satu canonical source dan aturan satu-bank-mutation-to-one-payment atau
mapping batch sebelum membuka automated reconciliation.

**Decision Owner**
Bank Reconciliation Owner bersama Accounting Owner dan Treasury Owner.

**Status**
PENDING

## Business Goal

Menentukan secara resmi bagaimana AP preparation Marketplace yang sudah berada
di `waiting_payment` diproses ke tahap berikutnya, termasuk owner, approval,
payment execution, dan hubungan dengan accounting.

Repository hanya menunjukkan bahwa tahap setelah `waiting_payment` belum
ditetapkan sebagai bagian dari lifecycle Marketplace yang ada.

## Current State

Bukti repository menunjukkan alur berikut:

1. PO Marketplace bergerak dari penerbitan dan konfirmasi vendor menuju
   produksi, pengiriman, delivery, dan goods receipt.
2. Goods receipt membutuhkan shipment `delivered` dan POD yang tersimpan sebagai
   event `pod_uploaded`.
3. Vendor invoice Marketplace terkait dengan PO dan Goods Receipt.
4. Submit invoice menjalankan 3-Way Match terhadap PO, Goods Receipt, quantity,
   unit price, currency, tax, dan total.
5. Invoice yang lulus match menjadi `ready_for_ap`.
6. AP preparation mengambil snapshot dari invoice/PO/GR dan bergerak melalui:
   `ap_preparation → finance_review → waiting_payment`.

Implementasi yang menjadi bukti:

- `artifacts/api-server/src/lib/services/mktVendorInvoiceService.ts`
- `artifacts/api-server/src/lib/services/mktApPreparationService.ts`
- `artifacts/api-server/src/routes/mktAdmin.ts`
- `lib/db/src/schema/mktApPreparations.ts`
- `lib/db/src/schema/purchaseWorkflow.ts`

## Target State

Target state yang dapat diturunkan secara logis adalah adanya keputusan bisnis
untuk tahap sesudah `waiting_payment`, kemungkinan pada boundary pembayaran
vendor Marketplace.

Target state tersebut **belum dapat dispesifikasikan** secara resmi dari
repository. Repository belum menetapkan:

- apakah tahap berikutnya adalah payment request, payment approval, payment
  execution, atau handoff ke modul payment yang sudah ada;
- siapa actor/role yang berwenang;
- status dan transisi yang harus berlaku;
- apakah payment membuat journal/accounting entry;
- bagaimana partial payment, retry, failure, reversal, dan reconciliation
  diperlakukan.

**Specification requires business clarification.**

## Business Decision Register

Setiap keputusan di bawah ini wajib diputuskan oleh pemilik bisnis sebelum
Sprint 09 dapat masuk ke tahap implementasi. Opsi-opsi berikut adalah ruang
keputusan yang perlu dipilih, bukan requirement yang sudah disetujui.

### BD-09-001

**Topic**  
Payment lifecycle setelah `waiting_payment`.

**Current Evidence**  
`mktApPreparationService` dan `mkt_ap_preparations.status` hanya membuktikan
transisi `ap_preparation → finance_review → waiting_payment`. Tidak ditemukan
kontrak Marketplace-specific untuk fase sesudahnya. Modul generik `payments`
memiliki status `pending`, `paid`, `expired`, `cancelled`, dan `failed`, tetapi
tidak memiliki relasi Marketplace AP yang terbukti.

**Why clarification is required**  
Nama fase berikutnya, entity canonical, status, terminal state, dan boundary
antara Marketplace, payment, serta accounting belum ditetapkan.

**Possible Options**

**Option A**  
`waiting_payment` hanya menjadi handoff ke modul payment yang sudah ada; modul
payment memiliki lifecycle berikutnya.

**Option B**  
Marketplace membuat payment request yang terpisah, lalu payment execution
ditangani oleh modul payment atau treasury.

**Option C**  
Marketplace memiliki lifecycle payment sendiri sampai settlement, dengan
handoff accounting/reconciliation di boundary yang ditentukan kemudian.

**Impact**  
Mempengaruhi entity dan status baru, ownership, endpoint, notification, audit,
idempotency, regression scope, dan batas Sprint 09.

**Recommendation**  
Tidak ada pilihan yang dapat direkomendasikan dari repository. Business owner
harus memilih satu boundary dan menyatakan apakah opsi tersebut termasuk
scope Sprint 09.

**Decision Owner**  
Business owner dan Finance owner; nama role final belum ditetapkan di
repository.

**Status**  
PENDING

### BD-09-002

**Topic**  
Payment approval hierarchy.

**Current Evidence**  
AP preparation menggunakan admin authorization dan mencatat
`financeReviewedBy`/`financeReviewedAt`. Repository tidak menetapkan hierarchy
approval payment, threshold nominal, company scope, maupun segregation of
duties untuk payment.

**Why clarification is required**  
Approval AP preparation tidak otomatis berarti approval payment. Tanpa
hierarchy yang disepakati, sistem tidak dapat menentukan siapa yang boleh
menyetujui dan kapan payment boleh dieksekusi.

**Possible Options**

**Option A**  
Satu approval Finance untuk setiap payment.

**Option B**  
Approval bertingkat berdasarkan nominal, perusahaan, atau kategori payment.

**Option C**  
Maker-checker: pembuat payment tidak boleh menjadi approver, dengan
escalation untuk kasus tertentu.

**Impact**  
Mempengaruhi role matrix, status approval, audit trail, authorization checks,
notifikasi, dan acceptance criteria.

**Recommendation**  
Jangan menganggap `admin` atau `financeReviewedBy` sebagai approval payment
sebelum owner menetapkan hierarchy dan segregation of duties.

**Decision Owner**  
Finance owner dan business owner; approver role serta threshold harus
ditentukan secara eksplisit.

**Status**  
PENDING

### BD-09-003

**Topic**  
Payment execution authority.

**Current Evidence**  
Repository memiliki provider Paylabs pada modul `payments`, tetapi tidak
menunjukkan siapa yang berwenang mengeksekusi pembayaran vendor Marketplace
setelah `waiting_payment`. Tidak ditemukan kontrak Marketplace untuk
treasury, bank transfer, provider callback, atau execution approval.

**Why clarification is required**  
Pembuatan payment request, persetujuan, dan eksekusi dapat merupakan tindakan
berbeda dengan risiko dan audit authority yang berbeda.

**Possible Options**

**Option A**  
Finance/Treasury internal menjadi executor setelah approval.

**Option B**  
Payment provider menjadi executor setelah sistem mengirim payment instruction;
user hanya memberi approval di aplikasi.

**Option C**  
Handoff ke sistem payment/bank eksternal; aplikasi hanya menyimpan status dan
reference hasil execution.

**Impact**  
Mempengaruhi credential boundary, endpoint write, callback/webhook, audit
actor, failure handling, dan production controls.

**Recommendation**  
Tidak ada authority yang dapat disimpulkan dari evidence saat ini. Owner harus
menetapkan actor manusia, service, atau sistem eksternal yang menjadi
execution authority.

**Decision Owner**  
Finance/Treasury owner dan pemilik kontrol operasional.

**Status**  
PENDING

### BD-09-004

**Topic**  
Partial payment.

**Current Evidence**  
AP preparation menyimpan snapshot total invoice dan berhenti pada
`waiting_payment`. Tidak ditemukan field outstanding balance, paid amount,
payment allocation, atau Marketplace rule untuk pembayaran sebagian.

**Why clarification is required**  
Pembayaran sebagian menentukan apakah AP tetap terbuka, apakah invoice dapat
dianggap selesai, dan bagaimana sisa kewajiban dihitung.

**Possible Options**

**Option A**  
Partial payment dilarang; hanya full payment yang valid.

**Option B**  
Partial payment diperbolehkan terhadap satu AP preparation dengan outstanding
balance yang dihitung server-side.

**Option C**  
Partial payment hanya diperbolehkan melalui installment/schedule yang disetujui
sebelumnya.

**Impact**  
Mempengaruhi amount authority, status, allocation, duplicate protection,
accounting liability, reconciliation, dan UI.

**Recommendation**  
Jangan menganggap pembayaran generik `amount` sebagai dukungan partial
payment Marketplace. Owner harus memilih aturan dan definisi selesai.

**Decision Owner**  
Finance owner dan business owner.

**Status**  
PENDING

### BD-09-005

**Topic**  
Multi-payment terhadap satu invoice/AP preparation.

**Current Evidence**  
`mkt_ap_preparations` memiliki unique relation ke `vendorInvoiceId`, sedangkan
tidak ada payment allocation Marketplace yang menunjukkan apakah satu
preparation dapat memiliki lebih dari satu payment.

**Why clarification is required**  
Multi-payment berbeda dari retry teknis dan berbeda dari partial payment.
Tanpa aturan, sistem berisiko membuat lebih dari satu pembayaran untuk
kewajiban yang sama.

**Possible Options**

**Option A**  
Satu AP preparation hanya boleh memiliki satu payment yang final.

**Option B**  
Banyak payment diperbolehkan, tetapi total alokasi tidak boleh melebihi
outstanding amount.

**Option C**  
Banyak payment hanya melalui installment schedule yang menyimpan urutan dan
nominal yang disetujui.

**Impact**  
Mempengaruhi data model allocation, state machine, idempotency, approval
scope, reporting, dan reconciliation.

**Recommendation**  
Owner harus membedakan business multi-payment dari provider retry dan
menetapkan batas total pembayaran sebelum desain data dipilih.

**Decision Owner**  
Finance owner.

**Status**  
PENDING

### BD-09-006

**Topic**  
Failed payment.

**Current Evidence**  
Modul generik `payments` sudah memiliki status `failed`, tetapi tidak ada
kontrak yang menjelaskan dampaknya pada `mkt_ap_preparations` atau invoice
Marketplace. AP preparation saat ini tidak memiliki status failed payment.

**Why clarification is required**  
Kegagalan provider, bank, validasi, atau callback dapat memiliki tindakan
lanjutan berbeda dan tidak boleh diam-diam dianggap sebagai unpaid biasa.

**Possible Options**

**Option A**  
Payment menjadi `failed`, AP tetap `waiting_payment`, dan dapat diproses
kembali setelah review.

**Option B**  
Payment failed mengembalikan AP ke status payment-request/approval sebelum
retry.

**Option C**  
Payment failed menutup attempt tersebut dan membuat payment request baru yang
terpisah dari attempt lama.

**Impact**  
Mempengaruhi status transition, visibility of error, notification, retry,
audit, duplicate protection, dan reconciliation.

**Recommendation**  
Gunakan status failed generik hanya sebagai evidence teknis; business owner
harus menetapkan lifecycle bisnis dan apakah kewajiban tetap actionable.

**Decision Owner**  
Finance/Treasury owner.

**Status**  
PENDING

### BD-09-007

**Topic**  
Retry pembayaran.

**Current Evidence**  
Notification queue memiliki retry/deduplication untuk notifikasi. Tidak
ditemukan retry semantics untuk payment execution Marketplace maupun batas
attempt provider.

**Why clarification is required**  
Retry dapat membuat attempt baru atau mengulang request yang sama. Perbedaan
ini penting untuk mencegah double charge dan untuk audit.

**Possible Options**

**Option A**  
Retry otomatis dengan idempotency key provider dan batas jumlah attempt.

**Option B**  
Retry hanya manual setelah Finance/Treasury meninjau failure reason.

**Option C**  
Sistem tidak melakukan retry; executor eksternal/provider bertanggung jawab
atas retry.

**Impact**  
Mempengaruhi idempotency key, locking, provider contract, alerting, actor
authority, dan operational runbook.

**Recommendation**  
Tidak ada retry policy yang boleh diturunkan dari notification queue. Owner
harus menentukan siapa yang melakukan retry, kapan, dan dengan reference apa.

**Decision Owner**  
Finance/Treasury owner dan pemilik integrasi payment.

**Status**  
PENDING

### BD-09-008

**Topic**  
Duplicate payment.

**Current Evidence**  
Duplicate vendor invoice reference dan duplicate AP preparation sudah memiliki
proteksi. `payments.providerMerchantTradeNo` unik pada modul generik, tetapi
belum ada duplicate contract yang mengikat payment ke Marketplace AP atau
invoice.

**Why clarification is required**  
Duplicate bisa berarti request yang sama diulang, payment provider reference
yang sama, atau dua pembayaran sah untuk partial/multi-payment. Masing-masing
memerlukan perlakuan berbeda.

**Possible Options**

**Option A**  
Blok setiap payment kedua untuk invoice/AP yang sudah memiliki payment aktif
atau final.

**Option B**  
Operasi dengan idempotency key yang sama mengembalikan payment existing;
payment baru hanya boleh dengan business approval yang berbeda.

**Option C**  
Duplicate diperbolehkan hanya jika aturan partial/multi-payment mengizinkan
dan outstanding balance masih mencukupi.

**Impact**  
Mempengaruhi unique constraint, response idempotent, concurrency guard,
provider reconciliation, alerting, dan incident handling.

**Recommendation**  
Owner harus menetapkan definisi duplicate pada level business reference,
provider reference, dan execution attempt sebelum constraint dibuat.

**Decision Owner**  
Finance/Treasury owner dan pemilik integrasi payment.

**Status**  
PENDING

### BD-09-009

**Topic**  
Cancellation.

**Current Evidence**  
Modul generik `payments` memiliki status `cancelled`, sementara
`mkt_ap_preparations.status` hanya memiliki `ap_preparation`,
`finance_review`, dan `waiting_payment`. Tidak ditemukan aturan cancellation
Marketplace setelah payment request atau saat execution berlangsung.

**Why clarification is required**  
Cancellation sebelum execution, sesudah instruction dikirim, dan sesudah
provider menerima payment dapat mempunyai konsekuensi yang berbeda.

**Possible Options**

**Option A**  
Cancellation hanya boleh sebelum payment execution dimulai.

**Option B**  
Cancellation boleh selama status pending, dengan approval dan alasan wajib.

**Option C**  
Tidak ada cancellation setelah AP waiting payment; koreksi dilakukan melalui
reversal/refund process.

**Impact**  
Mempengaruhi terminal state, authorization, reason/audit, provider cancel
API, outstanding liability, dan notification.

**Recommendation**  
Jangan menyalin status `cancelled` generik ke Marketplace tanpa menentukan
cut-off execution dan konsekuensi accounting.

**Decision Owner**  
Finance owner dan business owner.

**Status**  
PENDING

### BD-09-010

**Topic**  
Reversal atau refund setelah payment.

**Current Evidence**  
Architecture repository menyatakan posted accounting entries immutable dan
reversal-only. Accounting payment juga memiliki status `voided`, tetapi tidak
ada Marketplace payment settlement/reversal contract atau aturan provider
refund.

**Why clarification is required**  
Reversal accounting, void payment instruction, dan refund dari provider bukan
operasi yang sama. Trigger dan kewenangannya harus dibedakan.

**Possible Options**

**Option A**  
Reversal membuat accounting reversal entry; payment asli tetap immutable.

**Option B**  
Refund/chargeback diproses melalui provider, lalu accounting/reconciliation
mengikuti settlement refund.

**Option C**  
Kombinasi: void sebelum settlement, refund sesudah settlement, dan reversal
accounting untuk entry yang sudah posted.

**Impact**  
Mempengaruhi immutable ledger rules, provider integration, audit trail,
approval, bank reconciliation, dan legal/financial reporting.

**Recommendation**  
Owner harus menentukan istilah dan trigger untuk void, refund, reversal, dan
chargeback; repository hanya membuktikan aturan reversal accounting yang
immutable.

**Decision Owner**  
Finance/Accounting owner dan pemilik integrasi payment.

**Status**  
PENDING

### BD-09-011

**Topic**  
Relationship dengan Accounting.

**Current Evidence**  
AP preparation hanya menyimpan snapshot invoice/PO/GR dan berhenti pada
`waiting_payment`; service tersebut tidak membuat journal. Repository memiliki
accounting payment dengan status approval/posting, tetapi tidak ada source
contract Marketplace AP-to-accounting yang terbukti.

**Why clarification is required**  
Harus ditentukan kapan kewajiban dan cash movement dicatat, apakah payment
Marketplace membuat journal, dan entity mana yang menjadi source canonical.

**Possible Options**

**Option A**  
Accounting entry dibuat saat AP preparation/approval untuk mengakui payable;
payment kemudian mencatat settlement payable dan cash.

**Option B**  
Accounting entry dibuat saat payment execution/settlement berdasarkan hasil
payment.

**Option C**  
Marketplace hanya melakukan handoff ke Accounting; modul Accounting membuat
entry berdasarkan contract yang disepakati.

**Impact**  
Mempengaruhi journal source, COA mapping, posting authority, period lock,
reversal, error visibility, dan reconciliation.

**Recommendation**  
Tidak ada posting timing yang boleh diasumsikan dari snapshot AP. Accounting
owner harus menetapkan source canonical, posting timing, dan perlakuan failure
sebelum implementation scope ditetapkan.

**Decision Owner**  
Accounting owner dan Finance owner.

**Status**  
PENDING

### BD-09-012

**Topic**  
Relationship dengan Bank Reconciliation.

**Current Evidence**  
Repository memiliki bank reconciliation yang mengharuskan source payment/journal
dan mencegah satu payment source direconcile ke lebih dari satu ledger line.
QRIS reconciliation juga memiliki aturan provider/reference dan gross-net fee.
Tidak ditemukan Marketplace-specific settlement mapping setelah
`waiting_payment`.

**Why clarification is required**  
Bank reconciliation perlu tahu apakah yang dicocokkan adalah payment
instruction, provider settlement, accounting journal, atau kombinasi
keduanya.

**Possible Options**

**Option A**  
Reconciliation mencocokkan bank statement ke accounting journal Marketplace;
payment menjadi supporting reference.

**Option B**  
Reconciliation mencocokkan settlement provider ke payment record, lalu
journal dihubungkan dari payment.

**Option C**  
Keduanya digunakan: provider settlement mencocokkan payment terlebih dahulu,
bank statement kemudian mencocokkan settlement dan accounting journal.

**Impact**  
Mempengaruhi source uniqueness, fee/net amount, settlement timing, matching
rules, exception queue, audit, dan period close.

**Recommendation**  
Owner harus menetapkan canonical reconciliation source dan urutan matching.
Aturan existing tentang uniqueness dan gross-net fee tetap menjadi constraint,
bukan keputusan baru untuk Marketplace.

**Decision Owner**  
Accounting/Reconciliation owner dan Finance/Treasury owner.

**Status**  
PENDING

## Decision Review

### BD-09-001

**Topic**  
Payment lifecycle setelah `waiting_payment`.

**Repository Evidence**  
`mktApPreparationService` dan `mkt_ap_preparations.status` membuktikan lifecycle
`ap_preparation → finance_review → waiting_payment`. Modul generik `payments`
memiliki status `pending`, `paid`, `expired`, `cancelled`, dan `failed`, tetapi
repository tidak membuktikan relasi Marketplace AP ke tabel tersebut.

**Current Implementation**  
AP preparation dapat dibuat dari invoice `ready_for_ap`, direview, lalu
dipindahkan ke `waiting_payment`. Tidak ada status, service, atau route
Marketplace yang menjalankan fase setelahnya.

**Business Gap**  
Nama fase berikutnya, entity canonical, status machine, terminal state, serta
boundary antara Marketplace, payment, dan accounting belum ditetapkan.

**Why clarification is required**  
Repository does not provide sufficient evidence.

**Possible Option A**

**Keuntungan**  
Memakai modul payment existing dan mengurangi duplikasi lifecycle.

**Konsekuensi**  
Kontrak relasi Marketplace, ownership, dan batas kewenangan modul payment harus
ditetapkan lebih dahulu; status generik belum cukup sebagai kontrak bisnis.

**Possible Option B**

**Keuntungan**  
Payment request Marketplace dapat menyimpan konteks AP secara eksplisit sebelum
handoff ke executor.

**Konsekuensi**  
Membutuhkan entity, status, dan integrasi baru serta berisiko tumpang tindih
dengan modul payment existing.

**Possible Option C**

**Keuntungan**  
Marketplace dapat mengontrol lifecycle sampai settlement dan menyediakan audit
yang spesifik untuk transaksi vendor.

**Konsekuensi**  
Scope, data model, security boundary, dan tanggung jawab accounting/
reconciliation menjadi lebih besar.

**Architecture Impact**  
Menentukan bounded context dan source of truth untuk lifecycle payment.

**Database Impact**  
Kemungkinan memerlukan relasi, status, terminal state, dan constraint baru;
belum boleh ditentukan sebelum keputusan bisnis.

**API Impact**  
Menentukan apakah route baru dibuat, route payment existing diperluas, atau
hanya dibuat handoff contract.

**Marketplace Impact**  
Menentukan kapan AP preparation dianggap selesai dan bagaimana status vendor
invoice ditampilkan.

**Accounting Impact**  
Menentukan kapan kewajiban dan cash movement dapat diteruskan ke accounting.

**Security Impact**  
Menentukan actor yang boleh membuat, mengubah, atau mengeksekusi payment.

**Regression Risk**  
Perubahan boundary dapat memengaruhi invoice, AP preparation, notification,
activity log, dan payment generic flow.

**Recommendation**  
Tidak memilih opsi. Product Owner harus menetapkan boundary dan scope Sprint 09.

**Decision Required From Product Owner**  
Tetapkan fase, entity canonical, status machine, terminal states, dan apakah
payment execution termasuk Sprint 09.

**Status**  
PENDING

### BD-09-002

**Topic**  
Payment approval hierarchy.

**Repository Evidence**  
AP preparation memakai admin authorization serta mencatat
`financeReviewedBy` dan `financeReviewedAt`. Tidak ditemukan hierarchy
approval payment, threshold nominal, atau segregation-of-duties contract.

**Current Implementation**  
Finance review AP preparation adalah transition tersendiri. Repository tidak
menunjukkan bahwa transition tersebut sama dengan approval payment.

**Business Gap**  
Role, hierarchy, threshold, company scope, dan maker-checker rule untuk
payment belum ditetapkan.

**Why clarification is required**  
Approval AP dan approval payment dapat memiliki risiko, actor, dan audit
berbeda. Repository does not provide sufficient evidence untuk menyamakan
keduanya.

**Possible Option A**

**Keuntungan**  
Alur sederhana dan mudah diaudit untuk setiap payment.

**Konsekuensi**  
Tidak membedakan nominal, company, atau risiko; approval tunggal dapat tidak
sesuai kontrol internal.

**Possible Option B**

**Keuntungan**  
Dapat menyesuaikan approval dengan nominal, perusahaan, atau kategori.

**Konsekuensi**  
Membutuhkan konfigurasi hierarchy dan evaluasi rule yang belum ada.

**Possible Option C**

**Keuntungan**  
Memisahkan maker dan checker serta memperkuat segregation of duties.

**Konsekuensi**  
Membutuhkan actor identity, fallback/escalation, dan penanganan konflik role.

**Architecture Impact**  
Menentukan authorization policy dan workflow approval yang menjadi sumber
kebenaran.

**Database Impact**  
Kemungkinan memerlukan approval records, approver assignments, threshold, dan
audit metadata.

**API Impact**  
Menentukan endpoint approval, actor validation, status guard, dan error
response.

**Marketplace Impact**  
Menentukan kapan AP waiting payment dapat diproses oleh payment boundary.

**Accounting Impact**  
Approval payment dapat menjadi prasyarat posting atau settlement, tetapi
hubungan tersebut belum ditetapkan.

**Security Impact**  
Risiko utama adalah privilege escalation dan maker-checker bypass.

**Regression Risk**  
Salah menyamakan finance review dengan payment approval dapat membuka
execution tanpa approval yang dimaksud.

**Recommendation**  
Tidak memilih opsi dan tidak menganggap `admin` sebagai payment approver
default.

**Decision Required From Product Owner**  
Tetapkan role, hierarchy, threshold, company scope, dan segregation-of-duties.

**Status**  
PENDING

### BD-09-003

**Topic**  
Payment execution authority.

**Repository Evidence**  
Repository memiliki provider Paylabs dan model payment generic, tetapi tidak
menunjukkan actor atau service yang mengeksekusi payment vendor Marketplace
setelah `waiting_payment`.

**Current Implementation**  
Tidak ada Marketplace payment execution route, callback contract, treasury
workflow, atau handoff contract yang terbukti.

**Business Gap**  
Belum jelas apakah executor adalah Finance/Treasury, provider, service
internal, bank, atau sistem eksternal.

**Why clarification is required**  
Pembuatan request, approval, dan execution merupakan tindakan berbeda.
Repository does not provide sufficient evidence untuk menetapkan authority.

**Possible Option A**

**Keuntungan**  
Kontrol execution tetap berada pada Finance/Treasury internal.

**Konsekuensi**  
Memerlukan operational workflow dan kemungkinan integrasi bank/provider yang
belum ditentukan.

**Possible Option B**

**Keuntungan**  
Provider menangani execution setelah instruction yang disetujui dikirim.

**Konsekuensi**  
Memerlukan callback, idempotency, credential boundary, dan penanganan status
provider.

**Possible Option C**

**Keuntungan**  
Aplikasi tetap menjadi system of record tanpa mengambil alih execution
eksternal.

**Konsekuensi**  
Memerlukan contract handoff dan mekanisme sinkronisasi status/reference.

**Architecture Impact**  
Menentukan ownership antara Marketplace, payment service, Treasury, dan
provider.

**Database Impact**  
Kemungkinan memerlukan execution attempt, provider reference, executor, dan
timestamps.

**API Impact**  
Menentukan endpoint instruction, execute, callback, atau status inquiry.

**Marketplace Impact**  
Menentukan status vendor invoice/AP setelah instruksi dikirim dan setelah
settlement diketahui.

**Accounting Impact**  
Menentukan event yang menjadi dasar pencatatan cash movement.

**Security Impact**  
Mempengaruhi secret scope, permission, callback authentication, dan audit
actor.

**Regression Risk**  
Execution authority yang salah dapat menyebabkan payment tidak dapat diaudit
atau dieksekusi lebih dari sekali.

**Recommendation**  
Tidak memilih opsi. Authority harus ditetapkan oleh owner kontrol operasional.

**Decision Required From Product Owner**  
Tetapkan executor, approval prerequisite, callback/status source, dan owner
atas kegagalan execution.

**Status**  
PENDING

### BD-09-004

**Topic**  
Partial payment.

**Repository Evidence**  
AP preparation menyimpan snapshot total invoice dan berhenti pada
`waiting_payment`. Tidak ditemukan paid amount, outstanding balance, atau
allocation Marketplace.

**Current Implementation**  
Modul payment generic memiliki `amount`, tetapi tidak ada bukti bahwa amount
tersebut dialokasikan ke vendor invoice Marketplace.

**Business Gap**  
Belum ditentukan apakah partial payment boleh, bagaimana outstanding dihitung,
dan kapan kewajiban dianggap selesai.

**Why clarification is required**  
Repository does not provide sufficient evidence untuk menganggap payment
generic sebagai dukungan partial payment Marketplace.

**Possible Option A**

**Keuntungan**  
Model dan kontrol lebih sederhana; kewajiban selalu dilunasi penuh.

**Konsekuensi**  
Tidak mendukung kebutuhan bisnis yang memerlukan pembayaran bertahap.

**Possible Option B**

**Keuntungan**  
Mendukung pembayaran sebagian dengan outstanding balance server-side.

**Konsekuensi**  
Memerlukan allocation, total-limit guard, status tambahan, dan rekonsiliasi
saldo.

**Possible Option C**

**Keuntungan**  
Installment dapat direncanakan dan disetujui sebelum payment dibuat.

**Konsekuensi**  
Memerlukan schedule, due date, approval, dan failure semantics tambahan.

**Architecture Impact**  
Menentukan apakah payment adalah settlement tunggal atau kumpulan allocation.

**Database Impact**  
Kemungkinan memerlukan allocation/settlement records dan saldo tersisa.

**API Impact**  
Amount payment tidak boleh menjadi authority client tanpa perhitungan server.

**Marketplace Impact**  
Status AP dan vendor invoice perlu merepresentasikan paid/remaining amount.

**Accounting Impact**  
Partial settlement dapat memengaruhi payable balance dan jurnal settlement.

**Security Impact**  
Amount over-allocation dan client tampering harus dicegah server-side.

**Regression Risk**  
Perubahan amount semantics dapat memengaruhi payment generic dan reconciliation.

**Recommendation**  
Tidak memilih opsi dan tidak mengasumsikan partial payment didukung.

**Decision Required From Product Owner**  
Tetapkan izin partial payment, formula outstanding, dan definisi full settlement.

**Status**  
PENDING

### BD-09-005

**Topic**  
Multi-payment terhadap satu invoice/AP preparation.

**Repository Evidence**  
`mkt_ap_preparations.vendorInvoiceId` unik. Tidak ditemukan allocation atau
relasi yang membuktikan lebih dari satu payment untuk satu kewajiban Marketplace.

**Current Implementation**  
Satu invoice hanya memiliki satu AP preparation; belum ada model yang
membedakan multi-payment bisnis dari retry teknis.

**Business Gap**  
Belum ditentukan apakah satu AP preparation boleh memiliki banyak payment,
serta batas total nominalnya.

**Why clarification is required**  
Repository does not provide sufficient evidence untuk memilih single-payment,
multi-payment, atau installment.

**Possible Option A**

**Keuntungan**  
Constraint dan audit lebih sederhana.

**Konsekuensi**  
Tidak mendukung installment atau partial settlement.

**Possible Option B**

**Keuntungan**  
Fleksibel untuk beberapa payment selama outstanding tidak terlampaui.

**Konsekuensi**  
Memerlukan allocation, concurrency guard, dan perhitungan aggregate.

**Possible Option C**

**Keuntungan**  
Membedakan payment yang direncanakan melalui schedule yang eksplisit.

**Konsekuensi**  
Menambah lifecycle dan kewajiban operasional untuk mengelola schedule.

**Architecture Impact**  
Menentukan one-to-one atau one-to-many antara AP dan payment.

**Database Impact**  
Kemungkinan memerlukan child payment/allocation table dan unique business key.

**API Impact**  
Create payment, list payments, dan status AP harus menangani aggregate state.

**Marketplace Impact**  
Invoice/AP tidak dapat memakai status `paid` tanpa definisi semua allocation.

**Accounting Impact**  
Setiap settlement dapat menghasilkan event accounting/reconciliation berbeda.

**Security Impact**  
Race condition harus mencegah total payment melewati outstanding.

**Regression Risk**  
Unique relation existing dapat bertentangan dengan desain multi-payment baru.

**Recommendation**  
Tidak memilih opsi. Bedakan business multi-payment dari provider retry dahulu.

**Decision Required From Product Owner**  
Tetapkan cardinality payment, batas aggregate, dan definisi completion.

**Status**  
PENDING

### BD-09-006

**Topic**  
Failed payment.

**Repository Evidence**  
Modul `payments` memiliki status `failed`, tetapi AP preparation tidak memiliki
status failed payment atau transition yang menggunakannya.

**Current Implementation**  
Failure pada payment generic belum memiliki dampak yang terbukti terhadap
Marketplace invoice atau AP preparation.

**Business Gap**  
Belum jelas apakah AP tetap actionable, kembali ke approval, atau memerlukan
payment request baru.

**Why clarification is required**  
Repository does not provide sufficient evidence tentang perbedaan failure
provider, bank, validation, callback, dan business rejection.

**Possible Option A**

**Keuntungan**  
AP tetap berada pada boundary `waiting_payment` dan dapat diproses kembali.

**Konsekuensi**  
Status AP mungkin tidak cukup untuk membedakan attempt gagal dari payment
yang belum dimulai.

**Possible Option B**

**Keuntungan**  
Failure memaksa review/approval ulang sebelum retry.

**Konsekuensi**  
Menambah transition dan operational work.

**Possible Option C**

**Keuntungan**  
Setiap attempt memiliki audit terpisah dan request baru tidak menimpa histori.

**Konsekuensi**  
Membutuhkan relasi attempt, duplicate guard, dan rekonsiliasi antar-attempt.

**Architecture Impact**  
Menentukan apakah failure adalah state payment, state AP, atau keduanya.

**Database Impact**  
Kemungkinan memerlukan failure reason, attempt, dan error metadata.

**API Impact**  
Response harus membedakan failed, retryable, dan terminal failure bila owner
memilihnya.

**Marketplace Impact**  
Menentukan visibilitas dan tindakan lanjutan pada invoice vendor.

**Accounting Impact**  
Payment gagal tidak boleh dianggap settled; timing pencatatan harus ditentukan.

**Security Impact**  
Failure detail dapat mengandung provider information yang perlu dibatasi.

**Regression Risk**  
Mapping failure yang keliru dapat menandai kewajiban lunas atau membuat retry
ganda.

**Recommendation**  
Tidak memilih opsi. Status generic `failed` bukan keputusan lifecycle
Marketplace.

**Decision Required From Product Owner**  
Tetapkan state setelah failure, retryability, owner review, dan error visibility.

**Status**  
PENDING

### BD-09-007

**Topic**  
Retry pembayaran.

**Repository Evidence**  
Notification queue memiliki retry/deduplication untuk notifikasi. Tidak
ditemukan retry semantics atau batas attempt untuk payment execution
Marketplace.

**Current Implementation**  
Retry queue notifikasi tidak dapat menjadi bukti retry payment karena objek,
risiko, dan idempotency-nya berbeda.

**Business Gap**  
Belum ditentukan siapa yang retry, kapan retry aman, apakah attempt baru dibuat,
dan berapa batas retry.

**Why clarification is required**  
Repository does not provide sufficient evidence untuk memilih automatic,
manual, atau external retry.

**Possible Option A**

**Keuntungan**  
Mengurangi intervensi manual untuk failure transient.

**Konsekuensi**  
Memerlukan provider idempotency, backoff, limit, dan observability.

**Possible Option B**

**Keuntungan**  
Setiap retry melewati review manusia dan failure reason.

**Konsekuensi**  
Lebih lambat dan membutuhkan operational queue/process.

**Possible Option C**

**Keuntungan**  
Sistem internal tidak mengambil tanggung jawab retry provider.

**Konsekuensi**  
Status aplikasi dapat tertunda atau memerlukan sinkronisasi eksternal.

**Architecture Impact**  
Menentukan ownership scheduler, retry worker, atau external handoff.

**Database Impact**  
Kemungkinan memerlukan attempt count, next retry time, idempotency key, dan
retry reason.

**API Impact**  
Menentukan apakah retry endpoint manual tersedia dan siapa actor-nya.

**Marketplace Impact**  
Menentukan availability payment dan notifikasi kepada Finance/vendor.

**Accounting Impact**  
Retry tidak boleh membuat settlement/accounting duplicate.

**Security Impact**  
Retry harus membatasi abuse dan mencegah executor tidak berwenang mengulang.

**Regression Risk**  
Retry tanpa idempotency dapat menyebabkan double payment.

**Recommendation**  
Tidak memilih opsi. Notification retry tidak boleh dipakai sebagai payment
retry policy.

**Decision Required From Product Owner**  
Tetapkan retry owner, trigger, limit, idempotency semantics, dan terminal
failure behavior.

**Status**  
PENDING

### BD-09-008

**Topic**  
Duplicate payment.

**Repository Evidence**  
Duplicate invoice reference dan duplicate AP preparation memiliki proteksi.
`payments.providerMerchantTradeNo` unik, tetapi belum ada duplicate contract
yang mengikat payment ke Marketplace AP/invoice.

**Current Implementation**  
Proteksi duplicate existing berlaku pada invoice/AP atau provider reference
generic; belum membuktikan proteksi untuk business payment reference
Marketplace.

**Business Gap**  
Belum ditentukan perbedaan antara repeated request, repeated provider
reference, retry, dan dua payment sah.

**Why clarification is required**  
Repository does not provide sufficient evidence tentang business definition
duplicate pada boundary Marketplace.

**Possible Option A**

**Keuntungan**  
Mencegah payment kedua secara konservatif.

**Konsekuensi**  
Dapat memblok partial/multi-payment yang nantinya dianggap sah.

**Possible Option B**

**Keuntungan**  
Request identik idempotent, sedangkan payment baru membutuhkan approval baru.

**Konsekuensi**  
Membutuhkan stable idempotency key dan definisi request equivalence.

**Possible Option C**

**Keuntungan**  
Mengizinkan payment kedua bila outstanding masih tersedia dan rule bisnis
memang membolehkan.

**Konsekuensi**  
Risiko overpayment lebih tinggi dan membutuhkan locking/aggregate validation.

**Architecture Impact**  
Menentukan idempotency boundary antara Marketplace, payment, dan provider.

**Database Impact**  
Kemungkinan memerlukan unique business key dan constraint aggregate.

**API Impact**  
Create/retry harus mengembalikan existing record secara konsisten bila
idempotent.

**Marketplace Impact**  
Menentukan apakah invoice/AP dapat memiliki payment aktif atau final lebih dari
sekali.

**Accounting Impact**  
Duplicate settlement dapat menghasilkan cash dan liability yang salah.

**Security Impact**  
Harus mencegah replay dan concurrent duplicate execution.

**Regression Risk**  
Constraint terlalu ketat dapat merusak partial payment; terlalu longgar dapat
menyebabkan duplicate disbursement.

**Recommendation**  
Tidak memilih opsi. Owner harus menetapkan definisi duplicate pada tiga level:
business reference, provider reference, dan execution attempt.

**Decision Required From Product Owner**  
Tetapkan duplicate rule, idempotency response, dan pengecualian untuk
multi-payment bila ada.

**Status**  
PENDING

### BD-09-009

**Topic**  
Cancellation.

**Repository Evidence**  
Modul generic `payments` memiliki status `cancelled`, sedangkan enum AP
preparation hanya mencakup `ap_preparation`, `finance_review`, dan
`waiting_payment`. Tidak ditemukan cancellation rule Marketplace.

**Current Implementation**  
Tidak ada transition cancellation Marketplace setelah AP menunggu payment.
Status generic `cancelled` belum memiliki arti terhadap AP obligation.

**Business Gap**  
Belum ditentukan cut-off cancellation, actor, reason, dan dampaknya bila
instruction sudah dikirim atau provider sudah menerima.

**Why clarification is required**  
Repository does not provide sufficient evidence untuk menyamakan cancellation
sebelum execution dengan reversal/refund setelah settlement.

**Possible Option A**

**Keuntungan**  
Cancellation dibatasi pada titik yang risiko eksternalnya lebih rendah.

**Konsekuensi**  
Kasus setelah execution membutuhkan proses lain yang belum ditetapkan.

**Possible Option B**

**Keuntungan**  
Memberi kontrol manual selama payment masih pending.

**Konsekuensi**  
Memerlukan provider cancel contract dan approval/reason audit.

**Possible Option C**

**Keuntungan**  
Menghindari pembatalan ambiguous setelah AP waiting payment.

**Konsekuensi**  
Semua koreksi setelahnya bergantung pada reversal/refund process.

**Architecture Impact**  
Menentukan apakah cancellation adalah AP transition, payment transition, atau
external instruction.

**Database Impact**  
Kemungkinan memerlukan cancelled actor/time/reason dan relation ke attempt.

**API Impact**  
Menentukan cancel endpoint, authorization, current-status guard, dan response.

**Marketplace Impact**  
Menentukan apakah vendor invoice tetap payable atau perlu proses ulang.

**Accounting Impact**  
Cancellation sebelum posting berbeda dari reversal setelah posting.

**Security Impact**  
Cancellation adalah financial action dan memerlukan least privilege serta
audit.

**Regression Risk**  
Cancellation yang terlalu luas dapat membatalkan kewajiban atau payment yang
telah settlement.

**Recommendation**  
Tidak memilih opsi dan tidak menyalin status generic `cancelled` ke Marketplace.

**Decision Required From Product Owner**  
Tetapkan cancellation cut-off, actor, reason requirement, dan post-execution
handling.

**Status**  
PENDING

### BD-09-010

**Topic**  
Reversal atau refund setelah payment.

**Repository Evidence**  
Architecture repository menyatakan posted accounting entries immutable dan
reversal-only. Accounting payment memiliki status `voided`, tetapi tidak ada
Marketplace payment settlement/reversal/refund contract.

**Current Implementation**  
Tidak ada Marketplace-specific operation untuk void, refund, chargeback, atau
reversal setelah payment.

**Business Gap**  
Istilah, trigger, authority, dan accounting consequence untuk void, refund,
chargeback, dan reversal belum dibedakan.

**Why clarification is required**  
Repository hanya memberi constraint accounting immutability; repository does
not provide sufficient evidence untuk payment provider behavior.

**Possible Option A**

**Keuntungan**  
Konsisten dengan prinsip ledger immutable dan audit reversal.

**Konsekuensi**  
Tidak dengan sendirinya mengembalikan dana dari provider.

**Possible Option B**

**Keuntungan**  
Menangani refund/chargeback melalui provider dan mengikuti settlement aktual.

**Konsekuensi**  
Memerlukan provider contract, callback, fee handling, dan exception process.

**Possible Option C**

**Keuntungan**  
Membedakan void sebelum settlement, refund sesudah settlement, dan reversal
accounting sesuai tahapnya.

**Konsekuensi**  
State machine dan audit menjadi lebih kompleks.

**Architecture Impact**  
Menentukan lifecycle correction lintas payment, provider, accounting, dan
reconciliation.

**Database Impact**  
Kemungkinan memerlukan relation original-to-reversal/refund dan immutable
event records.

**API Impact**  
Menentukan operation endpoint, approval, provider callback, dan status inquiry.

**Marketplace Impact**  
Menentukan bagaimana invoice/AP dan vendor settlement ditampilkan setelah
koreksi.

**Accounting Impact**  
Reversal harus mengikuti immutable posted-entry rule dan period controls.

**Security Impact**  
Refund/reversal memerlukan authority kuat, reason, dan anti-replay controls.

**Regression Risk**  
Salah membedakan void/refund/reversal dapat merusak ledger atau saldo bank.

**Recommendation**  
Tidak memilih opsi. Product Owner harus menetapkan terminology dan trigger
masing-masing operasi.

**Decision Required From Product Owner**  
Tetapkan aturan void, refund, chargeback, reversal, authority, dan hubungan
ke accounting.

**Status**  
PENDING

### BD-09-011

**Topic**  
Relationship dengan Accounting.

**Repository Evidence**  
AP preparation hanya menyimpan snapshot invoice/PO/GR dan tidak membuat journal.
Repository memiliki accounting payment dengan status approval/posting, tetapi
tidak memiliki source contract Marketplace AP-to-accounting.

**Current Implementation**  
Boundary Marketplace yang terbukti berhenti di `waiting_payment`; posting
timing, COA mapping, dan source canonical untuk vendor payment belum tersedia.

**Business Gap**  
Belum ditentukan kapan payable dan cash movement dicatat, siapa yang posting,
serta bagaimana posting failure terlihat pada payment/AP.

**Why clarification is required**  
Repository does not provide sufficient evidence untuk memilih posting saat AP
approval, payment execution, settlement, atau handoff.

**Possible Option A**

**Keuntungan**  
Payable dapat diakui lebih awal dan settlement payment dicatat terpisah.

**Konsekuensi**  
Memerlukan mapping AP liability serta korelasi settlement.

**Possible Option B**

**Keuntungan**  
Journal mengikuti execution/settlement aktual.

**Konsekuensi**  
Kewajiban dapat belum tercermin selama menunggu payment dan failure semantics
menjadi penting.

**Possible Option C**

**Keuntungan**  
Accounting tetap menjadi owner posting melalui handoff contract.

**Konsekuensi**  
Membutuhkan interface yang jelas dan penanganan status handoff.

**Architecture Impact**  
Menentukan boundary antara Marketplace AP, payment, Accounting, dan posting
service.

**Database Impact**  
Kemungkinan memerlukan source link, posting status/error, journal reference,
dan correlation key.

**API Impact**  
Menentukan handoff/post/retry endpoint dan authority atas posting.

**Marketplace Impact**  
Menentukan kapan AP preparation dianggap handed off atau settled.

**Accounting Impact**  
Menentukan COA, journal timing, immutability, period lock, dan reversal.

**Security Impact**  
Posting dan approval harus dipisahkan sesuai authority yang disetujui.

**Regression Risk**  
Posting timing yang salah dapat membuat payable, cash, dan reconciliation tidak
sinkron.

**Recommendation**  
Tidak memilih opsi dan tidak membuat journal dari AP preparation tanpa keputusan
Accounting owner.

**Decision Required From Product Owner**  
Tetapkan source canonical, posting timing, COA ownership, failure visibility,
dan apakah accounting termasuk Sprint 09.

**Status**  
PENDING

### BD-09-012

**Topic**  
Relationship dengan Bank Reconciliation.

**Repository Evidence**  
Bank reconciliation mencegah satu payment source direconcile ke lebih dari satu
ledger line. QRIS reconciliation memiliki aturan provider/reference dan
gross-net fee. Tidak ditemukan settlement mapping Marketplace setelah
`waiting_payment`.

**Current Implementation**  
Tidak ada Marketplace-specific mapping yang menentukan apakah yang direconcile
adalah payment instruction, provider settlement, accounting journal, atau
kombinasi.

**Business Gap**  
Canonical source, matching order, fee/net treatment, settlement timing, dan
exception ownership belum ditetapkan.

**Why clarification is required**  
Repository does not provide sufficient evidence untuk memilih source atau
urutan reconciliation Marketplace.

**Possible Option A**

**Keuntungan**  
Bank statement langsung dikaitkan dengan accounting journal sebagai record
financial utama.

**Konsekuensi**  
Payment/provider reference menjadi supporting data dan settlement intermediary
harus tetap dapat ditelusuri.

**Possible Option B**

**Keuntungan**  
Provider settlement dapat diverifikasi ke payment sebelum dikaitkan ke journal.

**Konsekuensi**  
Memerlukan provider settlement feed dan korelasi berlapis.

**Possible Option C**

**Keuntungan**  
Menyediakan chain provider settlement → payment → journal → bank statement.

**Konsekuensi**  
Arsitektur dan exception handling paling kompleks.

**Architecture Impact**  
Menentukan source-of-truth chain dan urutan matching antar sistem.

**Database Impact**  
Kemungkinan memerlukan settlement reference, fee, net amount, dan source links.

**API Impact**  
Menentukan import/callback/status API dan exception resolution route.

**Marketplace Impact**  
Menentukan kapan payment vendor dianggap settled dan bagaimana mismatch
ditampilkan.

**Accounting Impact**  
Memengaruhi journal link, fee posting, period close, dan reversal.

**Security Impact**  
Settlement data dan bank references memerlukan scope, audit, dan anti-duplicate
controls.

**Regression Risk**  
Mapping yang salah dapat membuat satu source direconcile dua kali atau
meninggalkan cash movement tanpa supporting payment.

**Recommendation**  
Tidak memilih opsi. Existing uniqueness dan gross-net rules dipertahankan
sebagai constraints, bukan keputusan Marketplace baru.

**Decision Required From Product Owner**  
Tetapkan canonical reconciliation source, matching sequence, fee treatment, dan
owner exception.

**Status**  
PENDING

## Decision Matrix

| Decision | Status | Blocking Sprint 9 | Owner |
|---|---|---|---|
| BD-09-001 | PENDING | YES | Product Owner + Finance Owner |
| BD-09-002 | PENDING | YES | Product Owner + Finance Owner |
| BD-09-003 | PENDING | YES | Product Owner + Finance/Treasury Owner |
| BD-09-004 | PENDING | YES | Product Owner + Finance Owner |
| BD-09-005 | PENDING | YES | Finance Owner |
| BD-09-006 | PENDING | YES | Finance/Treasury Owner |
| BD-09-007 | PENDING | YES | Finance/Treasury Owner + Payment Integration Owner |
| BD-09-008 | PENDING | YES | Finance/Treasury Owner + Payment Integration Owner |
| BD-09-009 | PENDING | YES | Product Owner + Finance Owner |
| BD-09-010 | PENDING | YES | Finance/Accounting Owner + Payment Integration Owner |
| BD-09-011 | PENDING | YES | Product Owner + Accounting/Finance Owner |
| BD-09-012 | PENDING | YES | Accounting/Reconciliation Owner + Finance/Treasury Owner |

## Decision Status Summary

- Total business decision: **12**
- Total blocking: **12**
- Total ready: **0**
- Total pending: **12**
- Tidak ada opsi yang dianggap disetujui oleh dokumen ini.
- Sprint 09 tetap **NOT STARTED** dan **NO GO** sampai seluruh decision owner
  menetapkan boundary payment, approval/execution authority, accounting,
  reconciliation, serta acceptance criteria.

## Scope

Scope dokumen ini hanya:

- mencatat lifecycle Marketplace yang sudah terbukti;
- mengidentifikasi boundary terakhir Sprint 8;
- mencatat logical next phase sebagai kandidat untuk keputusan bisnis;
- mengunci bahwa implementasi Sprint 9 belum boleh dimulai tanpa klarifikasi.

## Out of Scope

Tanpa spesifikasi bisnis tambahan, hal-hal berikut berada di luar scope:

- pembuatan atau perubahan endpoint;
- perubahan source code;
- perubahan database atau migration;
- pembuatan payment request atau payment record Marketplace;
- payment approval atau payment execution;
- journal, accounting posting, cash disbursement, atau bank reconciliation;
- perubahan lifecycle PO, shipment, POD, Goods Receipt, vendor invoice, atau
  3-Way Match yang sudah ada;
- desain status, payload, role matrix, UI, notifikasi, atau retry policy baru.

## Existing Components to Reuse

Komponen berikut adalah bukti existing boundary dan hanya boleh dipakai setelah
business clarification menetapkan requirement:

- `mktVendorInvoiceService` untuk vendor invoice dan 3-Way Match;
- `mktApPreparationService` untuk AP preparation sampai `waiting_payment`;
- `mktAdmin` routes untuk admin authorization dan transition endpoint yang sudah
  ada;
- `mktApPreparationsTable` untuk snapshot AP preparation;
- `vendorInvoicesTable`, `mktPurchaseOrdersTable`, dan
  `mktPoGoodsReceiptsTable` sebagai referensi lifecycle yang sudah dibangun;
- `marketplaceNotificationQueueService` untuk notification queue yang sudah ada;
- `activityLog` untuk audit trail yang sudah ada.

Tidak ada komponen existing yang, berdasarkan bukti yang dianalisis, menetapkan
payment execution Marketplace setelah `waiting_payment`.

## Lifecycle

Lifecycle yang terbukti:

```text
Marketplace PO
  → vendor confirmation
  → production
  → ready_to_ship
  → shipment / delivery
  → POD
  → Goods Receipt
  → vendor invoice
  → 3-Way Match
  → ready_for_ap
  → ap_preparation
  → finance_review
  → waiting_payment
```

Kandidat logical next phase:

```text
waiting_payment → [business decision required]
```

Tidak boleh ditambahkan status atau transisi sesudah `waiting_payment` hanya
berdasarkan dokumen ini.

## Server Authority

Boundary yang sudah terbukti server-authoritative:

- referensi invoice, PO, dan Goods Receipt dibaca dari database;
- hasil 3-Way Match dihitung server-side;
- snapshot AP preparation diambil dari invoice dan linked records;
- transition status AP menggunakan current-status guard;
- duplicate AP preparation dicegah berdasarkan vendor invoice;
- client tidak boleh menentukan hasil match atau snapshot finansial.

Authority untuk tahap sesudah `waiting_payment` belum ditentukan.

**Specification requires business clarification.**

## Validation

Validation yang sudah terbukti pada boundary Sprint 8 harus tetap menjadi
prasyarat:

- invoice memiliki PO dan Goods Receipt Marketplace yang konsisten;
- shipment sudah `delivered`;
- Goods Receipt sudah diterima/inspection `passed`;
- invoice lines cocok dengan PO lines;
- quantity, price, subtotal, tax, grand total, dan currency lulus tolerance;
- invoice berstatus `ready_for_ap` sebelum AP preparation dibuat;
- AP preparation memiliki reference PO, Goods Receipt, supplier, dan invoice.

Validation tambahan untuk tahap pembayaran belum dapat ditetapkan.

## Idempotency

Existing idempotency yang terbukti:

- vendor invoice duplicate reference dikembalikan sebagai existing invoice;
- AP preparation duplicate untuk vendor invoice dikembalikan sebagai existing
  preparation;
- transition yang sudah tercapai dikembalikan sebagai already-exists state;
- notification queue menggunakan deduplication key.

Idempotency untuk payment request, payment execution, atau payment retry belum
memiliki requirement resmi.

## Concurrency

Existing concurrency controls yang terbukti:

- invoice dan AP preparation menggunakan transaction serta row lock pada
  operasi penting;
- AP transition memakai expected current status di `UPDATE`;
- concurrent transition yang kalah dilaporkan sebagai conflict.

Locking, race behavior, dan retry semantics untuk tahap sesudah
`waiting_payment` belum ditentukan.

## Activity Log

Existing audit events mencakup antara lain:

- `invoice_uploaded`;
- `invoice_submitted`;
- `invoice_ready_for_ap`;
- `three_way_match_passed` atau `three_way_match_failed`;
- `mkt_ap_preparation_created`;
- `mkt_ap_finance_reviewed`;
- `mkt_ap_waiting_payment`.

Event audit untuk payment execution atau settlement Marketplace belum boleh
ditentukan tanpa business clarification.

## Notification

Existing notification queue mencatat event invoice dan AP preparation untuk
recipient admin dengan deduplication key.

Recipient, event type, channel, retry behavior, dan template untuk tahap sesudah
`waiting_payment` belum ditentukan.

## Security

Security boundary yang sudah terbukti:

- AP preparation routes membutuhkan admin authorization;
- route write menggunakan rate limiter;
- input action body divalidasi sebagai strict empty object;
- financial references dan amounts tidak dipercaya dari client;
- status transition dijaga server-side dan concurrency-safe.

Role separation untuk payment approval/execution, segregation of duties,
authorization scope, dan anti-duplicate payment belum ditentukan.

## Runtime Evidence

Dokumen ini adalah specification-only. Tidak ada test, build, typecheck, atau
runtime verification yang dijalankan sebagai bagian dari authoring ini.

Runtime evidence yang diperlukan untuk Sprint 9 belum dapat didefinisikan
sebelum business clarification menetapkan scope dan acceptance criteria.

## Regression Scope

Belum ada regression scope Sprint 9 yang sah untuk ditetapkan.

Setelah business clarification tersedia, regression scope minimal harus
diturunkan dari boundary yang dipilih dan tetap menjaga:

- Marketplace PO/vendor lifecycle;
- shipment, POD, dan Goods Receipt;
- vendor invoice dan 3-Way Match;
- AP preparation sampai `waiting_payment`;
- authorization, activity log, dan notification queue.

## Acceptance Criteria

Acceptance criteria Sprint 9 **belum dapat ditetapkan**.

Business clarification minimal harus menjawab:

1. Apa nama dan tujuan fase setelah `waiting_payment`?
2. Apakah fase tersebut membuat payment request, payment, atau hanya handoff?
3. Apa status machine dan terminal states-nya?
4. Siapa yang dapat membuat, menyetujui, mengeksekusi, membatalkan, dan
   merekonsiliasi pembayaran?
5. Apa relasi canonical ke `vendor_invoices`, `mkt_ap_preparations`, dan
   accounting?
6. Bagaimana idempotency, concurrency, partial payment, failure, retry,
   reversal, dan duplicate payment ditangani?
7. Apakah payment execution dan accounting termasuk scope Sprint 9 atau fase
   terpisah?

**Specification requires business clarification.**

## Final Evidence Matrix

| Area | Evidence from repository | Sprint 9 decision |
|---|---|---|
| Last completed flow | Vendor invoice → 3-Way Match → AP preparation → `waiting_payment` | Confirmed boundary |
| Last status | `waiting_payment` | Confirmed |
| Last entity | `mkt_ap_preparations` linked to vendor invoice, PO, and GR | Confirmed |
| Last business boundary | AP handoff before payment/accounting execution | Confirmed |
| Logical next phase | Payment-side processing after `waiting_payment` | Candidate only |
| Payment contract | No Marketplace-specific post-`waiting_payment` contract found | Requires clarification |
| Acceptance criteria | Not present in repository | Requires clarification |
| Implementation authority | No approved Sprint 9 specification | Do not start |
| Runtime evidence | Not applicable to authoring-only task | Not collected |

## GO / NO GO

**NO GO — Specification requires business clarification.**

Sprint 9 implementation must not start until the business owner confirms the
post-`waiting_payment` scope, lifecycle, authority, payment/accounting
boundary, and acceptance criteria.