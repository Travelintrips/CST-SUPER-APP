# CF-CP-3 — Customer Portal Shared Finance Config Readiness

**Environment:** Development  
**Mode:** Read-only discovery  
**Date:** 2026-08-20  
**Scope:** Customer Portal shared finance configuration before CF-CP-4  

## Executive verdict

**CF-CP-3: CONDITIONAL / BLOCKED ONLY ON DEFERRED TAX CONTRACT.**

The Central Finance foundation exists in the development runtime. The
Customer Portal project configuration has now been adopted for company ID `1`.
Tax configuration remains deferred, while Paylabs and bank settlement
configuration are intentionally outside the current scope. No tax, provider,
bank, COA, settlement, or reconciliation data was seeded.

The remaining state is **OWNER_CONFIG_REQUIRED** only for the deferred tax/COA
configuration. In particular, this audit must not manufacture tax, COA,
settlement, or reconciliation values.

## Verified canonical identity

| Domain | Canonical object |
|---|---|
| Customer | `public.customers.id` |
| Invoice / sales document | `public.sales_documents.id` |
| Payment | `public.payments.id` |
| Finance event | `public.customer_payment_finance_events` |
| Event source | `customer_portal` |
| Event source payment | `public.payments.id` |
| Event type | `payment_confirmed` |
| Correlation key | `customer_portal:payment:<payment_id>:payment_confirmed` |

The existing payment proof/confirmation path does not itself produce a finance
event, accounting entry, bank mutation, settlement, or reconciliation record.
Production remains on the legacy path.

## 1. Canonical company ownership

### Result

**CUSTOMER PORTAL CANONICAL COMPANY SOURCE =**
`public.sales_documents.company_id`

**CUSTOMER PORTAL COMPANY ID = `1` (owner decision)**

### Evidence and interpretation

The payment-link path reads the sales document, resolves its company from
`doc.companyId`, and refuses to create a payment link when that value is null or
ambiguous. The payment row receives that resolved company ID. This is the
correct source boundary for the Customer Portal payment path; customer identity
is not used as a substitute company owner.

The source inventory also contains legacy accounting seed/repair code with
`company_id ?? 1` and company-1 defaults. Those occurrences are not inside the
canonical Customer Portal payment-confirmation path, so they were not changed in
CF-CP-3. They remain a follow-up review item before any shared-engine cutover.

### Ownership blocker

The owner decision resolves the intended company scope to company ID `1`.
Before accounting activation, an authenticated/runtime proof should still show:

1. the relevant Customer Portal sales document has `company_id = 1`,
2. company `1` is the referenced canonical company row,
3. the same company ID is carried into the payment and finance-event contract.

No implicit company `1` may be used to satisfy that proof.

## 2. Shared project configuration

### Result

**CUSTOMER_PORTAL_PROJECT_CONFIG = EXISTS**

An active development config now exists for `project_code = customer_portal`
and `company_id = 1`. See the CF-CP-4A completion record for the exact
post-transaction evidence.

The following shared configuration foundation is present in development:

- `public.finance_project_configs`
- `public.finance_project_payment_configs`
- `public.finance_project_tax_mappings`
- `public.finance_project_coa_mappings`

The mapping tables use `finance_project_config_id`; they do not use
`project_code` directly as their foreign-key identity.

The live development inventory did not find an active
`finance_project_configs.project_code = 'customer_portal'` configuration.
No row was inserted.

## 3. Customer Portal payment/provider inventory

### Normalized source contract

| Field | Finding |
|---|---|
| Payment source | `public.payments` |
| Payment ownership | `ref_kind = sales`, linked to `sales_documents` |
| Expected provider | Paylabs |
| Source/provider identifier | `payments.provider = 'paylabs'` in the application path |
| Provider merchant reference | `provider_merchant_trade_no` |
| Provider order reference | `provider_order_id` when returned by Paylabs |
| Payment method | persisted from the normalized request/webhook method |
| Currency | no approved Customer Portal-specific runtime value proven |
| Merchant/store ownership | Paylabs merchant/store configuration is not a shared finance ownership proof |

The application path creates Paylabs payments with the provider identifier and
stores provider references without exposing credentials. Development may create
simulation rows when Paylabs credentials are absent, but a simulation row is
not evidence of a real provider settlement contract.

The inventory did not establish an approved Customer Portal active payment
fixture or a completed finance-event cohort suitable for settlement testing.

## 4. Paylabs finance configuration discovery

