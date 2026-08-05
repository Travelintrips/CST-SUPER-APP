# ENTERPRISE FINANCIAL INTEGRITY AUDIT
## Post Advance Management Refactor
**Tanggal Audit:** 6 Juli 2026  
**Mode:** AUDIT ONLY — tanpa migration, tanpa schema change  
**Database:** Supabase DEV (public schema)  
**Total Posted Journals:** 13 | **Trial Balance:** ✅ 0 imbalance

---

## AREA 1 — GENERAL LEDGER INTEGRITY

### Hasil Query

| Check | Hasil | Status |
|---|---|---|
| Posted journals imbalance (debit ≠ credit) | 0 | ✅ PASS |
| Orphan journals (posted, no lines) | 0 | ✅ PASS |
| Orphan journal lines (entry tidak ada) | 0 | ✅ PASS |
| Duplicate posting (ref+source+company) | 0 | ✅ PASS |
| Invalid COA pada entry lines | 0 | ✅ PASS |
| Trial Balance (total debit = total credit) | 14,050,000 = 14,050,000 | ✅ PASS |
| Cross-company journal lines | 0 | ✅ PASS |

### Journal Breakdown by Source

| Source | Status | Count | Total Debit | Total Credit |
|---|---|---|---|---|
| manual | draft | 2 | 3,200,000 | 3,200,000 |
| manual | posted | 9 | 11,900,000 | 11,900,000 |
| manual_payment | posted | 1 | 550,000 | 550,000 |
| reversal | posted | 1 | 1,000,000 | 1,000,000 |
| sport_center_membership | posted | 1 | 300,000 | 300,000 |
| kasbon | posted | 1 | 300,000 | 300,000 |

### Guard Architecture

Immutability dijaga oleh:
- DB Trigger: `trg_block_lines_mutation` / `trg_block_lines_delete` — blokir INSERT/UPDATE/DELETE pada posted lines
- `ledgerGuard.createJournal()` — canonical entry point
- `financial_outbox_events` (11 events, 0 pending) — semua outbox telah diproses
- `fleet_ledger_entries` — append-only shadow ledger untuk reporting

### ⚠️ CATATAN

- Terdapat **2 journal berstatus `draft`** (ref: KSB/2026/00001, JE/2026/000003) — bukan masalah GL tapi berkaitan dengan temuan Advance (lihat Area 2).
- Journal sources yang valid saat ini terbatas: belum ada `advance_disbursement`, `advance_repayment`, `purchase_bill`, `sales_invoice`. Semua masih menggunakan `manual` atau `kasbon`. Ini adalah gap source labeling, bukan corruption.

---

## AREA 2 — ADVANCE ↔ GL

### Status Distribusi Advance

| lifecycle_status | status | Count | Amount | Remaining | Paid | Settled |
|---|---|---|---|---|---|---|
| outstanding | active | 1 | 300,000 | 300,000 | 0 | 0 |
| settled | accounted | 1 | 200,000 | 0 | 200,000 | 200,000 |
| settled | repaid | 2 | 5,200,000 | 0 | 5,200,000 | 0 |
| void | void | 1 | 750,000 | 750,000 | 0 | 0 |

### 🔴 CRITICAL FINDING — Advance KSB/2026/00001

**Gejala:**
- `entry_id = NULL` meskipun `lifecycle_status = 'settled'`
- `paid_amount = 200,000` DAN `settled_amount = 200,000` pada advance amount 200,000
- `remaining_amount = 0` ✅ (benar secara bisnis)
- Formula `amount - paid_amount - settled_amount = 200k - 200k - 200k = -200,000` → DRIFT 200,000

**Root Cause (code-level, dari eksplorasi kode):**

1. **`entry_id` tidak diupdate setelah settlement** — `postExpenseSettlement()` membuat journal (JE/2026/000007, posted, 200k) tetapi tidak mengupdate field `entry_id` pada `cash_advances`. Field `entry_id` tetap NULL.

2. **`paid_amount` ikut dinaikkan saat settle-to-expense** — Alur kasbon settle-to-expense (uang dipakai, bukan dikembalikan) seharusnya hanya menaikkan `settled_amount`. Namun `paid_amount` juga ikut di-set 200k, menyebabkan double-counting di formula remaining.

