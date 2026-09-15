/**
 * Fail-closed QRIS remediation runner.
 *
 * This runner intentionally does not contain a "fix all" UPDATE. The audit
 * manifest separates safe snapshot refreshes from membership corrections that
 * require an owner to provide the exact replacement payment set.
 *
 * Dry run:
 *   pnpm run qris:remediate:production -- --plan
 *
 * Refresh one stale snapshot:
 *   ... --action=refresh-stale --mutation-id=4954 \
 *       --apply --confirm-mutation-id=4954
 *
 * Reverse a wrong reconciled membership:
 *   ... --action=correct-membership --settlement-id=21 --mutation-id=4954 \
 *       --replacement-payment-ids=... --reason="..." \
 *       --apply --confirm-mutation-id=4954
 *
 * The second command only performs the governed reversal. It does not
 * auto-approve the replacement; the normal canonical builder/approval path
 * must be run afterward with the returned payment set.
 *
 * Repair one legacy QRIS snapshot link through the canonical owner:
 *   ... --action=repair-canonical-link --mutation-id=630 \
 *       --legacy-match-id=1257 --snapshot-id=3505 \
 *       --source-payment-ids=436,502,503 --expected-net=625590 \
 *       --expected-company-id=1 --expected-settlement-date=2026-09-01 \
 *       --reason="..." --apply --confirm-mutation-id=630
 */

import { sql } from "drizzle-orm";

function optionValue(name: string): string | null {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1] ?? null;
  const assignment = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return assignment == null ? null : assignment.slice(name.length + 1);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const AUDIT_MANIFEST = Object.freeze({
  validBatches: [
    1, 4, 5, 6, 7, 8, 9, 13, 15, 17, 19, 23, 26, 27, 28, 29, 30, 31, 32,
    33, 34, 35,
  ],
  orphanBatches: [2, 3, 10, 11, 12, 14, 16, 18, 20, 24, 25],
  invalidReconciled: [
    { settlementId: 22, mutationId: 4837, invalidPayments: [190] },
    { settlementId: 53, mutationId: 4953, invalidPayments: [361] },
    { settlementId: 21, mutationId: 4954, invalidPayments: [360, 367] },
  ],
  staleSnapshotMutations: [4889, 4953, 4954, 4968, 4978, 4980, 4984, 4987, 4988],
  duplicatePaymentEvidence: [
    { paymentId: 64, mutations: [4766, 4767] },
    { paymentId: 355, mutations: [4951, 4954] },
    { paymentId: 379, mutations: [4954, 4959] },
  ],
});

