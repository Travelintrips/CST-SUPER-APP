# Bank Reconciliation — Enterprise Architecture Report
> Baseline: CST Super App · July 2026  
> Scope: Phase 1–14 upgrade (SAP/Oracle/NetSuite parity)  
> Constraint: Backward compatible — accounting engine, posting, reversal, journal, canonical key, Google Sheet Sync tidak diubah.

---

## 1. ARSITEKTUR BARU

### Sebelum (Current State)

```
BankMutation
    └── unifiedMatchingEngine.ts
            ├── accounting_payments
            ├── logistic_orders
            ├── sales_documents (invoice)
            ├── expenses
            ├── sport_payments
            └── tenant_invoices
```

Scoring: Amount(50) + Date(20) + Reference(20) + OCR(5) + Vendor(10) = max 105 (uncapped)

### Sesudah (Target State)

```
BankMutation
    │
    ├── [PHASE 7] RuleEngine          ← Prioritas tertinggi (manual rule)
    │       └── recon_rules table
    │
    ├── [PHASE 1] ExpectedCashFlowEngine   ← Sumber kebenaran utama
    │       └── expected_cash_flows table
    │           ├── Cash In: invoice, dp, tenant, membership, marketplace, refund_vendor, logistic, sport
    │           └── Cash Out: expense, vendor_payment, payroll, talangan, pajak, bpjs, loan, bank_fee, transfer_antar_rek, intercompany
    │
    ├── [PHASE 6] LearningEngine      ← Boosts confidence berdasarkan history
    │       └── recon_learning_patterns table
    │
    ├── [PHASE 3] MultiInvoiceMatcher ← Subset search (knapsack variant)
    │
    ├── [PHASE 4] SplitPaymentMatcher ← Aggregasi partial payments
    │
    └── unifiedMatchingEngine.ts (existing — TIDAK DIUBAH, hanya diperluas)
            └── Scoring baru:
                  Amount(50) + Reference(20*) + DueDate(15) + Date(15) + OCR(dynamic) + Vendor(10) + Learning(bonus)
                  * Reference dinaikkan ke PRIORITAS jika tersedia (Phase 5)
```

### Lapisan Keputusan (Decision Stack)

```
1. Manual Rule Match (recon_rules)          → confidence 1.00, langsung suggest
2. Intercompany Detection (Phase 9)         → auto-create dual journal
3. Expected Cash Flow Match (Phase 1)       → primary candidate pool
4. Multi Invoice / Split Payment (Ph 3,4)   → composite candidates
5. Existing engines (unified, erp, hist)    → fallback (TIDAK DIUBAH)
6. Learning Engine boost (Phase 6)          → confidence modifier
7. Auto Approval Gate (Phase 12)            → approve jika semua kriteria terpenuhi
```

---

## 2. ENTITY BARU

### 2.1 `expected_cash_flows`
Abstraksi semua transaksi yang diperkirakan muncul di rekening.

```typescript
export const expectedCashFlows = pgTable('expected_cash_flows', {
  id:             uuid('id').primaryKey().defaultRandom(),
  companyId:      uuid('company_id').notNull().references(() => companies.id),
  bankAccountId:  uuid('bank_account_id'),          // null = semua rekening
  direction:      text('direction').notNull(),        // 'IN' | 'OUT'
  sourceType:     text('source_type').notNull(),      // enum di bawah
  sourceId:       uuid('source_id').notNull(),        // FK ke tabel asal
  expectedAmount: numeric('expected_amount', { precision: 20, scale: 4 }).notNull(),
  expectedDate:   date('expected_date'),              // null = belum ada due date
  dueDate:        date('due_date'),
  referenceNo:    text('reference_no'),               // invoice no, VA, order no
  counterpartyName: text('counterparty_name'),
  status:         text('status').notNull().default('pending'), // pending|matched|cancelled
  matchedMutationId: uuid('matched_mutation_id'),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

// sourceType enum:
type ExpectedCashFlowSourceType =
  // Cash In
  | 'sales_invoice' | 'customer_payment' | 'down_payment'
  | 'tenant_invoice' | 'membership' | 'marketplace_order'
  | 'refund_vendor' | 'logistic_order' | 'sport_payment'
  // Cash Out
  | 'expense' | 'vendor_payment' | 'payroll'
  | 'cash_advance' | 'tax_payment' | 'bpjs_payment'
  | 'loan_payment' | 'bank_fee'
  | 'interbank_transfer' | 'intercompany_transfer';
```

### 2.2 `recon_rules`
Rule Engine — user dapat membuat rule tanpa coding.

