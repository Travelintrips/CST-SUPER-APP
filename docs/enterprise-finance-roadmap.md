# ENTERPRISE FINANCE ROADMAP
**Post Advance Management Refactor**  
**Tanggal:** 6 Juli 2026  
**Basis:** Hasil audit + gap analysis + readiness score

---

## STATUS SAAT INI

| Komponen | Status | Score |
|---|---|---|
| GL Core | ✅ Production-ready dengan minor fix | 88 |
| Advance Engine | ⚠️ 2 bug kritis, perlu patch | 68 |
| AR | ⚠️ Infrastruktur ada, data belum matang | 55 |
| AP | ⚠️ Infrastruktur ada, belum digunakan | 60 |
| Bank Recon | ⚠️ Engine siap, belum end-to-end | 72 |
| Tax | ⚠️ Schema ada, belum ada data | 70 |
| Security | ✅ Solid | 80 |
| Audit Trail | ⚠️ Gap pada advance history | 55 |
| **Overall** | **⚠️ Below target (70/100)** | **70** |

---

## SPRINT PRE-ALLOCATION (WAJIB — Sebelum Sprint Allocation Engine)

**Durasi estimasi: 1 minggu**  
**Target score setelah sprint: ≥ 85**

### Ticket PA-01 — Fix `entry_id` Not Set After Settlement
**Priority:** P0 CRITICAL  
**File:** `artifacts/api-server/src/routes/advances.ts`  
**Effort:** 2 jam

Setelah `postExpenseSettlement()` selesai dan journal berhasil dibuat, jalankan:
```typescript
await db.update(cashAdvances)
  .set({ entry_id: journalResult.entryId })
  .where(eq(cashAdvances.id, advanceId));
```
Juga perbaiki advance ID=2 (KSB/2026/00001) secara data patch.

---

### Ticket PA-02 — Fix `paid_amount` Double-Count di Settle-to-Expense
**Priority:** P0 CRITICAL  
**File:** `artifacts/api-server/src/routes/advances.ts`  
**Effort:** 2 jam

Pisahkan increment:
- Settle-to-expense → hanya update `settled_amount`, `remaining_amount`
- Repayment → hanya update `paid_amount`, `remaining_amount`

Jangan increment keduanya di path yang sama.

---

### Ticket PA-03 — Void Draft Journal JE/2026/000003
**Priority:** P1  
**Action:** Finance Admin void JE/2026/000003 via admin interface  
**Effort:** 15 menit

---

### Ticket PA-04 — Smoke Test Approval Flow End-to-End
**Priority:** P1  
**Effort:** 1 hari

Lakukan test:
1. Create advance (draft)
2. Submit untuk approval
3. Approve (via authorized user)
4. Verify `approval_requests` record terbuat
5. Disburse → verify journal posted dengan source yang benar
6. Repay → verify journal + `paid_amount` updated
7. Settle → verify journal + `entry_id` updated (setelah PA-01)

---

### Ticket PA-05 — Run Bank Reconciliation Cycle Pertama
**Priority:** P1  
**Effort:** 0.5 hari

Gunakan 6 mutations yang ada, run matching engine, approve ≥1 mutation, verify journal terbentuk dengan benar.

---

### Ticket PA-06 — Fix Journal Source Labels di AdvanceJournalService
**Priority:** P2  
**File:** `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts`  
**Effort:** 1 jam

Update semua `createJournal()` call untuk menggunakan source yang tepat:
- Disbursement → `advance_disbursement`
- Repayment → `advance_repayment`
- Settlement → `advance_settlement`
- Void → `advance_void`
- Reversal → `advance_reversal`

Tambah enum values di DB jika perlu (via migration sebelum patch).

---

## SPRINT 1 — ALLOCATION ENGINE

**Prasyarat:** Sprint Pre-Allocation selesai, score ≥ 85  
**Durasi estimasi: 3 minggu**

### Fitur
1. **Multi-invoice payment** — 1 payment → N invoices, prorata allocation
2. **Advance allocation** — 1 advance → N invoices / N services / N cost centers
3. **Allocation lines** — table `advance_allocation_lines` sudah ada, perlu engine
4. **Journal per allocation line** — setiap baris alokasi menghasilkan journal entry
5. **Partial allocation** — advance bisa dialokasikan sebagian

### Schema Additions (perlu konfirmasi sebelum implementasi)
- `payment_allocations` — link payment ke invoice dengan amount per invoice
- `advance_allocation_lines` — sudah ada, perlu diisi oleh engine

---

## SPRINT 2 — AR FORMALIZATION

**Durasi estimasi: 2 minggu**

### Fitur
1. **Invoice formal** — ubah `invoice_status: 'invoiced'` trigger journal AR
2. **DP/Advance from Customer** — pisahkan dari regular payment, journal `DR Cash / CR Advance from Customer`
3. **AR Aging Report** — per customer, per due date bucket
4. **AR Settlement** — saat payment diterima, match ke invoice via journal `DR Advance from Customer / CR AR`
5. **Trade vs Advance Receivable** — COA separation yang jelas

---

## SPRINT 3 — AP FORMALIZATION

**Durasi estimasi: 2 minggu**

