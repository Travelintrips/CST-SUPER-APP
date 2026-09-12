# ENTERPRISE FINANCE GAP ANALYSIS
**Post Advance Management Refactor**  
**Tanggal:** 6 Juli 2026

---

## GAP 1 — 🔴 CRITICAL: `entry_id` Tidak Di-set Setelah Settlement (KSB/2026/00001)

**Modul:** Advance Management — `postExpenseSettlement()`  
**File:** `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts`  
**File:** `artifacts/api-server/src/routes/advances.ts`

**Deskripsi:**  
Setelah `postExpenseSettlement()` membuat journal entry, `entry_id` pada tabel `cash_advances` tidak diupdate. Akibatnya advance dengan `lifecycle_status = 'settled'` memiliki `entry_id = NULL`, memutus link antara advance dan journal-nya.

**Impact:**
- Advance tidak bisa di-trace ke journal via `entry_id`
- Audit trail advance → journal terputus
- Reporting yang bergantung `entry_id` akan melewati advance ini

**Fix yang diperlukan:**
```typescript
// Di routes/advances.ts setelah postExpenseSettlement():
await db.update(cashAdvances)
  .set({ entry_id: journalResult.entryId })
  .where(eq(cashAdvances.id, advanceId));
```

---

## GAP 2 — 🔴 CRITICAL: `paid_amount` Double-Count pada Settle-to-Expense

**Modul:** Advance Management — Kasbon Settle Flow  
**File:** `artifacts/api-server/src/routes/advances.ts`

**Deskripsi:**  
Saat settle-to-expense (uang dipakai, bukan dikembalikan), kode menaikkan `paid_amount` DAN `settled_amount`. Seharusnya `paid_amount` hanya untuk cash repayments (uang kembali ke perusahaan), bukan expense reclassification.

**Bukti Data (KSB/2026/00001):**
```
amount:          200,000
paid_amount:     200,000  ← seharusnya 0 (bukan cash repayment)
settled_amount:  200,000  ← benar (expense settlement)
remaining_amount:      0  ← benar secara bisnis
formula:   200k - 200k - 200k = -200,000  ← DRIFT
```

**Impact:**
- Formula `remaining_amount = amount - paid_amount - settled_amount` menghasilkan nilai negatif
- Cash flow report bisa mis-report double-exit kas
- Laporan outstanding advance tidak akurat untuk settled-via-expense

**Fix yang diperlukan:**  
Pisahkan increment: settle-to-expense hanya update `settled_amount`. `paid_amount` hanya diupdate di repayment path.

---

## GAP 3 — 🟡 MEDIUM: Draft Disbursement Journal Tidak Diposting (JE/2026/000003)

**Modul:** Advance Disbursement  
**Data:** JE/2026/000003, manual, draft, 200,000, ref: KSB/2026/00001

**Deskripsi:**  
Terdapat 1 journal dalam status `draft` dengan ref yang sama dengan advance KSB/2026/00001. Journal ini tidak pernah diposting. Advance kemudian diselesaikan via settlement path tanpa journal disbursement yang posted. Ini menunjukkan advance diselesaikan tanpa fase disbursement formal.

**Impact:**  
Minor — advance sudah settled dengan benar secara bisnis. Tapi draft journal menggantung tanpa action.

**Fix:** Void atau hapus JE/2026/000003 yang draft, pastikan flow disbursement → settlement selalu melalui journal yang posted.

---

## GAP 4 — 🟡 MEDIUM: Tidak Ada `advance_audit_logs` Table

**Modul:** Audit Trail  
**File:** `lib/db/src/schema/`

**Deskripsi:**  
Tidak ada tabel dedicated untuk audit history per-event pada advance lifecycle. `audit_logs` umum ada (87 records) tapi tidak ada `cash_advance_audit_logs` atau `advance_status_history` yang menyimpan setiap transisi status beserta user, timestamp, dan snapshot data.

**Impact:**
- Tidak bisa audit "siapa yang approve/void/settle advance X pada waktu Y"
- Compliance dan forensik investigation terbatas
- Enterprise ERP standar memerlukan immutable audit trail per dokumen

**Fix:** Tambah tabel `cash_advance_audit_logs` dengan kolom: `advance_id`, `action`, `from_status`, `to_status`, `actor_id`, `actor_name`, `timestamp`, `payload_snapshot` (jsonb). Isi di setiap state transition.

---

## GAP 5 — 🟡 MEDIUM: Payment Sebelum Invoice Formal (AR)

**Modul:** AR / Sales Documents  
**Data:** 3 dokumen `to_invoice` dengan `amount_paid = 3,000,000`