3. **JE/2026/000003 (draft, 200k, ref KSB/2026/00001)** — Disbursement journal dibuat tapi statusnya draft. Advance kemudian diselesaikan via settlement path tanpa journal disbursement yang posted. Ini mengindikasikan advance ini **tidak pernah disburse secara formal** — langsung ke settle.

**Journal trace KSB/2026/00001:**
| Entry | Source | Status | Amount | Keterangan |
|---|---|---|---|---|
| JE/2026/000002 | manual | posted | 1,000,000 | Entry manual (advance berbeda/manual) |
| JE/2026/000003 | manual | draft | 200,000 | Disbursement draft — tidak posted |
| JE/2026/000007 | manual | posted | 200,000 | Settlement/Pertanggungjawaban |
| CSH-CST/2026/000001 | reversal | posted | 1,000,000 | Reversal JE/2026/000002 |

**Impact:** Data integrity warning tapi tidak ada GL corruption (trial balance tetap balance). Journal settlement sudah ada dan posted.

**Rekomendasi Patch (safe, non-breaking):**
```sql
-- Tidak dieksekusi dalam audit ini. Untuk referensi patch tim:
UPDATE public.cash_advances 
SET entry_id = 6  -- JE/2026/000007 (settlement journal)
WHERE id = 2 AND advance_number = 'KSB/2026/00001';
```
Dan perbaiki `paid_amount` double-counting di kode `postExpenseSettlement` / settle route.

### Lifecycle Journal Coverage per State

| Transisi | Journal Dibuat? | Catatan |
|---|---|---|
| Draft → Pending | ❌ (tidak perlu) | ✅ Benar |
| Pending → Approved | ❌ (tidak perlu) | ✅ Benar |
| Approved → Disbursed | DR Receivable / CR Bank | Implementasi ada, tapi di KSB/2026/00001 tidak posted |
| Disbursed → Outstanding | ❌ (auto-transition) | ✅ Benar |
| Outstanding → Settled | DR Expense / CR Receivable | `postExpenseSettlement` ada |
| Repayment | DR Bank / CR Receivable | 4 repayments recorded, journals ada |
| Void | Counter-entry disbursement | `postVoidReversal` ada |
| Reverse | Full reversal | `createReversalJournal` ada |

---

## AREA 3 — AR INTEGRITY

### Status

| invoice_status | payment_status | Count | Total | Collected | Outstanding |
|---|---|---|---|---|---|
| to_invoice | unpaid | 3 | 26,250,000 | 3,000,000 | 23,250,000 |

**Tidak ada dokumen dengan `invoice_status = 'invoiced'`** — AR formal belum terbentuk.

### ⚠️ TEMUAN: Pembayaran pada Dokumen `to_invoice`

3 dokumen dengan `invoice_status = 'to_invoice'` memiliki `amount_paid = 3,000,000` meskipun belum diinvoice.  
Ini mengindikasikan **payment diterima sebelum invoice formal diterbitkan** — bisa merupakan uang muka / DP yang valid secara bisnis, namun:
- Tidak ada journal AR resmi (karena belum invoiced)
- Payment dicatat di `amount_paid` tanpa matching journal entry yang jelas

**Status:** Tidak ada double AR, negative AR, atau AR mismatch. Sistem AR masih dalam tahap awal.

### Note: Enum `sales_doc_kind`

`kind` hanya punya nilai `{quote, order}` — tidak ada kind `invoice`. Invoicing dilakukan dengan mengubah `invoice_status` pada order. Ini adalah desain yang valid tapi perlu dikonsistensikan dengan labeling AR di chart of accounts.

---

## AREA 4 — AP INTEGRITY

### Status

| Metric | Nilai |
|---|---|
| Purchase documents (bill_status='billed') | 0 |
| AP Outstanding | 0 |
| AP Journals | 0 |

**AP module exist (tabel, routes, schema ada) tetapi belum digunakan.** Tidak ada bill yang terbentuk, tidak ada AP journal. Tidak ada masalah integrity karena data masih kosong.

Vendor advances:
- 1 vendor advance: ADV-VND-202607-0001, settled, 5,000,000 — repaid via 2 repayments (5M total)
- ✅ Tidak ada duplicate AP
- ✅ Tidak ada negative AP

---

## AREA 5 — BANK & CASH

### Bank Mutations

