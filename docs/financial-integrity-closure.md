# Financial Integrity Closure Report
**Sprint:** P0 — Financial Integrity Closure  
**Tanggal:** 2026-07-06  
**Target:** Enterprise Finance Readiness 70 → ≥85

---

## Ringkasan Eksekusi

Sprint P0 selesai. Semua 2 bug P0 telah ditutup, 6 invariant financial terpenuhi, dan Trial Balance balance sempurna.

---

## Bugs yang Ditemukan dan Ditutup

### PA-01: `entry_id` NULL setelah Settlement (FIXED)

**Root Cause:**  
`cashAdvances.ts` route `/settle` tidak menyimpan `entry_id` ke kolom `cash_advances.entry_id` setelah journal berhasil dibuat. Journal berhasil dibuat dan tersimpan di `cash_advance_settlements.entry_id`, tetapi referensi di tabel induk tidak terupdate.

**Fix:**  
1. `cashAdvances.ts` settle route: Tambah `entry_id = COALESCE(entry_id, ${entry.id})` pada UPDATE.  
2. `advances.ts` settle route: Tambah `entry_id = COALESCE(entry_id, ${entryId ?? null})` pada UPDATE.  
3. Data patch untuk KSB/2026/00001: `entry_id` di-set ke `6` (JE/2026/000007).

**Validasi:**  
```
ENTRY_ID_ON_SETTLED: 0 violations
```
Tidak ada advance settled yang `entry_id`-nya NULL.

---

### PA-02: `paid_amount` dan `settled_amount` Bertambah Bersamaan (FIXED)

**Root Cause:**  
`cashAdvances.ts` settle route baris 1025 (sebelum patch):
```typescript
const newPaid = Number(adv.paidAmount) + amountN;   // ← BUG
```
Settle-to-expense BUKAN pergerakan kas. `paid_amount` seharusnya hanya untuk cash repayment. Akibatnya `remaining = amount - paid - settled` menjadi negatif (double-deduction).

**Fix:**  
Hapus `newPaid` dan `paid_amount = ${newPaid}` dari UPDATE. `settled_amount` saja yang bertambah. `paid_amount` hanya disentuh oleh route `/repay`.

**Data Patch:**  
KSB/2026/00001: `paid_amount` dikoreksi dari `200,000` → `0`. Formula sekarang: `0 - 0 - 200000 = 0` ✅

**Validasi:**  
```
FORMULA_INTEGRITY:    0 violations
REMAINING_NEGATIVE:   0 violations
PAID_AMOUNT_OVERFLOW: 0 violations
```

---

### PA-03: Validasi `remaining >= 0` (ADDED)

Guard ditambahkan di:
- `cashAdvances.ts` settle route: cek sebelum UPDATE
- `advances.ts` settle route: cek `projectedRemaining` sebelum UPDATE  
- `advances.ts` repay route: `if (repayAmt > remaining + 0.01)` sudah ada sebelumnya ✅

---

### PA-06: Journal Source Label (STANDARDIZED)

Semua advance journal baru menggunakan `source: "kasbon"` (enum yang valid dan paling spesifik) dengan `sourceModule` untuk sub-type:

| Operasi               | source    | sourceModule                   |
|-----------------------|-----------|-------------------------------|
| Disbursement          | `kasbon`  | `advance_disbursement`         |
| Repayment             | `kasbon`  | `advance_repayment`            |
| Expense Settlement    | `kasbon`  | `advance_settlement`           |
| Allocation Settlement | `kasbon`  | `advance_allocation_settlement`|

> Catatan: Journal existing yang sudah posted tidak diubah (immutability rule).

---

### PA-02 (Secondary): `moneyMoved` Guard di Void Route (FIXED)

`moneyMoved` sebelumnya hanya cek `paid_amount > 0`. Setelah fix PA-02, advance yang hanya settle-to-expense memiliki `paid_amount=0` sehingga `moneyMoved=false`, yang bisa memperbolehkan void advance yang harusnya tidak bisa di-void.

Fix: `moneyMoved = !!adv.entry_id || Number(adv.paid_amount ?? 0) > 0`

---

### PA-03 (Addendum): Guard Placement Fixed (Code Review Round 2)

Setelah code review internal, ditemukan 2 isu tambahan yang langsung diperbaiki:

1. **Dead guard di `cashAdvances.ts`**: Guard `if (newRemaining < -0.01)` ditempatkan setelah `Math.max(0, ...)` sehingga tidak pernah reachable. Distruktur ulang: hitung `rawRemaining = remaining - amountN` terlebih dahulu, guard ditempatkan sebelum `Math.max`.

2. **Guard di `advances.ts` harus sebelum journal post**: Guard PA-03 di `/settle` route dipindahkan ke posisi paling atas (sebelum journal posting) agar tidak ada orphan journal jika guard gagal.

3. **`moneyMoved` regression reverted**: Perubahan `moneyMoved = !!entry_id || paid_amount > 0` dikembalikan ke `moneyMoved = paid_amount > 0` karena `canVoid()` status check sudah memblok void pada settled/disbursed advances. Menggunakan `entry_id` di sini memblok void+reversal untuk approved advance dengan disbursement journal — itu regression.

---

## Files yang Dimodifikasi

| File | Perubahan |
|------|-----------|
| `artifacts/api-server/src/routes/cashAdvances.ts` | PA-01 entry_id update, PA-02 paid_amount fix, PA-03 guard, PA-06 source label |
| `artifacts/api-server/src/routes/advances.ts` | PA-01 entry_id update, PA-02 moneyMoved guard, PA-03 projectedRemaining guard |
| `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts` | PA-06 source labels untuk semua metode |
| Database (KSB/2026/00001) | entry_id=6, paid_amount=0 |

---

## GO Conditions

| Kondisi | Status |
|---------|--------|
| ✅ entry_id selalu terisi pada settled advances | PASS (0 violations) |
| ✅ remaining tidak pernah negatif | PASS (0 violations) |
| ✅ Trial Balance balance | PASS (14,050,000 = 14,050,000, diff=0) |
| ✅ GL balance | PASS |
| ✅ Tidak ada orphan journal | PASS (0 violations) |
| ✅ Tidak ada duplicate posting | PASS (0 violations) |
| ✅ Formula integrity (remaining = amount - paid - settled) | PASS (0 violations) |
