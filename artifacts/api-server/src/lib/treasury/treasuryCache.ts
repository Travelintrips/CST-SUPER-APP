/**
 * Treasury Cache — In-memory TTL cache for Treasury Batch 4.
 *
 * Reuses the CacheProvider interface established by reconCache.ts.
 * Keys:
 *   dashboard:{companyId}            TTL: configurable (default 60s)
 *   cash-position:{companyId}:{asOf} TTL: configurable (default 30s)
 *   forecast:{companyId}:{date}      TTL: configurable (default 120s)
 *   liquidity:{companyId}:{date}     TTL: configurable (default 120s)
 *   risk:{companyId}:{asOf}          TTL: configurable (default 30s)
 *
 * Invalidated on: posting, reversal, allocation, forecast refresh.
 */

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRatio: number;
}

export interface TreasuryCacheProvider {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttlMs: number): void;
  invalidate(pattern: string): void;
  invalidateCompany(companyId: number): void;
  keys(): string[];
  stats(): CacheStats;
  clear(): void;
}

// ── TTL defaults (ms) — configurable via env ──────────────────────────────────
export const TREASURY_TTL = {
  DASHBOARD:      Number(process.env.TREASURY_CACHE_DASHBOARD_TTL_MS  ?? 60_000),
  CASH_POSITION:  Number(process.env.TREASURY_CACHE_POSITION_TTL_MS   ?? 30_000),
  FORECAST:       Number(process.env.TREASURY_CACHE_FORECAST_TTL_MS   ?? 120_000),
  LIQUIDITY:      Number(process.env.TREASURY_CACHE_LIQUIDITY_TTL_MS  ?? 120_000),
  RISK:           Number(process.env.TREASURY_CACHE_RISK_TTL_MS       ?? 30_000),
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TreasuryCacheImpl implements TreasuryCacheProvider {
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Invalidate all keys matching a prefix pattern. */
  invalidate(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern) || key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }

  /** Invalidate all cached entries for a specific company. */
  invalidateCompany(companyId: number): void {
    const prefix = `:${companyId}`;
    for (const key of this.store.keys()) {
      if (key.includes(prefix)) {
        this.store.delete(key);
      }
    }
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  stats(): CacheStats {
    // Evict expired entries during stats collection
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      hitRatio: total === 0 ? 0 : this.hits / total,
    };
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// Singleton — shared across all treasury modules in this process
export const treasuryCache: TreasuryCacheProvider = new TreasuryCacheImpl();

// ── Cache key helpers ─────────────────────────────────────────────────────────

export const CK = {
  dashboard:    (companyId: number)                 => `dashboard:${companyId}`,
  cashPosition: (companyId: number, asOf: string)   => `cash-position:${companyId}:${asOf}`,
  forecast:     (companyId: number, date: string)   => `forecast:${companyId}:${date}`,
  liquidity:    (companyId: number, date: string)   => `liquidity:${companyId}:${date}`,
  risk:         (companyId: number, asOf: string)   => `risk:${companyId}:${asOf}`,
};

/**
 * Call this after posting, reversal, or allocation to bust treasury caches
 * for the affected company.
 */
export function invalidateTreasuryCache(companyId: number): void {
  treasuryCache.invalidateCompany(companyId);
}
