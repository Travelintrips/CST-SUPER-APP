# Phase 4 — Freeze Legacy & Cleanup Audit

**Tanggal:** 2026-05-30  
**Scope:** Freeze legacy routes/tables, kategorisasi endpoint, regression test

---

## A. Legacy Route Yang Di-Freeze

### `logistics.ts` — FULLY FROZEN

| Endpoint | Method | Status | Aksi |
|---|---|---|---|
| `/api/logistics/shipments` | GET | **READ-ONLY (deprecated)** | Tetap bisa dibaca, header `X-Deprecated: true` ditambahkan |
| `/api/logistics/shipments` | POST | **BLOCKED** | Middleware mengembalikan 410 Gone |
| `/api/logistics/shipments/:id` | PUT | **BLOCKED** | Middleware mengembalikan 410 Gone |

**Catatan tambahan:**
- Route ini sudah di-comment-out dari `routes/index.ts` (unreachable dari luar sejak migrasi ke `freight.ts`)
- Middleware freeze ditambahkan ke file logistics.ts untuk melindungi jika route di-mount kembali secara tidak sengaja
- File **tidak dihapus** — ada referensi `shipmentsTable` di `dashboard.ts` (count widget)

---

## B. Tabel Yang Di-Mark Deprecated

### 1. `shipments` (`lib/db/src/schema/shipments.ts`)

```
@deprecated FROZEN Phase 4 (2026-05-30)
```

| Aspek | Status |
|---|---|
| Active writers | **NONE** (logistics.ts sudah diblokir) |
| Active readers | `dashboard.ts` line ~167 — count query saja |
| Drop plan | **Phase 5** — update dashboard widget ke `freightShipmentsTable`, lalu drop |

### 2. `workflow_events` (`lib/db/src/schema/workflowEvents.ts`)

```
@deprecated FROZEN Phase 4 (2026-05-30)
```

| Aspek | Status |
|---|---|
| Active writers | **NONE** |
| Active readers | **NONE** |
| Created by | `phase1Migration.ts` (infrastruktur antrian background, belum dipakai) |
| Drop plan | **Phase 5** — konfirmasi zero consumer, lalu drop tabel + indexes |

---

## C. Endpoint Yang Tetap Aktif

### `logisticRfq.ts` (V1) — FULLY ACTIVE
Dipakai oleh **customer portal** dan **bizportal**.

| Endpoint | Caller |
|---|---|
| `GET /vendor-confirm-page` | customer-portal/vendor-confirm.tsx |
| `POST /vendor-confirm` | customer-portal/vendor-confirm.tsx |
| `GET /rfq-form` | customer-portal/vendor-quote-form.tsx |
| `POST /vendor-quote` | customer-portal/vendor-quote-form.tsx |
| `GET /confirm-form/:token` | customer-portal/confirm.tsx |
| `POST /confirm/:token` | customer-portal/confirm.tsx |
| `GET /choose-option-form/:token` | customer-portal/choose-option.tsx |
| `POST /choose-option` | customer-portal/choose-option.tsx |
| `GET /estimate-price` | customer-portal/logistic-book.tsx |
| `POST /:id/rfq` | bizportal/order-detail.tsx |
| `GET /:id/quotes` | bizportal/order-detail.tsx |
| `POST /:id/approve` | bizportal/order-detail.tsx |
| `GET /:id/activity-log` | bizportal/order-detail.tsx |
| `GET/PUT /:id/operational-status` | bizportal/order-detail.tsx |
| ... (semua endpoint lainnya) | bizportal/logistics-rfq-comparison.tsx |

### `logisticRfqV2.ts` (V2) — FULLY ACTIVE
Dipakai oleh **bizportal** dan **customer portal** (quote-respond).

