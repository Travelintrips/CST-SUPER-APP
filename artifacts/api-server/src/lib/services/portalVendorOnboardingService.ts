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
import { eq, and } from "drizzle-orm";
import { deleteFromSupabase } from "../supabaseStorage.js";
import { ObjectStorageService } from "../objectStorage.js";
import { sendViaService as sendWhatsApp } from "../waTransport.js";
import { getAdminWa } from "../adminWa.js";
import { getWaTemplateConfig, renderTemplate } from "../orderNotification.js";
import { NotificationService } from "./notificationService.js";
import OpenAI from "openai";

// ── OpenAI client ─────────────────────────────────────────────────────────────

function getOnboardingOpenAI(): OpenAI {
  const directKey = process.env.OPENAI_API_KEY;
  const intKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = directKey || intKey;
  if (!apiKey) throw new Error("OpenAI API key not configured.");
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

  if (!profile) {
    return { status: "incomplete", accountType: null, hasProfile: false };
  }

  const rejectionReason = profile.status === "rejected" ? profile.rejectionReason : undefined;
  return {
    hasProfile: true,
    status: profile.status,
    accountType: profile.accountType,
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

  const response = await openai.chat.completions.create({
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

  const raw = response.choices[0]?.message?.content ?? "{}";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let data: Record<string, string> = {};
  try { data = JSON.parse(cleaned); } catch { /* fallback empty */ }

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
}

export async function completeOnboarding(
  customerId: number,
  input: CompleteOnboardingInput,
): Promise<{ ok: boolean; status: string }> {
  const { fullName, phone, address, accountType, ktpUrl, ocrData, vendor, driver, employee } = input;

  const isCustomer = accountType === "customer";
  const status = isCustomer ? "active" : "pending";
  const now = new Date();

  // Fetch ktpUrl lama sebelum upsert (untuk cleanup storage jika berubah)
  const [existingProfile] = await db
    .select({ ktpUrl: userProfilesTable.ktpUrl })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.customerId, customerId));

  // Upsert user_profiles
  await db.insert(userProfilesTable).values({
    customerId,
    fullName: String(fullName),
    phone: String(phone),
    address: String(address),
    accountType: String(accountType),
    status,
    ktpUrl: ktpUrl ? String(ktpUrl) : null,
    completedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: userProfilesTable.customerId,
    set: {
      fullName: String(fullName),
      phone: String(phone),
      address: String(address),
      accountType: String(accountType),
      status,
      ktpUrl: ktpUrl ? String(ktpUrl) : null,
      completedAt: now,
      updatedAt: now,
    },
  });

  // Hapus file KTP lama dari storage jika diganti
  const newKtpUrl = ktpUrl ? String(ktpUrl) : null;
  if (existingProfile?.ktpUrl && existingProfile.ktpUrl !== newKtpUrl) {
    deleteFromSupabase(existingProfile.ktpUrl).catch(() => {});
  }

  // Update portal_customers role + phone
  try {
    await db.update(portalCustomersTable).set({
      name: String(fullName),
      phone: String(phone),
      role: accountType === "vendor"
        ? "vendor"
        : accountType === "driver"
          ? "driver"
          : accountType === "employee"
            ? "employee"
            : "customer",
    }).where(eq(portalCustomersTable.id, customerId));
  } catch (err: any) {
    if (err?.code === "23505" && err?.constraint?.includes("phone")) {
      throw new OnboardingServiceError(409, "Nomor telepon sudah digunakan oleh akun lain. Gunakan nomor yang berbeda.");
    }
    throw err;
  }

  // Update OCR result name if provided
  if (ocrData?.nik) {
    await db.update(ocrResultsTable)
      .set({ name: ocrData.name ?? null, nik: ocrData.nik ?? null })
      .where(eq(ocrResultsTable.customerId, customerId));
  }

  // Upsert vendor profile
  if (accountType === "vendor" && vendor) {
    const [existingVendorProfile] = await db
      .select({ legalityDocUrl: vendorProfilesTable.legalityDocUrl })
      .from(vendorProfilesTable)
      .where(eq(vendorProfilesTable.customerId, customerId));

    await db.insert(vendorProfilesTable).values({
      customerId,
      companyName: vendor.companyName ?? null,
      nib: vendor.nib ?? null,
      npwp: vendor.npwp ?? null,
      serviceType: vendor.serviceType ?? null,
      legalityDocUrl: vendor.legalityDocUrl ?? null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: vendorProfilesTable.customerId,
      set: {
        companyName: vendor.companyName ?? null,
        nib: vendor.nib ?? null,
        npwp: vendor.npwp ?? null,
        serviceType: vendor.serviceType ?? null,
        legalityDocUrl: vendor.legalityDocUrl ?? null,
        updatedAt: now,
      },
    });

    const newLegalityUrl = vendor.legalityDocUrl ?? null;
    if (existingVendorProfile?.legalityDocUrl && existingVendorProfile.legalityDocUrl !== newLegalityUrl) {
      deleteFromSupabase(existingVendorProfile.legalityDocUrl).catch(() => {});
    }
  }

  // Upsert driver profile
  if (accountType === "driver" && driver) {
    const [existingDriverProfile] = await db
      .select({ simUrl: driverProfilesTable.simUrl, stnkUrl: driverProfilesTable.stnkUrl })
      .from(driverProfilesTable)
      .where(eq(driverProfilesTable.customerId, customerId));

    await db.insert(driverProfilesTable).values({
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

  // Upsert employee profile
  if (accountType === "employee" && employee) {
    await db.insert(employeeProfilesTable).values({
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

  // Create approval request for non-customer accounts
  if (!isCustomer) {
    await db.insert(onboardingApprovalsTable).values({
      customerId,
      accountType: String(accountType),
      status: "pending",
      updatedAt: now,
    }).onConflictDoNothing();

    // Notify admin via WA + in-app — fire and forget
    void (async () => {
      try {
        const [customer] = await db
          .select()
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, customerId));

        const timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

        // In-app notification (admin_notifications + SSE broadcast)
        await NotificationService.saveAndBroadcast("admin_notification", {
          type:         "vendor_onboarding_new",
          orderNumber:  `ONBOARD-${customerId}`,
          customerName: fullName,
          companyName:  vendor?.companyName ?? null,
          orderId:      customerId,
          accountType,
          email:        customer?.email ?? "-",
          phone,
          timestamp,
          message:      `Permohonan akun baru: ${fullName} (${accountType}) — ${timestamp}`,
        });

        // WA notification
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
            customerEmail: customer?.email ?? "-",
            phone,
            accountType,
            timestamp,
          });
          await sendWhatsApp(adminWa, msg);
        }
      } catch (e) { console.error("[onboarding-notif]", e); }
    })();
  }

  return { ok: true, status };
}
