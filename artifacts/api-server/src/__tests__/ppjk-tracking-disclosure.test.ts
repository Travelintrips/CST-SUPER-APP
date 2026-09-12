import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routes/ppjk.ts", import.meta.url), "utf8");

describe("PPJK public tracking disclosure", () => {
  it("rate-limits public lookup and excludes customs-sensitive fields", () => {
    const start = source.indexOf('router.get(["/public/track/:orderNumber"');
    const end = source.indexOf("// ── GET /api/ppjk/orders", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const route = source.slice(start, end);
    expect(route).toContain("publicTrackingLimit");
    expect(route).toContain("status: ppjkOrdersTable.status");
    expect(route).not.toContain("ppjkOrdersTable.hsCode");
    expect(route).not.toContain("ppjkOrdersTable.nomorPib");
    expect(route).not.toContain("ppjkOrdersTable.nomorSppb");
    expect(route).not.toContain("ppjkOrdersTable.grossWeight");
    expect(route).not.toContain("ppjkStatusLogsTable.notes");
    expect(route).not.toContain("ppjkAuditLogsTable.notes");
  });
});