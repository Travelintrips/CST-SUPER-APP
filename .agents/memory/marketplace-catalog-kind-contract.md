---
name: Marketplace catalog kind contract
description: Dual legacy/template classification rules for public vendor catalog visibility
---

`vendor_catalog_items` memiliki dua classifier: legacy `type` dan template-engine `template_kind`. Keduanya harus ditulis sinkron. Untuk legacy rows yang eksplisit `type='product'` tetapi `template_kind='service'`, resolver publik harus memperlakukan row sebagai produk sampai data dinormalisasi; jangan menghapus filter supplier/publication.

**Why:** Pada 15 Agustus 2026, produk Cabai Merah berstatus published dan supplier eligible, tetapi tersembunyi karena `type='product'` berlawanan dengan `template_kind='service'` sementara UI hanya meminta `kind=product`.

**How to apply:** Semua create/update catalog path harus mengisi kedua field dengan classifier yang sama. Query Marketplace product boleh memakai legacy `type='product'` sebagai compatibility path, dan perbaikan data existing harus memakai guard ID/vendor/nama/tanggal/status serta transaksi.