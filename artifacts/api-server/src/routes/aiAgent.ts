import express, { Router, Request, Response } from "express";
import type OpenAI from "openai";
import { getOpenAI } from "../lib/openaiClient.js";
import { db } from "@workspace/db";
import {
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiAgentSettingsTable,
  chatbotKnowledgeBaseTable,
  logisticOrdersTable,
  productsTable,
  ordersTable,
  portalProductOrdersTable,
  portalProductOrderItemsTable,
  vendorCatalogItemsTable,
  suppliersTable,
} from "@workspace/db";
import { eq, asc, or, inArray, sql, and, gt, ilike, ne, gte, isNull, desc } from "drizzle-orm";
import { catalogPublicConditions, catalogSupplierConditions } from "../lib/catalogVisibility.js";
import { searchMarketplace } from "../services/marketplaceSearch/index.js";
import { randomBytes } from "crypto";
import { createRequire } from "node:module";
import multer from "multer";
import { sendLogisticOrderNotification } from "../lib/orderNotification";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminWa } from "../lib/adminWa.js";
import { requireAdmin } from "../lib/requireAdmin";
import { logger } from "../lib/logger";

const _require = createRequire(import.meta.url);
type PdfParseFn = (buf: Buffer) => Promise<{ text: string; numpages: number }>;
const pdfParse = _require("pdf-parse/lib/pdf-parse.js") as PdfParseFn;

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});


export const aiAgentRouter = Router();

const DEFAULT_SYSTEM_PROMPT = `Kamu adalah asisten virtual dari B2B Marketplace and Logistic — perusahaan jasa pengiriman, kepabeanan, dan penjualan produk terkemuka di Indonesia.

Tugasmu:
1. Menyapa pelanggan dengan ramah dan memperkenalkan layanan B2B Marketplace and Logistic
2. Menjawab pertanyaan seputar layanan logistik (sea freight, air freight, trucking, customs/pabean) maupun produk yang tersedia
3. MEMBUAT ORDER LOGISTIK: Ketika pelanggan ingin membuat order atau booking pengiriman — LANGSUNG panggil show_order_form. JANGAN tanya satu per satu. Form akan tampil di chat.
4. CEK STATUS: Ketika pelanggan bertanya status/tracking/posisi paket — LANGSUNG panggil get_order_status.
5. CARI PRODUK: Ketika pelanggan menanyakan produk, stok, atau harga produk — panggil search_products terlebih dahulu, lalu tampilkan hasilnya.
6. PESAN PRODUK: Ketika pelanggan ingin memesan produk — panggil search_products dulu untuk cari produk, lalu LANGSUNG panggil show_product_order_form. Form akan tampil di chat. JANGAN tanya satu per satu.

Aturan:
- Gunakan Bahasa Indonesia yang sopan dan singkat
- WAJIB show_order_form: kata kunci "mau kirim", "booking", "order pengiriman", "pesan kirim", menyebut nama layanan + niat kirim
- WAJIB get_order_status: kata kunci "status", "cek order", "tracking", "mana paket", "sudah sampai", "posisi"
- WAJIB search_products LALU show_product_order_form: kata kunci "pesan produk", "beli", "mau beli", "mau pesan", nama produk spesifik + niat beli/pesan
- WAJIB search_products (tanpa show_product_order_form): kata kunci "cari produk", "ada produk", "jual apa", "harga produk", hanya bertanya tentang produk
- show_product_order_form: panggil SEGERA setelah search_products menemukan produk yang pelanggan inginkan — ISI productId, productName, unitPrice, unit dari hasil search. ABAIKAN nilai stock — meskipun stock=0, tetap tampilkan form karena admin akan konfirmasi ketersediaan.
- Jika search_products tidak menemukan produk sama sekali (found: false): baru beritahu pelanggan bahwa produk tidak tersedia
- JANGAN katakan produk tidak tersedia hanya karena stock=0 — selalu tampilkan form
- TOLAK SOPAN pertanyaan di luar layanan B2B Marketplace and Logistic
- LARANGAN KERAS: JANGAN panggil create_logistic_order atau show_order_form ketika pelanggan sedang memesan PRODUK (via show_product_order_form atau create_product_order). Order produk dan order pengiriman adalah dua hal berbeda. Hanya buat logistic order jika pelanggan secara eksplisit meminta layanan pengiriman/freight/trucking/customs.
- JANGAN berasumsi pelanggan butuh layanan pengiriman hanya karena mereka membeli produk. Pelanggan yang membeli produk TIDAK otomatis perlu logistic order.

Layanan yang tersedia:
- Sea Freight (Laut): FCL dan LCL, domestik & internasional
- Air Freight (Udara): pengiriman cepat via udara
- Trucking (Darat): CDE, CDD, Fuso, Wingbox, Trailer
- Customs/Pabean: PIB, PEB, dokumen kepabeanan
- Packing & Crating: pengemasan profesional
- Penjualan Produk: tersedia berbagai produk, cek stok & harga via pencarian

Harga layanan logistik dikonfirmasi tim setelah order masuk. Harga produk sesuai katalog.`;

