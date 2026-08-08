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