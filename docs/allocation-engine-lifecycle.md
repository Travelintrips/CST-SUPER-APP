# Allocation Engine — Lifecycle & State Machine

## State Diagram

```
                    ┌─────────────────────┐
                    │        draft         │ ◄── reject
                    └──────────┬──────────┘
                               │ submit (validate balance)
                    ┌──────────▼──────────┐
                    │      submitted      │
                    └──────────┬──────────┘
                               │ approve
                    ┌──────────▼──────────┐
                    │      approved       │
                    └──────────┬──────────┘
                               │ post (create journal)
                    ┌──────────▼──────────┐
                    │       posted        │
                    └──────┬──────┬───────┘
                           │      │
               close (manual)  reverse
                    ┌──────▼─┐  ┌▼──────────┐
                    │ closed │  │ reversed  │
                    └────────┘  └───────────┘
```

## Transisi yang Diizinkan

| Dari       | Ke         | Endpoint              | Syarat                          |
|------------|------------|-----------------------|---------------------------------|
| draft      | submitted  | POST /:id/submit      | Σ lines = received_amount       |
| submitted  | approved   | POST /:id/approve     | —                               |
| submitted  | draft      | POST /:id/reject      | —                               |
| approved   | draft      | POST /:id/reject      | —                               |
| approved   | posted     | POST /:id/post        | bank_account_id ada, belum post |
| posted     | reversed   | POST /:id/reverse     | journal_entry_id ada            |

## Aturan Edit

- Hanya status **draft** yang dapat diedit (PATCH /:id)
- Setelah submit: readonly kecuali reject dulu

## Idempotency

- `allocation_no` unique per company per bulan
- `journal_entry_id` unique: cegah double-posting
- Semua audit action dicatat di `allocation_audit_logs`
