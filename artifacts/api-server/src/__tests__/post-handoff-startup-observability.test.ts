import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiIndex = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");

describe("post-marketplace handoff startup observability", () => {
  it("wraps the legacy continuation before pre-start marker completion", () => {
    const handoff = apiIndex.indexOf(
      'runPreStartSubstep("marketplace_accounting_handoff", runMktAccountingHandoffMigration)',
    );
    const continuation = apiIndex.indexOf(
      'runPreStartSubstep(\n    "legacy_pre_start_schema_continuation"',
      handoff,
    );
    const marker = apiIndex.indexOf(
      'markStartupSubstepStarting("api_pre_start_schema_marker_completion")',
      continuation,
    );

    expect(handoff).toBeGreaterThan(-1);
    expect(continuation).toBeGreaterThan(handoff);
    expect(marker).toBeGreaterThan(continuation);
    expect(apiIndex).toContain("legacy_pre_start_schema_continuation");
    expect(apiIndex).toContain("600_000");
  });

  it("keeps the continuation on the existing bounded substep state machine", () => {
    const wrapper = apiIndex.slice(
      apiIndex.indexOf('runPreStartSubstep(\n    "legacy_pre_start_schema_continuation"'),
      apiIndex.indexOf('markStartupSubstepStarting("api_pre_start_schema_marker_completion")'),
    );

    expect(wrapper).toContain("runPreStartSubstep");
    expect(wrapper).toContain("db.execute");
    expect(wrapper).not.toContain("markStartupMigrationComplete");
  });
});