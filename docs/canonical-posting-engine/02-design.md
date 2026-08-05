# Tahap 2 — Desain Canonical Posting Engine

Tanggal: 2026-07-11
Status: **Proposal desain** — belum ada kode yang diubah. Menunggu review Anda
sebelum masuk Tahap 3 (refactor).

## 1. Prinsip Desain

1. **Tidak membongkar yang sudah bekerja.** `_postEntryCore()` sudah punya
   idempotency, period-lock, dan multi-currency balance validation yang solid.
   Engine baru **membungkus** logic itu, tidak menulis ulang dari nol.
2. **Satu pintu masuk wajib.** Semua modul (Sales, Purchase, Expense, Advance,
   Logistics, Marketplace, OCR, Bank) memanggil `CanonicalPostingEngine.post()`.
   Tidak ada modul yang melihat `accounting_entries` secara langsung.
3. **Jurnal + pajak atomic secara default**, bukan opt-in — supaya modul baru
   tidak bisa "lupa" membungkusnya dalam transaksi.
4. **Backward compatible.** `postEntry()` dan `createJournal()` tetap ada dan
   tetap berfungsi (dipakai oleh AdvanceJournalService, PayrollJournalService,
   dll. yang sudah disiplin) — engine baru memanggil mereka di bawah, bukan
   menggantikannya secara big-bang.

## 2. Arsitektur — Layer & Tanggung Jawab

```
┌──────────────────────────────────────────────────────────────────┐
│  Modul Caller (Sales, Purchase, Advance, Bank, Marketplace, ...)  │
└───────────────────────────┬────────────────────────────────────────┘
                            │  PostingRequest
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  CanonicalPostingEngine (facade — SATU-SATUNYA entry point publik) │
│                                                                    │
│   post(request: PostingRequest): Promise<PostingResult>           │
└───────────────────────────┬────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  ValidationPipeline (chain of Validators — SRP per validator)      │
│                                                                    │
│   1. FinancialPeriodValidator   (financial_periods.is_closed)     │
│   2. TaxPeriodValidator         (tax_periods lock — Tahap 5)       │
│   3. AccountExistenceValidator  (semua accountId di lines valid)  │
│   4. BalanceValidator           (debit = credit, per currency)    │
│   5. IdempotencyValidator       (source+sourceId sudah posting?)  │
│   6. JournalRuleValidator       (govern source-specific rules)    │
└───────────────────────────┬────────────────────────────────────────┘
                            │  jika semua lolos
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  PostingTransactionCoordinator                                    │
│                                                                    │
│   run(request): Promise<PostingResult>                            │
│   → db.transaction(async (tx) => {                                │
│        entry = JournalRepository.insert(tx, ...)                  │
│        lines = JournalLineRepository.insertLines(tx, ...)          │
│        if (request.tax) {                                         │
│          taxRows = TaxRepository.insertTransactionTax(tx, ...)     │
│          glTaxRows = TaxRepository.insertGlTaxLines(tx, ...)       │
│        }                                                           │
│        AuditRepository.insertAuditTrail(tx, ...)                   │
│        return { entry, lines, taxRows, glTaxRows }                 │
│      })                                                             │
└───────────────────────────┬────────────────────────────────────────┘
                            │  commit sukses
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Post-commit hooks (fire-and-forget, TIDAK bisa gagalkan posting)  │
│   - lockAccountingEntry() (immutability lock)                     │
│   - emitJournalCreated() (event bus)                               │
│   - captureFailedJob() jika hook ini sendiri gagal                 │
└──────────────────────────────────────────────────────────────────┘
```

## 3. Interface & Class (TypeScript, SOLID)

### 3.1 Tipe data inti

