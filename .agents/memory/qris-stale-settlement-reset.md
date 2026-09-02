---
name: QRIS stale settlement reset
description: Governance boundary for correcting stale settlement status on canonical Sport Center payments.
---

Reset status settlement yang stale hanya boleh dilakukan pada payment canonical Sport Center, dengan company context, admin authentication, alasan audit, dan row lock. Semua `payment_settlement_items` aktif harus memblokir reset sampai workflow reversal atau de-link menyelesaikannya; status batch posted/reconciled bukan satu-satunya konflik.

**Why:** Mengubah flag settlement tanpa membersihkan membership settlement dapat membuat approval berikutnya ambigu atau memisahkan status sumber dari ledger canonical.

**How to apply:** Tampilkan status payment live dari sumber canonical di kandidat QRIS, tampilkan membership settlement aktif secara terpisah, dan gunakan endpoint reset khusus—bukan endpoint edit payment publik.