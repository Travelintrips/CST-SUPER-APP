# Supabase Cleanup Phase 1 — Execution Plan

**Dibuat**: 2026-06-22  
**Diupdate**: 2026-06-23 v2 (post-validation: hapus fleet_outstanding_import_log → KEEP, hapus shipments → HIGH risk)  
**Status**: DRAFT — belum dieksekusi  
**Strategi**: RENAME ke `zz_deleted_*` (bukan DROP). Rollback tersedia.

---

## 1. Tabel yang Akan Di-rename (53 tabel)

### 1a. SAFE — rows=0, tidak ada referensi aktif (47 tabel)

| # | Tabel | Rows | FK↑ | Alasan |
|---|-------|------|-----|--------|
| 1 | ai_tasks | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 2 | attendance_records | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 3 | bank_account_balances | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 4 | bank_closing_periods | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 5 | bank_coa_rules | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 6 | bank_recon_audit_logs | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 7 | banners | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 8 | blast_session_logs | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 9 | cashier_shifts | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 10 | cms_blocks | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 11 | cms_media | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 12 | cms_pages | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 13 | cms_settings | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 14 | company_settings | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 15 | customer_contexts | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 16 | data_template_fields | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 17 | data_templates | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 18 | dispatcher_logs | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 19 | document_audits | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 20 | document_template_fields | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 21 | document_templates | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 22 | draft_agreements_wa_log | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 23 | follow_up_logs | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 24 | gym_memberships | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 25 | intent_master | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 26 | keyword_rules | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 27 | leave_requests | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 28 | operational_checklists | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 29 | operational_expenses | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 30 | otp_tokens | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 31 | page_products | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 32 | promo_registrations | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 33 | public_tokens | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 34 | registration_link_wa_log | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 35 | service_catalog | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 36 | service_circuit_states | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 37 | service_registry | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 38 | shipment_events | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 39 | shipment_trackings | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 40 | task_assignments | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 41 | task_attachments | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 42 | task_comments | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 43 | task_timeline | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 44 | team_members | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 45 | user_site_access | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 46 | whatsapp_messages | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |
| 47 | whatsapp_notifications | 0 | 0 | Kosong, tidak ada FK, tidak ditemukan di kode |

### 1b. LOW — rows=0, tidak ada referensi aktif (6 tabel)

| # | Tabel | Rows | FK↑ | Alasan |
|---|-------|------|-----|--------|
| 48 | sc_admin_notes | 0 | 0 | Kosong, LOW risk, tidak ada FK masuk |
| 49 | sc_blocked_schedules | 0 | 0 | Kosong, LOW risk, tidak ada FK masuk |
| 50 | sc_facility_images | 0 | 0 | Kosong, LOW risk, tidak ada FK masuk |
| 51 | sc_promos | 0 | 0 | Kosong, LOW risk, tidak ada FK masuk |
| 52 | sc_settings | 0 | 0 | Kosong, LOW risk, tidak ada FK masuk |
| 53 | sport_center_expenses | 0 | 0 | Kosong, LOW risk, tidak ada FK masuk |

---

## 2. Tabel Dikecualikan — Berisi Data (backup via script)

| Tabel | Rows | Alasan Dikecualikan |
|-------|------|---------------------|
| employees | 15 | Berisi data — backup dulu |
| employee_kasbon | 1 | Berisi data — backup dulu |
| order_asuransi | 19 | Berisi data — backup dulu |
| payment_receipts | 11 | Berisi data — backup dulu |
| finance_payment_events | 11 | Berisi data — backup dulu |
| wa_send_logs | 12 | Berisi data — backup dulu |
| system_settings | 1 | Berisi data — backup dulu |

---

## 3. Tabel BLOCKED — Masih Ada Referensi Aktif

| Tabel | Risk | Alasan Diblokir |
|-------|------|-----------------|
| sc_payments | HIGH | Masih ada referensi di API layer |
| sport_center_memberships | HIGH | Masih ada referensi di API layer |
| transaction_datetime_normalized | HIGH | Masih ada referensi di API layer |
| workflow_events | HIGH | Masih ada referensi di API layer |
| sport_center_bookings | MEDIUM | modules/sport-center/migration.ts membaca dari tabel ini |
| sport_center_facilities | MEDIUM | routes.ts L4716: query aktif ke Supabase |
| shipment_stages | MEDIUM | lib/db/src/schema/shipmentStages.ts: masih dalam schema |

---

## 4. Tabel KEEP — FK Aktif / Inline Migration

| Tabel | Alasan |
|-------|--------|
| fleet_partners | CRITICAL — fleetIntelligence.ts: CREATE TABLE IF NOT EXISTS inline migration |
| fleet_vehicles | CRITICAL — fleetIntelligence.ts: CREATE TABLE IF NOT EXISTS inline migration |
| fleet_ledger_entries | HIGH — views aktif: v_ledger_balance_view, v_ledger_journal_view; triggers aktif |
| fleet_reports | KEEP — masih ada FK aktif |
| fleet_drivers | KEEP — masih ada FK aktif |

---

## 5. Command Eksekusi

### Prasyarat
```bash
# 1. Backup tabel LOW yang berisi data
node scripts/backup-low-risk-tables.mjs

# 2. Verifikasi backup berhasil
ls backups/supabase-cleanup/$(date +%Y-%m-%d)/
```

### Eksekusi Migration
```bash
# Jalankan di maintenance window
psql "$SUPABASE_DATABASE_URL" -f migrations/archive-phase-1-safe-only.sql
```

### Verifikasi Setelah Eksekusi
```bash
# Cek tabel yang berhasil direname
psql "$SUPABASE_DATABASE_URL" -c "
SELECT tablename FROM pg_tables
WHERE schemaname='public' AND tablename LIKE 'zz_deleted_%'
ORDER BY tablename;
"

# Monitor aplikasi 7 hari — pastikan tidak ada error baru
```

---

## 6. Command Rollback

```bash
# Jika ada error setelah rename, jalankan rollback
psql "$SUPABASE_DATABASE_URL" -f migrations/archive-phase-1-safe-only-rollback.sql
```

---

## 7. Checklist Sebelum Eksekusi

- [ ] `pg_dump` production sudah disimpan
- [ ] `node scripts/backup-low-risk-tables.mjs` sudah dijalankan dan sukses
- [ ] Tidak ada traffic aktif ke tabel-tabel ini
- [ ] Maintenance window sudah dikomunikasikan ke tim
- [ ] Rollback script sudah diverifikasi bisa berjalan
- [ ] Monitor alert/error setelah eksekusi selama 7 hari

---

## 8. Setelah Phase 1 Berhasil

Setelah 7 hari monitoring tanpa error:
- Lanjut ke **Phase 2**: DROP `zz_deleted_*` tables
- Tabel BLOCKED dan KEEP: investigasi lanjut per kasus
