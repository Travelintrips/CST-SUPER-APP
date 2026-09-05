export const TAX_MIGRATION_MAKER = "system:coa-tax-migration-v1";
export const TAX_MIGRATION_IDEMPOTENCY_PREFIX = "coa-tax-v1";

function requireCompany(company) {
  if (!company || !Number.isInteger(Number(company.id))) {
    throw new Error("Company id is required.");
  }
  const rawCode = String(company.companyCode ?? company.abbr ?? "").trim();
  if (!rawCode) {
    throw new Error(`Company ${company.id} has no company_code.`);
  }
  return {
    id: Number(company.id),
    abbr: rawCode.slice(0, 8).toUpperCase(),
  };
}

export function deriveExpectedTaxRequests(targetStructure, company) {
  const { id: companyId, abbr } = requireCompany(company);
  const expected = [];

  for (const header of targetStructure.headers ?? []) {
    const code = `${header.baseCode}-${abbr}`;
    expected.push({
      kind: "header",
      action: "CREATE",
      companyId,
      code,
      parentCode: `${header.globalParentCode}-${abbr}`,
      isHeader: true,
      isPostable: false,
      baseCode: header.baseCode,
      idempotencyKey: `${TAX_MIGRATION_IDEMPOTENCY_PREFIX}:create-header:${header.baseCode}:${abbr}`,
    });
  }

  for (const subaccount of targetStructure.subaccounts ?? []) {
    const code = `${subaccount.baseCode}-${abbr}`;
    expected.push({
      kind: "child",
      action: "CREATE",
      companyId,
      code,
      parentCode: `${subaccount.headerBaseCode}-${abbr}`,
      isHeader: false,
      isPostable: true,
      baseCode: subaccount.baseCode,
      idempotencyKey: `${TAX_MIGRATION_IDEMPOTENCY_PREFIX}:create-sub:${subaccount.baseCode}:${abbr}`,
    });
  }

  for (const reparent of targetStructure.reparenting ?? []) {
    expected.push({
      kind: "reparent",
      action: "UPDATE_PARENT",
      companyId,
      code: `${reparent.existingBaseCode}-${abbr}`,
      parentCode: `${reparent.newHeaderBaseCode}-${abbr}`,
      existingBaseCode: reparent.existingBaseCode,
      idempotencyKey: `${TAX_MIGRATION_IDEMPOTENCY_PREFIX}:reparent:${reparent.existingBaseCode}:${abbr}`,
    });
  }

  return expected;
}

export function compareLedgerTotals(before, after) {
  const beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(after);
  return {
    unchanged: beforeJson === afterJson,
    before,
    after,
  };
}

export function hasReviewDocumentation(changeRequest) {
  return Boolean(
    changeRequest?.reviewedBy &&
      changeRequest?.reviewedAt,
  );
}

export function hasRejectionDocumentation(changeRequest) {
  return hasReviewDocumentation(changeRequest) &&
    Boolean(String(changeRequest?.reviewComments ?? "").trim());
}