### Fitur
1. **Purchase bill formal** — `bill_status: 'billed'` trigger journal AP `DR Expense / CR AP`
2. **AP Payment** — journal `DR AP / CR Cash/Bank`
3. **Vendor advance settlement** — match vendor advance ke purchase bill
4. **AP Aging Report** — per vendor, per due date
5. **3-way match** — PO → GR → Invoice verification

---

## SPRINT 4 — AUDIT TRAIL & COMPLIANCE

**Durasi estimasi: 1.5 minggu**

### Fitur
1. **`cash_advance_audit_logs`** — dedicated audit history per advance
2. **Advance status history** — setiap transisi status dicatat dengan actor + timestamp + payload
3. **Journal approval dual-control** — void/reverse memerlukan 2 approver
4. **Compliance report** — export audit trail per periode

---

## SPRINT 5 — BANK RECONCILIATION MATURITY

**Durasi estimasi: 2 minggu**

### Fitur
1. **Auto-matching improvement** — gunakan ML/fuzzy matching untuk ref yang tidak exact
2. **Partial matching** — 1 mutation cocok ke beberapa invoices
3. **Reconciliation report** — daily/monthly recon status
4. **Bank statement import** — batch import dari file CSV/Excel/MT940

---

## SPRINT 6 — TAX ENGINE

**Durasi estimasi: 2 minggu**

### Fitur
1. **PPN Output** — saat invoice diterbitkan, auto-create `transaction_taxes`
2. **PPN Input** — saat purchase bill diterima
3. **PPh withholding** — vendor payment dengan PPh
4. **Faktur Pajak** — generate nomor faktur pajak
5. **Masa Pajak** — period lock dan pelaporan per masa pajak
6. **Coretax integration** — export ke format Coretax DJP

---

## SPRINT 7 — OVER/UNDER PAYMENT

**Durasi estimasi: 1.5 minggu**

### Fitur
1. **Over payment** — excess payment → pilihan: deposit, refund, advance baru, AR credit
2. **Under payment** — kurang bayar → partial settlement + outstanding sisa
3. **Payment status engine** — auto-compute status (unpaid/partial/paid/overpaid)

---

## SPRINT 8 — MULTI-CURRENCY & FOREX

**Durasi estimasi: 2 minggu**

### Fitur
1. **Exchange rate master** — daily rate input atau API feed
2. **Transaction in USD/EUR/JPY/SGD** — invoice, payment, advance
3. **Forex realization** — saat payment vs invoice di currency berbeda
4. **Forex Gain/Loss journal** — auto-generate `DR/CR Forex Gain/Loss`
5. **Multi-currency balance sheet** — report dalam IDR dengan disclosure forex

---

## SPRINT 9 — FINANCIAL STATEMENT MATURITY

**Durasi estimasi: 1.5 minggu**

### Fitur
1. **Cash Flow Statement** — direct method dengan categorization
2. **Comparative P&L** — period vs period
3. **Balance Sheet drill-down** — click COA → lihat detail transactions
4. **Financial report export** — PDF, Excel
5. **Period close** — lock accounting period setelah finalized

---

## SPRINT 10 — ENTERPRISE SCALABILITY

**Durasi estimasi: 2 minggu**

### Fitur
1. **Materialized views** — pre-computed trial balance, COA balances
2. **Incremental ledger** — hanya compute delta, bukan full scan
3. **Report caching** — Redis/Supabase cache untuk heavy reports
4. **DB partitioning** — `accounting_entries` partisi by year/company
5. **Performance benchmarks** — target <200ms untuk semua financial reports

---

## TIMELINE SUMMARY

| Sprint | Nama | Durasi | Prasyarat |
|---|---|---|---|
| Pre-Alloc | Bug fixes + smoke test | 1 minggu | — |
| Sprint 1 | Allocation Engine | 3 minggu | Pre-Alloc done, score ≥85 |
| Sprint 2 | AR Formalization | 2 minggu | Sprint 1 done |
| Sprint 3 | AP Formalization | 2 minggu | Sprint 2 paralel |
| Sprint 4 | Audit Trail | 1.5 minggu | Sprint 1 done |
| Sprint 5 | Bank Recon Maturity | 2 minggu | Sprint 1 done |
| Sprint 6 | Tax Engine | 2 minggu | Sprint 2, 3 done |
| Sprint 7 | Over/Under Payment | 1.5 minggu | Sprint 2 done |
| Sprint 8 | Multi-Currency | 2 minggu | Sprint 7 done |
| Sprint 9 | Financial Statements | 1.5 minggu | Sprint 6 done |
| Sprint 10 | Scalability | 2 minggu | Sprint 9 done |

**Total estimasi (sequential):** ~20 minggu  
**Dengan parallelisasi sprint 2–4:** ~14 minggu

---

## KEPUTUSAN LANJUT ALLOCATION ENGINE

**✅ DIIZINKAN** dengan kondisi:
1. PA-01 (entry_id fix) selesai
2. PA-02 (paid_amount fix) selesai
3. PA-04 (approval smoke test) selesai
4. Score enterprise readiness: telah mencapai ≥ 85

**⛔ JANGAN MULAI** sprint Allocation Engine jika:
- PA-01 dan PA-02 belum di-patch
- Trial balance berubah dari 0 imbalance
- Corruption baru ditemukan setelah patch
