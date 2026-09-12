import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Passwordless email OTP challenges are separate from password-reset state.
 * A challenge is consumed exactly once and never stores the OTP in plaintext.
 */
export const portalEmailOtpCodesTable = pgTable("portal_email_otp_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  verified: boolean("verified").notNull().default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("portal_email_otp_email_idx").on(t.email),
  index("portal_email_otp_created_idx").on(t.createdAt),
]);

export type PortalEmailOtpCode = typeof portalEmailOtpCodesTable.$inferSelect;