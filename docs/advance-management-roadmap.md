# Advance Management — Implementation Roadmap

Roadmap ini adalah **rekomendasi**, bukan rencana eksekusi yang sudah disetujui. Setiap fase yang menyentuh schema/DDL baru harus melalui **SAFE PROPOSAL MODE** dan menunggu konfirmasi eksplisit pengguna sebelum implementasi, sesuai kebijakan sistem proyek ini.

---

## Fase 1 — Stabilisasi Kritis (Critical Fixes, No Schema Change)
**Tujuan**: Menutup celah integritas data & keuangan yang sudah ada di kode saat ini, tanpa menyentuh schema.

- Perbaiki pemanggilan `assertCanVoidTransaction` / `createReversalJournal` di endpoint `/void` agar sesuai signature asli (Gap #2).
- Bungkus proses `/settle` (insert settlement header + allocation lines + update advance) dalam satu `db.transaction()`; hilangkan silent `.catch(()=>{})` pada insert allocation line (Gap #3).
- Tambah `auditFromReq` pada endpoint approve/reject/disburse/void/repay/delete (Gap #15).
- Tambah idempotency guard pada `/settle` mengikuti pola guard `entry_id` yang sudah ada di `/disburse` (Gap #17).

**Effort**: Kecil–Medium. **Risiko jika ditunda**: Tinggi — kesalahan void/reversal dan settlement non-atomik berdampak langsung ke laporan keuangan.

---

## Fase 2 — Konsolidasi Arsitektur (Unifikasi Dua Engine)
**Tujuan**: Menghilangkan risiko dua sistem paralel yang menulis ke tabel sama.

- Audit penggunaan aktual `/api/cash-advances` di frontend — tentukan apakah legacy masih dipakai aktif atau sudah bisa dinonaktifkan.
- Definisikan rencana migrasi final: redirect legacy endpoint ke unified engine secara bertahap (feature-flag), atau nyatakan legacy sebagai read-only untuk data historis.
- Pastikan setiap advance baru yang tercipta (dari jalur manapun) selalu mengisi `advance_type` dan `lifecycle_status` secara konsisten sejak insert.

**Effort**: Medium–High (butuh koordinasi dengan tim frontend BizPortal). **Ketergantungan**: Fase 1 selesai agar dasar teknis stabil sebelum konsolidasi.

---

## Fase 3 — Kontrol Internal & RBAC (Approval + Segregation of Duties)
**Tujuan**: Mengembalikan dan memperluas kontrol approval bertingkat ke seluruh tipe advance.

- Integrasikan `expense_approval_limits`/`expense_approval_requests` (pola legacy) ke seluruh 8 tipe advance di unified engine (Gap #4).
- Tambah permission granular per aksi (create/approve/disburse/settle/void) — minimal maker-checker untuk disburse & void (Gap #5).
- Reaktivasi notifikasi WhatsApp/email untuk semua tipe advance saat butuh approval (Gap #16).

**Effort**: Medium. **SAFE PROPOSAL diperlukan**: jika permission model butuh tabel role/permission baru.

---

## Fase 4 — Integrasi Lintas-Modul (SO/PO/Bank Reconciliation)
**Tujuan**: Menghilangkan pencatatan manual antara advance dan proses bisnis lain.

- Tambah linking `sales_order_id` pada advance CUSTOMER + endpoint apply-to-invoice (Gap #7).
- Tambah linking `purchase_order_id`/`vendor_bill_id` pada advance VENDOR/PURCHASE + auto-offset saat bill diposting (Gap #8).
- Integrasikan disbursement/settlement sebagai sumber `bank_mutations` yang melewati `unifiedMatchingEngine` (Gap #9).
- Implementasi update status dokumen referensi (invoice/PO) saat allocation line dibuat, mengubah `reference_doc_id` dari metadata pasif menjadi integrasi dua arah (Gap #12).

**Effort**: Tinggi — ini adalah fase paling kompleks, menyentuh 3 modul lain (Sales, Procurement, Bank Reconciliation). **SAFE PROPOSAL diperlukan**: kemungkinan besar butuh kolom/tabel baru untuk linking.

---

## Fase 5 — Kepatuhan Pajak & Multi-Currency
**Tujuan**: Memenuhi kebutuhan kepatuhan pajak Indonesia dan akurasi multi-currency.

- Rancang skema pajak untuk advance vendor/purchase (PPh 23/Final) dan DP (PPN dibayar dimuka), termasuk nomor bukti potong (Gap #6). **Wajib SAFE PROPOSAL MODE** — ini adalah penambahan skema baru yang signifikan dan menyentuh kepatuhan legal, harus dikonfirmasi user secara eksplisit sebelum implementasi.
- Implementasi kalkulasi realized FX gain/loss otomatis saat `exchange_rate` settlement berbeda dari saat disbursement (Gap #10).

**Effort**: Tinggi. **Catatan**: Area ini paling sensitif secara compliance — rekomendasi kuat untuk melibatkan tim pajak/akuntan sebelum desain final dikunci.

---

## Fase 6 — Enterprise Polish (Schema Governance, Batch, Reporting)
**Tujuan**: Menaikkan modul dari "berfungsi" menjadi "enterprise-grade" secara arsitektur & observability.

- Migrasikan definisi `advance_settlements`/`advance_allocation_lines` dari raw SQL inline ke Drizzle schema resmi di `lib/db/src/schema/` (Gap #13).
- Tambah CHECK constraint DB untuk `lifecycle_status`/`advance_type` (Gap #14).
- Tambah endpoint batch-settle untuk satu pembayaran menutup banyak advance sekaligus (Gap #11).
- Tambah `project_id`/`cost_center_id` opsional pada `advance_allocation_lines` (Gap #18).
- Tambah dashboard progres migrasi legacy vs unified, dan update dokumentasi desain agar selalu selaras dengan kode aktual (Gap #19, #21).
- Update UI untuk memanfaatkan linking SO/PO setelah Fase 4 selesai (Gap #20).

**Effort**: Medium, dapat dicicil per-item secara independen setelah fase-fase sebelumnya stabil.

---

## Ringkasan Urutan & Ketergantungan

```
Fase 1 (Stabilisasi Kritis)
   ↓
Fase 2 (Konsolidasi Arsitektur) ──┐
   ↓                              │
Fase 3 (Kontrol Internal/RBAC)    │
   ↓                              │
Fase 4 (Integrasi Lintas-Modul) ←─┘
   ↓
Fase 5 (Pajak & Multi-Currency)
   ↓
Fase 6 (Enterprise Polish)
```

Fase 1 harus selesai lebih dulu — dua fase ini adalah perbaikan integritas data yang mendasari kepercayaan terhadap seluruh angka yang dihasilkan modul ini. Fase 5 (pajak) secara teknis bisa paralel dengan Fase 3/4 jika sumber daya tersedia, tapi secara compliance sebaiknya tidak ditunda terlalu lama.