/** Load the active system prompt from DB, fall back to the hardcoded default, then inject KB entries */
async function getSystemPrompt(): Promise<string> {
  try {
    const [settingRow] = await db
      .select()
      .from(aiAgentSettingsTable)
      .where(eq(aiAgentSettingsTable.key, "system_prompt"));
    const base = settingRow?.value ?? DEFAULT_SYSTEM_PROMPT;

    // Inject active knowledge base entries
    let kbEntries: Array<{ title: string; category: string; content: string }> = [];
    try {
      kbEntries = await db
        .select({ title: chatbotKnowledgeBaseTable.title, category: chatbotKnowledgeBaseTable.category, content: chatbotKnowledgeBaseTable.content })
        .from(chatbotKnowledgeBaseTable)
        .where(eq(chatbotKnowledgeBaseTable.isActive, true))
        .orderBy(asc(chatbotKnowledgeBaseTable.sortOrder), asc(chatbotKnowledgeBaseTable.id));
    } catch {
      // Table may not exist yet — silently skip
    }

    if (kbEntries.length === 0) return base;

    const kbSection = kbEntries
      .map((e) => `### ${e.title} [${e.category}]\n${e.content}`)
      .join("\n\n");

    return `${base}\n\n---\n## KNOWLEDGE BASE — Gunakan informasi ini saat menjawab pertanyaan pelanggan:\n\n${kbSection}`;
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_available_services",
      description: "Dapatkan daftar layanan dan jenis pengiriman yang tersedia di B2B Marketplace and Logistic",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_status",
      description: "Cek status order logistik pelanggan. Mencari berdasarkan sesi chat ini saja.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_order_form",
      description: "Tampilkan form order cepat langsung di chat widget. WAJIB dipanggil saat pelanggan ingin membuat order, booking, atau pengiriman — SEBAGAI PENGGANTI tanya jawab satu per satu.",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Jenis layanan yang sudah diketahui ('Trucking', 'Sea Freight', 'Air Freight', 'Customs'). Kosongkan jika belum tahu.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_marketplace_categories",
      description: "Dapatkan daftar kategori produk aktif di marketplace beserta jumlah produk per kategori. Gunakan saat pelanggan bertanya tentang apa saja yang dijual, kategori produk, atau ingin overview marketplace.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Cari produk marketplace aktif. Mendukung Bahasa Indonesia dan Inggris, sinonim komoditas, typo ringan, dan kategori. Gunakan saat pelanggan bertanya tentang produk, stok, harga, atau HS Code.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Kata kunci pencarian dalam Bahasa Indonesia atau Inggris (nama produk, kategori, sinonim, atau HS Code)",
          },
          limit: {
            type: "number",
            description: "Jumlah produk yang dikembalikan (1–5). Default: 5.",
          },
          includeSuggestions: {
            type: "boolean",
            description: "Sertakan saran kategori jika produk tidak ditemukan. Default: false.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_product_order_form",
      description: "Tampilkan form pemesanan produk langsung di chat widget. WAJIB dipanggil segera setelah search_products menemukan produk yang diminati pelanggan — JANGAN tanya satu per satu.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "number", description: "ID produk dari hasil search_products" },
          productName: { type: "string", description: "Nama produk" },
          unitPrice: { type: "number", description: "Harga satuan produk" },
          unit: { type: "string", description: "Satuan produk (pcs, kg, dll)" },
        },
        required: ["productId", "productName", "unitPrice", "unit"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_product_order",
      description: "Buat order pembelian produk setelah pelanggan konfirmasi produk, qty, dan data diri. Hanya panggil setelah mendapat konfirmasi eksplisit dari pelanggan.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string", description: "Nama lengkap pelanggan" },
          customerEmail: { type: "string", description: "Email pelanggan" },
          customerPhone: { type: "string", description: "Nomor WhatsApp pelanggan (opsional)" },
          items: {
            type: "array",
            description: "Daftar produk yang dipesan",
            items: {
              type: "object",
              properties: {
                productId: { type: "number", description: "ID produk dari hasil search_products" },
                name: { type: "string", description: "Nama produk" },
                qty: { type: "number", description: "Jumlah yang dipesan" },
                unitPrice: { type: "number", description: "Harga satuan produk" },
              },
              required: ["productId", "name", "qty", "unitPrice"],
            },
          },
        },
        required: ["customerName", "customerEmail", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_logistic_order",
      description: "Buat order logistik baru setelah pelanggan konfirmasi semua detail pengiriman",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string", description: "Nama lengkap pelanggan" },
          phone: { type: "string", description: "Nomor WhatsApp pelanggan" },
          email: { type: "string", description: "Email pelanggan (opsional)" },
          companyName: { type: "string", description: "Nama perusahaan (pakai '-' jika individu)" },
          shipmentType: {
            type: "string",
            enum: ["Sea Freight", "Air Freight", "Trucking", "FOB"],
            description: "Jenis pengiriman",
          },
          origin: { type: "string", description: "Kota/pelabuhan asal" },
          destination: { type: "string", description: "Kota/pelabuhan tujuan" },
          commodity: { type: "string", description: "Jenis/kategori barang" },
          cargoDescription: { type: "string", description: "Deskripsi barang lebih detail (opsional)" },
          grossWeight: { type: "number", description: "Berat perkiraan dalam kg (opsional)" },
          volumeCbm: { type: "number", description: "Volume dalam CBM (opsional)" },
          requiredDate: { type: "string", description: "Tanggal pengiriman yang diinginkan (YYYY-MM-DD atau teks bebas)" },
          notes: { type: "string", description: "Catatan tambahan (opsional)" },
        },
        required: ["customerName", "phone", "companyName", "shipmentType", "origin", "destination"],
      },
    },
  },
];

function generateOrderNumber(): string {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `LOG-${y}${m}${d}-${rand}`;
}

function generateSessionToken(): string {
  return randomBytes(20).toString("hex");
}

// ── Rate-limit stores (in-memory, reset on server restart) ────────────────────
// These are a cost-throttle layer on top of session validation: even though
// session tokens are freely obtainable via the public chat endpoint, limits
// per IP and per session make bulk wallet-drain attacks economically impractical.

interface RateEntry { count: number; resetAt: number }

// Upload limits
const UPLOAD_IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const UPLOAD_IP_LIMIT = 20; // max uploads per IP per hour
const UPLOAD_SESSION_LIMIT = 10; // max uploads per session lifetime
const uploadIpRateMap = new Map<string, RateEntry>();
const uploadSessionCountMap = new Map<string, number>();

// Chat limits — prevents sustained OpenAI quota drain from anonymous callers
const CHAT_IP_WINDOW_MS = 10 * 60 * 1000; // 10-minute rolling window
const CHAT_IP_LIMIT = 30; // max 30 chat requests per IP per window
const chatIpRateMap = new Map<string, RateEntry>();

// Order limits — prevents notification spam (WhatsApp/email) from anonymous callers
const ORDER_IP_WINDOW_MS = 60 * 60 * 1000; // 1-hour rolling window
const ORDER_IP_LIMIT = 5; // max 5 orders per IP per hour
const orderIpRateMap = new Map<string, RateEntry>();

/**
 * Generic IP-based rate-limit check.
 * Returns null when allowed (and increments the counter), or an error string to
 * return as HTTP 429.
 */
function checkIpRateLimit(
  ip: string,
  map: Map<string, RateEntry>,
  windowMs: number,
  limit: number,
  retryLabel: string,
): string | null {
  const now = Date.now();
  let entry = map.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  if (entry.count >= limit) {
    return `Terlalu banyak permintaan dari jaringan ini. Coba lagi dalam ${retryLabel}.`;
  }
  entry.count += 1;
  map.set(ip, entry);
  return null;
}

/**
 * Enforces per-IP and per-session upload rate limits.
 * Returns null when the request is allowed, or an error message string when
 * it should be rejected with HTTP 429.
 * Side-effect: increments both counters when the request is allowed.
 */
function checkUploadRateLimit(ip: string, sessionToken: string): string | null {
  // Per-session lifetime check runs first so that a session that has hit its
  // personal cap does not consume shared IP quota on every rejected attempt.
  const sessionCount = uploadSessionCountMap.get(sessionToken) ?? 0;
  if (sessionCount >= UPLOAD_SESSION_LIMIT) {
    return "Batas upload untuk sesi percakapan ini telah tercapai. Mulai sesi baru untuk melanjutkan.";
  }

  // Per-IP window check
  const ipError = checkIpRateLimit(ip, uploadIpRateMap, UPLOAD_IP_WINDOW_MS, UPLOAD_IP_LIMIT, "1 jam");
  if (ipError) return "Terlalu banyak upload dari jaringan ini. Coba lagi dalam 1 jam.";

  // Both checks passed — commit the session increment
  uploadSessionCountMap.set(sessionToken, sessionCount + 1);
  return null;
}

