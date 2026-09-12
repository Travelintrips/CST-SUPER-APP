import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const dbSourcePath = path.resolve(
  process.cwd(),
  "../../lib/db/src/index.ts",
);

describe("Supabase pooler connection regression", () => {
  it("does not send search_path as an unsupported startup option", () => {
    const source = fs.readFileSync(dbSourcePath, "utf8");
    const poolBlock = source.slice(
      source.indexOf("export const pool = new Pool"),
      source.indexOf("// ── endPool"),
    );

    expect(poolBlock).not.toMatch(/\boptions\s*:/);
  });

  it("applies session settings after each compatible connection", () => {
    const source = fs.readFileSync(dbSourcePath, "utf8");
    const connectionBlock = source.slice(
      source.indexOf('pool.on("connect"'),
      source.indexOf("// ── Pool-level ECIRCUITBREAKER"),
    );

    expect(connectionBlock).toContain("SET search_path = public");
    expect(connectionBlock).toContain("SET lock_timeout = '20s'");
    expect(connectionBlock).toContain("SET sport_center.finance_mode");
  });
});