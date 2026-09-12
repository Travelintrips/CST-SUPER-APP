import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { shortLinksTable, type ShortLink } from "@workspace/db/schema";
import { getPreferredDomain } from "./domain.js";
import { logger } from "./logger.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 8): string {
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

export interface GenerateShortLinkOpts {
  context?: string;
  refType?: string;
  refId?: string;
  expiresAt?: Date | null;
  prefix?: string;
}

/**
 * Generate a secure short link for a long URL.
 * Returns the absolute short URL, e.g. https://example.com/q/AB12CD34
 */
export async function generateShortLink(
  targetUrl: string,
  opts: GenerateShortLinkOpts = {},
): Promise<string> {
  if (!targetUrl) return targetUrl;
  const domain = getPreferredDomain();
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = (opts.prefix ?? "") + randomCode(8);
    try {
      await db.insert(shortLinksTable).values({
        code: candidate,
        targetUrl,
        context: opts.context ?? "general",
        refType: opts.refType,
        refId: opts.refId,
        expiresAt: opts.expiresAt ?? null,
      });
      code = candidate;
      break;
    } catch (err) {
      logger.warn({ err, attempt }, "shortLink: code collision, retrying");
    }
  }
  if (!code) {
    logger.error({ targetUrl }, "shortLink: failed to generate code, returning long URL");
    return targetUrl;
  }
  return domain ? `https://${domain}/q/${code}` : `/q/${code}`;
}

export async function resolveShortLink(code: string): Promise<string | null> {
  const [row] = await db.select().from(shortLinksTable).where(eq(shortLinksTable.code, code));
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  db.update(shortLinksTable)
    .set({ hitCount: row.hitCount + 1 })
    .where(eq(shortLinksTable.id, row.id))
    .catch((err) => logger.warn({ err }, "shortLink: hit count update failed"));
  return row.targetUrl;
}

/**
 * Look up a short link row regardless of expiry status.
 * Returns null only if the code doesn't exist at all.
 */
export async function lookupShortLinkRow(code: string): Promise<ShortLink | null> {
  const [row] = await db.select().from(shortLinksTable).where(eq(shortLinksTable.code, code));
  return row ?? null;
}
