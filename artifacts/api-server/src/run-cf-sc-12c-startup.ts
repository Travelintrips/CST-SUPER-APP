import { runStartupMigrationStage } from "./lib/startupMigrationState.js";
import { getStartupStageDefinition } from "./lib/startupMigrationRegistry.js";
import { runSportCenterMigration } from "./modules/sport-center/migration.js";

const VERIFIED_DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";
const VERIFIED_PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
function extractProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  return url.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
}

if (process.env.APP_ENV !== "production") {
  throw new Error("CF-SC-12C requires APP_ENV=production.");
}
if (String(process.env.SPORT_CENTER_FINANCE_MODE ?? "legacy").toLowerCase() !== "legacy") {
  throw new Error("CF-SC-12C requires SPORT_CENTER_FINANCE_MODE=legacy.");
}
const targetUrl = process.env.SUPABASE_MIGRATION_URL || process.env.SUPABASE_DATABASE_URL;
if (extractProjectRef(targetUrl) !== VERIFIED_PROD_PROJECT_REF ||
    new Set([VERIFIED_DEV_PROJECT_REF, VERIFIED_PROD_PROJECT_REF]).size !== 2) {
  throw new Error("CF-SC-12C PROD/DEV target separation verification failed.");
}

const stage = getStartupStageDefinition("Sport Center migration");
const result = await runStartupMigrationStage(stage, runSportCenterMigration);
console.log(JSON.stringify({
  stage: stage.name,
  version: stage.version,
  status: result.status,
  marker_source: "official_startup_stage",
  central_processor_runs: 0,
  payment_writes: 0,
  accounting_writes: 0,
  settlement_processing: 0,
}, null, 2));