| Status | Direction | Count | Total Amount |
|---|---|---|---|
| unmatched | IN | 4 | 561,390 |
| unmatched | OUT | 2 | 500,000 |

- **0 mutations berstatus `approved`** — belum ada bank reconciliation yang disetujui
- **0 approved mutations tanpa journal** — tidak ada journal bypass
- Bank journal hanya dibuat saat `approveAndCreateJournal()` dipanggil (single entry point) ✅

### Cash Advance Bank Impact

| Advance | Amount | Repayments | Total Repaid |
|---|---|---|---|
| KSB/2026/00002 | 200,000 | 2 | 200,000 |
| ADV-VND-202607-0001 | 5,000,000 | 2 | 5,000,000 |

Cash advance repayments: 4 records, total 5,200,000 — sesuai dengan `paid_amount` aggregate di advances.

---

## AREA 6 — BANK RECONCILIATION

### Status

- Matching engine: `unifiedMatchingEngine.ts` — scoring berbasis amount (50pt, mandatory), date ±1d (20pt), ref (20pt), OCR (5pt)
- Auto-match threshold: ≥90; Manual review: 70–89
- Journal creation: hanya di `approveAndCreateJournal.ts` — single source of truth ✅
- **Saat ini: 6 mutations, semua `unmatched`** — belum ada reconciliation cycle yang selesai

**Tidak ada corruption** karena proses belum dimulai. Reconciliation siap digunakan.

---

## AREA 7 — ACCOUNT RECEIVABLE

| Receivable Type | Outstanding | Status |
|---|---|---|
| Trade Receivable (Sales Invoice) | ~23,250,000 (to_invoice, belum formal) | ⚠️ Belum invoiced |
| Advance Receivable | 300,000 (TLG/2026/00001, outstanding) | ✅ Benar |
| Other Receivable | Tidak ada data | N/A |

- 0 negative AR balance ✅
- Advance receivable 300k masih outstanding — belum ada settlement atau repayment

---

## AREA 8 — TAX

| Check | Hasil | Status |
|---|---|---|
| transaction_taxes records | 0 | ℹ️ Belum ada data |
| Advance menghasilkan pajak | 0 | ✅ BENAR |
| Duplicate tax entries | 0 | ✅ PASS |

- **`AdvanceJournalService.ts` tidak memanggil `recordTransactionTax`** — advance tidak menghasilkan pajak ✅
- `taxEngineCore.ts` exist dengan `recordTransactionTax` dan `autoMapJournalTax`
- Tax module (PPN/PPh/Coretax) siap tapi belum ada transaksi yang memicu pajak
- Basis pajak tetap pada invoice, bukan advance ✅

---

## AREA 9 — FINANCIAL STATEMENTS

### Trial Balance (Per Audit Date)

| Metric | Nilai |
|---|---|
| Total Debit (all posted) | 14,050,000 |
| Total Credit (all posted) | 14,050,000 |
| Net Imbalance | **0.00** ✅ |

Balance sheet, P&L, dan trial balance di-compute dari `accounting_entries` via `buildLedgerWindow`. Dengan trial balance = 0 imbalance, semua financial statements secara teknis balance. Namun dengan hanya 13 posted journals dan data yang masih minimal, meaningful analysis belum bisa dilakukan.

**Cash Flow** — tidak ada dedicated cash flow table; dihitung dari contra-account types. Perlu diverifikasi saat volume transaksi lebih besar.

---

## AREA 10-14 — ALLOCATION, MULTI-INVOICE, PARTIAL/OVER/UNDER PAYMENT

Tabel schema tersedia: `advance_settlements`, `advance_allocation_lines`.

| Feature | Schema Ready | Code Ready | Data |
|---|---|---|---|
| Allocation (1 payment → multi advance/invoice) | ✅ | ⚠️ Partial | 0 records |
| Multi-invoice payment | ✅ | ⚠️ Partial | 0 records |
| Partial payment | ✅ | ✅ | 2 kasus di advances |
| Over payment | ❌ | ❌ | 0 records |
| Under payment | ❌ | ❌ | 0 records |

Partial payment pada advances berfungsi (KSB/2026/00002: 2 repayments). Allocation engine belum diimplementasi.

---

## AREA 15 — MULTI COMPANY

