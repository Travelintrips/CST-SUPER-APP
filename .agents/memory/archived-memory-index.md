---
name: Archived project memory index
description: Pointers to durable project lessons moved out of the active memory index to preserve visibility.
---

These entries remain valid topic pointers but are lower-frequency than the active index:

- [Vendor invoice OCR tax evidence](vendor-invoice-ocr-tax-evidence.md) — PPh/payable must stay null for rate-only evidence; preserve the printed breakdown and require review before payment.
- [Customer Portal harness fixtures](customer-portal-harness-fixtures.md) — order fixtures need one active company membership; reset capture stays loopback-only and DEV-harness gated.
- [Customer Portal runtime proofs](customer-portal-runtime-proofs.md) — one-off portal proofs must use the Secret Manager loader and correct DB isolation; bootstrap failures stay fail-closed.
- [Customer Portal SSE flushing](customer-portal-sse-flush.md) — global response compression buffers SSE writes; flush the initial frame, broadcasts, and heartbeats explicitly.
- [Recon sheet COA display](recon-sheet-coa-display.md) — write contra-account COA and name to the result sheet, excluding the bank/cash COA.
- [AI policy COA contract](ai-policy-coa-contract.md) — decision policy reads Phase 3 `primaryRecommendation`; legacy `recommendedCoa` causes false manual-review flags.
- [Vendor withholding lifecycle](vendor-withholding-lifecycle.md) — invoice boleh posted saat bukti potong pending; settlement tetap gross AP dan status paid menunggu proof_received.
- [Vendor invoice bank settlement](vendor-invoice-bank-settlement.md) — pembayaran invoice vendor harus clear AP, bukan memilih COA beban yang dapat menggandakan expense.
- [Vendor line FK migration](vendor-line-fk-migration.md) — legacy line tables may lack live uniqueness despite source schema; restore the key invariant before adding child FKs.
- [Vendor invoice detail company context](vendor-invoice-detail-company-context.md) — detail requests need active company scope or admin sessions can render undefined/NaN instead of the invoice.
- [Marketplace invoice upload idempotency](marketplace-invoice-upload-idempotency.md) — hapus attachment private baru pada duplicate/failure; hanya pertahankan setelah invoice baru commit.
- [Marketplace Product Order ownership](marketplace-product-order-ownership.md) — compatibility Product Order wajib membawa `portal_customer_id` dari session verified agar customer individual dapat melihat RFQ/order-nya.
- [Marketplace customer order feed](marketplace-customer-order-feed.md) — canonical RFQ harus tampil di riwayat pesanan customer sebelum approval; approval bukan visibility gate.
- [Customer order WhatsApp ownership](customer-order-whatsapp-ownership.md) — customer lifecycle WA harus originate from the canonical logistic transition service; driver/vendor routes keep only internal notifications.
- [Customer Portal readiness gates](customer-portal-readiness-gates.md) — production approval requires owner-bound pricing, idempotency, payment evidence linkage, atomic transitions, and CSRF protection.
- [P&L generated contract](pnl-generated-contract.md) — when P&L response fields change or are consumed, regenerate the OpenAPI client before trusting BizPortal typecheck.