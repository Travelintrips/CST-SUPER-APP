---
name: Google credential separation
description: Service Account Google Sheets dan bootstrap Secret Manager dapat berupa akun berbeda dan membutuhkan izin berbeda.
---

Credential Service Account yang valid untuk Google Sheets belum tentu dapat dipakai sebagai bootstrap Secret Manager. Uji `secretmanager.versions.access` harus berhasil sebelum akun dipasang sebagai bootstrap.

**Why:** Akun Sheets yang tidak memiliki `roles/secretmanager.secretAccessor` membuat API gagal startup walaupun JSON dan private key valid.

**How to apply:** Simpan credential Sheets di `GOOGLE_SERVICE_ACCOUNT_JSON`; gunakan credential terpisah dengan akses Secret Manager untuk `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`, kecuali IAM akun Sheets memang diberi akses Secret Manager.