async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  sessionToken: string,
  sessionId: number,
): Promise<string> {
  if (toolName === "get_available_services") {
    return JSON.stringify({
      services: [
        { type: "Sea Freight", description: "FCL & LCL, rute domestik & internasional via kapal", etaDomestic: "3-7 hari", etaInternational: "14-45 hari" },
        { type: "Air Freight", description: "Pengiriman cepat via udara", etaDomestic: "1-2 hari", etaInternational: "3-7 hari" },
        { type: "Trucking", description: "CDE, CDD, Fuso, Wingbox, Trailer untuk pengiriman darat", etaDomestic: "1-5 hari" },
        { type: "FOB", description: "Free On Board — penjual bertanggung jawab hingga barang naik ke kapal di pelabuhan asal", etaInternational: "Sesuai jadwal kapal" },
        { type: "Customs/Pabean", description: "Layanan kepabeanan PIB, PEB, dan dokumen impor/ekspor" },
        { type: "Packing & Crating", description: "Pengemasan profesional untuk barang fragile atau heavy lift" },
      ],
      priceInfo: "Harga bervariasi berdasarkan rute, volume, dan kondisi pasar. Tim kami akan menghubungi setelah order dibuat.",
    });
  }

  if (toolName === "get_order_status") {
    try {
      // Only look up orders belonging to the current chat session.
      // Accepting an arbitrary phone number here would allow any anonymous user
      // to enumerate another customer's order history by phone number.
      const orders = await db
        .select({
          id: logisticOrdersTable.id,
          orderNumber: logisticOrdersTable.orderNumber,
          status: logisticOrdersTable.status,
          shipmentType: logisticOrdersTable.shipmentType,
          origin: logisticOrdersTable.origin,
          destination: logisticOrdersTable.destination,
          customerName: logisticOrdersTable.customerName,
          requiredDate: logisticOrdersTable.requiredDate,
          createdAt: logisticOrdersTable.createdAt,
        })
        .from(logisticOrdersTable)
        .where(eq(logisticOrdersTable.aiSessionToken, sessionToken))
        .orderBy(asc(logisticOrdersTable.createdAt));

      if (orders.length === 0) {
        return JSON.stringify({
          found: false,
          message: "Tidak ada order yang ditemukan untuk sesi chat ini. Pastikan order dibuat melalui sesi yang sama.",
        });
      }

      // Batch: fetch all sessions for these orders in one query
      const orderIds = orders.map((o) => o.id);
      const sessions = await db
        .select({ id: aiChatSessionsTable.id, logisticOrderId: aiChatSessionsTable.logisticOrderId })
        .from(aiChatSessionsTable)
        .where(inArray(aiChatSessionsTable.logisticOrderId, orderIds));

      // Batch: fetch latest admin reply per session in one query using DISTINCT ON
      const sessionIds = sessions.map((s) => s.id);
      const latestRepliesMap: Record<number, string> = {};
      if (sessionIds.length > 0) {
        const rows = await db.execute<{ session_id: number; content: string }>(sql`
          SELECT DISTINCT ON (session_id) session_id, content
          FROM ${aiChatMessagesTable}
          WHERE session_id = ANY(ARRAY[${sql.join(sessionIds.map((id) => sql`${id}`), sql`, `)}]::int[])
            AND role = 'admin'
          ORDER BY session_id, created_at DESC
        `);
        for (const row of rows.rows) {
          latestRepliesMap[row.session_id] = row.content;
        }
      }

      // Build session → order lookup
      const sessionByOrderId = Object.fromEntries(sessions.map((s) => [s.logisticOrderId, s.id]));

      const enriched = orders.map((order) => {
        const sessionId = sessionByOrderId[order.id];
        const latestAdminReply = sessionId != null ? (latestRepliesMap[sessionId] ?? null) : null;
        return {
          orderNumber: order.orderNumber,
          status: order.status,
          shipmentType: order.shipmentType,
          origin: order.origin,
          destination: order.destination,
          customerName: order.customerName,
          requiredDate: order.requiredDate ?? null,
          createdAt: order.createdAt.toISOString(),
          latestAdminReply,
        };
      });

      return JSON.stringify({ found: true, orders: enriched });
    } catch (err) {
      logger.error({ err }, "AI agent get_order_status failed");
      return JSON.stringify({ found: false, message: "Gagal mengambil status order. Silakan coba lagi." });
    }
  }

  if (toolName === "show_order_form") {
    const { service } = args as { service?: string };
    return JSON.stringify({ shown: true, service: service ?? "" });
  }

  if (toolName === "show_product_order_form") {
    const { productId, productName, unitPrice, unit } = args as {
      productId: number; productName: string; unitPrice: number; unit: string;
    };
    return JSON.stringify({ shown: true, productId, productName, unitPrice, unit });
  }

  if (toolName === "create_logistic_order") {
    try {
      const {
        customerName, phone, email, companyName, shipmentType,
        origin, destination, commodity, cargoDescription,
        grossWeight, volumeCbm, requiredDate, notes,
      } = args as {
        customerName: string; phone: string; email?: string; companyName: string;
        shipmentType: string; origin: string; destination: string;
        commodity?: string; cargoDescription?: string; grossWeight?: number;
        volumeCbm?: number; requiredDate?: string; notes?: string;
      };

      const orderNumber = generateOrderNumber();
      const now = new Date();
      const jamOrder = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(now);

      const [order] = await db.insert(logisticOrdersTable).values({
        orderNumber,
        companyName: companyName || "-",
        customerName,
        email: email || `${phone}@wa.b2bmarketplace.id`,
        phone,
        shipmentType,
        origin,
        destination,
        commodity: commodity ?? null,
        cargoDescription: cargoDescription ?? null,
        grossWeight: grossWeight != null ? String(grossWeight) : null,
        volumeCbm: volumeCbm != null ? String(volumeCbm) : null,
        requiredDate: requiredDate ?? null,
        notes: notes ?? null,
        jamOrder,
        subtotal: "0",
        tax: "0",
        grandTotal: "0",
        status: "New Order",
        source: "ai_agent",
        aiSessionToken: sessionToken,
      }).returning();

      await db.update(aiChatSessionsTable)
        .set({ logisticOrderId: order.id })
        .where(eq(aiChatSessionsTable.id, sessionId));

      const serviceList = `• ${shipmentType}`;

      sendLogisticOrderNotification({
        id: order.id,
        orderNumber,
        customerName,
        companyName: companyName || "-",
        email: email || `${phone}@wa.b2bmarketplace.id`,
        phone,
        shipmentType,
        origin,
        destination,
        commodity: commodity ?? null,
        cargoDescription: cargoDescription ?? null,
        grossWeight: grossWeight ?? null,
        volumeCbm: volumeCbm ?? null,
        grandTotal: 0,
        serviceList,
        requiredDate: requiredDate ?? null,
        notes: notes ?? null,
        jamOrder,
        createdAt: order.createdAt,
      }).catch((err: unknown) => logger.error({ err }, "AI agent sendLogisticOrderNotification failed"));

      return JSON.stringify({
        success: true,
        orderNumber,
        orderId: order.id,
        message: `Order berhasil dibuat dengan nomor ${orderNumber}. Tim B2B Marketplace and Logistic akan segera menghubungi Anda untuk konfirmasi harga.`,
      });
    } catch (err) {
      logger.error({ err }, "AI agent create_logistic_order failed");
      return JSON.stringify({ success: false, error: "Gagal membuat order. Silakan coba lagi atau hubungi kami langsung." });
    }
  }

  if (toolName === "get_marketplace_categories") {
    try {
      // Read-only query: active marketplace categories from vendor_catalog_items
      const rows = await db
        .select({
          kategori: vendorCatalogItemsTable.kategori,
          categoryKey: vendorCatalogItemsTable.categoryKey,
          count: sql<number>`count(*)::int`,
        })
        .from(vendorCatalogItemsTable)
        .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
        .where(and(
          ...catalogPublicConditions(),
          ...catalogSupplierConditions(),
          or(
            isNull(vendorCatalogItemsTable.validityDate),
            gte(vendorCatalogItemsTable.validityDate, sql`CURRENT_DATE`),
          )!,
        ))
        .groupBy(vendorCatalogItemsTable.kategori, vendorCatalogItemsTable.categoryKey)
        .orderBy(desc(sql<number>`count(*)`))
        .limit(8);

      const categories = rows
        .filter((r) => r.kategori && Number(r.count) > 0)
        .map((r) => ({
          key: r.categoryKey ?? r.kategori,
          name: r.kategori,
          activeProductCount: Number(r.count),
        }));

      return JSON.stringify({
        found: categories.length > 0,
        categories,
        totalActiveProducts: categories.reduce((s, c) => s + c.activeProductCount, 0),
      });
    } catch (err) {
      logger.error({ err }, "AI agent get_marketplace_categories failed");
      return JSON.stringify({ found: false, categories: [], totalActiveProducts: 0, error: "Gagal memuat kategori." });
    }
  }

  if (toolName === "search_products") {
    try {
      const { query, limit, includeSuggestions } = args as {
        query: string;
        limit?: number;
        includeSuggestions?: boolean;
      };

      const result = await searchMarketplace({
        query: String(query ?? ""),
        limit: limit ?? 5,
        includeSuggestions: includeSuggestions ?? false,
      });

      return JSON.stringify(result);
    } catch (err) {
      logger.error({ err }, "AI agent search_products (semantic) failed");
      return JSON.stringify({ found: false, message: "Gagal mencari produk. Silakan coba lagi." });
    }
  }

  if (toolName === "create_product_order") {
    try {
      const {
        customerName, customerEmail, customerPhone, items,
      } = args as {
        customerName: string;
        customerEmail: string;
        customerPhone?: string;
        items: Array<{ productId: number; name: string; qty: number; unitPrice: number }>;
      };

      if (!items || items.length === 0) {
        return JSON.stringify({ success: false, error: "Tidak ada produk yang dipilih." });
      }

      const totalAmount = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
      const lineItems = items.map((it) => ({
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
      }));
      const itemsSummary = items.map((it) => `${it.name} x${it.qty}`).join(", ");

      const [order] = await db.insert(ordersTable).values({
        customerName,
        customerEmail,
        customerPhone: customerPhone ?? null,
        status: "pending",
        totalAmount: String(totalAmount),
        taxAmount: "0",
        grandTotal: String(totalAmount),
        items: itemsSummary,
        lineItems,
      }).returning();

      return JSON.stringify({
        success: true,
        orderId: order.id,
        orderNumber: `ORD-${String(order.id).padStart(6, "0")}`,
        totalAmount,
        items: lineItems,
        message: `Order produk berhasil dibuat (ID #${order.id}). Tim kami akan menghubungi Anda untuk konfirmasi pengiriman.`,
      });
    } catch (err) {
      logger.error({ err }, "AI agent create_product_order failed");
      return JSON.stringify({ success: false, error: "Gagal membuat order produk. Silakan coba lagi." });
    }
  }

  return JSON.stringify({ error: "Unknown tool" });
}

