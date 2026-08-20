/**
 * portalAuthService.ts
 * Business logic for all /auth/* portal routes.
 * Controllers in portal.ts are thin wrappers that read req/res and call these functions.
 */

import {
  db,
  portalCustomersTable,
  portalCustomerServicesTable,
  waOtpCodesTable,
  trustedDevicesTable,
  userProfilesTable,
  portalCustomerProfilesTable,
} from "@workspace/db";
import { eq, and, desc, gte, or, isNull, inArray, sql } from "drizzle-orm";
import { randomUUID, randomInt, randomBytes } from "crypto";
import { hashToken } from "../tokenUtils.js";
import bcrypt from "bcryptjs";
import { signPortalJwt } from "../portalJwt.js";
import { sendViaService as sendWhatsApp } from "../waTransport.js";
import { sendMail, isSmtpConfigured } from "../mailer.js";
import { normalizePhone } from "../phoneUtils.js";
import { captureSafeDevResetArtifact } from "../safeDevResetCapture.js";

function assertAccountUsable(customer: {
  accountStatus?: string | null;
  sanctionUntil?: Date | string | null;
}): void {
  const status = customer.accountStatus ?? "active";
  if (status === "active") return;
  throw new AuthServiceError(
    403,
    status === "sanctioned"
      ? "Akun terkena sanksi dan tidak dapat digunakan."
      : "Akun tidak aktif dan tidak dapat digunakan.",
    { payload: { accountStatus: status, sanctionUntil: customer.sanctionUntil ?? null } },
  );
}

const CUSTOMER_PORTAL_PRODUCTION_HOSTS = new Set([
  "cstlogistic.co.id",
  "www.cstlogistic.co.id",
]);

/**
 * Reset links must never use an arbitrary origin supplied by the browser.
 * Apart from being a phishing/open-redirect risk, a stale preview origin
 * makes production reset emails unusable. Keep development flexible, but
 * always use the canonical public portal in production.
 */
function resolvePortalWebOrigin(requestedOrigin: string): string {
  const isDevelopment = process.env.APP_ENV === "development" && !process.env.REPLIT_DEPLOYMENT;
  const fallback = isDevelopment
    ? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:3000")
    : "https://cstlogistic.co.id";

  try {
    const parsed = new URL(String(requestedOrigin || fallback));
    const host = parsed.hostname.toLowerCase();
    if (isDevelopment && (host === "localhost" || host === "127.0.0.1" || host.endsWith(".replit.dev"))) {
      return parsed.origin;
    }
    if (CUSTOMER_PORTAL_PRODUCTION_HOSTS.has(host) && parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    // Fall through to the safe canonical origin.
  }
  return fallback;
}

// ─── Typed Error ───────────────────────────────────────────────────────────────

export class AuthServiceError extends Error {
  cause?: unknown;
  /** Extra fields merged into the JSON response body alongside `message`. */
  payload?: Record<string, unknown>;
  constructor(
    public statusCode: number,
    message: string,
    options?: { cause?: unknown; payload?: Record<string, unknown> }
  ) {
    super(message);
    this.name = "AuthServiceError";
    this.cause = options?.cause;
    this.payload = options?.payload;
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * A portal account created by onboarding may temporarily contain an empty
 * password hash while the existing reset/setup flow is being completed.
 * Never let an empty or whitespace-only value pass the email/password login
 * gate.
 */
export function hasUsablePortalPassword(passwordHash: string | null | undefined): boolean {
  return typeof passwordHash === "string" && passwordHash.trim().length > 0;
}

// Canonical phone normalizer — single source of truth for all OTP / login flows.
// Delegates to lib/phoneUtils.normalizePhone which handles: 0XXXXXXX, 62XXXXXXX,
// +62XXXXXXX, and the malformed 620XXXXXXX (extra leading-0 after country code).
export function normalizePhoneID(raw: string): string {
  return normalizePhone(String(raw));
}

function phoneMatchCandidates(normalizedPhone: string): string[] {
  const candidates = new Set([
    normalizedPhone,
    `0${normalizedPhone.slice(2)}`,
    `+${normalizedPhone}`,
    `620${normalizedPhone.slice(2)}`,
  ]);
  return [...candidates];
}

async function findPortalCustomersByPhone(normalizedPhone: string) {
  const candidates = phoneMatchCandidates(normalizedPhone);
  const digitsOnlyPhone = sql`regexp_replace(coalesce(${portalCustomersTable.phone}, ''), '[^0-9]', '', 'g')`;

  return db
    .select()
    .from(portalCustomersTable)
    .where(or(
      inArray(portalCustomersTable.phone, candidates),
      eq(digitsOnlyPhone, normalizedPhone),
    ))
    .limit(2);
}

function genOtp(): string {
  return String(randomInt(100000, 1000000));
}

async function getServiceIds(customerId: number): Promise<number[]> {
  const rows = await db
    .select()
    .from(portalCustomerServicesTable)
    .where(eq(portalCustomerServicesTable.customerId, customerId));
  return rows.map((r) => r.serviceId);
}

// ─── Services ─────────────────────────────────────────────────────────────────

/**
 * POST /auth/login — email/password login (non-Supabase)
 */
export async function emailPasswordLogin(email: string, password: string) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, String(email).toLowerCase().trim()));

  if (!customer || !hasUsablePortalPassword(customer.passwordHash)) {
    throw new AuthServiceError(401, "Email atau password salah.");
  }
  assertAccountUsable(customer);
  const valid = await bcrypt.compare(String(password), customer.passwordHash as string);
  if (!valid) {
    throw new AuthServiceError(401, "Email atau password salah.");
  }

  const token = await signPortalJwt({
    sub: String(customer.id),
    email: customer.email,
    customerId: customer.id,
    role: customer.role,
  });

  return {
    token,
    user: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      role: customer.role,
    },
  };
}

