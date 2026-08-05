# Threat Model

## Project Overview

BizPortal adalah ERP multi-modul berbasis monorepo TypeScript/Node.js dengan backend Express (`artifacts/api-server`), frontend internal BizPortal (`artifacts/bizportal`), customer portal publik (`artifacts/customer-portal`), dan aplikasi driver (`artifacts/cst-driver`). Data utama disimpan di PostgreSQL via Drizzle, file disimpan di Replit Object Storage/Supabase Storage, dan beberapa alur publik memanggil OpenAI untuk OCR/chat.

Dalam scope produksi, trust boundary terpenting ada pada API `artifacts/api-server/src/app.ts`, karena proses ini melayani route API, sesi BizPortal berbasis cookie, bearer token Supabase untuk portal/mobile, static customer portal, dan static BizPortal. `mockup-sandbox` diperlakukan dev-only dan diabaikan kecuali nanti terbukti production-reachable.

## Assets

- **Sesi pengguna dan kredensial** — cookie `sid`, bearer token Supabase, token kasir POS, dan secret aplikasi seperti `PORTAL_ADMIN_KEY`. Kompromi di sini memungkinkan impersonasi lintas modul.
- **Data operasional ERP** — order logistik, freight shipment, quote, transaksi POS, stok, dashboard revenue, data driver, dan pengaturan bisnis internal.
- **PII pelanggan dan vendor** — nama, email, nomor telepon/WhatsApp, alamat/rute pengiriman, isi email masuk, lampiran dokumen, dan chat AI terkait order.
- **Dokumen dan media** — upload customer, lampiran correspondence/email, media assets, dan objek private/public yang dipakai banyak modul.
- **Kuota dan integrasi eksternal** — OpenAI, WhatsApp/Fonnte, SMTP, OIDC, dan Supabase. Penyalahgunaan endpoint yang memanggil layanan ini dapat menimbulkan biaya atau gangguan operasional.

## Trust Boundaries

- **Browser/mobile → API server** — semua input client tidak tepercaya. API harus mengautentikasi dan mengotorisasi setiap route secara server-side.
- **Sesi BizPortal internal vs customer/mobile auth** — cookie session internal dan bearer Supabase milik customer/mobile tidak boleh saling membuka akses ke surface staff/internal.
- **Public vs authenticated vs admin/staff** — customer portal dan beberapa route AI bersifat publik; surface ERP internal, media manager, korespondensi, WhatsApp ops, dan administrasi harus dibatasi ketat.
- **API server → database/storage** — server memegang akses penuh ke data bisnis dan dokumen; kesalahan authz di layer API langsung berubah menjadi disclosure atau tampering skala besar.
- **API server → layanan pihak ketiga** — OpenAI, Fonnte, SMTP, dan OIDC dipanggil dengan secret server-side; endpoint publik yang memicu integrasi ini harus dibatasi agar tidak bisa dipakai attacker sebagai relay/biaya.
- **Production vs dev-only** — `mockup-sandbox` dan eksperimen lokal diabaikan untuk finding produksi kecuali ada bukti route atau asset-nya ikut tersaji dari `api-server`.

## Scan Anchors

- **Production entry points**: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/routes/auth.ts`.
- **Highest-risk code areas**: `artifacts/api-server/src/middlewares/authMiddleware.ts`, `artifacts/api-server/src/lib/requireAdmin.ts`, `artifacts/api-server/src/lib/supabaseAuth.ts`, `artifacts/api-server/src/routes/trading.ts`, `artifacts/api-server/src/routes/ecommerce.ts`, `artifacts/api-server/src/routes/logistics.ts`, `artifacts/api-server/src/routes/logisticRfq.ts`, `artifacts/api-server/src/routes/logisticOrders.ts`, `artifacts/api-server/src/routes/vendorResponse.ts`, `artifacts/api-server/src/routes/storage.ts`, `artifacts/api-server/src/routes/whatsapp.ts`, `artifacts/api-server/src/routes/webhooks.ts`, `artifacts/api-server/src/routes/aiAgent.ts`, dan route-route lain di `artifacts/api-server/src/routes/` yang memakai `requireClerkUser`, `requireAdmin`, atau auth kustom.
- **Public surfaces**: customer portal root, public tracking/order routes, public RFQ approval routes, public vendor-response routes, public AI chat/upload/order routes, public POS kasir login/register, `/api/ecommerce` surface yang mencampur endpoint publik dan admin, `/api/logistics` shipment API, `/api/whatsapp` ops API, dan `POST /api/webhook/fonnte`.
- **Authenticated/admin surfaces**: BizPortal session routes, customer portal bearer routes, portal admin CMS, ERP data routes, storage/media management, POS admin routes, dan OCR/scan-document.

- **Production entry points**: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/routes/auth.ts`.
- **Highest-risk code areas**: `artifacts/api-server/src/middlewares/authMiddleware.ts`, `artifacts/api-server/src/lib/requireAdmin.ts`, `artifacts/api-server/src/lib/supabaseAuth.ts`, `artifacts/api-server/src/routes/webhooks.ts`, `artifacts/api-server/src/routes/vendorResponse.ts`, dan route-route di `artifacts/api-server/src/routes/` yang memakai `requireClerkUser`, `requireAdmin`, atau auth kustom.
- **Public surfaces**: customer portal root, public tracking/order routes, public vendor-response/vendor-confirm routes, public AI chat/upload routes, public POS kasir login/register, dan webhook `POST /api/webhook/fonnte`.
- **Authenticated/admin surfaces**: BizPortal session routes, customer portal bearer routes, portal admin CMS, ERP data routes, storage/media management, POS admin routes.

