import PDFDocument from "pdfkit";

export interface QuotationPdfData {
  quotationNumber: string;
  customerName: string;
  customerPhone?: string | null;
  companyName?: string | null;
  serviceType: string;
  origin: string;
  destination: string;
  commodity?: string | null;
  cargoDescription?: string | null;
  grossWeight?: number | null;
  volumeCbm?: number | null;
  etaFinal?: string | null;
  finalCustomerPrice: number;
  termsConditions?: string | null;
  quoteNotes?: string | null;
  validUntil?: Date | null;
  rfqNumber?: string | null;
  orderNumber?: string | null;
}

function fmtRp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

const BRAND_BLUE = "#1e40af";
const BRAND_LIGHT = "#dbeafe";
const GRAY = "#6b7280";
const DARK = "#111827";

export function buildQuotationPdf(data: QuotationPdfData): Buffer {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Quotation ${data.quotationNumber}`,
      Author: "B2B Marketplace and Logistic",
    },
  });

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // ── Header bar ────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 90).fill(BRAND_BLUE);

  doc.fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("B2B MARKETPLACE AND LOGISTIC", 50, 22);

  doc.font("Helvetica")
    .fontSize(10)
    .fillColor("#bfdbfe")
    .text("PT. B2B Marketplace and Logistic", 50, 48)
    .text("Jakarta, Indonesia | www.b2bmarketplace.co.id", 50, 62);

  // Quotation label - top right
  doc.fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("QUOTATION", 0, 20, { align: "right", width: doc.page.width - 50 });

  doc.font("Helvetica")
    .fontSize(10)
    .text(data.quotationNumber, 0, 38, { align: "right", width: doc.page.width - 50 });

  const today = new Date();
  doc.fontSize(9)
    .text(`Tanggal: ${fmtDate(today)}`, 0, 54, { align: "right", width: doc.page.width - 50 });

  if (data.validUntil) {
    doc.text(`Berlaku s/d: ${fmtDate(data.validUntil)}`, 0, 68, { align: "right", width: doc.page.width - 50 });
  }

  // ── Customer info ─────────────────────────────────────────────────────────
  let y = 110;

  doc.fillColor(BRAND_BLUE).font("Helvetica-Bold").fontSize(11).text("Kepada Yth.", 50, y);
  y += 16;
  doc.fillColor(DARK).font("Helvetica-Bold").fontSize(13).text(data.customerName, 50, y);
  y += 16;
  if (data.companyName && data.companyName !== data.customerName) {
    doc.font("Helvetica").fontSize(10).fillColor(GRAY).text(data.companyName, 50, y);
    y += 14;
  }
  if (data.customerPhone) {
    doc.font("Helvetica").fontSize(10).fillColor(GRAY).text(`WhatsApp/Telepon: ${data.customerPhone}`, 50, y);
    y += 14;
  }

  // ── Divider ───────────────────────────────────────────────────────────────
  y += 8;
  doc.rect(50, y, doc.page.width - 100, 2).fill(BRAND_LIGHT);
  y += 14;

  // ── Shipment detail ───────────────────────────────────────────────────────
  doc.fillColor(BRAND_BLUE).font("Helvetica-Bold").fontSize(11).text("DETAIL PENGIRIMAN", 50, y);
  y += 16;

  const labelX = 50;
  const valueX = 220;
  const rowH = 18;

  const rows: [string, string][] = [
    ["No. Order", data.orderNumber ?? "—"],
    ["No. RFQ", data.rfqNumber ?? "—"],
    ["Jenis Layanan", data.serviceType],
    ["Asal", data.origin],
    ["Tujuan", data.destination],
    ["Komoditi", data.commodity ?? "—"],
    ["Deskripsi Kargo", data.cargoDescription ?? "—"],
  ];
  if (data.grossWeight) rows.push(["Berat Bruto", `${data.grossWeight} kg`]);
  if (data.volumeCbm) rows.push(["Volume", `${data.volumeCbm} CBM`]);
  if (data.etaFinal) rows.push(["Estimasi Tiba (ETA)", data.etaFinal]);

  for (const [label, value] of rows) {
    doc.fillColor(GRAY).font("Helvetica").fontSize(9).text(label, labelX, y);
    doc.fillColor(DARK).font("Helvetica").fontSize(9).text(value, valueX, y, { width: 300 });
    y += rowH;
  }

  // ── Pricing box ───────────────────────────────────────────────────────────
  y += 10;
  doc.rect(50, y, doc.page.width - 100, 60).fill(BRAND_LIGHT).stroke(BRAND_BLUE);
  doc.fillColor(BRAND_BLUE).font("Helvetica-Bold").fontSize(11)
    .text("HARGA PENAWARAN", 65, y + 10);
  doc.fillColor(DARK).font("Helvetica-Bold").fontSize(20)
    .text(fmtRp(data.finalCustomerPrice), 65, y + 28);
  if (data.validUntil) {
    doc.fillColor(GRAY).font("Helvetica").fontSize(9)
      .text(`*Penawaran berlaku sampai ${fmtDate(data.validUntil)}`, 0, y + 32, { align: "right", width: doc.page.width - 65 });
  }
  y += 74;

  // ── Terms & Conditions ────────────────────────────────────────────────────
  if (data.termsConditions || data.quoteNotes) {
    y += 6;
    doc.fillColor(BRAND_BLUE).font("Helvetica-Bold").fontSize(11).text("SYARAT & KETENTUAN", 50, y);
    y += 14;
    const tc = [data.termsConditions, data.quoteNotes].filter(Boolean).join("\n\n");
    doc.fillColor(DARK).font("Helvetica").fontSize(9).text(tc, 50, y, { width: doc.page.width - 100, lineGap: 3 });
    y += doc.heightOfString(tc, { width: doc.page.width - 100 }) + 10;
  }

  // ── Signature placeholder ─────────────────────────────────────────────────
  y += 20;
  if (y > 650) doc.addPage();

  const sigY = Math.max(y, 650);
  doc.fillColor(GRAY).font("Helvetica").fontSize(9)
    .text("Jakarta, " + fmtDate(today), 50, sigY)
    .text("Hormat kami,", 50, sigY + 14)
    .text("B2B Marketplace and Logistic", 50, sigY + 28);

  doc.rect(50, sigY + 40, 150, 55).stroke(GRAY);
  doc.fillColor(GRAY).fontSize(8).text("(tanda tangan & stempel)", 55, sigY + 60);

  doc.fillColor(GRAY).font("Helvetica").fontSize(9)
    .text("Disetujui oleh,", 350, sigY + 14)
    .text(data.customerName, 350, sigY + 28);
  doc.rect(350, sigY + 40, 150, 55).stroke(GRAY);
  doc.fillColor(GRAY).fontSize(8).text("(tanda tangan customer)", 355, sigY + 60);

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 60;
  doc.rect(0, footerY, doc.page.width, 60).fill(BRAND_BLUE);
  doc.fillColor("white").font("Helvetica").fontSize(8)
    .text("B2B Marketplace and Logistic | Solusi Logistik Terpercaya Indonesia", 50, footerY + 14, { align: "center", width: doc.page.width - 100 })
    .text("Dokumen ini dibuat secara otomatis oleh sistem BizPortal B2B Marketplace and Logistic.", 50, footerY + 28, { align: "center", width: doc.page.width - 100 })
    .text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, 50, footerY + 42, { align: "center", width: doc.page.width - 100 });

  doc.end();
  return Buffer.concat(chunks);
}
