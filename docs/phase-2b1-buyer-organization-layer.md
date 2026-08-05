# Phase 2B.1 — Buyer Organization Layer
**Status:** Design Document (Draft)
**Date:** 2026-07-02
**Author:** Replit Agent
**Scope:** Additive — no UI changes, no approval engine, no breaking changes

---

## 1. Konteks & Tujuan

### 1.1 Masalah Saat Ini

```
portal_customers (Phase 2B)
  ├── id, name, email, phone
  ├── company: text  ← freeform string, tidak terstruktur
  └── role: text     ← auth role ('customer'), bukan procurement role

mkt_rfqs (Phase 2B)
  ├── portal_customer_id → portal_customers.id  ✅
  ├── company_id → companies.id                 ← SELALU NULL (belum ada mapping)
  └── buyer_company: text                       ← snapshot dari company string
```

Akibatnya:
- Tidak ada cara mengetahui portal customer mana milik perusahaan ERP mana
- `mkt_rfqs.company_id` tidak pernah terisi → laporan per perusahaan mustahil
- Tidak ada buyer role, department, cost center untuk procurement workflow
- Approval chain tidak bisa dibangun karena tidak ada hierarki buyer

### 1.2 Tujuan Phase 2B.1

1. Buat tabel mapping `portal_company_members` sebagai **jembatan** antara `portal_customers` dan `companies`
2. Daftarkan buyer role, department, cost center, approval level per membership
3. Gunakan mapping untuk **mengisi `mkt_rfqs.company_id`** secara otomatis jika tersedia
4. Tambahkan kolom snapshot buyer context ke `mkt_rfqs` (immutable audit trail)
5. Buat fondasi approval chain (data model only — engine di fase berikutnya)

---

## 2. Review Relationship Existing

### 2.1 `portal_customers` (Auth / Identity Layer)

| Kolom | Tipe | Catatan |
|---|---|---|
| id | serial PK | |
| name | text | nama personal |
| email | text UNIQUE | identity utama |
| phone | text | |
| company | text | **freeform — tidak ada FK** |
| role | text | auth role: 'customer' (bukan procurement role) |
| passwordHash, oauthProvider, oauthId | text | auth fields |

**Gap:** `company` adalah teks bebas. Tidak ada FK ke `companies`.

### 2.2 `companies` (ERP Company Entity)

| Kolom | Tipe | Catatan |
|---|---|---|
| id | serial PK | |
| companyName | text | |
| companyCode | text UNIQUE | kode internal ERP |
| isHolding | boolean | mendukung holding structure |
| parentCompanyId | integer | self-referencing (belum FK constraint di schema) |
| npwp, nib, dll | text | legal/pajak |
| isActive | boolean | |

**Catatan:** `companies` adalah **internal ERP entity** — dipakai di accounting, procurement, HR. Satu company bisa punya banyak `customers` (ERP) dan banyak `suppliers`.

### 2.3 `portal_customer_profiles` (Verifikasi KYB)

Profile ini berisi data **company dari sisi portal customer** (companyName, npwp, nib, picName, dll) untuk proses verifikasi KYB. Ini **bukan** FK ke `companies` — ini user-submitted data yang menunggu verifikasi admin.

**Relationship yang ada:**
```
portal_customer_profiles.customerId → portal_customers.id  (1:1, profile verifikasi)
```

**Relationship yang belum ada:**
```
portal_customers ←→ companies  (TIDAK ADA — inilah yang akan dibuat)
```

### 2.4 ERP Customer vs Portal Customer

| | ERP `customers` | `portal_customers` |
|---|---|---|
| Tujuan | Entitas billing/sales di ERP | User account di portal publik |
| Auth | Tidak ada login | Ada login (email+password/OAuth) |
| Company | `companyId` FK ke `companies` | `company` teks bebas |
| Relasi | Dimiliki oleh companies | Independent |

Keduanya adalah entitas berbeda. Tidak ada FK antar keduanya saat ini, dan **tidak perlu digabung** — melainkan dihubungkan via mapping baru.

