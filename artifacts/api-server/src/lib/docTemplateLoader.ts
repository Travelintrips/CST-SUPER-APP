import { db, portalContentTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface DocTemplate {
  documentType: string;
  businessLine: string;
  logoUrl: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  headerText: string;
  footerText: string;
  primaryColor: string;
  accentColor: string;
  fontSize: number;
  defaultTerms: string;
  defaultNotes: string;
  dueDays: number;
  showTax: boolean;
  showSignature: boolean;
  showStamp: boolean;
  templateFormat: "pdf" | "html";
  updatedAt: string;
}

const DEFAULTS: Omit<DocTemplate, "documentType"> = {
  businessLine: "Logistic/Forwarder",
  logoUrl: "",
  companyName: "",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  headerText: "",
  footerText: "Dicetak otomatis oleh BizPortal.",
  primaryColor: "#0f172a",
  accentColor: "#3b82f6",
  fontSize: 11,
  defaultTerms: "",
  defaultNotes: "",
  dueDays: 14,
  showTax: true,
  showSignature: false,
  showStamp: false,
  templateFormat: "pdf",
  updatedAt: "",
};

const cache = new Map<string, { tpl: DocTemplate; ts: number }>();
const CACHE_TTL = 60_000;

export async function loadDocTemplate(type: string): Promise<DocTemplate> {
  const cached = cache.get(type);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.tpl;

  try {
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, `doc_template:${type}`));
    const stored: Partial<DocTemplate> = row ? JSON.parse(row.value) : {};
    const tpl: DocTemplate = { ...DEFAULTS, ...stored, documentType: type };
    cache.set(type, { tpl, ts: Date.now() });
    return tpl;
  } catch {
    return { ...DEFAULTS, documentType: type };
  }
}

export function invalidateDocTemplateCache(type?: string) {
  if (type) cache.delete(type);
  else cache.clear();
}