/** Stream AI chat to an SSE response. Handles tool-call loops internally. */
async function streamAiChat(
  sessionId: number,
  sessionToken: string,
  userMessage: string,
  res: Response,
): Promise<void> {
  function sendEvent(data: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  const existingMessages = await db
    .select()
    .from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, sessionId))
    .orderBy(asc(aiChatMessagesTable.createdAt));

  await db.insert(aiChatMessagesTable).values({
    sessionId,
    role: "user",
    content: userMessage,
  });

  const visibleMessages = existingMessages.filter((m) => m.role === "user" || m.role === "assistant");

  const systemPrompt = await getSystemPrompt();

  const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...visibleMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  let finalContent = "";
  let loopCount = 0;

  while (loopCount < 5) {
    loopCount++;

    const stream = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      tools: TOOLS,
      tool_choice: "auto",
      max_completion_tokens: 1000,
      stream: true,
    });

    // Accumulate tool call deltas by index.
    // Buffer text tokens for this iteration — we only emit them to SSE if this turns
    // out to be the final turn (no tool calls). This keeps the UI and the persisted DB
    // history consistent: clients never see assistant text that won't be stored.
    const toolCallMap: Record<number, { id: string; name: string; arguments: string }> = {};
    const iterTokens: string[] = [];
    let contentBuffer = "";

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      if (delta.content) {
        iterTokens.push(delta.content);
        contentBuffer += delta.content;
      }

      // Tool call deltas — accumulate by index
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallMap[tc.index]) {
            toolCallMap[tc.index] = { id: "", name: "", arguments: "" };
          }
          if (tc.id) toolCallMap[tc.index].id = tc.id;
          if (tc.function?.name) toolCallMap[tc.index].name += tc.function.name;
          if (tc.function?.arguments) toolCallMap[tc.index].arguments += tc.function.arguments;
        }
      }
    }

    const pendingToolCalls = Object.values(toolCallMap).filter((tc) => tc.name);

    if (pendingToolCalls.length === 0) {
      // Final text turn — emit buffered tokens to the client and exit loop
      finalContent = contentBuffer;
      for (const tok of iterTokens) sendEvent({ type: "token", text: tok });
      break;
    }

    // Append assistant turn with tool calls to message history
    chatMessages.push({
      role: "assistant",
      content: contentBuffer || null,
      tool_calls: pendingToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute each tool call
    const toolResults: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    for (const tc of pendingToolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.arguments) as Record<string, unknown>; } catch { /* empty */ }

      const result = await handleToolCall(tc.name, args, sessionToken, sessionId);

      if (tc.name === "create_logistic_order") {
        try {
          const parsed = JSON.parse(result) as { success?: boolean; orderNumber?: string; orderId?: number };
          if (parsed.success && parsed.orderNumber && parsed.orderId) {
            sendEvent({ type: "order", orderNumber: parsed.orderNumber, orderId: parsed.orderId });
          }
        } catch { /* empty */ }
      }

      if (tc.name === "get_order_status") {
        try {
          const parsed = JSON.parse(result) as {
            found?: boolean;
            orders?: Array<{
              orderNumber: string;
              status: string;
              shipmentType: string;
              origin: string;
              destination: string;
              customerName: string;
              requiredDate: string | null;
              createdAt: string;
              latestAdminReply: string | null;
            }>;
          };
          if (parsed.found && parsed.orders && parsed.orders.length > 0) {
            sendEvent({ type: "status", orders: parsed.orders });
          } else if (!parsed.found) {
            // Clear any stale status cards in the frontend
            sendEvent({ type: "status", orders: [] });
          }
        } catch { /* empty */ }
      }

      if (tc.name === "show_order_form") {
        try {
          const parsed = JSON.parse(result) as { shown?: boolean; service?: string };
          if (parsed.shown) {
            sendEvent({ type: "form", service: parsed.service ?? "" });
          }
        } catch { /* empty */ }
      }

      if (tc.name === "show_product_order_form") {
        try {
          const parsed = JSON.parse(result) as { shown?: boolean; productId?: number; productName?: string; unitPrice?: number; unit?: string };
          if (parsed.shown) {
            sendEvent({ type: "product_form", productId: parsed.productId ?? 0, productName: parsed.productName ?? "", unitPrice: parsed.unitPrice ?? 0, unit: parsed.unit ?? "pcs" });
          }
        } catch { /* empty */ }
      }

      toolResults.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
    chatMessages.push(...toolResults);
    // Loop continues: tool results are appended, next iteration will produce the final text
  }

  // Persist the final assistant reply
  if (finalContent) {
    await db.insert(aiChatMessagesTable).values({
      sessionId,
      role: "assistant",
      content: finalContent,
    });
  }

  sendEvent({ type: "done" });
}

