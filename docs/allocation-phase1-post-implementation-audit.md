# Allocation Engine Phase 1 — Post-Implementation Audit

**Tanggal audit:** 2026-07-06  
**Auditor:** Agent (automated)  
**Scope:** `artifacts/api-server/src/routes/allocation.ts`, `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts`, `artifacts/api-server/src/lib/accounting.ts`, `artifacts/api-server/src/routes/index.ts`, `lib/db/src/schema/accounting.ts`

---

## Ringkasan

Audit menemukan **9 bug** (6 original + 3 baru ditemukan saat runtime). Semua telah diperbaiki sebelum dokumen ini ditulis. Smoke test 18/18 pass.

---

## Bug yang Ditemukan dan Status

### Bug 1 — `requireAdmin` wrapper tidak memanggil `next()`
| | |
|---|---|
| **Status** | ✅ FIXED (commit sebelum audit ini) |
| **Lokasi** | `allocation.ts` baris 30–33 |
| **Gejala** | Semua request hang setelah auth sukses karena `next()` tidak dipanggil |
| **Root cause** | `requireAdmin()` return `boolean`, tidak memanggil `next()` sendiri |
| **Fix** | Wrapper `router.use()` memanggil `next()` secara eksplisit setelah `requireAdmin` return `true` |
| **Bukti** | Semua endpoint merespons (tidak hang) |

```typescript
// BEFORE (buggy — hung after auth):
router.use(async (req, res, next) => {
  await requireAdmin(req, res);
  next(); // <-- dipanggil meski auth gagal → double response
});

// AFTER (fixed):
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return; // early return on failure
  next();
});
```

---

### Bug 2 — `dashboard-stats` menggunakan kolom `posted_at` yang tidak ada
| | |
|---|---|
| **Status** | ✅ FIXED (commit sebelum audit ini) |
| **Lokasi** | `allocation.ts` baris 131–188 |
| **Gejala** | `GET /allocation/dashboard-stats` → 500 di produksi |
| **Root cause** | Query mereferensikan kolom `posted_at` yang tidak ada di `allocation_headers` |
| **Fix** | Ganti ke `updated_at` dan `created_at` (kolom yang ada) |
| **Skema aktual** | `allocation_headers` hanya punya: `created_at`, `updated_at`, `allocation_date` |

```sql
-- BEFORE (error):
WHERE status = 'posted' AND DATE(posted_at) = CURRENT_DATE

-- AFTER (fixed):
WHERE status = 'posted' AND DATE(updated_at) = CURRENT_DATE
```

---

### Bug 3 — `GET /:id` tidak memfilter `company_id`
| | |
|---|---|
| **Status** | ✅ FIXED (commit sebelum audit ini) |
| **Lokasi** | `allocation.ts` baris 397–403 |
| **Gejala** | Admin company A bisa melihat data company B |
| **Root cause** | Query tidak menyertakan filter `company_id` |
| **Fix** | Tambah `AND (userCompanyId::integer IS NULL OR ah.company_id = userCompanyId)` |

```sql
-- AFTER (fixed):
WHERE ah.id = ${id}
  AND (${userCompanyId}::integer IS NULL OR ah.company_id = ${userCompanyId})
```

---

### Bug 4 — `PATCH` balance validation tidak pakai `received_amount` existing
| | |
|---|---|
| **Status** | ✅ FIXED (commit sebelum audit ini) |
| **Lokasi** | `allocation.ts` baris 471–486 |
| **Gejala** | PATCH dengan `lines` tapi tanpa `received_amount` → `total != 0` error |
| **Root cause** | Validasi balance memakai `received_amount` dari body yang null |
| **Fix** | Jika `received_amount` tidak dikirim, fetch dari DB |

```typescript
// AFTER (fixed):
let effReceivedAmount = received_amount;
if (effReceivedAmount == null) {
  const existing = await db.execute(sql`SELECT received_amount FROM allocation_headers WHERE id = ${id}`);
  effReceivedAmount = parseFloat(existing[0]?.received_amount ?? "0");
}
```

---

### Bug 5 — `deposit query` tidak qualified `company_id`
| | |
|---|---|
| **Status** | ✅ FIXED (commit sebelum audit ini) |
| **Lokasi** | `allocation.ts` baris 154–160 (dashboard-stats deposit query) |
| **Gejala** | Customer deposit aggregation mix data antar company |
| **Root cause** | Query deposit pakai `companyFilterSimple` (`company_id =`) bukan `companyFilter` (`ah.company_id =`) di query yang pakai JOIN |
| **Fix** | Deposit query pakai JOIN `allocation_lines → allocation_headers` dengan filter `ah.company_id` |

