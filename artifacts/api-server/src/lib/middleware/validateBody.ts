/**
 * validateBody — Express middleware untuk validasi req.body dengan Zod schema.
 *
 * Menggantikan parsing manual req.body di seluruh vendor routes.
 * Jika validasi gagal → HTTP 400 dengan daftar field errors.
 * Jika berhasil → req.body diisi dengan data yang sudah di-parse (typed + sanitized).
 */

import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({
        message: "Validasi gagal",
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