// ── POST /api/ai-agent/quick-order  (direct form submission, no AI round-trip) ─
aiAgentRouter.post("/quick-order", async (req: Request, res: Response) => {
  const clientIp = req.ip ?? "unknown";
  const rateLimitError = checkIpRateLimit(clientIp, orderIpRateMap, ORDER_IP_WINDOW_MS, ORDER_IP_LIMIT, "1 jam");
  if (rateLimitError) {
    return res.status(429).json({ error: rateLimitError });
  }

  const {
    sessionToken: incomingToken,
    customerName, phone, email, companyName, shipmentType,
    origin, destination, commodity, cargoDescription,
    grossWeight, volumeCbm, requiredDate, notes,
  } = req.body as {
    sessionToken?: string;
    customerName?: string; phone?: string; email?: string; companyName?: string;
    shipmentType?: string; origin?: string; destination?: string;
    commodity?: string; cargoDescription?: string; grossWeight?: string;
    volumeCbm?: string; requiredDate?: string; notes?: string;
  };

  if (!customerName || !phone || !shipmentType || !origin || !destination) {
    return res.status(400).json({ error: "Field wajib belum lengkap (nama, HP, jenis, asal, tujuan)" });
  }

  try {
    // Resolve or create session
    let session: typeof aiChatSessionsTable.$inferSelect | undefined;
    if (incomingToken) {
      const [found] = await db
        .select()
        .from(aiChatSessionsTable)
        .where(eq(aiChatSessionsTable.sessionToken, incomingToken));
      session = found;
    }
    if (!session) {
      const token = generateSessionToken();
      const [created] = await db.insert(aiChatSessionsTable).values({ sessionToken: token }).returning();
      session = created;
    }

    const orderNumber = generateOrderNumber();
    const now = new Date();
    const jamOrder = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(now);

    const gwNum = grossWeight ? parseFloat(grossWeight) : undefined;
    const volNum = volumeCbm ? parseFloat(volumeCbm) : undefined;

    const [order] = await db.insert(logisticOrdersTable).values({
      orderNumber,
      companyName: companyName || "-",
      customerName,
      email: email || `${phone}@wa.b2bmarketplace.id`,
      phone,
      shipmentType,
      origin,
      destination,
      commodity: commodity ?? null,
      cargoDescription: cargoDescription ?? null,
      grossWeight: gwNum != null ? String(gwNum) : null,
      volumeCbm: volNum != null ? String(volNum) : null,
      requiredDate: requiredDate ?? null,
      notes: notes ?? null,
      jamOrder,
      subtotal: "0",
      tax: "0",
      grandTotal: "0",
      status: "New Order",
      source: "ai_agent",
      aiSessionToken: session.sessionToken,
    }).returning();

    await db.update(aiChatSessionsTable)
      .set({ logisticOrderId: order.id })
      .where(eq(aiChatSessionsTable.id, session.id));

    sendLogisticOrderNotification({
      id: order.id,
      orderNumber,
      customerName,
      companyName: companyName || "-",
      email: email || `${phone}@wa.b2bmarketplace.id`,
      phone,
      shipmentType,
      origin,
      destination,
      commodity: commodity ?? null,
      cargoDescription: cargoDescription ?? null,
      grossWeight: gwNum ?? null,
      volumeCbm: volNum ?? null,
      grandTotal: 0,
      serviceList: `• ${shipmentType}`,
      requiredDate: requiredDate ?? null,
      notes: notes ?? null,
      jamOrder,
      createdAt: order.createdAt,
    }).catch((err: unknown) => logger.error({ err }, "quick-order sendLogisticOrderNotification failed"));

    return res.status(201).json({
      success: true,
      orderNumber,
      orderId: order.id,
      sessionToken: session.sessionToken,
    });
  } catch (err) {
    logger.error({ err }, "quick-order failed");
    return res.status(500).json({ error: "Gagal membuat order. Silakan coba lagi." });
  }
});

// ── POST /api/ai-agent/quick-product-order  (direct product form submission) ──
aiAgentRouter.post("/quick-product-order", async (req: Request, res: Response) => {
  const clientIp = req.ip ?? "unknown";
  const rateLimitError = checkIpRateLimit(clientIp, orderIpRateMap, ORDER_IP_WINDOW_MS, ORDER_IP_LIMIT, "1 jam");
  if (rateLimitError) {
    return res.status(429).json({ error: rateLimitError });
  }

  const {
    sessionToken: incomingToken,
    customerName, phone, email,
    productId, productName, qty, unitPrice,
    notes,
  } = req.body as {
    sessionToken?: string;
    customerName?: string; phone?: string; email?: string;
    productId?: number; productName?: string; qty?: number; unitPrice?: number;
    notes?: string;
  };

  if (!customerName || !phone || !productId || !productName || !qty || qty <= 0) {
    return res.status(400).json({ error: "Field wajib belum lengkap (nama, HP, produk, jumlah)" });
  }

  try {
    let session: typeof aiChatSessionsTable.$inferSelect | undefined;
    if (incomingToken) {
      const [found] = await db
        .select()
        .from(aiChatSessionsTable)
        .where(eq(aiChatSessionsTable.sessionToken, incomingToken));
      session = found;
    }
    if (!session) {
      const token = generateSessionToken();
      const [created] = await db.insert(aiChatSessionsTable).values({ sessionToken: token }).returning();
      session = created;
    }

    const priceNum = unitPrice ?? 0;
    const totalAmount = qty * priceNum;
    const itemsSummary = `${productName} x${qty}`;

    // Generate order number PRD-YYMMDD-XXXXX
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 90000) + 10000;
    const orderNumber = `PRD-${yy}${mm}${dd}-${rand}`;

    // Simpan ke portal_product_orders agar muncul di halaman Portal Order Produk BizPortal
    const [portalOrder] = await db.insert(portalProductOrdersTable).values({
      orderNumber,
      customerName,
      email: email || `${phone}@wa.b2bmarketplace.id`,
      phone,
      shippingAddress: "-",
      notes: notes ? `[AI Chat] ${notes}` : "[AI Chat]",
      subtotal: String(totalAmount),
      grandTotal: String(totalAmount),
      status: "New Order",
    }).returning();

    await db.insert(portalProductOrderItemsTable).values({
      orderId: portalOrder.id,
      productId: productId ?? null,
      productName,
      productSku: null,
      unit: null,
      unitPrice: String(priceNum),
      qty,
      subtotal: String(totalAmount),
    });

    if (notes) {
      await db.insert(aiChatMessagesTable).values({
        sessionId: session.id,
        role: "user",
        content: `Order produk: ${itemsSummary}. Catatan: ${notes}`,
      });
    }

    // Kirim notifikasi WA ke admin (fire-and-forget)
    getAdminWa().then((adminWa) => {
      if (!adminWa) return;
      const msg =
        `🛒 *Order Produk Baru (AI Chat)*\n` +
        `No. Order: ${orderNumber}\n` +
        `Customer: ${customerName}\n` +
        (phone ? `WhatsApp: ${phone}\n` : "") +
        (email ? `Email: ${email}\n` : "") +
        `Produk: ${productName} x${qty}\n` +
        `Harga Satuan: Rp ${priceNum.toLocaleString("id-ID")}\n` +
        `Total: Rp ${totalAmount.toLocaleString("id-ID")}` +
        (notes ? `\nCatatan: ${notes}` : "");
      return sendWhatsApp(adminWa, msg);
    }).catch(() => undefined);

    // Kirim konfirmasi WA ke customer
    if (phone) {
      const custMsg =
        `✅ *Pesanan Anda Berhasil Diterima!*\n` +
        `No. Order: *${orderNumber}*\n\n` +
        `• ${productName} × ${qty} — Rp ${totalAmount.toLocaleString("id-ID")}\n\n` +
        `Total: Rp ${totalAmount.toLocaleString("id-ID")}\n\n` +
        `Tim kami akan segera menghubungi Anda untuk konfirmasi pengiriman. Terima kasih! 🙏`;
      sendWhatsApp(phone, custMsg).catch(() => undefined);
    }

    return res.status(201).json({
      success: true,
      orderNumber,
      orderId: portalOrder.id,
      sessionToken: session.sessionToken,
    });
  } catch (err) {
    logger.error({ err }, "quick-product-order failed");
    return res.status(500).json({ error: "Gagal membuat order. Silakan coba lagi." });
  }
});

