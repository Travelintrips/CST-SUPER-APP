import { Router, type Request, type Response } from "express";
import multer from "multer";
import { eq, sql } from "drizzle-orm";
import { db, salesDocumentsTable } from "@workspace/db";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa, getAdminWa } from "../lib/adminWa.js";
import { writeAuditLog } from "../lib/auditLog.js";
import { logTokenAccess } from "../lib/tokenGuard.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { createAlertAndBroadcast } from "../lib/alertHelpers.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const paymentProofPublicRouter = Router();
export const paymentProofAdminRouter = Router();

// Columns payment_proof_token, proof_url, proof_uploaded_at, proof_remarks
// are managed via official Drizzle migrations — not created at startup.

// ─── Security: HTML escaping ──────────────────────────────────────────────────

/** Escape user-supplied values before interpolating into server-rendered HTML. */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

const COMMON_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:16px;padding:24px;max-width:440px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.08)}
  .brand{display:flex;align-items:center;gap:8px;margin-bottom:20px}
  .brand-icon{width:36px;height:36px;background:#0ea5e9;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;letter-spacing:.5px}
  .brand-name{font-weight:600;color:#0f172a;font-size:15px}
  .info-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:20px}
  .info-row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
  .info-label{color:#64748b}
  .info-value{font-weight:500;color:#0f172a;text-align:right;max-width:65%;word-break:break-word}
`;

function shellHtml(body: string, title = "Bukti Pembayaran"): string {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${COMMON_CSS}</style></head><body>${body}</body></html>`;
}

function errorHtml(msg: string): string {
  return shellHtml(`
    <div class="card">
      <div class="brand"><div class="brand-icon">CST</div><div class="brand-name">B2B Marketplace and Logistic</div></div>
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:12px">⚠️</div>
        <h2 style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:8px">Terjadi Kesalahan</h2>
        <p style="font-size:13px;color:#64748b">${esc(msg)}</p>
      </div>
    </div>
  `);
}

function alreadyUploadedHtml(invoiceLabel: string, customerName: string): string {
  return shellHtml(`
    <div class="card">
      <div class="brand"><div class="brand-icon">CST</div><div class="brand-name">B2B Marketplace and Logistic</div></div>
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:12px">✅</div>
        <h2 style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:8px">Bukti Sudah Diterima</h2>
        <p style="font-size:13px;color:#64748b;margin-bottom:16px">Bukti pembayaran untuk invoice <strong>${esc(invoiceLabel)}</strong> atas nama <strong>${esc(customerName)}</strong> telah berhasil diunggah sebelumnya.</p>
        <p style="font-size:13px;color:#94a3b8">Tim kami akan segera memverifikasi pembayaran Anda.</p>
      </div>
    </div>
  `);
}

function successHtml(invoiceLabel: string, customerName: string): string {
  return shellHtml(`
    <div class="card">
      <div class="brand"><div class="brand-icon">CST</div><div class="brand-name">B2B Marketplace and Logistic</div></div>
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:12px">🎉</div>
        <h2 style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:8px">Terima Kasih!</h2>
        <p style="font-size:13px;color:#64748b;margin-bottom:16px">Bukti pembayaran untuk invoice <strong>${esc(invoiceLabel)}</strong> atas nama <strong>${esc(customerName)}</strong> telah berhasil diterima.</p>
        <p style="font-size:13px;color:#94a3b8">Tim kami akan segera memverifikasi dan mengkonfirmasi pembayaran Anda.</p>
      </div>
    </div>
  `);
}

function uploadFormHtml(token: string, invoiceLabel: string, customerName: string, grandTotal: string): string {
  const uploadUrl = `/api/customer-invoice/proof/${encodeURIComponent(token)}/upload`;
  return shellHtml(`
  <div class="card">
    <div class="brand"><div class="brand-icon">CST</div><div class="brand-name">B2B Marketplace and Logistic</div></div>
    <h1 style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:6px">Upload Bukti Pembayaran</h1>
    <p style="font-size:13px;color:#64748b;margin-bottom:20px">Silakan unggah bukti pembayaran untuk invoice berikut</p>
    <div class="info-box">
      <div class="info-row"><span class="info-label">Invoice</span><span class="info-value">${esc(invoiceLabel)}</span></div>
      <div class="info-row"><span class="info-label">Customer</span><span class="info-value">${esc(customerName)}</span></div>
      <div class="info-row"><span class="info-label">Total</span><span class="info-value">${esc(grandTotal)}</span></div>
    </div>
    <form id="form">
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Bukti Pembayaran <span style="color:#ef4444">*</span></label>
        <div id="fileArea" onclick="document.getElementById('fi').click()" style="border:2px dashed #cbd5e1;border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:border-color .2s">
          <div style="font-size:32px;margin-bottom:8px">📎</div>
          <div id="fileText" style="font-size:13px;color:#64748b">Klik untuk pilih file</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">PDF, JPG, atau PNG — Maks. 10MB</div>
        </div>
        <input type="file" id="fi" accept=".pdf,.jpg,.jpeg,.png" style="display:none" required>
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Catatan (opsional)</label>
        <textarea id="remarks" placeholder="Contoh: Transfer via BCA, nama pengirim: PT ABC" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:13px;resize:vertical;min-height:72px;outline:none;font-family:inherit"></textarea>
      </div>
      <button type="submit" id="submitBtn" disabled style="width:100%;background:#94a3b8;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:600;cursor:not-allowed">Pilih File Terlebih Dahulu</button>
    </form>
    <div id="progress" style="display:none;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;text-align:center;margin-top:12px;font-size:13px;color:#0284c7">
      <span style="display:inline-block;width:14px;height:14px;border:2px solid #bae6fd;border-top-color:#0284c7;border-radius:50%;animation:spin .8s linear infinite;margin-right:6px;vertical-align:middle"></span>
      Mengunggah bukti pembayaran…
    </div>
    <div id="errBox" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;text-align:center;margin-top:12px;font-size:13px;color:#dc2626"></div>
  </div>
  <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  <script>
    var fi=document.getElementById('fi'),fa=document.getElementById('fileArea'),ft=document.getElementById('fileText'),sb=document.getElementById('submitBtn');
    fi.addEventListener('change',function(){
      var f=fi.files[0];
      if(f){
        fa.style.borderColor='#0ea5e9';fa.style.background='#f0f9ff';
        ft.innerHTML='<span style="color:#0ea5e9;font-weight:500">📄 '+f.name+'</span>';
        sb.disabled=false;sb.style.background='#0ea5e9';sb.style.cursor='pointer';sb.textContent='Upload Bukti Pembayaran';
      }
    });
    document.getElementById('form').addEventListener('submit',async function(e){
      e.preventDefault();
      var f=fi.files[0];if(!f)return;
      sb.disabled=true;
      document.getElementById('form').style.display='none';
      document.getElementById('progress').style.display='block';
      document.getElementById('errBox').style.display='none';
      var fd=new FormData();
      fd.append('file',f);
      fd.append('remarks',document.getElementById('remarks').value);
      try{
        var r=await fetch('${uploadUrl}',{method:'POST',body:fd});
        if(r.ok){var html=await r.text();document.open();document.write(html);document.close();}
        else{throw new Error('Upload gagal (HTTP '+r.status+')');}
      }catch(err){
        document.getElementById('progress').style.display='none';
        document.getElementById('form').style.display='block';
        document.getElementById('errBox').style.display='block';
        document.getElementById('errBox').textContent=err.message||'Upload gagal. Silakan coba lagi.';
        sb.disabled=false;
      }
    });
  </script>
  `);
}

// ─── PUBLIC: GET /api/customer-invoice/proof/:token ──────────────────────────

paymentProofPublicRouter.get("/proof/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    res.status(400).send(errorHtml("Link tidak valid."));
    return;
  }

  const [doc] = await db
    .select({
      id: salesDocumentsTable.id,
      docNumber: salesDocumentsTable.docNumber,
      invoiceNumber: salesDocumentsTable.invoiceNumber,
      customerName: salesDocumentsTable.customerName,
      grandTotal: salesDocumentsTable.grandTotal,
      proofUrl: salesDocumentsTable.proofUrl,
    })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.paymentProofToken, token));

  if (!doc) {
    res.status(404).send(errorHtml("Link tidak valid atau sudah kadaluwarsa."));
    return;
  }

  const invoiceLabel = doc.invoiceNumber || doc.docNumber;

  if (doc.proofUrl) {
    res.send(alreadyUploadedHtml(invoiceLabel, doc.customerName));
    return;
  }

  const grandTotal = doc.grandTotal
    ? `Rp ${Math.round(Number(doc.grandTotal)).toLocaleString("id-ID")}`
    : "-";
  res.send(uploadFormHtml(token, invoiceLabel, doc.customerName, grandTotal));
});