```typescript
export const reconRules = pgTable('recon_rules', {
  id:          uuid('id').primaryKey().defaultRandom(),
  companyId:   uuid('company_id').notNull().references(() => companies.id),
  name:        text('name').notNull(),
  priority:    integer('priority').notNull().default(100), // lebih kecil = lebih tinggi
  isActive:    boolean('is_active').notNull().default(true),
  // Kondisi (AND semua yang diisi)
  condDescContains:   text('cond_desc_contains'),      // case-insensitive
  condDescRegex:      text('cond_desc_regex'),
  condAmountMin:      numeric('cond_amount_min', { precision: 20, scale: 4 }),
  condAmountMax:      numeric('cond_amount_max', { precision: 20, scale: 4 }),
  condDirection:      text('cond_direction'),           // 'IN' | 'OUT' | null=both
  condProviderName:   text('cond_provider_name'),
  // Aksi
  actionSourceType:   text('action_source_type').notNull(), // ExpectedCashFlowSourceType
  actionCoaId:        uuid('action_coa_id'),            // override COA
  actionLabel:        text('action_label'),              // label untuk UI
  actionAutoApprove:  boolean('action_auto_approve').notNull().default(false),
  // Meta
  matchCount:  integer('match_count').notNull().default(0), // statistik
  createdBy:   uuid('created_by'),
  createdAt:   timestamp('created_at').defaultNow(),
  updatedAt:   timestamp('updated_at').defaultNow(),
});
```

### 2.3 `recon_learning_patterns`
Learning Engine — rekam pola approval untuk meningkatkan confidence.

```typescript
export const reconLearningPatterns = pgTable('recon_learning_patterns', {
  id:              uuid('id').primaryKey().defaultRandom(),
  companyId:       uuid('company_id').notNull().references(() => companies.id),
  // Pattern key (normalized)
  patternType:     text('pattern_type').notNull(), // 'counterparty_to_source' | 'desc_token_to_source' | 'amount_range_to_source'
  patternKey:      text('pattern_key').notNull(),  // e.g. "PT PLN → expense:utilities"
  normalizedDesc:  text('normalized_desc'),
  counterpartyName: text('counterparty_name'),
  amountRangeMin:  numeric('amount_range_min', { precision: 20, scale: 4 }),
  amountRangeMax:  numeric('amount_range_max', { precision: 20, scale: 4 }),
  // Target
  targetSourceType: text('target_source_type').notNull(),
  targetCoaId:     uuid('target_coa_id'),
  targetLabel:     text('target_label'),
  // Statistik
  approvalCount:   integer('approval_count').notNull().default(1),
  overrideCount:   integer('override_count').notNull().default(0),
  confidenceBonus: numeric('confidence_bonus', { precision: 5, scale: 2 }).notNull().default('0'),
  // Meta
  lastSeenAt:      timestamp('last_seen_at').defaultNow(),
  createdAt:       timestamp('created_at').defaultNow(),
}, (t) => [uniqueIndex('recon_learning_uk').on(t.companyId, t.patternType, t.patternKey)]);
```

### 2.4 `recon_multi_invoice_groups`
Untuk Multi Invoice Matching (Phase 3).

```typescript
export const reconMultiInvoiceGroups = pgTable('recon_multi_invoice_groups', {
  id:           uuid('id').primaryKey().defaultRandom(),
  mutationId:   uuid('mutation_id').notNull().references(() => bankMutations.id),
  companyId:    uuid('company_id').notNull(),
  totalAmount:  numeric('total_amount', { precision: 20, scale: 4 }).notNull(),
  invoiceIds:   text('invoice_ids').array().notNull(), // JSON array of UUIDs
  sourceTypes:  text('source_types').array().notNull(),
  confidence:   numeric('confidence', { precision: 5, scale: 2 }),
  status:       text('status').notNull().default('pending'), // pending|approved|rejected
  approvedBy:   uuid('approved_by'),
  approvedAt:   timestamp('approved_at'),
  createdAt:    timestamp('created_at').defaultNow(),
});
```

### 2.5 `recon_split_payments`
Untuk Split Payment (Phase 4).

```typescript
export const reconSplitPayments = pgTable('recon_split_payments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  sourceType:  text('source_type').notNull(),
  sourceId:    uuid('source_id').notNull(),   // invoice yang sama
  companyId:   uuid('company_id').notNull(),
  totalExpected: numeric('total_expected', { precision: 20, scale: 4 }).notNull(),
  totalReceived: numeric('total_received', { precision: 20, scale: 4 }).notNull().default('0'),
  remainingAmount: numeric('remaining_amount', { precision: 20, scale: 4 }).notNull(),
  paymentCount: integer('payment_count').notNull().default(0),
  mutationIds: text('mutation_ids').array().notNull().default([]),
  status:      text('status').notNull().default('partial'), // partial|complete|overpaid
  completedAt: timestamp('completed_at'),
  createdAt:   timestamp('created_at').defaultNow(),
  updatedAt:   timestamp('updated_at').defaultNow(),
});
```

