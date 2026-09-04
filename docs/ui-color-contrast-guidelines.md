# Panduan Kontras Warna UI BizPortal

## Tujuan

BizPortal menggunakan latar gelap sebagai tema utama. Teks yang memakai warna Tailwind
gelap (`*-950`, `*-900`, `*-800`, dan sebagian `*-700`) akan sulit dibaca jika
diletakkan di atas panel gelap atau latar berwarna gelap.

## Aturan wajib

1. Teks normal harus memiliki rasio kontras minimal **4.5:1** terhadap latarnya.
   Teks besar minimal **3:1**.
2. Untuk teks utama gunakan token semantik:
   - `text-foreground`
   - `text-card-foreground`
   - `text-muted-foreground` hanya untuk teks sekunder
3. Untuk panel status berwarna, gunakan pasangan terang:
   - amber: `text-amber-200` sampai `text-amber-300`
   - orange: `text-orange-200` sampai `text-orange-300`
   - red: `text-red-200` sampai `text-red-300`
   - green/emerald: `text-green-200` sampai `text-green-300` atau `text-emerald-200` sampai `text-emerald-300`
4. Jangan memakai `text-amber-950`, `text-orange-950`, atau warna `*-900`/`*-800`
   untuk teks di panel gelap kecuali ada override terang yang eksplisit.
5. Jangan hanya mengandalkan `dark:text-*`. Tema aplikasi memiliki warna gelap di
   `:root`, sementara class `.dark` dapat tidak terpasang pada setiap jalur render.
   Untuk warna utility yang dipakai lintas halaman, tambahkan mapping di
   `artifacts/bizportal/src/index.css`.
6. Setiap kombinasi status baru harus diperiksa dalam dua keadaan:
   - latar normal/terang jika komponen mendukungnya;
   - latar gelap BizPortal, termasuk teks kecil, label, badge, dan hover state.

## Contoh aman

```tsx
<div className="border border-orange-800 bg-orange-950/40 text-orange-100">
  Dasar review manual
</div>
```

Untuk komponen yang memakai utility light-mode yang dipetakan global:

```tsx
<div className="border-orange-200 bg-orange-50 text-orange-800">
  {/* index.css memetakan bg dan teks ini ke pasangan gelap/terang BizPortal */}
</div>
```

Tetap pilih `text-orange-100` atau `text-orange-200` bila teks berada langsung
di atas `bg-orange-950`.

## Checklist sebelum selesai

- Apakah teks masih terbaca saat screenshot diperkecil?
- Apakah teks kecil, kode, metadata, dan hover state ikut memiliki kontras?
- Apakah warna teks berasal dari token semantik atau pasangan warna terang?
- Apakah halaman dirender tanpa class `.dark`? Jika ya, jangan bergantung pada
  `dark:text-*` saja.
- Jalankan build/typecheck BizPortal dan lakukan pemeriksaan visual pada kartu,
  alert, badge, dialog, dan tabel yang berubah.

## Referensi implementasi

- Theme tokens dan mapping utility: `artifacts/bizportal/src/index.css`
- Contoh kartu rekonsiliasi bank: `artifacts/bizportal/src/pages/accounting/bank-reconciliation.tsx`