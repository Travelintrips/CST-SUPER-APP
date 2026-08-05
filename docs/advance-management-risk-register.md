# Advance Management — Risk Register

Setiap risiko dipetakan ke temuan di `docs/advance-management-enterprise-audit.md` dan `docs/advance-management-gap-analysis.md`. Likelihood/Impact dinilai kualitatif (Low/Medium/High) berdasarkan bukti kode, bukan spekulasi.

| ID | Risiko | Sumber Temuan | Likelihood | Impact | Risk Level | Mitigasi yang Direkomendasikan |
|----|--------|----------------|------------|--------|------------|----------------------------------|
| R1 | Void advance setelah disbursed gagal membuat reversal jurnal yang benar karena signature call `assertCanVoidTransaction`/`createReversalJournal` tidak cocok dengan fungsi aslinya | Audit §2, Gap #2 | Medium | High | **Critical** | Perbaiki call-site (Roadmap Fase 1); tambah test end-to-end untuk flow void-setelah-disburse sebelum dipakai di produksi untuk volume tinggi |
| R2 | Settlement gagal di tengah proses (insert allocation line ke-N gagal) meninggalkan jurnal & status advance yang sudah ter-update tapi alokasi tidak lengkap, tanpa error yang terlihat | Audit §2/§3, Gap #3 | Medium | High | **Critical** | Bungkus proses settle dalam DB transaction, hapus silent-catch (Roadmap Fase 1) |
| R3 | Dua engine (legacy `cashAdvances.ts` + unified `advances.ts`) menulis ke tabel `cash_advances` yang sama secara independen, berpotensi race condition atau advance "invisible" di salah satu sistem | Audit §0/§1, Gap #1 | Medium | High | **Critical** | Konsolidasi arsitektur (Roadmap Fase 2); audit penggunaan aktual endpoint legacy di frontend |
| R4 | Approval bernilai besar untuk 7 dari 8 tipe advance (semua kecuali warisan EMPLOYEE) tidak melalui limit approval bertingkat — satu admin bisa approve nilai berapapun | Audit §9, Gap #4 | High | High | **Critical** | Integrasikan `expense_approval_limits` ke seluruh tipe advance (Roadmap Fase 3) |
| R5 | Tidak ada segregation of duties — satu user admin bisa create, approve, disburse, dan void advance yang sama sendirian | Audit §10, Gap #5 | High | Medium–High | **High** | Tambah permission granular / maker-checker minimal untuk disburse & void (Roadmap Fase 3) |
| R6 | Modul tidak menangani kewajiban pajak (PPh 23/Final, PPN dibayar dimuka) pada advance vendor/purchase | Audit §6, Gap #6 | High (jika ada transaksi vendor/purchase advance riil) | High | **High** | Rancang skema pajak via SAFE PROPOSAL MODE, libatkan tim pajak (Roadmap Fase 5) |
| R7 | Advance customer tidak otomatis diterapkan ke invoice Sales Order terkait — berisiko advance "terlupakan" dan piutang tercatat lebih besar dari seharusnya | Audit §7, Gap #7 | Medium | Medium | **Medium–High** | Tambah linking SO + endpoint apply-to-invoice (Roadmap Fase 4) |
| R8 | Advance vendor/purchase tidak otomatis memotong vendor bill — risiko pembayaran ganda ke vendor jika staf lupa cross-check manual | Audit §7, Gap #8 | Medium | High | **High** | Tambah linking PO/vendor bill + auto-offset (Roadmap Fase 4) |
| R9 | Jurnal advance tidak melewati alur rekonsiliasi bank terpadu — potensi duplikasi/mismatch saat rekonsiliasi bulanan | Audit §8, Gap #9 | Medium | Medium | **Medium** | Integrasikan sebagai sumber `bank_mutations` (Roadmap Fase 4) |
| R10 | Saldo advance multi-currency tidak pernah dihitung ulang FX gain/loss-nya — laporan keuangan valas berpotensi salah | Audit §5, Gap #10 | Low–Medium (tergantung volume transaksi valas) | Medium | **Medium** | Tambah kalkulasi realized FX gain/loss (Roadmap Fase 5) |
| R11 | Retry network pada `/settle` (tanpa idempotency guard) berpotensi menghasilkan settlement & jurnal duplikat untuk pembayaran yang sama | Audit §14 (area tambahan), Gap #17 | Low–Medium | High | **Medium–High** | Tambah idempotency guard mengikuti pola `entry_id` di disburse (Roadmap Fase 1) |
| R12 | Audit trail tidak lengkap — 7 dari 9 aksi (approve/reject/disburse/void/repay/delete + 1 lainnya) tidak tercatat di `auditFromReq` | Audit §14, Gap #15 | High | Medium | **Medium–High** | Tambah audit log ke semua aksi sensitif (Roadmap Fase 1) |
| R13 | Schema `advance_settlements`/`advance_allocation_lines` dibuat via raw SQL inline, di luar tata kelola Drizzle schema resmi proyek | Audit §12, Gap #13 | High (sudah terjadi) | Low–Medium | **Medium** | Migrasikan ke Drizzle schema resmi (Roadmap Fase 6) |
| R14 | Tidak ada CHECK constraint DB untuk enum status — insert dari luar aplikasi (script/migrasi lain) bisa menghasilkan kombinasi status ilegal | Audit §12, Gap #14 | Low | Medium | **Low–Medium** | Tambah CHECK constraint pada migrasi berikutnya (Roadmap Fase 6) |
| R15 | Dokumentasi desain (`advance-settlement-accounting.md`) menyatakan reversal otomatis berjalan sempurna, padahal kode menunjukkan signature mismatch — berpotensi menyesatkan pengembang/auditor berikutnya | Audit §2, Gap #21 | High (sudah terjadi) | Low–Medium | **Medium** | Update dokumentasi segera setelah R1 diperbaiki, atau tandai sebagai known issue sekarang |

---

## Ringkasan Distribusi Risiko

- **Critical**: 4 (R1–R4) — seluruhnya terkait integritas data keuangan dan kontrol approval, direkomendasikan untuk ditangani di Roadmap Fase 1–3 sebelum modul dipakai untuk volume transaksi tinggi.
- **High**: 3 (R5, R6, R8)
- **Medium–High**: 3 (R7, R11, R12)
- **Medium**: 3 (R9, R10, R13)
- **Low–Medium**: 2 (R14, R15)

Tidak ada risiko yang diberi level "Critical" tanpa bukti kode langsung yang mendukungnya — seluruh entri R1–R4 merujuk ke baris kode spesifik yang telah diverifikasi selama audit.
