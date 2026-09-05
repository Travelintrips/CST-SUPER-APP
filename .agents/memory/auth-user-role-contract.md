---
name: Auth user role contract
description: Role dan company context harus dipertahankan pada respons /api/auth/user untuk authorization UI.
---

Respons `/api/auth/user` harus mengekspos `role` dan `companyId` melalui OpenAPI, schema Zod, dan tipe client secara konsisten.

**Why:** Zod object yang tidak mendeklarasikan field tersebut membuang role `admin`, sehingga UI menyembunyikan aksi approval walaupun backend menerima admin.

**How to apply:** Saat menambah aturan UI berbasis role, ubah OpenAPI sebagai sumber kontrak lalu jalankan codegen; jangan hanya menambah field pada object session/server.

Semua jalur login, termasuk dev-login, harus membaca allowlist `ADMIN_EMAIL` dan `ADMIN_EMAILS` yang sama serta menyimpan role yang sama ke session dan profil `/api/users/me`.

**Why:** Perbedaan allowlist membuat session ber-role `ecommerce` sementara profil database ber-role `admin`, sehingga redirect dan header BizPortal tidak konsisten.

**How to apply:** Saat mengubah autentikasi, uji tiga hasil bersama-sama: respons login, `/api/auth/user`, dan `/api/users/me`; jangan menganggap role database saja cukup.

Role yang sudah tersimpan sebagai vendor/driver/employee tidak boleh didemote oleh payload onboarding customer; resolusi role canonical harus dilakukan server-side sebelum menulis profile, status, atau organization context.

**Why:** Form lama dapat membawa default `customer` dan mengarahkan Vendor legacy ke organization completion yang memang ditolak oleh guard customer.

**How to apply:** Saat mengubah `completeOnboarding`, bedakan akun customer baru yang boleh memilih vendor dari role non-customer yang sudah persisted; uji payload tampering dan status onboarding setelah retry.