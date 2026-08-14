---
name: QRIS bank-account identity
description: Kontrak identitas rekening yang dipakai oleh QRIS candidate matching
---

QRIS candidate matching harus menormalisasi identitas rekening pada boundary: `company_bank_accounts.id` adalah ID internal, sedangkan `sport_center.sport_payments.bank_account_id` dapat berisi nomor rekening eksternal. Jangan membandingkan keduanya sebagai integer mentah.

**Why:** Pada runtime development, payment QRIS menyimpan `1640006707220`, sementara `bank_mutations.bank_account_id` menyimpan ID `17` untuk rekening yang sama. Strict equality membuat natural batch kosong dan kandidat tidak pernah terbentuk, walaupun provider, tanggal, status, dan nominal payment valid.

**How to apply:** Resolve payment-side external account number ke satu active `company_bank_accounts.id` sebelum dimension matching, atau compare both sides through the same canonical account-number mapping. Fail closed on zero or ambiguous matches.