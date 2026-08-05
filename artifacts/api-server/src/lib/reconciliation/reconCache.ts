/**
 * Recon Cache — Provider-agnostic in-process cache
 *
 * Design:
 *  - CacheProvider interface allows swapping Memory → Redis → any provider
 *  - Default: MemoryCacheProvider (Map + TTL, no external deps)
 *  - Per-company keys: "rules:{companyId}", "ecf:{companyId}"
 *  - Invalidation: exact key or prefix pattern
 *  - Stats: hitCount, missCount, size (for /cache/status endpoint)
 *
 * Jangan cache hasil approval. TTL dikonfigurasi per-company via recon_cache_metadata.
 */

import type { ReconRule } from "./reconRuleEngine.js";

// ─── Provider Interface ────────────────────────────────────────────────────────

export interface CacheStats {
  size: number;
  hitCount: number;
  missCount: number;
  hitRatio: number;
}

export interface CacheProvider {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttlMs: number): void;
  /** Invalidate all keys whose key string includes `pattern` */
  invalidate(pattern: string): void;
  keys(): string[];
  stats(): CacheStats;
  clear(): void;
}

// ─── Memory Implementation ────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // epoch ms
}

export class MemoryCacheProvider implements CacheProvider {
  private store = new Map<string, CacheEntry<unknown>>();
  private hitCount = 0;
  private missCount = 0;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return null;
    }
    this.hitCount++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }

  keys(): string[] {
    return [...this.store.keys()];
  }

  stats(): CacheStats {
    // Evict expired first
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) this.store.delete(k);
    }
    const total = this.hitCount + this.missCount;
    return {
      size: this.store.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRatio: total === 0 ? 0 : Math.round((this.hitCount / total) * 10000) / 100,
    };
  }

  clear(): void {
    this.store.clear();
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const reconCache: CacheProvider = new MemoryCacheProvider();

// ─── Default TTL constants (ms) ────────────────────────────────────────────────

export const DEFAULT_RULE_TTL_MS = 5 * 60 * 1000;   // 5 minutes
export const DEFAULT_ECF_TTL_MS  = 2 * 60 * 1000;   // 2 minutes

// ─── Key builders ─────────────────────────────────────────────────────────────

function rulesKey(companyId: number) {
  return `rules:${companyId}`;
}

function ecfKey(companyId: number) {
  return `ecf:${companyId}`;
}

// ─── Rules Cache ──────────────────────────────────────────────────────────────

export function getCachedActiveRules(companyId: number): ReconRule[] | null {
  return reconCache.get<ReconRule[]>(rulesKey(companyId));
}

export function setCachedActiveRules(
  companyId: number,
  rules: ReconRule[],
  ttlMs = DEFAULT_RULE_TTL_MS,
): void {
  reconCache.set(rulesKey(companyId), rules, ttlMs);
}

export function invalidateRulesCache(companyId: number): void {
  reconCache.invalidate(rulesKey(companyId));
}

// ─── ECF Cache ────────────────────────────────────────────────────────────────

export function getCachedEcf<T>(companyId: number): T | null {
  return reconCache.get<T>(ecfKey(companyId));
}

export function setCachedEcf<T>(
  companyId: number,
  value: T,
  ttlMs = DEFAULT_ECF_TTL_MS,
): void {
  reconCache.set(ecfKey(companyId), value, ttlMs);
}

export function invalidateEcfCache(companyId: number): void {
  reconCache.invalidate(ecfKey(companyId));
}

// ─── Company-wide invalidation ─────────────────────────────────────────────────

export function invalidateCompanyCache(companyId: number): void {
  invalidateRulesCache(companyId);
  invalidateEcfCache(companyId);
}