- **Usually ignore unless reachability changes**: `mockup-sandbox/`, build output, dan code eksperimen non-mounted.

## Threat Categories

### Spoofing


BizPortal memakai beberapa mekanisme identitas sekaligus: cookie session internal, bearer Supabase untuk portal/mobile, token kasir POS, dan secret header tertentu. Sistem harus memastikan satu trust domain tidak bisa dipakai untuk menyamar sebagai domain lain. Token/bypass header statis tidak boleh menjadi pengganti identitas pengguna pada route admin atau staff, dan bearer token portal/mobile tidak boleh otomatis diperlakukan sebagai identitas staf internal hanya karena tokennya valid. Webhook pihak ketiga seperti Fonnte harus memverifikasi autentisitas origin dan tidak boleh mempercayai `sender` dari body mentah sebagai identitas admin/vendor.
BizPortal memakai beberapa mekanisme identitas sekaligus: cookie session internal, bearer Supabase untuk portal/mobile, token kasir POS, webhook dari pihak ketiga, dan beberapa alur berbasis secret bersama. Sistem harus memastikan satu trust domain tidak bisa dipakai untuk menyamar sebagai domain lain. Token/bypass header statis tidak boleh menjadi pengganti identitas pengguna pada route admin atau staff, dan webhook inbound harus memverifikasi bahwa request benar-benar berasal dari provider yang sah sebelum mempercayai `sender`, `message`, atau URL media.

### Tampering

Banyak route mengubah data bisnis penting: status order, stok, produk, shipment, konten portal, media, korespondensi, dan data driver. Semua operasi tulis harus dibatasi oleh role yang tepat dan tidak boleh mengandalkan validasi frontend atau token yang bisa dipalsukan di client. Router yang melayani surface publik dan staff sekaligus harus memisahkan endpoint publik murni dari endpoint admin/write agar CRUD internal tidak terekspos ke internet.

### Information Disclosure

ERP ini menyimpan PII, data revenue, email masuk, chat AI, dan dokumen operasional. API harus membatasi respons berdasarkan kepemilikan/role, tidak memantulkan data internal ke caller publik, dan tidak membiarkan origin tak tepercaya membaca respons yang dikirim dengan kredensial korban. Route internal seperti dashboard, order management, inbox WhatsApp, storage objek private, dan shipment data tidak boleh bergantung pada hidden menu atau asumsi frontend.
ERP ini menyimpan PII, data revenue, email masuk, chat AI, dokumen operasional, dan data pelacakan pengiriman. API harus membatasi respons berdasarkan kepemilikan/role, tidak memantulkan data internal ke caller publik, dan tidak membiarkan order number atau identifier publik lain berfungsi sebagai satu-satunya syarat untuk membaca detail order, vendor response, atau status driver.

### Denial of Service

Route publik yang memicu OCR/AI, upload file, atau integrasi eksternal harus memiliki pembatasan auth, ukuran, dan/atau laju permintaan yang memadai. Tanpa itu, attacker dapat menghabiskan kuota berbayar atau menurunkan availability layanan. Signed upload URL juga harus dibatasi ukuran, frekuensi, dan pemiliknya; kalau tidak, attacker dapat memakai storage sebagai sink arbitrer untuk menghabiskan biaya. Endpoint webhook yang mendownload URL dari body request memperluas risiko DoS dan SSRF-style fetch bila host, ukuran, dan rate tidak dibatasi.

### Elevation of Privilege

Route staff/admin harus menegakkan otorisasi server-side yang ketat. `requireClerkUser` dan helper sejenis tidak boleh membuka surface internal ke bearer token customer/mobile biasa, secret bootstrap portal tidak boleh menjadi backdoor universal ke route internal, dan route yang memuat ID/order/token harus memverifikasi kepemilikan atau memakai token acak berentropi tinggi sebelum mengembalikan atau memodifikasi data. Workflow RFQ, approval, dan vendor response tidak boleh mengandalkan `orderNumber` atau RFQ number pendek sebagai satu-satunya credential, dan role internal seperti POS/dashboard harus dibatasi server-side sesuai matriks role bisnis, bukan hanya di UI.
