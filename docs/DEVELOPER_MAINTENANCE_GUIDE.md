# Developer Maintenance Guide — BizPortal ERP

**Versi:** v1.0 | **Terakhir diperbarui:** 27 Mei 2026

---

## A. Architecture Overview

### System Topology

```
┌─────────────────────────────────────────────────────────┐
│  Browser Clients                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  BizPortal   │  │Customer Portal│  │ Logistic Order│  │
│  │  (port 3000) │  │  (port 5000) │  │  (port 3001)  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼─────────────────┼──────────────────┼──────────┘
          │                 │                  │
          └─────────────────┼──────────────────┘
                            │ HTTP / SSE
                    ┌───────▼────────┐
                    │  API Server     │
                    │  Express 5      │
                    │  (port 8080)    │
                    └───────┬────────┘
                            │
             ┌──────────────┼──────────────┐
             │              │              │
    ┌────────▼──────┐ ┌─────▼──────┐ ┌────▼──────────────┐
    │ PostgreSQL DB  │ │  Replit    │ │  External Services │
    │ (Supabase PG)  │ │  Object    │ │  - Fonnte (WA)    │
    │ via Drizzle    │ │  Storage   │ │  - OpenAI (OCR)   │
    └───────────────┘ └────────────┘ │  - SMTP (email)   │
                                     │  - VAPID (push)   │
                                     └───────────────────┘
```

### Frontend Stack
- **React 19** + **Vite 7** + **TypeScript 5.9**
- **TanStack Query v5** untuk data fetching & cache
- **Wouter** untuk client-side routing
- **Tailwind CSS v4** + **shadcn/ui** + **Radix UI**
- **Orval** untuk generate React Query hooks dari OpenAPI spec
- Tiap frontend adalah Vite app terpisah dalam monorepo pnpm

### Backend Stack
- **Express 5** + **TypeScript** (ESM bundle via esbuild)
- **Drizzle ORM** + **pg** untuk PostgreSQL
- **Zod v4** untuk schema validation
- **Pino** untuk structured logging
- **OpenID Connect** (Google OAuth) untuk auth internal
- **jose** untuk JWT signing/verify

### Authentication Layers
```
BizPortal Staff:
  Cookie session (express-session) → requireAdmin / requireClerkUser

Customer Portal / Mobile:
  Bearer token (Supabase JWT atau custom portal JWT)
  → requirePortalAuth → requirePortalAdmin

POS Kasir:
  Custom token → CASHIER_TOKEN_SECRET
  → cashierAuth middleware

Public forms (VMF, customer approval):
  Token dalam URL path → token lookup di DB
  → tidak perlu auth session
```

### SSE (Server-Sent Events)
- File: `artifacts/api-server/src/lib/sseManager.ts`
- Tiga pool koneksi: `adminConnections`, `driverConnections`, `portalConnections`
- Heartbeat 30 detik via `setInterval` — koneksi stale di-purge otomatis
- Backend broadcast: `broadcastToAdmin()`, `broadcastToPortal()`, `broadcastToDriver(driverId)`
- Frontend listen: `new EventSource('/api/sse/...')` → handler invalidate TanStack Query
- **Penting**: SSE tidak persistent — client harus reconnect setelah server restart

### Storage Architecture
- **Backend**: `artifacts/api-server/src/lib/objectStorage.ts`
- **Provider**: Replit Object Storage (`@replit/object-storage`)
- **Bucket**: dikonfigurasi via `DEFAULT_OBJECT_STORAGE_BUCKET_ID`
- **Public files**: path prefix di `PUBLIC_OBJECT_SEARCH_PATHS`
- **Private files**: path prefix di `PRIVATE_OBJECT_DIR` — hanya accessible via signed URL
- **Frontend uploader**: `@uppy/core` + `@uppy/aws-s3` via presigned URL dari backend