// ─── PUBLIC: POST /api/customer-invoice/proof/:token/upload ──────────────────

paymentProofPublicRouter.post(
  "/proof/:token/upload",
  upload.single("file") as any,
  async (req: Request, res: Response): Promise<void> => {
    const token = String(req.params.token ?? "");
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      res.status(400).send(errorHtml("Link tidak valid."));
      return;
    }

    if (!req.file) {
      res.status(400).send(errorHtml("File tidak ditemukan. Silakan pilih file terlebih dahulu."));
      return;
    }

    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!allowed.includes(req.file.mimetype)) {
      res.status(400).send(errorHtml("Tipe file tidak didukung. Gunakan JPG, PNG, atau PDF."));
      return;
    }

    const remarks = String(req.body?.remarks ?? "").trim().slice(0, 500);

    const [doc] = await db
      .select({
        id: salesDocumentsTable.id,
        docNumber: salesDocumentsTable.docNumber,
        invoiceNumber: salesDocumentsTable.invoiceNumber,
        customerName: salesDocumentsTable.customerName,
        grandTotal: salesDocumentsTable.grandTotal,
        logisticOrderId: salesDocumentsTable.logisticOrderId,
        companyId: salesDocumentsTable.companyId,
        proofUrl: salesDocumentsTable.proofUrl,
      })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.paymentProofToken, token));

    if (!doc) {
      res.status(404).send(errorHtml("Link tidak valid atau sudah kadaluwarsa."));
      return;
    }

    const invoiceLabel = doc.invoiceNumber || doc.docNumber;

    if (doc.proofUrl) {
      res.send(alreadyUploadedHtml(invoiceLabel, doc.customerName));
      return;
    }

    // ── P0-2: Upload ke PRIVATE bucket ────────────────────────────────────────
    let privateStoragePath: string;
    try {
      const objStore = new ObjectStorageService();
      privateStoragePath = await objStore.uploadPrivateEntity(req.file.buffer, req.file.mimetype);
    } catch (err) {
      logger.error({ err }, "[paymentProof] upload to private storage failed");
      res.status(500).send(errorHtml("Gagal mengunggah file. Silakan coba lagi."));
      return;
    }

    // Simpan private storage path di DB; akses via endpoint internal /proof-file/:id
    await db
      .update(salesDocumentsTable)
      .set({
        proofUrl: privateStoragePath,
        proofUploadedAt: new Date(),
        proofRemarks: remarks || null,
      })
      .where(eq(salesDocumentsTable.id, doc.id));

    if (doc.logisticOrderId) {
      void transitionLogisticOrderStatus(doc.logisticOrderId, "Payment Received", {
        source: "customer:proof-upload",
        actorType: "customer",
        notes: `Bukti pembayaran diunggah oleh customer (invoice: ${invoiceLabel})`,
      }).catch((e: unknown) => logger.warn({ e }, "[paymentProof] status transition warn"));
    }

    // Internal endpoint URL — admin akses file via /api/customer-invoice/:id/proof-file
    const internalProofUrl = `/api/customer-invoice/${doc.id}/proof-file`;

    void createAlertAndBroadcast({
      companyId: doc.companyId ?? null,
      alertType: "payment_proof_uploaded",
      entityType: "sales_document",
      entityId: doc.id,
      entityRef: invoiceLabel,
      severity: "info",
      title: "Bukti Pembayaran Diterima",
      message: `${doc.customerName} mengunggah bukti pembayaran untuk invoice ${invoiceLabel}`,
      contextJson: { proofUrl: internalProofUrl, remarks: remarks || null },
    });

    writeAuditLog({
      companyId: doc.companyId ?? null,
      userId: null,
      userEmail: null,
      action: "payment_proof_uploaded",
      module: "payment_proof",
      referenceId: String(doc.id),
      newData: {
        invoiceId: doc.id,
        invoiceLabel,
        proofUrl: internalProofUrl,
        remarks: remarks || null,
      },
      ipAddress:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
        req.socket?.remoteAddress ??
        "unknown",
      userAgent: (req.headers["user-agent"] as string) ?? "unknown",
    });

    void (async () => {
      try {
        const adminPhone = await getAdminGroupWa();
        if (adminPhone) {
          const grandTotal = doc.grandTotal
            ? `Rp ${Math.round(Number(doc.grandTotal)).toLocaleString("id-ID")}`
            : "-";
          const msg = [
            `💳 *BUKTI PEMBAYARAN DITERIMA*`,
            ``,
            `Customer: ${doc.customerName}`,
            `Invoice: ${invoiceLabel}`,
            `Total: ${grandTotal}`,
            remarks ? `Catatan: ${remarks}` : null,
            ``,
            `📎 Lihat bukti di BizPortal:`,
            internalProofUrl,
          ]
            .filter((x) => x !== null)
            .join("\n");
          await sendWhatsApp(adminPhone, msg, {
            context: "payment_proof_admin_notif",
            refId: String(doc.id),
          });
        }
      } catch (e) {
        logger.warn({ e }, "[paymentProof] admin WA notif failed");
      }
    })();

    res.send(successHtml(invoiceLabel, doc.customerName));
  }
);