```ts
// lib/posting-engine/types.ts

export interface PostingLine {
  accountId: number;
  debit: number;
  credit: number;
  description?: string | null;
  currency?: string | null;
  exchangeRate?: number | null;
}

/** Baris pajak opsional — jika diisi, DIJAMIN atomic dengan jurnal. */
export interface TaxLine {
  taxId: number;
  taxType: "PPN_OUTPUT" | "PPN_INPUT" | "PPH21" | "PPH23" | "PPH4A2" | string;
  baseAmount: number;
  taxAmount: number;
  glAccountId: number;      // akun GL untuk gl_tax_lines
  npwp?: string | null;
  invoiceDate?: Date | null;
}

export interface PostingRequest {
  companyId: number;
  journalId: number;
  journalCode: string;
  date: Date;
  ref?: string | null;
  description?: string | null;
  source: LedgerSourceType;      // enum yang sudah ada di ledgerGuard.ts, DIPERLUAS
  sourceId: string | number;
  createdById: string;
  lines: PostingLine[];
  taxes?: TaxLine[];             // <-- BARU: jika ada, insert atomic dgn jurnal
  initialStatus?: "posted" | "draft";
  idempotencyKey?: string;        // opsional, default: `${source}:${sourceId}`
}

export interface PostingResult {
  ok: boolean;
  entryId?: number;
  taxIds?: number[];
  glTaxLineIds?: number[];
  error?: string;
  errorCode?: PostingErrorCode;
  /** true jika request ini adalah duplikat dari posting sebelumnya (idempotency hit) */
  wasIdempotent?: boolean;
}

export type PostingErrorCode =
  | "PERIOD_CLOSED"
  | "TAX_PERIOD_LOCKED"
  | "ACCOUNT_NOT_FOUND"
  | "NOT_BALANCED"
  | "DUPLICATE_POSTING"
  | "INVALID_SOURCE"
  | "TRANSACTION_FAILED";

export class PostingValidationError extends Error {
  constructor(public code: PostingErrorCode, message: string) {
    super(message);
    this.name = "PostingValidationError";
  }
}
```

### 3.2 Validator interface (Strategy pattern — Open/Closed Principle)

```ts
// lib/posting-engine/validators/Validator.ts

export interface PostingValidator {
  /** Nama unik untuk logging/audit. */
  readonly name: string;
  /** Lempar PostingValidationError jika tidak lolos. Tidak boleh melakukan side-effect. */
  validate(request: PostingRequest, ctx: ValidationContext): Promise<void>;
}

export interface ValidationContext {
  client: DbClient; // bisa `db` biasa untuk read-only check SEBELUM transaksi dimulai
}
```

Setiap validator jadi class terpisah — mudah di-unit-test sendiri-sendiri,
mudah ditambah tanpa mengubah yang lain (Open/Closed):

```ts
// lib/posting-engine/validators/FinancialPeriodValidator.ts
export class FinancialPeriodValidator implements PostingValidator {
  readonly name = "FinancialPeriodValidator";
  private static EXEMPT = new Set(["closing_entry", "reversal", "bank_reconciliation_void"]);

  async validate(request: PostingRequest, ctx: ValidationContext): Promise<void> {
    if (FinancialPeriodValidator.EXEMPT.has(request.source)) return;
    const period = await ctx.client.execute(sql`
      SELECT is_closed, override_allowed FROM financial_periods
      WHERE company_id = ${request.companyId}
        AND year = ${request.date.getFullYear()}
        AND month = ${request.date.getMonth() + 1}
      LIMIT 1
    `);
    const row = period.rows[0] as any;
    if (row?.is_closed && !row?.override_allowed) {
      throw new PostingValidationError("PERIOD_CLOSED",
        `Periode ${request.date.getFullYear()}-${request.date.getMonth()+1} sudah ditutup.`);
    }
  }
}

// lib/posting-engine/validators/TaxPeriodValidator.ts  (BARU — Tahap 5)
export class TaxPeriodValidator implements PostingValidator {
  readonly name = "TaxPeriodValidator";
  async validate(request: PostingRequest, ctx: ValidationContext): Promise<void> {
    if (!request.taxes?.length) return;
    const period = await ctx.client.execute(sql`
      SELECT is_locked FROM tax_periods
      WHERE company_id = ${request.companyId}
        AND period = ${formatPeriod(request.date)}
      LIMIT 1
    `);
    if ((period.rows[0] as any)?.is_locked) {
      throw new PostingValidationError("TAX_PERIOD_LOCKED",
        `Tax period ${formatPeriod(request.date)} sudah lock — tidak bisa posting transaksi berpajak.`);
    }
  }
}

// lib/posting-engine/validators/BalanceValidator.ts — reuse validateMultiCurrencyBalance yang sudah ada
// lib/posting-engine/validators/IdempotencyValidator.ts — reuse logic existing dari _postEntryCore
// lib/posting-engine/validators/AccountExistenceValidator.ts — BARU, cek semua accountId di lines + taxes ada di chart_of_accounts
// lib/posting-engine/validators/JournalRuleValidator.ts — reuse governance-bypass logic dari postEntry()
```

### 3.3 Repository layer (Dependency Inversion — engine tidak tahu SQL detail)