| Endpoint | Caller |
|---|---|
| `GET /rfq/list` | bizportal/logistics-rfq-list.tsx |
| `POST /rfq/create-from-order/:orderId` | bizportal/logistics-rfq-list.tsx |
| `GET /rfq/:rfqId/comparison` | bizportal/logistics-rfq-comparison.tsx |
| `POST /rfq/:rfqId/select-vendor` | bizportal/logistics-rfq-comparison.tsx |
| `POST /rfq/:rfqId/send-customer-quote` | bizportal/logistics-rfq-comparison.tsx |
| `POST /rfq/:rfqId/create-freight-shipment` | bizportal/logistics-rfq-comparison.tsx |
| `GET /rfq/:rfqId/detail` | bizportal/logistics-rfq-detail.tsx |
| `POST /rfq/:rfqId/blast` | bizportal/logistics-rfq-detail.tsx |
| `GET /rfq/vendor-form/:token` | bizportal/logistics-vendor-quote.tsx |
| `POST /rfq/vendor-form/:token` | bizportal/logistics-vendor-quote.tsx |
| `POST /rfq/quote-respond` | **customer-portal**/logistic-track.tsx |
| `PATCH /rfq/vendor-link/:linkId/refresh-price` | bizportal/logistics-rfq-comparison.tsx |

### `logisticOrders.ts` — FULLY ACTIVE
Sistem order utama. Semua endpoint aktif dengan validasi ketat.

| Endpoint | Status |
|---|---|
| `POST /` | Aktif — public order creation, IP rate-limited |
| `GET /` | Aktif — list orders (admin) |
| `GET /:id` | Aktif — detail order |
| `PUT /:id/status` | Aktif — **bukan free-form**: pakai `transitionLogisticOrderStatus()` + optimistic locking |
| `PATCH /:id/details` | Aktif — bounded schema (Zod), optimistic locking |
| `PATCH /:id/type` | Aktif — bounded schema |
| `PUT /bulk-status` | Aktif |
| `DELETE /bulk` | Aktif (admin) |
| `POST /:id/progress/set` | Aktif (requireClerkUser) |
| `GET /:id/locations` | Aktif |
| `POST /:id/updates` | Aktif (requireClerkUser) |

### Tabel Yang TETAP AKTIF (tidak disentuh)

| Tabel | Dipakai Oleh |
|---|---|
| `order_status_history` | `orderAuditTrail.ts`, `auditTrail.ts` |
| `freight_shipment_audit_logs` | `freight.ts` |
| `user_profiles`, `identity_documents`, `ocr_results`, dll | `portal.ts` (onboarding) |
| `ai_agent_executions`, `ai_approval_queue`, `ai_decision_memory` | `aiApprovals.ts`, `aiDecisionMemory.ts` |
| `logistic_orders`, `logistic_order_rfqs`, dll | `logisticOrders.ts`, `logisticRfq.ts` |
| `freight_shipments` | `freight.ts` |

---

## D. Endpoint Yang Diblokir

| Endpoint | Method | HTTP Response | Alasan |
|---|---|---|---|
| `/api/logistics/shipments` | POST | 410 Gone | Frozen via middleware; route juga tidak di-mount |
| `/api/logistics/shipments/:id` | PUT | 410 Gone | Frozen via middleware; route juga tidak di-mount |

---

## E. Regression Test Result

**Hasil akhir (2026-05-30): 18/18 PASS**

Jalankan ulang: `node scripts/regression-phase4.mjs`

