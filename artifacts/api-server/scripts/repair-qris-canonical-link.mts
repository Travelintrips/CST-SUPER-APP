import { db } from "@workspace/db";
import {
  approveCanonicalSettlementLink,
  CANONICAL_SETTLEMENT_SOURCE,
} from "../src/lib/reconciliation/canonicalSettlementApproval.js";

const mutationId = 4098;
const settlementId = 29;

let exitCode = 0;
try {
  const result = await approveCanonicalSettlementLink(db as any, {
    mutationId,
    candidateType: "qris_settlement",
    candidateId: settlementId,
    candidateSource: CANONICAL_SETTLEMENT_SOURCE,
    actor: "replit-agent-historical-repair",
    manualOverride: true,
    overrideReason:
      "Posted canonical batch identik dengan match lama; tautkan ulang untuk menyelesaikan rekonsiliasi.",
    historicalRepair: true,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  exitCode = 1;
}
process.exitCode = exitCode;
setTimeout(() => process.exit(exitCode), 100);