### 2.6 `recon_auto_approval_settings`
Konfigurasi Auto Approval per perusahaan (Phase 12).

```typescript
export const reconAutoApprovalSettings = pgTable('recon_auto_approval_settings', {
  id:               uuid('id').primaryKey().defaultRandom(),
  companyId:        uuid('company_id').notNull().unique().references(() => companies.id),
  isEnabled:        boolean('is_enabled').notNull().default(false),
  confidenceMin:    numeric('confidence_min', { precision: 5, scale: 2 }).notNull().default('95'),
  amountMax:        numeric('amount_max', { precision: 20, scale: 4 }),  // null = unlimited
  requireNoWarning: boolean('require_no_warning').notNull().default(true),
  requireNoConflict: boolean('require_no_conflict').notNull().default(true),
  requireNoDuplicate: boolean('require_no_duplicate').notNull().default(true),
  updatedBy:        uuid('updated_by'),
  updatedAt:        timestamp('updated_at').defaultNow(),
});
```

### 2.7 `recon_ocr_results`
Hasil OCR bukti transfer (Phase 8).

```typescript
export const reconOcrResults = pgTable('recon_ocr_results', {
  id:              uuid('id').primaryKey().defaultRandom(),
  mutationId:      uuid('mutation_id').references(() => bankMutations.id),
  proofUrl:        text('proof_url').notNull(),
  // Extracted fields
  ocrAmount:       numeric('ocr_amount', { precision: 20, scale: 4 }),
  ocrDate:         date('ocr_date'),
  ocrTime:         text('ocr_time'),
  ocrBankName:     text('ocr_bank_name'),
  ocrSenderAccount:    text('ocr_sender_account'),
  ocrReceiverAccount:  text('ocr_receiver_account'),
  ocrReferenceNo:  text('ocr_reference_no'),
  ocrRawJson:      jsonb('ocr_raw_json'),   // full OpenAI response
  // Validation
  amountMatch:     boolean('amount_match'),
  dateMatch:       boolean('date_match'),
  referenceMatch:  boolean('reference_match'),
  hasWarning:      boolean('has_warning').notNull().default(false),
  warningReasons:  text('warning_reasons').array(),
  confidenceBonus: numeric('confidence_bonus', { precision: 5, scale: 2 }).notNull().default('0'),
  createdAt:       timestamp('created_at').defaultNow(),
});
```

### 2.8 Perluasan `bank_reconciliation_audit` (Phase 13)
Tambah kolom baru — backward compatible (nullable).

```sql
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS ai_confidence     numeric(5,2);
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS ai_reason_json    jsonb;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS rule_id           uuid;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS ocr_result_id     uuid;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS old_candidate_json jsonb;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS new_candidate_json jsonb;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS is_manual_override boolean DEFAULT false;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS expected_cf_id    uuid;
```

---

## 3. MIGRATION BARU

File: `migrations/YYYYMMDD_bank_recon_enterprise.sql`

