---
name: Rule AI operational mirror
description: Runtime contract between Rule AI configuration and bank-reconciliation matching.
---

Rule AI yang dibuat dari konfigurasi harus memiliki mirror operasional yang dikelola eksplisit di `recon_rules`; perubahan dan penonaktifan pada Rule AI harus menyinkronkan hanya mirror tersebut, bukan Referensi COA independen.

**Why:** Konfigurasi sebelumnya dapat lulus preview tetapi tidak ikut matcher runtime, terutama bila rule dibuat setelah proses startup sudah melewati migrasi satu kali. Mengubah atau menghapus mirror tampilan juga tidak boleh menonaktifkan rule operasional yang dibuat dari Bank Reconciliation.

**How to apply:** Pertahankan `recon_rules` sebagai sumber runtime. Gunakan link mirror khusus untuk Rule AI dan invalidasi cache rule perusahaan setelah create, update, atau deactivate. Rematch hanya kartu manual review historis tanpa alasan/safeguard tercatat; jangan membuka ulang transaksi yang sudah diblokir safeguard jurnal. Aksi rematch harus terlihat pada kartu historis tersebut meski jumlah `unmatched` nol.