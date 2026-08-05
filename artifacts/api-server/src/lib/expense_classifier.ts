/**
 * FASE 6C — Expense Classification Engine
 *
 * classifyExpense(itemName) → category
 *
 * Mapping kategori berdasarkan spec:
 *   maintenance  — lampu, rumput, perbaikan, dsb.
 *   consumable   — shuttlecock, bola, peralatan olahraga
 *   service      — cleaning, kebersihan, keamanan, dsb.
 *   utility      — listrik, air, internet
 *   other        — fallback
 */

type ExpenseCategory = "maintenance" | "consumable" | "service" | "utility" | "other";

const KEYWORD_MAP: Array<{ keywords: string[]; category: ExpenseCategory }> = [
  // utility
  {
    keywords: ["listrik", "pln", "electric", "kwh", "watt", "daya"],
    category: "utility",
  },
  {
    keywords: ["air", "pdam", "water", "aqua", "gallon", "galon"],
    category: "utility",
  },
  {
    keywords: ["internet", "wifi", "wi-fi", "broadband", "modem", "indihome", "myrepublic", "telkom", "firstmedia"],
    category: "utility",
  },
  // maintenance
  {
    keywords: ["lampu", "bohlam", "neon", "led", "tube", "fitting", "armatur"],
    category: "maintenance",
  },
  {
    keywords: ["rumput", "lapangan", "field", "cat", "dempul", "laminasi", "lantai", "floor", "decking", "plafon", "atap", "genteng", "talang"],
    category: "maintenance",
  },
  {
    keywords: ["perbaikan", "repair", "service ac", "ac unit", "hvac", "kipas", "blower", "pompa", "pipa", "keran", "sanitasi", "kebocoran", "bocor", "ganti"],
    category: "maintenance",
  },
  // consumable
  {
    keywords: ["shuttlecock", "kock", "kok", "shuttle", "bulutangkis", "badminton"],
    category: "consumable",
  },
  {
    keywords: ["bola", "net", "raket", "grip", "string", "tali", "sepatu", "jersey", "kaos", "pelindung"],
    category: "consumable",
  },
  {
    keywords: ["peralatan", "equipment", "alat", "perlengkapan", "supplies", "konsumsi"],
    category: "consumable",
  },
  // service
  {
    keywords: ["cleaning", "kebersihan", "bersih", "sapu", "pel", "mop", "sabun", "detergen", "pembersih", "tissu", "sanitizer", "disinfektan", "karbol"],
    category: "service",
  },
  {
    keywords: ["keamanan", "security", "satpam", "cctv", "kamera", "sensor", "alarm"],
    category: "service",
  },
  {
    keywords: ["parkir", "parking", "jasa", "outsource", "tenaga"],
    category: "service",
  },
];

/**
 * Classify an expense item by name.
 * Matching is case-insensitive and uses substring search.
 * Returns "other" if no keyword matches.
 */
export function classifyExpense(itemName: string): ExpenseCategory {
  if (!itemName) return "other";
  const lower = itemName.toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.category;
    }
  }
  return "other";
}

export type { ExpenseCategory };