```sql
-- === PHASE 1: Expected Cash Flow Engine ===
CREATE TABLE IF NOT EXISTS expected_cash_flows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  bank_account_id     UUID,
  direction           TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  source_type         TEXT NOT NULL,
  source_id           UUID NOT NULL,
  expected_amount     NUMERIC(20,4) NOT NULL,
  expected_date       DATE,
  due_date            DATE,
  reference_no        TEXT,
  counterparty_name   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  matched_mutation_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ecf_company_status    ON expected_cash_flows(company_id, status);
CREATE INDEX idx_ecf_due_date          ON expected_cash_flows(due_date) WHERE status = 'pending';
CREATE INDEX idx_ecf_source            ON expected_cash_flows(source_type, source_id);
CREATE INDEX idx_ecf_amount_direction  ON expected_cash_flows(expected_amount, direction);

-- === PHASE 6: Learning Engine ===
CREATE TABLE IF NOT EXISTS recon_learning_patterns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  pattern_type        TEXT NOT NULL,
  pattern_key         TEXT NOT NULL,
  normalized_desc     TEXT,
  counterparty_name   TEXT,
  amount_range_min    NUMERIC(20,4),
  amount_range_max    NUMERIC(20,4),
  target_source_type  TEXT NOT NULL,
  target_coa_id       UUID,
  target_label        TEXT,
  approval_count      INTEGER NOT NULL DEFAULT 1,
  override_count      INTEGER NOT NULL DEFAULT 0,
  confidence_bonus    NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recon_learning_uk UNIQUE (company_id, pattern_type, pattern_key)
);
CREATE INDEX idx_rlp_company_type ON recon_learning_patterns(company_id, pattern_type);

-- === PHASE 7: Rule Engine ===
CREATE TABLE IF NOT EXISTS recon_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  name                TEXT NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 100,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  cond_desc_contains  TEXT,
  cond_desc_regex     TEXT,
  cond_amount_min     NUMERIC(20,4),
  cond_amount_max     NUMERIC(20,4),
  cond_direction      TEXT,
  cond_provider_name  TEXT,
  action_source_type  TEXT NOT NULL,
  action_coa_id       UUID,
  action_label        TEXT,
  action_auto_approve BOOLEAN NOT NULL DEFAULT false,
  match_count         INTEGER NOT NULL DEFAULT 0,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recon_rules_company_priority ON recon_rules(company_id, priority) WHERE is_active = true;

-- === PHASE 3: Multi Invoice Groups ===
CREATE TABLE IF NOT EXISTS recon_multi_invoice_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mutation_id   UUID NOT NULL,
  company_id    UUID NOT NULL,
  total_amount  NUMERIC(20,4) NOT NULL,
  invoice_ids   TEXT[] NOT NULL,
  source_types  TEXT[] NOT NULL,
  confidence    NUMERIC(5,2),
  status        TEXT NOT NULL DEFAULT 'pending',
  approved_by   UUID,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === PHASE 4: Split Payments ===
CREATE TABLE IF NOT EXISTS recon_split_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      TEXT NOT NULL,
  source_id        UUID NOT NULL,
  company_id       UUID NOT NULL,
  total_expected   NUMERIC(20,4) NOT NULL,
  total_received   NUMERIC(20,4) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(20,4) NOT NULL,
  payment_count    INTEGER NOT NULL DEFAULT 0,
  mutation_ids     TEXT[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'partial',
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rsp_source_uk UNIQUE (source_type, source_id)
);

-- === PHASE 8: OCR Results ===
CREATE TABLE IF NOT EXISTS recon_ocr_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mutation_id          UUID,
  proof_url            TEXT NOT NULL,
  ocr_amount           NUMERIC(20,4),
  ocr_date             DATE,
  ocr_time             TEXT,
  ocr_bank_name        TEXT,
  ocr_sender_account   TEXT,
  ocr_receiver_account TEXT,
  ocr_reference_no     TEXT,
  ocr_raw_json         JSONB,
  amount_match         BOOLEAN,
  date_match           BOOLEAN,
  reference_match      BOOLEAN,
  has_warning          BOOLEAN NOT NULL DEFAULT false,
  warning_reasons      TEXT[],
  confidence_bonus     NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === PHASE 12: Auto Approval Settings ===
CREATE TABLE IF NOT EXISTS recon_auto_approval_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL UNIQUE,
  is_enabled          BOOLEAN NOT NULL DEFAULT false,
  confidence_min      NUMERIC(5,2) NOT NULL DEFAULT 95,
  amount_max          NUMERIC(20,4),
  require_no_warning  BOOLEAN NOT NULL DEFAULT true,
  require_no_conflict BOOLEAN NOT NULL DEFAULT true,
  require_no_duplicate BOOLEAN NOT NULL DEFAULT true,
  updated_by          UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === PHASE 13: Audit Trail Extension ===
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS ai_confidence      NUMERIC(5,2);
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS ai_reason_json     JSONB;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS rule_id            UUID;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS ocr_result_id      UUID;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS old_candidate_json JSONB;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS new_candidate_json JSONB;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT false;
ALTER TABLE bank_reconciliation_audit ADD COLUMN IF NOT EXISTS expected_cf_id     UUID;
```

---

## 4. API BARU

Semua endpoint baru di bawah `/api/bank-reconciliation/` — tidak mengubah endpoint lama.

### Phase 1 — Expected Cash Flow

| Method | Path | Deskripsi |
|--------|------|-----------|
| `POST` | `/expected-cash-flows/rebuild` | Rebuild seluruh expected CF dari semua sumber untuk company |
| `GET`  | `/expected-cash-flows` | List dengan filter status/direction/dateRange |
| `GET`  | `/expected-cash-flows/unmatched` | CF yang belum ada pasangannya |
| `PATCH`| `/expected-cash-flows/:id/cancel` | Cancel satu expected CF |

### Phase 2 — Due Date Scoring
Tidak ada endpoint baru. Due date diambil otomatis dari `expected_cash_flows.due_date` saat run-matching.

### Phase 3 — Multi Invoice Matching

