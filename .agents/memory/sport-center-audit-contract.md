---
name: Sport Center audit integration contract
description: Batas aman integrasi Sport Center dengan accounting, mirror payment, retry, dan settlement.
---

## Rule

Sport Center tetap menjadi source of truth operasional. PostgreSQL trigger menjadi satu-satunya pemilik mirror `public.sport_payments`; worker hanya membaca mirror, memperbaiki `booking_id` yang kosong, dan memproses accounting.

Satu payment sumber boleh memiliki paling banyak satu `accounting_payment` per perusahaan dan sumber. Payment sumber hanya boleh berstatus `posted` setelah `accounting_payments.entry_id` menunjuk ke jurnal yang valid. Jika jurnal gagal, simpan `posting_status='failed'` dan `posting_error` pada payment sumber agar dapat di-retry.

Relasi jurnal tidak perlu menambah `payment_id` ke `accounting_entries`: untuk booking Sport Center, identitas jurnal tetap `source='sport_center_booking'` + `source_id=booking_id`, sedangkan payment accounting menunjuk ke jurnal melalui `entry_id` dan ke payment mirror melalui `source_doc_id`.

Mismatch jumlah atau identitas antar source, mirror, accounting payment, dan jurnal tidak boleh diposting otomatis. Evidence yang belum tersedia atau kegagalan teknis menjadi `failed` dan boleh di-retry; duplicate atau mismatch bisnis menjadi `manual_review` dan tidak boleh masuk retry otomatis.

**Why:** Retry aman hanya untuk kondisi sementara. Mengulang data yang secara bisnis sudah terbukti ambigu atau berbeda dapat membuat mirror/jurnal yang salah terlihat valid.

**How to apply:** Filter worker accounting ke `unposted`/`failed`, validasi semua evidence sebelum source payment menjadi `posted`, dan hentikan pemrosesan mirror pada run yang sama setelah validasi gagal.

**Why:** Audit menemukan duplicate journal dan payment yang terlihat selesai meskipun jurnal gagal. Menulis langsung ke mirror atau menambah relasi paralel akan membuat dua source of truth dan berpotensi bentrok dengan trigger serta journal reuse.

**How to apply:** Pertahankan trigger `SCPAY-SC-{id}`, gunakan canonical posting engine untuk jurnal, enforce uniqueness di database, dan jangan menghapus/mengubah jurnal historis otomatis tanpa exception report serta keputusan reversal/void yang dapat diaudit.

## Follow-up boundary

Jika Sport Center nantinya mendukung cicilan atau beberapa payment untuk satu booking, kontrak booking-level journal harus ditinjau ulang. Jangan mengubah `source_id` menjadi payment ID secara parsial; tetapkan dulu apakah accounting berbasis invoice/receivable atau satu jurnal per payment.

QRIS harus menyimpan gross payment, provider/reference, MDR, dan net settlement secara terpisah. Mutasi settlement agregat harus memiliki relasi settlement eksplisit, bukan dicocokkan hanya dari nominal.

## Runtime company boundary

Pada runtime Supabase development, `sport_center.sport_bookings` tidak menyimpan `company_id`; company booking harus di-resolve dari `facility_id` melalui tepat satu mapping fasilitas yang aktif dan owner-approved. Sinkronisasi booking publik tidak boleh menghardcode company default.

**Why:** Hardcode dapat tampak benar selama semua fasilitas masih berada di perusahaan 1, tetapi akan salah saat fasilitas dipindahkan atau perusahaan kedua ditambahkan.

**How to apply:** Validasi mapping sebelum membuat atau memperbarui `public.sport_bookings`, lalu cocokkan `public.sport_bookings.company_id` dengan hasil mapping dan payment canonical.

Mirror `posting_status='posted'` belum cukup membuktikan accounting selesai. Harus ada `accounting_payment_id` yang valid, `accounting_payments.company_id` yang sama, dan `entry_id` menuju jurnal ber-company sama.

**Why:** Runtime dapat memiliki jurnal `sport_center_payment` yang sudah posted tetapi accounting payment dan relasi balik ke mirror belum terbentuk; status posted tanpa link menciptakan split-brain.

**How to apply:** Saat audit atau validator, cek chain source payment → public mirror → accounting payment → journal secara penuh; jika salah satu link hilang, jangan pertahankan status posted.