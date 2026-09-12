import PDFDocument from "pdfkit";
import type { Response } from "express";
import type { DocTemplate } from "./docTemplateLoader.js";

export interface InvoiceLine {
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface InvoiceData {
  title: string;
  docNumber: string;
  status: string;
  kind: string;
  companyName?: string | null;
  companyAddress?: string | null;
  companyNpwp?: string | null;
  partyLabel: string;
  partyName: string;
  partyEmail?: string | null;
  partyPhone?: string | null;
  partyAddress?: string | null;
  partyTaxId?: string | null;
  validUntil?: string | null;
  expectedDate?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  notes?: string | null;
  lines: InvoiceLine[];
  totalAmount: number;
  taxAmount?: number | null;
  grandTotal?: number | null;
  taxRate?: number | null;
  invoiceStatus?: string | null;
  deliveryStatus?: string | null;
  receiveStatus?: string | null;
  billStatus?: string | null;
  template?: DocTemplate | null;
}

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (d?: string | null) => {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return d;
  }
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [15, 23, 42];
  return [r, g, b];
}

function _renderInvoiceDoc(doc: InstanceType<typeof PDFDocument>, data: InvoiceData): void {
  const tpl = data.template;
  const primaryColor = tpl?.primaryColor || "#0f172a";
  const accentColor = tpl?.accentColor || "#3b82f6";
  const footerText = tpl?.footerText || `Dicetak otomatis oleh BizPortal pada ${new Date().toLocaleString("id-ID")}`;
  const defaultTerms = tpl?.defaultTerms || null;
  const showSignature = tpl?.showSignature ?? false;
  const showStamp = tpl?.showStamp ?? false;
  const baseFontSize = Math.max(8, Math.min(14, tpl?.fontSize ?? 10));
  const headerText = tpl?.headerText || null;

  const companyName = (tpl?.companyName && tpl.companyName.trim()) ? tpl.companyName : (data.companyName || "BizPortal");
  const companyAddress = (tpl?.companyAddress && tpl.companyAddress.trim()) ? tpl.companyAddress : (data.companyAddress || null);

  doc
    .fontSize(baseFontSize + 10)
    .fillColor(primaryColor)
    .text(companyName, { align: "left" });

  if (companyAddress) {
    doc
      .fontSize(baseFontSize - 1)
      .fillColor("#64748b")
      .text(companyAddress, { align: "left" });
  } else {
    doc
      .fontSize(baseFontSize - 1)
      .fillColor("#64748b")
      .text("Sistem Manajemen Bisnis Multi-Divisi", { align: "left" });
  }

  if (tpl?.companyPhone && tpl.companyPhone.trim()) {
    doc
      .fontSize(baseFontSize - 1)
      .fillColor("#64748b")
      .text(`${tpl.companyPhone}${tpl.companyEmail ? "  ·  " + tpl.companyEmail : ""}`, { align: "left" });
  }

  if (data.companyNpwp) {
    doc
      .fontSize(baseFontSize - 1)
      .fillColor("#475569")
      .font("Helvetica-Bold")
      .text(`NPWP: ${data.companyNpwp}`, { align: "left" })
      .font("Helvetica");
  }

  if (headerText) {
    doc
      .moveDown(0.2)
      .fontSize(baseFontSize - 1)
      .fillColor("#64748b")
      .text(headerText, { align: "left" });
  }

  doc.moveDown(0.3);

  doc
    .fontSize(baseFontSize + 6)
    .fillColor("#0f172a")
    .text(data.title, { align: "right" })
    .fontSize(baseFontSize)
    .fillColor("#475569")
    .text(`No: ${data.docNumber}`, { align: "right" })
    .text(`Tanggal: ${fmtDate(data.createdAt)}`, { align: "right" })
    .text(`Status: ${data.status.toUpperCase()}`, { align: "right" })
    .moveDown(1);

  doc
    .moveTo(48, doc.y)
    .lineTo(547, doc.y)
    .strokeColor(accentColor)
    .stroke()
    .moveDown(0.5);

  const partyTop = doc.y;
  doc
    .fontSize(baseFontSize - 1)
    .fillColor("#64748b")
    .text(data.partyLabel.toUpperCase(), 48, partyTop)
    .fontSize(baseFontSize + 1)
    .fillColor("#0f172a")
    .text(data.partyName, 48, doc.y + 2);
  if (data.partyAddress)
    doc.fontSize(baseFontSize - 1).fillColor("#475569").text(data.partyAddress, 48, doc.y + 2, { width: 240 });
  if (data.partyTaxId) {
    doc
      .font("Helvetica-Bold")
      .fillColor("#0f172a")
      .text(`NPWP: ${data.partyTaxId}`, 48)
      .font("Helvetica")
      .fillColor("#475569");
  }
  if (data.partyEmail) doc.text(`Email: ${data.partyEmail}`, 48);
  if (data.partyPhone) doc.text(`Telp: ${data.partyPhone}`, 48);

  doc
    .fontSize(baseFontSize - 1)
    .fillColor("#64748b")
    .text("DETAIL DOKUMEN", 320, partyTop)
    .fontSize(baseFontSize)
    .fillColor("#0f172a");
  if (data.validUntil) doc.text(`Berlaku Hingga: ${fmtDate(data.validUntil)}`, 320);
  if (data.expectedDate) doc.text(`Estimasi: ${fmtDate(data.expectedDate)}`, 320);
  if (data.confirmedAt) doc.text(`Dikonfirmasi: ${fmtDate(data.confirmedAt)}`, 320);
  if (data.invoiceStatus) doc.text(`Status Tagihan: ${data.invoiceStatus}`, 320);
  if (data.deliveryStatus) doc.text(`Status Kirim: ${data.deliveryStatus}`, 320);
  if (data.receiveStatus) doc.text(`Status Terima: ${data.receiveStatus}`, 320);
  if (data.billStatus) doc.text(`Status Bayar: ${data.billStatus}`, 320);

  doc.moveDown(2);
  const tableTop = Math.max(doc.y, 240);

  const colX = { name: 48, qty: 320, price: 380, sub: 470 };
  const colW = { name: 270, qty: 60, price: 90, sub: 77 };

  const [hr, hg, hb] = hexToRgb(primaryColor);
  doc
    .rect(48, tableTop, 499, 22)
    .fillColor([hr, hg, hb] as any)
    .fill()
    .fillColor("#ffffff")
    .fontSize(baseFontSize)
    .text("Item", colX.name + 6, tableTop + 6, { width: colW.name })
    .text("Qty", colX.qty, tableTop + 6, { width: colW.qty, align: "right" })
    .text("Harga Satuan", colX.price, tableTop + 6, { width: colW.price, align: "right" })
    .text("Subtotal", colX.sub, tableTop + 6, { width: colW.sub, align: "right" });

  let y = tableTop + 28;
  doc.fillColor("#0f172a").fontSize(baseFontSize);
  for (const line of data.lines) {
    if (y > 720) {
      doc.addPage();
      y = 48;
    }
    doc.font("Helvetica-Bold").text(line.name, colX.name + 6, y, { width: colW.name });
    if (line.description) {
      doc
        .font("Helvetica")
        .fontSize(baseFontSize - 2)
        .fillColor("#64748b")
        .text(line.description, colX.name + 6, doc.y + 1, { width: colW.name })
        .fillColor("#0f172a")
        .fontSize(baseFontSize);
    }
    const rowEndY = doc.y;
    doc
      .font("Helvetica")
      .text(String(line.quantity), colX.qty, y, { width: colW.qty, align: "right" })
      .text(idr(line.unitPrice), colX.price, y, { width: colW.price, align: "right" })
      .text(idr(line.subtotal), colX.sub, y, { width: colW.sub, align: "right" });
    y = Math.max(rowEndY, y + 14) + 8;
    doc
      .moveTo(48, y - 4)
      .lineTo(547, y - 4)
      .strokeColor("#f1f5f9")
      .stroke();
  }

  if (y > 700) {
    doc.addPage();
    y = 48;
  }

  const hasTaxBreakdown = (data.taxAmount ?? 0) > 0 && (data.grandTotal ?? 0) > 0;
  const taxPct = data.taxRate ?? 11;

  if (hasTaxBreakdown) {
    doc
      .font("Helvetica")
      .fontSize(baseFontSize)
      .fillColor("#475569")
      .text("Subtotal", 320, y + 10, { width: 147, align: "right" })
      .text(idr(data.totalAmount), 470, y + 10, { width: 77, align: "right" });
    y += 22;

    doc
      .text(`PPN ${taxPct}%`, 320, y + 6, { width: 147, align: "right" })
      .text(idr(data.taxAmount!), 470, y + 6, { width: 77, align: "right" });
    y += 20;

    doc
      .moveTo(320, y)
      .lineTo(547, y)
      .strokeColor("#cbd5e1")
      .stroke();
    y += 6;

    doc
      .fillColor("#0f172a")
      .fontSize(baseFontSize + 1)
      .text("Grand Total", 320, y + 6, { width: 147, align: "right" })
      .font("Helvetica-Bold")
      .fontSize(baseFontSize + 4)
      .text(idr(data.grandTotal!), 470, y + 4, { width: 77, align: "right" });
  } else {
    doc
      .moveDown(1)
      .fontSize(baseFontSize + 1)
      .fillColor("#0f172a")
      .text("TOTAL", 380, y + 10, { width: 90, align: "right" })
      .font("Helvetica-Bold")
      .fontSize(baseFontSize + 4)
      .text(idr(data.totalAmount), 470, y + 8, { width: 77, align: "right" });
  }

  const notesText = data.notes || (tpl?.defaultNotes && tpl.defaultNotes.trim() ? tpl.defaultNotes : null);
  if (notesText) {
    doc
      .moveDown(2)
      .font("Helvetica")
      .fontSize(baseFontSize - 1)
      .fillColor("#64748b")
      .text("Catatan:", 48)
      .fillColor("#0f172a")
      .text(notesText, 48, doc.y + 2, { width: 499 });
  }

  if (defaultTerms) {
    doc
      .moveDown(1)
      .font("Helvetica")
      .fontSize(baseFontSize - 1)
      .fillColor("#64748b")
      .text("Syarat & Ketentuan:", 48)
      .fillColor("#475569")
      .text(defaultTerms, 48, doc.y + 2, { width: 499 });
  }

  if (showSignature || showStamp) {
    const sigY = doc.y + 24;
    if (sigY < 720) {
      const cols = showSignature && showStamp ? 3 : 2;
      const boxW = Math.floor(499 / cols);
      const labels = ["Dibuat oleh", "Diterima oleh"];
      if (showStamp) labels.push("Cap Perusahaan");

      doc.moveDown(2);
      const startY = doc.y;
      labels.forEach((label, i) => {
        const x = 48 + i * boxW;
        doc
          .fontSize(baseFontSize - 1)
          .fillColor("#64748b")
          .text(label, x, startY, { width: boxW, align: "center" });
        doc
          .moveTo(x + 10, startY + 40)
          .lineTo(x + boxW - 10, startY + 40)
          .strokeColor("#374151")
          .stroke();
        doc
          .fontSize(baseFontSize - 2)
          .fillColor("#9ca3af")
          .text("( _________________________ )", x, startY + 44, { width: boxW, align: "center" });
      });
    }
  }

  doc
    .fontSize(8)
    .fillColor("#94a3b8")
    .text(footerText, 48, 780, { width: 499, align: "center" });
}

export function buildInvoicePdfBuffer(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    _renderInvoiceDoc(doc, data);
    doc.end();
  });
}

export function streamInvoicePdf(res: Response, data: InvoiceData): void {
  const filename = `${data.docNumber.replace(/[\\/]/g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  doc.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ message: "PDF generation error", error: String(err?.message ?? err) });
    } else {
      res.end();
    }
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      try { doc.end(); } catch { /* ignore */ }
    }
  });
  doc.pipe(res);
  _renderInvoiceDoc(doc, data);
  doc.end();
}