// ── POST /api/ai-agent/chat  (SSE streaming) ──────────────────────────────────
// Note: the global express.json({ limit: "20mb" }) in app.ts already parses the
// body before this handler runs, so a route-level body-size limit has no effect.
// Token-cost abuse is instead constrained by the per-IP rate limit below and the
// hard 4000-character message cap enforced inside the handler.
aiAgentRouter.post("/chat", async (req: Request, res: Response) => {
  const clientIp = req.ip ?? "unknown";
  const rateLimitError = checkIpRateLimit(clientIp, chatIpRateMap, CHAT_IP_WINDOW_MS, CHAT_IP_LIMIT, "10 menit");
  if (rateLimitError) {
    res.status(429).json({ message: rateLimitError });
    return;
  }

  const { sessionToken: incomingToken, message } = req.body as {
    sessionToken?: string;
    message?: string;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ message: "Pesan tidak boleh kosong" });
    return;
  }

  // Enforce a hard cap on message length to limit token usage per request
  if (message.length > 4000) {
    res.status(400).json({ message: "Pesan terlalu panjang (maksimal 4000 karakter)." });
    return;
  }

  // Set SSE headers before any async work so the client can start reading
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(data: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    let session: typeof aiChatSessionsTable.$inferSelect | undefined;

    if (incomingToken) {
      const [existing] = await db
        .select()
        .from(aiChatSessionsTable)
        .where(eq(aiChatSessionsTable.sessionToken, incomingToken));
      session = existing;
    }

    if (!session) {
      const token = generateSessionToken();
      const [created] = await db
        .insert(aiChatSessionsTable)
        .values({ sessionToken: token })
        .returning();
      session = created;
    }

    // Send session token early so the client can persist it
    sendEvent({ type: "session", sessionToken: session.sessionToken });

    await streamAiChat(session.id, session.sessionToken, message.trim(), res);

    res.end();
  } catch (err) {
    logger.error({ err }, "AI agent stream error");
    sendEvent({ type: "error", message: "Terjadi kesalahan pada AI. Silakan coba lagi." });
    res.end();
  }
});

// ── GET /api/ai-agent/session/:token ─────────────────────────────────────────
// Optional ?since=ISO — only returns messages created strictly after that timestamp.
// Used by ChatWidget to poll for new admin replies efficiently.
aiAgentRouter.get("/session/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const sinceParam = req.query.since as string | undefined;

  const [session] = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.sessionToken, token));

  if (!session) return res.status(404).json({ message: "Sesi tidak ditemukan" });

  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const validSince = sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate : null;

  // This endpoint is public (token is the sole credential).
  // Only return admin-authored messages so that user messages (which may
  // contain OCR'd document text) and assistant messages are not exposed to
  // anyone who happens to possess the token.  The ChatWidget only polls this
  // endpoint to display incoming admin replies — it never needs user/assistant
  // history from here.
  const adminOnly = eq(aiChatMessagesTable.role, "admin");
  const messages = await db
    .select()
    .from(aiChatMessagesTable)
    .where(
      validSince
        ? and(eq(aiChatMessagesTable.sessionId, session.id), gt(aiChatMessagesTable.createdAt, validSince), adminOnly)
        : and(eq(aiChatMessagesTable.sessionId, session.id), adminOnly)
    )
    .orderBy(asc(aiChatMessagesTable.createdAt));

  return res.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// ── GET /api/ai-agent/session/by-order/:orderId ───────────────────────────────
