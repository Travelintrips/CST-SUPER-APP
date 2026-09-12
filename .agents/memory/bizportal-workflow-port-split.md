---
name: BizPortal workflow port split
description: BizPortal artifact workflow and unified Gateway use different proxy ports and must not be collapsed into one binding.
---

BizPortal standalone artifact workflow menerima port artifact (saat ini 18442) dan meneruskan ke Vite internal 18443, sedangkan unified Gateway memakai proxy BizPortal pada port 6800.

**Why:** Artifact workflow yang masih menunggu port lama dapat dilaporkan gagal dan membuat preview terlihat loading walaupun Gateway pada port 5000 dan BizPortal pada port 6800 sehat.

**How to apply:** Pertahankan `start-dev.sh` agar `BIZPORTAL_PORT` atau `PORT` menentukan port proxy artifact, dan gunakan `6800` hanya sebagai default jalur unified Gateway. Jangan menghentikan API Server saat memperbaiki konflik ini.