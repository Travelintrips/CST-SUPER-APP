import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, salesDocumentsTable, logisticOrdersTable, customersTable } from "@workspace/db";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getPreferredDomain } from "./domain.js";
import { logger } from "./logger.js";

export async function generateOrGetProofToken(salesDocId: number): Promise<string> {
  const [doc] = await db
    .select({ paymentProofToken: salesDocumentsTable.paymentProofToken })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, salesDocId));

  if (doc?.paymentProofToken) return doc.paymentProofToken;

  const token = randomBytes(32).toString("hex");
  await db
    .update(salesDocumentsTable)
    .set({ paymentProofToken: token })
    .where(eq(salesDocumentsTable.id, salesDocId));
  return token;
}

export async function sendPaymentProofWaLink(salesDocId: number): Promise<void> {
  const [doc] = await db
    .select({
      id: salesDocumentsTable.id,
      docNumber: salesDocumentsTable.docNumber,
      invoiceNumber: salesDocumentsTable.invoiceNumber,
      customerName: salesDocumentsTable.customerName,
      grandTotal: salesDocumentsTable.grandTotal,
      logisticOrderId: salesDocumentsTable.logisticOrderId,
      customerId: salesDocumentsTable.customerId,
      proofUrl: salesDocumentsTable.proofUrl,
    })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, salesDocId));

  if (!doc) return;

  if (doc.proofUrl) {
    logger.info({ salesDocId }, "[paymentProofService] proof already uploaded, skipping WA");
    return;
  }

  let customerPhone: string | null = null;
  if (doc.logisticOrderId) {
    const [order] = await db
      .select({ phone: logisticOrdersTable.phone })
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, doc.logisticOrderId));
    customerPhone = order?.phone?.trim() || null;
  }
  if (!customerPhone && doc.customerId) {
    const [customer] = await db
      .select({ phone: customersTable.phone })
      .from(customersTable)
      .where(eq(customersTable.id, doc.customerId));
    customerPhone = customer?.phone?.trim() || null;
  }

  if (!customerPhone) {
    logger.warn({ salesDocId }, "[paymentProofService] no customer phone, skipping WA");
    return;
  }

  const token = await generateOrGetProofToken(salesDocId);
  const domain = getPreferredDomain();
  const baseUrl = domain ? `https://${domain}` : "";
  const uploadUrl = `${baseUrl}/api/customer-invoice/proof/${token}`;

  const invoiceLabel = doc.invoiceNumber || doc.docNumber;
  const grandTotal = doc.grandTotal
    ? `Rp ${Math.round(Number(doc.grandTotal)).toLocaleString("id-ID")}`
    : "-";

  const msg = [
    `Yth. *${doc.customerName}*,`,
    ``,
    `Terima kasih atas pembayaran invoice *${invoiceLabel}* sebesar *${grandTotal}*.`,
    ``,
    `Mohon unggah bukti pembayaran Anda melalui link berikut:`,
    uploadUrl,
    ``,
    `_Pesan ini dikirim otomatis. Abaikan jika sudah mengunggah bukti sebelumnya._`,
  ].join("\n");

  await sendWhatsApp(customerPhone, msg, {
    context: "payment_proof_request",
    refId: String(salesDocId),
  });

  logger.info(
    { salesDocId, phone: customerPhone.slice(0, 6) + "***" },
    "[paymentProofService] WA proof link sent"
  );
}