### Scope decision

**PAYLABS = DEFERRED / OUT OF CURRENT SCOPE**

The owner has explicitly asked to ignore Paylabs for the current phase. No
Paylabs payment configuration, receiving bank, settlement, or fee work is
required for the current CF-CP-3 closeout. It remains a prerequisite only if a
future phase enables Paylabs settlement or reconciliation.

### Result

**NOT ASSESSED BY DESIGN**

No complete, Customer Portal-specific, non-secret configuration was proven for
all of the following:

- receiving `company_bank_accounts.id`,
- settlement delay,
- MDR,
- provider fee,
- fee tax,
- settlement tolerance,
- currency,
- effective period,
- project-specific payment configuration.

The existing Paylabs application settings/merchant configuration is not enough
to establish accounting ownership. It must be linked to the shared project
configuration and to an exact company-owned bank account before CF-CP-4.

No missing value was inferred from Sport Center, a generic default, a bank
name, or an environment secret.

## 5. Bank ownership

### Scope decision

Because Paylabs is deferred, receiving-bank ownership is also deferred.

### Result

**BANK OWNERSHIP = DEFERRED**

Because no approved Customer Portal Paylabs receiving-account mapping was found,
there is no canonical `company_bank_accounts.id` that can be reported as the
receiving account.

Therefore the audit cannot certify:

- exact bank account identity,
- company ownership,
- active status,
- absence of conflicting candidates.

If owner configuration later returns more than one candidate, the required
classification is **AMBIGUOUS_BANK_CONFIG**. The first row must never be chosen
implicitly.

## 6. Customer Portal tax contract

### Scope decision

**TAX RULE = DEFERRED**

The owner has stated that tax rules will be configured later. No tax rule is
selected or reused in this phase.

### Result

**TAX CONTRACT = DEFERRED / OWNER_CONFIG_REQUIRED**

The development runtime contains generic sales tax rules, but the audit did not
prove that one of them is the Customer Portal rule. The following contract
remains unresolved:

- taxable versus non-taxable treatment,
- tax-inclusive versus tax-exclusive amount semantics,
- applicable `public.tax_rules` identity,
- Customer Portal transaction type,
- Customer Portal module source,
- mapping from project config to tax rule.

Sport Center tax rule `8` is explicitly excluded and must not be reused.

## 7. COA and accounting-path readiness

### Result

**COA CONTRACT = UNPROVEN**

The central chart of accounts and existing accounting settings are present in
the shared foundation, but no Customer Portal-specific project-to-COA mapping
was proven. In particular, the audit did not certify the accounts for:

- gross sales/revenue,
- receivable or payment clearing,
- Paylabs fee,
- fee tax,
- bank settlement,
- rounding/tolerance differences.

The existing accounting posting path must not be enabled for Customer Portal
until these mappings are explicit and company-scoped.

## Runtime evidence limitations

Some exploratory queries initially used column names that do not match the live
runtime schema. Those failures were treated as schema-introspection findings,
not as proof that a table or configuration was absent. Final classifications
above rely only on the successful live catalog/count/configuration evidence and
the verified application contract. No secret value was printed.

## Blockers for CF-CP-4

1. **Deferred tax contract:** configure a Customer Portal-specific taxable and
   inclusive/exclusive rule later; do not reuse Sport Center rule 8.
2. **Missing COA mapping:** approve project/company-scoped accounts before
   accounting posting.
3. **Insufficient runtime fixture:** provide a real or explicitly approved
   non-production fixture proving the payment-confirmed event contract before
   settlement/reconciliation work.

## Explicit non-actions

- No `INSERT`, `UPDATE`, `DELETE`, or `DDL` was executed for this audit.
- Paylabs was intentionally excluded from this phase; no Paylabs credential,
  merchant secret, or private key was exposed.
- No Sport Center configuration was modified.
- No settlement or reconciliation implementation was enabled.
- No guessed bank, tax, COA, MDR, fee, delay, tolerance, or currency value was
  persisted.

## CF-CP-4 entry criteria

CF-CP-4 may begin only after an owner-approved configuration exists and a
read-only re-audit proves, for the same company and project:

1. active project config for company `1`,
2. explicit tax mapping (when tax is brought into scope),
3. explicit COA mapping,
4. a payment-confirmed runtime fixture with no duplicate event identity.

If Paylabs settlement is later enabled, its payment config, bank account,
effective dates, currency, fees, and tolerance must be audited separately
before that settlement phase begins.
