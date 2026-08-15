import {
  ensureCanonicalSettlementContracts,
  verifyCanonicalSettlementOwnerRoutines,
} from "./modules/sport-center/migration.js";

if (process.env.APP_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
  throw new Error(
    "Canonical settlement restoration is DEV-only; refusing to write outside the development database.",
  );
}

await ensureCanonicalSettlementContracts();
await verifyCanonicalSettlementOwnerRoutines();
console.log("Canonical Sport Center owner routines restored and verified in the selected database.");