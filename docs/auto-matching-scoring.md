# Auto-Matching Scoring Reference

## Algoritma Scoring

Scoring bersifat deterministik (non-AI): hasil scoring identik untuk input yang sama. Tidak ada randomness, tidak ada model ML.

## Dimensi dan Bobot

### 1. Amount (40 poin)
```typescript
const amountMatched = Math.abs(Number(cand.amount) - Number(mutation.amount)) < 0.01;
const amountPts = amountMatched ? weights.weight_amount : 0;
```
- Full points: nominal mutasi = nominal kandidat (toleransi Rp 0,01)
- Zero points: nominal tidak sama
- Tidak ada partial credit — ini mencegah false positive

### 2. Reference (25 poin)
```typescript
referenceMatched = cand.ref.toUpperCase().trim() === mutation.provider_order_id.toUpperCase().trim();
```
- Exact match `provider_order_id` (dari bank statement) vs `ref` kandidat
- Case-insensitive, trim whitespace

### 3. Invoice (15 poin)
- Hanya berlaku untuk `candidate_type = 'invoice'`
- Logika sama dengan Reference — jika sudah dapat Reference poin, Invoice juga terpenuhi (double credit intentional karena berbeda dimensi: ref = payment reference, invoice = doc number)

### 4. Customer (10 poin)
```typescript
function nameOverlap(a, b): boolean {
  // Token overlap ≥ 40% setelah normalisasi (lowercase, strip non-alphanum)
  // Token minimum length > 2 karakter
}
```
- Fuzzy match antara `cand.name` dan `mutation.normalized_description`
- Threshold 40% overlap memungkinkan partial name match (mis. "PT MAJU BERSAMA" vs "MAJU BERSAMA")

### 5. Date (5 poin)
```typescript
const diffDays = Math.abs(mDate - cDate) / 86_400_000;
const dateMatched = diffDays <= 1;
```
- Same day atau ±1 hari
- Mengakomodasi perbedaan timezone dan cut-off bank

### 6. Company (5 poin)
```typescript
const companyMatched = !!(mutation.company_id && cand.company_id && mutation.company_id === cand.company_id);
```
- Strict equality — null di sisi mana pun = tidak cocok
- Mencegah cross-company contamination

## Threshold dan Klasifikasi

| Skor | Klasifikasi | Tab UI | Aksi yang Tersedia |
|------|-------------|--------|-------------------|
| ≥ 95 | `auto_suggest` | Suggested (⭐) | Confirm / Reject |
| 50–94 | `manual_review` | Suggested / Manual Review | Pilih → Confirm / Reject |
| < 50 | `unmatched` | Tidak muncul | - |

## Contoh Skenario

### Skenario 1: Perfect Match (100 poin)
```
Mutasi: Rp 5.000.000, ref "INV-2024-001", deskripsi "PT MAJU", date 2024-01-15, company 1
Kandidat invoice: Rp 5.000.000, ref "INV-2024-001", name "PT MAJU BERSAMA", date 2024-01-15, company 1
Skor: 40 + 25 + 15 + 10 + 5 + 5 = 100 → auto_suggest ✅
```

### Skenario 2: Amount Match Only (40 poin)
```
Mutasi: Rp 2.500.000, ref "-", deskripsi "Transfer", date 2024-01-15, company 1
Kandidat: Rp 2.500.000, ref "ADV-005", name "Budi Santoso", date 2024-01-10, company 2
Skor: 40 + 0 + 0 + 0 + 0 + 0 = 40 → unmatched (tidak ditampilkan)
```

### Skenario 3: Overpayment Exception
```
Mutasi: Rp 6.000.000
Best candidate: Rp 5.000.000
→ Exception OVERPAYMENT dibuat
→ Confirm akan menghasilkan allocation_lines dengan line tambahan CUSTOMER_DEPOSIT Rp 1.000.000
```

## Konfigurasi Weights

Weights dapat dikonfigurasi per company melalui tabel `bank_allocation_rules`. Company-specific rule diprioritaskan di atas global default.

```sql
INSERT INTO bank_allocation_rules (company_id, rule_name, weight_amount, auto_suggest_threshold)
VALUES (5, 'conservative', 45, 98);
```
