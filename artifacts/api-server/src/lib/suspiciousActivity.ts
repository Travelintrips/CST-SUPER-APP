/**
 * Suspicious Activity Detection — S4.5 Part E
 *
 * In-memory per-IP counters for:
 *   - failed_login  : >20 / hour  → SECURITY_ALERT
 *   - expired_token : >50 / hour  → SECURITY_ALERT
 *   - rate_limit    : >100 / day  → SECURITY_ALERT
 *
 * Fire-and-forget: emits SECURITY_ALERT via writeAuditLog when thresholds exceeded.
 * Counter windows are bucket-based (hourly / daily UTC).
 */

import { writeAuditLog } from "./auditLog.js";

const IS_DEV = process.env.NODE_ENV !== "production";

const THRESHOLDS = {
  failed_login:  IS_DEV ? 100000 : 20,
  expired_token: IS_DEV ? 100000 : 50,
  rate_limit:    IS_DEV ? 100000 : 100,
} as const;

type EventType = keyof typeof THRESHOLDS;

interface BucketEntry { count: number; alerted: boolean }

const hourlyBuckets = new Map<string, BucketEntry>();
const dailyBuckets  = new Map<string, BucketEntry>();

function hourBucket()  { const d = new Date(); return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`; }
function dayBucket()   { const d = new Date(); return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`; }

function getOrCreate(map: Map<string, BucketEntry>, key: string): BucketEntry {
  let e = map.get(key);
  if (!e) { e = { count: 0, alerted: false }; map.set(key, e); }
  return e;
}

function emitAlert(type: EventType, ip: string, count: number, window: string): void {
  writeAuditLog({
    action: "SECURITY_ALERT",
    module: "security",
    ipAddress: ip,
    newData: {
      severity: "HIGH",
      ruleType: type,
      count,
      window,
      timestamp: new Date().toISOString(),
      message: `Suspicious activity: ${count} ${type.replace("_", " ")} events from IP ${ip} in the last ${window}`,
    },
  });
}

/**
 * Call this whenever a security-relevant event occurs.
 * Tracks per-IP counters and emits SECURITY_ALERT if thresholds are crossed.
 */
export function trackSuspiciousActivity(type: EventType, ip: string): void {
  if (!ip || ip === "unknown") return;

  const window = type === "rate_limit" ? "day" : "hour";
  const store  = window === "day" ? dailyBuckets : hourlyBuckets;
  const bucket = window === "day" ? dayBucket()  : hourBucket();
  const key    = `${type}:${ip}:${bucket}`;
  const entry  = getOrCreate(store, key);

  entry.count++;

  if (!entry.alerted && entry.count > THRESHOLDS[type]) {
    entry.alerted = true;
    emitAlert(type, ip, entry.count, window === "day" ? "24 hours" : "1 hour");
  }
}

// ── Cleanup stale buckets every 2 hours ───────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  const hourCutoff = now - 2 * 60 * 60 * 1000;
  const dayCutoff  = now - 25 * 60 * 60 * 1000;

  for (const key of hourlyBuckets.keys()) {
    const parts = key.split(":");
    const bucketStr = parts[parts.length - 1]!;
    const [y, mo, d, h] = bucketStr.split("-").map(Number);
    const bucketTs = new Date(y!, mo!, d!, h!, 0, 0).getTime();
    if (bucketTs < hourCutoff) hourlyBuckets.delete(key);
  }

  for (const key of dailyBuckets.keys()) {
    const parts = key.split(":");
    const bucketStr = parts[parts.length - 1]!;
    const [y, mo, d] = bucketStr.split("-").map(Number);
    const bucketTs = new Date(y!, mo!, d!, 0, 0, 0).getTime();
    if (bucketTs < dayCutoff) dailyBuckets.delete(key);
  }
}, 2 * 60 * 60 * 1000);