/**
 * POST /auth/wa-otp/send — kirim OTP via WhatsApp
 * Throws AuthServiceError on rate-limit / config error / WA send failure.
 * Returns plain object on success (or dev-mode shortcut).
 */
export async function sendWaOtp(rawPhone: string) {
  // BLK-02 fix: use REPLIT_DEPLOYMENT as the canonical production signal (per ADR-0001 / envGuard)
  const isDev = !process.env.REPLIT_DEPLOYMENT;
  const hasFonnte = !!process.env.FONNTE_TOKEN;

  const normalized = normalizePhoneID(rawPhone);
  if (normalized.length < 10) {
    throw new AuthServiceError(400, "Nomor HP tidak valid.");
  }

  // Rate limit: max 3 OTP per phone in last 10 minutes
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recent = await db
    .select({ id: waOtpCodesTable.id })
    .from(waOtpCodesTable)
    .where(and(eq(waOtpCodesTable.phone, normalized), gte(waOtpCodesTable.createdAt, tenMinAgo)));
  if (recent.length >= 3) {
    throw new AuthServiceError(429, "Terlalu banyak permintaan OTP. Coba lagi nanti.");
  }

  const code = genOtp();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

  await db.insert(waOtpCodesTable).values({
    phone: normalized,
    codeHash,
    purpose: "login",
    expiresAt,
  });

  if (hasFonnte) {
    try {
      await sendWhatsApp(
        normalized,
        `🔐 Verifikasi Login\n\nKode OTP Anda\n\n*${code}*\n\nKode berlaku selama 5 menit.\n\nUntuk menjaga keamanan akun Anda, jangan pernah membagikan kode ini kepada siapa pun.\n\nApabila Anda tidak melakukan permintaan login, abaikan pesan ini.\n\n—\nPT Cahaya Sejati Teknologi`,
        {},
      );
    } catch (err) {
      throw new AuthServiceError(500, err instanceof Error ? err.message : "Gagal mengirim OTP via WhatsApp.", { cause: err });
    }
    return { message: "OTP dikirim ke WhatsApp.", phone: normalized, _dev_code: undefined as string | undefined };
  }

  // Dev mode: FONNTE_TOKEN tidak dikonfigurasi — kembalikan kode langsung (jangan di production)
  if (isDev) {
    return {
      message: "Dev mode: OTP tidak dikirim via WA (FONNTE_TOKEN belum diset).",
      phone: normalized,
      _dev_code: code,
    };
  }

  throw new AuthServiceError(503, "Layanan OTP WhatsApp belum dikonfigurasi. Hubungi admin.");
}

/**
 * POST /auth/wa-otp/verify — verifikasi OTP, return verifyToken
 */
export async function verifyWaOtp(rawPhone: string, code: string) {
  const normalized = normalizePhoneID(rawPhone);

  const [otp] = await db
    .select()
    .from(waOtpCodesTable)
    .where(and(eq(waOtpCodesTable.phone, normalized), eq(waOtpCodesTable.verified, false)))
    .orderBy(desc(waOtpCodesTable.createdAt))
    .limit(1);

  if (!otp) throw new AuthServiceError(400, "OTP tidak ditemukan. Minta OTP baru.");
  if (otp.expiresAt < new Date()) throw new AuthServiceError(400, "OTP kadaluarsa. Minta OTP baru.");
  if (otp.attempts >= 5) throw new AuthServiceError(429, "Terlalu banyak percobaan. Minta OTP baru.");

  const valid = await bcrypt.compare(String(code), otp.codeHash);
  if (!valid) {
    await db
      .update(waOtpCodesTable)
      .set({ attempts: otp.attempts + 1 })
      .where(eq(waOtpCodesTable.id, otp.id));
    throw new AuthServiceError(400, "Kode OTP salah.");
  }

  const verifyToken = randomUUID();
  // Phase 1B: store HMAC-SHA256 hash; raw verifyToken only returned to client
  const verifyTokenHash = hashToken(verifyToken);
  await db
    .update(waOtpCodesTable)
    .set({ verified: true, verifyToken, verifyTokenHash, expiresAt: new Date(Date.now() + 15 * 60 * 1000) })
    .where(eq(waOtpCodesTable.id, otp.id));

  return { verifyToken, phone: normalized };
}