```ts
// lib/posting-engine/repositories/JournalRepository.ts
export interface IJournalRepository {
  insertEntry(tx: DbClient, values: JournalEntryValues): Promise<JournalEntryRow>;
  insertLines(tx: DbClient, entryId: number, lines: PostingLine[]): Promise<void>;
  updateStatus(tx: DbClient, entryId: number, status: "posted" | "draft"): Promise<void>;
}
export class DrizzleJournalRepository implements IJournalRepository { /* reuse _postEntryCore internals */ }

// lib/posting-engine/repositories/TaxRepository.ts
export interface ITaxRepository {
  insertTransactionTax(tx: DbClient, entryId: number, line: TaxLine, ctx: TaxInsertContext): Promise<number>;
  insertGlTaxLine(tx: DbClient, entryId: number, line: TaxLine): Promise<number>;
}
export class DrizzleTaxRepository implements ITaxRepository { /* reuse taxAutoService + taxEngineCore logic */ }

// lib/posting-engine/repositories/AuditRepository.ts
export interface IAuditRepository {
  recordPosting(tx: DbClient, entry: JournalEntryRow, request: PostingRequest): Promise<void>;
}
```

### 3.4 Engine facade + Dependency Injection

```ts
// lib/posting-engine/CanonicalPostingEngine.ts
export class CanonicalPostingEngine {
  constructor(
    private readonly validators: PostingValidator[],
    private readonly journalRepo: IJournalRepository,
    private readonly taxRepo: ITaxRepository,
    private readonly auditRepo: IAuditRepository,
    private readonly db: DbClient,
  ) {}

  async post(request: PostingRequest): Promise<PostingResult> {
    // 1. Pre-transaction validation (read-only, boleh pakai koneksi biasa)
    try {
      for (const validator of this.validators) {
        await validator.validate(request, { client: this.db });
      }
    } catch (err) {
      if (err instanceof PostingValidationError) {
        return { ok: false, error: err.message, errorCode: err.code };
      }
      throw err;
    }

    // 2. Atomic transaction — jurnal + pajak + audit dalam SATU tx
    try {
      const result = await this.db.transaction(async (tx) => {
        const entry = await this.journalRepo.insertEntry(tx, toEntryValues(request));
        await this.journalRepo.insertLines(tx, entry.id, request.lines);
        if (request.initialStatus !== "draft") {
          await this.journalRepo.updateStatus(tx, entry.id, "posted");
        }

        const taxIds: number[] = [];
        const glTaxLineIds: number[] = [];
        for (const taxLine of request.taxes ?? []) {
          taxIds.push(await this.taxRepo.insertTransactionTax(tx, entry.id, taxLine, { request }));
          glTaxLineIds.push(await this.taxRepo.insertGlTaxLine(tx, entry.id, taxLine));
        }

        await this.auditRepo.recordPosting(tx, entry, request);
        return { entry, taxIds, glTaxLineIds };
      });

      // 3. Post-commit hooks — TIDAK BOLEH melempar exception ke caller
      this.runPostCommitHooks(result.entry, request).catch(() => {});

      return { ok: true, entryId: result.entry.id, taxIds: result.taxIds, glTaxLineIds: result.glTaxLineIds };
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: e.message, errorCode: "TRANSACTION_FAILED" };
    }
  }

  private async runPostCommitHooks(entry: JournalEntryRow, request: PostingRequest): Promise<void> {
    const { lockAccountingEntry } = await import("../ledgerImmutability.js");
    await lockAccountingEntry(entry.id, request.createdById);
    const { emitJournalCreated } = await import("../events/financialEventBus.js");
    emitJournalCreated({ entryId: entry.id, sourceType: request.source, sourceId: request.sourceId,
      amount: sumDebit(request.lines), actor: request.createdById, ref: request.ref ?? null, companyId: request.companyId });
  }
}
```

### 3.5 Factory / wiring (composition root — satu tempat untuk DI)

```ts
// lib/posting-engine/index.ts
import { db } from "@workspace/db";

let _engine: CanonicalPostingEngine | null = null;

export function getPostingEngine(): CanonicalPostingEngine {
  if (_engine) return _engine;
  _engine = new CanonicalPostingEngine(
    [
      new FinancialPeriodValidator(),
      new TaxPeriodValidator(),
      new AccountExistenceValidator(),
      new BalanceValidator(),
      new IdempotencyValidator(),
      new JournalRuleValidator(),
    ],
    new DrizzleJournalRepository(),
    new DrizzleTaxRepository(),
    new DrizzleAuditRepository(),
    db,
  );
  return _engine;
}
```

