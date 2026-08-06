/**
 * Inject 4 breakdown i18n keys into all 18 locale files.
 * Run: node scripts/add-ocean-freight-breakdown-keys.mjs
 */
import fs from "node:fs";
import path from "node:path";

const LOCALES_DIR = "artifacts/customer-portal/src/i18n/locales";

const NEW_KEYS = {
  // THC = Terminal Handling Charge — industry code, same universally
  breakdownTHCOrigin: {
    "ar-AE": "THC Origin", "ar-SA": "THC Origin", "de-DE": "THC Origin",
    "en-AU": "THC Origin", "en-GB": "THC Origin", "en-SG": "THC Origin", "en-US": "THC Origin",
    "es-ES": "THC Origen", "fr-FR": "THC Origine", "hi-IN": "THC Origin", "id-ID": "THC Origin",
    "it-IT": "THC Origine", "ja-JP": "THC 原港", "ko-KR": "THC 출발지", "ms-MY": "THC Asal",
    "nl-NL": "THC Herkomst", "zh-CN": "THC 起运港", "zh-TW": "THC 出發港",
  },
  breakdownTHCDestination: {
    "ar-AE": "THC Destination", "ar-SA": "THC Destination", "de-DE": "THC Destination",
    "en-AU": "THC Destination", "en-GB": "THC Destination", "en-SG": "THC Destination", "en-US": "THC Destination",
    "es-ES": "THC Destino", "fr-FR": "THC Destination", "hi-IN": "THC Destination", "id-ID": "THC Destination",
    "it-IT": "THC Destinazione", "ja-JP": "THC 仕向港", "ko-KR": "THC 목적지", "ms-MY": "THC Destinasi",
    "nl-NL": "THC Bestemming", "zh-CN": "THC 目的港", "zh-TW": "THC 目的港",
  },
  breakdownTrucking: {
    "ar-AE": "شحن بالشاحنة", "ar-SA": "شحن بالشاحنة", "de-DE": "LKW-Transport",
    "en-AU": "Trucking", "en-GB": "Trucking", "en-SG": "Trucking", "en-US": "Trucking",
    "es-ES": "Transporte Terrestre", "fr-FR": "Transport Routier", "hi-IN": "ट्रकिंग", "id-ID": "Truk",
    "it-IT": "Trasporto su Gomma", "ja-JP": "トラック輸送", "ko-KR": "트럭 운송", "ms-MY": "Pengangkutan Trak",
    "nl-NL": "Wegvervoer", "zh-CN": "卡车运输", "zh-TW": "卡車運輸",
  },
  breakdownCustomsClearance: {
    "ar-AE": "التخليص الجمركي", "ar-SA": "التخليص الجمركي", "de-DE": "Zollabfertigung",
    "en-AU": "Customs Clearance", "en-GB": "Customs Clearance", "en-SG": "Customs Clearance", "en-US": "Customs Clearance",
    "es-ES": "Despacho Aduanero", "fr-FR": "Dédouanement", "hi-IN": "कस्टम क्लियरेंस", "id-ID": "Kepabeanan",
    "it-IT": "Sdoganamento", "ja-JP": "通関手続き", "ko-KR": "세관 통관", "ms-MY": "Pelepasan Kastam",
    "nl-NL": "Douaneafhandeling", "zh-CN": "清关", "zh-TW": "清關",
  },
};

function detectQuoteChar(src) {
  const start = src.indexOf("oceanFreightBooking:");
  if (start === -1) return "'";
  const block = src.slice(start, start + 200);
  const single = (block.match(/'/g) || []).length;
  const dbl = (block.match(/"/g) || []).length;
  return dbl > single ? '"' : "'";
}

function buildNewKeysString(localeCode, indent, quote) {
  const q = quote;
  return Object.entries(NEW_KEYS)
    .map(([key, translations]) => {
      const val = translations[localeCode] ?? translations["en-US"];
      const escaped = val.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`);
      return `${indent}${key}: ${q}${escaped}${q},`;
    })
    .join("\n");
}

function injectKeys(filePath, localeCode) {
  let src = fs.readFileSync(filePath, "utf-8");
  const nsStart = src.indexOf("oceanFreightBooking:");
  if (nsStart === -1) { console.log(`  SKIP ${localeCode}: no namespace`); return false; }
  if (src.includes("breakdownTHCOrigin:")) { console.log(`  SKIP ${localeCode}: already patched`); return false; }

  let depth = 0, i = src.indexOf("{", nsStart), blockEnd = -1;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { blockEnd = i; break; } }
    i++;
  }
  if (blockEnd === -1) { console.log(`  SKIP ${localeCode}: no block end`); return false; }

  const blockContent = src.slice(src.indexOf("{", nsStart) + 1, blockEnd);
  const indentMatch = blockContent.match(/\n(\s+)\w/);
  const indent = indentMatch ? indentMatch[1] : "    ";
  const quote = detectQuoteChar(src.slice(nsStart, blockEnd));
  const newKeysStr = buildNewKeysString(localeCode, indent, quote);

  src = `${src.slice(0, blockEnd)}\n${newKeysStr}\n${src.slice(blockEnd)}`;
  fs.writeFileSync(filePath, src, "utf-8");
  return true;
}

const localeFiles = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith(".ts") && f !== "types.ts").sort();
let patched = 0;
console.log(`\nPatching ${localeFiles.length} locales with 4 breakdown keys...\n`);
for (const file of localeFiles) {
  const code = file.replace(".ts", "");
  const result = injectKeys(path.join(LOCALES_DIR, file), code);
  if (result) { console.log(`  ✓ ${code}`); patched++; }
}
console.log(`\nDone: ${patched} patched.`);