/**
 * POST /auth/wa-register — lengkapi profil & buat akun baru via WA OTP
 */
export async function waRegister(params: {
  verifyToken: string;
  name: string;
  role?: string;
  company?: string;
  serviceIds?: number[];
  email?: string;
  rememberDays?: number;
}) {
  const { verifyToken, name, role: requestedRole, company, serviceIds, email, rememberDays } = params;

  const [otp] = await db
    .select()
    .from(waOtpCodesTable)
    .where(and(
      // Phase 1B hash-first: try hash, fall back to plaintext for legacy rows
      or(
        eq(waOtpCodesTable.verifyTokenHash, hashToken(String(verifyToken))),
        and(isNull(waOtpCodesTable.verifyTokenHash), eq(waOtpCodesTable.verifyToken, String(verifyToken)))
      ),
      eq(waOtpCodesTable.verified, true)
    ))
    .limit(1);

  if (!otp) throw new AuthServiceError(400, "Token verifikasi tidak valid.");
  if (otp.expiresAt < new Date()) throw new AuthServiceError(400, "Token kadaluarsa. Verifikasi ulang OTP.");

  const phone = otp.phone;
  const ALLOWED_ROLES = ["customer", "vendor"];
  const role = ALLOWED_ROLES.includes(String(requestedRole)) ? String(requestedRole) : "customer";

  // Cek apakah phone sudah terdaftar
  const [existingByPhone] = await findPortalCustomersByPhone(phone);
  if (existingByPhone) {
    throw new AuthServiceError(409, "Nomor HP sudah terdaftar. Silakan login.");
  }

  const finalEmail = email ? String(email).toLowerCase().trim() : `${phone}@wa.local`;

  // Cek email duplicate jika user provide
  if (email) {
    const [existingEmail] = await db
      .select({ id: portalCustomersTable.id })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.email, finalEmail))
      .limit(1);
    if (existingEmail) throw new AuthServiceError(409, "Email sudah terdaftar.");
  }

  const [created] = await db
    .insert(portalCustomersTable)
    .values({
      name: String(name),
      email: finalEmail,
      passwordHash: "",
      phone,
      company: company ? String(company) : null,
      role,
    })
    .returning();

  if (Array.isArray(serviceIds) && serviceIds.length > 0) {
    await db
      .insert(portalCustomerServicesTable)
      .values((serviceIds as number[]).map((sid) => ({ customerId: created.id, serviceId: Number(sid) })))
      .onConflictDoNothing();
  }

  // Invalidate verifyToken — clear both plaintext AND hash, force expiry for true single-use semantics
  await db.update(waOtpCodesTable)
    .set({ verifyToken: null, verifyTokenHash: null, expiresAt: new Date(0) })
    .where(eq(waOtpCodesTable.id, otp.id));

  const token = await signPortalJwt({
    sub: String(created.id),
    email: created.email,
    customerId: created.id,
    role: created.role,
  });

  let deviceToken: string | undefined;
  const days =
    typeof rememberDays === "number" && rememberDays > 0 && rememberDays <= 90 ? rememberDays : null;
  if (days && created.phone) {
    deviceToken = randomUUID();
    const expiresAt = new Date(Date.now() + days * 86400_000);
    // Phase 1B: store HMAC-SHA256 hash; raw token returned to client only
    await db.insert(trustedDevicesTable).values({ phone: created.phone, deviceToken, deviceTokenHash: hashToken(deviceToken), expiresAt });
  }

  return {
    token,
    deviceToken,
    user: {
      id: created.id,
      name: created.name,
      email: created.email,
      phone: created.phone,
      company: created.company,
      role: created.role,
    },
  };
}

/**
 * POST /auth/wa-login — login pakai phone + OTP (setelah wa-otp/verify)
 */