### WA Template System
- Templates disimpan di DB: tabel `whatsapp_template_configs`
- Unique key: `(recipient, workflow)` — satu template per kombinasi
- Service: `artifacts/api-server/src/lib/orderNotification.ts`
- Rendering: simple string replace `{{variable}}` + Handlebars-style conditional `{{#if condition}}`
- Gateway: Fonnte API via `artifacts/api-server/src/lib/fonnte.ts`
- Dedup guard: 30 menit window per (order_id, workflow) mencegah spam

---

## B. Important Tables

| Tabel | Deskripsi | Key Fields |
|-------|-----------|------------|
| `logistic_orders` | Core order entity | `id`, `orderNumber`, `status`, `customerId`, `companyId` |
| `logistic_order_rfqs` | Request for Quotation | `id`, `orderId`, `status`, `expiresAt` |
| `vendor_mini_form_links` | Token link untuk vendor | `id`, `token`, `orderId`, `supplierId`, `mode`, `serviceType`, `status` |
| `vendor_mini_form_submissions` | Jawaban vendor | `id`, `linkId`, `supplierId`, `price`, `details`, `status`, `attachments` |
| `customer_approvals` | Approval customer | `id`, `orderId`, `submissionId`, `token`, `status`, `marginPct`, `finalPrice` |
| `sales_documents` | SO / Invoice | `id`, `kind`, `number`, `logisticOrderId`, `totalAmount`, `status` |
| `sales_document_items` | Line items SO | `id`, `documentId`, `productId`, `qty`, `unitPrice`, `total` |
| `suppliers` | Vendor / supplier (unified) | `id`, `name`, `serviceType`, `contactPhone`, `isActive`, `fee`, `logo` |
| `products` | Produk & jasa | `id`, `name`, `categoryId`, `price`, `uomId`, `isActive` |
| `activity_logs` | Technical audit trail | `id`, `orderId`, `actor`, `action`, `oldValue`, `newValue`, `createdAt` |
| `order_updates` | Human-readable timeline | `id`, `orderId`, `actorName`, `note`, `isPublic`, `createdAt` |
| `whatsapp_template_configs` | WA templates | `id`, `recipient`, `workflow`, `template`, `isActive` |
| `short_links` | URL shortener | `id`, `code`, `targetUrl`, `createdAt` |
| `attachments` | File metadata | `id`, `entityType`, `entityId`, `fileName`, `storageKey`, `isPublic` |
| `sessions` | Express session store | `sid`, `sess`, `expire` |
| `users` | Staff/admin users | `id`, `email`, `name`, `role`, `companyId` |
| `companies` | Multi-tenant companies | `id`, `name`, `slug`, `isHolding` |

---

## C. Important Services & Files

### Order Lifecycle
- Route: `artifacts/api-server/src/routes/logisticOrders.ts`
- RFQ: `artifacts/api-server/src/routes/logisticRfq.ts`
- VMF: `artifacts/api-server/src/routes/vendorMiniForm.ts`
- Customer Quote: `artifacts/api-server/src/routes/customerQuoteFlow.ts`
- SO Integration: `artifacts/api-server/src/lib/vmfSoIntegration.ts`

### Key Lib Files
```
artifacts/api-server/src/lib/
  sseManager.ts          — SSE pool & broadcast
  orderNotification.ts   — WA/email template render & send
  fonnte.ts              — Fonnte API wrapper + dedup
  objectStorage.ts       — Replit Object Storage wrapper
  supabaseStorage.ts     — Supabase Storage wrapper (public assets)
  requireAdmin.ts        — Admin auth middleware
  supabaseAuth.ts        — Portal bearer token auth
  vmfSoIntegration.ts    — VMF → SO creation logic
  imageCompress.ts       — Sharp-based image compression
```

### Frontend Key Files
```
artifacts/bizportal/src/
  pages/logistics/        — Semua halaman logistik
  pages/logistics/vendor-mini-form.tsx
  pages/logistics/customer-approval.tsx
  pages/logistics/shipments.tsx
  components/logistics/   — Komponen shared
  lib/queryKeys.ts        — TanStack Query key constants
  hooks/useOrderNotifications.ts  — SSE listener

artifacts/customer-portal/src/
  pages/logistic-book.tsx     — Form booking
  pages/logistic-track.tsx    — Tracking
  pages/logistic-admin.tsx    — Admin view portal
  pages/admin-review.tsx      — Customer approval page
```

