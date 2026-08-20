# CF-CP-3 — Customer Portal Shared Finance Config Readiness

**Environment:** Development  
**Mode:** Read-only discovery  
**Date:** 2026-08-20  
**Scope:** Customer Portal shared finance configuration before CF-CP-4  

## Executive verdict

**CF-CP-3: NOT READY for CF-CP-4.**

The Central Finance foundation exists in the development runtime, but Customer
Portal does not yet have a verified project configuration, an approved
Paylabs-to-bank ownership mapping, or a Customer Portal-specific tax and COA
contract. No schema or data mutation was performed by this audit.

The correct next state is **OWNER_CONFIG_REQUIRED**, not a generated or guessed
configuration. In particular, this audit must not manufacture Paylabs,
receiving-bank, tax, COA, settlement, or reconciliation values.

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

**CUSTOMER PORTAL COMPANY ID =**
**Not proven as a single approved runtime value in this audit.**

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

Before CF-CP-4, an authenticated/runtime proof must show:

1. the relevant Customer Portal sales document,
2. its exact `company_id`,
3. the company row it references,
4. the same company ID carried into the payment and finance-event contract.

No implicit company `1` may be used to satisfy that proof.

## 2. Shared project configuration

### Result

**CUSTOMER_PORTAL_PROJECT_CONFIG = MISSING**

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

### Result

**OWNER_CONFIG_REQUIRED**

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

### Result

**BANK OWNERSHIP = UNPROVEN**

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

### Result

**TAX CONTRACT = UNPROVEN / OWNER_CONFIG_REQUIRED**

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

1. **Missing project config:** create/approve
   `customer_portal` shared project configuration through the owner workflow.
2. **Unproven company ownership:** prove the exact Customer Portal company ID
   from `sales_documents.company_id` and preserve it through payment/event flow.
3. **Missing provider finance contract:** approve Paylabs non-secret settlement,
   fee, tax, currency, tolerance, and effective-period values.
4. **Missing bank ownership proof:** resolve one active
   `company_bank_accounts.id` owned by the canonical company; fail closed on
   ambiguity.
5. **Missing tax contract:** approve a Customer Portal-specific taxable and
   inclusive/exclusive rule; do not reuse Sport Center rule 8.
6. **Missing COA mapping:** approve project/company-scoped accounts before
   accounting posting.
7. **Insufficient runtime fixture:** provide a real or explicitly approved
   non-production fixture proving the payment-confirmed event contract before
   settlement/reconciliation work.

## Explicit non-actions

- No `INSERT`, `UPDATE`, `DELETE`, or `DDL` was executed for this audit.
- No Paylabs credential, merchant secret, or private key was exposed.
- No Sport Center configuration was modified.
- No settlement or reconciliation implementation was enabled.
- No guessed bank, tax, COA, MDR, fee, delay, tolerance, or currency value was
  persisted.

## CF-CP-4 entry criteria

CF-CP-4 may begin only after an owner-approved configuration exists and a
read-only re-audit proves, for the same company and project:

1. active project config,
2. active Paylabs payment config,
3. one unambiguous active company bank account,
4. explicit tax mapping,
5. explicit COA mapping,
6. effective dates and currency,
7. a payment-confirmed runtime fixture with no duplicate event identity.