---

## 3. ERD — Buyer Organization Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXISTING ENTITIES                            │
│                                                                 │
│  portal_customers          companies (ERP)                      │
│  ┌─────────────────┐       ┌──────────────────────┐            │
│  │ id (PK)         │       │ id (PK)              │            │
│  │ name            │       │ companyName          │            │
│  │ email (UNIQUE)  │       │ companyCode (UNIQUE) │            │
│  │ phone           │       │ isHolding            │            │
│  │ company: text   │       │ parentCompanyId      │            │
│  │ role: text      │       │ npwp, nib, dll       │            │
│  └────────┬────────┘       └──────────┬───────────┘            │
│           │                           │                         │
└───────────┼───────────────────────────┼─────────────────────────┘
            │                           │
            │    NEW: Phase 2B.1        │
            │                           │
            ▼                           ▼
   ┌────────────────────────────────────────────┐
   │         portal_company_members (NEW)       │
   │                                            │
   │  id (PK)                                  │
   │  portal_customer_id → portal_customers.id │
   │  company_id         → companies.id        │
   │                                            │
   │  ── Procurement Identity ──                │
   │  buyer_role       (enum)                  │
   │  department       (text, nullable)        │
   │  cost_center      (text, nullable)        │
   │  approval_level   (integer, nullable)     │
   │  spending_limit   (numeric, nullable)     │
   │                                            │
   │  ── Status & Audit ──                      │
   │  is_active        (boolean)               │
   │  invited_by       → portal_customers.id   │
   │  invited_at       (timestamp)             │
   │  joined_at        (timestamp)             │
   │  created_at       (timestamp)             │
   │  updated_at       (timestamp)             │
   │                                            │
   │  UNIQUE (portal_customer_id, company_id)  │
   └────────────────────────────────────────────┘
                          │
                          │ resolves at RFQ creation (if logged-in)
                          ▼
   ┌────────────────────────────────────────────┐
   │         mkt_rfqs (MODIFIED — additive)     │
   │                                            │
   │  id, rfq_number, status, ...              │
   │  portal_customer_id → portal_customers.id │
   │  company_id         → companies.id  ←NEW  │
   │                                            │
   │  ── Phase 2B.1 Snapshot Columns (NEW) ──   │
   │  buyer_role         (text, nullable)      │
   │  buyer_department   (text, nullable)      │
   │  buyer_cost_center  (text, nullable)      │
   │  buyer_approval_level (integer, nullable) │
   │                                            │
   │  ── Existing Snapshot ──                   │
   │  buyer_name, buyer_email                  │
   │  buyer_phone, buyer_company               │
   └────────────────────────────────────────────┘


Relasi tambahan (untuk context):

  portal_customers ──< portal_customer_profiles   (1:many, KYB)
  companies        ──< customers (ERP)             (1:many, billing)
  companies        ──< suppliers (ERP)             (1:many, vendor)
  companies        ──< mkt_purchase_orders         (1:many, PO)
  companies        ──< portal_company_members      (1:many)  ← NEW
  portal_customers ──< portal_company_members      (1:many)  ← NEW
```

---

## 4. Desain Company Mapping

### 4.1 Tabel: `portal_company_members`

```sql
CREATE TABLE portal_company_members (
  id                  SERIAL PRIMARY KEY,
  portal_customer_id  INTEGER NOT NULL
                        REFERENCES portal_customers(id) ON DELETE CASCADE,
  company_id          INTEGER NOT NULL
                        REFERENCES companies(id) ON DELETE CASCADE,

  -- Procurement identity
  buyer_role          TEXT NOT NULL DEFAULT 'requester',
  department          TEXT,
  cost_center         TEXT,
  approval_level      INTEGER,         -- 1 = self-approve, 2 = needs L1, dst.
  spending_limit      NUMERIC(15, 2),  -- batas nominal per RFQ (NULL = unlimited)

  -- Membership status
  is_active           BOOLEAN NOT NULL DEFAULT true,
  invited_by          INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL,
  invited_at          TIMESTAMP,
  joined_at           TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (portal_customer_id, company_id)
);