export async function waLogin(
  verifyToken: string,
  rememberDays?: number,
  logError?: (phone: string) => void
) {
  const [otp] = await db
    .select()
    .from(waOtpCodesTable)
    .where(and(
      // Phase 1B hash-first: try hash, fall back to plaintext for legacy rows
      or(
        eq(waOtpCodesTable.verifyTokenHash, hashToken(String(verifyToken))),
        and(isNull(waOtpCodesTable.verifyTokenHash), eq(waOtpCodesTable.verifyToken, String(verifyToken)))
      ),
      eq(waOtpCodesTable.verified, true)
    ))
    .limit(1);

  if (!otp) throw new AuthServiceError(400, "Token verifikasi tidak valid.");
  if (otp.expiresAt < new Date()) throw new AuthServiceError(400, "Token kadaluarsa.");

  const matches = await findPortalCustomersByPhone(otp.phone);

  if (matches.length === 0) {
    throw new AuthServiceError(404, "Nomor HP belum terdaftar.", {
      payload: { notRegistered: true, phone: otp.phone },
    });
  }
  if (matches.length > 1) {
    logError?.(otp.phone);
    throw new AuthServiceError(409, "Akun ambigu untuk nomor ini. Hubungi admin.");
  }
  const user = matches[0];
  assertAccountUsable(user);

  // Invalidate verifyToken — clear both plaintext AND hash, force expiry for true single-use semantics
  await db.update(waOtpCodesTable)
    .set({ verifyToken: null, verifyTokenHash: null, expiresAt: new Date(0) })
    .where(eq(waOtpCodesTable.id, otp.id));

  const token = await signPortalJwt({
    sub: String(user.id),
    email: user.email,
    customerId: user.id,
    role: user.role,
  });

  let deviceToken: string | undefined;
  const days =
    typeof rememberDays === "number" && rememberDays > 0 && rememberDays <= 90 ? rememberDays : null;
  if (days) {
    deviceToken = randomUUID();
    const expiresAt = new Date(Date.now() + days * 86400_000);
    // Phase 1B: store HMAC-SHA256 hash; raw token returned to client only
    await db.insert(trustedDevicesTable).values({ phone: otp.phone, deviceToken, deviceTokenHash: hashToken(deviceToken), expiresAt });
  }

  return {
    token,
    deviceToken,
    notRegistered: false as const,
    phone: otp.phone,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      company: user.company,
      role: user.role,
    },
  };
}

/**
 * POST /auth/wa-trusted-login — login tanpa OTP pakai device token tersimpan
 */
export async function waTrustedLogin(rawPhone: string, deviceToken: string) {
  const [device] = await db
    .select()
    .from(trustedDevicesTable)
    .where(
      and(
        // Phase 1B hash-first: try hash, fall back to plaintext for legacy rows
        or(
          eq(trustedDevicesTable.deviceTokenHash, hashToken(String(deviceToken))),
          and(isNull(trustedDevicesTable.deviceTokenHash), eq(trustedDevicesTable.deviceToken, String(deviceToken)))
        ),
        eq(trustedDevicesTable.phone, String(rawPhone))
      )
    )
    .limit(1);

  if (!device) throw new AuthServiceError(401, "Perangkat tidak dikenali.");
  if (device.expiresAt < new Date()) {
    await db.delete(trustedDevicesTable).where(eq(trustedDevicesTable.id, device.id));
    throw new AuthServiceError(401, "Sesi perangkat kadaluarsa.", { payload: { expired: true } });
  }

  const matches = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.phone, device.phone))
    .limit(2);

  if (matches.length !== 1) throw new AuthServiceError(401, "Akun tidak ditemukan.");
  const user = matches[0];
  assertAccountUsable(user);

  // Sliding expiry: perpanjang masa berlaku 30 hari dari sekarang
  const newExpiresAt = new Date(Date.now() + 30 * 86400_000);
  await db
    .update(trustedDevicesTable)
    .set({ expiresAt: newExpiresAt })
    .where(eq(trustedDevicesTable.id, device.id));

  const token = await signPortalJwt({
    sub: String(user.id),
    email: user.email,
    customerId: user.id,
    role: user.role,
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      company: user.company,
      role: user.role,
    },
  };
}

/**
 * GET /auth/trusted-devices — daftar perangkat terpercaya milik user
 */
export async function getTrustedDevices(customerId: number) {
  const [customer] = await db
    .select({ phone: portalCustomersTable.phone })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  if (!customer?.phone) return [];

  return db
    .select({
      id: trustedDevicesTable.id,
      createdAt: trustedDevicesTable.createdAt,
      expiresAt: trustedDevicesTable.expiresAt,
    })
    .from(trustedDevicesTable)
    .where(eq(trustedDevicesTable.phone, customer.phone))
    .orderBy(trustedDevicesTable.createdAt);
}

/**
 * DELETE /auth/trusted-devices/:id — cabut satu perangkat terpercaya
 */
export async function revokeTrustedDevice(customerId: number, deviceId: number) {
  const [customer] = await db
    .select({ phone: portalCustomersTable.phone })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  if (!customer?.phone) throw new AuthServiceError(404, "User tidak ditemukan.");

  const [device] = await db
    .select({ id: trustedDevicesTable.id })
    .from(trustedDevicesTable)
    .where(and(eq(trustedDevicesTable.id, deviceId), eq(trustedDevicesTable.phone, customer.phone)))
    .limit(1);
  if (!device) throw new AuthServiceError(404, "Perangkat tidak ditemukan.");

  await db.delete(trustedDevicesTable).where(eq(trustedDevicesTable.id, deviceId));
}

