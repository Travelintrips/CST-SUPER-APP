---
name: requireAdmin middleware pattern
description: requireAdmin/requireRole/requireClerkUser harus dipanggil inline, BUKAN sebagai Express middleware parameter — karena tidak memanggil next()
---

## Rule
Jangan pernah pakai `requireAdmin` (atau helper auth sejenis) sebagai parameter middleware Express:

```ts
// SALAH — route handler tidak pernah dipanggil saat user IS admin (hang 120s)
router.get("/route", requireAdmin, async (req, res) => { ... });

// BENAR — inline call di dalam handler
router.get("/route", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  // ...
});
```

**Why:** `requireAdmin` signature-nya `(req, res): Promise<boolean>` — tidak ada parameter `next`. Kalau user TIDAK auth → kirim 401 (request selesai). Kalau user IS admin → return `true` tanpa panggil `next()`. Express tidak tahu harus lanjut ke handler berikutnya, sehingga request hang sampai timeout 120 detik, dan gateway mengembalikan HTML error page ke frontend. Frontend lalu gagal parse `response.json()` → error "Unexpected token '<'".

**How to apply:** Setiap kali menambah route baru yang butuh auth, selalu pakai pattern inline. Grep `router\.(get|post|put|delete).*requireAdmin,` untuk menemukan bug yang sama di route files lain.

**Files fixed (2026-06-07):** accounting.ts (10 routes), importAdvisor.ts (1), executive.ts (1), settings.ts (1)
