# AI COA Governance — Task #7

## Prinsip Utama

AI COA Proposal Engine **tidak pernah** membuat atau mengaktifkan COA secara otomatis.

Setiap aksi yang dilakukan AI bersifat **proposal/rekomendasi** — membutuhkan:
- Maker (pembuat proposal)
- Checker (approver, bukan maker)
- Audit trail
- Company isolation

## Batasan AI (Hard Rules)

| Larangan | Alasan |
|---|---|
| Langsung buat COA | Harus melalui Task #5 change request |
| Langsung aktifkan COA | Harus approved oleh checker |
| Ubah journal mapping | Harus melalui approval |
| Auto-apply rule | Rule recommendation butuh human approval |
| Post jurnal | Hanya dari flow transaksi normal |
| Rekonsiliasi otomatis | Hanya dari user action |
| Ubah data historis | Dilarang mutlak |

## Flow Governance

```
1. Transaksi gagal jurnal (Task #6: manual_review_required = true)
   ↓
2. User klik "Buat Proposal COA" (explicit user action)
   ↓
3. AI: detectCoaGap() → generateCoaProposalRecommendation()
   ↓
4. Simpan sebagai DRAFT (coa_proposals)
   ↓
5. Maker: Edit → Submit
   ↓
6. Checker (≠ Maker): Approve / Reject
   ↓
7. Setelah APPROVED: implementApprovedCoaProposal()
   ↓
8. Task #5 COA change request dibuat (masih butuh approval tersendiri)
   ↓
9. COA master menjadi ACTIVE setelah Task #5 checker approve
```

## Status Transitions

```
DRAFT → PENDING_REVIEW (submit)
PENDING_REVIEW → APPROVED (checker approve)
PENDING_REVIEW → REJECTED (checker reject)
DRAFT/PENDING_REVIEW → CANCELLED
APPROVED → IMPLEMENTED (implement → Task #5 change request)
```

## Error Codes yang Memicu Proposal

| Error Code | Deskripsi |
|---|---|
| `SPECIFIC_COA_REQUIRED` | COA spesifik belum tersedia |
| `JOURNAL_MAPPING_REQUIRED` | Mapping jurnal belum dikonfigurasi |
| `COA_NOT_FOUND` | COA tidak ditemukan |
| `COA_MAPPING_AMBIGUOUS` | Mapping ambigu (multiple candidates) |

## Permissions

| Permission | Aksi |
|---|---|
| `coa.proposal.view` | Lihat daftar dan detail |
| `coa.proposal.create` | Buat proposal baru |
| `coa.proposal.edit` | Edit draft |
| `coa.proposal.submit` | Submit untuk review |
| `coa.proposal.approve` | Approve (bukan maker) |
| `coa.proposal.reject` | Reject |
| `coa.proposal.cancel` | Batalkan |
| `coa.proposal.implement` | Implement (trigger Task #5) |

## Security Rules

- `companyId` selalu dari session — body `companyId` mismatch ditolak
- Maker tidak bisa approve proposal sendiri (COA_PROPOSAL_SELF_APPROVAL_FORBIDDEN)
- Cross-company parent ditolak pada validation
- No SQL/stack leak di error response
- Audit log tidak dapat dihapus via API
- Version history append-only
