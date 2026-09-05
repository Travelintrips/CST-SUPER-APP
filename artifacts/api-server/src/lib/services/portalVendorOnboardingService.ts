import {
  db,
  userProfilesTable,
  ocrResultsTable,
  vendorProfilesTable,
  driverProfilesTable,
  employeeProfilesTable,
  onboardingApprovalsTable,
  identityDocumentsTable,
  portalCustomersTable,
} from "@workspace/db";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { deleteFromSupabase } from "../supabaseStorage.js";
import { ObjectStorageService } from "../objectStorage.js";
import { sendViaService as sendWhatsApp } from "../waTransport.js";
import { getAdminWa } from "../adminWa.js";
import { getWaTemplateConfig, renderTemplate } from "../orderNotification.js";
import { NotificationService } from "./notificationService.js";
import OpenAI from "openai";
import { KtpOcrError, classifyKtpOcrError } from "./ktpOcrErrors.js";
import { configureCustomerOrganization } from "./portalCustomerOrganizationService.js";
import { normalizePhone } from "../phoneUtils.js";
import { isSafeDevTestMode } from "../safeDev.js";

// ── OpenAI client ─────────────────────────────────────────────────────────────

function getOnboardingOpenAI(): OpenAI {
  const directKey = process.env.OPENAI_API_KEY?.trim();
  const intKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = directKey || intKey;
  if (!apiKey) throw new KtpOcrError("NOT_CONFIGURED");
  return new OpenAI({ apiKey, baseURL: directKey ? undefined : baseURL });
}

// ── Allowed MIME types ────────────────────────────────────────────────────────

const _ONBOARDING_DOC_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// ── Error class ───────────────────────────────────────────────────────────────

export class OnboardingServiceError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "OnboardingServiceError";
  }
}

// ── getOnboardingStatus ───────────────────────────────────────────────────────

export async function getOnboardingStatus(customerId: number) {
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.customerId, customerId));

  // portal_customers.role is the canonical account owner. Legacy
  // user_profiles.account_type can be stale (notably a vendor row left with
  // the old customer default), so never let it route an existing vendor into
  // customer organization completion.
  const [customer] = await db
    .select({ role: portalCustomersTable.role })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  const role = customer?.role ?? profile?.accountType ?? "customer";
  const accountType = role === "vendor" || role === "driver" || role === "employee"
    ? role
    : role === "customer"
      ? "customer"
      : profile?.accountType ?? null;

  if (!profile) {
    return { status: "incomplete", accountType, role, hasProfile: false };
  }

  const rejectionReason = profile.status === "rejected" ? profile.rejectionReason : undefined;
  return {
    hasProfile: true,
    status: profile.status,
    accountType,
    role,
    ...(rejectionReason ? { rejectionReason } : {}),
    profile: {
      fullName: profile.fullName,
      phone: profile.phone,
      address: profile.address,
      ktpUrl: profile.ktpUrl,
    },
  };
}

// ── runKtpOcr ─────────────────────────────────────────────────────────────────