/**
 * DELETE /auth/trusted-devices — cabut semua perangkat terpercaya
 */
export async function revokeAllTrustedDevices(customerId: number) {
  const [customer] = await db
    .select({ phone: portalCustomersTable.phone })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  if (!customer?.phone) throw new AuthServiceError(404, "User tidak ditemukan.");

  await db.delete(trustedDevicesTable).where(eq(trustedDevicesTable.phone, customer.phone));
}

/**
 * POST /auth/signup — standalone register (non-Supabase)
 */
export async function signup(params: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  company?: string;
  role?: string;
  serviceIds?: number[];
}) {
  const { name, email, password, phone, company, role: requestedRole, serviceIds } = params;

  const emailLower = String(email).toLowerCase().trim();
  const [existing] = await db
    .select({ id: portalCustomersTable.id })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, emailLower));
  if (existing) throw new AuthServiceError(409, "Email sudah terdaftar.");

  const normalizedPhone = phone ? normalizePhoneID(String(phone)) : null;
  if (normalizedPhone) {
    const [phoneExisting] = await db
      .select({ id: portalCustomersTable.id })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.phone, normalizedPhone));
    if (phoneExisting) throw new AuthServiceError(409, "Nomor HP sudah terdaftar.");
  }

  const ALLOWED_ROLES = ["customer", "vendor"];
  const role = ALLOWED_ROLES.includes(String(requestedRole)) ? String(requestedRole) : "customer";
  const passwordHash = await bcrypt.hash(String(password), 12);

  const [created] = await db
    .insert(portalCustomersTable)
    .values({
      name: String(name),
      email: emailLower,
      passwordHash,
      phone: normalizedPhone,
      company: company ? String(company) : null,
      role,
    })
    .returning();

  if (Array.isArray(serviceIds) && serviceIds.length > 0) {
    await db
      .insert(portalCustomerServicesTable)
      .values((serviceIds as number[]).map((sid) => ({ customerId: created.id, serviceId: Number(sid) })))
      .onConflictDoNothing();
  }

  const token = await signPortalJwt({
    sub: String(created.id),
    email: created.email,
    customerId: created.id,
    role: created.role,
  });

  return {
    token,
    user: {
      id: created.id,
      name: created.name,
      email: created.email,
      phone: created.phone,
      company: created.company,
      role: created.role,
    },
  };
}

/**
 * POST /auth/dev-login — hanya tersedia di non-production (dev & staging)
 * Membuat/menemukan dev user dan mengembalikan signed dev token untuk testing tanpa Supabase.
 */
export async function devLogin(role: string) {
  const { signDevToken } = await import("../supabaseAuth.js");

  const allowedRoles = ["customer", "admin", "vendor"] as const;
  type DevRole = (typeof allowedRoles)[number];
  const safeRole: DevRole = allowedRoles.includes(role as DevRole) ? (role as DevRole) : "customer";

  const devEmail = `dev-${safeRole}@dev.local`;
  const devName = `Dev ${safeRole.charAt(0).toUpperCase() + safeRole.slice(1)}`;

  const synthCustomer = {
    id: -1,
    name: devName,
    email: devEmail,
    role: safeRole,
  };

  let customer = synthCustomer;

  try {
    let [dbCustomer] = await db
      .select()
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.email, devEmail));

    if (!dbCustomer) {
      [dbCustomer] = await db
        .insert(portalCustomersTable)
        .values({ name: devName, email: devEmail, passwordHash: "", role: safeRole })
        .returning();
    } else if (dbCustomer.role !== safeRole) {
      [dbCustomer] = await db
        .update(portalCustomersTable)
        .set({ role: safeRole })
        .where(eq(portalCustomersTable.id, dbCustomer.id))
        .returning();
    }

    customer = { id: dbCustomer.id, name: dbCustomer.name, email: dbCustomer.email, role: dbCustomer.role as DevRole };

    // Pastikan profil onboarding berstatus "active" (nilai yang SAMA dipakai oleh flow
    // approval asli — lihat portalApprovalService.processApproval) agar dev user tidak
    // redirect ke /onboarding DAN lolos requireActiveVendor untuk role vendor. Sebelumnya
    // ini di-set ke "approved", nilai yang tidak pernah dicek oleh middleware manapun,
    // sehingga dev-login vendor selalu 403 di route requireActiveVendor.
    await db
      .insert(userProfilesTable)
      .values({
        customerId: dbCustomer.id,
        fullName: dbCustomer.name,
        accountType: safeRole === "vendor" ? "vendor" : "customer",
        status: "active",
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfilesTable.customerId,
        set: { status: "active", fullName: dbCustomer.name, updatedAt: new Date() },
      });
  } catch {
    // DB tidak tersedia — gunakan synthetic customer, session hanya di token
  }

  const token = signDevToken({
    id: customer.id,
    email: customer.email,
    role: customer.role,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });

  return {
    token,
    profile: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      role: customer.role,
    },
  };
}

