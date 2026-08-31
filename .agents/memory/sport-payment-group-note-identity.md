---
name: Sport payment group note identity
description: Group notes such as GRP identifiers can span multiple legitimate bookings and are not payment uniqueness keys.
---

Note grup pada payment Sport Center adalah label batch/event dan boleh muncul pada banyak payment untuk booking yang berbeda. Duplicate payment harus ditentukan dari `booking_id` lalu diperkuat dengan provider transaction identity, bukan dari note, nominal, atau timestamp saja.

**Why:** Audit PROD menemukan satu note grup yang sama pada empat payment untuk empat booking berbeda, semuanya confirmed dan bernilai sama; menjadikan note sebagai unique key akan menghapus payment yang sah.

**How to apply:** Gunakan note hanya sebagai dimensi audit. Tandai sebagai duplicate/review bila `booking_id` sama dan provider reference/merchant trade/order identity sama; jika provider identity null, tetap fail-closed dan minta review.