| Method | Path | Deskripsi |
|--------|------|-----------|
| `POST` | `/:mutationId/find-multi-invoice` | Jalankan subset search untuk mutasi ini |
| `POST` | `/multi-invoice-groups/:groupId/approve` | Approve group |
| `POST` | `/multi-invoice-groups/:groupId/reject` | Reject group |

### Phase 4 — Split Payment

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET`  | `/split-payments` | List invoice yang partial paid |
| `POST` | `/split-payments/:sourceType/:sourceId/link` | Link mutasi ke split payment |
| `GET`  | `/split-payments/:sourceType/:sourceId` | Detail progress pembayaran |

### Phase 5 — Reference Priority
Tidak ada endpoint baru. Handled di scoring engine.

### Phase 6 — Learning Engine

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET`  | `/learning/patterns` | List semua pola yang dipelajari |
| `DELETE`| `/learning/patterns/:id` | Hapus pola (reset learning) |
| `GET`  | `/learning/stats` | Statistik: total patterns, avg confidence bonus |

### Phase 7 — Rule Engine

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET`  | `/rules` | List semua rule |
| `POST` | `/rules` | Buat rule baru |
| `PUT`  | `/rules/:id` | Update rule |
| `PATCH`| `/rules/:id/toggle` | Aktif/nonaktif |
| `DELETE`| `/rules/:id` | Hapus rule |
| `POST` | `/rules/test` | Test rule terhadap deskripsi/jumlah sample |

### Phase 8 — OCR

| Method | Path | Deskripsi |
|--------|------|-----------|
| `POST` | `/:mutationId/ocr` | Upload bukti transfer + jalankan OCR |
| `GET`  | `/:mutationId/ocr` | Ambil hasil OCR dan validasi |

### Phase 9 — Intercompany

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET`  | `/intercompany/companies` | List perusahaan dalam grup (untuk mapping) |
| `POST` | `/:mutationId/mark-intercompany` | Tandai sebagai intercompany + preview dual journal |
| `POST` | `/:mutationId/approve-intercompany` | Approve + buat kedua journal entry |

### Phase 11 — Aging Dashboard

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET`  | `/aging` | Unmatched aging: 0-3, 4-7, >7 hari + top 20 outstanding |

### Phase 12 — Auto Approval Settings

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET`  | `/auto-approval-settings` | Ambil setting per company |
| `PUT`  | `/auto-approval-settings` | Update setting |

---

## 5. RULE ENGINE

### Cara Kerja

```typescript
// Urutan evaluasi:
// 1. Sort rules by priority ASC (priority 1 = tertinggi)
// 2. Evaluasi kondisi (AND semua yang diisi)
// 3. Rule pertama yang match = winner
// 4. Jika rule.actionAutoApprove = true + kondisi auto approval terpenuhi → langsung approve

interface RuleEvaluationResult {
  matched: boolean;
  ruleId?: string;
  ruleName?: string;
  actionSourceType?: string;
  actionCoaId?: string;
  actionLabel?: string;
  autoApprove?: boolean;
  confidence: 1.0; // Manual rule selalu 100%
}

function evaluateRules(mutation: BankMutation, rules: ReconRule[]): RuleEvaluationResult {
  const sorted = rules
    .filter(r => r.isActive)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (matchesRule(mutation, rule)) {
      // Update statistik
      await db.update(reconRules)
        .set({ matchCount: sql`match_count + 1`, updatedAt: new Date() })
        .where(eq(reconRules.id, rule.id));
      return { matched: true, ruleId: rule.id, ... };
    }
  }
  return { matched: false, confidence: 0 };
}

function matchesRule(mutation: BankMutation, rule: ReconRule): boolean {
  const desc = mutation.normalizedDescription?.toLowerCase() ?? '';
  if (rule.condDescContains && !desc.includes(rule.condDescContains.toLowerCase())) return false;
  if (rule.condDescRegex && !new RegExp(rule.condDescRegex, 'i').test(desc)) return false;
  if (rule.condDirection && rule.condDirection !== mutation.direction) return false;
  if (rule.condAmountMin && mutation.amount < rule.condAmountMin) return false;
  if (rule.condAmountMax && mutation.amount > rule.condAmountMax) return false;
  if (rule.condProviderName && mutation.providerName !== rule.condProviderName) return false;
  return true;
}
```

### Contoh Rules (seed data)

| Priority | Kondisi | Aksi |
|----------|---------|------|
| 10 | desc contains "GAJI" | Payroll |
| 20 | desc contains "BPJS" | BPJS Payment |
| 30 | desc contains "PAJAK" atau "PPH" atau "PPN" | Tax Payment |
| 40 | desc contains "ADMIN BCA" atau "ADMIN BRI" | Bank Fee |
| 50 | desc contains "TRANSFER INTERN" | Interbank Transfer |
| 60 | amount_max = 50000 AND direction = OUT | Bank Fee |

