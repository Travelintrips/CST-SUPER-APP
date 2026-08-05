/**
 * AI Learning Center — Route Tests
 * Tests for /api/ai-review/* endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { aiLearningCenterRouter } from '../aiLearningCenter.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@workspace/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  },
  aiLearningFeedbackTable: { companyId: 'company_id', status: 'status', createdAt: 'created_at' },
  aiRuleRecommendationPackagesTable: { companyId: 'company_id', status: 'status', createdAt: 'created_at' },
}));

vi.mock('../../lib/resolveCompany.js', () => ({
  resolveCompanyId: vi.fn(() => 1),
}));

vi.mock('../../lib/requireAdmin.js', () => ({
  requireAdmin: vi.fn(async () => true),
  requireRole: vi.fn(async (_req: unknown, _res: unknown, _roles: unknown) => true),
}));

vi.mock('../../lib/ai/transaction-intelligence/aiReviewRepository.js', () => ({
  aiRuleRecommendationRepo: {
    listPending: vi.fn(async () => []),
    findById: vi.fn(async () => null),
  },
}));

vi.mock('../../lib/ai/transaction-intelligence/aiReviewErrors.js', () => ({
  toSafeErrorResponse: vi.fn((err: unknown) => ({
    statusCode: 500,
    body: { error: String(err) },
  })),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

// ── Test app ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-review', aiLearningCenterRouter);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/ai-review/learning', () => {
  it('returns empty patterns when no feedback', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/ai-review/learning');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.patterns).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});

describe('GET /api/ai-review/learning/:id', () => {
  it('returns 404 for unknown pattern id', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/ai-review/learning/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/ai-review/recommendations', () => {
  it('returns empty recommendations when none exist', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/ai-review/recommendations');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.recommendations).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});

describe('GET /api/ai-review/recommendations/:id', () => {
  it('returns 400 for non-numeric id', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/ai-review/recommendations/abc');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 for unknown numeric id', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/ai-review/recommendations/999');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/ai-review/statistics', () => {
  it('returns zeroed statistics when no data', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/ai-review/statistics');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const d = res.body.data;
    expect(d.accuracy).toBe(0);
    expect(d.falsePositive).toBe(0);
    expect(d.manualCorrections).toBe(0);
    expect(d.approvedRules).toBe(0);
    expect(d.pendingRules).toBe(0);
    expect(d.ignoredRules).toBe(0);
    expect(d.learningPatterns).toBe(0);
  });
});

describe('GET /api/ai-review/rules/suggestions', () => {
  it('returns empty suggestions when no pending packages', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/ai-review/rules/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.suggestions).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});
