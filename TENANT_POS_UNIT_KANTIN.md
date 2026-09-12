# Tenant POS — Unit Kantin

## Konsep

Modul **Tenant POS** adalah sistem manajemen penyewaan unit kantin untuk dua lokasi:

- **Sport Center** (company_id = 1)
- **TOD M1** (company_id = 2)

### Perbedaan Lokasi vs Unit Kantin

| Konsep | Keterangan |
|---|---|
| **Lokasi** | Sport Center atau TOD M1. Direpresentasikan oleh `company_id`. |
| **Unit Kantin** | Booth, storage, area kasir, dll. **di dalam** suatu lokasi. Bukan lokasi baru. |

> ⚠️ **Jangan** membuat lokasi baru bernama "Kantin Sport Center" atau "Kantin TOD M1".
> Kantin adalah **unit/area** di dalam lokasi, bukan lokasi tersendiri.

---

## Skema Database

### Tabel Baru: `tenant_units`

```sql
CREATE TABLE tenant_units (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL DEFAULT 1,   -- 1=Sport Center, 2=TOD M1
  unit_code      TEXT NOT NULL,                -- SC-KTN-01, TOD-KTN-01, dst
  name           TEXT NOT NULL,                -- Booth Makanan 01
  area_name      TEXT NOT NULL,                -- Area Kantin, Area Belakang, dst
  unit_type      TEXT NOT NULL,                -- food_booth, beverage_booth, dst
  area_sqm       NUMERIC(8,2),
  monthly_rate   NUMERIC(14,2),
  status         TEXT NOT NULL DEFAULT 'available',
  notes          TEXT,
  position_x     INTEGER NOT NULL DEFAULT 0,   -- Posisi di denah
  position_y     INTEGER NOT NULL DEFAULT 0,
  width          INTEGER NOT NULL DEFAULT 100,
  height         INTEGER NOT NULL DEFAULT 80,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UNIQUE INDEX: (company_id, unit_code)  -- kode unit unik per lokasi
```

### Kolom Baru: `tenant_bookings.unit_id`

```sql
ALTER TABLE tenant_bookings ADD COLUMN unit_id INTEGER REFERENCES tenant_units(id);
```

- Booking lama: `unit_id = NULL`, tampilkan `requested_area` (backward compatible)
- Booking baru: dianjurkan pilih unit, `unit_id` terisi, `requested_area` auto-fill

### Tabel Baru: `tenant_audit_logs`

```sql
CREATE TABLE tenant_audit_logs (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER,
  entity_type  TEXT NOT NULL,     -- tenant_unit, tenant_booking, dst
  entity_id    INTEGER,
  action       TEXT NOT NULL,     -- tenant_unit_created, tenant_unit_updated, dst
  actor_id     TEXT,
  actor_name   TEXT,
  before_data  JSONB,
  after_data   JSONB,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Nilai Enum / Konstanta

### unit_type
| Nilai | Label |
|---|---|
| `food_booth` | Booth Makanan |
| `beverage_booth` | Booth Minuman |
| `shared_kitchen` | Dapur Bersama |
| `storage` | Storage |
| `cashier_area` | Area Kasir |
| `seating_area` | Area Duduk |
| `other` | Lainnya |

### status
| Nilai | Keterangan |
|---|---|
| `available` | Tersedia untuk disewa |
| `occupied` | Sedang ditempati (ada booking aktif) |
| `maintenance` | Sedang diperbaiki, tidak bisa dibooking |
| `inactive` | Nonaktif (soft delete) |

### area_name (predefined, bisa dikustom)
- Area Kantin
- Area Belakang
- Area Kasir
- Area Duduk
- Area Luar

---

## Seed Data Default

Tersedia secara otomatis saat server pertama kali dijalankan (idempotent):

| Lokasi | Kode | Nama | Area | Jenis |
|---|---|---|---|---|
| Sport Center | SC-KTN-01 | Booth Makanan 01 | Area Kantin | food_booth |
| Sport Center | SC-KTN-02 | Booth Minuman 01 | Area Kantin | beverage_booth |
| Sport Center | SC-KTN-03 | Storage Area | Area Belakang | storage |
| TOD M1 | TOD-KTN-01 | Booth Makanan 01 | Area Kantin | food_booth |
| TOD M1 | TOD-KTN-02 | Booth Minuman 01 | Area Kantin | beverage_booth |
| TOD M1 | TOD-KTN-03 | Storage Area | Area Belakang | storage |

---

## API Endpoints

Base URL: `/api/tenant/units`

| Method | URL | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/tenant/units` | admin/owner/manager/finance | List unit dengan filter |
| GET | `/api/tenant/units/:id` | admin/owner/manager/finance | Detail unit + jumlah booking aktif |
| POST | `/api/tenant/units` | admin/owner | Tambah unit baru |
| PUT | `/api/tenant/units/:id` | admin/owner | Update unit |
| DELETE | `/api/tenant/units/:id` | admin/owner | Soft delete (status → inactive) |