export async function runKtpOcr(
  customerId: number,
  fileBuffer: Buffer,
  fileMimetype: string,
): Promise<Record<string, string>> {
  const openai = getOnboardingOpenAI();
  const base64 = fileBuffer.toString("base64");
  const mime = fileMimetype || "image/jpeg";

  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Kamu adalah sistem OCR KTP Indonesia. Ekstrak semua field dari KTP ini dan kembalikan HANYA JSON tanpa markdown, format:
{"nik":"...","name":"...","birthPlace":"...","birthDate":"...","address":"...","rt":"...","rw":"...","kelurahan":"...","kecamatan":"...","kabupaten":"...","provinsi":"...","gender":"...","religion":"...","maritalStatus":"...","occupation":"...","nationality":"WNI"}
Isi string kosong jika field tidak terbaca.`,
          },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "high" } },
        ],
      }],
    });
  } catch (error) {
    throw classifyKtpOcrError(error);
  }

  const raw = response.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let data: Record<string, string>;
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("OCR response is not an object");
    }
    data = parsed as Record<string, string>;
  } catch {
    throw new KtpOcrError("INVALID_RESPONSE");
  }

  try {
    await db.insert(ocrResultsTable).values({
      customerId,
      docType: "ktp",
      nik: data.nik || null,
      name: data.name || null,
      birthPlace: data.birthPlace || null,
      birthDate: data.birthDate || null,
      address: data.address || null,
      rt: data.rt || null,
      rw: data.rw || null,
      kelurahan: data.kelurahan || null,
      kecamatan: data.kecamatan || null,
      kabupaten: data.kabupaten || null,
      provinsi: data.provinsi || null,
      gender: data.gender || null,
      religion: data.religion || null,
      maritalStatus: data.maritalStatus || null,
      occupation: data.occupation || null,
      nationality: data.nationality || null,
      rawJson: JSON.stringify(data),
    }).onConflictDoNothing();
  } catch {
    throw new KtpOcrError("PROVIDER");
  }

  return data;
}

// ── uploadOnboardingDoc ───────────────────────────────────────────────────────

export async function uploadOnboardingDoc(
  customerId: number,
  buffer: Buffer,
  mimetype: string,
  originalname: string,
  docType: string,
): Promise<{ url: string; objectPath: string }> {
  if (!_ONBOARDING_DOC_ALLOWED_MIME.has(mimetype)) {
    throw new OnboardingServiceError(415, "Tipe file tidak diizinkan. Gunakan PDF atau gambar (JPEG, PNG, WEBP).");
  }

  const storage = new ObjectStorageService();

  // Upload ke private bucket — dokumen identitas tidak boleh public
  const objectPath = await storage.uploadPrivateEntity(buffer, mimetype);
  const url = `/api/storage${objectPath}`;

  // Hapus doc lama (docType sama) dari storage + DB sebelum insert baru
  const [oldDoc] = await db
    .select({ id: identityDocumentsTable.id, url: identityDocumentsTable.url })
    .from(identityDocumentsTable)
    .where(and(
      eq(identityDocumentsTable.customerId, customerId),
      eq(identityDocumentsTable.docType, docType),
    ))
    .limit(1);

  if (oldDoc) {
    await db.delete(identityDocumentsTable).where(eq(identityDocumentsTable.id, oldDoc.id));
    deleteFromSupabase(oldDoc.url).catch(() => {});
  }

  await db.insert(identityDocumentsTable).values({ customerId, docType, url, fileName: originalname });

  return { url, objectPath };
}

// ── completeOnboarding ────────────────────────────────────────────────────────

export interface CompleteOnboardingInput {
  fullName: string;
  phone: string;
  address: string;
  accountType: string;
  customerType?: "individual" | "company";
  companyId?: number;
  requestedCompanyName?: string;
  requestedRegistrationNumber?: string;
  ktpUrl?: string;
  ocrData?: { nik?: string; name?: string };
  vendor?: {
    companyName?: string;
    nib?: string;
    npwp?: string;
    serviceType?: string;
    legalityDocUrl?: string;
  };
  driver?: {
    licenseNumber?: string;
    vehicleType?: string;
    plateNumber?: string;
    simUrl?: string;
    stnkUrl?: string;
  };
  employee?: {
    companyName?: string;
    branch?: string;
    department?: string;
    division?: string;
    position?: string;
  };
  /**
   * Test-only failure injection. The route only maps this from a request
   * header while APP_ENV=development and SAFE_DEV_TEST_MODE=true.
   */
  _devForceFailureStage?: "customer-mid-flow" | "vendor-mid-flow";
}

export async function completeOnboarding(
  customerId: number,
  input: CompleteOnboardingInput,
): Promise<{
  ok: boolean;
  status: string;
  organization: Awaited<ReturnType<typeof configureCustomerOrganization>> | null;
}> {
  const {
    fullName, phone, address, accountType, customerType, companyId,
    requestedCompanyName, requestedRegistrationNumber,
    ktpUrl, ocrData, vendor, driver, employee,
  } = input;

  const [existingCustomer] = await db
    .select({ role: portalCustomersTable.role })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  if (!existingCustomer) {
    throw new OnboardingServiceError(404, "Akun customer tidak ditemukan.");
  }

  // A persisted non-customer role is authoritative. A stale browser form
  // must not demote an existing vendor into customer organization onboarding.
  // A default customer may still choose vendor during first-time onboarding.
  const effectiveAccountType = existingCustomer.role !== "customer"
    ? existingCustomer.role
    : accountType;
  const isCustomer = effectiveAccountType === "customer";
  if (isCustomer && customerType !== "individual" && customerType !== "company") {
    throw new OnboardingServiceError(400, "Tipe customer wajib dipilih.");
  }
  const status = isCustomer ? "active" : "pending";
  const now = new Date();
  const normalizedPhone = normalizePhone(String(phone));
  if (normalizedPhone.length < 10) {
    throw new OnboardingServiceError(400, "Nomor telepon tidak valid.");
  }

  // Fail before mutating user_profiles. The database unique index remains the
  // final race guard, but this gives an existing-account edit a clean response.
  const [phoneOwner] = await db
    .select({ id: portalCustomersTable.id })
    .from(portalCustomersTable)
    .where(and(
      or(
        inArray(portalCustomersTable.phone, [
          normalizedPhone,
          `0${normalizedPhone.slice(2)}`,
          `+${normalizedPhone}`,
          `620${normalizedPhone.slice(2)}`,
        ]),
        eq(sql`regexp_replace(coalesce(${portalCustomersTable.phone}, ''), '[^0-9]', '', 'g')`, normalizedPhone),
      ),
      sql`${portalCustomersTable.id} <> ${customerId}`,
    ))
    .limit(1);
  if (phoneOwner) {
    throw new OnboardingServiceError(409, "Nomor telepon sudah digunakan oleh akun lain. Gunakan nomor yang berbeda.");
  }

  const devFailureStage = input._devForceFailureStage;
  const shouldForceFailure = process.env.APP_ENV === "development"
    && isSafeDevTestMode()
    && (devFailureStage === "customer-mid-flow" || devFailureStage === "vendor-mid-flow");

  // All onboarding DB writes share this transaction. The transaction-scoped
  // advisory lock serializes retries for one portal customer even when the
  // request arrives on different pool connections.
  const transactionResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${customerId})`);

    const [customer] = await tx
      .select({ id: portalCustomersTable.id, email: portalCustomersTable.email })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, customerId))
      .limit(1);
    if (!customer) throw new OnboardingServiceError(404, "Akun customer tidak ditemukan.");

    // Fetch old document URLs inside the transaction so cleanup only happens
    // after the transaction commits successfully.
    const [existingProfile] = await tx
      .select({ ktpUrl: userProfilesTable.ktpUrl })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.customerId, customerId));
    const [existingVendorProfile] = effectiveAccountType === "vendor"
      ? await tx
        .select({
          id: vendorProfilesTable.id,
          legalityDocUrl: vendorProfilesTable.legalityDocUrl,
        })
        .from(vendorProfilesTable)
        .where(eq(vendorProfilesTable.customerId, customerId))
        .limit(1)
      : [undefined];

    const [existingApproval] = !isCustomer
      ? await tx
        .select({ id: onboardingApprovalsTable.id, status: onboardingApprovalsTable.status })
        .from(onboardingApprovalsTable)
        .where(eq(onboardingApprovalsTable.customerId, customerId))
        .orderBy(sql`${onboardingApprovalsTable.createdAt} DESC`)
        .limit(1)
      : [undefined];

    // An already approved vendor must not be downgraded by a harmless retry.
    const effectiveStatus = existingApproval?.status === "approved" ? "active" : status;

    await tx.insert(userProfilesTable).values({
      customerId,
      fullName: String(fullName),
      phone: normalizedPhone,
      address: String(address),
      accountType: String(effectiveAccountType),
      status: effectiveStatus,
      ktpUrl: ktpUrl ? String(ktpUrl) : null,
      completedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: userProfilesTable.customerId,
      set: {
        fullName: String(fullName),
        phone: normalizedPhone,
        address: String(address),
        accountType: String(effectiveAccountType),
        status: effectiveStatus,
        ktpUrl: ktpUrl ? String(ktpUrl) : null,
        completedAt: now,
        updatedAt: now,
      },
    });

    try {
      await tx.update(portalCustomersTable).set({
        name: String(fullName),
        phone: normalizedPhone,
        ...(isCustomer ? { customerType } : {}),
        role: effectiveAccountType === "vendor"
          ? "vendor"
          : effectiveAccountType === "driver"
            ? "driver"
            : effectiveAccountType === "employee"
              ? "employee"
              : "customer",
      }).where(eq(portalCustomersTable.id, customerId));
    } catch (err: any) {
      if (err?.code === "23505" && err?.constraint?.includes("phone")) {
        throw new OnboardingServiceError(409, "Nomor telepon sudah digunakan oleh akun lain. Gunakan nomor yang berbeda.");
      }
      throw err;
    }

    const organization = isCustomer
      ? await configureCustomerOrganization({
          customerId,
          customerType: customerType!,
          companyId,
          requestedCompanyName,
          requestedRegistrationNumber,
          executor: tx,
        })
      : null;

    if (shouldForceFailure && devFailureStage === "customer-mid-flow" && isCustomer) {
      throw new OnboardingServiceError(500, "DEV TEST: forced customer onboarding rollback");
    }

    if (ocrData?.nik) {
      await tx.update(ocrResultsTable)
        .set({ name: ocrData.name ?? null, nik: ocrData.nik ?? null })
        .where(eq(ocrResultsTable.customerId, customerId));
    }

    let oldVendorLegalityUrl: string | null = null;
    if (effectiveAccountType === "vendor" && vendor) {
      oldVendorLegalityUrl = existingVendorProfile?.legalityDocUrl ?? null;
      const vendorValues = {
        companyName: vendor.companyName ?? null,
        nib: vendor.nib ?? null,
        npwp: vendor.npwp ?? null,
        serviceType: vendor.serviceType ?? null,
        // These values come from the required basic onboarding fields/account.
        // Do not fabricate province, city, postal code, or bank details here.
        picName: fullName,
        phone: normalizedPhone,
        email: customer.email ?? null,
        fullAddress: address,
        legalityDocUrl: vendor.legalityDocUrl ?? null,
        updatedAt: now,
      };
      // Some legacy DEV/PROD snapshots do not have the vendor_profiles unique
      // index even though the ORM schema declares it. The customer advisory
      // lock makes this explicit update/insert branch concurrency-safe without
      // relying on a runtime DDL change.
      if (existingVendorProfile?.id) {
        await tx.update(vendorProfilesTable)
          .set(vendorValues)
          .where(eq(vendorProfilesTable.id, existingVendorProfile.id));
      } else {
        await tx.insert(vendorProfilesTable).values({
          customerId,
          ...vendorValues,
        });
      }
    }

    if (shouldForceFailure && devFailureStage === "vendor-mid-flow" && effectiveAccountType === "vendor") {
      throw new OnboardingServiceError(500, "DEV TEST: forced vendor onboarding rollback");
    }

    if (effectiveAccountType === "driver" && driver) {
      const [existingDriverProfile] = await tx
        .select({ simUrl: driverProfilesTable.simUrl, stnkUrl: driverProfilesTable.stnkUrl })
        .from(driverProfilesTable)
        .where(eq(driverProfilesTable.customerId, customerId));

      await tx.insert(driverProfilesTable).values({
        customerId,
        licenseNumber: driver.licenseNumber ?? null,
        vehicleType: driver.vehicleType ?? null,
        plateNumber: driver.plateNumber ?? null,
        simUrl: driver.simUrl ?? null,
        stnkUrl: driver.stnkUrl ?? null,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: driverProfilesTable.customerId,
        set: {
          licenseNumber: driver.licenseNumber ?? null,
          vehicleType: driver.vehicleType ?? null,
          plateNumber: driver.plateNumber ?? null,
          simUrl: driver.simUrl ?? null,
          stnkUrl: driver.stnkUrl ?? null,
          updatedAt: now,
        },
      });

      if (existingDriverProfile?.simUrl && existingDriverProfile.simUrl !== (driver.simUrl ?? null)) {
        deleteFromSupabase(existingDriverProfile.simUrl).catch(() => {});
      }
      if (existingDriverProfile?.stnkUrl && existingDriverProfile.stnkUrl !== (driver.stnkUrl ?? null)) {
        deleteFromSupabase(existingDriverProfile.stnkUrl).catch(() => {});
      }
    }

    if (effectiveAccountType === "employee" && employee) {
      await tx.insert(employeeProfilesTable).values({
        customerId,
        companyName: employee.companyName ?? null,
        branch: employee.branch ?? null,
        department: employee.department ?? null,
        division: employee.division ?? null,
        position: employee.position ?? null,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: employeeProfilesTable.customerId,
        set: {
          companyName: employee.companyName ?? null,
          branch: employee.branch ?? null,
          department: employee.department ?? null,
          division: employee.division ?? null,
          position: employee.position ?? null,
          updatedAt: now,
        },
      });
    }

    // There is no unique constraint on this legacy table. The advisory lock
    // plus the existing-row check makes retry/concurrent submits idempotent
    // without changing the approval lifecycle or adding a new status.
    if (!isCustomer && !existingApproval) {
      await tx.insert(onboardingApprovalsTable).values({
        customerId,
        accountType: String(effectiveAccountType),
        status: "pending",
        updatedAt: now,
      });
    }

    return {
      organization,
      responseStatus: organization?.pendingRequest ? "company_pending" : effectiveStatus,
      oldKtpUrl: existingProfile?.ktpUrl ?? null,
      newKtpUrl: ktpUrl ? String(ktpUrl) : null,
      oldVendorLegalityUrl,
      newVendorLegalityUrl: vendor?.legalityDocUrl ?? null,
      customerEmail: customer.email,
    };
  });

  // Storage is outside the DB transaction. Delete old private objects only
  // after the DB commit, otherwise a failed onboarding could lose the old doc.
  if (transactionResult.oldKtpUrl && transactionResult.oldKtpUrl !== transactionResult.newKtpUrl) {
    deleteFromSupabase(transactionResult.oldKtpUrl).catch(() => {});
  }
  if (
    transactionResult.oldVendorLegalityUrl
    && transactionResult.oldVendorLegalityUrl !== transactionResult.newVendorLegalityUrl
  ) {
    deleteFromSupabase(transactionResult.oldVendorLegalityUrl).catch(() => {});
  }

  if (!isCustomer) {
    // Notify admin via WA + in-app — fire and forget, strictly after commit.
    void (async () => {
      try {
        const timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

        await NotificationService.saveAndBroadcast("admin_notification", {
          type:         "vendor_onboarding_new",
          orderNumber:  `ONBOARD-${customerId}`,
          customerName: fullName,
          companyName:  vendor?.companyName ?? null,
          orderId:      customerId,
          accountType: effectiveAccountType,
          email:        transactionResult.customerEmail ?? "-",
          phone: normalizedPhone,
          timestamp,
          message:      `Permohonan akun baru: ${fullName} (${effectiveAccountType}) — ${timestamp}`,
        });

        const adminWa = await getAdminWa();
        if (adminWa) {
          const tplBody = await getWaTemplateConfig("admin_group", "portal_onboarding_admin", [
            `🔔 *Permohonan Akun Baru*`,
            `👤 Nama   : {{customerName}}`,
            `📧 Email  : {{customerEmail}}`,
            `📱 HP     : {{phone}}`,
            `🏷️ Tipe   : {{accountType}}`,
            `🕐 Waktu  : {{timestamp}}`,
            ``,
            `Tinjau di panel admin portal.`,
          ]);
          const msg = renderTemplate(tplBody, {
            customerName: fullName,
            customerEmail: transactionResult.customerEmail ?? "-",
            phone,
            accountType: effectiveAccountType,
            timestamp,
          });
          await sendWhatsApp(adminWa, msg);
        }
      } catch (e) { console.error("[onboarding-notif]", e); }
    })();
  }

  return { ok: true, status: transactionResult.responseStatus, organization: transactionResult.organization };
}
