---
name: Vendor Mini Form Order-Based
description: Arsitektur dan keputusan desain sistem vendor mini form dua mode
---

## Rule
System mendukung dua mode form: `rate_collection` (umum) dan `order_based` (terkait order spesifik).

## Tabel baru
- `customer_approvals` — link approval untuk customer (token unique, auto-generate SO number saat approved)
- `vendor_operational_confirmations` — link konfirmasi operasional vendor setelah customer approve

## Kolom baru di `vendor_mini_form_links`
- `mode` (default: rate_collection), `order_id`, `order_number`, `order_item_id`, `item_status`, `phase`, `vendor_name`

## Kolom baru di `vendor_mini_form_submissions`  
- `response_status`, `vendor_price`, `currency`, `eta`, `valid_until`, `attachment_url`, `order_id`, `order_item_id`, `selected_by_admin`, `selected_at`

## Flow order_based
1. Admin buat link → vendor isi form + harga → admin pilih vendor terbaik → admin buat customer approval link → kirim WA ke customer → customer approve/reject → jika approve: SO number auto-generated → admin buat op-confirm link → vendor isi data operasional

## Routes (semua di /api/vendor-form/)
- Public: `/:token` GET/POST, `/customer-approval/:token` GET/POST, `/op-confirm/:token` GET/POST
- Admin: `/admin/links`, `/admin/submissions`, `/admin/customer-approvals`, `/admin/op-confirms`, `/admin/orders`, `/admin/orders/:id/items`, `/admin/links/:id/send-wa`, `/admin/customer-approvals/:id/send-wa`, `/admin/op-confirms/:id/send-wa`, `/admin/submissions/:id/select`

## Public pages (customer-portal)
- `/vendor-mini-form/:token` — upgraded dengan mode order-based + price/ETA fields
- `/customer-approval/:token` — halaman approve/reject penawaran (baru)
- `/op-confirm/:token` — halaman isi data operasional vendor (baru)

**Why:** Mode rate_collection tetap backward-compatible. Mode order_based menambah konteks order tanpa breaking existing data.
