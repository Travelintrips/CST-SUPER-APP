---
name: Authenticated runtime proof contract
description: Kontrak non-obvious untuk bukti HTTP sync Sheet dan posting Sport Center di development.
---

Bukti runtime harus membedakan jumlah row sumber Sheet dari jumlah row unik yang dipersist. Satu Sheet dapat memiliki row valid yang berbagi mutation/canonical identity, sehingga `total` sync lebih besar daripada jumlah `bank_mutations` unik. Endpoint daftar mutasi bersifat company-scoped dan tidak selalu mengembalikan `sheet_config_id`.

**Why:** Proof awal mengasumsikan 45 row tetap dan memfilter field yang tidak dikembalikan endpoint; runtime aktual memiliki 46 row sumber tetapi 45 mutation unik. Posting juga ditolak oleh governance sampai `companyId` dan `date` dikirim eksplisit pada body.

**How to apply:** Diagnosis dan sync dibandingkan terhadap source-row count; persisted count dibandingkan terhadap baseline config dan unique mutation keys. Request posting HTTP harus membawa company context serta tanggal transaksi dari payment monitor.