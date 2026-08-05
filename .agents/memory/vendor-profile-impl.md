---
name: Vendor Profile 10-Phase Implementation
description: Architecture decisions and gotchas for the full Vendor Profile module (customer-portal).
---

## Key architecture decisions

### Backend additions (portal.ts + index.ts)
- 3 bookmark endpoints: GET/POST/DELETE `/vendors/:vendorId/bookmark` — raw SQL against `vendor_bookmarks` table
- Gallery endpoint: GET `/vendors/:vendorId/gallery` — queries `product_media` WHERE vendor_id = vendorId, LEFT JOINs vendor_catalog_items for item_name
- Contact inquiry: POST `/vendors/:vendorId/contact` — saves to `vendor_contact_inquiries`, sends WA notification (non-fatal)
- Boot migrations for both new tables added to `runCriticalPreStartMigrations()` in index.ts

### Frontend files
- `VendorGallery.tsx` — new component: masonry grid + full lightbox (keyboard nav, touch swipe, zoom, thumbnails)
- `ContactSupplierModal.tsx` — new component: full contact form with country picker, inquiry number on success
- `vendor-profil.tsx` — rewritten with all 10 phases
- `VendorComparison.tsx` — real rating from `/vendors/:vendorId/reviews`, professional PDF export via window.open

### Critical gotcha: Rules of Hooks
All `useMemo` calls must be declared BEFORE any conditional early returns in the component body.
The pattern `if (loadingProfile) return <Skeleton />` followed by `useMemo(...)` causes "change in order of Hooks" runtime error.
Fix: move all useMemo calls above the early return guards, handle null profile with `profile ? compute(profile) : []`.

### Phase-specific notes
- Phase 1: employees/annualExport don't exist in DB → rows simply omitted (not "Belum tersedia")
- Phase 2 Bookmark: optimistic update with rollback on error; shows toast "Login diperlukan" if not authenticated
- Phase 3 Rating: VendorComparison fetches `/vendors/:vendorId/reviews` for each unique vendorId via Promise.all
- Phase 4 Gallery: Uses product_media (catalog item images) — no separate vendor gallery table exists; component returns null if empty
- Phase 6 PDF: window.open with styled HTML + auto-trigger window.print(); popup-blocked warning shown if needed
- Phase 7: featuredCount always shows numeric (was "—" when 0)
- Phase 9 jasa-vendor-detail: useRef pattern for specsRef avoids eslint-disable on useEffect deps

**Why:** spec required all 10 phases without new pages; integrates into existing vendor-profil.tsx page structure.