// ─── ADMIN: GET /api/customer-invoice/:id/proof-info ─────────────────────────

paymentProofAdminRouter.get("/:id/proof-info", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const id = Number(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ message: "Invalid id" });
    return;
  }

  const [doc] = await db
    .select({
      id: salesDocumentsTable.id,
      docNumber: salesDocumentsTable.docNumber,
      invoiceNumber: salesDocumentsTable.invoiceNumber,
      customerName: salesDocumentsTable.customerName,
      grandTotal: salesDocumentsTable.grandTotal,
      paymentProofToken: salesDocumentsTable.paymentProofToken,
      proofUrl: salesDocumentsTable.proofUrl,
      proofUploadedAt: salesDocumentsTable.proofUploadedAt,
      proofRemarks: salesDocumentsTable.proofRemarks,
    })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, id));

  if (!doc) {
    res.status(404).json({ message: "Not found" });
    return;
  }

  // P0-2: proofUrl dikembalikan sebagai endpoint internal, bukan URL bucket
  const proofUrl = doc.proofUrl
    ? `/api/customer-invoice/${doc.id}/proof-file`
    : null;

  res.json({
    id: doc.id,
    docNumber: doc.docNumber,
    invoiceNumber: doc.invoiceNumber,
    customerName: doc.customerName,
    grandTotal: doc.grandTotal,
    hasToken: !!doc.paymentProofToken,
    proofUrl,
    proofUploadedAt: doc.proofUploadedAt ?? null,
    proofRemarks: doc.proofRemarks ?? null,
  });
});

