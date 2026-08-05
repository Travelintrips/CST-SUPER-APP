/**
 * Bank Format Parsers
 * Supports: CSV, Excel (via ExcelJS), MT940, CAMT.053 (XML)
 */

export interface ParsedBankRow {
  date: string;
  description: string;
  amount: number;
  direction: "IN" | "OUT";
  reference?: string;
  vendorName?: string;
  currency?: string;
  balance?: number;
  rawSource?: string;
}

// ── Format Detector ──────────────────────────────────────────────────────────

export type BankFileFormat = "csv" | "excel" | "mt940" | "camt053";

export function detectFormat(filename: string, content: string): BankFileFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xls") return "excel";
  if (ext === "sta" || ext === "mt940" || ext === "mts") return "mt940";
  if (ext === "xml") {
    if (content.includes("BkToCstmrStmt") || content.includes("camt.053")) return "camt053";
  }
  if (ext === "camt" || (ext === "xml" && content.includes("<Ntry>"))) return "camt053";
  // Heuristic content check for MT940 (no extension info)
  if (content.trim().startsWith(":20:") || content.includes("\n:61:") || content.includes("\r:61:")) return "mt940";
  // XML with CAMT markers
  if (content.includes("<BkToCstmrStmt>") || content.includes("urn:iso:std:iso:20022")) return "camt053";
  return "csv";
}

// ── MT940 Parser ─────────────────────────────────────────────────────────────
// MT940 is a SWIFT standard for bank statements

export function parseMT940(content: string): ParsedBankRow[] {
  const results: ParsedBankRow[] = [];
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith(":61:")) continue;

    const body = line.slice(4);
    // MT940 :61: format: YYMMDD[MMDD]C/DC/D[currency]amount[N]typeid[//bankref]
    const dateMatch = body.match(/^(\d{6})/);
    if (!dateMatch) continue;

    const rawDate = dateMatch[1];
    const year = 2000 + parseInt(rawDate.slice(0, 2), 10);
    const month = rawDate.slice(2, 4);
    const day = rawDate.slice(4, 6);
    const date = `${year}-${month}-${day}`;

    const rest = body.slice(6);
    // Optional value date (4 digits MMDD), then direction code
    const dirMatch = rest.match(/^(\d{4})?(R?[CD])/);
    if (!dirMatch) continue;

    const dirChar = dirMatch[2];
    const direction: "IN" | "OUT" = dirChar.endsWith("C") ? "IN" : "OUT";

    // Amount after direction char (comma as decimal separator in MT940)
    const afterDir = rest.slice(rest.indexOf(dirChar) + dirChar.length);
    const amtMatch = afterDir.match(/^([A-Z]{3})?(\d+,\d{0,2})/);
    if (!amtMatch) continue;

    const currency = amtMatch[1] || undefined;
    const amountStr = amtMatch[2].replace(",", ".");
    const amount = parseFloat(amountStr);
    if (!amount || isNaN(amount)) continue;

    // Reference: after amount, may have //bankref or customer ref
    const afterAmt = afterDir.slice(amtMatch[0].length);
    const refParts = afterAmt.split("//");
    const bankRef = refParts[1]?.split("\n")[0].trim();
    const typeId = refParts[0].slice(0, 4); // N+3char transaction type

    // Collect :86: description block
    let description = "";
    let vendorName: string | undefined;
    let j = i + 1;
    while (j < lines.length) {
      const nextLine = lines[j].trim();
      if (nextLine.startsWith(":86:")) {
        const desc86 = nextLine.slice(4);
        // MT940 structured :86: uses ?nn codes: ?20=purpose, ?30=BLZ, ?31=account, ?32=name, ?33=name2
        const vendorMatch = desc86.match(/\?32([^?]+)/);
        if (vendorMatch) vendorName = vendorMatch[1].trim();
        const vendorMatch2 = desc86.match(/\?33([^?]+)/);
        if (vendorMatch2 && vendorName) vendorName += " " + vendorMatch2[1].trim();
        // Unstructured description
        description = desc86.replace(/\?\d{2}/g, " ").replace(/\s+/g, " ").trim();
        j++;
        // Continue collecting multi-line :86:
        while (j < lines.length && !lines[j].trim().startsWith(":")) {
          description += " " + lines[j].trim();
          j++;
        }
        break;
      } else if (nextLine.startsWith(":") && !nextLine.startsWith(":86:")) {
        break;
      }
      j++;
    }

    results.push({
      date,
      description: description || `MT940 ${direction} ${typeId}`,
      amount,
      direction,
      reference: bankRef || undefined,
      vendorName: vendorName || undefined,
      currency,
      rawSource: "MT940",
    });
  }

  return results;
}

