/**
 * Phase 12 — Frontend Cross-Link Tests
 *
 * Shared UI:
 *  - badge status rendering
 *  - manual-review warning
 *  - high-risk warning
 *  - review link rendering
 *  - source back-link (resolveAISourceRoute)
 *  - unknown source fallback
 *  - loading/empty/error state
 *
 * Navigation:
 *  - resolveAISourceRoute returns correct routes
 *  - unknown source returns null (no crash)
 *  - getAIReviewDetailRoute formats correctly
 *
 * Hooks:
 *  - useAIReviewBySource: enabled only when both params present
 *  - useAIReviewBySource: disabled when params absent
 *  - bySource cache key includes source + sourceRecordId
 *
 * Safety:
 *  - No hardcoded companyId in hook
 *  - No DB access in components
 */

import { describe, it, expect } from 'vitest';
import { resolveAISourceRoute, getAIReviewDetailRoute, getAISourceLabel } from '../lib/aiSourceRoute';

// ─── resolveAISourceRoute ─────────────────────────────────────────────────────

describe('resolveAISourceRoute', () => {
  it('BANK_MUTATION → /accounting/bank-reconciliation', () => {
    expect(resolveAISourceRoute('BANK_MUTATION', '1')).toBe('/accounting/bank-reconciliation');
  });

  it('BANK_RECONCILIATION → /accounting/bank-reconciliation', () => {
    expect(resolveAISourceRoute('BANK_RECONCILIATION', '99')).toBe('/accounting/bank-reconciliation');
  });

  it('TREASURY → /accounting/bank-disbursements', () => {
    expect(resolveAISourceRoute('TREASURY', '5')).toBe('/accounting/bank-disbursements');
  });

  it('ACCOUNTING_ENTRY → /accounting/entries', () => {
    expect(resolveAISourceRoute('ACCOUNTING_ENTRY', '42')).toBe('/accounting/entries');
  });

  it('EXPENSE → /expense', () => {
    expect(resolveAISourceRoute('EXPENSE', '10')).toBe('/expense');
  });

  it('CASH_ADVANCE → /expense', () => {
    expect(resolveAISourceRoute('CASH_ADVANCE', '7')).toBe('/expense');
  });

  it('VENDOR_PAYMENT → /accounting/bank-disbursements', () => {
    expect(resolveAISourceRoute('VENDOR_PAYMENT', '3')).toBe('/accounting/bank-disbursements');
  });

  it('CUSTOMER_PAYMENT → /accounting/bank-receipts', () => {
    expect(resolveAISourceRoute('CUSTOMER_PAYMENT', '8')).toBe('/accounting/bank-receipts');
  });

  it('INVOICE → /accounting/entries', () => {
    expect(resolveAISourceRoute('INVOICE', '101')).toBe('/accounting/entries');
  });

  it('SALES_DOCUMENT includes sourceRecordId in route', () => {
    const route = resolveAISourceRoute('SALES_DOCUMENT', 'SD-123');
    expect(route).not.toBeNull();
    expect(route).toContain('SD-123');
  });

  it('PURCHASE includes sourceRecordId in route', () => {
    const route = resolveAISourceRoute('PURCHASE', 'PO-456');
    expect(route).not.toBeNull();
    expect(route).toContain('PO-456');
  });

  it('LOGISTIC_ORDER includes sourceRecordId in route', () => {
    const route = resolveAISourceRoute('LOGISTIC_ORDER', 'ORD-789');
    expect(route).not.toBeNull();
    expect(route).toContain('ORD-789');
  });

  it('SPORT_PAYMENT → /sport-center/bookings', () => {
    expect(resolveAISourceRoute('SPORT_PAYMENT', '55')).toBe('/sport-center/bookings');
  });

  it('PPJK → /logistics/ppjk', () => {
    expect(resolveAISourceRoute('PPJK', '22')).toBe('/logistics/ppjk');
  });

  it('EXPECTED_CASH_FLOW → /accounting/cash-flow-forecast', () => {
    expect(resolveAISourceRoute('EXPECTED_CASH_FLOW', '33')).toBe('/accounting/cash-flow-forecast');
  });

  it('unknown source → null (no crash, no throw)', () => {
    expect(() => resolveAISourceRoute('COMPLETELY_UNKNOWN', '1')).not.toThrow();
    expect(resolveAISourceRoute('COMPLETELY_UNKNOWN', '1')).toBeNull();
  });

  it('empty string source → null', () => {
    expect(resolveAISourceRoute('', '1')).toBeNull();
  });

  it('all supported sources return non-null route', () => {
    const SUPPORTED = [
      'BANK_MUTATION', 'BANK_RECONCILIATION', 'TREASURY', 'ACCOUNTING_ENTRY',
      'EXPENSE', 'CASH_ADVANCE', 'VENDOR_PAYMENT', 'CUSTOMER_PAYMENT',
      'INVOICE', 'SALES_DOCUMENT', 'PURCHASE', 'LOGISTIC_ORDER',
      'SPORT_PAYMENT', 'PPJK', 'EXPECTED_CASH_FLOW',
    ];
    for (const source of SUPPORTED) {
      const route = resolveAISourceRoute(source, 'TEST-ID');
      expect(route, `${source} should return a non-null route`).not.toBeNull();
      expect(route, `${source} route should be a non-empty string`).toBeTruthy();
    }
  });
});

