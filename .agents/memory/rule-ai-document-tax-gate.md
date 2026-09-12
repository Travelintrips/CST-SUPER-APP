---
name: Rule AI document and tax gate
description: Durable behavior for mandatory proof uploads and PPN account routing in Rule AI.
---

Rule AI yang menandai dokumen sebagai wajib harus berhenti sebelum matching/posting ketika bukti belum tersedia. Setelah bukti tersedia, rule boleh melanjutkan ke action normal. Bukti bank yang di-upload diproses melalui provider OpenAI yang sudah dimuat dari bundle Secret Manager dan hasil OCR disimpan bersama statusnya; kegagalan OCR tidak menghapus file bukti. PPN Masukan dan PPN Keluaran harus diarahkan ke akun pajak perusahaan yang dikonfigurasi di Accounting Settings; kode standar hanya menjadi fallback yang tervalidasi.

**Why:** Bukti transaksi merupakan prasyarat audit/OCR, bukan sekadar metadata tampilan. Menjadikan OCR sebagai proses setelah Storage upload mempertahankan evidence saat provider timeout/error, sementara mengabaikan konfigurasi akun pajak perusahaan dapat mem-posting ke akun PPN yang salah walaupun kode default terlihat benar.

**How to apply:** Pertahankan gate di evaluator dan Decision Stack, teruskan status bukti dari setiap jalur matching termasuk preview, tampilkan status/hasil OCR yang tersimpan pada detail mutasi, dan sinkronkan metadata dokumen serta tipe pajak ke mirror operasional `recon_rules`.