---
name: P&L generated contract
description: The profit-and-loss report has a generated client contract that can lag behind the server and OpenAPI response shape.
---

## Rule
Keep the P&L route, OpenAPI schema, generated React client, and generated Zod response schema synchronized. Run the repository codegen before diagnosing missing P&L fields as a frontend implementation problem.

**Why:** The server and OpenAPI schema can already expose HPP, operating expense, and gross-profit fields while the generated client still exposes only revenue and total expense; BizPortal then fails typechecking even though the runtime route is correct.

**How to apply:** After changing or consuming P&L response fields, run the api-spec codegen, then run the BizPortal typecheck and build.