---

## 6. LEARNING ENGINE

### Cara Kerja

Setiap kali user **approve** sebuah match, sistem merekam pola:

```typescript
async function recordApproval(
  mutation: BankMutation,
  approvedCandidate: MatchCandidate,
  wasOverride: boolean // user mengubah suggestion AI
): Promise<void> {
  const patterns: LearnPattern[] = [];

  // Pattern 1: counterparty → source_type
  if (mutation.counterpartyName) {
    patterns.push({
      patternType: 'counterparty_to_source',
      patternKey: `${normalize(mutation.counterpartyName)}→${approvedCandidate.sourceType}`,
      counterpartyName: normalize(mutation.counterpartyName),
      targetSourceType: approvedCandidate.sourceType,
    });
  }

  // Pattern 2: desc tokens → source_type (ambil 2-3 token signifikan)
  const tokens = extractSignificantTokens(mutation.normalizedDescription);
  for (const token of tokens) {
    patterns.push({
      patternType: 'desc_token_to_source',
      patternKey: `${token}→${approvedCandidate.sourceType}`,
      normalizedDesc: token,
      targetSourceType: approvedCandidate.sourceType,
    });
  }

  for (const pattern of patterns) {
    await db.insert(reconLearningPatterns)
      .values({ ...pattern, companyId: mutation.companyId, approvalCount: 1 })
      .onConflictDoUpdate({
        target: [reconLearningPatterns.companyId, reconLearningPatterns.patternType, reconLearningPatterns.patternKey],
        set: {
          approvalCount: sql`approval_count + 1`,
          overrideCount: wasOverride ? sql`override_count + 1` : sql`override_count`,
          lastSeenAt: new Date(),
          // Confidence bonus naik bertahap: 3x approve = +3, 5x = +5, 10x = +8, 20x = +12
          confidenceBonus: sql`CASE
            WHEN approval_count >= 20 THEN 12
            WHEN approval_count >= 10 THEN 8
            WHEN approval_count >= 5  THEN 5
            WHEN approval_count >= 3  THEN 3
            ELSE 1 END`,
        }
      });
  }
}

// Saat matching: cek apakah ada pattern yang cocok
async function getLearningBonus(
  mutation: BankMutation,
  candidate: MatchCandidate,
  companyId: string
): Promise<number> {
  // Query pattern yang cocok, ambil confidence_bonus tertinggi
  const pattern = await db.query.reconLearningPatterns.findFirst({
    where: and(
      eq(reconLearningPatterns.companyId, companyId),
      eq(reconLearningPatterns.targetSourceType, candidate.sourceType),
      or(
        ilike(reconLearningPatterns.counterpartyName, mutation.counterpartyName ?? ''),
        // desc token match...
      )
    ),
    orderBy: desc(reconLearningPatterns.confidenceBonus)
  });
  return Number(pattern?.confidenceBonus ?? 0);
}
```

---

## 7. OCR PIPELINE

### Flow

```
User upload bukti transfer (JPG/PNG/PDF)
        ↓
Storage: Simpan ke private bucket (existing flow)
        ↓
POST /api/bank-reconciliation/:mutationId/ocr
        ↓
ocrService.extractTransferProof(imageUrl)
        ↓
OpenAI GPT-4o Vision
  Prompt: "Extract from this bank transfer receipt:
           amount (number only), date (YYYY-MM-DD), time (HH:mm),
           sender_bank, sender_account, receiver_account, reference_no.
           Respond as JSON."
        ↓
Parse response → recon_ocr_results
        ↓
validateOcrVsMutation(ocrResult, mutation)
  - amountMatch:    |ocr.amount - mutation.amount| < 1
  - dateMatch:      ocr.date === mutation.date (±1 day)
  - referenceMatch: ocr.referenceNo in mutation.providerOrderId
        ↓
Hitung confidenceBonus:
  - amountMatch  → +4
  - dateMatch    → +1
  - referenceMatch → +3
  - hasWarning   → -10 (potongan jika ada mismatch)
        ↓
Return: { ocrResult, confidenceBonus, hasWarning, warningReasons }
```

### File baru
- `artifacts/api-server/src/lib/reconciliation/ocrService.ts`

---

## 8. REGRESSION TEST

File: `artifacts/api-server/src/lib/reconciliation/__tests__/enterprise-recon.test.ts`