/**
 * POST /auth/register — sync profil ke DB setelah supabase.auth.signUp
 */
export async function syncProfile(
  customerId: number,
  params: {
    name?: string;
    phone?: unknown;
    company?: unknown;
    role?: string;
    serviceIds?: unknown;
  }
) {
  const { name, phone, company, role: requestedRole, serviceIds } = params;

  const patch: Record<string, unknown> = {};
  if (name) patch.name = String(name);
  if (phone !== undefined) patch.phone = phone ? String(phone) : null;
  if (company !== undefined) patch.company = company ? String(company) : null;
  const ALLOWED_ROLES = ["customer", "vendor"];
  if (requestedRole && ALLOWED_ROLES.includes(String(requestedRole))) patch.role = String(requestedRole);

  if (Object.keys(patch).length > 0) {
    await db.update(portalCustomersTable).set(patch).where(eq(portalCustomersTable.id, customerId));
  }

  if (Array.isArray(serviceIds)) {
    await db.delete(portalCustomerServicesTable).where(eq(portalCustomerServicesTable.customerId, customerId));
    if ((serviceIds as number[]).length > 0) {
      await db
        .insert(portalCustomerServicesTable)
        .values((serviceIds as number[]).map((sid) => ({ customerId, serviceId: Number(sid) })))
        .onConflictDoNothing();
    }
  }

  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId));
  const finalServiceIds = await getServiceIds(customerId);

  return {
    id: customer!.id,
    name: customer!.name,
    email: customer!.email,
    phone: customer!.phone,
    company: customer!.company,
    role: customer!.role,
    serviceIds: finalServiceIds,
  };
}

/**
 * POST /auth/otp/request — kirim kode OTP ke email (passwordless login)
 * Security: rate-limited per IP; uses CSPRNG; stores bcrypt hash (not plaintext)
 */
export async function requestEmailOtp(email: string) {
  const isDev = process.env.APP_ENV === "development" && !process.env.REPLIT_DEPLOYMENT;
  const emailLower = String(email).toLowerCase().trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    throw new AuthServiceError(400, "Format email tidak valid.");
  }

  let [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, emailLower));
  if (!customer) {
    const [created] = await db
      .insert(portalCustomersTable)
      .values({
        name: emailLower.split("@")[0],
        email: emailLower,
        passwordHash: "",
        role: "customer",
      })
      .returning();
    customer = created;
  }

  // Use CSPRNG (crypto.randomInt) — consistent with WA OTP path
  const code = randomInt(100000, 1000000).toString();
  // Store as "otp2:0:HASH" — "otp2" prefix, attempt counter (0), bcrypt hash
  const codeHash = await bcrypt.hash(code, 10);
  const expiry = new Date(Date.now() + 10 * 60 * 1000);
  await db
    .update(portalCustomersTable)
    .set({ resetPasswordToken: `otp2:0:${codeHash}`, resetPasswordExpiry: expiry })
    .where(eq(portalCustomersTable.id, customer.id));

  const smtpOk = isSmtpConfigured();

  // Production: SMTP wajib — langsung 503 agar user tahu email tidak terkirim
  if (!smtpOk && !isDev) {
    throw new AuthServiceError(503, "Layanan email belum dikonfigurasi. Hubungi admin.");
  }

  if (smtpOk) {
    try {
      await sendMail({
        to: emailLower,
        subject: "🔐 Verifikasi Login — CST Portal",
        html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;color:#1a1a1a"><p style="font-size:20px;font-weight:700;margin-bottom:4px">🔐 Verifikasi Login</p><p style="margin:16px 0 4px">Kode OTP Anda</p><p style="font-size:36px;font-weight:700;letter-spacing:8px;margin:8px 0">${code}</p><p style="margin:16px 0">Kode berlaku selama <strong>10 menit</strong>.</p><p style="margin:16px 0">Untuk menjaga keamanan akun Anda, jangan pernah membagikan kode ini kepada siapa pun.</p><p style="margin:16px 0">Apabila Anda tidak melakukan permintaan login, abaikan pesan ini.</p><hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0"/><p style="color:#888;font-size:12px;margin:0">PT Cahaya Sejati Teknologi</p></div>`,
        text: `🔐 Verifikasi Login\n\nKode OTP Anda\n\n${code}\n\nKode berlaku selama 10 menit.\n\nUntuk menjaga keamanan akun Anda, jangan pernah membagikan kode ini kepada siapa pun.\n\nApabila Anda tidak melakukan permintaan login, abaikan pesan ini.\n\n—\nPT Cahaya Sejati Teknologi`,
      });
    } catch (smtpErr) {
      // Production: SMTP failure = hard error agar user tahu email tidak terkirim
      // Dev: non-fatal; _dev_code dikembalikan di bawah
      if (!isDev) {
        await db
          .update(portalCustomersTable)
          .set({ resetPasswordToken: null, resetPasswordExpiry: null })
          .where(eq(portalCustomersTable.id, customer.id));
        throw new AuthServiceError(500, "Gagal mengirim email OTP. Coba lagi atau hubungi admin.", { cause: smtpErr });
      }
    }
  }

  return {
    sent: smtpOk,
    // Dev mode: kembalikan kode langsung untuk testing
    ...(isDev ? { _dev_code: code } : {}),
    message: smtpOk
      ? isDev
        ? `Kode OTP dikirim ke email (dev: ${code})`
        : "Kode OTP telah dikirim ke email Anda."
      : `Dev mode: Kode OTP: ${code}`,
  };
}