-- Indexes
CREATE INDEX pcm_company_idx          ON portal_company_members(company_id);
CREATE INDEX pcm_portal_customer_idx  ON portal_company_members(portal_customer_id);
CREATE INDEX pcm_active_idx           ON portal_company_members(is_active)
  WHERE is_active = true;
```

### 4.2 Enum `buyer_role`

Disimpan sebagai `TEXT` dengan constraint CHECK (bukan pgEnum) supaya extensible tanpa migration DDL:

| Value | Deskripsi |
|---|---|
| `requester` | Default — bisa buat RFQ, tidak bisa approve |
| `procurement` | Bisa buat & track RFQ, bisa set preferred vendor |
| `finance` | Bisa lihat semua RFQ company, approve budget |
| `admin` | Full access untuk company ini di portal |
| `viewer` | Read-only |

Catatan: ini **bukan** auth role di `portal_customers.role` — ini adalah procurement role per membership.

### 4.3 Kardinalitas

```
portal_customers  1 ──< portal_company_members >── 1  companies
```

- Satu portal customer bisa menjadi anggota **banyak perusahaan** (mis. freelance buyer)
- Satu perusahaan bisa punya **banyak portal customer** (mis. tim procurement)
- Membership adalah **unik per pasangan** (portal_customer_id, company_id)

### 4.4 Cara `company_id` Terisi di `mkt_rfqs`

**Sebelum Phase 2B.1:**
```
company_id = NULL (selalu)
```

**Setelah Phase 2B.1 (di dalam newPipelineEnabled gate):**
```
IF portalCustomerId != null:
  membership = SELECT FROM portal_company_members
               WHERE portal_customer_id = portalCustomerId
                 AND is_active = true
               ORDER BY
                 -- Jika lebih dari 1 company (edge case): pilih primary
                 -- Untuk now: ambil yang pertama (created_at ASC)
               LIMIT 1

  IF membership found:
    company_id = membership.company_id
    buyer_role = membership.buyer_role
    buyer_department = membership.department
    buyer_cost_center = membership.cost_center
    buyer_approval_level = membership.approval_level
  ELSE:
    company_id = NULL  (portal customer belum ter-map ke company)
    buyer_role = NULL
    ...

ELSE (guest):
  company_id = NULL, buyer_* = NULL, guestToken generated
```

---

## 5. Kolom Baru di `mkt_rfqs`

```sql
ALTER TABLE mkt_rfqs
  ADD COLUMN IF NOT EXISTS buyer_role          TEXT,
  ADD COLUMN IF NOT EXISTS buyer_department    TEXT,
  ADD COLUMN IF NOT EXISTS buyer_cost_center   TEXT,
  ADD COLUMN IF NOT EXISTS buyer_approval_level INTEGER;
```

### Semantik Snapshot

Kolom-kolom ini adalah **snapshot immutable** dari membership context pada saat RFQ dibuat:

| Kolom | Sumber | Catatan |
|---|---|---|
| `company_id` | `portal_company_members.company_id` | FK ke companies — diisi jika ada mapping |
| `buyer_role` | `portal_company_members.buyer_role` | snapshot, bukan live |
| `buyer_department` | `portal_company_members.department` | snapshot |
| `buyer_cost_center` | `portal_company_members.cost_center` | snapshot |
| `buyer_approval_level` | `portal_company_members.approval_level` | snapshot untuk approval chain reference |

Mengapa snapshot? Jika buyer kemudian di-remove dari company atau role-nya berubah, RFQ yang sudah dibuat tetap punya konteks yang benar pada saat pembuatan.

---

## 6. Migration Impact

### 6.1 File Baru

**`lib/db/drizzle/0016_portal_company_members.sql`**

```sql
-- Phase 2B.1 — Buyer Organization Layer
-- Idempotent migration

