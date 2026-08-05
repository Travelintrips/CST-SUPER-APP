# SPORT CENTER DOUBLE JOURNAL — ROOT CAUSE REPORT

**Tanggal Audit:** 2026-08-03  
**Status:** READ-ONLY — tidak ada perubahan kode  
**Severity:** HIGH — duplicate debit/credit cash movement, neraca tidak balance

---

## 1. TL;DR — Root Cause

**`sport_payments` tidak memiliki kolom `accounting_payment_id`**, namun
`approveAndCreateJournal` di bank reconciliation melakukan JOIN ke kolom tersebut
untuk menemukan journal existing. SQL error ditelan secara diam-diam oleh `.catch()`,
sehingga lookup selalu mengembalikan 0 baris, `reusedEntry = null`,
dan kode jatuh ke Step 4 yang membuat journal baru.

---

## 2. Dua Journal yang Dibuat

| | Journal 1 | Journal 2 |
|---|---|---|
| **Nomor** | JNL/2026/001219 | JNL/2026/001220 |
| **source** | `sport_center_booking` | `bank_reconciliation` |
| **source_id** | `sport_bookings.id` | `bank_mutations.id` |
| **Dibuat oleh** | `postSportCenterPaymentAtomic` | `approveAndCreateJournal` |
| **Trigger** | POST /api/sport-center/payments | POST /api/bank-reconciliation/:mutationId/approve |
| **Status awal** | `posted` | `approved_pending_posting` (draft) |
| **File** | `artifacts/api-server/src/lib/accounting.ts` L2538 | `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts` L922 |

Kedua journal memiliki nominal yang sama karena keduanya merepresentasikan
transaksi kas yang sama (pembayaran booking sport center).

---

## 3. Transaction Flow Lengkap

```
POST /api/sport-center/payments
  └─ routes.ts L2202
        │
        ├─ INSERT sport_payments                     (sport_payments.id = X)
        ├─ UPDATE sport_bookings payment_status='paid'
        │
        └─ postSportCenterPaymentAtomic(tx, { paymentId: X, sourceId: booking_id, ... })
                │  accounting.ts L2437
                │
                ├─ IDEMPOTENCY CHECK: SELECT FROM accounting_entries
                │    WHERE source='sport_center_booking' AND source_id=booking_id   ← PASS (baru)
                │
                ├─ _postEntryCore(tx, { source:'sport_center_booking', sourceId:booking_id })
                │    → INSERT accounting_entries   [id=E1, status='posted',
                │                                   source='sport_center_booking',
                │                                   source_id=booking_id]
                │    → JNL/2026/001219
                │
                └─ INSERT accounting_payments
                     [entry_id=E1, source_type='sport_center', source_doc_id=X]
                     → paymentId = AP_ID
                     ← RETURN { entryId: E1, paymentId: AP_ID }
                                              ↑
                            AP_ID TIDAK ditulis ke sport_payments.accounting_payment_id
                            (kolom tersebut TIDAK ADA di tabel sport_payments)


POST /api/bank-reconciliation/:mutationId/approve
  └─ bankReconciliation.ts L742
        │
        └─ approveAndCreateJournal(mutationId, matchId, 'sport_payment', sport_payments_id, actor)
                │  unifiedMatchingEngine.ts L644
                │
                ├─ Step 1: Lock bank_mutations row FOR UPDATE
                │
                ├─ Step 2: idempotency guard (status ≠ 'approved')   ← PASS
                │
                ├─ Step 3: Resolve bank COA + contra + journal
                │
                ├─ ★ EXISTING ENTRY LOOKUP (L768–802) ★
                │    selectedType === 'sport_payment'  → masuk cabang
                │
                │    QUERY (L774–783):
                │    ┌─────────────────────────────────────────────────────┐
                │    │ SELECT ae.id, ae.entry_number                       │
                │    │ FROM sport_payments sp                              │
                │    │ JOIN accounting_payments ap                         │
                │    │   ON ap.id = sp.accounting_payment_id    ← KOLOM   │
                │    │                                            TIDAK ADA│
                │    │ JOIN accounting_entries ae ON ae.id = ap.entry_id  │
                │    │ WHERE sp.id = ${sport_payments_id}                  │
                │    │   AND ae.status = 'posted'                         │
                │    └─────────────────────────────────────────────────────┘
                │
                │    EKSEKUSI: .catch(() => ({ rows: [] }))   ← L794–795
                │    PostgreSQL error "column sp.accounting_payment_id does not exist"
                │    DITELAN DIAM-DIAM  →  rows = []
                │
                │    reusedEntry = null   ← TIDAK masuk cabang "reuse"
                │
                ├─ Step 4: postEntryWithClient(tx, { source:'bank_reconciliation', sourceId:mutationId })
                │    → INSERT accounting_entries   [id=E2, status='draft',
                │                                   source='bank_reconciliation',
                │                                   source_id=mutationId]
                │    → JNL/2026/001220
                │
                └─ UPDATE bank_mutations SET status='approved_pending_posting', journal_entry_id=E2
```

