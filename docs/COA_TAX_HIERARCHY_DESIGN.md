# COA Tax Hierarchy Design
**Versi:** 1.0  
**Tanggal:** 2026-08-01  
**Scope:** CST (PT B2B Marketplace and Logistic) — berlaku untuk semua perusahaan per-company_code

---

## 1. Tujuan

Restrukturisasi Chart of Accounts pajak dari akun generik ke struktur hierarki **Header → Subakun Postable** sehingga:

- Laporan keuangan lebih terperinci per jenis pajak
- AI dapat memilih COA pajak yang spesifik
- Akun induk (header) tidak dapat digunakan untuk posting jurnal
- Transaksi pajak tidak lagi diarahkan ke Beban Operasional Lain
- Struktur mengikuti COA Master Governance (Task #5)

---

## 2. Prinsip Desain

| Prinsip | Aturan |
|---------|--------|
| Header account | `is_header = true`, `is_postable = false` |
| Postable account | `is_header = false`, `is_postable = true` |
| Parent-child | Category parent dan child harus kompatibel |
| Same-company | Parent dan child harus company_id yang sama |
| No cycle | Tidak boleh ada circular parent reference |
| Governance | Semua perubahan via coa_change_requests (maker-checker) |

---

## 3. Struktur Target

### A. KEWAJIBAN PAJAK

> **Code Collision Fix (2026-08-02):** `2-1060` ditempati oleh "Hutang Intercompany - PT Diva Servis"
> (is_header=false, is_postable=true). Safe code yang dipilih: **`2-1090`** (children 2-1091…2-1102).

```
2-1090-CST  KEWAJIBAN PAJAK CST            [HEADER, LIABILITY, CREDIT]
├─ 2-1091-CST  Hutang PPN CST
├─ 2-1092-CST  Hutang PPh Pasal 21 CST
├─ 2-1093-CST  Hutang PPh Pasal 22 CST
├─ 2-1094-CST  Hutang PPh Pasal 23 CST
├─ 2-1095-CST  Hutang PPh Pasal 25 CST
├─ 2-1096-CST  Hutang PPh Pasal 26 CST
├─ 2-1097-CST  Hutang PPh Pasal 29 CST
├─ 2-1098-CST  Hutang PPh Final Pasal 4 Ayat 2 CST
├─ 2-1099-CST  Hutang Pajak Daerah CST
├─ 2-1100-CST  Hutang Pajak Kendaraan CST
├─ 2-1101-CST  Hutang Bea Masuk CST
├─ 2-1102-CST  Hutang Cukai CST
└─ 2-1030-CST  Hutang Pajak Lainnya CST   [EXISTING — reparented, fallback terakhir]
```

Parent global: `2-1000` (Kewajiban Lancar)

### B. ASET PAJAK

```
1-1070-CST  ASET PAJAK CST                 [HEADER, ASSET, DEBIT]
├─ 1-1050-CST  PPN Masukan CST             [EXISTING — reparented]
├─ 1-1071-CST  Pajak Dibayar Dimuka CST
├─ 1-1072-CST  Piutang Pajak CST
├─ 1-1073-CST  Lebih Bayar Pajak CST
├─ 1-1074-CST  Kredit Pajak PPh 22 CST
├─ 1-1075-CST  Kredit Pajak PPh 23 CST
└─ 1-1076-CST  Kredit Pajak PPh 25 CST
```

Parent global: `1-1000` (Aset Lancar)

### C. BEBAN PAJAK

```
5-3040-CST  BEBAN PAJAK CST                [HEADER, EXPENSE, DEBIT]
├─ 5-3020-CST  Beban Pajak & Perijinan CST [EXISTING — reparented, fallback]
├─ 5-3041-CST  Beban Bea Materai CST
├─ 5-3042-CST  Beban Pajak Daerah CST
├─ 5-3043-CST  Beban Pajak Kendaraan CST
├─ 5-3044-CST  Beban PPh Final atas Bunga Bank CST  ★ KEY NEW ACCOUNT
├─ 5-3045-CST  Beban Denda Pajak CST       [OTHER_EXPENSE]
├─ 5-3046-CST  Beban Sanksi dan Bunga Pajak CST  [OTHER_EXPENSE]
├─ 5-3047-CST  Beban Pajak Tidak Dapat Dikreditkan CST
└─ 5-3048-CST  Beban Pajak Lainnya CST
```

Parent global: `5-3000` (Beban Lain-lain)

---

## 4. Perlakuan Akun Existing

| Kode | Nama | Perlakuan |
|------|------|-----------|
| `2-1030-CST` | Hutang Pajak Lainnya CST | **PERTAHANKAN** — reparent ke 2-1090 (bukan 2-1060 — collision fix). Tetap postable sebagai fallback. Kode tidak berubah. Jurnal historis tidak berubah. |
| `5-3020-CST` | Beban Pajak & Perijinan CST | **PERTAHANKAN** — reparent ke 5-3040. Tetap postable untuk pajak tanpa subakun spesifik. |
| `5-2040-CST` | Beban Operasional Lain CST | **JANGAN UBAH** — bukan parent pajak. Pertahankan untuk beban operasional non-pajak. |

---

## 5. Alokasi Kode

### Pola Kode CST
- Format: `{kategori}-{grup}{sekuens}-{ABBR}`
- Contoh: `2-1090-CST` = Kewajiban (2), Kelompok 1000, Sekuens 90, Company CST

### Slot yang Dipakai (Existing)
| Range | Status |
|-------|--------|
| `2-1010` s.d. `2-1060` | DIPAKAI (termasuk 2-1060 = Hutang Intercompany) |
| `2-1090` s.d. `2-1102` | BARU (Tax header + subaccounts, safe codes) |
| `1-1010` s.d. `1-1060` | DIPAKAI |
| `1-1070` s.d. `1-1076` | BARU (Tax asset header + subaccounts) |
| `5-3010` s.d. `5-3030` | DIPAKAI |
| `5-3040` s.d. `5-3048` | BARU (Tax expense header + subaccounts) |

---

## 6. Tax Mapping Rule

| Jenis Pajak | COA yang Direkomendasikan |
|-------------|--------------------------|
| PPN Masukan | `1-1050-CST` PPN Masukan |
| PPN Keluaran (belum bayar) | `2-1091-CST` Hutang PPN |
| PPh Pasal 21 | `2-1092-CST` Hutang PPh Pasal 21 |
| PPh Pasal 23 | `2-1094-CST` Hutang PPh Pasal 23 |
| Bea Materai | `5-3041-CST` Beban Bea Materai |
| Denda Pajak | `5-3045-CST` Beban Denda Pajak |
| Pajak Bunga Bank (PPh Final 20%) | `5-3044-CST` Beban PPh Final atas Bunga Bank |
| Bea Masuk | `2-1101-CST` Hutang Bea Masuk |
| Fallback (pajak tidak teridentifikasi) | `2-1030-CST` Hutang Pajak Lainnya |

---

## 7. Bank Interest Tax Matching (Phase 8)

### Pola Pencocokan Deterministik

```
BUNGA:  Rp 157.676  (INTEREST_INCOME — jasa giro / bunga deposito)
PAJAK:  Rp  31.535  (≈ 20% dari bunga = PPh Final Pasal 4 Ayat 2)
Ref:    16416       (rekening yang sama)
Tanggal: sama atau ±1 hari
```

### Kondisi Match
1. Satu transaksi teridentifikasi sebagai INTEREST_INCOME
2. Satu transaksi teridentifikasi sebagai pajak (TAX_PAYMENT / deskripsi mengandung "pajak")
3. Tanggal ≤ 3 hari beda
4. Rasio pajak/bunga ≈ 20% (±0.1 percentage point explicit tolerance + 5% slack of rate; default effective range 18.9%–21.1%)
5. Account reference sama ketika kedua transaksi memilikinya; mismatch ditolak

### Output
- `recommendedIntent: 'INTEREST_TAX_WITHHOLDING'`
- `recommendedCoaName: 'Beban PPh Final atas Bunga Bank'`
- `requiresHumanApproval: true` (ALWAYS — tidak ada auto-post)
- Candidate tidak dibuat jika rasio di luar toleransi, account reference berbeda, atau tanggal melewati batas.
- Confidence matcher bersifat deterministik berdasarkan bukti yang tersedia dan dibatasi maksimum 95; confidence proposal COA tetap mengikuti policy `92`.

---

## 8. AI Policy Rule (COA Proposal Engine)

Pattern regex untuk INTEREST_TAX_WITHHOLDING:
```
/pph.?final.*bunga|pajak.*bunga.?bank|pph.*jasa.?giro|beban.?pph.?final.*bunga|pot.?pajak.?bunga|debet.?pajak.?bunga|interest.?tax.?withholding|pph.?4.*2.*bunga/i
```

Resolusi:
- `category: "EXPENSE"`
- `normalBalance: "DEBIT"`
- `financialStatement: "PROFIT_AND_LOSS"`
- `confidence: 92`
- `requiresHumanApproval: true`

Parent yang disarankan: header `5-3040-CST` (BEBAN PAJAK)

---

## 9. Governance Flow

```
Maker (system:coa-tax-migration-v1)
    ↓ createChangeRequest()
DRAFT
    ↓ submitChangeRequest()
PENDING_APPROVAL
    ↓ [Checker review via COA Governance UI]
    ↓ approveChangeRequest() — checker ≠ maker
APPROVED → COA master updated
    ↓ Version snapshot saved in coa_versions
```

### Semua change requests bersifat idempotent
- Prefix idempotency key: `coa-tax-v1:{action}:{baseCode}:{abbr}`
- Aman dipanggil berulang kali

---

## 10. Safety Constraints

| Constraint | Penegakan |
|------------|-----------|
| Header tidak postable | `validatePostableRules()` |
| Parent-child kompatibel | `isParentCategoryCompatible()` |
| Same-company | `validateCoaHierarchy()` company scope check |
| No cycle | `isDescendant()` cycle detection |
| Maker ≠ Checker | `approveChangeRequest()` self-approve check |
| No auto-post | `requiresHumanApproval: true` always |
| No journal mutation | Change requests only touch COA master |
| Existing accounts preserved | Reparent only, no delete |