/**
 * POST /auth/otp/verify — verifikasi kode OTP dan login
 * Security: rate-limited per IP; attempt counter prevents brute force; bcrypt compare (v2 format)
 */
export async function verifyEmailOtp(email: string, code: string) {
  const emailLower = String(email).toLowerCase().trim();

  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, emailLower));
  if (!customer) throw new AuthServiceError(401, "Email tidak terdaftar.");

  const stored = customer.resetPasswordToken;
  const expiry = customer.resetPasswordExpiry;

  if (!stored || (!stored.startsWith("otp:") && !stored.startsWith("otp2:"))) {
    throw new AuthServiceError(401, "Tidak ada OTP aktif. Minta kode baru.");
  }
  if (!expiry || expiry < new Date()) {
    throw new AuthServiceError(401, "Kode OTP sudah kadaluarsa.");
  }

  let valid = false;

  if (stored.startsWith("otp2:")) {
    // New format: "otp2:ATTEMPTS:HASH"
    const parts = stored.split(":");
    if (parts.length < 3) throw new AuthServiceError(401, "Format OTP tidak valid.");
    const attempts = parseInt(parts[1], 10) || 0;
    if (attempts >= 5) {
      throw new AuthServiceError(429, "Terlalu banyak percobaan. Minta OTP baru.");
    }
    const hash = parts.slice(2).join(":"); // bcrypt hash may contain colons
    valid = await bcrypt.compare(String(code).trim(), hash);
    if (!valid) {
      await db
        .update(portalCustomersTable)
        .set({ resetPasswordToken: `otp2:${attempts + 1}:${hash}` })
        .where(eq(portalCustomersTable.id, customer.id));
      throw new AuthServiceError(401, "Kode OTP salah.");
    }
  } else {
    // Legacy format: "otp:CODE" (plaintext, for OTPs generated before this fix)
    if (stored.slice(4) !== String(code).trim()) {
      throw new AuthServiceError(401, "Kode OTP salah.");
    }
    valid = true;
  }

  void valid; // consumed above

  await db
    .update(portalCustomersTable)
    .set({ resetPasswordToken: null, resetPasswordExpiry: null })
    .where(eq(portalCustomersTable.id, customer.id));

  const token = await signPortalJwt({
    sub: String(customer.id),
    email: customer.email,
    customerId: customer.id,
    role: customer.role,
  });

  return {
    token,
    user: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      role: customer.role,
    },
  };
}

/**
 * POST /auth/forgot-password — custom flow for portal_customers (not Supabase Auth)
 * Generates a secure reset token, stores bcrypt hash, sends email with link.
 */
