# Price Sync Flow — BizPortal → Customer Portal

Dokumen ini menjelaskan mekanisme sinkronisasi harga secara real-time antara
BizPortal (admin internal) dan Customer Portal (publik).

---

## Gambaran Umum

Setiap kali admin mengubah harga produk, jasa, atau tarif kalkulator di
BizPortal, backend meng-emit event SSE bernama `price_sync` ke semua koneksi
Customer Portal yang aktif. Frontend Customer Portal mendengarkan event ini dan
melakukan invalidasi React Query cache, yang memicu refetch otomatis ke API —
tanpa perlu refresh halaman.

```
BizPortal (admin)
    │
    │  PUT /api/ecommerce/products/:id
    │  PUT /api/portal/admin/products/:id
    │  PUT /api/portal/admin/services/:id
    │  PUT /api/portal/logistic-admin/services/:id
    │  POST /api/ecommerce/products/bulk-import
    │  PUT /api/settings/calculator-rates
    │
    ▼
API Server (Express)
    │  broadcastToPortal("price_sync", { ts })
    │
    ▼
SSE: GET /api/ecommerce/events
    │
    ├──▶ products.tsx   → invalidateQueries(["portal-products"])
    │                   → GET /api/portal/products
    │
    ├──▶ jasa.tsx       → invalidateQueries(["listPortalServicesJasa"])
    │                   → GET /api/portal/services
    │
    └──▶ calculator.tsx → invalidateQueries(["portal-calculator-rates"])
                        → GET /api/portal/calculator-rates
```

---

## Sumber Update Harga di BizPortal

| Sumber | Route | File |
|--------|-------|------|
| Update produk (BizPortal Ecommerce) | `PUT /api/ecommerce/products/:id` | `artifacts/api-server/src/routes/ecommerce.ts` |
| Bulk import produk | `POST /api/ecommerce/products/bulk-import` | `artifacts/api-server/src/routes/ecommerce.ts` |
| Update produk (Portal Admin JWT) | `PUT /api/portal/admin/products/:id` | `artifacts/api-server/src/routes/portal.ts` |
| Update jasa (Portal Admin JWT) | `PUT /api/portal/admin/services/:id` | `artifacts/api-server/src/routes/portal.ts` |
| Update jasa (Logistic Admin) | `PUT /api/portal/logistic-admin/services/:id` | `artifacts/api-server/src/routes/portal.ts` |
| Update tarif kalkulator | `PUT /api/settings/calculator-rates` | `artifacts/api-server/src/routes/settings.ts` |

---

## SSE Mechanism

**Manager:** `artifacts/api-server/src/lib/sseManager.ts`

- `registerPortalConnection(res)` — daftarkan koneksi SSE baru saat client konek
- `unregisterPortalConnection(res)` — hapus koneksi saat client disconnect
- `broadcastToPortal(event, data)` — kirim event ke semua koneksi aktif

**SSE Endpoint:** `GET /api/ecommerce/events`
- Tidak memerlukan autentikasi (public endpoint)
- Menjaga koneksi hidup dengan `: ping` setiap 25 detik
- Otomatis cleanup saat client disconnect

**Event name:** `price_sync`
**Payload:** `{ ts: number }` — Unix timestamp saat broadcast

---

## Frontend Listeners

### `products.tsx` — Katalog Produk

```tsx
// artifacts/customer-portal/src/pages/products.tsx
useEffect(() => {
  const es = new EventSource("/api/ecommerce/events");
  es.addEventListener("price_sync", () => {
    qc.invalidateQueries({ queryKey: ["portal-products"] });
  });
  return () => es.close();  // cleanup saat unmount
}, [qc]);
```

**Query yang direfetch:** `GET /api/portal/products`
**Query key:** `["portal-products"]`

---

### `jasa.tsx` — Katalog Jasa/Layanan

```tsx
// artifacts/customer-portal/src/pages/jasa.tsx
useEffect(() => {
  const es = new EventSource("/api/ecommerce/events");
  es.addEventListener("price_sync", () => {
    qc.invalidateQueries({ queryKey: ["listPortalServicesJasa"] });
  });
  return () => es.close();  // cleanup saat unmount
}, [qc]);
```

**Query yang direfetch:** `GET /api/portal/services`
**Query key:** `["listPortalServicesJasa"]`

---

### `calculator.tsx` — Kalkulator Estimasi Biaya

```tsx
// artifacts/customer-portal/src/pages/calculator.tsx
useEffect(() => {
  const es = new EventSource("/api/ecommerce/events");
  es.addEventListener("price_sync", () => {
    qc.invalidateQueries({ queryKey: ["portal-calculator-rates"] });
  });
  return () => es.close();  // cleanup saat unmount
}, [qc]);
```

**Query yang direfetch:** `GET /api/portal/calculator-rates`
**Query key:** `["portal-calculator-rates"]`

---

## Catatan Penting: Order Lama Tetap Snapshot

Harga yang tersimpan di order **tidak berubah** saat terjadi price sync.

| Tabel | Column | Perilaku |
|-------|--------|----------|
| `portal_product_order_items` | `unit_price` | Disalin dari `products.price` saat order dibuat, tidak FK live |
| `logistic_orders` | `finalSellingPrice`, `quotedPrice`, `sellingPrice` | Snapshot saat quote/approval |
| `sales_document_lines` | `unitPrice` | Snapshot saat SO dibuat |

Price sync hanya memengaruhi **tampilan harga aktif** di halaman publik Customer
Portal. Harga yang sudah terkunci di order lama tidak pernah berubah.

---

## Regression Test

Untuk memastikan fix ini tidak hilang di update berikutnya, jalankan:

```bash
node artifacts/api-server/tests/price-sync.regression.mjs
```

Pastikan API Server sudah berjalan di port 8080.

Test yang tercakup:
- `T1` — PUT product price → `price_sync` diterima
- `T2` — PUT service price → `price_sync` diterima
- `T3` — PUT calculator rates → code verification (auth HTTPS-only)
- `T4` — POST bulk-import → `price_sync` diterima

---

## Manual Broadcast (Debug)

Jika diperlukan, admin dapat memicu sync manual tanpa mengubah data:

```bash
curl -X POST http://localhost:8080/api/ecommerce/sync-prices
```

Endpoint ini (tidak memerlukan auth di dev) akan mengirim `price_sync` ke semua
koneksi Customer Portal yang aktif.
