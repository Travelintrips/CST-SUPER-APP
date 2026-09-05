import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve(process.cwd(), "src/pages/purchase/InvoiceOcrImport.tsx"),
  "utf8",
);

describe("Invoice OCR save boundary", () => {
  it("does not block invoice creation when selected COA has no exact supplier match", () => {
    expect(page).not.toContain(
      "Pilih supplier yang sudah ada di database agar COA dapat disimpan sebagai referensi vendor.",
    );
  });

  it("creates reusable supplier mappings only when a supplier master row is matched", () => {
    expect(page).toContain("selectedLines.length > 0 && matchedSupplier?.id");
    expect(page).toContain("saveReusableRule: Boolean(matchedSupplier?.id)");
  });
});