import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const airSource = readFileSync(
  new URL("../routes/airFreightPublic.ts", import.meta.url),
  "utf8",
);

describe("public tracking disclosure", () => {
  it("keeps the legacy air-tracking alias rate-limited and status-safe", () => {
    const start = airSource.indexOf('router.get("/public/track/:orderNumber"');
    const end = airSource.indexOf("// ── GET /approval/:token", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const route = airSource.slice(start, end);
    expect(route).toContain("publicTrackingLimit");
    expect(route).toContain("o.order_number");
    expect(route).toContain("o.status");
    expect(route).not.toContain("o.customer_name");
    expect(route).not.toContain("o.chargeable_weight");
    expect(route).not.toContain("o.grand_total");
    expect(route).not.toContain("o.final_price_idr");
    expect(route).not.toContain("event.note");
    expect(route).not.toContain("res.json({ order: r.rows[0], events: events.rows })");
  });
});