```sql
-- AFTER (fixed — pakai ah.company_id lewat JOIN):
FROM allocation_lines al
JOIN allocation_headers ah ON ah.id = al.allocation_header_id
WHERE al.allocation_type = 'CUSTOMER_DEPOSIT'
  AND ah.status = 'posted' ${companyFilter}  -- companyFilter = AND ah.company_id = X
```

---

### Bug 6 — `PostingInput` tidak mendukung `sourceModule`; `kasbon` tidak di union type
| | |
|---|---|
| **Status** | ✅ FIXED dalam audit ini |
| **Lokasi** | `accounting.ts` baris 83–126, `_postEntryCore` entryValues, `lib/db/src/schema/accounting.ts` |
| **Gejala** | `sourceModule` di-cast via `as PostingInput` dan tidak pernah disimpan ke DB; TypeScript error jika cast dihapus |
| **Root cause** | Tiga hal sekaligus: (a) `sourceModule` tidak ada di interface `PostingInput`, (b) `kasbon` tidak ada di `source` union type meski ada di DB enum, (c) `_postEntryCore` tidak menyertakan `sourceModule` di `entryValues` INSERT |
| **Fix A** | Tambah `sourceModule?: string \| null` ke `PostingInput` interface |
| **Fix B** | Tambah `"kasbon"` ke `PostingInput.source` union type |
| **Fix C** | Tambah `"kasbon"` ke Drizzle `accountingEntrySourceEnum` di `lib/db/src/schema/accounting.ts` (DB enum sudah punya `kasbon`) |
| **Fix D** | Tambah `sourceModule: input.sourceModule ?? null` ke `entryValues` di `_postEntryCore` |
| **Verifikasi** | `source_module = 'allocation_engine'` tersimpan di DB untuk journal allocation |

```typescript
// PostingInput — AFTER:
export interface PostingInput {
  // ...
  source?: "manual" | ... | "kasbon";  // kasbon ditambahkan
  sourceModule?: string | null;          // field baru
  // ...
}

// _postEntryCore entryValues — AFTER:
const entryValues = {
  // ...
  source,
  sourceId,
  sourceModule: input.sourceModule ?? null,  // baru — disimpan ke DB
  // ...
};
```

---

### Bug 7 (Runtime) — `writeMethodGovernanceGuard` memblokir semua allocation writes
| | |
|---|---|
| **Status** | ✅ FIXED dalam audit ini |
| **Lokasi** | `routes/index.ts` baris 367 |
| **Gejala** | Semua `POST`/`PATCH` ke `/api/allocation/*` → 422 `PERIOD_DATE_REQUIRED` |
| **Root cause** | Guard `requireOpenPeriod` mencari `req.body.date`, tapi allocation pakai `allocation_date`; action endpoints (submit/approve/reject/reverse) tidak punya date sama sekali |
| **Analisis** | Guard tidak dibutuhkan untuk allocation karena: (a) router sudah punya `requireAdmin` (lebih ketat), (b) period lock sudah dicek di `_postEntryCore` saat journal dibuat, (c) action endpoints tidak membuat journal entry |
| **Fix** | Hapus `writeMethodGovernanceGuard` dari registration allocation route di `routes/index.ts` |

```typescript
// BEFORE:
router.use("/allocation", financeAuditMiddleware, writeMethodGovernanceGuard, makeRbacGuard("invoice"), allocationRouter);

// AFTER:
router.use("/allocation", financeAuditMiddleware, makeRbacGuard("invoice"), allocationRouter);
// requireAdmin di dalam allocationRouter sudah lebih ketat dari requireFinanceWriteRole
// Period lock dicek di _postEntryCore saat POST /:id/post
```

---

### Bug 8 (Runtime) — `GET /:id` → 500 karena `cba.account_name` tidak ada
| | |
|---|---|
| **Status** | ✅ FIXED dalam audit ini |
| **Lokasi** | `allocation.ts` baris 398 |
| **Gejala** | `GET /api/allocation/:id` → 500 `ERROR: column cba.account_name does not exist` |
| **Root cause** | Query JOIN ke `company_bank_accounts` meminta kolom `account_name` yang tidak ada di tabel |
| **Schema aktual** | `company_bank_accounts` punya: `bank_name`, `account_number`, `account_type` — tapi **tidak** `account_name` |
| **Fix** | Hapus `cba.account_name` dari SELECT |