// ─── ADMIN: GET /api/customer-invoice/:id/proof-file — signed URL 5 menit ────
// P0-2: Admin-only. Tidak pernah expose URL bucket Supabase ke client langsung.

paymentProofAdminRouter.get("/:id/proof-file", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const id = Number(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ message: "Invalid id" });
    return;
  }

  const [doc] = await db
    .select({ proofUrl: salesDocumentsTable.proofUrl })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, id));

  if (!doc?.proofUrl) {
    res.status(404).json({ message: "Bukti pembayaran belum ada" });
    return;
  }

  try {
    const objStore = new ObjectStorageService();
    // proofUrl di DB adalah private storage path (/objects/uploads/...)
    const signedUrl = await objStore.getSignedUrl(doc.proofUrl, 300); // 5 menit
    res.redirect(302, signedUrl);
  } catch (err) {
    logger.error({ err, id }, "[paymentProof] failed to generate signed URL");
    res.status(500).json({ message: "Gagal mengakses file bukti pembayaran" });
  }
});

// ─── ADMIN: POST /api/customer-invoice/:id/resend-proof-wa ───────────────────

paymentProofAdminRouter.post("/:id/resend-proof-wa", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const id = Number(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ message: "Invalid id" });
    return;
  }

  try {
    const { sendPaymentProofWaLink } = await import("../lib/paymentProofService.js");
    await sendPaymentProofWaLink(id);
    res.json({ ok: true, message: "WA dikirim ulang" });
  } catch (err: any) {
    logger.error({ err, id }, "[paymentProof] resend WA failed");
    res.status(500).json({ message: err?.message ?? "Gagal mengirim WA" });
  }
});
const router = Router();

// Columns managed via official Drizzle migrations — not at startup.
// eslint-disable-next-line @typescript-eslint/no-empty-function
async function ensureColumns() { /* no-op: DDL is managed via migrations */ }

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
]);

