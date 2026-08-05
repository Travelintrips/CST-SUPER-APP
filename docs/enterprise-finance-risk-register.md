# ENTERPRISE FINANCE RISK REGISTER
**Post Advance Management Refactor**  
**Tanggal:** 6 Juli 2026  
**Format:** ID | Area | Deskripsi | Likelihood | Impact | Score | Mitigasi

---

## RISK MATRIX LEGEND

| Likelihood | Impact | Risk Score |
|---|---|---|
| High (3) | High (3) | 9 — CRITICAL |
| High (3) | Medium (2) | 6 — HIGH |
| Medium (2) | High (3) | 6 — HIGH |
| Medium (2) | Medium (2) | 4 — MEDIUM |
| Low (1) | High (3) | 3 — MEDIUM |
| Low (1) | Medium (2) | 2 — LOW |
| Any | Low (1) | 1–3 — LOW |

---

## ACTIVE RISKS

### R-001 — `entry_id` NULL pada Settled Advance
- **Area:** Advance Management / Audit Trail  
- **Deskripsi:** Advance KSB/2026/00001 sudah settled tapi `entry_id = NULL`. Journal settlement ada (JE/2026/000007) tapi tidak di-link ke advance record.  
- **Likelihood:** Medium (2) — ada 1 kasus, bisa terjadi lagi di flow yang sama  
- **Impact:** High (3) — audit trail terputus, reporting advance-journal tidak akurat  
- **Risk Score:** 6 — HIGH  
- **Status:** OPEN  
- **Mitigasi:** Patch `routes/advances.ts` — update `entry_id` setelah `postExpenseSettlement()`  
- **Owner:** Backend Dev  
- **Target:** Sebelum go-live advance settlement

---

### R-002 — `paid_amount` Double-Count pada Settle-to-Expense
- **Area:** Advance Management / Data Integrity  
- **Deskripsi:** Saat advance diselesaikan via expense reclassification, `paid_amount` dan `settled_amount` keduanya dinaikkan sebesar amount advance. Formula `remaining = amount - paid - settled` menghasilkan nilai negatif.  
- **Likelihood:** Medium (2) — terjadi di KSB/2026/00001, bisa terjadi di setiap settle-to-expense  
- **Impact:** High (3) — outstanding advance mis-reported, cash flow bisa double-count exit kas  
- **Risk Score:** 6 — HIGH  
- **Status:** OPEN  
- **Mitigasi:** Fix increment logic — settle-to-expense hanya update `settled_amount`  
- **Owner:** Backend Dev  
- **Target:** Sebelum go-live advance settlement

---

### R-003 — Draft Journal Menggantung (JE/2026/000003)
- **Area:** GL / Advance  
- **Deskripsi:** Journal draft ref KSB/2026/00001 tidak pernah diposting dan tidak di-void. Menciptakan noise di laporan draft journal dan bisa membingungkan.  
- **Likelihood:** Low (1)  
- **Impact:** Medium (2)  
- **Risk Score:** 2 — LOW  
- **Status:** OPEN  
- **Mitigasi:** Void JE/2026/000003 via admin interface atau patch data  
- **Owner:** Finance Admin  
- **Target:** Cleanup sebelum audit berikutnya

---

### R-004 — Approval Flow Tidak Diverifikasi
- **Area:** Security / Advance Approval  
- **Deskripsi:** `approval_requests` table = 0 records. Belum bisa dipastikan bahwa approval workflow berjalan dengan benar, termasuk notifikasi, state guard, dan journal post saat approval.  
- **Likelihood:** Medium (2) — fitur ada di kode tapi belum dicoba di env ini  
- **Impact:** Medium (2) — advance bisa diapprove tanpa kontrol yang benar  
- **Risk Score:** 4 — MEDIUM  
- **Status:** OPEN  
- **Mitigasi:** Lakukan smoke test end-to-end: create → submit → approve → disburse  
- **Owner:** QA / Backend Dev  
- **Target:** Sebelum production go-live

---

### R-005 — Payment Diterima Sebelum Invoice Formal
- **Area:** AR / Revenue Recognition  
- **Deskripsi:** 3 sales documents `to_invoice` memiliki `amount_paid = 3,000,000`. Tidak jelas apakah ini DP yang valid atau entry error.  
- **Likelihood:** Low (1) — mungkin bisnis normal (DP)  
- **Impact:** Medium (2) — AR mis-stated, journal tidak ada untuk payment ini  
- **Risk Score:** 2 — LOW  
- **Status:** OPEN — perlu klarifikasi bisnis  
- **Mitigasi:** Tambah field `payment_type` untuk membedakan DP vs regular payment. Buat journal `DR Cash / CR Advance from Customer` untuk DP.  
- **Owner:** Finance / Backend Dev  
- **Target:** Saat AR module di-production

---

### R-006 — Tidak Ada Dedicated Advance Audit Log
- **Area:** Auditability / Compliance  
- **Deskripsi:** Tidak ada tabel yang menyimpan history per-event (create/approve/disburse/settle/repay/void/reverse) untuk setiap advance. Compliance audit tidak bisa menjawab "siapa yang melakukan apa dan kapan pada advance X".  
- **Likelihood:** High (3) — pasti dibutuhkan saat compliance audit  
- **Impact:** Medium (2) — regulatory compliance risk  
- **Risk Score:** 6 — HIGH  
- **Status:** OPEN  
- **Mitigasi:** Buat `cash_advance_audit_logs` table dan isi di setiap state transition  
- **Owner:** Backend Dev  
- **Target:** Sebelum sprint Allocation Engine

