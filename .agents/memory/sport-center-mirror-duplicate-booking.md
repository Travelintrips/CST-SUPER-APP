---
name: Sport Center mirror duplicate booking
description: Trigger payment mirror memilih public booking terbaru berdasarkan sc_booking_id dan dapat salah menghubungkan payment saat duplicate booking publik ada.
---

## Rule
Satu `sport_center.sport_bookings.id` harus memiliki satu booking mirror publik yang canonical sebelum payment mirror dibuat. Duplicate `public.sport_bookings.sc_booking_id` dapat membuat `sport_center.mirror_confirmed_payment_to_public()` memilih booking terbaru yang bukan booking operasional sebenarnya.

**Why:** Trigger mirror memakai `ORDER BY public.sport_bookings.id DESC LIMIT 1`; payment tetap bisa memperoleh accounting entry yang valid secara teknis tetapi dengan nominal dan booking yang salah.

**How to apply:** Validasi uniqueness `sc_booking_id` sebelum posting, jangan membuat entry baru untuk memperbaiki relasi posted yang salah, dan gunakan void/reversal terkontrol lalu posting ulang setelah booking mirror canonical ditetapkan.