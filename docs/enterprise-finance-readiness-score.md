# ENTERPRISE FINANCE READINESS SCORE
**Post Advance Management Refactor**  
**Tanggal:** 6 Juli 2026  
**Metodologi:** Scoring 0–100 per area, bobot sesuai kritikalitas ERP

---

## FINAL VERDICT — SCORECARD

| Area | Score | Bobot | Weighted | Status |
|---|---|---|---|---|
| General Ledger | 88 | 20% | 17.6 | ✅ SOLID |
| AR | 55 | 12% | 6.6 | ⚠️ PARTIAL |
| AP | 60 | 10% | 6.0 | ⚠️ EMPTY |
| Cash & Bank | 72 | 12% | 8.6 | ⚠️ PENDING |
| Tax | 70 | 8% | 5.6 | ⚠️ UNVERIFIED |
| Advance | 68 | 15% | 10.2 | ⚠️ BUGS |
| Security | 80 | 8% | 6.4 | ✅ GOOD |
| Auditability | 55 | 8% | 4.4 | ⚠️ GAP |
| Scalability | 65 | 4% | 2.6 | ⚠️ UNVERIFIED |
| Enterprise Readiness | 62 | 3% | 1.9 | ⚠️ PARTIAL |
| **TOTAL** | | **100%** | **70.0** | **⚠️ BELOW TARGET** |

**🎯 Target sebelum Sprint Allocation Engine: ≥ 85**  
**📊 Skor saat ini: 70 — BELUM MEMENUHI TARGET**

---

## DETAIL SCORING

### General Ledger — 88/100

**Positif (+):**
- ✅ Trial balance 0 imbalance (14,050,000 = 14,050,000) [+30]
- ✅ 0 orphan journals dan 0 orphan lines [+15]
- ✅ 0 duplicate posting [+15]
- ✅ DB triggers immutability aktif [+15]
- ✅ `financial_outbox_events` semua processed [+8]
- ✅ 0 invalid COA references [+5]

**Negatif (-):**
- ⚠️ Journal source labels tidak spesifik (`manual` semua) [-7]
- ⚠️ 2 journal draft menggantung [-5]

---

### AR (Account Receivable) — 55/100

**Positif (+):**
- ✅ 0 negative AR [+20]
- ✅ 0 double AR [+20]
- ✅ Schema AR komplit [+10]

**Negatif (-):**
- ⚠️ Tidak ada dokumen `invoiced` — AR formal belum terbentuk [-20]
- ⚠️ 3M collected di `to_invoice` tanpa journal AR resmi [-15]
- ⚠️ `sales_doc_kind` tidak punya `invoice` kind — desain perlu klarifikasi [-10]

---

### AP (Account Payable) — 60/100

**Positif (+):**
- ✅ Schema AP lengkap [+25]
- ✅ Vendor advance flow berjalan (5M repaid) [+25]
- ✅ 0 duplicate AP [+10]

**Negatif (-):**
- ⚠️ 0 purchase bills — AP formal belum digunakan [-30]
- ⚠️ Tidak bisa verify integrity tanpa data [-20]

*Note: Skor "60" adalah proyeksi berdasarkan kesiapan infrastruktur, bukan data aktual.*

---

### Cash & Bank — 72/100

**Positif (+):**
- ✅ `approveAndCreateJournal` sebagai single entry point [+25]
- ✅ 0 approved mutations tanpa journal [+20]
- ✅ Bank mutations tersimpan dengan benar [+15]
- ✅ Matching engine logic solid [+12]

**Negatif (-):**
- ⚠️ 0 reconciliation cycle selesai — belum diverifikasi end-to-end [-20]
- ⚠️ 6 mutations semua unmatched [-8]

---

### Tax — 70/100

**Positif (+):**
- ✅ Advance tidak menghasilkan pajak (confirmed) [+30]
- ✅ `taxEngineCore.ts` dengan `recordTransactionTax` exist [+20]
- ✅ Tax tables schema komplit (PPN, PPh, Coretax) [+20]

