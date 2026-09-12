import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/migration.ts"),
  "utf8",
);

const ownerFunction = migration.match(
  /CREATE OR REPLACE FUNCTION sport_center\.create_payment_accounting_draft_owner\(\s*p_payment_id integer,\s*p_legacy_public_entry_id integer DEFAULT NULL\s*\)[\s\S]*?AS \$function\$[\s\S]*?\$function\$/,
)?.[0] ?? "";
const publicFunction = migration.match(
  /CREATE OR REPLACE FUNCTION sport_center\.create_payment_accounting_draft\(\s*p_payment_id integer\s*\)[\s\S]*?AS \$function\$[\s\S]*?\$function\$/,
)?.[0] ?? "";

describe("Sport Center payment accounting draft contract", () => {
  it("contains exactly one complete owner and public wrapper definition", () => {
    expect(ownerFunction).not.toBe("");
    expect(publicFunction).not.toBe("");
    expect(
      migration.match(
        /CREATE OR REPLACE FUNCTION sport_center\.create_payment_accounting_draft_owner\(/g,
      ),
    ).toHaveLength(1);
    expect(
      migration.match(
        /CREATE OR REPLACE FUNCTION sport_center\.create_payment_accounting_draft\(/g,
      ),
    ).toHaveLength(1);
    expect(ownerFunction).not.toContain("v_patched_definition");
    expect(ownerFunction).not.toContain("CANONICAL_PAYMENT_ACCOUNTING_OWNER_PATCH_FAILED");
  });

  it("keeps the public call stable and delegates without posting finance", () => {
    expect(publicFunction).toContain("RETURNS integer");
    expect(publicFunction).toContain(
      "RETURN sport_center.create_payment_accounting_draft_owner(",
    );
    expect(publicFunction).toContain("p_payment_id");
    expect(publicFunction).toContain("NULL");
    expect(publicFunction).not.toContain("INSERT INTO");
    expect(publicFunction).not.toContain("validate_accounting_journal");
  });

  it("preserves the runtime signature, security, and normalized search path", () => {
    expect(ownerFunction).toContain("RETURNS integer");
    expect(ownerFunction).toContain("LANGUAGE plpgsql");
    expect(ownerFunction).toContain("SECURITY DEFINER");
    expect(ownerFunction).toContain(
      "SET search_path TO 'pg_catalog', 'sport_center', 'public'",
    );
    expect(ownerFunction).not.toMatch(
      /SET search_path TO[^\n]*'public'[^\n]*'public'/,
    );
  });

  it("locks confirmed payments and reuses the first existing journal", () => {
    expect(ownerFunction).toContain("pg_advisory_xact_lock");
    expect(ownerFunction).toContain("FROM sport_center.sport_payments");
    expect(ownerFunction).toContain("FOR UPDATE");
    expect(ownerFunction).toContain("SPORT_PAYMENT_NOT_CONFIRMED");
    expect(ownerFunction).toContain("journal_type = 'payment_confirmed'");
    expect(ownerFunction).toContain("is_reversal = false");
    expect(ownerFunction).toContain("ORDER BY id");
    expect(ownerFunction).toContain("LIMIT 1");
    expect(ownerFunction).toContain("RETURN v_existing_journal_id");
  });

  it("resolves a complete public posting before any Sport Center journal write", () => {
    const canonicalCheck = ownerFunction.indexOf(
      "Canonical accounting idempotency",
    );
    const journalInsert = ownerFunction.indexOf(
      "INSERT INTO sport_center.accounting_journals",
    );

    expect(canonicalCheck).toBeGreaterThan(-1);
    expect(canonicalCheck).toBeLessThan(journalInsert);
    expect(ownerFunction).toContain("FULL JOIN public.accounting_entries");
    expect(ownerFunction).toContain(
      "ap.source_type = 'sport_center'",
    );
    expect(ownerFunction).toContain(
      "ap.source_doc_id = p_payment_id",
    );
    expect(ownerFunction).toContain(
      "ae.source_payment_id = p_payment_id",
    );
    expect(ownerFunction).toContain(
      "v_existing_payment_status <> 'posted'",
    );
    expect(ownerFunction).toContain(
      "v_existing_entry_status <> 'posted'",
    );
    expect(ownerFunction).toContain(
      "RETURN NULL",
    );
  });

  it("preserves payment, tax, account, journal, and validation behavior", () => {
    expect(ownerFunction).toContain("v_dpp := ROUND(");
    expect(ownerFunction).toContain("v_tax := v_gross - v_dpp");
    expect(ownerFunction).toContain("'PAYMENT_CLEARING'");
    expect(ownerFunction).toContain("'CASH'");
    expect(ownerFunction).toContain("'BANK_RECEIPT'");
    expect(ownerFunction).toContain(
      "sport_center.resolve_internal_bank_account_id(\n                    v_company_id,\n                    v_payment.bank_account_id::text",
    );
    expect(ownerFunction).toContain("INSERT INTO sport_center.accounting_journals");
    expect(ownerFunction).toContain("INSERT INTO sport_center.accounting_journal_lines");
    expect(ownerFunction).toContain("'REVENUE'");
    expect(ownerFunction).toContain("'PPN_OUTPUT'");
    expect(ownerFunction).toContain("IF v_tax > 0 THEN");
    expect(ownerFunction).toContain("sport_center.validate_accounting_journal");
    expect(ownerFunction).toContain("RETURN v_journal_id");
  });

  it("derives company context before canonical bank resolution and fails closed", () => {
    const companyContext = ownerFunction.indexOf(
      "v_company_id :=\n            COALESCE(",
    );
    const bankResolution = ownerFunction.indexOf(
      "sport_center.resolve_internal_bank_account_id(",
    );

    expect(companyContext).toBeGreaterThan(-1);
    expect(companyContext).toBeLessThan(bankResolution);
    expect(ownerFunction).toContain("v_payment.company_id");
    expect(ownerFunction).toContain("v_booking_company_id");
    expect(ownerFunction).toContain("SPORT_PAYMENT_COMPANY_NOT_FOUND");
    expect(ownerFunction).toContain(
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
      expect(ownerFunction).toContain(marker);
    }
  });
});