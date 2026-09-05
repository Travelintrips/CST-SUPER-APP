import { isSmtpConfigured } from "./mailer.js";

export interface PortalAuthCapabilities {
  emailOtp: boolean;
  google: boolean;
  whatsapp: boolean;
  password: boolean;
}

/**
 * Public-safe capability flags. Never return credentials or provider secrets.
 * In development, OTP channels may use the existing safe _dev_code path.
 */
export function getPortalAuthCapabilities(): PortalAuthCapabilities {
  const isDevelopment = process.env.APP_ENV === "development" && !process.env.REPLIT_DEPLOYMENT;
  return {
    emailOtp: isDevelopment || isSmtpConfigured(),
    google: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
    whatsapp: isDevelopment || Boolean(process.env.FONNTE_TOKEN?.trim()),
    password: true,
  };
}