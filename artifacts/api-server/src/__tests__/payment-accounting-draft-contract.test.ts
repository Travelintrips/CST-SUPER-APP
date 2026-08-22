import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/migration.ts"),
  "utf8",
);

const draftFunction = migration.match(
  /CREATE OR REPLACE FUNCTION sport_center\.create_payment_accounting_draft\(p_payment_id integer\)[\s\S]*?AS \$function\$[\s\S]*?\$function\$/,
)?.[0] ?? "";

describe("Sport Center payment accounting draft contract", () => {
  it("contains exactly one complete canonical function definition", () => {
    expect(draftFunction).not.toBe("");
    expect(
      migration.match(
        /CREATE OR REPLACE FUNCTION sport_center\.create_payment_accounting_draft\(p_payment_id integer\)/g,
      ),
    ).toHaveLength(1);
    expect(draftFunction).not.toContain("v_patched_definition");
    expect(draftFunction).not.toContain("CANONICAL_PAYMENT_ACCOUNTING_OWNER_PATCH_FAILED");
  });

  it("preserves the runtime signature, security, and normalized search path", () => {
    expect(draftFunction).toContain("RETURNS integer");
    expect(draftFunction).toContain("LANGUAGE plpgsql");
    expect(draftFunction).toContain("SECURITY DEFINER");
    expect(draftFunction).toContain(
      "SET search_path TO 'pg_catalog', 'sport_center', 'public'",
    );
    expect(draftFunction).not.toMatch(
      /SET search_path TO[^\n]*'public'[^\n]*'public'/,
    );
  });

  it("locks confirmed payments and reuses the first existing journal", () => {
    expect(draftFunction).toContain("pg_advisory_xact_lock");
    expect(draftFunction).toContain("FROM sport_center.sport_payments");
    expect(draftFunction).toContain("FOR UPDATE");
    expect(draftFunction).toContain("SPORT_PAYMENT_NOT_CONFIRMED");
    expect(draftFunction).toContain("journal_type = 'payment_confirmed'");
    expect(draftFunction).toContain("is_reversal = false");
    expect(draftFunction).toContain("ORDER BY id");
    expect(draftFunction).toContain("LIMIT 1");
    expect(draftFunction).toContain("RETURN v_existing_journal_id");
  });

  it("resolves a complete public posting before any Sport Center journal write", () => {
    const canonicalCheck = draftFunction.indexOf(
      "Canonical accounting idempotency",
    );
    const journalInsert = draftFunction.indexOf(
      "INSERT INTO sport_center.accounting_journals",
    );

    expect(canonicalCheck).toBeGreaterThan(-1);
    expect(canonicalCheck).toBeLessThan(journalInsert);
    expect(draftFunction).toContain("FULL JOIN public.accounting_entries");
    expect(draftFunction).toContain(
      "ap.source_type = 'sport_center'",
    );
    expect(draftFunction).toContain(
      "ap.source_doc_id = p_payment_id",
    );
    expect(draftFunction).toContain(
      "ae.source_payment_id = p_payment_id",
    );
    expect(draftFunction).toContain(
      "v_existing_payment_status <> 'posted'",
    );
    expect(draftFunction).toContain(
      "v_existing_entry_status <> 'posted'",
    );
    expect(draftFunction).toContain(
      "RETURN NULL",
    );
  });

  it("preserves payment, tax, account, journal, and validation behavior", () => {
    expect(draftFunction).toContain("v_dpp := ROUND(");
    expect(draftFunction).toContain("v_tax := v_gross - v_dpp");
    expect(draftFunction).toContain("'PAYMENT_CLEARING'");
    expect(draftFunction).toContain("'CASH'");
    expect(draftFunction).toContain("'BANK_RECEIPT'");
    expect(draftFunction).toContain(
      "sport_center.resolve_internal_bank_account_id(\n                    v_company_id,\n                    v_payment.bank_account_id::text",
    );
    expect(draftFunction).toContain("INSERT INTO sport_center.accounting_journals");
    expect(draftFunction).toContain("INSERT INTO sport_center.accounting_journal_lines");
    expect(draftFunction).toContain("'REVENUE'");
    expect(draftFunction).toContain("'PPN_OUTPUT'");
    expect(draftFunction).toContain("IF v_tax > 0 THEN");
    expect(draftFunction).toContain("sport_center.validate_accounting_journal");
    expect(draftFunction).toContain("RETURN v_journal_id");
  });

  it("derives company context before canonical bank resolution and fails closed", () => {
    const companyContext = draftFunction.indexOf(
      "v_company_id :=\n            COALESCE(",
    );
    const bankResolution = draftFunction.indexOf(
      "sport_center.resolve_internal_bank_account_id(",
    );

    expect(companyContext).toBeGreaterThan(-1);
    expect(companyContext).toBeLessThan(bankResolution);
    expect(draftFunction).toContain("v_payment.company_id");
    expect(draftFunction).toContain("v_booking_company_id");
    expect(draftFunction).toContain("SPORT_PAYMENT_COMPANY_NOT_FOUND");
    expect(draftFunction).toContain(
      "sport_center.resolve_internal_bank_account_id(\n                    v_company_id,\n                    v_payment.bank_account_id::text",
    );
  });

  it("preserves fail-closed prerequisite errors", () => {
    for (const marker of [
      "SPORT_PAYMENT_NOT_FOUND",
      "SPORT_PAYMENT_NOT_CONFIRMED",
      "SPORT_BOOKING_NOT_FOUND_FOR_PAYMENT",
      "INVALID_PAYMENT_AMOUNT",
    ]) {
      expect(draftFunction).toContain(marker);
    }
  });
});