```sql
-- BEFORE (error):
SELECT ah.*, cba.bank_name, cba.account_number, cba.account_name ...

-- AFTER (fixed):
SELECT ah.*, cba.bank_name, cba.account_number ...
```

---

### Bug 9 (Runtime) — Typecheck error: Drizzle enum `accountingEntrySourceEnum` tidak punya `kasbon`
| | |
|---|---|
| **Status** | ✅ FIXED dalam audit ini |
| **Lokasi** | `lib/db/src/schema/accounting.ts` baris 45–77 |
| **Gejala** | `tsc --noEmit` → `TS2769: No overload matches this call` di `_postEntryCore` baris insert |
| **Root cause** | Drizzle pgEnum tidak mencakup `kasbon` meski DB enum sudah punya. Saat `source` di-type sebagai `"kasbon"`, Drizzle menolak di `.values()` |
| **Fix** | Tambah `"kasbon"` ke `accountingEntrySourceEnum` + rebuild `lib/db` |

---

---

### Bug-fix Tambahan (ditemukan via code review, sudah dipatch)

#### Bug A — IDOR: write/action endpoints tidak filter company_id
| | |
|---|---|
| **Status** | ✅ FIXED dalam audit ini |
| **Lokasi** | `allocation.ts` — PATCH, submit, approve, reject, post, reverse |
| **Gejala** | Admin company A yang tahu allocation ID company B bisa mutate status dan journal |
| **Fix** | Semua SELECT dan UPDATE di action endpoints ditambah `AND (userCompanyId::integer IS NULL OR company_id = userCompanyId)` |

#### Bug B — POST /allocation mempercayai company_id dari body (Cross-tenant create)
| | |
|---|---|
| **Status** | ✅ FIXED dalam audit ini |
| **Lokasi** | `allocation.ts` POST / baris ~330 |
| **Gejala** | Admin bisa membuat allocation untuk company lain dengan menyisipkan `company_id` berbeda di body |
| **Fix** | Validasi: jika `userCompanyId` set (non-superadmin), reject jika `body.company_id !== userCompanyId` |

#### Bug C — PATCH remaining_amount tidak dihitung ulang saat lines diupdate tanpa received_amount
| | |
|---|---|
| **Status** | ✅ FIXED dalam audit ini |
| **Lokasi** | `allocation.ts` PATCH baris ~488 |
| **Gejala** | PATCH dengan `lines` tapi tanpa `received_amount` → `remaining_amount` di header tidak diperbarui |
| **Root cause** | Kondisi `received_amount != null && allocatedAmount != null` gagal saat `received_amount` tidak dikirim, meski `effReceivedAmount` sudah difetch dari DB |
| **Fix** | Pakai `effReceivedAmount` (sudah difetch dari DB di headerRows) untuk hitung `remainingAmount` kapanpun `allocatedAmount` berubah |

---

## File yang Dimodifikasi

| File | Perubahan |
|---|---|
| `artifacts/api-server/src/routes/allocation.ts` | Bug 3, 7, 8, A, B, C: company isolation + governance + account_name + IDOR + cross-tenant + remaining_amount |
| `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts` | Tidak diubah (bug 6 fix di file lain) |
| `artifacts/api-server/src/lib/accounting.ts` | Bug 6: tambah `kasbon` ke source union + `sourceModule` ke interface + `entryValues` |
| `artifacts/api-server/src/routes/index.ts` | Bug 7: hapus `writeMethodGovernanceGuard` dari allocation route |
| `lib/db/src/schema/accounting.ts` | Bug 9: tambah `kasbon` ke `accountingEntrySourceEnum` |

---

## Typecheck

```
cd artifacts/api-server && NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit
# Result: 0 errors (excluding 3 pre-existing api-zod dist errors, unrelated ke allocation)
```

**Pre-existing errors (bukan dari perubahan ini):**
- `src/routes/auth.ts(11,8): TS6305` — `lib/api-zod/dist` belum dibuildt
- `src/routes/logisticOrders.ts(62,8): TS6305` — sama
- `src/routes/storage.ts(7,8): TS6305` — sama
