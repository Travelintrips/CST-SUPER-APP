# AI Tax Classification

## Scope

The transaction-intelligence pipeline classifies tax descriptions into additive
intent values while retaining `TAX_PAYMENT` for legacy descriptions.

Supported tax intents include VAT/PPN, income tax/PPh, import and customs duty,
stamp duty, excise, local and vehicle tax, penalty, interest, refund, and the
legacy unspecified tax intent.

## Safety rules

- Short tokens such as `tax`, `pph`, `ppn`, `bea`, and `adm` use token-boundary
  matching.
- Every tax intent requires manual review, including high-confidence results.
- The reviewer receives subtype, confidence, matched keywords, explanation,
  alternative COAs, and an uncertainty warning when subtype is unknown.
- Tax posting is fail-closed when an active subtype mapping is unavailable.
- The learning engine remains advisory/read-only; reviewer feedback cannot
  automatically change rules, dictionaries, or COA mappings.

## Accounting boundary

Bank fees are direct expenses and use the bank-fee expense mapping. They do not
use AP/AR. Tax liabilities are resolved from the active tax mapping and are not
replaced by a generic fallback COA.