// ── CAMT.053 Parser (XML) ────────────────────────────────────────────────────
// CAMT.053 is the ISO 20022 standard for bank account statements (SEPA)

function getTagText(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`));
  return m ? m[1].trim() : undefined;
}

function getNestedBlock(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : undefined;
}

export function parseCAMT053(content: string): ParsedBankRow[] {
  const results: ParsedBankRow[] = [];

  const ntryRegex = /<Ntry>([\s\S]*?)<\/Ntry>/g;
  let ntryMatch: RegExpExecArray | null;

  while ((ntryMatch = ntryRegex.exec(content)) !== null) {
    const block = ntryMatch[1];

    // Amount + currency
    const amtMatch = block.match(/<Amt\s+Ccy="([^"]+)">([^<]+)<\/Amt>/);
    if (!amtMatch) continue;
    const currency = amtMatch[1];
    const amount = parseFloat(amtMatch[2]);
    if (!amount || isNaN(amount)) continue;

    // Direction: CRDT = credit (IN), DBIT = debit (OUT)
    const cdtDbt = getTagText(block, "CdtDbtInd");
    const direction: "IN" | "OUT" = cdtDbt === "CRDT" ? "IN" : "OUT";

    // Date — prefer BookgDt, fallback ValDt
    const bookgDtBlock = getNestedBlock(block, "BookgDt");
    const valDtBlock = getNestedBlock(block, "ValDt");
    const date = (bookgDtBlock ? getTagText(bookgDtBlock, "Dt") : undefined)
      ?? (valDtBlock ? getTagText(valDtBlock, "Dt") : undefined);
    if (!date) continue;

    // Description
    const description =
      getTagText(block, "AddtlNtryInf") ??
      getTagText(block, "Ustrd") ??
      "CAMT.053 transaction";

    // Balance (optional)
    const balBlock = getNestedBlock(block, "Bal");
    const balAmt = balBlock ? getTagText(balBlock, "Amt") : undefined;
    const balance = balAmt ? parseFloat(balAmt) : undefined;

    // Transaction details
    const txDtlsBlock = getNestedBlock(block, "TxDtls");
    let reference: string | undefined;
    let vendorName: string | undefined;

    if (txDtlsBlock) {
      // Reference
      const refsBlock = getNestedBlock(txDtlsBlock, "Refs");
      if (refsBlock) {
        reference =
          getTagText(refsBlock, "EndToEndId") ??
          getTagText(refsBlock, "TxId") ??
          getTagText(refsBlock, "InstrId");
      }

      // Vendor/counterparty name
      const partyTag = direction === "OUT" ? "Cdtr" : "Dbtr";
      const partyBlock = getNestedBlock(txDtlsBlock, "RltdPties");
      if (partyBlock) {
        const specificParty = getNestedBlock(partyBlock, partyTag);
        if (specificParty) {
          vendorName = getTagText(specificParty, "Nm");
        }
      }

      // Remittance info for description enrichment
      if (!vendorName) {
        const rmtBlock = getNestedBlock(txDtlsBlock, "RmtInf");
        if (rmtBlock) {
          const ustrd = getTagText(rmtBlock, "Ustrd");
          if (ustrd && description === "CAMT.053 transaction") {
          }
        }
      }
    }

    // Normalize NOTPROVIDED reference
    if (reference === "NOTPROVIDED" || reference === "NOT PROVIDED") reference = undefined;

    results.push({
      date,
      description,
      amount,
      direction,
      reference: reference || undefined,
      vendorName: vendorName || undefined,
      currency,
      balance,
      rawSource: "CAMT.053",
    });
  }

  return results;
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

export function parseCSVText(content: string): ParsedBankRow[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, "").trim());
  const results: ParsedBankRow[] = [];

  const findCol = (candidates: string[]) => {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const dateIdx   = findCol(["tanggal", "date", "tgl"]);
  const descIdx   = findCol(["keterangan", "description", "desc", "narasi", "ket"]);
  const creditIdx = findCol(["kredit", "credit", "masuk", "cr"]);
  const debitIdx  = findCol(["debit", "keluar", "db"]);
  const amtIdx    = findCol(["nominal", "amount", "jumlah"]);
  const refIdx    = findCol(["referensi", "reference", "ref", "no transaksi"]);
  const vendorIdx = findCol(["vendor", "nama", "name", "counterparty", "pihak"]);
  const balIdx    = findCol(["saldo", "balance"]);

  const parseNum = (s: string): number => {
    if (!s) return 0;
    return Math.abs(parseFloat(s.replace(/[^0-9.,\-]/g, "").replace(/\./g, "").replace(",", ".")) || 0);
  };

  const parseDate = (s: string): string => {
    if (!s) return "";
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    } catch {}
    // Try DD/MM/YYYY or DD-MM-YYYY
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
      return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    return s;
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols.length) continue;

    const rawDate   = dateIdx >= 0 ? cols[dateIdx] ?? "" : "";
    const rawDesc   = descIdx >= 0 ? cols[descIdx] ?? "" : "";
    const rawCredit = creditIdx >= 0 ? cols[creditIdx] ?? "" : "";
    const rawDebit  = debitIdx >= 0 ? cols[debitIdx] ?? "" : "";
    const rawAmt    = amtIdx >= 0 ? cols[amtIdx] ?? "" : "";
    const rawRef    = refIdx >= 0 ? cols[refIdx] ?? "" : "";
    const rawVendor = vendorIdx >= 0 ? cols[vendorIdx] ?? "" : "";
    const rawBal    = balIdx >= 0 ? cols[balIdx] ?? "" : "";

    const date = parseDate(rawDate);
    if (!date) continue;

    const credit = parseNum(rawCredit);
    const debit  = parseNum(rawDebit);
    let amount = credit || debit;
    if (!amount) amount = parseNum(rawAmt);
    if (!amount) continue;

    const direction: "IN" | "OUT" = credit > 0 ? "IN" : "OUT";
    const balance = rawBal ? parseNum(rawBal) : undefined;

    results.push({
      date,
      description: rawDesc || "CSV transaction",
      amount,
      direction,
      reference: rawRef || undefined,
      vendorName: rawVendor || undefined,
      balance,
      rawSource: "CSV",
    });
  }

  return results;
}

// ── Normalize description for matching ───────────────────────────────────────

export function normalizeForMatching(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Build mutation key ───────────────────────────────────────────────────────

// Import canonical key generator — ALL sources must use this, not a local function.
import { canonicalMutationKey } from "./canonicalMutationKey.js";

export function buildMutationKeyFromParsed(
  row: ParsedBankRow,
  opts?: { company_id?: number | null; bank_account_id?: number | null },
): string {
  return canonicalMutationKey({
    transaction_date: row.date,
    debit:  row.direction === "IN"  ? row.amount : 0,
    credit: row.direction === "OUT" ? row.amount : 0,
    description:      row.description,
    bank_reference:   row.reference ?? null,
    company_id:       opts?.company_id      ?? null,
    bank_account_id:  opts?.bank_account_id ?? null,
  });
}

// Re-export for callers that need the canonical key directly
export { canonicalMutationKey } from "./canonicalMutationKey.js";