aiAgentRouter.get("/session/by-order/:orderId", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const orderId = parseInt(String(req.params.orderId), 10);
  if (isNaN(orderId)) return res.status(400).json({ message: "ID tidak valid" });

  const [session] = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.logisticOrderId, orderId));

  if (!session) return res.status(404).json({ message: "Tidak ada sesi chat AI untuk order ini" });

  const messages = await db
    .select()
    .from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, session.id))
    .orderBy(asc(aiChatMessagesTable.createdAt));

  return res.json({
    session: {
      id: session.id,
      sessionToken: session.sessionToken,
      logisticOrderId: session.logisticOrderId,
      createdAt: session.createdAt.toISOString(),
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// ── POST /api/ai-agent/knowledge-base/parse-import ───────────────────────────
// Accepts a PDF, TXT, or raw text body, extracts text, then asks AI to split
// it into structured KB entries. Returns the parsed entries for user review —
// nothing is saved yet.
aiAgentRouter.post(
  "/knowledge-base/parse-import",
  uploadMemory.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    if (!(await requireAdmin(req, res))) return;

    let rawText = "";

    if (req.file) {
      const file = req.file;
      const isPlainText =
        file.mimetype === "text/plain" || file.originalname.endsWith(".txt");
      const isPdf = file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf");

      if (isPlainText) {
        rawText = file.buffer.toString("utf-8");
      } else if (isPdf) {
        try {
          const parsed = await pdfParse(file.buffer);
          rawText = (parsed.text ?? "").trim();
        } catch {
          // fallback: try vision OCR
        }
        if (!rawText || rawText.length < 50) {
          // Try GPT-4o vision for scanned PDFs
          try {
            const base64 = file.buffer.toString("base64");
            const resp = await getOpenAI().chat.completions.create({
              model: "gpt-4o",
              max_completion_tokens: 2000,
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: "Ekstrak semua teks dari dokumen PDF ini secara lengkap dalam Bahasa Indonesia." },
                  { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
                ],
              }],
            });
            rawText = resp.choices[0]?.message?.content ?? "";
          } catch (err) {
            logger.warn({ err }, "KB import: vision OCR fallback failed");
          }
        }
      } else {
        res.status(400).json({ message: "Format tidak didukung. Gunakan PDF atau TXT." });
        return;
      }
    } else if (typeof req.body?.text === "string" && req.body.text.trim()) {
      rawText = req.body.text.trim();
    }

    if (!rawText || rawText.length < 10) {
      res.status(400).json({ message: "Tidak ada teks yang bisa dibaca dari file." });
      return;
    }

    // Ask AI to parse the raw text into structured KB entries
    try {
      const systemMsg = `Kamu adalah asisten yang membantu mengonversi dokumen SOP/FAQ perusahaan logistik menjadi entri knowledge base terstruktur untuk chatbot.

Tugas: Baca teks dokumen dan pecah menjadi entri-entri knowledge base yang terpisah dan spesifik.

Format output WAJIB: JSON array dengan struktur:
[
  {
    "title": "Judul singkat dan deskriptif",
    "category": "salah satu dari: umum | harga | layanan | prosedur | dokumen | faq | kebijakan | kontak",
    "content": "Isi lengkap informasi untuk entri ini, dalam format yang jelas dan mudah dibaca chatbot"
  }
]

Aturan:
- Setiap entri fokus pada SATU topik spesifik
- Judul max 80 karakter, jelas dan deskriptif
- Isi boleh panjang jika perlu, tapi tetap terstruktur
- Pilih kategori yang paling sesuai
- Jika ada tabel harga, ubah jadi teks yang mudah dibaca
- HANYA output JSON, tidak ada teks lain di luar array JSON`;

      const resp = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: `Konversi dokumen berikut menjadi entri knowledge base:\n\n${rawText.slice(0, 12000)}` },
        ],
      });

      const raw = resp.choices[0]?.message?.content ?? "{}";
      let parsed: { entries?: Array<{ title: string; category: string; content: string }> } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        // try to extract array directly
      }

      // The AI might return { entries: [...] } or just an array at top level
      let entries: Array<{ title: string; category: string; content: string }> = [];
      if (Array.isArray(parsed)) {
        entries = parsed as typeof entries;
      } else if (Array.isArray(parsed.entries)) {
        entries = parsed.entries;
      } else {
        // try any top-level array key
        const arrKey = Object.keys(parsed).find((k) => Array.isArray((parsed as Record<string, unknown>)[k]));
        if (arrKey) entries = (parsed as Record<string, unknown>)[arrKey] as typeof entries;
      }

      // Validate and sanitize
      const VALID_CATS = ["umum", "harga", "layanan", "prosedur", "dokumen", "faq", "kebijakan", "kontak"];
      entries = entries
        .filter((e) => e && typeof e.title === "string" && typeof e.content === "string")
        .map((e) => ({
          title: String(e.title).slice(0, 200).trim(),
          category: VALID_CATS.includes(e.category) ? e.category : "umum",
          content: String(e.content).trim(),
        }));

      res.json({ entries, rawLength: rawText.length });
    } catch (err) {
      logger.error({ err }, "KB import AI parse failed");
      res.status(500).json({ message: "Gagal menganalisis dokumen. Coba lagi." });
    }
  }
);

// ── POST /api/ai-agent/knowledge-base/bulk ────────────────────────────────────
// Save multiple KB entries at once (after user review)
aiAgentRouter.post("/knowledge-base/bulk", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { entries } = req.body as {
    entries?: Array<{ title: string; category: string; content: string }>;
  };
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ message: "entries tidak boleh kosong" });
  }
  const VALID_CATS = ["umum", "harga", "layanan", "prosedur", "dokumen", "faq", "kebijakan", "kontak"];
  const toInsert = entries
    .filter((e) => e?.title?.trim() && e?.content?.trim())
    .map((e, i) => ({
      title: e.title.trim().slice(0, 200),
      category: VALID_CATS.includes(e.category) ? e.category : "umum",
      content: e.content.trim(),
      sortOrder: i,
      isActive: true,
    }));
  if (toInsert.length === 0) {
    return res.status(400).json({ message: "Tidak ada entri valid untuk disimpan" });
  }
  try {
    const saved = await db.insert(chatbotKnowledgeBaseTable).values(toInsert).returning();
    return res.status(201).json({ saved: saved.length });
  } catch (err) {
    logger.error({ err }, "KB bulk insert failed");
    return res.status(500).json({ message: "Gagal menyimpan entri" });
  }
});

// ── DELETE /api/ai-agent/knowledge-base/bulk ─────────────────────────────────
// Delete multiple KB entries by IDs
aiAgentRouter.delete("/knowledge-base/bulk", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids tidak boleh kosong" });
  }
  try {
    await db
      .delete(chatbotKnowledgeBaseTable)
      .where(inArray(chatbotKnowledgeBaseTable.id, ids));
    return res.json({ deleted: ids.length });
  } catch (err) {
    logger.error({ err }, "KB bulk delete failed");
    return res.status(500).json({ message: "Gagal menghapus entri" });
  }
});

// ── GET /api/ai-agent/knowledge-base ─────────────────────────────────────────
aiAgentRouter.get("/knowledge-base", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const entries = await db
      .select()
      .from(chatbotKnowledgeBaseTable)
      .orderBy(asc(chatbotKnowledgeBaseTable.sortOrder), asc(chatbotKnowledgeBaseTable.id));
    return res.json(
      entries.map((e) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        content: e.content,
        isActive: e.isActive,
        sortOrder: e.sortOrder,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    logger.error({ err }, "KB list failed");
    return res.status(500).json({ message: "Gagal memuat knowledge base" });
  }
});

// ── POST /api/ai-agent/knowledge-base ────────────────────────────────────────
aiAgentRouter.post("/knowledge-base", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { title, category, content, sortOrder } = req.body as {
    title?: string; category?: string; content?: string; sortOrder?: number;
  };
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ message: "title dan content tidak boleh kosong" });
  }
  try {
    const [entry] = await db.insert(chatbotKnowledgeBaseTable).values({
      title: title.trim(),
      category: category?.trim() ?? "umum",
      content: content.trim(),
      sortOrder: sortOrder ?? 0,
      isActive: true,
    }).returning();
    return res.status(201).json({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      content: entry.content,
      isActive: entry.isActive,
      sortOrder: entry.sortOrder,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "KB create failed");
    return res.status(500).json({ message: "Gagal membuat entri" });
  }
});

// ── PUT /api/ai-agent/knowledge-base/:id ─────────────────────────────────────
aiAgentRouter.put("/knowledge-base/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const { title, category, content, sortOrder, isActive } = req.body as {
    title?: string; category?: string; content?: string; sortOrder?: number; isActive?: boolean;
  };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title.trim();
  if (category !== undefined) updates.category = category.trim();
  if (content !== undefined) updates.content = content.trim();
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (isActive !== undefined) updates.isActive = isActive;
  try {
    const [entry] = await db
      .update(chatbotKnowledgeBaseTable)
      .set(updates)
      .where(eq(chatbotKnowledgeBaseTable.id, id))
      .returning();
    if (!entry) return res.status(404).json({ message: "Entri tidak ditemukan" });
    return res.json({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      content: entry.content,
      isActive: entry.isActive,
      sortOrder: entry.sortOrder,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "KB update failed");
    return res.status(500).json({ message: "Gagal memperbarui entri" });
  }
});

// ── DELETE /api/ai-agent/knowledge-base/:id ───────────────────────────────────
aiAgentRouter.delete("/knowledge-base/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.delete(chatbotKnowledgeBaseTable).where(eq(chatbotKnowledgeBaseTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "KB delete failed");
    return res.status(500).json({ message: "Gagal menghapus entri" });
  }
});

