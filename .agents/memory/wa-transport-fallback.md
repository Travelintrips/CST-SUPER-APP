---
name: WhatsApp transport — Fonnte-only egress
description: All WA notifications go through Fonnte; WATI removed from the notification path
---

The WA egress router (`lib/waTransport.ts`: `sendViaService`, `sendMediaViaService`,
`sendToAdminGroup`) sends **everything through Fonnte**. WATI was removed from the
notification path by user decision ("hapus hubungan dengan wati, fokus ke fonnte").

**Why:** WATI silently dropped messages — `sendWatiSession` (lib/wati.ts) returns
`{ok:false}` on failure WITHOUT throwing, and WATI rejects WA **group IDs** (`…@g.us`)
as `"Invalid Contact"` (also seen "target input invalid"). Callers that ignored the
return value dropped messages with no error, so multi-step notification flows
(order → vendor blast → admin-group confirmation) "stopped with no continuation".

**How to apply:** Keep notification sends on Fonnte via `waTransport.ts`. The
`forceFonnte` opt is now a no-op kept only for caller compatibility. `routes/wati.ts`
still exists as a standalone WATI test/config UI but is NOT in the notification path —
do not reintroduce WATI routing into `waTransport.ts`. When debugging "notif WA
berhenti", check Fonnte send logs (`WhatsApp sent via Fonnte` / `waMessageId`).
