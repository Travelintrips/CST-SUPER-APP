# Sprint 09

## Objective

Mendokumentasikan logical next phase Marketplace setelah lifecycle Sprint 8
berakhir pada `waiting_payment`, tanpa menetapkan requirement implementasi yang
belum didukung repository.

**Specification requires business clarification.**

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