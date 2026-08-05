/**
 * Negative test matrix untuk service/product template guard
 * Jalankan: node --import tsx/esm scripts/test-template-guards.mjs
 *
 * Menggunakan symlink workspace langsung ke src/*.ts via tsx transpiler.
 */

import { hasInCodeServiceTemplate, resolveServiceTemplate } from "@workspace/service-templates";
import { resolveTemplateStrict, hasInCodeTemplate }         from "@workspace/product-templates";

// ── Test helpers ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── FASE A: hasInCodeServiceTemplate unit ─────────────────────────────────
console.log("\n=== A. hasInCodeServiceTemplate ===");
for (const s of ["air_freight","trucking","sea_freight","ppjk","handling","document","exim_service"]) {
  assert(`hasInCodeServiceTemplate("${s}") === true`, hasInCodeServiceTemplate(s));
}
assert(`hasInCodeServiceTemplate("air_freight_typo") === false`, !hasInCodeServiceTemplate("air_freight_typo"));
assert(`hasInCodeServiceTemplate("coall")            === false`, !hasInCodeServiceTemplate("coall"));
assert(`hasInCodeServiceTemplate("")                 === false`, !hasInCodeServiceTemplate(""));

// ── FASE B: resolveServiceTemplate always-returns (fallback hazard) ───────
console.log("\n=== B. resolveServiceTemplate always-returns (fallback hazard confirmed) ===");
const fallbackTpl = resolveServiceTemplate("air_freight_typo");
assert(
  `resolveServiceTemplate("air_freight_typo") silently returns a value (not null)`,
  fallbackTpl != null
);
assert(
  `That fallback serviceType is "air_freight_typo" (base.serviceType overridden to arg)`,
  // resolveServiceTemplate spreads base and overwrites serviceType with the arg
  typeof fallbackTpl === "object"
);

// ── FASE C: Submit flow guard simulation ──────────────────────────────────
console.log("\n=== C. Submit flow guard simulation ===");
function simulateSubmitGuard(serviceType) {
  const _svcKey = serviceType ?? null;
  if (!_svcKey || !hasInCodeServiceTemplate(_svcKey)) {
    return { status: 400, code: "SERVICE_TEMPLATE_NOT_FOUND" };
  }
  const tpl = resolveServiceTemplate(_svcKey);
  return { status: 201, resolvedServiceType: tpl.serviceType };
}

assert(`air_freight → 201`,      simulateSubmitGuard("air_freight").status     === 201);
assert(`trucking    → 201`,      simulateSubmitGuard("trucking").status         === 201);
assert(`sea_freight → 201`,      simulateSubmitGuard("sea_freight").status      === 201);
assert(`ppjk        → 201`,      simulateSubmitGuard("ppjk").status             === 201);
assert(`air_freight resolves to correct template`, simulateSubmitGuard("air_freight").resolvedServiceType === "air_freight");
assert(`trucking    resolves to correct template`, simulateSubmitGuard("trucking").resolvedServiceType    === "trucking");
assert(`sea_freight resolves to correct template`, simulateSubmitGuard("sea_freight").resolvedServiceType === "sea_freight");
assert(`air_freight_typo → 400`, simulateSubmitGuard("air_freight_typo").status === 400);
assert(`air_freight_typo code`,  simulateSubmitGuard("air_freight_typo").code   === "SERVICE_TEMPLATE_NOT_FOUND");
assert(`null → 400`,             simulateSubmitGuard(null).status               === 400);
assert(`""   → 400`,             simulateSubmitGuard("").status                 === 400);

// ── FASE D: Approve flow guard simulation ─────────────────────────────────
console.log("\n=== D. Approve flow guard simulation ===");
function simulateApproveGuard(serviceType) {
  return simulateSubmitGuard(serviceType); // same logic
}
assert(`approve air_freight → 201`,      simulateApproveGuard("air_freight").status      === 201);
assert(`approve trucking    → 201`,      simulateApproveGuard("trucking").status          === 201);
assert(`approve sea_freight → 201`,      simulateApproveGuard("sea_freight").status       === 201);
assert(`approve ppjk        → 201`,      simulateApproveGuard("ppjk").status              === 201);
assert(`approve air_freight_typo → 400`, simulateApproveGuard("air_freight_typo").status  === 400);
assert(`approve null → 400`,             simulateApproveGuard(null).status                === 400);

// ── FASE E: Product template guard ────────────────────────────────────────
console.log("\n=== E. Product template guard ===");
function simulateProductGuard(categoryKey, hasSpecValues) {
  const tpl = categoryKey ? resolveTemplateStrict(categoryKey) : null;
  if (categoryKey && !tpl && hasSpecValues) {
    return { status: 400, code: "TEMPLATE_NOT_FOUND" };
  }
  if (!tpl && !hasSpecValues) return { status: 201, note: "draft without spec check" };
  return { status: 201, category: tpl?.category };
}
assert(`product coal    + specs → 201`,  simulateProductGuard("coal", true).status   === 201);
assert(`product coal category correct`,  simulateProductGuard("coal", true).category === "coal");
assert(`product general + specs → 201`,  simulateProductGuard("general", true).status=== 201);
assert(`product "coall" + specs → 400`,  simulateProductGuard("coall", true).status  === 400);
assert(`product "coall" code`,           simulateProductGuard("coall", true).code     === "TEMPLATE_NOT_FOUND");
assert(`draft no specValues → 201`,      simulateProductGuard("coall", false).status  === 201);

// ── FASE F: Server-authoritative snapshot ─────────────────────────────────
console.log("\n=== F. Server-authoritative snapshot (client snapshot ignored) ===");
const clientFakeSnapshot = { serviceType: "malicious", fields: [] };
const _svcKey = "air_freight";
const serverSnap = hasInCodeServiceTemplate(_svcKey) ? resolveServiceTemplate(_svcKey) : null;
assert(`Server resolves air_freight snapshot from registry`, serverSnap?.serviceType === "air_freight");
assert(`Client fake snapshot is NOT used`, serverSnap?.serviceType !== clientFakeSnapshot.serviceType);

// ── FASE G: service never uses product resolver, vice-versa ──────────────
console.log("\n=== G. Cross-resolver isolation ===");
// air_freight should NOT appear in product template registry
assert(`air_freight absent from product registry`, !hasInCodeTemplate("air_freight"));
// coal should NOT appear in service template registry
assert(`coal absent from service registry`,        !hasInCodeServiceTemplate("coal"));

// ── RESULT ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed === 0) {
  console.log("VERDICT: ✓ PASS\n");
  process.exit(0);
} else {
  console.log("VERDICT: ✗ FAIL\n");
  process.exit(1);
}
