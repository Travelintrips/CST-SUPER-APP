/**
 * validateBody — Express middleware untuk validasi req.body dengan Zod schema.
 *
 * Menggantikan parsing manual req.body di seluruh vendor routes.
 * Jika validasi gagal → HTTP 400 dengan daftar field errors.
 * Jika berhasil → req.body diisi dengan data yang sudah di-parse (typed + sanitized).
 */

import type { Request, Response, NextFunction } from "express";

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { flatten: () => unknown } };

type BodySchema<T> = {
  safeParse: (input: unknown) => SafeParseResult<T>;
};

export function validateBody<T>(schema: BodySchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({
        message: "Validasi gagal",
        errors: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