### Query Parameters (GET /units)
- `companyId` — filter berdasarkan lokasi (1=Sport Center, 2=TOD M1)
- `area_name` — filter area
- `unit_type` — filter jenis unit
- `status` — filter status (`all`, `available`, `occupied`, `maintenance`, `inactive`)
- `search` — cari berdasarkan unit_code atau name

### Rules API
1. Semua request wajib filter `company_id` (otomatis dari session atau query param)
2. DELETE ditolak jika masih ada booking aktif (status != cancelled)
3. POST booking dengan unit maintenance/inactive → 400 error
4. POST booking dengan unit yang overlap tanggal → 409 error
5. Saat booking dibuat dengan unit, status unit otomatis berubah ke `occupied`
6. Saat booking dihapus, status unit kembali ke `available` (jika tidak ada booking aktif lain)

---

## Frontend

### Menu Tenant POS
```
/tenant/dashboard        Dashboard Tenant POS
/tenant/tenants          Data Tenant
/tenant/units            Unit Kantin   ← BARU
/tenant/bookings         Penyewaan
/tenant/payments         Pembayaran Sewa
```

### Halaman Unit Kantin (`/tenant/units`)

**Tab 1 — Tabel Unit:**
- Filter: Lokasi, Area, Jenis Unit, Status, Search
- Kolom: Lokasi, Kode Unit, Nama Unit, Area, Jenis, Luas m², Tarif Bulanan, Status, Aksi
- Aksi: Edit, Nonaktifkan

**Tab 2 — Denah Unit:**
- Filter: Lokasi, Area
- Visualisasi kotak unit berdasarkan `position_x`, `position_y`, `width`, `height`
- Warna berdasarkan status:
  - `available` → hijau
  - `occupied` → biru
  - `maintenance` → kuning
  - `inactive` → abu gelap
- Klik unit → tampilkan panel detail di samping

**Form Tambah/Edit:**
- Lokasi, Kode Unit, Nama Unit, Area, Jenis Unit, Luas m², Tarif Bulanan, Status, Catatan
- Pengaturan Denah (collapsible): Posisi X, Posisi Y, Lebar, Tinggi
- **Tidak ada field lantai/floor**

---

## Cara Menambah Unit

1. Buka menu **Tenant POS → Unit Kantin**
2. Klik tombol **Tambah Unit**
3. Pilih **Lokasi** (Sport Center / TOD M1)
4. Isi **Kode Unit** (contoh: `SC-KTN-04`)
5. Isi **Nama Unit**, **Area**, **Jenis Unit**, **Luas m²**, **Tarif Bulanan**
6. Set **Status** (default: Tersedia)
7. Opsional: buka **Pengaturan Denah** untuk atur posisi di peta visual
8. Klik **Tambah Unit**

---

## Cara Memakai Unit di Booking

1. Buka **Tenant POS → Penyewaan → Buat Penyewaan**
2. Pilih **Penyewa**
3. Di dropdown **Unit Kantin**, pilih unit yang tersedia
   - Field "Area / Lokasi" akan terisi otomatis dari kode + nama unit
   - "Nilai Sewa" akan terisi dari tarif unit (bisa diubah manual)
4. Set tanggal mulai/selesai
5. Klik **Simpan**

> **Unit maintenance / inactive** tidak akan muncul di dropdown booking.
> Jika semua unit terisi, dropdown menampilkan "Tidak ada unit tersedia".

---

## Backward Compatibility — Booking Lama

Booking yang dibuat **sebelum FASE 2** tidak memiliki `unit_id`. Data ini tetap ditampilkan dengan menggunakan field `requested_area` lama. Tidak ada data yang hilang.

Tampilan di tabel Penyewaan:
- Jika `unit_id` ada → tampilkan badge kode unit + nama unit
- Jika `unit_id` NULL → tampilkan `requested_area` teks lama

---

## Audit Log

Setiap operasi unit dicatat ke tabel `tenant_audit_logs`:

| Action | Kapan |
|---|---|
| `tenant_unit_created` | Saat unit baru dibuat |
| `tenant_unit_updated` | Saat unit diupdate |
| `tenant_unit_deactivated` | Saat unit dinonaktifkan (soft delete) |
| `tenant_booking_unit_assigned` | Saat booking dibuat dengan unit_id |

Log menyimpan: `company_id`, `entity_id`, `actor_id`, `actor_name`, `before_data`, `after_data`, `ip_address`.

---

## Hak Akses

| Role | Baca | Tambah/Edit | Hapus/Nonaktifkan |
|---|---|---|---|
| admin | ✅ | ✅ | ✅ |
| owner | ✅ | ✅ | ✅ |
| manager | ✅ | ❌ | ❌ |
| finance | ✅ | ❌ | ❌ |
| cashier | ❌ | ❌ | ❌ |

---

## Fase Pengembangan Selanjutnya

- **FASE 3** — Invoice Tenant (generate invoice PDF dari booking)
- **FASE 4** — POS Tenant (kasir per unit, produk per unit, transaksi harian)
- **FASE 5** — Rekap Tenant, Rekap Pembayaran, Perbandingan Lokasi
