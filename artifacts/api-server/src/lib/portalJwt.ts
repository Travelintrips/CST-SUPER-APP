import { SignJWT, jwtVerify } from "jose";

// Lazy — only throws when the JWT is actually used, NOT at module load.
// Prevents API server crash-loop when PORTAL_JWT_SECRET is not set in dev.
function getSecret(): Uint8Array {
  // Production bundles historically provide SESSION_SECRET (the required
  // canonical signing secret) but may not contain a separate
  // PORTAL_JWT_SECRET. Keep the dedicated key preferred while allowing the
  // canonical secret to keep portal login functional across old bundles.
  const raw = process.env.PORTAL_JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!raw) {
    throw new Error(
      "Portal JWT secret not configured. Set PORTAL_JWT_SECRET or SESSION_SECRET environment variable."
    );
  }
  return new TextEncoder().encode(raw);
}

const ISSUER = "cst-portal";
const EXPIRY = "7d";

export interface PortalJwtPayload {
  sub: string;
  email: string;
  customerId: number;
  role: string;
}

export async function signPortalJwt(payload: PortalJwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifyPortalJwt(token: string): Promise<PortalJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER });
    if (
      typeof payload.email === "string" &&
      typeof payload.customerId === "number" &&
      typeof payload.role === "string"
    ) {
      return payload as unknown as PortalJwtPayload;
    }
    return null;
  } catch {
    return null;
  }
}