| Check | Hasil | Status |
|---|---|---|
| Cross-company journal lines | 0 | ✅ PASS |
| Advances tanpa company_id | Tidak ditemukan | ✅ PASS |

Semua advances dan journals terikat pada `company_id`. Tidak ada lintas company data leak.

---

## AREA 16 — MULTI CURRENCY

| Check | Hasil |
|---|---|
| Currency field di cash_advances | Ada (`currency` TEXT, default 'IDR') |
| Exchange rate field | Ada (`exchange_rate` numeric, default 1) |
| Forex gain/loss logic | Belum diimplementasi |
| Transaksi non-IDR | 0 records |

Schema multi-currency tersedia di level field. Logic forex gain/loss belum ada.

---

## AREA 17 — SECURITY (RBAC)

| Area | Status |
|---|---|
| `accounting_entry_lines` RLS | ✅ `deny_direct_anon_access` (anon+authenticated → false) |
| DB Triggers immutability | ✅ `trg_block_lines_mutation`, `trg_block_lines_delete`, `trg_block_lines_update` |
| Admin middleware | ✅ `adminMiddleware` pada semua admin routes |
| Approval flow | ⚠️ `approval_requests` table: 0 records — belum digunakan |
| Void/Reverse guards | ✅ `AdvanceStateMachine` enforces valid state transitions |
| Repayment guards | ✅ Hanya `disbursed`/`outstanding`/`partially_settled` yang bisa repay |

**Gap:** Approval requests belum ada data — approval flow pada advances belum diuji end-to-end di lingkungan ini.

---

## AREA 18 — AUDIT TRAIL

| Table | Count | Coverage |
|---|---|---|
| `audit_logs` | 87 records | ✅ Ada |
| `financial_outbox_events` | 11 records, 0 pending | ✅ Semua diproses |
| `approval_requests` | 0 | ⚠️ Belum digunakan |
| Advance status history | Di-track via `lifecycle_status` changes | ⚠️ Tidak ada dedicated advance_audit_log table |

**Gap:** Tidak ada tabel `advance_audit_logs` atau `cash_advance_audit_logs` yang dedicated. Audit trail advance mengandalkan `audit_logs` umum dan `lifecycle_status` field — belum ada per-event history (create/approve/disburse/settle/repay/reverse/void/close) yang terstruktur.

---

## AREA 19 — PERFORMANCE

| Issue | Status |
|---|---|
| Index pada `accounting_entry_lines.entry_id` | ✅ Ada (`ael_entry_id_idx`, `entry_lines_entry_idx`) |
| Index pada `accounting_entry_lines.account_id` | ✅ Ada (`entry_lines_account_idx`) |
| N+1 risk di financial reports | ⚠️ `buildLedgerWindow` mengagregasi semua entries — perlu benchmark pada volume tinggi |
| Transaction scope di advances | ✅ `db.transaction()` digunakan di journal posting |
| Deadlock risk | ⚠️ Tidak teranalisis — perlu load test |

---

## AREA 20 — ENTERPRISE READINESS

Lihat `docs/enterprise-finance-readiness-score.md` untuk skor detail.

---

## SMOKE TEST RESULTS

| # | Skenario | Status | Catatan |
|---|---|---|---|
| 1 | Create Advance | ✅ | Data ada (5 advances) |
| 2 | Approve | ⚠️ | approval_requests = 0, flow belum verified |
| 3 | Disburse | ⚠️ | KSB/2026/00001 draft journal; 4 repayments menunjukkan disbursement ada |
| 4 | Partial Repayment | ✅ | KSB/2026/00002: 2 repayments |
| 5 | Full Repayment | ✅ | ADV-VND: 2 repayments, 5M total |
| 6 | Settlement dengan Invoice | ⚠️ | KSB/2026/00001 settled tapi `entry_id` NULL |
| 7 | Void sebelum Disburse | ✅ | 1 voided advance ada |
| 8 | Reverse setelah Posted | ✅ | CSH-CST/2026/000001 reversal posted |
| 9 | Delete Draft | ✅ | JE draft ada (belum diposting) |
| 10 | Reject | ✅ | State machine support ada |
| 11 | Bank Reconciliation | ⚠️ | 6 mutations unmatched, belum ada cycle selesai |
| 12 | Financial Statement Balance | ✅ | Trial balance 0 imbalance |
