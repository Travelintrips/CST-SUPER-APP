---
name: Production accounting orphan audit
description: Relasi final-state akuntansi PROD harus dibuktikan lewat entry transaksi dan sumber kanonis, bukan master journal atau legacy source tag.
---

Status `posted` pada `accounting_payments` hanya valid bila `entry_id` menunjuk `accounting_entries` yang ada; `journal_id` dapat hanya menunjuk master journal dan bukan jurnal transaksi.

**Why:** Audit PROD menemukan payment posted tanpa entry transaksi tetapi dengan master journal yang valid. Menganggap master journal sebagai bukti posting dapat menyembunyikan orphan.

**How to apply:** Untuk payment final, verifikasi `entry_id`, sumber operasional, dan entry balance secara terpisah. Untuk `accounting_entries.source='purchase_bill'`, cek `vendor_invoices.journal_entry_id` sebelum menyatakan orphan karena `purchase_documents` adalah legacy mapping dan dapat memicu false positive.