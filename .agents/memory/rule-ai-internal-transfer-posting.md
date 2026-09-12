---
name: Rule AI internal transfer posting
description: Internal Transfer rules must post to the configured destination cash/bank COA with asset treatment.
---

Rule AI dengan `target_type = internal_transfer` harus mengambil `target_coa_code` dari rule yang match dan mempostingnya sebagai treatment `asset`; jangan menginfer akun tujuan hanya dari deskripsi.

**Why:** deskripsi seperti "kas besar" dapat cocok dengan lebih dari satu pola operasional. Mengandalkan normalizer atau fallback expense dapat memilih rekening yang salah dan membuat transfer internal terlihat sebagai beban.

**How to apply:** semua jalur approval dan auto-post yang memakai kandidat `recon_rule` harus meneruskan identitas rule, memvalidasi COA tujuan aktif milik perusahaan, dan fail closed bila COA tidak ada.