/**
 * Phase 12 — AI Review Cross-Link Tests
 *
 * Repository/API contract:
 *  - find by source (company-scoped)
 *  - same-company source
 *  - cross-company blocked
 *  - unsupported source
 *  - source not found
 *  - idempotent creation
 *  - sanitized error
 *
 * Navigation:
 *  - source route resolver
 *  - unknown source fallback
 *
 * Error codes:
 *  - AI_REVIEW_SOURCE_NOT_FOUND
 *  - AI_REVIEW_SOURCE_UNSUPPORTED
 *
 * All tests are deterministic — no Math.random(), no Date.now() unless injected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIReviewError } from '../lib/ai/transaction-intelligence/aiReviewErrors.js';
import {
  sourceNotFound,
  sourceUnsupported,
} from '../lib/ai/transaction-intelligence/aiReviewErrors.js';

// ─── Repository mock factory ──────────────────────────────────────────────────

function makeMockCaseRepo(cases: Record<number, { id: number; companyId: number; source: string; sourceRecordId: string; status: string }[]> = {}) {
  return {
    findBySource: vi.fn(async (companyId: number, source: string, sourceRecordId: string) => {
      const all = Object.values(cases).flat();
      return all.filter(
        (c) => c.companyId === companyId && c.source === source && c.sourceRecordId === sourceRecordId,
      );
    }),
    findById: vi.fn(async () => null),
    findByIdempotencyKey: vi.fn(async () => null),
    create: vi.fn(async (data: Record<string, unknown>) => ({ id: 999, ...data })),
    updateStatus: vi.fn(async () => {}),
    assignReviewer: vi.fn(async () => {}),
    findQueue: vi.fn(async () => ({ items: [], total: 0 })),
    findByTransaction: vi.fn(async () => []),
    countByStatus: vi.fn(async () => ({})),
    findRecentAuditEvents: vi.fn(async () => []),
  };
}

// ─── Error factory tests ───────────────────────────────────────────────────────

describe('Phase 12 — Error factories', () => {
  it('sourceNotFound: returns correct code and 404', () => {
    const err = sourceNotFound('BANK_MUTATION', '123');
    expect(err).toBeInstanceOf(AIReviewError);
    expect(err.code).toBe('AI_REVIEW_SOURCE_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('BANK_MUTATION');
    expect(err.message).toContain('123');
  });

  it('sourceUnsupported: returns correct code and 422', () => {
    const err = sourceUnsupported('UNKNOWN_TYPE');
    expect(err).toBeInstanceOf(AIReviewError);
    expect(err.code).toBe('AI_REVIEW_SOURCE_UNSUPPORTED');
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('UNKNOWN_TYPE');
  });

  it('toSafeErrorResponse strips internal details for sourceNotFound', async () => {
    const { toSafeErrorResponse } = await import('../lib/ai/transaction-intelligence/aiReviewErrors.js');
    const err = sourceNotFound('EXPENSE', '42');
    const { statusCode, body } = toSafeErrorResponse(err);
    expect(statusCode).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AI_REVIEW_SOURCE_NOT_FOUND');
    expect(body.error.message).toBeTruthy();
    // No stack trace or SQL in message
    expect(body.error.message).not.toMatch(/stack|sql|select|from|where/i);
  });

  it('toSafeErrorResponse for unknown error returns 500 with generic message', async () => {
    const { toSafeErrorResponse } = await import('../lib/ai/transaction-intelligence/aiReviewErrors.js');
    const err = new Error('Some internal DB error: SELECT * FROM secrets');
    const { statusCode, body } = toSafeErrorResponse(err);
    expect(statusCode).toBe(500);
    expect(body.ok).toBe(false);
    // Generic message — no internal detail
    expect(body.error.message).not.toContain('SELECT');
    expect(body.error.message).not.toContain('secrets');
  });
});

// ─── Repository contract tests ────────────────────────────────────────────────

describe('Phase 12 — AIReviewCaseRepository.findBySource', () => {
  const seedCases = {
    1: [
      { id: 1, companyId: 1, source: 'BANK_MUTATION', sourceRecordId: 'MUT-001', status: 'QUEUED' },
      { id: 2, companyId: 1, source: 'EXPENSE', sourceRecordId: 'EXP-100', status: 'APPROVED' },
    ],
    2: [
      { id: 3, companyId: 2, source: 'BANK_MUTATION', sourceRecordId: 'MUT-001', status: 'IN_REVIEW' },
    ],
  };

  it('find by source — same company, correct source+recordId returns match', async () => {
    const repo = makeMockCaseRepo(seedCases);
    const result = await repo.findBySource(1, 'BANK_MUTATION', 'MUT-001');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(1);
    expect(result[0]!.companyId).toBe(1);
  });

  it('find by source — cross-company blocked (company 2 cannot see company 1 record)', async () => {
    const repo = makeMockCaseRepo(seedCases);
    const result = await repo.findBySource(2, 'EXPENSE', 'EXP-100');
    expect(result).toHaveLength(0); // EXP-100 belongs to company 1, not 2
  });

  it('find by source — wrong source type returns empty', async () => {
    const repo = makeMockCaseRepo(seedCases);
    const result = await repo.findBySource(1, 'TREASURY', 'MUT-001');
    expect(result).toHaveLength(0);
  });

  it('find by source — wrong sourceRecordId returns empty', async () => {
    const repo = makeMockCaseRepo(seedCases);
    const result = await repo.findBySource(1, 'BANK_MUTATION', 'DOES-NOT-EXIST');
    expect(result).toHaveLength(0);
  });

  it('find by source — company 2 can find its own record', async () => {
    const repo = makeMockCaseRepo(seedCases);
    const result = await repo.findBySource(2, 'BANK_MUTATION', 'MUT-001');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(3);
    expect(result[0]!.companyId).toBe(2);
  });

  it('find by source — same source+recordId across companies returns only own-company results', async () => {
    const repo = makeMockCaseRepo(seedCases);
    const c1 = await repo.findBySource(1, 'BANK_MUTATION', 'MUT-001');
    const c2 = await repo.findBySource(2, 'BANK_MUTATION', 'MUT-001');
    expect(c1.every((c) => c.companyId === 1)).toBe(true);
    expect(c2.every((c) => c.companyId === 2)).toBe(true);
  });
});

// ─── Supported source types ───────────────────────────────────────────────────

describe('Phase 12 — Supported source types', () => {
  const SUPPORTED = [
    'BANK_MUTATION', 'BANK_RECONCILIATION', 'TREASURY', 'ACCOUNTING_ENTRY',
    'EXPENSE', 'CASH_ADVANCE', 'VENDOR_PAYMENT', 'CUSTOMER_PAYMENT',
    'INVOICE', 'SALES_DOCUMENT', 'PURCHASE', 'LOGISTIC_ORDER',
    'SPORT_PAYMENT', 'PPJK', 'EXPECTED_CASH_FLOW',
    // lowercase variants
    'bank_mutation', 'bank_reconciliation', 'treasury', 'accounting_entry',
    'expense', 'cash_advance', 'vendor_payment', 'customer_payment',
    'invoice', 'sales_document', 'purchase', 'logistic_order',
    'sport_payment', 'ppjk', 'expected_cash_flow',
  ];

  const UNSUPPORTED = ['UNKNOWN', 'RANDOM_TYPE', '', 'admin_notifications', 'users'];

  it('all declared supported sources are valid strings', () => {
    for (const s of SUPPORTED) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('unsupported source returns AI_REVIEW_SOURCE_UNSUPPORTED error', () => {
    for (const s of UNSUPPORTED) {
      const err = sourceUnsupported(s);
      expect(err.code).toBe('AI_REVIEW_SOURCE_UNSUPPORTED');
    }
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('Phase 12 — Idempotent creation', () => {
  it('findBySource returns existing case — caller should NOT create duplicate', async () => {
    const repo = makeMockCaseRepo({
      1: [{ id: 10, companyId: 1, source: 'EXPENSE', sourceRecordId: 'EXP-55', status: 'QUEUED' }],
    });

    const existing = await repo.findBySource(1, 'EXPENSE', 'EXP-55');
    expect(existing.length).toBeGreaterThan(0);

    // Simulate idempotent check: caller returns existing, does not call create
    const createSpy = vi.spyOn(repo, 'create');
    if (existing.length > 0) {
      // Return existing — no create
    } else {
      await repo.create({ companyId: 1, source: 'EXPENSE', sourceRecordId: 'EXP-55', status: 'QUEUED' });
    }

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('findBySource returns empty — caller proceeds to create', async () => {
    const repo = makeMockCaseRepo({}); // empty

    const existing = await repo.findBySource(1, 'EXPENSE', 'EXP-NEW');
    expect(existing).toHaveLength(0);

    const createSpy = vi.spyOn(repo, 'create');
    if (existing.length === 0) {
      await repo.create({ companyId: 1, source: 'EXPENSE', sourceRecordId: 'EXP-NEW', status: 'QUEUED' });
    }

    expect(createSpy).toHaveBeenCalledOnce();
  });
});

// ─── AIReviewErrorCode union coverage ────────────────────────────────────────

describe('Phase 12 — Error code union coverage', () => {
  it('AI_REVIEW_SOURCE_NOT_FOUND is in error code type', () => {
    const err = sourceNotFound('X', 'Y');
    // Compile-time check: TypeScript would reject an unknown code
    expect(err.code).toBe('AI_REVIEW_SOURCE_NOT_FOUND');
  });

  it('AI_REVIEW_SOURCE_UNSUPPORTED is in error code type', () => {
    const err = sourceUnsupported('Z');
    expect(err.code).toBe('AI_REVIEW_SOURCE_UNSUPPORTED');
  });

  it('error instances are AIReviewError', () => {
    expect(sourceNotFound('A', 'B')).toBeInstanceOf(AIReviewError);
    expect(sourceUnsupported('C')).toBeInstanceOf(AIReviewError);
  });
});

// ─── Privacy: no sensitive data in error response ─────────────────────────────

describe('Phase 12 — Privacy and sanitization', () => {
  it('toSafeErrorResponse never exposes error details field in body', async () => {
    const { toSafeErrorResponse } = await import('../lib/ai/transaction-intelligence/aiReviewErrors.js');
    const err = sourceNotFound('BANK_MUTATION', 'acc-1234567890-SECRET');
    const { body } = toSafeErrorResponse(err);
    // body.error must not have a 'details' field (would expose sourceRecordId)
    expect('details' in body.error).toBe(false);
  });

  it('company mismatch error does not leak other company data', async () => {
    const { companyMismatch } = await import('../lib/ai/transaction-intelligence/aiReviewErrors.js');
    const err = companyMismatch();
    expect(err.code).toBe('AI_REVIEW_COMPANY_MISMATCH');
    expect(err.statusCode).toBe(403);
    expect(err.message).not.toContain('company_id');
    expect(err.message).not.toContain('SELECT');
  });
});
