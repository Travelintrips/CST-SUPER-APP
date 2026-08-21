import { ensureCanonicalSettlementContracts } from "./modules/sport-center/migration.js";

export async function installCfSc12bCertifiedOwner(): Promise<void> {
  await ensureCanonicalSettlementContracts();
}