-- 1. Tabel portal_company_members
CREATE TABLE IF NOT EXISTS portal_company_members (
  id                  SERIAL PRIMARY KEY,
  portal_customer_id  INTEGER NOT NULL
                        REFERENCES portal_customers(id) ON DELETE CASCADE,
  company_id          INTEGER NOT NULL
                        REFERENCES companies(id) ON DELETE CASCADE,
  buyer_role          TEXT NOT NULL DEFAULT 'requester',
  department          TEXT,
  cost_center         TEXT,
  approval_level      INTEGER,
  spending_limit      NUMERIC(15, 2),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  invited_by          INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL,
  invited_at          TIMESTAMP,
  joined_at           TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (portal_customer_id, company_id)
);

CREATE INDEX IF NOT EXISTS pcm_company_idx
  ON portal_company_members(company_id);
CREATE INDEX IF NOT EXISTS pcm_portal_customer_idx
  ON portal_company_members(portal_customer_id);
CREATE INDEX IF NOT EXISTS pcm_active_idx
  ON portal_company_members(is_active)
  WHERE is_active = true;

-- 2. Tambah buyer context columns ke mkt_rfqs (additive)
ALTER TABLE mkt_rfqs
  ADD COLUMN IF NOT EXISTS buyer_role           TEXT,
  ADD COLUMN IF NOT EXISTS buyer_department     TEXT,
  ADD COLUMN IF NOT EXISTS buyer_cost_center    TEXT,
  ADD COLUMN IF NOT EXISTS buyer_approval_level INTEGER;
```

### 6.2 Drizzle Schema Files

| File | Aksi |
|---|---|
| `lib/db/src/schema/portalCompanyMembers.ts` | **Baru** — Drizzle schema untuk portal_company_members |
| `lib/db/src/schema/mktRfqs.ts` | **Diubah** — tambah 4 kolom buyer context |
| `lib/db/src/schema/index.ts` | **Diubah** — export portalCompanyMembersTable |
| `lib/db/drizzle/0016_portal_company_members.sql` | **Baru** — migration SQL |
| `lib/db/drizzle/meta/_journal.json` | **Diubah** — entry idx: 16 |

### 6.3 Risiko Migration

| Risiko | Mitigasi |
|---|---|
| `ADD COLUMN` di mkt_rfqs (tabel sudah ada data) | `IF NOT EXISTS` — aman, kolom nullable, tidak ada default value conflict |
| `CREATE TABLE` portal_company_members (tabel baru) | `IF NOT EXISTS` — aman di re-run |
| Foreign key ke portal_customers (CASCADE DELETE) | Jika portal customer dihapus, semua membership-nya ikut terhapus — acceptable |
| Foreign key ke companies (CASCADE DELETE) | Jika company ERP dihapus, membership ikut terhapus — acceptable |

---

## 7. Service Impact

### 7.1 `marketplaceRfqService.ts`

**`CreateMktRfqOptions` — tambah field:**

```typescript
export interface CreateMktRfqOptions {
  // ... existing ...
  portalCustomerId?: number | null;   // Phase 2B — sudah ada

  // Phase 2B.1 — Buyer Organization (resolved by caller sebelum createMktRfqEntry)
  companyId?: number | null;          // sudah ada — sekarang bisa terisi
  buyerRole?: string | null;          // NEW
  buyerDepartment?: string | null;    // NEW
  buyerCostCenter?: string | null;    // NEW
  buyerApprovalLevel?: number | null; // NEW
}
```

**INSERT body — tambah kolom:**

```typescript
.values({
  // ... existing ...
  companyId:          opts.companyId ?? null,
  portalCustomerId:   opts.portalCustomerId ?? null,
  buyerRole:          opts.buyerRole ?? null,          // NEW
  buyerDepartment:    opts.buyerDepartment ?? null,    // NEW
  buyerCostCenter:    opts.buyerCostCenter ?? null,    // NEW
  buyerApprovalLevel: opts.buyerApprovalLevel ?? null, // NEW
})
```

**`isGuest` logic — tidak berubah:**

```typescript
const isGuest = !opts.companyId && !opts.portalCustomerId;
```

### 7.2 `portal.ts` — Quote Handler

Perubahan di dalam `if (newPipelineEnabled)` gate (tidak menyentuh legacy path):

```typescript
// Phase 2B: resolve full customer record (sudah ada)
let portalCustomer: ResolvedPortalCustomer | null = null;
// ... existing customer lookup by email ...

