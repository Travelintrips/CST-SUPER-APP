---
name: Publish Repl-layer timeout
description: Cara membedakan kegagalan build aplikasi dari timeout platform saat Replit membuat layer container.
---

## Rule
Jika publish berstatus gagal tetapi semua build dan prerender lulus, log berakhir setelah `Created pid1 binary layer`, dan tidak ada runtime log, perlakukan ini sebagai kegagalan pembuatan Repl layer—bukan error kompilasi atau startup aplikasi.

**Why:** Pada project ini, build gagal berulang berhenti sekitar 130 detik setelah pid1 layer tanpa pesan error. Build sukses dengan source yang sama melewati jeda serupa, lalu mencatat `Created Repl layer`, image manifest, service Autoscale, dan deployment successful.

**How to apply:** Bandingkan penutup log dengan satu build sukses, pastikan build lokal penuh lulus dan ukuran source tracked wajar, lalu retry publish. Jika kegagalan identik terus berulang, bawa build ID dan timestamp ke Replit Support karena tidak ada error aplikasi yang dapat diperbaiki di workspace.