---

## D. Realtime & Cache Notes

### Query Keys (TanStack Query)
- Selalu gunakan konstanta dari `lib/queryKeys.ts` — jangan hardcode string
- Pattern: `['entity', 'list', filters]` atau `['entity', 'detail', id]`
- Setelah mutation: `queryClient.invalidateQueries({ queryKey: [...] })`

### SSE + Query Invalidation Pattern
```typescript
// Backend: broadcast event
broadcastToAdmin({ type: 'order_update', orderId: 123 });

// Frontend: listen & invalidate
const sse = new EventSource('/api/sse/admin');
sse.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'order_update') {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  }
};

// Cleanup wajib di useEffect return
return () => sse.close();
```

### Cache Stale Time
- Default stale time TanStack Query: 0 (refetch on window focus)
- Untuk data yang jarang berubah (templates, products): set `staleTime: 5 * 60 * 1000`
- Untuk order status: biarkan default atau gunakan SSE untuk invalidasi

### EventSource Lifecycle
- SSE connection otomatis reconnect jika putus (browser behavior)
- Server restart akan drop semua SSE connections — client reconnect dalam beberapa detik
- Jangan buat multiple EventSource untuk endpoint yang sama dalam satu komponen

---

## E. Security Notes

### Token Validation
- **VMF token**: UUID/random string, lookup di `vendor_mini_form_links.token` — expired check manual
- **Customer approval token**: Sama, di `customer_approvals.token`
- **SO number**: `SO/YYYY/NNNNNN-XXXX` dengan random suffix 4 karakter — mencegah enumeration
- **Cashier token**: JWT signed dengan `CASHIER_TOKEN_SECRET`

### Auth Middleware Flow
```
Request masuk
  → authMiddleware (cek session cookie → set req.user)
  → requireAdmin (cek role === 'admin' atau custom_roles permission)
  → route handler

Public routes:
  Tidak ada requireAdmin
  Namun tetap ada validasi token dalam URL/body untuk VMF & approval
```

### Public Endpoint Safety
- Rate limiting: `express-rate-limit` di semua public mutation endpoint
- Public tracking `GET /track/:orderNumber`: strip PII, strip harga vendor, hanya status
- Upload endpoint: validasi mime type, max size 20MB, `UploadGuardSession` cleanup oversized
- AI/OCR endpoint: hanya bisa dipanggil dengan session auth aktif — tidak public

### Row-Level Security
- Tidak menggunakan Supabase RLS karena API server adalah proxy penuh
- Authorization dilakukan di layer Express middleware
- `company_id` dipakai untuk multi-tenant isolation — selalu filter by `companyId` di query

### Jangan Lakukan
- Jangan expose `vendorPrice` atau `margin` ke customer approval page
- Jangan gunakan bearer token portal sebagai identitas admin internal
- Jangan skip `requireAdmin` untuk route yang mengubah data finansial
- Jangan log nilai secret/token ke pino logger

---

## F. Regression Checklist

Jalankan manual setelah setiap perubahan signifikan:

### Order Lifecycle
- [ ] Customer buat order baru via portal → muncul di BizPortal
- [ ] Admin ubah status order → customer lihat update di tracking
- [ ] Duplicate order dalam 60 detik → hanya satu yang masuk

### VMF Flow
- [ ] Admin generate link VMF → link aktif di DB
- [ ] Vendor buka link → form tampil sesuai service type
- [ ] Vendor submit → muncul di BizPortal submission list
- [ ] Submit kedua dari vendor yang sama → ditolak (duplicate constraint)
- [ ] Admin pilih vendor → status order update

### Customer Approval
- [ ] Admin generate approval link → link valid
- [ ] Customer buka link → tampil harga final (bukan harga vendor)
- [ ] Customer approve → SO dibuat di `sales_documents`
- [ ] Approve dua kali → SO tidak duplikat (idempotency)
- [ ] Customer request revision → admin terima notifikasi

