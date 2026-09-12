---
name: QRIS bank-account identity
description: Kontrak identitas rekening yang dipakai oleh QRIS candidate matching
---

QRIS candidate matching harus menormalisasi identitas rekening pada boundary: `company_bank_accounts.id` adalah ID internal, sedangkan `sport_center.sport_payments.bank_account_id` dapat berisi nomor rekening eksternal. Jangan membandingkan keduanya sebagai integer mentah.

**Why:** Pada runtime development, payment QRIS menyimpan `1640006707220`, sementara `bank_mutations.bank_account_id` menyimpan ID `17` untuk rekening yang sama. Strict equality membuat natural batch kosong dan kandidat tidak pernah terbentuk, walaupun provider, tanggal, status, dan nominal payment valid.

**How to apply:** Resolve payment-side external account number ke satu active `company_bank_accounts.id` sebelum dimension matching, atau compare both sides through the same canonical account-number mapping. Fail closed on zero or ambiguous matches.

Canonical `sport_center.sport_payments` tetap menyimpan identitas rekening provider sebagai TEXT; `public.sport_payments`/ledger boundary menyimpan ID internal hasil resolusi unik.

**Why:** Nomor rekening provider dapat lebih besar dari INTEGER dan tidak boleh diganti dengan akun aktif pertama karena itu bisa salah pada company multi-rekening.

**How to apply:** Backfill hanya boleh memulihkan external identity dari mirror atau memetakan ke ID internal jika tepat satu rekening aktif cocok; zero/ambiguous match tetap unresolved.

Manual QRIS approval memakai `company_bank_accounts.id` hanya untuk membuktikan bahwa mutasi public terikat ke rekening aktif milik company yang sama. Canonical settlement group tetap memakai nomor rekening eksternal dari owner-approved config.

**Why:** Supplemental owner, owner-config resolver, advisory-lock identity, dan bank-COA resolver semuanya berkontrak pada nomor rekening config. Menulis ID internal ke payment membuat group mismatch meskipun rekening bisnisnya sama.

**How to apply:** Setelah config dibuktikan melalui join account-number → active internal ID, materialize nomor rekening config ke payment sebelum canonical builder; jangan meneruskan internal mutation account ID sebagai group identity.

Lookup konfigurasi MDR juga wajib memakai boundary identitas rekening yang sama; menyelesaikan rekening setelah query config terlalu terlambat. Bandingkan ID internal dan nomor rekening eksternal payment melalui satu rekening aktif milik company sebelum config owner-approved dianggap tidak tersedia.

**Why:** Di PROD, payment 361 menyimpan ID rekening internal `2`, sedangkan config Mandiri aktif memakai nomor rekening eksternal `1640006707220`; equality mentah menghilangkan MDR 0,7% payment tersebut dan menghasilkan potongan palsu Rp1.400 untuk batch Rp500.000.

**How to apply:** Pertahankan fast path equality mentah, lalu cocokkan kedua representasi melalui rekening aktif yang scope ke company. Jangan memilih rekening sembarang atau wildcard saat mapping kosong/ambigu.

Daftar mutasi juga harus memperlakukan `public.bank_mutations.bank_account_id` sebagai identitas teks pada runtime produksi, walaupun instalasi lama atau deklarasi awal dapat mengasumsikannya sebagai INTEGER.

**Why:** Join langsung ke `company_bank_accounts.id` membuat seluruh endpoint daftar gagal dengan `integer = text`, sementara kartu ringkasan tetap berhasil dan UI terlihat seperti memiliki data tetapi menampilkan nol baris.

**How to apply:** Pada query read-model, scope ke company lalu bandingkan `company_bank_accounts.id::text` dengan nilai mutasi yang sudah di-trim; jangan mengubah tipe atau isi historis hanya untuk merender daftar.