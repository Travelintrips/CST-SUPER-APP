---
name: WATI Integration
description: Arsitektur integrasi WATI WhatsApp Business API ke BizPortal — migrasi bertahap dari Fonnte
---

## Rule
waTransport.ts adalah satu-satunya egress point untuk semua WA. Jangan import fonnte.ts atau wati.ts langsung dari route/service lain.

## Routing Logic
- Jika `WATI_API_TOKEN` + `WATI_BASE_URL` keduanya ada di env → `sendViaService()` pakai WATI session message
- Fallback (tidak ada WATI config, atau `forceFonnte: true`) → Fonnte
- Grup WA admin (`sendToAdminGroup()`) → **SELALU Fonnte** karena WATI tidak support grup WhatsApp

## Files
- `artifacts/api-server/src/lib/wati.ts` — WATI client (sendWatiSession, sendWatiTemplate, listWatiTemplates, testWatiConnection, isWatiConfigured)
- `artifacts/api-server/src/lib/waTransport.ts` — router layer (sendViaService, sendMediaViaService, sendToAdminGroup)
- `artifacts/api-server/src/routes/wati.ts` — admin API: GET /api/wati/status, GET /api/wati/templates, POST /api/wati/test-send, POST /api/wati/send-template
- `artifacts/bizportal/src/pages/settings/wati.tsx` — halaman settings WATI di BizPortal
- `/api/wati/*` — semua endpoint dilindungi requireAdmin

## Template HSM vs Session Message
- **Session message** (`sendWatiSession`): pesan bebas, hanya bisa dikirim jika pelanggan sudah menghubungi dalam 24 jam terakhir
- **Template/HSM** (`sendWatiTemplate`): bisa dikirim kapan saja, template harus sudah APPROVED di dashboard WATI

## Env Vars (Replit Secrets)
- `WATI_API_TOKEN` — Bearer token dari WATI dashboard (Settings → API)
- `WATI_BASE_URL` — base URL endpoint, contoh: `https://live-mt-server.wati.io/12345`

**Why:** Migrasi bertahap — Fonnte tetap berjalan (terutama untuk grup admin), WATI dipakai untuk notif ke nomor personal. waTransport.ts sebagai single egress point memungkinkan switch provider tanpa ubah caller.

**How to apply:** Untuk fitur WA baru ke nomor personal → gunakan `sendViaService` dari waTransport.ts (otomatis route ke WATI jika dikonfigurasi). Untuk kirim ke grup WA admin → gunakan `sendToAdminGroup` (tidak perlu forceFonnte, sudah hardcoded).
