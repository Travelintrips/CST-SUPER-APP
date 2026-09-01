---
name: Rule AI document and tax gate
description: Durable behavior for mandatory proof uploads and PPN account routing in Rule AI.
---

Rule AI yang menandai dokumen sebagai wajib harus berhenti sebelum matching/posting ketika bukti belum tersedia. Setelah bukti tersedia, rule boleh melanjutkan ke action normal. PPN Masukan dan PPN Keluaran harus diarahkan ke akun pajak perusahaan yang dikonfigurasi di Accounting Settings; kode standar hanya menjadi fallback yang tervalidasi.

**Why:** Bukti transaksi merupakan prasyarat audit/OCR, bukan sekadar metadata tampilan. Mengabaikan konfigurasi akun pajak perusahaan dapat mem-posting ke akun PPN yang salah walaupun kode default terlihat benar.

**How to apply:** Pertahankan gate di evaluator dan Decision Stack, teruskan status bukti dari setiap jalur matching termasuk preview, dan sinkronkan metadata dokumen serta tipe pajak ke mirror operasional `recon_rules`.