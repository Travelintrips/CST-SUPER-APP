import {
  db,
  portalAuthIdentitiesTable,
  portalCustomersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AuthServiceError } from "./portalAuthService.js";

export type PortalIdentityProvider =
  | "email"
  | "password"
  | "google"
  | "whatsapp";

/**
 * Link a verified provider identity to exactly one canonical portal account.
 *
 * This is deliberately fail-closed:
 * - provider+subject already linked to another account => conflict
 * - account already has a different subject for the same provider => conflict
 * - no name/company/avatar based merging is ever attempted
 */
export async function linkPortalIdentity(
  customerId: number,
  provider: PortalIdentityProvider,
  subject: string,
): Promise<void> {
  const normalizedSubject = String(subject).trim();
  if (!normalizedSubject) {
    throw new AuthServiceError(400, "Identitas provider tidak valid.");
  }

  const [byProvider] = await db
    .select()
    .from(portalAuthIdentitiesTable)
    .where(and(
      eq(portalAuthIdentitiesTable.provider, provider),
      eq(portalAuthIdentitiesTable.subject, normalizedSubject),
    ))
    .limit(1);

  if (byProvider && byProvider.customerId !== customerId) {
    throw new AuthServiceError(409, "Identitas login sudah terhubung ke akun lain.");
  }

  const [byCustomer] = await db
    .select()
    .from(portalAuthIdentitiesTable)
    .where(and(
      eq(portalAuthIdentitiesTable.customerId, customerId),
      eq(portalAuthIdentitiesTable.provider, provider),
    ))
    .limit(1);

  if (byCustomer && byCustomer.subject !== normalizedSubject) {
    throw new AuthServiceError(409, "Akun sudah memiliki identitas login provider yang berbeda.");
  }

  if (byProvider || byCustomer) {
    await db
      .update(portalAuthIdentitiesTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(portalAuthIdentitiesTable.id, (byProvider ?? byCustomer)!.id));
    return;
  }

  try {
    await db.insert(portalAuthIdentitiesTable).values({
      customerId,
      provider,
      subject: normalizedSubject,
      verifiedAt: new Date(),
      lastUsedAt: new Date(),
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthServiceError(409, "Identitas login sedang terhubung ke akun lain. Coba login lagi.");
    }
    throw error;
  }
}

export async function linkPortalEmailIdentity(customerId: number, email: string): Promise<void> {
  await linkPortalIdentity(customerId, "email", String(email).trim().toLowerCase());
}

export async function linkPortalPasswordIdentity(customerId: number, email: string): Promise<void> {
  await linkPortalIdentity(customerId, "password", String(email).trim().toLowerCase());
}

export async function linkPortalGoogleIdentity(customerId: number, googleSubject: string): Promise<void> {
  await linkPortalIdentity(customerId, "google", googleSubject);
}

export async function linkPortalWhatsAppIdentity(customerId: number, normalizedPhone: string): Promise<void> {
  await linkPortalIdentity(customerId, "whatsapp", normalizedPhone);
}

export async function assertPortalCustomerExists(customerId: number): Promise<void> {
  const [customer] = await db
    .select({ id: portalCustomersTable.id })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);
  if (!customer) throw new AuthServiceError(404, "Akun portal tidak ditemukan.");
}