```typescript
describe('Bank Reconciliation Enterprise', () => {

  describe('Phase 1: Expected Cash Flow Engine', () => {
    it('rebuilds expected CF from all source types', async () => { ... });
    it('marks expected CF as matched after approval', async () => { ... });
    it('cash IN sources are correctly identified', async () => { ... });
    it('cash OUT sources are correctly identified', async () => { ... });
  });

  describe('Phase 2: Due Date Scoring', () => {
    it('adds +15 when payment is on due date', async () => { ... });
    it('reduces score proportionally when payment is 7 days after due date', async () => { ... });
    it('does not reduce score when due_date is null', async () => { ... });
  });

  describe('Phase 3: Multi Invoice Matching', () => {
    it('finds INV001(200k) + INV002(300k) + INV003(500k) for transfer 1000k', async () => { ... });
    it('does not brute-force (completes within 50ms for 100 invoices)', async () => { ... });
    it('handles no valid combination gracefully', async () => { ... });
  });

  describe('Phase 4: Split Payment', () => {
    it('links 40jt + 30jt + 30jt to same 100jt invoice', async () => { ... });
    it('marks split payment complete when total_received = total_expected', async () => { ... });
    it('detects overpayment correctly', async () => { ... });
  });

  describe('Phase 5: Reference Priority', () => {
    it('reference match overrides nominal-only match when reference is present', async () => { ... });
    it('QRIS reference gets highest score', async () => { ... });
    it('returns nominal-only match when no reference available', async () => { ... });
  });

  describe('Phase 6: Learning Engine', () => {
    it('records pattern after approval', async () => { ... });
    it('confidence bonus increases after 5 approvals', async () => { ... });
    it('override_count increments when user changes AI suggestion', async () => { ... });
  });

  describe('Phase 7: Rule Engine', () => {
    it('matches rule with desc_contains "GAJI" to payroll', async () => { ... });
    it('higher priority rule wins over lower priority', async () => { ... });
    it('rule with direction filter ignores opposite direction', async () => { ... });
    it('manual rule confidence is always 1.0', async () => { ... });
  });

  describe('Phase 8: OCR Matching', () => {
    it('extracts amount and date from transfer receipt', async () => { ... });
    it('returns warning when OCR amount != mutation amount', async () => { ... });
    it('confidence_bonus is 0 when has_warning = true', async () => { ... });
  });

  describe('Phase 9: Intercompany', () => {
    it('detects intercompany transfer from known company account', async () => { ... });
    it('creates dual journal entries (AR/AP) for intercompany', async () => { ... });
  });

  describe('Phase 12: Auto Approval', () => {
    it('auto-approves when confidence >= threshold and amount <= limit', async () => { ... });
    it('does not auto-approve when is_enabled = false', async () => { ... });
    it('does not auto-approve when has_warning = true', async () => { ... });
    it('does not auto-approve when duplicate detected', async () => { ... });
  });

});
```

---

## 9. TYPECHECK

```bash
# Typecheck setelah implementasi
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/bizportal run typecheck
pnpm --filter lib/db run typecheck
```

Perkiraan error baru yang akan muncul dan harus di-fix:
1. `reconRules`, `reconLearningPatterns` dll. harus di-export dari `lib/db/src/schema/index.ts`
2. `UnifiedMatchingEngine` perlu parameter `expectedCashFlows?: ExpectedCashFlow[]` (optional agar backward compatible)
3. `ApproveResult` interface perlu field `ocrResultId?: string`, `ruleId?: string`, `multiInvoiceGroupId?: string`

---

## 10. BUILD

```bash
pnpm run build
# Expected: artifacts/api-server, artifacts/bizportal, artifacts/logistic-order, artifacts/customer-portal
# lib/db harus di-build terlebih dahulu (sudah di-handle oleh preinstall script)
```

---

## 11. BROWSER UAT (Checklist)

### BizPortal → Accounting → Bank Reconciliation

| # | Skenario | Pass/Fail |
|---|----------|-----------|
| 1 | Jalankan AI Matching → lihat confidence score breakdown (Phase 10) | |
| 2 | Cek kolom "Due Date" muncul di suggestion (Phase 2) | |
| 3 | Multi invoice: 3 invoice → 1 transfer, approve group (Phase 3) | |
| 4 | Split payment: approve partial, cek remaining amount berkurang (Phase 4) | |
| 5 | Upload bukti transfer → lihat hasil OCR + warning jika tidak cocok (Phase 8) | |
| 6 | Buat rule "GAJI → Payroll" → jalankan matching → rule matched (Phase 7) | |
| 7 | Approve 5x pola yang sama → cek learning bonus bertambah (Phase 6) | |
| 8 | Aging dashboard: filter 0-3 hari, 4-7 hari, >7 hari (Phase 11) | |
| 9 | Auto approval: aktifkan, set threshold 95%, amount max 5jt → cek auto-approve (Phase 12) | |
| 10 | Audit trail: lihat ai_confidence, ai_reason, rule_id tercatat (Phase 13) | |
| 11 | Intercompany: mutasi dari rekening grup → dual journal preview + approve (Phase 9) | |

