/**
 * Controlled QRIS candidate regeneration for one production bank mutation.
 *
 * Usage:
 *   pnpm qris:candidate:production -- --mutation-id=3980
 *   pnpm qris:candidate:production -- --mutation-id=3980 --apply --confirm-mutation-id=3980
 *
 * The default is a read-only dry run. Applying only writes candidate snapshots;
 * it never approves, posts, or reconciles the bank mutation.
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

const mutationIdValue = optionValue("--mutation-id");
const mutationId = Number(mutationIdValue);
const apply = process.argv.includes("--apply");
const confirmedMutationId = Number(optionValue("--confirm-mutation-id"));

assert(process.env.APP_ENV === "production", "Runner ini hanya boleh dijalankan dengan APP_ENV=production.");
assert(Number.isInteger(mutationId) && mutationId > 0, "--mutation-id harus berupa ID mutasi positif.");
if (apply) {
  assert(
    confirmedMutationId === mutationId,
    "Tulis ditolak: gunakan --apply dan --confirm-mutation-id yang sama dengan --mutation-id.",
  );
}

// `@workspace/db` resolves its production connection based on NODE_ENV when it
// is loaded. Set it before importing the candidate service.
process.env.NODE_ENV = "production";

const [{ generateQrisCandidates }, { pool }] = await Promise.all([
  import("../src/lib/reconciliation/qrisCandidateService.js"),
  import("@workspace/db"),
]);

try {
  const result = await generateQrisCandidates({
    mutationId,
    dryRun: !apply,
  });
  const candidate = result.candidates.find((item) => item.mutationId === mutationId);

  assert(
    candidate != null,
    `Tidak ada kandidat yang dapat diregenerasi untuk mutasi ${mutationId}; mutasi mungkin sudah final atau bukan bukti QRIS.`,
  );
  assert(
    candidate.paymentItems.every(
      (item) => item.expectedSettlementDate === candidate.sourceDate,
    ),
    "Kohort H+1 tidak konsisten: ada payment di luar tanggal mutasi bank.",
  );

  console.log(JSON.stringify({
    dryRun: result.dryRun,
    mutationId,
    persisted: result.persisted,
    reconciliationStatus: candidate.status,
    provider: candidate.providerCode,
    providerDetectionSource: candidate.providerDetectionSource,
    settlementDate: candidate.estimatedSettlementDate || null,
    settlementRuleVersion: candidate.settlementRuleVersion || null,
    paymentCount: candidate.paymentItems.length,
    paymentIds: candidate.paymentItems.map((item) => item.paymentId),
    grossAmount: candidate.grossAmount,
    observedDeduction: candidate.observedDeduction,
    netAmount: candidate.netAmount,
    reason: candidate.reason,
    automaticFinalReconciliation: false,
  }, null, 2));
} finally {
  await pool.end();
}