// ─── GET /api/payment-proof/:token ────────────────────────────────────────────
router.get("/:token", async (req: Request, res: Response) => {
  await ensureColumns();
  const token = String(req.params.token ?? "");
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    return res.status(400).json({ error: "Token tidak valid." });
  }
  try {
    const rows = await db.execute(sql`
      SELECT id, doc_number, invoice_number, customer_name, grand_total,
             payment_status, proof_url, proof_remarks, proof_uploaded_at, due_date,
             proof_upload_token_expires_at
      FROM sales_documents
      WHERE proof_upload_token = ${token}
      LIMIT 1
    `);
    const row = (rows as unknown as Record<string, unknown>[])[0];
    if (!row) {
      logTokenAccess({ tokenType: "payment_proof", tokenRef: token, action: "view", outcome: "denied_not_found", req });
      return res.status(404).json({ error: "Link tidak ditemukan atau sudah kedaluwarsa." });
    }
    if (row["proof_upload_token_expires_at"] && new Date(String(row["proof_upload_token_expires_at"])) < new Date()) {
      logTokenAccess({ tokenType: "payment_proof", tokenRef: token, entityId: String(row["id"]), action: "view", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link upload bukti pembayaran sudah kadaluarsa." });
    }
    logTokenAccess({ tokenType: "payment_proof", tokenRef: token, entityId: String(row["id"]), action: "view", outcome: "ok", req });

    const docId = Number(row["id"]);
    // P0-2: Transform proofUrl ke internal endpoint, bukan URL bucket
    const proofUrlRaw = row["proof_url"] as string | null;
    const proofUrl = proofUrlRaw ? `/api/payment-proof/file/${docId}` : null;

    return res.json({
      ok: true,
      invoice: {
        docNumber: row["doc_number"],
        invoiceNumber: row["invoice_number"],
        customerName: row["customer_name"],
        grandTotal: Number(row["grand_total"]),
        paymentStatus: row["payment_status"],
        proofUrl,
        proofRemarks: row["proof_remarks"],
        proofUploadedAt: row["proof_uploaded_at"],
        dueDate: row["due_date"],
      },
    });
  } catch (e) {
    logger.error({ e }, "paymentProof GET error");
    return res.status(500).json({ error: "Terjadi kesalahan." });
  }
});

// ─── POST /api/payment-proof/:token/upload ────────────────────────────────────
router.post("/:token/upload", upload.single("file"), async (req: Request, res: Response) => {
  await ensureColumns();
  const token = String(req.params.token ?? "");
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    return res.status(400).json({ error: "Token tidak valid." });
  }

  const file = req.file;
  if (!file) return res.status(400).json({ error: "File wajib dilampirkan." });
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return res.status(400).json({ error: "Format tidak didukung. Gunakan PDF, JPG, atau PNG." });
  }

  const bodyRaw = req.body as Record<string, unknown>;
  const remarks =
    typeof bodyRaw["remarks"] === "string"
      ? String(bodyRaw["remarks"]).slice(0, 500)
      : null;

  try {
    const rows = await db.execute(sql`
      SELECT id, doc_number, invoice_number, customer_name, grand_total,
             customer_id, logistic_order_id, proof_upload_token_expires_at
      FROM sales_documents
      WHERE proof_upload_token = ${token}
      LIMIT 1
    `);
    const row = (rows as unknown as Record<string, unknown>[])[0];
    if (!row) {
      logTokenAccess({ tokenType: "payment_proof", tokenRef: token, action: "upload", outcome: "denied_not_found", req });
      return res.status(404).json({ error: "Link tidak ditemukan." });
    }
    if (row["proof_upload_token_expires_at"] && new Date(String(row["proof_upload_token_expires_at"])) < new Date()) {
      logTokenAccess({ tokenType: "payment_proof", tokenRef: token, entityId: String(row["id"]), action: "upload", outcome: "denied_expired", req });
      return res.status(410).json({ error: "Link upload bukti pembayaran sudah kadaluarsa." });
    }
    logTokenAccess({ tokenType: "payment_proof", tokenRef: token, entityId: String(row["id"]), action: "upload", outcome: "ok", req });

    // ── P0-2: Upload ke PRIVATE bucket ────────────────────────────────────────
    const objStore = new ObjectStorageService();
    const proofPrivatePath = await objStore.uploadPrivateEntity(file.buffer, file.mimetype);
    // Internal endpoint URL — akses via /api/payment-proof/file/:id (admin only)
    const internalProofUrl = `/api/payment-proof/file/${String(row["id"])}`;

    // Update record — simpan private path di DB
    await db.execute(sql`
      UPDATE sales_documents
      SET proof_url = ${proofPrivatePath},
          proof_remarks = ${remarks},
          proof_uploaded_at = NOW()
      WHERE id = ${Number(row["id"])}
    `);

    // Audit log
    db.execute(sql`
      INSERT INTO erp_audit_logs (event_type, ref_type, ref_id, actor_type, metadata, created_at)
      VALUES (
        'payment_proof_uploaded',
        'sales_order',
        ${String(row["doc_number"])},
        'customer',
        ${JSON.stringify({
          invoiceNumber: row["invoice_number"],
          proofUrl: internalProofUrl,
          remarks,
          customerId: row["customer_id"],
        })}::jsonb,
        NOW()
      )
    `).catch((e: unknown) => logger.error({ e }, "paymentProof audit log failed"));

    // WA notif admin (P0-2: kirim internal URL, bukan URL bucket)
    const fmtIdr = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
    const adminMsg = [
      `📎 *Bukti Pembayaran Diterima*`,
      ``,
      `Customer: ${String(row["customer_name"] ?? "-")}`,
      `Invoice: ${String(row["invoice_number"] ?? row["doc_number"])}`,
      `Total: ${fmtIdr(Number(row["grand_total"]))}`,
      remarks ? `Catatan: ${remarks}` : null,
      ``,
      `Lihat di BizPortal: ${internalProofUrl}`,
    ].filter((l) => l !== null).join("\n");

    getAdminWa()
      .then((adminWa) => {
        if (adminWa) {
          sendWhatsApp(adminWa, adminMsg, {
            context: "payment_proof_uploaded",
            refType: "sales_order",
            refId: String(row["doc_number"]),
          }).catch((e: unknown) => logger.error({ e }, "paymentProof admin WA failed"));
        }
      })
      .catch((e: unknown) => logger.error({ e }, "paymentProof getAdminWa failed"));

    // WA konfirmasi ke customer
    if (row["customer_id"]) {
      (async () => {
        try {
          const custRows = await db.execute(sql`
            SELECT phone FROM customers WHERE id = ${Number(row["customer_id"])} LIMIT 1
          `);
          const cust = (custRows as unknown as Record<string, unknown>[])[0];
          const customerPhone = cust?.["phone"] as string | null;
          if (customerPhone) {
            const customerMsg = [
              `✅ *Bukti pembayaran Anda berhasil diterima.*`,
              ``,
              `Invoice: ${String(row["invoice_number"] ?? row["doc_number"])}`,
              ``,
              `Terima kasih. Tim kami akan segera memverifikasi pembayaran Anda.`,
            ].join("\n");
            await sendWhatsApp(customerPhone, customerMsg, {
              context: "payment_proof_confirmed",
              refType: "invoice",
              refId: String(row["invoice_number"] ?? row["doc_number"]),
            });
          }
        } catch (e) {
          logger.error({ e }, "paymentProof customer WA confirm failed");
        }
      })().catch(() => {});
    }

    // P0-2: Return internal endpoint URL, bukan URL bucket
    return res.json({ ok: true, proofUrl: internalProofUrl, message: "Bukti pembayaran berhasil diunggah." });
  } catch (e) {
    logger.error({ e }, "paymentProof POST upload error");
    return res.status(500).json({ error: "Gagal mengunggah file. Silakan coba lagi." });
  }
});

