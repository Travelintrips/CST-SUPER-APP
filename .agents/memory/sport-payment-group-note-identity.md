---
name: Sport payment group note identity
description: Group notes such as GRP identifiers can span multiple legitimate bookings and are not payment uniqueness keys.
---

Note grup pada payment Sport Center merepresentasikan satu payment event untuk beberapa booking schedule ketika group/member membayar satu paket sekaligus. Karena itu audit harus meng-collapse row berdasarkan group note sebelum menghitung jumlah payment ekonomis. Note tetap bukan unique key database; identity provider dan konteks company harus diverifikasi.

**Why:** Audit PROD menemukan `[Grup GRP-43886]` pada empat payment untuk empat booking schedule berbeda. Keempat row bernilai sama dan timestamp-nya sama, sehingga pola tersebut adalah satu pembayaran grup yang tereplikasi, bukan empat pembayaran independen.

**How to apply:** Untuk group note yang valid, bandingkan satu payment event dengan total schedule/booking group dan tandai row tambahan sebagai replicated allocation, bukan payment baru. Jangan menghapus atau menggabungkan posted rows otomatis jika provider identity kosong; gunakan review/repair terkontrol dengan company dan group context.