---

## 4. Mengapa Duplicate Tidak Terblokir oleh Unique Constraint

Tabel `accounting_entries` memiliki unique constraint:

```sql
-- lib/db/src/schema/accounting.ts L311-313
uniqueIndex("accounting_entries_source_uniq")
  .on(t.source, t.sourceId)
  .where(sql`${t.source} <> 'manual' AND ${t.sourceId} IS NOT NULL`)
```

Journal 1: `(source='sport_center_booking', source_id=booking_id)`  
Journal 2: `(source='bank_reconciliation', source_id=mutation_id)`

Keduanya memiliki kombinasi `(source, source_id)` yang **berbeda** — constraint tidak melindungi kasus ini. Constraint hanya mencegah dua INSERT dengan source+source_id yang persis sama.

---

## 5. Tiga Lapisan Existing-Journal Detection yang Semuanya Melewati Kasus Ini

### 5a. `_postEntryCore` idempotency check (accounting.ts L310–325)
```typescript
// Hanya cek (source, sourceId) yang SAMA:
WHERE source = 'bank_reconciliation' AND source_id = mutationId
```
Bank recon belum pernah diposting sebelumnya → check lolos → INSERT dilanjutkan.

### 5b. `approveAndCreateJournal` reuse logic (unifiedMatchingEngine.ts L768–802)
Dirancang untuk mendeteksi journal dari modul lain, tapi JOIN-nya salah (lihat §6).

### 5c. `checkIdempotency` di route (bankReconciliation.ts L750)
Cek idempotency key di level HTTP route — hanya melindungi double-submit dari client
yang sama, bukan duplicate journal cross-source.

---

## 6. Exact Root Cause — Tiga Komponen Bug

### Bug A — Kolom yang direferensikan tidak ada

**File:** `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`  
**Baris:** 774–783  
**Function:** `approveAndCreateJournal`

```typescript
const sourceQuery = selectedType === "sport_payment"
  ? `
    SELECT ae.id, ae.entry_number
    FROM sport_payments sp
    JOIN accounting_payments ap
      ON ap.id = sp.accounting_payment_id    // ← KOLOM INI TIDAK ADA
    JOIN accounting_entries ae ON ae.id = ap.entry_id
    WHERE sp.id = ${sourceId}
      AND ae.status = 'posted'
      ${companyId != null ? `AND ae.company_id = ${companyId}` : ""}
    LIMIT 1
  `
```

Tabel `sport_payments` **tidak memiliki kolom `accounting_payment_id`**.  
Konfirmasi: `grep -rn "accounting_payment_id" lib/db/src/schema/` hanya
menemukan `cashAdvances.ts:47` — bukan sport_payments.

### Bug B — SQL error ditelan diam-diam

**File:** `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`  
**Baris:** 794–795  
**Function:** `approveAndCreateJournal`

```typescript
const { rows: sourceRows } = await tx.execute(sql.raw(sourceQuery))
  .catch(() => ({ rows: [] as any[] }));   // ← ERROR APAPUN → rows kosong
```

PostgreSQL error `42703: column "accounting_payment_id" of relation "sport_payments" does not exist`
ditelan sepenuhnya. Tidak ada log, tidak ada exception. Akibatnya `sourceRows = []`,
`reusedEntry = null`, dan eksekusi berlanjut ke Step 4 (buat journal baru).

### Bug C — `postSportCenterPaymentAtomic` tidak menyimpan link balik

**File:** `artifacts/api-server/src/lib/accounting.ts`  
**Baris:** 2570–2606  
**Function:** `postSportCenterPaymentAtomic`

```typescript
// accounting_payments dibuat dengan source_doc_id = sport_payments.id
const payInsert = await client.execute(sql`
  INSERT INTO accounting_payments
    (..., entry_id, source_type, source_doc_id, ...)
  VALUES
    (..., ${entry.id}, 'sport_center', ${args.paymentId}, ...)
  RETURNING id