// ─── ADMIN: GET /api/payment-proof/file/:documentId — signed URL 5 menit ─────
// P0-2: Requires admin auth. Generates Supabase signed URL (expiry 5 min). Never returns bucket URL directly.

router.get("/file/:documentId", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const docId = Number(String(req.params.documentId));
  if (isNaN(docId)) return res.status(400).json({ error: "Invalid document id" });

  try {
    const rows = await db.execute(sql`
      SELECT id, proof_url FROM sales_documents WHERE id = ${docId} LIMIT 1
    `);
    const row = (rows as unknown as Record<string, unknown>[])[0];
    if (!row) return res.status(404).json({ error: "Dokumen tidak ditemukan" });

    const storedPath = row["proof_url"] as string | null;
    if (!storedPath) return res.status(404).json({ error: "Bukti pembayaran belum ada" });

    const objStore = new ObjectStorageService();
    // Signed URL expiry: 300 detik (5 menit)
    const signedUrl = await objStore.getSignedUrl(storedPath, 300);
    return res.redirect(302, signedUrl);
  } catch (err) {
    logger.error({ err, docId }, "[paymentProof] /file/:documentId signed URL error");
    return res.status(500).json({ error: "Gagal mengakses file bukti pembayaran" });
  }
});

export { router as paymentProofRouter };
