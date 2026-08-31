---
name: Rule AI import auto-post
description: Semua jalur import mutasi bank harus melewati Decision Stack agar Rule AI dengan COA lengkap dapat auto-post.
---

Setiap jalur yang membuat atau menerima `bank_mutations` wajib menjalankan Decision Stack sebelum matcher umum. Match 100% saja tidak cukup; Rule AI harus membawa COA tujuan dan auto-post harus melewati safeguard jurnal yang sama.

**Why:** Jalur sync Google Sheet dan import legacy sebelumnya hanya menyimpan kandidat `recon_rule` sebagai manual review, sehingga Rule AI yang sudah cocok tidak pernah mencoba membuat jurnal.

**How to apply:** Saat menambah sumber import baru, gunakan `runReconDecisionStack`, `planReferenceCoaAutoPost`, dan `approveAndCreateJournal(..., autoPost=true)`; simpan alasan konkret jika safeguard menahan transaksi.