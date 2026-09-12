# Bank Allocation — Risk Register

Sprint 4 Phase 2 | Terakhir diupdate: 2026-07-06

---

## R01 — Auto-Posting Tanpa Approval Manusia

| Atribut | Detail |
|---------|--------|
| **Risiko** | Engine secara tidak sengaja memposting jurnal tanpa konfirmasi finance |
| **Dampak** | KRITIS — jurnal yang tidak valid di ledger, sulit di-reverse |
| **Probabilitas** | Rendah |
| **Mitigasi** | `bankAllocationMatching.ts` TIDAK pernah memanggil `AdvanceJournalService`. Confirm hanya membuat `allocation_headers` berstatus `draft`. Posting hanya dari Allocation Center yang sudah ada. |
| **Verifikasi** | Test T4.1 dan T4.2 di test plan: `COUNT(accounting_entries)` tidak berubah setelah run/confirm |

---

## R02 — Cross-Company Data Leakage

| Atribut | Detail |
|---------|--------|
| **Risiko** | Finance di company A bisa melihat mutasi atau alokasi milik company B |
| **Dampak** | TINGGI — data sensitif terekspos |
| **Probabilitas** | Rendah |
| **Mitigasi** | Semua query pakai `company_id = ${userCompanyId}` filter. Confirm memvalidasi `m.company_id` sebelum insert. |
| **Verifikasi** | Test T3.1 dan T3.2 di test plan |

---

## R03 — False Positive Auto-Suggest

| Atribut | Detail |
|---------|--------|
| **Risiko** | Skor 95+ tapi kandidat salah → finance confirm tanpa review |
| **Dampak** | SEDANG — allocation_header draft dibuat ke kandidat yang salah; harus di-void |
| **Probabilitas** | Sedang (threshold 95 cukup ketat tapi tidak 100% akurat) |
| **Mitigasi** | Auto-suggest hanya menaruh kandidat di tab "Suggested" — tetap butuh klik Confirm eksplisit oleh finance. Tidak ada bypass UI. Score breakdown ditampilkan di detail dialog. |
| **Residual Risk** | Finance harus selalu verifikasi score breakdown sebelum confirm |

---

## R04 — Duplicate Allocation Header

| Atribut | Detail |
|---------|--------|
| **Risiko** | Finance mengklik Confirm dua kali → dua `allocation_headers` untuk mutasi yang sama |
| **Dampak** | SEDANG — double allocation bisa menghasilkan double journal saat posting |
| **Probabilitas** | Rendah |
| **Mitigasi** | Status guard: confirm hanya diizinkan dari status MATCHED atau CANDIDATE. Setelah CONFIRMED, tombol Confirm disembunyikan di UI. |
| **Residual Risk** | Race condition jika dua user confirm bersamaan — perlu database-level constraint di phase berikutnya |

---

## R05 — Scoring Engine False Negative (Score Terlalu Rendah)

| Atribut | Detail |
|---------|--------|
| **Risiko** | Match valid tapi skor < 50 → tidak muncul di UI, finance tidak tahu |
| **Dampak** | RENDAH-SEDANG — mutasi tetap di tab Unmatched, harus match manual |
| **Probabilitas** | Sedang (terutama jika reference tidak ada di bank statement) |
| **Mitigasi** | Finance tetap bisa lihat detail mutasi dan pilih kandidat secara manual dari dialog. Threshold `manual_review_floor` dapat dikonfigurasi per company. |

---

## R06 — Database Connection Failure Saat Matching Run

| Atribut | Detail |
|---------|--------|
| **Risiko** | pgBouncer throttle atau koneksi drop saat batch processing 200 mutasi |
| **Dampak** | RENDAH — partial run; mutasi yang belum diproses tetap di status unmatched |
| **Probabilitas** | Rendah (environment Replit dengan pgBouncer dikenal stabil setelah tuning) |
| **Mitigasi** | Setiap source fetch di `fetchAllocationCandidates` diproteksi `.catch()` terpisah. Error per-kandidat dilaporkan sebagai exception, bukan crash keseluruhan. |

---

## R07 — Split Total Mismatch

| Atribut | Detail |
|---------|--------|
| **Risiko** | Split lines tidak menjumlah ke nominal mutasi → allocation_header tidak balance |
| **Dampak** | TINGGI — ledger tidak balance |
| **Probabilitas** | Rendah |
| **Mitigasi** | Validasi server-side wajib: `diff = |sum(lines) - mutation.amount| < 0.01`. Jika tidak valid → 400 dengan pesan deskriptif. |

---

## R08 — Merge Pattern (Next Phase)

| Atribut | Detail |
|---------|--------|
| **Risiko** | Banyak mutasi kecil perlu di-merge ke satu invoice → tidak tersedia di Phase 2 |
| **Dampak** | RENDAH-SEDANG — kasus edge, bisa dilakukan manual di Allocation Center |
| **Status** | Dicatat sebagai **Phase 3** backlog |

---

## Ringkasan Risk Matrix

| ID | Dampak | Probabilitas | Status |
|----|--------|--------------|--------|
| R01 | Kritis | Rendah | ✅ Mitigated |
| R02 | Tinggi | Rendah | ✅ Mitigated |
| R03 | Sedang | Sedang | ⚠️ Residual — butuh SOP finance |
| R04 | Sedang | Rendah | ⚠️ Residual — DB constraint next phase |
| R05 | Sedang | Sedang | ✅ Accepted — manual fallback tersedia |
| R06 | Rendah | Rendah | ✅ Mitigated |
| R07 | Tinggi | Rendah | ✅ Mitigated |
| R08 | Sedang | - | 📋 Backlog Phase 3 |
