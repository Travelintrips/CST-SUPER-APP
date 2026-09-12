---
name: Sport payment legacy mirror cleanup
description: Production cleanup for legacy SCPAY mirrors must use guarded matching and preserve posted rows.
---

Gunakan database Supabase runtime production untuk cleanup `sport_payments`, bukan replica database Replit. Anggap kolom status/accounting opsional tidak seragam antar snapshot schema; gunakan introspeksi dan `to_jsonb` saat audit.

**Why:** Production pernah memiliki 301 mirror `SCPAY-{n}`; hanya row yang terbukti memiliki pasangan `SCPAY-SC-{sport_center_payment_id}` identik dan belum `posted` yang aman dihapus. Row `posted` harus tetap untuk review manual agar jejak accounting tidak rusak.

**How to apply:** Audit dulu berdasarkan suffix payment, canonical payment, booking, nominal, metode, dan status. Sebelum DELETE, pastikan kandidat tepat satu, tidak `posted`, tidak memiliki `accounting_payments`, dan pasangan canonical baru ada. Jalankan DELETE dalam satu transaksi dengan guard row-count, lalu verifikasi pasangan baru dan sisa duplikat.

Live production can contain legacy mirrors marked `posted` with stale or unresolved accounting-payment pointers. A missing current accounting row does not make a posted mirror safe to delete; preserve it until its financial history is explicitly migrated or archived.

**Why:** The duplicate-match cleanup found that posted legacy mirrors can outlive their accounting-payment rows, so pointer resolution alone cannot prove that deleting the mirror is financially harmless.

**How to apply:** Clean candidate reconciliation rows separately, and require a dedicated accounting-owner review before deleting any posted legacy `sport_payments` mirror.