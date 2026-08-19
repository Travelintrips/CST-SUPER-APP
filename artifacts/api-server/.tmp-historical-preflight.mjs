import {
  VERIFIED_HISTORICAL_DUPLICATE_PAIRS,
  reverseHistoricalDuplicate,
} from './.tmp-historical-reversal-bundle.mjs';

const results = [];
for (const [legacyEntryId, canonicalEntryId] of VERIFIED_HISTORICAL_DUPLICATE_PAIRS) {
  const result = await reverseHistoricalDuplicate({
    legacyEntryId,
    canonicalEntryId,
    actor: 'system_historical_duplicate_repair',
    reason: 'Historical duplicate Sport Center posting superseded by verified canonical sport_center_payment entry',
    validateOnly: true,
  });
  results.push({ legacyEntryId, canonicalEntryId, ...result });
}
const safe = results.filter((result) => result.ok).length;
const blocked = results.length - safe;
console.log(JSON.stringify({ safe, blocked, results }, null, 2));
