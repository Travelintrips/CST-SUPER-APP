# Tahap 1 — Dependency Map: Posting Jurnal & Pajak

Tanggal audit: 2026-07-11
Lingkup: `artifacts/api-server/src/**`

## 1. Ringkasan Eksekutif

Sistem sudah punya **cikal-bakal** canonical posting engine (`postEntry()` di
`lib/accounting.ts`, dibungkus oleh `ledgerGuard.createJournal()`), dan
beberapa modul (Advance, Payroll, Fleet) sudah disiplin memakai service-layer
mereka sendiri yang memanggil `postEntry()`. Tapi ada **3 jalur bypass nyata**
yang INSERT langsung ke `accounting_entries` via raw SQL, dan **tidak ada**
jaminan atomicity antara posting jurnal dan posting pajak di modul manapun.

## 2. Peta Lengkap: Siapa Menyentuh `accounting_entries`

### 2a. Canonical entry points (yang seharusnya jadi satu-satunya jalur)

| File | Fungsi | Peran |
|---|---|---|
| `lib/accounting.ts:273` | `_postEntryCore()` (private) | Insert aktual — idempotency check, period-lock check, multi-currency balance validation, retry on entry_number conflict |
| `lib/accounting.ts:525` | `postEntry()` (public) | Wrapper `_postEntryCore` + governance-bypass detection untuk source manual + auto-lock (immutability) setelah posted |
| `lib/accounting.ts:~500` | `createDraftEntry()` | Untuk governance workflow (draft → pending_approval → approved → posted) |
| `lib/accounting.ts` (`postIntercompanyPair`) | Posting source+mirror **dalam satu `db.transaction()`** | Satu-satunya tempat yang sudah atomic multi-entry |
| `lib/accounting/ledgerGuard.ts:471` | `createJournal()` | Wrapper generic di atas `postEntry()`, untuk POS/HRD/MANUAL_ADJUSTMENT — validasi field wajib + balance check + audit + tagging |
| `lib/accounting/approveAndCreateJournal.ts:89,221` | reconciliation-specific wrapper | Approval alur bank reconciliation, panggil `postEntry()` |
| `lib/accountingPostingGuard.ts` | Guard pre-condition (VOID/REVERSAL/REPAYMENT) | TIDAK insert sendiri — hanya validasi sebelum caller memutuskan aksi |

### 2b. Module-level service layer yang SUDAH disiplin (memanggil `postEntry`, tidak bypass)

| Modul | File | Catatan |
|---|---|---|
| Advance/Kasbon | `lib/advance/AdvanceJournalService.ts` | Komentar eksplisit: *"No route or other service should call postEntry() directly for advance transactions."* |
| Payroll | `lib/payroll/PayrollJournalService.ts` | Komentar eksplisit: *"routes/payroll.ts must NOT call postEntry() directly — always go through..."* |
| Fleet | `lib/fleetAccounting.ts:54,103` | Memanggil `postEntry()` |
| Journal mapping generik | `lib/journalMappingService.ts` (8 titik) | Memanggil `postEntry()` |
| Bank mutation script | `scripts/run-bank-mutation-post.ts` | Memanggil `postEntry()` |

### 2c. 🔴 JALUR BYPASS — INSERT langsung, TIDAK lewat `postEntry()`

Ini adalah temuan P0 asli, terkonfirmasi dengan baris kode:

**1. `routes/advances.ts` (~baris 2098–2124)**
```ts
const newEntry = await db.execute(sql`
  INSERT INTO accounting_entries (
    company_id, entry_number, journal_id, date, ref, description,
    status, source, total_debit, total_credit, system_override
  ) VALUES (..., 'posted', 'manual', ..., true)
  RETURNING id
`);
```
- Konteks: route "koreksi COA" (reklasifikasi kasbon salah akun) — sengaja insert
  entry ber-status `'posted'` langsung, bypass idempotency check, bypass
  period-lock check yang ada di `_postEntryCore` (meski trigger DB tetap jalan,
  lihat §3).
- `system_override: true` menunjukkan ini didesain sebagai "jalur darurat", tapi
  tidak ada guard yang membatasi siapa yang bisa memanggilnya berulang kali.

**2. `lib/reconciliation/unifiedMatchingEngine.ts` (~baris 456–494)**
```ts
const { rows: inserted } = await db.execute(sql.raw(`
  INSERT INTO accounting_entries
    (entry_number, journal_id, date, ref, description,
     status, source, total_debit, total_credit, company_id)
  VALUES
    ('${entryNum}', ${journalId}, '${txDate}', '${refSafe}', '${descSafe}',
     'draft', 'bank_reconciliation', ...)
  RETURNING id
