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
 */

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
const reason = String(optionValue("--reason") ?? "").trim();
const apply = process.argv.includes("--apply");
const confirmedMutationId = Number(optionValue("--confirm-mutation-id"));

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

assert(["refresh-stale", "correct-membership"].includes(action), `Action tidak dikenal: ${action}`);
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

process.env.NODE_ENV = "production";
const [{ generateQrisCandidates }, { reverseCanonicalSettlementForCorrection }, { pool, db }] =
  await Promise.all([
    import("../src/lib/reconciliation/qrisCandidateService.js"),
    import("../src/lib/reconciliation/canonicalSettlementCorrection.js"),
    import("@workspace/db"),
  ]);

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
  } else {
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
  }
} finally {
  await pool.end();
}