**Negatif (-):**
- ⚠️ 0 tax records — tidak bisa verify tax engine berfungsi di production flow [-30]

---

### Advance — 68/100

**Positif (+):**
- ✅ State machine enforce valid transitions [+20]
- ✅ Repayment flow berfungsi (4 repayments, 5.2M) [+15]
- ✅ Void advance berfungsi [+10]
- ✅ Reversal journal berfungsi [+10]
- ✅ 0 imbalanced advance journals [+8]

**Negatif (-):**
- 🔴 `entry_id` NULL setelah settlement (KSB/2026/00001) [-15]
- 🔴 `paid_amount` double-count di settle-to-expense [-12]
- ⚠️ Draft disbursement journal menggantung [-5]
- ⚠️ Approval flow belum diverifikasi [-8]

---

### Security — 80/100

**Positif (+):**
- ✅ RLS `deny_direct_anon_access` pada entry lines [+25]
- ✅ DB triggers blokir mutation pada posted lines [+25]
- ✅ `adminMiddleware` pada semua admin routes [+20]
- ✅ State machine guards prevent invalid transitions [+10]

**Negatif (-):**
- ⚠️ Approval RBAC belum diverifikasi (0 records) [-15]
- ⚠️ Void/Reverse belum ada 2FA atau dual-control [-10]

---

### Auditability — 55/100

**Positif (+):**
- ✅ `audit_logs` ada (87 records) [+20]
- ✅ `financial_outbox_events` ada (11 records) [+15]
- ✅ Immutability triggers pada posted journals [+20]

**Negatif (-):**
- ⚠️ Tidak ada `advance_audit_logs` dedicated [-25]
- ⚠️ Status history advance tidak tercatat per-event [-15]
- ⚠️ `approval_requests` kosong, approval history tidak bisa diaudit [-10]

---

### Scalability — 65/100

**Positif (+):**
- ✅ Index pada `accounting_entry_lines` (entry_id, account_id) [+25]
- ✅ `buildLedgerWindow` aggregation untuk reporting [+15]
- ✅ `financial_outbox_events` untuk event decoupling [+15]

**Negatif (-):**
- ⚠️ Tidak ada partisi pada `accounting_entries` untuk data besar [-15]
- ⚠️ N+1 risk pada advance settlement dengan banyak lines [-15]
- ⚠️ Belum ada caching layer untuk financial reports [-10]

---

### Enterprise Readiness — 62/100

**Positif (+):**
- ✅ Supabase PostgreSQL sebagai foundation solid [+20]
- ✅ Drizzle ORM schema-first [+10]
- ✅ Multi-company architecture ada [+10]
- ✅ COA master data ada [+10]
- ✅ Outbox pattern untuk event reliability [+10]

**Negatif (-):**
- ⚠️ Allocation Engine belum ada [-15]
- ⚠️ Multi-currency/forex belum ada [-10]
- ⚠️ Over/Under payment belum ada [-8]
- ⚠️ Bank reconciliation belum satu siklus penuh [-5]

---

## PRASYARAT SEBELUM ALLOCATION ENGINE

Target: **≥ 85**. Gap: **15 poin**.

Untuk mencapai 85, prioritas fix:

| Fix | Estimasi Poin | Effort |
|---|---|---|
| Fix `entry_id` + `paid_amount` bug (Gap 1 & 2) | +8 (Advance score) | 1 hari |
| Tambah `advance_audit_logs` table | +6 (Auditability score) | 2 hari |
| Run bank reconciliation 1 siklus penuh | +4 (Bank score) | 1 hari |
| Verifikasi approval flow end-to-end | +3 (Advance + Security) | 1 hari |
| Fix journal source labels | +2 (GL score) | 0.5 hari |
| **Total** | **+23 poin** → 93 | **~5.5 hari** |

**Rekomendasi:** Selesaikan Gap 1 & 2 (patch kecil) sebelum sprint Allocation Engine dimulai. Gap lainnya bisa paralel.
