# Allocation Engine — Frontend Guide

## Routes BizPortal

| URL                               | Component               | Deskripsi             |
|-----------------------------------|-------------------------|-----------------------|
| `/finance/allocation`             | `AllocationCenterPage`  | Dashboard + tabs      |
| `/finance/allocation/create`      | `AllocationCreatePage`  | Form buat alokasi     |

## Navigation

Menu: **Finance → Allocation Center** (icon: `ArrowLeftRight`)

## AllocationCenterPage (allocation-center.tsx)

Halaman utama dengan 4 tabs:

1. **Dashboard** — 6 stat cards + 10 alokasi terbaru
2. **Outstanding** — Filter draft/submitted/approved + action button inline
3. **Semua** — Full list dengan pagination
4. **History** — Posted/closed/reversed

### Action Buttons di Table

| Status     | Button yang Muncul              |
|------------|--------------------------------|
| draft      | Submit                         |
| submitted  | Approve                        |
| approved   | Post                           |
| posted     | —                              |
| reversed   | —                              |

### Detail Dialog

Klik ikon 👁 untuk membuka detail lengkap:
- Header info (no, tanggal, bank, amount)
- Allocation lines table dengan COA
- Action buttons sesuai status
- Audit trail timeline

## AllocationCreatePage (allocation-create.tsx)

### Header Form Fields

| Field            | Wajib | Keterangan                          |
|------------------|-------|-------------------------------------|
| Tanggal          | Ya    | Date picker                         |
| Bank Account     | Ya    | Dropdown dari `/api/cash-bank/accounts` |
| Received Amount  | Ya    | Input numeric IDR                   |
| Nomor Referensi  | Tidak | No. bukti transfer                  |
| Catatan          | Tidak | Textarea                            |

### Allocation Lines Grid

| Kolom       | Keterangan                                              |
|-------------|--------------------------------------------------------|
| Type        | Dropdown dari 7 tipe allocation                        |
| COA         | Dropdown dari `/api/accounting/accounts` (opsional)    |
| Referensi   | ID dokumen referensi (advance/invoice ID)              |
| Amount      | Numeric IDR                                            |
| Keterangan  | Teks bebas                                             |

### Balance Indicator

Banner hijau/orange menampilkan:
```
✅ Balance OK — Total alokasi Rp X = Received Amount
⚠️ Belum balance — Total Rp X | Received Rp Y | Selisih Rp Z
```

### Save Actions

- **Simpan Draft** → POST /api/allocation (status: draft)
- **Simpan & Submit** → POST create + POST /:id/submit

## Konvensi BizPortal

- `useCompany().activeCompanyId` untuk company context
- `fetch` native dengan `credentials: "include"`
- `Intl.NumberFormat("id-ID")` untuk format angka
- `toast()` dari `@/hooks/use-toast` untuk feedback
- Tidak ada `@/lib/apiClient`, tidak ada `@/stores/companyStore`
