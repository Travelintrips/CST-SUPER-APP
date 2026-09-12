import pino from "pino";
import { isTestEnvironment } from "./isTestEnvironment.js";

const isProduction = process.env.NODE_ENV === "production";

/**
 * In test environments the logger is silent and synchronous — no pino-pretty
 * transport, no worker thread, no background flush timer.  This is the single
 * most important rule for clean Vitest exit: any pino-pretty worker spawned at
 * module load will keep the process alive after the last test completes.
 *
 * Production:  pino with default transport (fast, low-overhead).
 * Development: pino-pretty for human-readable console output.
 * Test:        pino({ level: "silent" }) — zero side-effects, exits cleanly.
 */
export const logger = pino(
  isTestEnvironment()
    ? { level: "silent" }
    : {
        level: process.env.LOG_LEVEL ?? "info",
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
        ],
        ...(isProduction || isTestEnvironment()
          ? {}
          : {
              transport: {
                target: "pino-pretty",
                options: { colorize: true },
              },
            }),
      }
);
