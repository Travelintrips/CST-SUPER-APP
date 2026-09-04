# BizPortal — Panduan Operasional

> Dokumen ini memuat prosedur operasional harian, troubleshooting, dan runbook untuk sistem BizPortal ERP.

---

## 1. Arsitektur Layanan — Static Topology (PROD_MODE)

```
Internet
   │
   ▼
Gateway (port 5000)               ← entry point semua traffic
   ├── /bizportal/*   → BizPortal Vite (port 6800)
   ├── /api/*         → API Server (port 8080)
   ├── /system/global-health → Watchdog Service (port 3001)
   ├── /system/control/*     → Watchdog Service (port 3001)
   └── /*             → Customer Portal (port 23435)

API Server (port 8080)            ← Express 5, Drizzle ORM, PostgreSQL
Watchdog Service (port 3001)      ← health-check, circuit breaker (FIXED PORT)
BizPortal (port 6800)             ← React 19 + Vite (internal dashboard)
Customer Portal (port 23435)      ← publik-facing React app
```

> ⚠️ **STATIC TOPOLOGY**: Port tidak boleh berubah saat runtime. Setiap layanan harus eksklusif menempati port yang ditentukan. Perubahan port hanya via edit konfigurasi dan restart manual.

### Port Reference (Fixed — SYSTEM_MODE=PROD)

| Layanan          | Port  | Env Var         | Keterangan               |
|------------------|-------|-----------------|--------------------------|
| Gateway          | 5000  | `PORT`          | Entry point publik       |
| API Server       | 8080  | `API_PORT`      | Backend Express          |
| BizPortal        | 6800  | `BIZPORTAL_PORT`| Internal dashboard       |
| Watchdog Service | 3001  | `WATCHDOG_PORT` | Control plane (FIXED)    |
| Customer Portal  | 23435 | `CUSTOMER_PORT` | Portal publik            |

**Port tidak boleh di-shift otomatis.** Jika EADDRINUSE → cari & kill proses pemilik port, baru restart layanan.

---

## 2. Cara Menjalankan

### Development (Replit)

Klik **Run** di Replit. Ini memulai 4 workflow utama:

| Workflow         | Perintah                                           |
|------------------|----------------------------------------------------|
| Gateway          | `BIZPORTAL_PORT=6800 PORT=5000 WATCHDOG_PORT=3001 node gateway.mjs` |
| API Server       | `cd artifacts/api-server && bash ./start-dev.sh`  |
| Watchdog Service | `WATCHDOG_PORT=3001 ... node system-watchdog-service.mjs`           |
| BizPortal        | `pnpm --filter @workspace/bizportal run dev`       |

### Memeriksa Status Sistem

```bash
# Health API server
curl http://localhost:8080/api/healthz

# Health Watchdog (semua layanan)
curl http://localhost:5000/system/global-health | jq .

# Circuit breaker state
curl http://localhost:5000/system/global-health | jq '.services | to_entries[] | {id:.key, cb:.value.circuit_breaker}'
```

### Melihat Logs

```bash
# Terbaru API Server
tail -f /tmp/logs/API_Server_*.log

# Watchdog
tail -f /tmp/logs/Watchdog_Service_*.log

# Gateway
tail -f /tmp/logs/Gateway_*.log
```

---

## 3. Prosedur Restart

### Restart normal (satu layanan)

Gunakan Replit workflow panel → klik **Restart** pada workflow yang diinginkan.

### Restart darurat (semua layanan)

```bash
# Hapus circuit-breaker cache watchdog
rm -f /tmp/db-startup-cb.json

# Restart melalui Replit UI (klik Stop lalu Run)
```

### Restart API Server setelah schema change

```bash
pnpm --filter @workspace/api-client-react run codegen
# Lalu restart workflow "API Server" dari Replit UI
```

---

## 4. Watchdog Service — Circuit Breaker

Watchdog memantau setiap layanan dengan probe HTTP setiap 7 detik.

### State Circuit Breaker

| State     | Arti                                  | Tindakan                    |
|-----------|---------------------------------------|-----------------------------|
| `CLOSED`  | Normal — request diteruskan           | Tidak ada                   |
| `OPEN`    | Terlalu banyak kegagalan — CB terbuka | Tunggu cooldown (45 detik)  |
| `HALF_OPEN` | Dalam periode recovery             | 1 percobaan probe; jika sukses → CLOSED |

### Reset Circuit Breaker Manual

```bash
# Reset satu layanan
curl -X POST http://localhost:5000/system/control/close-circuit \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"api-server"}'

# Lihat semua CB state
curl http://localhost:5000/system/control/state | jq .

# Lihat registry semua service
curl http://localhost:5000/system/control/registry | jq .
```

### Simulasi Kegagalan (dev/testing)

```bash
# Simulasikan kegagalan api-server
SYSTEM_SIMULATE_FAILURE=api-server node system-watchdog-service.mjs

# Multi-service
SYSTEM_SIMULATE_FAILURE=api-server,bizportal node system-watchdog-service.mjs
```

---

## 5. Database

### Jalankan Migrasi