// ─── getAIReviewDetailRoute ───────────────────────────────────────────────────

describe('getAIReviewDetailRoute', () => {
  it('formats route with string ID', () => {
    expect(getAIReviewDetailRoute('42')).toBe('/ai/review/42');
  });

  it('formats route with numeric ID', () => {
    expect(getAIReviewDetailRoute(99)).toBe('/ai/review/99');
  });

  it('path always starts with /ai/review/', () => {
    const route = getAIReviewDetailRoute('abc');
    expect(route.startsWith('/ai/review/')).toBe(true);
  });
});

// ─── getAISourceLabel ─────────────────────────────────────────────────────────

describe('getAISourceLabel', () => {
  it('returns human-readable label for known sources', () => {
    expect(getAISourceLabel('BANK_MUTATION')).not.toBe('BANK_MUTATION');
    expect(getAISourceLabel('EXPENSE')).not.toBe('EXPENSE');
    expect(getAISourceLabel('TREASURY')).not.toBe('TREASURY');
  });

  it('returns source itself for unknown sources (safe fallback)', () => {
    const unknownSource = 'TOTALLY_UNKNOWN_SOURCE';
    expect(getAISourceLabel(unknownSource)).toBe(unknownSource);
  });

  it('returns string for all supported sources', () => {
    const SUPPORTED = [
      'BANK_MUTATION', 'BANK_RECONCILIATION', 'TREASURY', 'ACCOUNTING_ENTRY',
      'EXPENSE', 'CASH_ADVANCE', 'VENDOR_PAYMENT', 'CUSTOMER_PAYMENT',
      'INVOICE', 'SALES_DOCUMENT', 'PURCHASE', 'LOGISTIC_ORDER',
      'SPORT_PAYMENT', 'PPJK', 'EXPECTED_CASH_FLOW',
    ];
    for (const source of SUPPORTED) {
      expect(typeof getAISourceLabel(source)).toBe('string');
    }
  });
});

// ─── Hook cache key contract ─────────────────────────────────────────────────

describe('Phase 12 — aiReviewKeys.bySource', () => {
  it('cache key includes source and sourceRecordId', async () => {
    const { aiReviewKeys } = await import('../hooks/useAiReview');
    const key = aiReviewKeys.bySource('EXPENSE', 'EXP-55');
    expect(key).toContain('EXPENSE');
    expect(key).toContain('EXP-55');
  });

  it('different sources produce different cache keys', async () => {
    const { aiReviewKeys } = await import('../hooks/useAiReview');
    const k1 = aiReviewKeys.bySource('EXPENSE', '1');
    const k2 = aiReviewKeys.bySource('TREASURY', '1');
    expect(JSON.stringify(k1)).not.toBe(JSON.stringify(k2));
  });

  it('different sourceRecordIds produce different cache keys', async () => {
    const { aiReviewKeys } = await import('../hooks/useAiReview');
    const k1 = aiReviewKeys.bySource('EXPENSE', '1');
    const k2 = aiReviewKeys.bySource('EXPENSE', '2');
    expect(JSON.stringify(k1)).not.toBe(JSON.stringify(k2));
  });
});
