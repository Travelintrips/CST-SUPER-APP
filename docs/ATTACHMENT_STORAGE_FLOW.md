# Attachment & File Storage Flow

> CST Logistics — how files are uploaded, stored in Supabase Storage, served, and secured.

---

## Architecture Overview

```
Client (browser / mobile)
     │
     ├─── Multipart upload (portal customers, driver photos)
     │         POST /api/portal/order-upload
     │         POST /api/driver/jobs/:jobId/photos
     │              ↓
     │         multer (size limit + MIME check)
     │              ↓
     │         imageCompress.ts (JPEG/PNG only)
     │              ↓
     │         ObjectStorageService.uploadPrivateEntity()
     │              ↓
│         Supabase private-uploads  →  /objects/uploads/<uuid>
     │
└─── Server-proxied upload path (BizPortal admin staff)
               POST /api/storage/uploads/request-url
         ↓ returns API PUT URL
       Client PUT through API to Supabase
                    ↓ background guard checks size after URL expires
               Path registered in pendingUploadGuards map
```

---

## Storage Paths

| Type | Supabase path | Bucket |
|---|---|---|
| Private uploads | `private-uploads/uploads/<uuid>` | `private-uploads` |
| Public assets | `public-assets/<filePath>` | `public-assets` |

Normalized DB path: `/objects/uploads/<uuid>` (stored in DB, not a full URL)

---

## Upload Flows

### 1. Server-Side Proxy (Multer) — Portal & Driver
Used by: customer portal order attachments, driver POD/cargo photos, admin product images.

```
Client  →  POST /api/portal/order-upload  (multipart/form-data)
        →  multer validates size (<10–20MB) + MIME type
        →  compressImageBuffer() for images (JPEG/PNG)
        →  objectStorage.uploadPrivateEntity(buffer, mimeType)
        →  Returns { objectPath: "/objects/uploads/<uuid>" }
```

Key files:
- `artifacts/api-server/src/routes/portal.ts` — customer portal upload
- `artifacts/api-server/src/routes/driver.ts` — POD photo upload
- `artifacts/api-server/src/lib/imageCompress.ts` — compression

### 2. Server-Proxied PUT — BizPortal Staff
Used by: admin staff uploading documents/attachments in BizPortal.

```
Client  →  POST /api/storage/uploads/request-url
         ←  { uploadURL, objectPath }
Client  →  PUT <uploadURL>  (API validates and writes to Supabase)
         ←  API 201
Client  →  stores objectPath in form/DB
```

Security guard (background check):
- After the upload window expires, server fetches object metadata
- If size > 100MB hard cap → object deleted automatically
- MIME type whitelist enforced on `request-url` before issuing presigned URL

Rate limit: 50 presigned URL requests per user per hour.

---

## Serving Files

### Private objects: `GET /api/storage/objects/{*path}`
```
Request → requireAuth (Clerk or portal JWT)
        → canAccessObjectEntity(userId, objectPath)  [ACL check]
        → objectStorage.downloadObject(file, cacheTtlSec=3600)
        → Response with Content-Type, Content-Length, Cache-Control
```

ACL metadata is tracked by the API for the current session; the business
database remains the durable owner/audit record.
Access granted if: user is recorded `owner` OR user has `admin` role.

### Public objects: `GET /api/storage/public-objects/{*path}`
No authentication required. Served with `Cache-Control: public, max-age=3600`.

---

## VMF Attachment Validation

Vendor Mini Form blocks arbitrary URLs:
```typescript
// Only internal /objects/... paths are accepted
// Prevents SSRF / XSS via external URL injection
if (attachmentUrl && !attachmentUrl.startsWith("/objects/")) {
  return res.status(400).json({ error: "attachmentUrl tidak valid" });
}
```

Upload endpoint for VMF: `POST /api/vendor-form/upload/:token`
- Token validated before accepting file
- Stored to Supabase private-uploads, path returned to client

---

## Key Files

| File | Purpose |
|---|---|
| `lib/objectStorage.ts` | Supabase Storage adapter and private upload methods |
| `lib/objectAcl.ts` | Metadata-based ACL (owner, visibility) |
| `lib/imageCompress.ts` | Sharp-based JPEG/PNG compression |
| `routes/storage.ts` | `/api/storage/*` endpoints, presign guard |
| `routes/portal.ts` | Customer portal upload routes |
| `routes/driver.ts` | Driver photo upload (multer + Supabase Storage) |
| `routes/vendorMiniForm.ts` | VMF attachment upload + validation |
| `lib/storageAuditLog.ts` | Audit log for uploads/URL requests |

---

## Security Rules

1. **No public write** — all uploads go through server-side validation or presigned URLs with MIME whitelist
2. **Private by default** — all uploads land in the `private-uploads` bucket
3. **No path traversal** — `..` segments blocked in storage routes
4. **MIME whitelist** — only approved content types can get presigned URLs
5. **Size caps** — 10–20MB for portal/driver uploads; 100MB background guard for presigned
6. **Audit trail** — every upload and URL request logged via `storageAuditLog.ts`
7. **VMF path validation** — only `/objects/...` paths accepted in form submissions

---

## Test Checklist

- [ ] Customer uploads attachment → file appears at `/objects/uploads/<uuid>`
- [ ] Private file requires auth → 401 without session
- [ ] Private file for different user → 403 forbidden
- [ ] Admin can access any private file (admin role bypass)
- [ ] VMF form with external URL (`https://...`) → 400 rejected
- [ ] VMF form with valid `/objects/...` path → accepted
- [ ] Presigned URL upload > 100MB → file deleted by background guard
- [ ] MIME not in whitelist → 400 on request-url
- [ ] Path traversal (`../`) → blocked at route level
- [ ] Audit log entry created for every upload