const action = optionValue("--action");
const mutationId = Number(optionValue("--mutation-id"));
const settlementId = Number(optionValue("--settlement-id"));
const replacementPaymentIds = String(optionValue("--replacement-payment-ids") ?? "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => value > 0);
const sourcePaymentIds = String(optionValue("--source-payment-ids") ?? "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => value > 0);
const reason = String(optionValue("--reason") ?? "").trim();
const apply = process.argv.includes("--apply");
const confirmedMutationId = Number(optionValue("--confirm-mutation-id"));
const legacyMatchId = Number(optionValue("--legacy-match-id"));
const snapshotId = Number(optionValue("--snapshot-id"));
const expectedNet = Number(optionValue("--expected-net"));
const expectedCompanyId = Number(optionValue("--expected-company-id"));
const expectedSettlementDate = String(optionValue("--expected-settlement-date") ?? "").trim();

assert(process.env.APP_ENV === "production", "Runner ini hanya boleh dijalankan dengan APP_ENV=production.");
assert(
  process.env.NODE_ENV === "production",
  "Runner ini membutuhkan NODE_ENV=production agar koneksi tidak salah environment.",
);

if (!action || action === "plan") {
  console.log(JSON.stringify({
    dryRun: true,
    manifest: AUDIT_MANIFEST,
    safeActions: {
      refreshStale: AUDIT_MANIFEST.staleSnapshotMutations,
      membershipCorrectionRequiresExactReplacement: AUDIT_MANIFEST.invalidReconciled,
      canonicalLinkRepair: {
        mutationId: 630,
        legacyMatchId: 1257,
        snapshotId: 3505,
        sourcePaymentIds: [436, 502, 503],
        expectedNet: 625590,
        expectedCompanyId: 1,
        expectedSettlementDate: "2026-09-01",
        note: "Requires live evidence preflight and canonical owner execution; no snapshot or match row is mutated directly.",
      },
    },
    protectedActions: [
      "valid canonical batches are untouched",
      "orphan batches remain unlinked",
      "reversed batches are never reused",
      "duplicate candidate evidence remains manual-review only",
    ],
  }, null, 2));
  process.exit(0);
}

assert(
  ["refresh-stale", "correct-membership", "repair-canonical-link"].includes(action),
  `Action tidak dikenal: ${action}`,
);
assert(Number.isSafeInteger(mutationId) && mutationId > 0, "--mutation-id wajib valid.");
if (apply) {
  assert(
    confirmedMutationId === mutationId,
    "Tulis ditolak: gunakan --confirm-mutation-id yang sama dengan --mutation-id.",
  );
} else {
  console.log(JSON.stringify({
    dryRun: true,
    action,
    mutationId,
    note: "Tidak ada write. Tambahkan --apply dan confirmation ID yang sama untuk eksekusi.",
  }, null, 2));
  process.exit(0);
}

if (action === "repair-canonical-link") {
  assert(Number.isSafeInteger(legacyMatchId) && legacyMatchId > 0, "--legacy-match-id wajib valid.");
  assert(Number.isSafeInteger(snapshotId) && snapshotId > 0, "--snapshot-id wajib valid.");
  assert(sourcePaymentIds.length > 0, "--source-payment-ids wajib diisi.");
  assert(sourcePaymentIds.length === new Set(sourcePaymentIds).size, "Payment ID tidak boleh duplikat.");
  assert(Number.isSafeInteger(expectedNet) && expectedNet > 0, "--expected-net wajib valid.");
  assert(Number.isSafeInteger(expectedCompanyId) && expectedCompanyId > 0, "--expected-company-id wajib valid.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(expectedSettlementDate), "--expected-settlement-date wajib YYYY-MM-DD.");
  assert(reason.length >= 10, "--reason minimal 10 karakter.");
  assert(
    mutationId === 630
      && legacyMatchId === 1257
      && snapshotId === 3505
      && expectedNet === 625590
      && expectedCompanyId === 1
      && expectedSettlementDate === "2026-09-01"
      && sourcePaymentIds.join(",") === "436,502,503",
    "Repair ini dikunci ke evidence target #630/#1257/#3505 dan payment set 436,502,503.",
  );
}

process.env.NODE_ENV = "production";
const [
  { generateQrisCandidates },
  { reverseCanonicalSettlementForCorrection },
  { pool, db },
] =
  await Promise.all([
    import("../src/lib/reconciliation/qrisCandidateService.js"),
    import("../src/lib/reconciliation/canonicalSettlementCorrection.js"),
    import("@workspace/db"),
  ]);

async function preflightCanonicalLinkRepair() {
  const mutationResult = await db.execute(sql`
    SELECT
      m.id, m.status, m.company_id, m.amount, m.transaction_date::date::text AS transaction_date,
      m.bank_account_id, m.journal_entry_id,
      legacy.id AS legacy_match_id, legacy.status AS legacy_match_status,
      legacy.candidate_type, legacy.candidate_id, legacy.candidate_source,
      snapshot.id AS snapshot_id, snapshot.company_id AS snapshot_company_id,
      snapshot.gross_amount AS snapshot_gross_amount,
      snapshot.net_amount AS snapshot_net_amount,
      snapshot.estimated_settlement_date::date::text AS snapshot_settlement_date,
      snapshot.payment_items
    FROM public.bank_mutations m
    JOIN public.bank_reconciliation_matches legacy
      ON legacy.mutation_id = m.id
     AND legacy.id = ${legacyMatchId}
     AND legacy.status = 'approved'
     AND legacy.candidate_type = 'qris_settlement'
     AND legacy.candidate_source = 'public.qris_settlements'
    JOIN public.qris_mutation_batch_candidates snapshot
      ON snapshot.id = legacy.candidate_id
     AND snapshot.id = ${snapshotId}
     AND snapshot.mutation_id = m.id
    WHERE m.id = ${mutationId}
  `);
  const mutation = mutationResult.rows[0] as Record<string, unknown> | undefined;
  assert(mutation, "Target mutation, approved legacy match, atau snapshot tidak cocok.");
  assert(Number(mutation.company_id) === expectedCompanyId, "Company mutation tidak sesuai target.");
  assert(Number(mutation.snapshot_company_id) === expectedCompanyId, "Company snapshot tidak sesuai target.");
  assert(String(mutation.transaction_date) === expectedSettlementDate, "Tanggal mutation tidak sesuai target.");
  assert(Number(mutation.amount) === expectedNet, "Nominal mutation tidak sesuai target.");
  assert(mutation.journal_entry_id == null, "Mutation sudah memiliki generic journal.");

  const rawItems = Array.isArray(mutation.payment_items) ? mutation.payment_items : [];
  const snapshotPaymentIds = rawItems
    .map((item) => Number((item as Record<string, unknown>)?.paymentId))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b);
  assert(
    snapshotPaymentIds.join(",") === [...sourcePaymentIds].sort((a, b) => a - b).join(","),
    "Payment set snapshot tidak sama dengan payment set repair.",
  );
  assert(Number(mutation.snapshot_net_amount) === expectedNet, "Net snapshot tidak sesuai target.");
  assert(
    String(mutation.snapshot_settlement_date) === expectedSettlementDate,
    "Tanggal settlement snapshot tidak sesuai target.",
  );

  const paymentResult = await db.execute(sql`
    SELECT
      p.id, p.booking_id, p.amount, p.company_id,
      p.payment_method::text AS payment_method,
      lower(btrim(p.payment_provider::text)) AS provider_code,
      p.provider_id, p.provider_name,
      p.bank_account_id::text AS bank_account_id,
      p.expected_settlement_date::date::text AS expected_settlement_date,
      p.settlement_rule_version,
      p.status::text AS payment_status,
      p.settlement_status::text AS settlement_status,
      b.order_number
    FROM sport_center.sport_payments p
    LEFT JOIN sport_center.sport_bookings b ON b.id = p.booking_id
    WHERE p.id IN (${sql.join(sourcePaymentIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY p.id
  `);
  const payments = paymentResult.rows as Array<Record<string, unknown>>;
  assert(payments.length === sourcePaymentIds.length, "Tidak semua payment canonical ditemukan.");
  const first = payments[0];
  for (const payment of payments) {
    assert(Number(payment.company_id) === expectedCompanyId, `Payment ${payment.id} company mismatch.`);
    assert(String(payment.payment_status) === "confirmed", `Payment ${payment.id} belum confirmed.`);
    assert(String(payment.settlement_status) === "unsettled", `Payment ${payment.id} tidak unsettled.`);
    assert(String(payment.payment_method).toLowerCase() === "qris", `Payment ${payment.id} bukan QRIS.`);
    assert(payment.booking_id != null, `Payment ${payment.id} tidak memiliki booking evidence.`);
    assert(
      String(payment.provider_id ?? "").trim() !== "" || String(payment.provider_name ?? "").trim() !== "",
      `Payment ${payment.id} tidak memiliki provider evidence.`,
    );
    assert(
      String(payment.provider_code) === String(first.provider_code),
      `Provider payment ${payment.id} berbeda.`,
    );
    assert(
      String(payment.bank_account_id) === String(first.bank_account_id),
      `Rekening payment ${payment.id} berbeda.`,
    );
    assert(
      String(payment.expected_settlement_date) === expectedSettlementDate,
      `Tanggal settlement payment ${payment.id} berbeda.`,
    );
    assert(
      String(payment.settlement_rule_version) === String(first.settlement_rule_version),
      `Rule version payment ${payment.id} berbeda.`,
    );
  }

  const configResult = await db.execute(sql`
    SELECT c.id
    FROM sport_center.payment_settlement_configs c
    WHERE c.company_id = ${expectedCompanyId}
      AND lower(btrim(c.provider_code)) = ${String(first.provider_code)}
      AND btrim(c.bank_account_id::text) = ${String(first.bank_account_id)}
      AND c.is_active = TRUE
      AND c.source = 'OWNER_APPROVED'
      AND c.effective_from <= ${expectedSettlementDate}::date
      AND (c.effective_until IS NULL OR ${expectedSettlementDate}::date < c.effective_until)
    ORDER BY c.id
  `);
  assert(configResult.rows.length === 1, "OWNER_APPROVED settlement config tidak unik.");

  return {
    mutation,
    payments,
    settlementConfigId: Number((configResult.rows[0] as Record<string, unknown>).id),
  };
}

try {
  if (action === "refresh-stale") {
    assert(
      AUDIT_MANIFEST.staleSnapshotMutations.includes(mutationId),
      `Mutasi ${mutationId} bukan bagian dari manifest stale snapshot.`,
    );
    const result = await generateQrisCandidates({ mutationId, dryRun: false });
    const candidate = result.candidates.find((item) => item.mutationId === mutationId);
    console.log(JSON.stringify({
      action,
      mutationId,
      persisted: result.persisted,
      generated: result.generated,
      status: candidate?.status ?? "no-current-candidate",
      paymentIds: candidate?.paymentItems.map((item) => item.paymentId) ?? [],
      expectedSettlementDate: candidate?.estimatedSettlementDate ?? null,
      reason: candidate?.reason
        ?? "Tidak ada kandidat aktif yang dapat diregenerasi; snapshot provisional yang tidak lagi valid ditutup sebagai stale.",
    }, null, 2));
  } else if (action === "correct-membership") {
    assert(Number.isSafeInteger(settlementId) && settlementId > 0, "--settlement-id wajib valid.");
    assert(replacementPaymentIds.length > 0, "--replacement-payment-ids wajib diisi.");
    assert(reason.length >= 10, "--reason minimal 10 karakter.");
    assert(
      AUDIT_MANIFEST.invalidReconciled.some(
        (item) => item.settlementId === settlementId && item.mutationId === mutationId,
      ),
      "Settlement/mutation bukan pasangan invalid-reconciled di manifest.",
    );
    const result = await reverseCanonicalSettlementForCorrection(db as any, {
      settlementId,
      expectedBankMutationId: mutationId,
      replacementPaymentIds,
      actor: "qris-prod-remediation-runner",
      reason,
    });
    console.log(JSON.stringify({ action, ...result }, null, 2));
  } else {
    const preflight = await preflightCanonicalLinkRepair();
    const build = await buildCanonicalSportCenterSettlements({
      sourcePaymentId: sourcePaymentIds[0],
      selectedPaymentIds: sourcePaymentIds,
      qrisApprovalEvidence: {
        mutationId,
        companyId: expectedCompanyId,
        settlementConfigId: preflight.settlementConfigId,
      },
      actor: "qris-canonical-repair-630",
    }, db as any);
    const settlementId = Number(build.batchIds[0]);
    assert(Number.isSafeInteger(settlementId) && settlementId > 0, "Owner builder tidak mengembalikan batch ID.");

    const batchResult = await db.execute(sql`
      SELECT
        b.id, b.company_id, b.status, b.net_amount, b.settlement_date::date::text AS settlement_date,
        b.bank_account_id::text AS bank_account_id, b.settlement_journal_id,
        COALESCE(jsonb_agg(i.payment_id ORDER BY i.payment_id)
          FILTER (WHERE i.item_status = 'active'), '[]'::jsonb) AS payment_ids
      FROM sport_center.payment_settlement_batches b
      LEFT JOIN sport_center.payment_settlement_items i ON i.settlement_id = b.id
      WHERE b.id = ${settlementId}
      GROUP BY b.id
    `);
    const batch = batchResult.rows[0] as Record<string, unknown> | undefined;
    assert(batch, "Canonical batch hasil owner tidak ditemukan.");
    assert(Number(batch.company_id) === expectedCompanyId, "Canonical batch company mismatch.");
    assert(String(batch.status) === "posted", "Canonical batch belum posted.");
    assert(Number(batch.net_amount) === expectedNet, "Canonical batch net tidak sesuai target.");
    assert(String(batch.settlement_date) === expectedSettlementDate, "Canonical batch tanggal tidak sesuai target.");
    assert(
      String(batch.payment_ids) === JSON.stringify([...sourcePaymentIds].sort((a, b) => a - b)),
      "Canonical batch active payment set tidak sesuai target.",
    );
    assert(batch.settlement_journal_id != null, "Canonical batch tidak memiliki settlement journal.");

    const approval = await approveCanonicalSettlementLink(db as any, {
      mutationId,
      candidateType: "qris_settlement",
      candidateId: settlementId,
      candidateSource: "sport_center.payment_settlement_batches",
      actor: "qris-canonical-repair-630",
      manualOverride: true,
      overrideReason: reason,
      historicalRepair: true,
    });
    const verification = await db.execute(sql`
      SELECT
        m.id AS mutation_id, m.status AS mutation_status, m.journal_entry_id,
        canonical.status AS settlement_status,
        canonical.bank_mutation_id, canonical.canonical_bank_mutation_id,
        canonical.settlement_journal_id,
        canonical_match.id AS canonical_match_id, canonical_match.status AS canonical_match_status,
        legacy_match.id AS legacy_match_id, legacy_match.status AS legacy_match_status,
        COUNT(a.id)::integer AS audit_count
      FROM public.bank_mutations m
      JOIN sport_center.payment_settlement_batches canonical
        ON canonical.id = ${settlementId}
      LEFT JOIN public.bank_reconciliation_matches canonical_match
        ON canonical_match.mutation_id = m.id
       AND canonical_match.candidate_type = 'qris_settlement'
       AND canonical_match.candidate_id = ${settlementId}
       AND canonical_match.candidate_source = 'sport_center.payment_settlement_batches'
      LEFT JOIN public.bank_reconciliation_matches legacy_match
        ON legacy_match.id = ${legacyMatchId}
      LEFT JOIN public.bank_reconciliation_audit a
        ON a.mutation_id = m.id
       AND a.action IN ('CANONICAL_SETTLEMENT_RECONCILIATION_APPROVED', 'CANONICAL_SETTLEMENT_OWNER_RECOVERY')
      WHERE m.id = ${mutationId}
      GROUP BY m.id, canonical.id, canonical_match.id, legacy_match.id
    `);
    console.log(JSON.stringify({
      action,
      preflight: {
        mutationId,
        legacyMatchId,
        snapshotId,
        sourcePaymentIds,
        settlementConfigId: preflight.settlementConfigId,
      },
      build,
      approval,
      verification: verification.rows[0] ?? null,
    }, null, 2));
  }
} finally {
  await pool.end();
}