```bash
# Generate schema baru dari perubahan Drizzle
drizzle-kit generate

# Push ke database (DEV — skip interactive prompts)
node scripts/apply-migrations.mjs

# Push langsung (hati-hati: bisa meminta konfirmasi rename)
drizzle-kit push
```

### Koneksi DB

Database URL diprioritaskan:
1. `DATABASE_URL` (Replit native PostgreSQL)
2. `SUPABASE_DATABASE_URL` (Supabase dengan pgBouncer)
3. `SUPABASE_DATABASE_URL_DEV` (fallback)

### DB Circuit Breaker

File: `/tmp/db-startup-cb.json`

Jika DB tidak dapat dihubungi saat startup, CB ini mencegah flood koneksi. Hapus file ini jika koneksi DB sudah kembali normal:

```bash
rm -f /tmp/db-startup-cb.json
# Kemudian restart API Server
```

---

## 6. Troubleshooting

### API Server gagal start (EADDRINUSE port 8080)

Penyebab: artifact workflow `artifacts/api-server: API Server` dan root workflow `API Server` keduanya berjalan.

Solusi: Hanya satu instansi yang boleh berjalan di port 8080. Jika kedua workflow aktif, matikan yang artifact (`artifacts/api-server: API Server`) — root workflow adalah yang dipakai untuk development. Jika port 8080 conflict: `node artifacts/api-server/kill-port.mjs 8080` lalu restart root `API Server`.

### Watchdog Service "failed" di Replit UI (port 3001 conflict)

Penyebab: proses lain masih memegang port 3001 (misal: sisa watchdog lama).

Diagnosis:
```bash
# Temukan PID yang pegang port 3001
node artifacts/api-server/kill-port.mjs 3001
# Lalu restart Watchdog Service dari Replit workflow panel
```

Verifikasi setelah restart:
```bash
curl http://localhost:3001/health   # harus 200 OK
curl http://localhost:5000/system/global-health | jq .overall_status
```

> Watchdog **tidak lagi** melakukan auto port-shift. Jika port 3001 tidak tersedia, watchdog akan FAIL (exit 1) dengan pesan error yang jelas.

### BizPortal tidak bisa diakses

```bash
# Cek port BizPortal
curl http://localhost:18442/
curl http://localhost:6800/

# Restart BizPortal dari Replit workflow panel
```

### Notifikasi WhatsApp tidak terkirim

```bash
# Cek environment variable
echo $FONNTE_TOKEN
echo $FONNTE_ADMIN_WA

# Cek log
grep -i "fonnte\|whatsapp" /tmp/logs/API_Server_*.log | tail -20
```

### Email tidak terkirim

```bash
# Cek SMTP config
echo $SMTP_HOST $SMTP_USER

# Cek log
grep -i "smtp\|mailer\|nodemailer" /tmp/logs/API_Server_*.log | tail -20
```

---

## 7. Environment Variables

| Variable         | Keterangan                            | Required |
|------------------|---------------------------------------|----------|
| `FONNTE_TOKEN`   | Token Fonnte untuk WhatsApp           | ✓        |
| `FONNTE_ADMIN_WA`| Group ID WhatsApp admin fallback      | ✓        |
| `ADMIN_EMAIL`    | Email admin untuk notifikasi          | ✓        |
| `PORTAL_ADMIN_KEY`| Kunci akses CMS customer portal      | ✓        |
| `SMTP_HOST`      | Host SMTP untuk email                 | ✗        |
| `SMTP_USER`      | User SMTP                             | ✗        |
| `SMTP_PASS`      | Password SMTP                         | ✗        |
| `DATABASE_URL`   | PostgreSQL connection string          | ✓        |
| `API_PORT`       | Port API server (default: 8080)       | ✗        |
| `WATCHDOG_PORT`  | Port Watchdog (default: 3002)         | ✗        |

---

## 8. Monitoring Dashboard

Buka BizPortal → **Settings → Status Sistem** (atau `/bizportal/system-health`).

Dashboard menampilkan:
- Health score (0–100) dari Watchdog Service
- Status dan latensi per layanan
- Circuit breaker state (CLOSED / OPEN / HALF_OPEN)
- Cascade risks (dependensi antar layanan)
- Event log terbaru
- Status dependensi eksternal (DB, WhatsApp, SMTP)

---

## 9. Backup & Recovery

### Database Backup

Backup otomatis berjalan setiap hari pukul 02:00 WIB (19:00 UTC). Backup disimpan di Supabase Storage pada bucket private-uploads.

```bash
# Log backup scheduler
grep -i "backup" /tmp/logs/API_Server_*.log | tail -10
```

### Recovery dari Backup

Saat ini recovery manual via Supabase dashboard atau `psql`. Tidak ada prosedur otomatis.

---

## 10. Keamanan

- Semua route admin dilindungi `requireAdmin` middleware (session-based)
- Customer portal admin dilindungi `PORTAL_ADMIN_KEY`
- JWT / cookie session diekspirasi setelah 24 jam
- Rate limiting aktif pada route publik (`/api/portal/*`, `/api/ai/*`)
- File upload dibatasi ukuran dan tipe sebelum disimpan ke Supabase Storage

Lihat `threat_model.md` untuk model ancaman lengkap.

---

*Dokumen ini terakhir diperbarui: 19 Juni 2026*
