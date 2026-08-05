import { describe, expect, it } from "vitest";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";

describe("current auth user contract", () => {
  it("preserves admin role and company context", () => {
    const parsed = GetCurrentAuthUserResponse.parse({
      user: {
        id: "google_admin",
        email: "admin@example.com",
        firstName: "Admin",
        lastName: "User",
        profileImageUrl: null,
        role: "admin",
        companyId: 1,
      },
    });

    expect(parsed.user).toMatchObject({
      role: "admin",
      companyId: 1,
    });
  });
});