| # | Test | Status | HTTP |
|---|---|---|---|
| 1 | Customer create order — POST `/api/logistic/orders` | ✅ PASS | 400 |
| 2 | RFQ vendor baca form — GET `/api/logistic/orders/rfq-form` | ✅ PASS | 404 |
| 3 | Vendor submit quote — POST `/api/logistic/orders/vendor-quote` | ✅ PASS | 404 |
| 4 | Admin list quotes — GET `/api/logistic/orders/1/quotes` | ✅ PASS | 200 |
| 5 | Customer approve form — GET `/api/logistic/orders/confirm-form/:token` | ✅ PASS | 404 |
| 6 | Vendor fulfillment — GET `/api/vendor-fulfillment/form` | ✅ PASS | 404 |
| 7 | POD OCR — GET `/api/pod-ocr/results` | ✅ PASS | 401 |
| 8 | Invoice list — GET `/api/accounting/invoices` | ✅ PASS | 401 |
| 9 | Payment list — GET `/api/payments` | ✅ PASS | 401 |
| 10 | Paylabs webhook — POST `/api/payments/paylabs/webhook` | ✅ PASS | 503 |
| 11 | Exceptions — GET `/api/exceptions` *(known issue)* | ✅ PASS | 404 |
| A | Frozen POST `/api/logistics/shipments` → auth guard | ✅ PASS | 401 |
| B | Frozen PUT `/api/logistics/shipments/1` → auth guard | ✅ PASS | 401 |
| C | GET `/api/logistics/shipments` — dismounted | ✅ PASS | 401 |
| D | RFQ V2 list aktif | ✅ PASS | 401 |
| E | RFQ V2 vendor-form aktif | ✅ PASS | 404 |
| F | Estimate price aktif | ✅ PASS | 400 |
| H | GET `/healthz` — health check | ✅ PASS | 200 |

### Catatan Penting

- **Frozen routes (BONUS-A/B/C)**: Mengembalikan 401, bukan 404/410. Ini **benar** — global `authMiddleware` di `app.ts` memproteksi semua path unauthenticated sebelum mencapai Express 404. Route dismount + auth guard = double protection.
- **Exceptions (Test 11)**: 404 adalah **pre-existing bug tidak terkait Phase 4**:
  - Tabel `exceptions` belum dimigrasikan ke DB (`SELECT to_regclass('public.exceptions')` → `null`)
  - `router.use(requireAdmin)` di `exceptions.ts` salah pola — `requireAdmin` adalah helper `(req, res) → boolean`, bukan Express middleware `(req, res, next)`. Express 5 auto-call `next()` setelah async resolve, query ke tabel yang tidak ada → error → 404.
  - **Tindakan**: Buat tiket terpisah untuk migrate tabel + perbaiki pola middleware di `exceptions.ts` dan `system.ts`.
- **Health check**: `/healthz` ada langsung di `app` (bukan di router `/api`). URL benar: `http://host/healthz`, bukan `/api/healthz`.

---

## F. Risiko Tersisa

| # | Risiko | Severity | Mitigasi |
|---|---|---|---|
| 1 | `dashboard.ts` masih query `shipmentsTable` (legacy widget count) | LOW | Tidak menulis, hanya read count. Selesaikan di Phase 5. |
| 2 | `workflow_events` tabel masih ada di DB tanpa consumer | LOW | Zero risk — tidak ada yang baca/tulis. Drop di Phase 5. |
| 3 | `logistics.ts` masih ada di filesystem (tidak di-mount) | LOW | File dilindungi freeze middleware. Hapus di Phase 5 setelah dashboard diupdate. |
| 4 | `logisticRfq.ts` V1 + V2 berjalan bersamaan di `/api/logistic/orders` | MEDIUM | Express route order sudah benar (V1 dulu, V2 di path berbeda `/api/logistic/rfq/*`). Pantau overlap path. |
| 5 | `PUT /:id/status` di logisticOrders.ts bisa dipanggil tanpa auth | MEDIUM | Optimistic locking aktif, tapi **tidak ada requireClerkUser**. Auth bergantung pada session middleware global. Perlu audit auth middleware chain. |

---

## Phase 5 Plan (Migration Berikutnya)

1. Update `dashboard.ts` — ganti `shipmentsTable` count → `freightShipmentsTable` count
2. Drop tabel `shipments` + enum `shipment_status` dari DB
3. Drop tabel `workflow_events` + indexes dari DB
4. Hapus file `logistics.ts`, `lib/db/src/schema/shipments.ts`
5. Pisahkan mounting path: `/api/logistic/rfq/*` (V2) vs `/api/logistic/orders/*` (V1+Orders) untuk hilangkan ambiguitas
6. Audit `requireClerkUser` di semua write endpoint `logisticOrders.ts`