### Price Sync SSE
- [ ] BizPortal terbuka → SSE connection established
- [ ] Harga produk diupdate → frontend invalidate cache tanpa refresh manual

### WA Template
- [ ] Edit template → preview render benar
- [ ] Submit order → WA dikirim ke admin
- [ ] Customer approve → WA konfirmasi terkirim
- [ ] WA ke vendor sama tidak terkirim ulang dalam 30 menit (dedup guard)

### Attachment
- [ ] Upload file di order → tersimpan, bisa dibuka
- [ ] Download file → file sama yang diupload
- [ ] File tetap ada setelah server restart

### Duplicate Prevention
- [ ] Order submit 2x dalam 60 detik (email sama) → tolak kedua
- [ ] VMF submit 2x dari vendor sama → tolak kedua
- [ ] Customer approve 2x → SO tidak dobel

---

## G. Deployment Notes

### Env Variables Wajib
Lihat `docs/RELEASE_NOTES_v1.md` dan laporan checklist untuk daftar lengkap.

**Critical yang sering terlupakan:**
- `GOOGLE_CLIENT_SECRET` — tanpa ini, Google OAuth mati
- `SUPABASE_SERVICE_ROLE_KEY` — untuk Supabase JWT verify

### Migration Order
Migrations berjalan **otomatis saat API server startup**. Urutan sudah terdefinisi di `artifacts/api-server/src/index.ts`. Tidak perlu jalankan manual.

Jika ingin jalankan manual (untuk testing):
```bash
cd lib/db && pnpm run push
```

### Build Order untuk Production
```bash
# 1. Install dependencies
pnpm install

# 2. Build API server
cd artifacts/api-server && node build.mjs

# 3. (Opsional) Regenerate API client jika ada perubahan OpenAPI
cd lib/api-spec && pnpm exec orval --config ./orval.config.ts

# 4. Build frontends
cd artifacts/bizportal && pnpm run build
cd artifacts/customer-portal && pnpm run build
cd artifacts/logistic-order && pnpm run build
```

### TypeScript Project References
`lib/db` dan `lib/api-zod` pakai TypeScript composite project. Untuk typecheck yang bersih:
```bash
# Build declaration files terlebih dahulu
pnpm exec tsc --build lib/db/tsconfig.json lib/api-zod/tsconfig.json

# Baru jalankan typecheck
pnpm --filter @workspace/api-server run typecheck
```

### Rollback
Lihat `docs/DEVELOPER_MAINTENANCE_GUIDE.md` section rollback atau laporan deployment checklist.

---

## H. Known Limitations

| Limitation | Dampak | Workaround |
|------------|--------|------------|
| SSE tidak persistent setelah server restart | Client perlu reconnect (~2-5 detik) | Browser auto-reconnect EventSource |
| Tidak ada job queue / retry system | WA yang gagal tidak di-retry otomatis | Admin kirim manual via BizPortal |
| Calculator SSE auth hanya verify di connect-time | Token expired mid-stream tidak di-kick | Token lifetime pendek + reconnect |
| Tidak ada offline mode | Portal tidak bisa digunakan tanpa internet | Tidak ada workaround |
| Storage single-region (Replit) | Latency tinggi dari luar region Replit | CDN belum diimplementasi |
| Tidak ada multi-region DB failover | Jika Supabase down, sistem mati | Backup manual + monitoring |
| WA Fonnte tidak support rich media (PDF) | Attachment tidak bisa dikirim via WA | Kirim link download |
| Tidak ada versioning file di storage | Overwrite tidak bisa di-undo | Backup storage manual |
| Chunk size frontend besar (>500KB) | First load lambat di koneksi lambat | Code splitting belum dioptimalkan |
| Tidak ada unit test / integration test | Regression harus manual | Lihat checklist regression di atas |
| Google OAuth mati jika `GOOGLE_CLIENT_SECRET` kosong | Staff tidak bisa login via Google | Set env var atau gunakan email/pass |
| SMTP email opsional | Notifikasi email tidak terkirim | Andalkan WA sebagai primary channel |