Modul caller pakai seperti ini (contoh Sales Invoice, setelah Tahap 3):

```ts
const result = await getPostingEngine().post({
  companyId, journalId, journalCode: "SAL",
  date: new Date(), ref: invoiceNumber, source: "sales_invoice", sourceId: invoiceId,
  createdById: actorId,
  lines: [ /* AR, Sales Income */ ],
  taxes: taxAmt > 0 ? [{ taxId: ppnTaxId, taxType: "PPN_OUTPUT", baseAmount: subtotal,
    taxAmount: taxAmt, glAccountId: settings.ppnOutputAccountId }] : undefined,
});
if (!result.ok) {
  // Tahap 8: explicit error, TIDAK boleh console.warn + continue
  throw new PostingValidationError(result.errorCode ?? "TRANSACTION_FAILED", result.error!);
}
```

## 4. Mengapa desain ini (bukan alternatif lain)

- **Kenapa facade + validator chain, bukan satu fungsi monolitik?** Supaya
  Tahap 5 (sinkronisasi period lock) dan Tahap 4 (proteksi DB tambahan) bisa
  ditambah sebagai validator baru **tanpa menyentuh urutan/logic validator
  lain** — Open/Closed Principle.
- **Kenapa repository interface, bukan langsung panggil Drizzle di engine?**
  Supaya unit test bisa mock repository (Tahap 9) tanpa perlu database nyata
  untuk test validasi logic, dan supaya implementasi SQL tetap bisa reuse
  logic `_postEntryCore` yang sudah battle-tested (Dependency Inversion).
- **Kenapa `taxes` opsional di `PostingRequest` bukan API terpisah?** Supaya
  atomicity jurnal+pajak jadi **default**, bukan sesuatu yang caller harus
  ingat melakukan sendiri (menghilangkan kelas bug P1.4 secara struktural).
- **Kenapa post-commit hooks dipisah dari transaction?** `lockAccountingEntry`
  dan `emitJournalCreated` sudah didesain fire-and-forget di kode existing —
  desain ini mempertahankan itu, hanya merapikannya ke satu tempat yang jelas
  supaya konsisten di semua modul (bukan disalin-tempel tiap tempat seperti
  sekarang).

## 5. Yang TIDAK berubah (kompatibilitas)

- `postEntry()`, `createJournal()`, `_postEntryCore()` tetap ada dan tetap
  berfungsi — dipanggil dari dalam `DrizzleJournalRepository` sebagai
  implementasi, bukan dihapus.
- `AdvanceJournalService`, `PayrollJournalService`, `fleetAccounting.ts`
  **tidak wajib** migrasi ke engine baru di Tahap 3 (mereka sudah disiplin
  satu jalur) — migrasi mereka jadi **opsional/Tahap lanjutan** demi
  mengurangi blast radius. Prioritas Tahap 3 adalah menutup 3 bypass P0 dan
  modul yang paling sering menyentuh pajak (Sales, Purchase, Ecommerce).

## 6. Rencana Tahap 3 (preview — belum dieksekusi)

Urutan migrasi per modul (dari risk paling rendah ke tinggi):
1. `lib/ingestModulePayment.ts` — parameterized, paling mudah dipetakan ke `PostingRequest`.
2. `routes/advances.ts` (koreksi COA) — jalur jarang dipakai, low traffic.
3. `lib/reconciliation/unifiedMatchingEngine.ts` — perlu hati-hati karena
   sengaja dipisah dari tx approval (lihat §2 dependency map); butuh desain
   ulang kecil, bukan sekadar ganti panggilan.
4. `postSalesInvoice()` / `postEcommerceOrder()` — gabungkan pemanggilan
   `recordTransactionTax()` ke dalam `taxes` param sehingga atomic.

Setiap langkah akan saya sajikan dengan format: Masalah → Analisis →
Risiko → Solusi → Kode sebelum/sesudah → SQL Migration → Unit Test →
Integration Test → Dampak modul lain, sesuai permintaan Anda.

---

**Mohon review desain ini sebelum saya lanjut ke Tahap 3 (implementasi kode).**
Yang perlu Anda konfirmasi:
1. Apakah struktur package `lib/posting-engine/` ini cocok, atau Anda mau
   nama/lokasi lain?
2. Apakah boleh saya migrasi `ingestModulePayment.ts` dulu sebagai modul
   percontohan (paling aman, paling mudah diverifikasi), lalu lanjut ke yang
   lain satu per satu?
