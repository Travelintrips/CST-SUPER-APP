/**
 * Child COA creation regression contract.
 *
 * The child-account route derives a code inside a transaction, so the most
 * important parts of this flow are easy to regress while changing migrations:
 * legacy sibling formats, company-wide code collisions, and a stale SERIAL
 * sequence must all be handled before the request is reported as failed.
 *
 * These tests intentionally inspect the route's executable contract rather
 * than opening a shared database. Live database mutation belongs in the
 * isolated runtime harnesses; this suite must remain safe without one.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const accountingRoute = readFileSync(
  resolve(process.cwd(), "src/routes/accounting.ts"),
  "utf8",
);
const childRouteStart = accountingRoute.indexOf('router.post("/accounts/:id/child"');
const childRouteEnd = accountingRoute.indexOf('router.patch("/accounts/:id"', childRouteStart);
const childRoute = accountingRoute.slice(childRouteStart, childRouteEnd);
const accountingSchema = readFileSync(
  resolve(process.cwd(), "../../lib/db/src/schema/accounting.ts"),
  "utf8",
);

describe("child COA code generation", () => {
  it("supports legacy sibling codes and continues the existing tens sequence", () => {
    expect(childRouteStart).toBeGreaterThanOrEqual(0);
    expect(childRouteEnd).toBeGreaterThan(childRouteStart);

    // A parent such as 1-1000-CST may already have imported children such as
    // 1-1010-CST and 1-1020-CST. Those suffixes must not make the siblings
    // invisible to the sequence calculation.
    expect(childRoute).toContain(
      'String(parent.code).match(/^(.*-)(\\d+)(?:-([A-Za-z0-9]+))?$/)',
    );
    expect(childRoute).toContain(
      '(\\\\d+)(?:-[A-Za-z0-9]+)?$',
    );
    expect(childRoute).toContain("const maxNumber = siblingNumbers.length > 0");
    expect(childRoute).toContain(
      "const usesTensSequence = siblingNumbers.length > 0",
    );
    expect(childRoute).toContain(
      "const increment = siblingNumbers.length === 0 || usesTensSequence ? 10 : 1",
    );
    expect(childRoute).toContain(
      "let nextNumber = siblingNumbers.length === 0 ? baseNumber + 10 : maxNumber + increment",
    );
  });

  it("checks generated codes against every company, not only the active company", () => {
    const usedCodeQueryStart = childRoute.indexOf("const usedCodesResult = await tx.execute");
    const usedCodeQueryEnd = childRoute.indexOf("const usedCodes = new Set", usedCodeQueryStart);
    const usedCodeQuery = childRoute.slice(usedCodeQueryStart, usedCodeQueryEnd);

    expect(usedCodeQueryStart).toBeGreaterThanOrEqual(0);
    expect(usedCodeQueryEnd).toBeGreaterThan(usedCodeQueryStart);
    expect(usedCodeQuery).toContain("SELECT code");
    expect(usedCodeQuery).toContain("WHERE code LIKE");
    expect(usedCodeQuery).not.toContain("company_id");
    expect(childRoute).toContain("while (usedCodes.has(code))");
  });

  it("repairs a stale COA SERIAL sequence and retries exactly the child creation", () => {
    expect(accountingRoute).toContain(
      'import { syncAccountingSequences } from "../lib/accountingMigration.js";',
    );
    expect(childRoute).toContain("const createChild = async () => db.transaction");
    expect(childRoute).toContain(
      'if (pgError.code === "23505" && pgError.constraint === "chart_of_accounts_pkey")',
    );
    expect(childRoute).toContain("await syncAccountingSequences();");
    expect(childRoute).toContain("created = await createChild();");

    // A code collision must not trigger sequence repair: only a stale
    // primary-key sequence is safe to retry automatically.
    const retryGuard = childRoute.slice(
      childRoute.indexOf('if (pgError.code === "23505"'),
      childRoute.indexOf("return res.status(201)", childRoute.indexOf('if (pgError.code === "23505"')),
    );
    expect(retryGuard).toContain('pgError.constraint === "chart_of_accounts_pkey"');
    expect(retryGuard).toContain("await syncAccountingSequences()");
    expect(retryGuard).toContain("created = await createChild()");
    expect(retryGuard).toContain("else");
    expect(retryGuard).toContain("throw err");
  });
});

describe("child COA error classification", () => {
  it("keeps company code collisions distinct from other database failures", () => {
    const errorHandler = childRoute.slice(childRoute.indexOf("} catch (err: unknown) {", childRoute.indexOf("try {")));

    expect(errorHandler).toContain(
      'pgError.constraint === "coa_company_code_uniq"',
    );
    expect(errorHandler).toContain(
      "Kode COA tersebut sudah digunakan oleh perusahaan ini.",
    );
    expect(errorHandler).toContain(
      "COA belum dapat ditambahkan. Silakan coba lagi.",
    );
    expect(errorHandler).toContain("error: String(pgError.message ?? err)");
  });
});

describe("COA schema uniqueness contract", () => {
  it("keeps account codes unique per company while allowing the same code elsewhere", () => {
    expect(accountingSchema).toContain('id: serial("id").primaryKey()');
    expect(accountingSchema).toContain(
      'uniqueIndex("coa_company_code_uniq").on(t.companyId, t.code)',
    );
  });
});