export async function forgotPasswordCustom(email: string, origin: string) {
  const emailLower = String(email).toLowerCase().trim();
  const isDev = process.env.APP_ENV === "development" && !process.env.REPLIT_DEPLOYMENT;

  // Always respond with same message to prevent email enumeration
  const genericOk = { sent: true, message: "Jika email terdaftar, link reset password telah dikirim ke email Anda." };

  const [customer] = await db
    .select({ id: portalCustomersTable.id, email: portalCustomersTable.email, name: portalCustomersTable.name })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, emailLower))
    .limit(1);

  if (!customer) return genericOk; // don't reveal non-existence

  // Generate a 32-byte cryptographically secure random token
  const rawToken = randomBytes(32).toString("hex"); // 64 hex chars
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db
    .update(portalCustomersTable)
    .set({ resetPasswordToken: `pwreset:${tokenHash}`, resetPasswordExpiry: expiry })
    .where(eq(portalCustomersTable.id, customer.id));

  const resetOrigin = resolvePortalWebOrigin(origin);
  const resetUrl = `${resetOrigin}/reset-password?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(emailLower)}`;
  captureSafeDevResetArtifact(emailLower, rawToken);

  const smtpOk = isSmtpConfigured();
  // Production must never report success when the reset email cannot be
  // delivered. Development keeps the existing safe/test-mode behavior.
  if (!smtpOk && !isDev) {
    await db
      .update(portalCustomersTable)
      .set({ resetPasswordToken: null, resetPasswordExpiry: null })
      .where(eq(portalCustomersTable.id, customer.id));
    throw new AuthServiceError(503, "Layanan email belum dikonfigurasi. Hubungi admin.");
  }

  if (smtpOk) {
    try {
      await sendMail({
        to: emailLower,
        subject: "🔑 Reset Password — CST Portal",
        html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;color:#1a1a1a">
<p style="font-size:20px;font-weight:700;margin-bottom:4px">🔑 Reset Password</p>
<p style="margin:16px 0">Kami menerima permintaan reset password untuk akun Anda (<strong>${emailLower}</strong>).</p>
<p style="margin:16px 0">Klik tombol di bawah untuk membuat password baru. Link ini berlaku selama <strong>1 jam</strong>.</p>
<div style="text-align:center;margin:28px 0">
  <a href="${resetUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
    Buat Password Baru
  </a>
</div>
<p style="margin:16px 0;font-size:13px;color:#666">Atau salin link berikut ke browser:<br/><a href="${resetUrl}" style="color:#3b82f6;word-break:break-all">${resetUrl}</a></p>
<p style="margin:16px 0;font-size:13px;color:#888">Apabila Anda tidak meminta reset password, abaikan email ini. Password Anda tidak akan berubah.</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0"/>
<p style="color:#aaa;font-size:12px;margin:0">PT Cahaya Sejati Teknologi</p>
</div>`,
        text: `🔑 Reset Password\n\nKami menerima permintaan reset password untuk akun ${emailLower}.\n\nKlik link berikut untuk membuat password baru (berlaku 1 jam):\n\n${resetUrl}\n\nApabila Anda tidak meminta reset password, abaikan email ini.\n\n—\nPT Cahaya Sejati Teknologi`,
        context: "forgot-password",
      });
    } catch (smtpErr) {
      // Do not expose provider details, but do not claim the message was sent.
      // sendMail already records the provider error in notification_logs when
      // the SMTP transport reaches the provider.
      if (!isDev) {
        await db
          .update(portalCustomersTable)
          .set({ resetPasswordToken: null, resetPasswordExpiry: null })
          .where(eq(portalCustomersTable.id, customer.id));
        throw new AuthServiceError(
          502,
          "Gagal mengirim email reset password. Coba lagi atau hubungi admin.",
          { cause: smtpErr },
        );
      }
    }
  }

  return genericOk;
}

/**
 * POST /auth/reset-password-with-token — verify token and set new password
 */
export async function resetPasswordWithToken(email: string, token: string, newPassword: string) {
  const emailLower = String(email).toLowerCase().trim();

  if (!newPassword || newPassword.length < 8) {
    throw new AuthServiceError(400, "Password minimal 8 karakter.");
  }

  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.email, emailLower))
    .limit(1);

  if (!customer) throw new AuthServiceError(400, "Link reset tidak valid atau sudah kadaluarsa.");

  const stored = customer.resetPasswordToken;
  const expiry = customer.resetPasswordExpiry;

  if (!stored || !stored.startsWith("pwreset:")) {
    throw new AuthServiceError(400, "Link reset tidak valid. Silakan minta link baru.");
  }
  if (!expiry || expiry < new Date()) {
    throw new AuthServiceError(400, "Link reset sudah kadaluarsa. Silakan minta link baru.");
  }

  const storedHash = stored.slice("pwreset:".length);
  const valid = await bcrypt.compare(String(token).trim(), storedHash);
  if (!valid) {
    throw new AuthServiceError(400, "Link reset tidak valid atau sudah digunakan.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(portalCustomersTable)
    .set({ passwordHash, resetPasswordToken: null, resetPasswordExpiry: null })
    .where(eq(portalCustomersTable.id, customer.id));

  return { ok: true, message: "Password berhasil diubah. Silakan login." };
}

/**
 * GET /auth/me — return current authenticated user
 */
export async function getMe(customerId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId));
  if (!customer) throw new AuthServiceError(401, "Customer not found");

  const [profile] = await db
    .select({ companyAddress: portalCustomerProfilesTable.companyAddress })
    .from(portalCustomerProfilesTable)
    .where(eq(portalCustomerProfilesTable.customerId, customerId))
    .limit(1);

  const serviceIds = await getServiceIds(customer.id);
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    company: customer.company,
    role: customer.role,
    address: profile?.companyAddress ?? null,
    avatarUrl: (customer as Record<string, unknown>).avatarUrl as string ?? null,
    serviceIds,
    createdAt: customer.createdAt.toISOString(),
  };
}
