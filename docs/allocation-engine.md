# Allocation Engine — Advance Settlement

## Tujuan

Allocation Engine memungkinkan satu pembayaran (settlement) dari counterparty untuk dialokasikan ke **beberapa tujuan sekaligus**:
1. Melunasi pokok advance (ADVANCE_PRINCIPAL)
2. Membayar invoice penjualan terkait (SALES_INVOICE)
3. Mencatat pendapatan langsung (DIRECT_REVENUE)
4. Membentuk deposit customer (CUSTOMER_DEPOSIT)
5. Dan lainnya

---

## Invariant

```
SUM(allocation_lines.amount) === settlement.amount_received
```

Toleransi: ±0.01 (untuk pembulatan). Validasi dilakukan server-side sebelum transaksi dicommit.

---

## Flow Settlement

```
POST /api/advances/:id/settle
Body:
{
  date: "YYYY-MM-DD",
  bank_account_id: <COA id akun bank>,
  amount_received: <total uang masuk>,
  allocation_lines: [
    { allocation_type: "ADVANCE_PRINCIPAL", amount: X },      // CR Advance Receivable
    { allocation_type: "SALES_INVOICE",     coa_id: Y, amount: Z }, // CR AR
    { allocation_type: "DIRECT_REVENUE",    coa_id: W, amount: V }, // CR Revenue
  ]
}
```

---

## Pembentukan Jurnal

### Pattern: Principal Only
```
DR Bank                 Rp X
  CR Advance Receivable   Rp X
```

### Pattern: Principal + Invoice
```
DR Bank                 Rp (X + Z)
  CR Advance Receivable   Rp X      ← ADVANCE_PRINCIPAL
  CR AR / Piutang         Rp Z      ← SALES_INVOICE (coa_id)
```

### Pattern: Principal + Direct Revenue
```
DR Bank                 Rp (X + V)
  CR Advance Receivable   Rp X      ← ADVANCE_PRINCIPAL
  CR Pendapatan Jasa      Rp V      ← DIRECT_REVENUE (coa_id)
```

### Pattern: Multi-service Revenue
```
DR Bank                   Rp Total
  CR Advance Receivable     Rp X    ← ADVANCE_PRINCIPAL
  CR Pendapatan Freight      Rp A   ← DIRECT_REVENUE (coa_id_freight)
  CR Pendapatan Warehouse    Rp B   ← DIRECT_REVENUE (coa_id_wh)
  CR Selisih Pembulatan      Rp C   ← ROUNDING (opsional)
```

---

## State Transition Setelah Settlement

```javascript
// Server-side logic
const principalSettled = lines
  .filter(l => l.allocation_type === "ADVANCE_PRINCIPAL")
  .reduce((sum, l) => sum + l.amount, 0);

new_settled_amount   = MIN(old_settled_amount + principalSettled, advance.amount)
new_remaining_amount = MAX(advance.remaining_amount - principalSettled, 0)
new_lifecycle_status = (new_remaining_amount <= 0) ? "settled" : "partially_settled"
```

---

## Nomor Settlement

Format: `ADV-STL-YYYYMM-NNNN`

Contoh: `ADV-STL-202607-0001`

Counter di-reset tiap bulan, dihitung dari jumlah settlement yang sudah ada untuk company tersebut.

---

## Validasi

1. **advance harus outstanding/partially_settled/disbursed** — tidak bisa settle draft/void/settled
2. **allocation_lines wajib non-empty** — minimal satu baris
3. **SUM(lines) === amount_received** — toleransi 0.01
4. **journal harus ada** — minimal satu accounting journal type bank/cash harus dikonfigurasi
5. **bank_account_id wajib** untuk posting jurnal — tanpa bank_account_id, settlement tetap dibuat tapi tanpa jurnal

---

## Partial Settlement

Partial settlement didukung secara penuh:
- Satu advance bisa memiliki **banyak settlement records**
- Setiap settlement menurunkan `remaining_amount`
- Ketika `remaining_amount` menjadi 0 → status berubah ke `settled`
- Antara 0 < remaining < amount → status `partially_settled`

---

## Error Handling

| Kondisi                              | HTTP Status | Response                                |
|--------------------------------------|-------------|------------------------------------------|
| advance tidak ditemukan              | 404         | `{ message: "Not found" }`              |
| status bukan outstanding/partial     | 400         | `{ message: "Advance tidak dalam status..." }` |
| allocation_lines kosong              | 400         | `{ message: "allocation_lines wajib..." }` |
| SUM != amount_received               | 400         | `{ message: "Total alokasi (X) tidak sama..." }` |
| Journal tidak ada                    | 200 (ok)    | Settlement dibuat, journal_id = null    |
| DB error                             | 500         | `{ error: "..." }`                      |