`);
const paymentId = Number((payInsert.rows[0] as any)?.id ?? 0);
return { entryId: entry.id, paymentId, skipped: false };
// ← TIDAK ada UPDATE sport_payments SET accounting_payment_id = paymentId
```

`accounting_payments.id` yang baru dibuat tidak pernah ditulis ke `sport_payments`.
Bahkan jika kolomnya ada, join tetap akan menghasilkan NULL → 0 rows.

---

## 7. Pola Join yang Benar vs Salah

### Yang ada di kode (SALAH):
```sql
-- Arah join: sport_payments → accounting_payments via FK di sport_payments
FROM sport_payments sp
JOIN accounting_payments ap ON ap.id = sp.accounting_payment_id
JOIN accounting_entries ae ON ae.id = ap.entry_id
WHERE sp.id = :sport_payment_id
```

### Yang seharusnya (jika menggunakan accounting_payments):
```sql
-- Arah join: accounting_payments punya source_doc_id yang menunjuk ke sport_payments
FROM sport_payments sp
JOIN accounting_payments ap
  ON ap.source_type = 'sport_center'
 AND ap.source_doc_id = sp.id
JOIN accounting_entries ae ON ae.id = ap.entry_id
WHERE sp.id = :sport_payment_id
  AND ae.status = 'posted'
```

### Atau alternatif langsung via accounting_entries:
```sql
-- postSportCenterPaymentAtomic menyimpan: source='sport_center_booking', source_id=booking_id
-- sport_payments menyimpan booking_id → perlu join ke sport_bookings dulu
FROM sport_payments sp
JOIN sport_bookings sb ON sb.id = sp.booking_id
JOIN accounting_entries ae
  ON ae.source = 'sport_center_booking'
 AND ae.source_id = sb.id
WHERE sp.id = :sport_payment_id
  AND ae.status = 'posted'
```

---

## 8. Flow yang Seharusnya

```
Booking dibuat
  ↓
POST /payments → sport_payments INSERT
  ↓
postSportCenterPaymentAtomic
  → accounting_entries [source='sport_center_booking', source_id=booking_id, status='posted']
  → accounting_payments [entry_id=E1, source_type='sport_center', source_doc_id=sport_payment_id]
  ↓
Bank mutation masuk dari Google Sheet
  ↓
Matching engine menemukan kandidat sport_payment
  ↓
POST /approve
  ↓
approveAndCreateJournal
  → query existing entry via accounting_payments.source_doc_id = sport_payment_id
  → reusedEntry = { id: E1, entryNumber: 'JNL/2026/001219' }   ← REUSE
  ↓
UPDATE bank_mutations
  SET status = 'posted',
      journal_entry_id = E1    ← link ke journal existing
      approved_at = NOW()
  ↓
Status = Reconciled
TIDAK membuat journal baru ✓
```

---

## 9. Ringkasan File & Baris

| File | Baris | Masalah |
|---|---|---|
| `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts` | L774–783 | Query JOIN ke kolom yang tidak ada (`sp.accounting_payment_id`) |
| `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts` | L794–795 | `.catch(() => ({ rows: [] }))` menelan SQL error tanpa log |
| `artifacts/api-server/src/lib/accounting.ts` | L2585–2606 | Tidak menulis `accounting_payments.id` balik ke `sport_payments` |
| `lib/db/src/schema/` | (tidak ada) | `sport_payments` tidak memiliki kolom `accounting_payment_id` |

---

## 10. Verifikasi di Database

Untuk mengkonfirmasi temuan ini di database dev:

```sql
-- Cek dua journal untuk booking yang sama
SELECT ae.id, ae.entry_number, ae.source, ae.source_id, ae.status, ae.created_at
FROM accounting_entries ae
WHERE ae.entry_number IN ('JNL/2026/001219', 'JNL/2026/001220');

-- Cek bahwa sport_payments tidak punya link balik ke accounting_payments
SELECT sp.id, sp.booking_id, sp.amount, sp.created_at
FROM sport_payments sp
WHERE sp.id = <SPORT_PAYMENT_ID>;
-- → kolom accounting_payment_id tidak akan ada

-- Cek accounting_payments punya source_doc_id yang benar
SELECT ap.id, ap.entry_id, ap.source_type, ap.source_doc_id
FROM accounting_payments ap
WHERE ap.source_type = 'sport_center'
  AND ap.source_doc_id = <SPORT_PAYMENT_ID>;
-- → AP_ID ada, tapi tidak direferensikan dari sport_payments
```