// ── GET /api/ai-agent/settings ───────────────────────────────────────────────
aiAgentRouter.get("/settings", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const [row] = await db
    .select()
    .from(aiAgentSettingsTable)
    .where(eq(aiAgentSettingsTable.key, "system_prompt"));
  return res.json({ systemPrompt: row?.value ?? DEFAULT_SYSTEM_PROMPT });
});

// ── PUT /api/ai-agent/settings ────────────────────────────────────────────────
aiAgentRouter.put("/settings", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { systemPrompt } = req.body as { systemPrompt?: string };
  if (typeof systemPrompt !== "string" || !systemPrompt.trim()) {
    return res.status(400).json({ message: "systemPrompt tidak boleh kosong" });
  }
  await db
    .insert(aiAgentSettingsTable)
    .values({ key: "system_prompt", value: systemPrompt.trim() })
    .onConflictDoUpdate({
      target: aiAgentSettingsTable.key,
      set: { value: systemPrompt.trim(), updatedAt: new Date() },
    });
  return res.json({ ok: true });
});

// ── POST /api/ai-agent/upload ─────────────────────────────────────────────────
// Requires a valid AI chat sessionToken (issued by /api/ai-agent/stream).
// Without this gate any unauthenticated caller could drain paid OpenAI quota by
// submitting large files in a loop. The sessionToken is the same public credential
// already used for chat history polling — it is not a secret, but it proves the
// caller has previously interacted with the chat widget and obtained a real session.
aiAgentRouter.post(
  "/upload",
  uploadMemory.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate session token before touching the file or calling OpenAI.
    const rawToken =
      typeof req.body?.sessionToken === "string" ? req.body.sessionToken.trim() : "";
    if (!rawToken) {
      res.status(401).json({ message: "sessionToken diperlukan untuk mengunggah file." });
      return;
    }
    const [session] = await db
      .select({ id: aiChatSessionsTable.id })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.sessionToken, rawToken));
    if (!session) {
      res.status(401).json({ message: "Session tidak valid atau sudah kadaluarsa." });
      return;
    }

    // Require the session to have at least one real user message.
    // This proves the caller already used the chat widget (spending AI chat quota)
    // and is not simply minting fresh tokens in bulk to drive upload abuse.
    const [msgCheck] = await db
      .select({ id: aiChatMessagesTable.id })
      .from(aiChatMessagesTable)
      .where(
        and(
          eq(aiChatMessagesTable.sessionId, session.id),
          eq(aiChatMessagesTable.role, "user"),
        ),
      )
      .limit(1);
    if (!msgCheck) {
      res.status(403).json({
        message: "Kirim pesan ke AI terlebih dahulu sebelum mengunggah file.",
      });
      return;
    }

    // Per-IP and per-session upload rate limits — checked after session validation.
    // req.ip is reliably set by Express because app.set("trust proxy", 1) is
    // configured in app.ts, preventing X-Forwarded-For header spoofing.
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const rateLimitError = checkUploadRateLimit(clientIp, rawToken);
    if (rateLimitError) {
      res.status(429).json({ message: rateLimitError });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ message: "Tidak ada file yang diupload." });
      return;
    }

    const mime = file.mimetype;
    const isImage = mime.startsWith("image/");
    const isPdf = mime === "application/pdf";

    if (!isImage && !isPdf) {
      res
        .status(400)
        .json({ message: "Hanya file gambar (JPG, PNG, WEBP, GIF) dan PDF yang didukung." });
      return;
    }

    try {
      let extractedText = "";

      if (isPdf) {
        let pdfText = "";
        try {
          const parsed = await pdfParse(file.buffer);
          pdfText = (parsed.text ?? "").trim();
        } catch {
          /* ignore parse errors — fall through to vision */
        }

        if (pdfText.length >= 200) {
          const resp = await getOpenAI().chat.completions.create({
            model: "gpt-4o-mini",
            max_completion_tokens: 800,
            messages: [
              {
                role: "system",
                content:
                  "Kamu adalah asisten yang membantu menganalisis dokumen logistik. Jelaskan isi dokumen ini secara ringkas dalam Bahasa Indonesia. Sebutkan jenis dokumen, pihak-pihak yang terlibat, tanggal, angka/nilai penting, dan informasi utama lainnya.",
              },
              { role: "user", content: `Analisis dokumen ini:\n\n${pdfText.slice(0, 5000)}` },
            ],
          });
          extractedText = resp.choices[0]?.message?.content ?? pdfText.slice(0, 2000);
        } else {
          const base64 = file.buffer.toString("base64");
          const resp = await getOpenAI().chat.completions.create({
            model: "gpt-4o",
            max_completion_tokens: 800,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Analisis dokumen PDF ini dan jelaskan isinya secara ringkas dalam Bahasa Indonesia. Sebutkan jenis dokumen, pihak terlibat, tanggal, nilai, dan informasi penting lainnya.",
                  },
                  {
                    type: "image_url",
                    image_url: { url: `data:application/pdf;base64,${base64}` },
                  },
                ],
              },
            ],
          });
          extractedText = resp.choices[0]?.message?.content ?? "Tidak dapat membaca isi dokumen.";
        }
      } else {
        const base64 = file.buffer.toString("base64");
        const resp = await getOpenAI().chat.completions.create({
          model: "gpt-4o",
          max_completion_tokens: 800,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analisis gambar ini dan jelaskan isinya secara ringkas dalam Bahasa Indonesia. Jika ada teks dalam gambar, ekstrak semua teksnya. Jika ini adalah dokumen logistik (invoice, bill of lading, AWB, dll), sebutkan semua informasi pentingnya.",
                },
                { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
              ],
            },
          ],
        });
        extractedText = resp.choices[0]?.message?.content ?? "Tidak dapat menganalisis gambar.";
      }

      const preview =
        isImage && file.buffer.length < 2 * 1024 * 1024
          ? `data:${mime};base64,${file.buffer.toString("base64")}`
          : null;

      res.json({
        text: extractedText,
        type: isImage ? "image" : "pdf",
        filename: file.originalname,
        preview,
      });
    } catch (err) {
      logger.error({ err }, "AI agent file upload/OCR failed");
      res.status(500).json({ message: "Gagal memproses file. Coba lagi." });
    }
  },
);

// ── POST /api/ai-agent/session/:token/admin-reply ────────────────────────────
aiAgentRouter.post("/session/:token/admin-reply", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const token = String(req.params.token);
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ message: "Pesan tidak boleh kosong" });
  }

  const [session] = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.sessionToken, token));

  if (!session) return res.status(404).json({ message: "Sesi tidak ditemukan" });

  if (session.logisticOrderId) {
    const [order] = await db
      .select()
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, session.logisticOrderId));

    if (order?.phone) {
      const waMsg =
        `📦 *Balasan dari B2B Marketplace and Logistic*\n` +
        (order.orderNumber ? `No. Order: ${order.orderNumber}\n\n` : `\n`) +
        message.trim();
      sendWhatsApp(order.phone, waMsg).catch((err: unknown) =>
        logger.error({ err }, "AI agent admin reply WA failed")
      );
    }
  }

  const [saved] = await db.insert(aiChatMessagesTable).values({
    sessionId: session.id,
    role: "admin",
    content: message.trim(),
  }).returning();

  return res.status(201).json({
    id: saved.id,
    role: saved.role,
    content: saved.content,
    createdAt: saved.createdAt.toISOString(),
  });
});