// Phase 2B.1: NEW — resolve company membership jika customer ditemukan
let membershipContext: MembershipContext | null = null;
if (portalCustomer) {
  const [membership] = await db
    .select({
      companyId:          portalCompanyMembersTable.companyId,
      buyerRole:          portalCompanyMembersTable.buyerRole,
      department:         portalCompanyMembersTable.department,
      costCenter:         portalCompanyMembersTable.costCenter,
      approvalLevel:      portalCompanyMembersTable.approvalLevel,
    })
    .from(portalCompanyMembersTable)
    .where(and(
      eq(portalCompanyMembersTable.portalCustomerId, portalCustomer.id),
      eq(portalCompanyMembersTable.isActive, true),
    ))
    .orderBy(asc(portalCompanyMembersTable.createdAt))
    .limit(1);

  if (membership) membershipContext = membership;
}

// Panggil service dengan context lengkap
mktRfqResult = await createMktRfqEntry({
  // ... existing ...
  portalCustomerId:   portalCustomer?.id ?? null,
  companyId:          membershipContext?.companyId ?? null,   // NOW FILLED
  buyerRole:          membershipContext?.buyerRole ?? null,
  buyerDepartment:    membershipContext?.department ?? null,
  buyerCostCenter:    membershipContext?.costCenter ?? null,
  buyerApprovalLevel: membershipContext?.approvalLevel ?? null,
});
```

### 7.3 File Service Baru (Opsional untuk Phase 2B.1)

**`portalCompanyMembersService.ts`** — helper untuk admin endpoint:

```typescript
// Fungsi yang disiapkan (bukan diimplementasikan di Phase 2B.1 jika tidak ada endpoint):
addMember(portalCustomerId, companyId, role, dept, costCenter, approvalLevel)
updateMember(memberId, patch)
deactivateMember(memberId)
getCompanyMembers(companyId)
getCustomerMemberships(portalCustomerId)
```

---

## 8. Backward Compatibility

| Scenario | Dampak |
|---|---|
| Guest RFQ (flag off) | ✅ Tidak berubah sama sekali |
| Guest RFQ (flag on, no token) | ✅ Tidak berubah — semua buyer_* NULL, guestToken generated |
| Logged-in RFQ, belum ada membership | ✅ portalCustomerId terisi, company_id = NULL (sama dengan sebelum 2B.1) |
| Logged-in RFQ, ada membership | ✅ portalCustomerId + company_id + buyer_* terisi |
| Portal customer dihapus | ✅ ON DELETE CASCADE → membership ikut terhapus |
| Company ERP dihapus | ✅ ON DELETE CASCADE → membership ikut terhapus |
| `mkt_rfqs` existing rows | ✅ Kolom baru nullable — semua existing rows = NULL |
| Response body API | ✅ Tidak berubah — buyer_* columns tidak diekspos ke client saat ini |
| Legacy `portal_product_orders` write | ✅ Tidak disentuh |

---

## 9. Desain Approval Chain (Draft Only — Engine Tidak Diimplementasikan)

### 9.1 Konsep

```
approval_level di portal_company_members:
  NULL = tidak ada approval requirement
  1    = self-approve (buyer bisa langsung submit RFQ → PO)
  2    = perlu approval L1 (misal: procurement manager)
  3    = perlu approval L1 + L2 (misal: finance director)

spending_limit di portal_company_members:
  NULL            = unlimited (belum dikonfigurasi)
  100_000_000     = max Rp 100 juta per RFQ tanpa approval
