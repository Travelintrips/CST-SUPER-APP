/**
 * PPJK Document Resolver — Unit Tests
 * Tests the pure deterministic document requirement resolver.
 */
import { describe, it, expect } from "vitest";
import {
  resolveRequiredDocuments,
  checkReadyForCeisa,
  DocumentResolverParams,
} from "../lib/ppjkDocumentResolver.js";

function getRequired(docs: ReturnType<typeof resolveRequiredDocuments>) {
  return docs.filter((d) => d.isRequired).map((d) => d.docType);
}

function getOptional(docs: ReturnType<typeof resolveRequiredDocuments>) {
  return docs.filter((d) => !d.isRequired).map((d) => d.docType);
}

describe("resolveRequiredDocuments", () => {
  describe("always required", () => {
    it("invoice and packing_list are always required", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea" });
      const required = getRequired(docs);
      expect(required).toContain("invoice");
      expect(required).toContain("packing_list");
    });
  });

  describe("import rules", () => {
    it("PIB required for import", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea" });
      expect(getRequired(docs)).toContain("pib");
    });

    it("PEB not required for import", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea" });
      expect(getRequired(docs)).not.toContain("peb");
    });

    it("NPWP required for import", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea" });
      expect(getRequired(docs)).toContain("npwp");
    });

    it("BL required for sea freight import", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea" });
      expect(getRequired(docs)).toContain("bl");
    });
  });

  describe("export rules", () => {
    it("PEB required for export", () => {
      const docs = resolveRequiredDocuments({ tradeType: "export", transportMode: "sea" });
      expect(getRequired(docs)).toContain("peb");
    });

    it("PIB not required for export", () => {
      const docs = resolveRequiredDocuments({ tradeType: "export", transportMode: "sea" });
      expect(getRequired(docs)).not.toContain("pib");
    });

    it("NPWP not required for export", () => {
      const docs = resolveRequiredDocuments({ tradeType: "export", transportMode: "sea" });
      expect(getRequired(docs)).not.toContain("npwp");
    });

    it("BL not required for export sea", () => {
      // BL optional for export
      const docs = resolveRequiredDocuments({ tradeType: "export", transportMode: "sea" });
      expect(getRequired(docs)).not.toContain("bl");
    });
  });

  describe("transport mode rules", () => {
    it("AWB required for air freight", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "air" });
      expect(getRequired(docs)).toContain("awb");
    });

    it("AWB not required for sea freight", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea" });
      expect(getRequired(docs)).not.toContain("awb");
    });

    it("BL not required for air freight", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "air" });
      expect(getRequired(docs)).not.toContain("bl");
    });

    it("defaults to sea transport (BL required for import) when transportMode is null", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: null });
      expect(getRequired(docs)).toContain("bl");
    });
  });

  describe("hazardous goods", () => {
    it("MSDS required when isHazardous=true", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", isHazardous: true });
      expect(getRequired(docs)).toContain("msds");
    });

    it("MSDS required for chemical commodity via detection", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", commodity: "bahan kimia berbahaya" });
      expect(getRequired(docs)).toContain("msds");
    });

    it("MSDS required for fuel commodity", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", commodity: "bahan bakar minyak" });
      expect(getRequired(docs)).toContain("msds");
    });

    it("MSDS not required for regular commodity", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", commodity: "kopi arabika" });
      expect(getRequired(docs)).not.toContain("msds");
    });
  });

  describe("LS (Laporan Surveyor)", () => {
    it("LS required for food commodity", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", commodity: "makanan olahan" });
      expect(getRequired(docs)).toContain("ls");
    });

    it("LS required for electronics", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", commodity: "barang elektronik" });
      expect(getRequired(docs)).toContain("ls");
    });

    it("LS required for steel", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", commodity: "besi baja" });
      expect(getRequired(docs)).toContain("ls");
    });

    it("LS not required for general commodity", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", commodity: "furniture kayu" });
      expect(getRequired(docs)).not.toContain("ls");
    });
  });

  describe("COO / SKA", () => {
    it("COO required when preferentialTariff=true", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", preferentialTariff: true });
      expect(getRequired(docs)).toContain("coo");
    });

    it("COO optional when preferentialTariff=false", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", preferentialTariff: false });
      expect(getOptional(docs)).toContain("coo");
    });
  });

  describe("insurance (CIF)", () => {
    it("insurance required for CIF incoterm", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", incoterm: "CIF" });
      expect(getRequired(docs)).toContain("insurance");
    });

    it("insurance required for CIP incoterm", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", incoterm: "CIP" });
      expect(getRequired(docs)).toContain("insurance");
    });

    it("insurance optional for FOB incoterm", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", incoterm: "FOB" });
      expect(getOptional(docs)).toContain("insurance");
    });
  });

  describe("undername / surat kuasa", () => {
    it("surat_kuasa required for undername service", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", serviceType: "customs_undername" });
      expect(getRequired(docs)).toContain("surat_kuasa");
    });

    it("surat_kuasa optional for regular clearance", () => {
      const docs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea", serviceType: "customs_clearance" });
      expect(getOptional(docs)).toContain("surat_kuasa");
    });
  });
});

describe("checkReadyForCeisa", () => {
  const importSeaDocs = resolveRequiredDocuments({ tradeType: "import", transportMode: "sea" });

  it("returns ready=true when all required docs are verified", () => {
    const requiredTypes = importSeaDocs.filter((d) => d.isRequired).map((d) => d.docType);
    const checklist = requiredTypes.map((docType) => ({
      docType,
      status: "verified",
      isRequired: true,
    }));
    const result = checkReadyForCeisa(importSeaDocs, checklist);
    expect(result.ready).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("returns ready=false when invoice is only uploaded (not verified)", () => {
    const requiredTypes = importSeaDocs.filter((d) => d.isRequired).map((d) => d.docType);
    const checklist = requiredTypes.map((docType) => ({
      docType,
      status: docType === "invoice" ? "uploaded" : "verified",
      isRequired: true,
    }));
    const result = checkReadyForCeisa(importSeaDocs, checklist);
    expect(result.ready).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("returns ready=false when pib is missing (no entry in checklist)", () => {
    const checklist = [
      { docType: "invoice", status: "verified", isRequired: true },
      { docType: "packing_list", status: "verified", isRequired: true },
      // pib missing
    ];
    const result = checkReadyForCeisa(importSeaDocs, checklist);
    expect(result.ready).toBe(false);
    expect(result.missing.some((m) => m.includes("PIB"))).toBe(true);
  });
});
