import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("journal reversal company context", () => {
  it("resolves the request company before posting and passes that exact value to the posting engine", () => {
    const route = source("src/routes/accounting.ts");
    const handlerStart = route.indexOf('router.post("/entries/:id/reverse"');
    const handlerEnd = route.indexOf('router.patch("/entries/:id/status"', handlerStart);
    const handler = route.slice(handlerStart, handlerEnd);

    expect(handler).toContain("const companyId = resolveCompanyId(req);");
    expect(handler.indexOf("const companyId = resolveCompanyId(req);")).toBeLessThan(
      handler.indexOf("const reversalEntry = await postEntry("),
    );

    const postingInput = handler.match(
      /const reversalEntry = await postEntry\(\s*\{([\s\S]*?)\n\s*\},\s*journal\.code,/,
    )?.[1];

    expect(postingInput).toBeDefined();
    expect(postingInput).toMatch(/sourceId: entry\.id,\s*companyId,\s*lines:/);
    expect(postingInput).not.toContain("entry.companyId ?? companyId");
  });

  it("reuses an existing posted reversal before attempting a second post", () => {
    const route = source("src/routes/accounting.ts");
    const handlerStart = route.indexOf('router.post("/entries/:id/reverse"');
    const handlerEnd = route.indexOf('router.patch("/entries/:id/status"', handlerStart);
    const handler = route.slice(handlerStart, handlerEnd);
    const existingLookup = handler.indexOf("const existingReversals = await db");
    const postAttempt = handler.indexOf("const reversalEntry = await postEntry(");

    expect(existingLookup).toBeGreaterThanOrEqual(0);
    expect(existingLookup).toBeLessThan(postAttempt);
    expect(handler.slice(existingLookup, postAttempt)).toContain('eq(accountingEntriesTable.source, "reversal")');
    expect(handler.slice(existingLookup, postAttempt)).toContain("eq(accountingEntriesTable.sourceId, id)");
    expect(handler.slice(existingLookup, postAttempt)).toContain("eq(accountingEntriesTable.companyId, companyId)");
    expect(handler.slice(existingLookup, postAttempt)).toContain("existingReversal.status !== \"posted\"");
    expect(handler.slice(existingLookup, postAttempt)).toContain("reused: true");
  });
});