`));
```
- **Temuan tambahan (baru, di luar 8 poin awal):** ini memakai `sql.raw()` dengan
  **string interpolation langsung**, bukan parameter binding. `descSafe`/`refSafe`
  di-escape manual (`.replace(/'/g, "''")`), tapi `journalId`, `txDate`, `amount`
  tidak divalidasi tipe sebelum diselipkan ke string SQL. Ini adalah **potensi SQL
  injection / query corruption** jika salah satu nilai berasal dari input yang
  tidak terjamin numerik/tanggal. Saya usulkan ini jadi **P0 tambahan** (Security).
- Secara arsitektur: insert ini sengaja dipisah dari transaksi approval utama
  (komentar di kode: *"Dipisah dari Phase 1 agar kegagalan journal creation tidak
  rollback approval"*) — artinya approval reconciliation bisa sukses sementara
  jurnal gagal dibuat, dan sebaliknya. Tidak ada compensating mechanism selain
  `logger.warn` (silent failure, sesuai Tahap 8 di permintaan Anda).

**3. `lib/ingestModulePayment.ts` (~baris 278–322)**
```ts
const entryRes = await db.execute(sql`
  INSERT INTO accounting_entries
    (company_id, entry_number, journal_id, date, ref, description,
     status, source, source_id, total_debit, total_credit, created_by_id, created_at)
  VALUES (..., 'posted', ${sourceLabel(moduleType)}, ${sourceDocId}, ...)
  RETURNING id
`);
```
- Ini parameterized (aman dari injection), tapi tetap bypass `_postEntryCore`:
  idempotency check-nya di-reimplementasi manual (cek `ref` yang sama), tapi
  TIDAK melakukan multi-currency balance validation, TIDAK melalui governance
  bypass detection, dan TIDAK auto-lock immutability setelah posting (yang
  dilakukan `postEntry()` via `lockAccountingEntry()`).

## 3. Proteksi Database yang SUDAH Ada (independen dari bypass di atas)

`lib/accounting/ledgerGuard.ts` sudah punya trigger `ae_period_lock_insert_guard`
(BEFORE INSERT pada `accounting_entries`) yang menolak insert ke periode closed
**terlepas dari jalur mana pun** (raw SQL atau ORM) — ini adalah pertahanan lini
terakhir yang berfungsi untuk ketiga bypass di atas. **Namun** trigger ini hanya
menjaga satu invarian (period lock); validasi lain (idempotency, balance,
governance, immutability lock) murni logic aplikasi di `_postEntryCore` /
`postEntry()`, sehingga bypass tetap kehilangan proteksi tersebut.

## 4. Peta Posting Pajak — `transaction_taxes` & `gl_tax_lines`

| Tabel | Ditulis oleh | Trigger dari |
|---|---|---|
| `transaction_taxes` | `lib/taxAutoService.ts` → `recordTransactionTax()`, `captureManualJournalTax()` (Drizzle `.insert(transactionTaxesTable)`) | Dipanggil manual (bukan otomatis) dari: `routes/sales.ts:1046`, `routes/purchase.ts:733`, `routes/expenses.ts:399,506`, `routes/bankDisbursements.ts:1239,1725`, `routes/logisticOrders.ts:1963`, `routes/accounting.ts`, `modules/sport-center/routes.ts` (5 titik) |
| `transaction_taxes` | `lib/taxLedgerSyncService.ts:182` (raw SQL INSERT) | Sync job dari `tax_transactions` (event ledger) |
| `gl_tax_lines` | `lib/taxEngineCore.ts:89` (raw SQL INSERT) | Dipanggil dari alur GL tax posting (perlu ditelusuri lebih lanjut caller-nya di Tahap 2) |

**Temuan kunci (mengonfirmasi P1.4 di dokumen Anda):**
`postSalesInvoice()` dan `postEcommerceOrder()` di `lib/accounting.ts` HANYA
memanggil `postEntry()` untuk jurnal (baris PPN dimasukkan sebagai salah satu
`PostingLine` di jurnal itu sendiri) — **tidak ada panggilan ke
`recordTransactionTax()`/`transactionTaxesTable` di dalam fungsi-fungsi tersebut**.
Pencatatan `transaction_taxes` dilakukan **terpisah**, oleh route handler
(`routes/sales.ts`, dst.) yang memanggil `recordTransactionTax()` **setelah**
`postSalesInvoice()`/dst selesai — dua panggilan async berbeda, **tidak dalam
`db.transaction()` yang sama**. Ini mengonfirmasi gap atomicity: jurnal bisa
posted sukses, lalu proses lanjut gagal sebelum `recordTransactionTax()`
dipanggil (crash, network, dsb) → `transaction_taxes` tidak pernah tercatat,
tanpa rollback jurnal.

## 5. Perbedaan Perilaku PPN (konfirmasi P2.8)

| Fungsi | Saat akun PPN kosong & taxAmt > 0 |
|---|---|
| `postSalesInvoice()` (baris ~982) | Pakai `args.taxAccountId` jika ada; jika tidak, jurnal berpotensi tidak menyertakan baris PPN sama sekali → **jurnal bisa tidak balance secara diam-diam** (tergantung apakah `taxAmt` sudah termasuk di `grandTotal` line AR) |
| `postEcommerceOrder()` (baris 1553) | `logger.warn(...)` lalu **`return` — seluruh posting order dibatalkan diam-diam**, tidak ada jurnal sama sekali, tidak ada exception ke caller |

Dua kegagalan berbeda: satu menghasilkan jurnal yang berpotensi tidak balance,
satu skip total tanpa memberi tahu caller. Keduanya silent (hanya `logger.warn`).

## 6. Race Condition Bank Disbursement (konfirmasi P1.5)

`routes/bankDisbursements.ts`:
- baris ~1160, ~1615: panggil `postEntry(...)`
- baris ~1680: `updateSourceAfterDisbursement(...)` — update status disbursement
- Ada komentar TODO eksplisit di kode itu sendiri (baris ~1674):
  `// P1: wrap this + postEntry + INSERT in a single db.transaction()`
- Jadi tim sebelumnya **sudah menyadari** gap ini tapi belum menutupnya.

## 7. Dependency Graph (ringkas)

```
Route Handlers (sales.ts, purchase.ts, expenses.ts, bankDisbursements.ts, ...)
        │
        ├─→ postSalesInvoice() / postEcommerceOrder() / postSalesCogs() ──┐
        │        (lib/accounting.ts)                                     │
        │                                                                 ▼
        ├─→ AdvanceJournalService / PayrollJournalService / fleetAccounting ──→ postEntry()
        │        (module service layer — DISIPLIN)                            (lib/accounting.ts)
        │                                                                       │
        ├─→ ledgerGuard.createJournal() ────────────────────────────────────────┤
        │        (generic canonical wrapper)                                    │
        │                                                                       ▼
        │                                                              _postEntryCore()
        │                                                          (idempotency, period-lock,
        │                                                           balance validation, insert)
        │                                                                       │
        │                                                                       ▼
        │                                                          DB Trigger: ae_period_lock_insert_guard
        │                                                          (BEFORE INSERT — defense in depth)
        │
        ├─→ recordTransactionTax() ──────────────────────→ transaction_taxes
        │        (lib/taxAutoService.ts — DIPANGGIL TERPISAH, tidak 1 tx dgn di atas)
        │
        └─→ 🔴 BYPASS raw SQL INSERT INTO accounting_entries:
                - routes/advances.ts (koreksi COA)
                - lib/reconciliation/unifiedMatchingEngine.ts (Phase 2, sql.raw — SQL injection risk)
                - lib/ingestModulePayment.ts (parameterized, tapi skip semua validasi _postEntryCore)
```

## 8. Temuan Tambahan (di luar 8 poin asli — dilaporkan sesuai instruksi Anda)

| # | Temuan | Prioritas usulan | Alasan |
|---|---|---|---|
| A | `unifiedMatchingEngine.ts` memakai `sql.raw()` dengan string interpolation untuk `journalId`, `txDate`, `amount` tanpa type-check sebelum masuk ke SQL string | **P0 (Security)** | Potensi SQL injection / query corruption jika nilai bukan angka/tanggal valid |
| B | Trigger `ae_immutability_fn` tidak melindungi `ledger_source_type` dan `checksum_hash` (sesuai temuan sebelumnya) — dikonfirmasi ulang di sini karena relevan untuk Tahap 4 | P2 (sudah tercatat) | — |
| C | `postEcommerceOrder()` silent-return saat PPN gagal berarti **tidak ada jurnal AR/Sales sama sekali** untuk order tersebut — order tetap "delivered" di modul e-commerce tapi tidak pernah masuk GL. Ini bug data-integrity, bukan hanya inconsistency kecil. | P1 (upgrade dari P2) | Order senilai besar bisa hilang dari laporan keuangan tanpa jejak error yang terlihat user |

## 9. Kesimpulan Tahap 1

Dependency map ini mengonfirmasi seluruh 8 temuan di dokumen Anda dengan bukti
baris kode, ditambah 3 temuan baru (§8). Siap lanjut ke **Tahap 2: Desain
Canonical Posting Engine**.