**Deskripsi:**  
Payment diterima dan dicatat pada dokumen yang belum diubah statusnya ke `invoiced`. Ini bisa merupakan DP (Down Payment) yang valid secara bisnis, tapi saat ini tidak ada mekanisme untuk membedakan:
- DP / advance payment (valid)
- Pembayaran sebelum invoice diterbitkan (error input)

**Impact:**
- Tidak ada journal AR resmi untuk 3M ini
- `amount_paid` pada `to_invoice` doc tidak dibackup journal yang clearly labeled
- Potensial mis-reporting di AR aging

**Fix:** Tambah field `payment_type` ('dp', 'full', 'partial') atau pisahkan DP ke tabel tersendiri dengan journal entry `DR Cash/Bank / CR Advance from Customer`.

---

## GAP 6 — 🟡 MEDIUM: Approval Flow Belum Diuji End-to-End

**Modul:** Approval  
**Data:** `approval_requests` count = 0

**Deskripsi:**  
`approval_requests` table ada tapi 0 records. Advance approval flow belum pernah digunakan di environment ini. Tidak bisa diverifikasi apakah:
- Approval journal benar dibuat
- State machine correctly rejects unauthorized transitions
- Notifikasi approval berfungsi

**Fix:** Lakukan smoke test approval flow dengan data nyata.

---

## GAP 7 — 🟢 LOW: Journal Source Labels Tidak Spesifik

**Modul:** GL / Accounting  
**Data:** Semua advance journals berlabel `manual` atau `kasbon`, bukan `advance_disbursement` / `advance_settlement` / `advance_repayment`

**Deskripsi:**  
Dengan `source='manual'` pada semua advance journals, tidak bisa membedakan journal mana yang berasal dari advance dibanding manual entry. Source enum seharusnya digunakan secara konsisten.

**Impact:** Reporting per-source tidak akurat. Filter `WHERE source='advance_disbursement'` tidak akan menemukan apa pun.

**Fix:** Pastikan `AdvanceJournalService` menggunakan enum source yang tepat saat memanggil `createJournal`. Tambah nilai enum jika perlu.

---

## GAP 8 — 🟢 LOW: Tax Module Belum Terintegrasi (0 Records)

**Modul:** Tax / `transaction_taxes`  
**Data:** 0 records

**Deskripsi:**  
Tax module (PPN/PPh) exist tapi tidak ada satu pun transaksi yang memicu tax entry. Ini normal untuk sistem baru, tapi perlu diverifikasi bahwa:
- `autoMapJournalTax` dipanggil saat invoice posting
- `recordTransactionTax` dipanggil dengan parameter benar
- Advance memang tidak memicu tax (sudah verified ✅)

---

## GAP 9 — 🟢 LOW: Bank Reconciliation Belum Selesai Satu Siklus

**Modul:** Bank Reconciliation  
**Data:** 6 mutations, semua `unmatched`

**Deskripsi:**  
Belum ada satu pun bank mutation yang di-approve dan menghasilkan journal. Matching engine sudah ada tapi belum dijalankan end-to-end.

---

## GAP 10 — 🟢 LOW: Over/Under Payment, Multi-Currency, Forex Gain/Loss Belum Ada

**Modul:** Advanced Payment Features  

| Feature | Schema | Code | Production Ready |
|---|---|---|---|
| Over payment | ❌ | ❌ | ❌ |
| Under payment | ❌ | ❌ | ❌ |
| Multi-currency | ⚠️ (field ada) | ❌ | ❌ |
| Forex gain/loss | ❌ | ❌ | ❌ |
| Allocation Engine | ⚠️ (partial) | ⚠️ (partial) | ❌ |

Ini adalah fitur yang belum diimplementasi, bukan bugs. Sudah tercatat sebagai roadmap.

---

## RINGKASAN GAP

| # | Severity | Gap | Action |
|---|---|---|---|
| 1 | 🔴 CRITICAL | `entry_id` NULL setelah settlement | Patch `advances.ts` settle route |
| 2 | 🔴 CRITICAL | `paid_amount` double-count di settle-to-expense | Fix increment logic |
| 3 | 🟡 MEDIUM | Draft disbursement journal menggantung | Void/cleanup JE draft |
| 4 | 🟡 MEDIUM | Tidak ada dedicated advance audit trail table | Schema + code addition |
| 5 | 🟡 MEDIUM | Payment sebelum invoice formal | DP handling clarification |
| 6 | 🟡 MEDIUM | Approval flow belum diuji | Smoke test |
| 7 | 🟢 LOW | Journal source labels tidak spesifik | Update JournalService |
| 8 | 🟢 LOW | Tax belum ada transaksi | Verify saat invoice live |
| 9 | 🟢 LOW | Bank recon belum satu siklus | Run reconciliation |
| 10 | 🟢 LOW | Over/under pay, multi-currency, forex belum ada | Roadmap |