```

### 9.2 Tabel Approval Chain (Future Phase — Tidak Dibuat Sekarang)

```sql
-- DRAFT — untuk referensi desain, BELUM diimplementasikan

CREATE TABLE mkt_rfq_approval_requests (
  id                SERIAL PRIMARY KEY,
  rfq_id            INTEGER NOT NULL REFERENCES mkt_rfqs(id),
  approver_level    INTEGER NOT NULL,          -- 1, 2, dst.
  approver_member_id INTEGER REFERENCES portal_company_members(id),
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, delegated
  requested_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  responded_at      TIMESTAMP,
  response_notes    TEXT,
  delegated_to      INTEGER REFERENCES portal_company_members(id),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 9.3 Logika Approval (Future Phase)

```
RFQ dibuat oleh buyer dengan approval_level = 2, amount = Rp 50 juta:

  1. createMktRfqEntry() → mkt_rfqs.status = 'draft'
                         → buyer_approval_level = 2 (snapshot)
  2. Buyer submit RFQ → triggerApprovalChain()
     → Cari approver: SELECT member WHERE company_id = X
                                        AND approval_level = 1
                                        AND buyer_role IN ('procurement', 'finance', 'admin')
     → Insert mkt_rfq_approval_requests (level=1, pending)
     → Notifikasi ke approver
  3. Approver setuju → status level=1 → approved
     → Jika buyer_approval_level > 1: request level=2, dst.
     → Jika semua level approved: mkt_rfqs.status = 'submitted'
  4. Vendor diundang → flow berlanjut ke Phase 2C (Vendor Invitation)
```

### 9.4 Data yang Sudah Disiapkan di Phase 2B.1

| Kolom | Tujuan |
|---|---|
| `portal_company_members.approval_level` | Menentukan berapa level approval yang dibutuhkan buyer ini |
| `portal_company_members.spending_limit` | Threshold yang memicu approval requirement |
| `mkt_rfqs.buyer_approval_level` | Snapshot approval level saat RFQ dibuat |
| `mkt_rfqs.company_id` | Diperlukan untuk query approver dalam company yang sama |

---

## 10. Future Procurement Flow

### 10.1 Complete Flow Post-2B.1

```
[Portal Customer Login]
         │
         ▼
[POST /marketplace/:id/quote]
         │
         ├─ resolve portalCustomer (by token email)
         ├─ resolve membership (portal_company_members)
         │         ├─ company_id → mkt_rfqs.company_id ✅ NOW FILLED
         │         ├─ buyer_role → snapshot
         │         ├─ department → snapshot
         │         └─ cost_center → snapshot
         │
         ├─ createMktRfqEntry()
         │    └─ INSERT mkt_rfqs (fully enriched)
         │
         └─ [legacy dual-write] INSERT portal_product_orders
```

### 10.2 Flow Menuju Vendor Invitation (Phase 2C)

```
mkt_rfqs (fully enriched dengan company_id, buyer_role)
         │
         ├─ Admin review RFQ di BizPortal
         │         └─ Filter by company_id → lihat semua RFQ per perusahaan
         │
         ├─ [Future: Approval Engine]
         │         └─ buyer_approval_level + spending_limit → approval chain
         │
         ├─ mkt_rfqs.status = 'submitted' (after approval / self-approve)
         │
         ├─ [Phase 2C: Vendor Invitation]
         │         └─ Admin pilih vendor → INSERT mkt_vendor_quotes
         │             └─ vendor_id FK to suppliers.id (already exists)
         │
         ├─ Vendor submit quote → mkt_vendor_quotes.status = 'submitted'
         │
         ├─ Admin select winning quote → mkt_rfqs.status = 'awarded'
         │
         └─ [Phase 2D: PO Generation]
                   └─ INSERT mkt_purchase_orders
                       └─ company_id dari mkt_rfqs (now always filled for logged-in)
```

---

## 11. Readiness Menuju Vendor Invitation (Phase 2C)

### 11.1 Yang Sudah Tersedia

| Komponen | Status |
|---|---|
| `mkt_rfqs` dengan `portal_customer_id` | ✅ Phase 2B |
| `mkt_rfqs` dengan `company_id` | ✅ Phase 2B.1 (bisa terisi) |
| `mkt_vendor_quotes` table | ✅ Sudah ada |
| `suppliers` table (vendor ERP) | ✅ Sudah ada |
| `mkt_vendor_quotes.vendor_id` → suppliers | ✅ Sudah ada |
| Vendor notification system | ✅ Sudah ada (vendor_notifications) |
| Vendor JWT (invitation token) | ✅ Sudah ada |
| `mkt_company_settings` (per-company setting) | ✅ Sudah ada |

### 11.2 Yang Dibutuhkan Phase 2C (Vendor Invitation)

| Komponen | Gap |
|---|---|
| Admin endpoint untuk trigger invitation | ❌ Belum ada |
| Vendor selection logic (filter by catalog + capability) | ❌ Belum ada |
| Invitation email template | ❌ Belum ada |
| Vendor portal view untuk submitted quotes | ❓ Perlu review |
| Notifikasi buyer ketika quote masuk | ❌ Belum ada |

### 11.3 Dampak `company_id` di `mkt_rfqs` ke Phase 2C

Dengan `company_id` terisi di Phase 2B.1:
- Admin bisa filter RFQ by company → **siap untuk multi-tenant procurement dashboard**
- `mkt_purchase_orders.company_id` bisa diisi otomatis dari `mkt_rfqs.company_id` → **menghilangkan gap di PO generation**
- Vendor bisa di-restrict per company (mis. preferred vendor list per perusahaan) → **kesiapan contract management**

---

## 12. Implementation Plan (Urutan)

Semua perubahan additive. Tidak ada perubahan destructive atau UI.

```
Step 1: Drizzle Schema
  - lib/db/src/schema/portalCompanyMembers.ts (BARU)
  - lib/db/src/schema/mktRfqs.ts (tambah 4 kolom)
  - lib/db/src/schema/index.ts (export baru)

Step 2: Migration SQL
  - lib/db/drizzle/0016_portal_company_members.sql
  - lib/db/drizzle/meta/_journal.json (entry idx: 16)

Step 3: Build lib/db
  - tsc -p tsconfig.json (verifikasi zero error)

Step 4: Service Layer
  - marketplaceRfqService.ts (extend CreateMktRfqOptions + INSERT)
  - portal.ts (membership lookup di dalam newPipelineEnabled gate)

Step 5: Typecheck
  - Zero new errors

Step 6: Code Review
  - Architect subagent review
```

**Total perkiraan:** ~6 file diubah, 2 file baru, 1 migration, 0 UI change.

---

## 13. Ringkasan Keputusan Desain

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Bridge table vs. column di portal_customers | Bridge table (`portal_company_members`) | Mendukung 1 buyer → banyak company dan sebaliknya |
| buyer_role sebagai TEXT vs pgEnum | TEXT + check constraint | Extensible tanpa DDL migration |
| Snapshot vs. live FK di mkt_rfqs | Snapshot (immutable) | RFQ harus refleksikan context saat dibuat, bukan state saat ini |
| approval_level sebagai integer vs. tabel terpisah | Integer di membership | Approval engine belum diimplementasikan — cukup fondasi |
| spending_limit di portal_company_members | Ada (nullable) | Siapkan fondasi threshold untuk approval engine |
| Enrichment di dalam/luar newPipelineEnabled gate | Di dalam gate | Jaga legacy path identik — pelajaran dari review Phase 2B |
| ON DELETE behavior | CASCADE (membership ikut terhapus) | Data membership tidak berdiri sendiri tanpa parent |
| Multi-company edge case (buyer di 2 company) | Pilih yang paling awal (ORDER BY created_at LIMIT 1) | Sederhana untuk sekarang; bisa dikembangkan dengan "primary membership" flag |