---

## 12. DAFTAR FILE YANG BERUBAH / DIBUAT

### File Baru

```
artifacts/api-server/src/lib/reconciliation/
  ├── expectedCashFlowEngine.ts          # Phase 1
  ├── dueDateScoring.ts                  # Phase 2
  ├── multiInvoiceMatcher.ts             # Phase 3
  ├── splitPaymentMatcher.ts             # Phase 4
  ├── referencePriorityScoring.ts        # Phase 5
  ├── learningEngine.ts                  # Phase 6
  ├── ruleEngine.ts                      # Phase 7
  ├── ocrService.ts                      # Phase 8
  ├── intercompanyDetector.ts            # Phase 9
  ├── confidenceExplainer.ts             # Phase 10
  ├── autoApprovalGate.ts                # Phase 12
  └── __tests__/enterprise-recon.test.ts

artifacts/api-server/src/routes/
  ├── reconRules.ts                      # Phase 7 CRUD
  ├── reconLearning.ts                   # Phase 6 stats
  ├── reconExpectedCashFlow.ts           # Phase 1 API
  └── reconAging.ts                      # Phase 11

lib/db/src/schema/
  ├── expectedCashFlows.ts
  ├── reconRules.ts
  ├── reconLearningPatterns.ts
  ├── reconMultiInvoiceGroups.ts
  ├── reconSplitPayments.ts
  ├── reconOcrResults.ts
  └── reconAutoApprovalSettings.ts

migrations/
  └── YYYYMMDD_bank_recon_enterprise.sql

artifacts/bizportal/src/pages/accounting/
  ├── bank-recon-rules.tsx               # Phase 7 UI
  ├── bank-recon-aging.tsx               # Phase 11 UI
  └── bank-recon-settings.tsx            # Phase 12 UI
```

### File yang Diperluas (TIDAK diubah strukturnya — hanya penambahan)

```
artifacts/api-server/src/routes/bankReconciliation.ts
  + endpoint OCR, multi-invoice, split-payment, intercompany, auto-approval-settings

artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts
  + integrate expectedCashFlowEngine sebagai primary candidate source
  + integrate dueDateScoring ke scoring function
  + integrate referencePriorityScoring
  + integrate learningEngine bonus
  + integrate ruleEngine (highest priority, short-circuit)
  + integrate autoApprovalGate (post-scoring)
  + perbarui ConfidenceExplanation shape (Phase 10)

lib/db/src/schema/index.ts
  + export semua schema baru

artifacts/api-server/src/index.ts
  + register route baru
```

### File yang TIDAK DIUBAH

```
artifacts/api-server/src/lib/accounting.ts          ← accounting engine
artifacts/api-server/src/lib/reconciliation/
  ├── historicalMatchingEngine.ts
  ├── erpDocumentMatcher.ts
  ├── phase4RecommendationEngine.ts
  └── canonicalMutationKey.ts
artifacts/api-server/src/routes/bankReconciliation.ts (endpoint lama)
migrations/ (semua migration lama)
Google Sheet sync
Approval/posting/reversal flow
```

---

## RINGKASAN RISIKO & REKOMENDASI URUTAN IMPLEMENTASI

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| 1 | Phase 7 (Rule Engine) | M | Langsung operasional, tidak butuh data historis |
| 2 | Phase 1 (Expected CF Engine) | L | Fondasi semua phase berikutnya |
| 3 | Phase 10 (Confidence Explanation) | S | UI improvement, minimal risk |
| 4 | Phase 2 (Due Date Scoring) | S | Incremental improvement ke engine existing |
| 5 | Phase 8 (OCR) | M | High value, butuh OpenAI key |
| 6 | Phase 11 (Aging Dashboard) | S | Operational visibility |
| 7 | Phase 6 (Learning Engine) | M | Butuh data approval historis |
| 8 | Phase 12 (Auto Approval) | S | Butuh Phase 6 & 7 selesai dulu |
| 9 | Phase 3 (Multi Invoice) | M | Edge case tapi penting |
| 10 | Phase 4 (Split Payment) | M | Edge case tapi penting |
| 11 | Phase 9 (Intercompany) | L | Butuh company mapping data |
| 12 | Phase 5 (Reference Priority) | S | Tweak di engine existing |
| 13 | Phase 13 (Audit Trail ext.) | S | Migration + logging saja |

**S = Small (< 1 hari), M = Medium (1-2 hari), L = Large (2-3 hari)**

---

*Report ini tidak mengubah production. Tidak ada yang di-commit atau di-deploy.*
