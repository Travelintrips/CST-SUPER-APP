import { isSmtpConfigured } from "./mailer.js";

export interface PortalAuthCapabilities {
  emailOtp: boolean;
  google: boolean;
  whatsapp: boolean;
  sms: boolean;
  wechat: boolean;
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
    // No SMS provider is installed/configured in this project.
    sms: false,
    // WeChat OAuth credentials/provider are not configured in this project.
    wechat: false,
    password: true,
  };
}