---

### R-007 — Bank Reconciliation Belum Satu Siklus Penuh
- **Area:** Bank & Cash  
- **Deskripsi:** 6 bank mutations ada tapi semua `unmatched`. Matching engine belum pernah dijalankan sampai `approved`. Tidak bisa verify bahwa journal bank reconciliation benar.  
- **Likelihood:** Low (1) — sistem baru, data belum banyak  
- **Impact:** High (3) — jika engine rusak, bank balance bisa mis-stated  
- **Risk Score:** 3 — MEDIUM  
- **Status:** OPEN  
- **Mitigasi:** Run reconciliation cycle dengan 6 mutations yang ada, verify journals created  
- **Owner:** Finance / Backend Dev  
- **Target:** Sebelum production go-live

---

### R-008 — Journal Source Labels Tidak Spesifik
- **Area:** GL / Reporting  
- **Deskripsi:** Semua advance journals berlabel `source='manual'` atau `source='kasbon'` bukan `advance_disbursement`/`advance_settlement`/`advance_repayment`. Reporting by source tidak bisa membedakan advance vs manual entry.  
- **Likelihood:** High (3) — terjadi pada semua advance yang ada  
- **Impact:** Low (1) — tidak affect balance, hanya affect reporting granularity  
- **Risk Score:** 3 — MEDIUM  
- **Status:** OPEN  
- **Mitigasi:** Update `AdvanceJournalService` untuk menggunakan enum source yang tepat  
- **Owner:** Backend Dev  
- **Target:** Sprint berikutnya

---

### R-009 — Tidak Ada Forex Gain/Loss Handling
- **Area:** Multi-Currency  
- **Deskripsi:** Field `currency` dan `exchange_rate` ada di `cash_advances`, tapi tidak ada logika revaluation atau forex gain/loss. Jika ada transaksi non-IDR, GL tidak akan balance dengan benar setelah revaluation.  
- **Likelihood:** Low (1) — belum ada transaksi non-IDR  
- **Impact:** High (3) — financial statements bisa salah jika ada transaksi USD/EUR  
- **Risk Score:** 3 — MEDIUM  
- **Status:** OPEN — mitigasi sementara: hanya gunakan IDR  
- **Mitigasi:** Implementasi forex revaluation sebelum onboarding transaksi multi-currency  
- **Owner:** Backend Dev  
- **Target:** Sprint Multi-Currency

---

### R-010 — N+1 Query Risk pada Financial Reports
- **Area:** Performance / Scalability  
- **Deskripsi:** `buildLedgerWindow` mengagregasi semua `accounting_entries` tanpa partisi. Pada volume tinggi (>100k entries), report bisa slow atau timeout.  
- **Likelihood:** Low (1) — data saat ini hanya 13 journals  
- **Impact:** Medium (2) — user experience degradation, potential timeout  
- **Risk Score:** 2 — LOW  
- **Status:** WATCH  
- **Mitigasi:** Tambah materialized view atau incremental ledger computation saat volume entries > 10k  
- **Owner:** Backend Dev  
- **Target:** Pre-scale (sebelum onboarding banyak perusahaan)

---

## RISK SUMMARY

| ID | Area | Score | Severity | Status |
|---|---|---|---|---|
| R-001 | Advance / Audit Trail | 6 | 🔴 HIGH | OPEN |
| R-002 | Advance / Data Integrity | 6 | 🔴 HIGH | OPEN |
| R-006 | Auditability | 6 | 🔴 HIGH | OPEN |
| R-004 | Security / Approval | 4 | 🟡 MEDIUM | OPEN |
| R-007 | Bank & Cash | 3 | 🟡 MEDIUM | OPEN |
| R-008 | GL / Reporting | 3 | 🟡 MEDIUM | OPEN |
| R-009 | Multi-Currency | 3 | 🟡 MEDIUM | OPEN |
| R-003 | GL / Advance | 2 | 🟢 LOW | OPEN |
| R-005 | AR | 2 | 🟢 LOW | OPEN |
| R-010 | Performance | 2 | 🟢 LOW | WATCH |

**Total Risks:** 10 | **High:** 3 | **Medium:** 4 | **Low:** 3

---

## STOP CONDITION EVALUATION

Per kriteria audit:

| Condition | Found? | Decision |
|---|---|---|
| Journal corruption | ❌ Tidak ada | ✅ Lanjut |
| Duplicate posting | ❌ Tidak ada | ✅ Lanjut |
| AR/AP mismatch | ❌ Tidak ada (data minimal) | ✅ Lanjut dengan catatan |
| Financial statement imbalance | ❌ Trial balance = 0 | ✅ Lanjut |
| Bank reconciliation corruption | ❌ Tidak ada (belum dijalankan) | ✅ Lanjut |

**KEPUTUSAN: Tidak ada STOP condition yang terpenuhi.**  
Advance ke sprint Allocation Engine **diizinkan dengan syarat** Gap 1 & 2 (R-001, R-002) di-patch terlebih dahulu.
