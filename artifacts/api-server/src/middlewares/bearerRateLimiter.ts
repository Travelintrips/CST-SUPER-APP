import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";

const IS_DEV = process.env.NODE_ENV !== "production";
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = IS_DEV ? 1000 : 300;

const limiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_PER_WINDOW,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => {
    const forwarded = req.headers["x-forwarded-for"];
    const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]) ?? req.ip ?? "unknown";
    return ipKeyGenerator(raw.trim());
  },
  message: {
    message: "Too many requests. Please wait before retrying.",
  },
  skip: (req: Request) => {
    return !req.headers.authorization?.startsWith("Bearer ");
  },
});

const failureLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: IS_DEV ? 500 : 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: false,
  keyGenerator: (req: Request) => {
    const forwarded = req.headers["x-forwarded-for"];
    const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]) ?? req.ip ?? "unknown";
    return `fail:${ipKeyGenerator(raw.trim())}`;
  },
  message: {
    message: "Too many failed requests. Please wait 5 minutes before retrying.",
  },
  skip: (req: Request) => {
    return !req.headers.authorization?.startsWith("Bearer ");
  },
});

export function bearerRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  limiter(req, res, (err?: unknown) => {
    if (err) return next(err);
    failureLimiter(req, res, next);
  });
}
