import { db, productMediaTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { uploadToSupabase } from "./supabaseStorage.js";
import { getOpenAI } from "./openaiClient.js";

export type CatalogItemData = {
  id: number;
  name: string;
  templateKind?: string | null;
  description?: string | null;
  specValues?: Record<string, unknown> | null;
  kategori?: string | null;
  serviceType?: string | null;
  origin?: string | null;
  vendorId?: number | null;
  vendorName?: string | null;
  vendorServiceType?: string | null;
};

// ── Service Visualization Engine ──────────────────────────────────────────────

function buildServicePrompt(item: CatalogItemData): string {
  const name = item.name.toLowerCase();
  const svcType = (item.serviceType ?? item.vendorServiceType ?? item.kategori ?? "").toLowerCase();
  const specs = item.specValues ?? {};

  const routeFrom = specs.route_from as string | null;
  const routeTo = specs.route_to as string | null;
  const truckType = specs.truck_type as string | null;
  const port = specs.port as string | null;
  const containerSize = specs.container_size as string | null;

  const base = "Ultra realistic professional B2B logistics and trade service photography.";
  const suffix = "No text, no watermark, no logos. Square 1:1 format, commercial catalog quality, professional studio lighting.";

  if (/ppjk|customs|clearance|kepabeanan|bea.cukai/i.test(name + svcType)) {
    const portLabel = port ?? "Indonesian seaport";
    return `${base} Professional customs clearance officer in formal uniform at ${portLabel} terminal, container inspection process, official document verification with shipping manifests and customs stamps, modern port operations background. Commercial logistics professional photography. ${suffix}`;
  }

  if (/trucking|angkut|tronton|fuso|cdd|wingbox/i.test(name + svcType + (truckType ?? ""))) {
    const truck = truckType ?? (name.includes("tronton") ? "Tronton" : name.includes("fuso") ? "Fuso" : "CDD");
    const route = (routeFrom && routeTo) ? `${routeFrom} to ${routeTo} route` : "Indonesian toll road highway";
    return `${base} Modern ${truck} logistics truck carrying cargo container on ${route}, professional freight transport operation, dramatic natural light, well-maintained commercial vehicle, container yard background. ${suffix}`;
  }

  if (/sea.freight|ocean.freight|fcl|lcl|sea_freight/i.test(name + svcType)) {
    const container = containerSize ?? "shipping container";
    const routeDesc = (routeFrom && routeTo) ? `${routeFrom} to ${routeTo}` : "international shipping";
    return `${base} Large international container vessel at modern port terminal, ${container} being loaded by ship-to-shore crane, ${routeDesc} maritime operation, dramatic sky, realistic commercial port scene. ${suffix}`;
  }

  if (/air.freight|air_freight|kargo.udara/i.test(name + svcType)) {
    return `${base} Wide-body cargo aircraft on tarmac at international airport, cargo pallets being loaded through nose door, professional air freight handling team in safety vests, modern airside operations. ${suffix}`;
  }

  if (/handling|stevedore|bongkar.muat/i.test(name + svcType)) {
    return `${base} Professional cargo handling team at modern port warehouse, forklift loading palletized goods, industrial logistics facility with safety equipment, B2B warehouse operations photography. ${suffix}`;
  }

  if (/ekspor|impor|export|import|exim/i.test(name + svcType)) {
    return `${base} Professional export-import logistics service, customs documentation and shipping papers on executive desk, international shipping containers in background, trade document review, modern trading company environment. ${suffix}`;
  }

  if (/warehouse|gudang|storage/i.test(name + svcType)) {
    return `${base} Modern warehouse interior with organized pallet racking system, forklift operating in large logistics facility, inventory management operations, professional industrial photography. ${suffix}`;
  }

  return `${base} Professional logistics and supply chain service, modern freight operations at Indonesian port or logistics hub, commercial B2B service photography. ${suffix}`;
}

function buildProductPrompt(item: CatalogItemData): string {
  const specs = item.specValues ?? {};
  const name = item.name;

  const grade = specs.grade as string | null;
  const garVal = specs.gar as number | null;
  const origin = item.origin ?? (specs.origin as string | null);
  const beanType = specs.bean_type as string | null;
  const productType = specs.product_type as string | null;
  const process = specs.process as string | null;

  const base = "Ultra realistic professional B2B marketplace product photography.";
  const suffix = "Clean white or gradient studio background, professional studio lighting, centered product, no text, no watermark, no logos. Square 1:1 format, premium export catalog quality.";

  if (/kopi|coffee|arabica|arabika|robusta|green.bean/i.test(name)) {
    const bean = beanType ?? (name.toLowerCase().includes("robusta") ? "Robusta" : "Arabica");
    const gradeLabel = grade ? ` ${grade}` : "";
    const processLabel = process ? `, ${process} processed` : "";
    const originLabel = origin ? ` from ${origin}` : "";
    return `${base} Premium ${bean} green coffee beans${gradeLabel}${originLabel}${processLabel}, export quality raw coffee beans spread on burlap or wooden surface, close-up detail showing bean texture and natural color, specialty coffee commodity shot. ${suffix}`;
  }

  if (/batubara|coal|bara/i.test(name)) {
    const garLabel = garVal ? ` GAR ${garVal} kcal/kg` : "";
    const originLabel = origin ? ` from ${origin}` : "";
    return `${base} Industrial thermal coal${garLabel}${originLabel}, substantial pile of black coal chunks on industrial conveyor or port surface, realistic mineral texture and coal luster, energy commodity photography. ${suffix}`;
  }

  if (/cpo|crude.palm|kelapa.sawit/i.test(name)) {
    const originLabel = origin ? ` from ${origin}` : "";
    return `${base} Crude Palm Oil (CPO)${originLabel} in bulk storage container, golden-reddish palm oil liquid, professional commodity photography, realistic oil texture and industrial packaging. ${suffix}`;
  }

  if (/rbd|palm.olein|olein/i.test(name)) {
    return `${base} Refined Bleached Deodorized Palm Olein in clear industrial drum, golden transparent oil, premium food-grade commodity, export quality packaging shot. ${suffix}`;
  }

  const gradeLabel = grade ? ` ${grade}` : "";
  const originLabel = origin ? ` from ${origin}` : "";
  return `${base} ${name}${gradeLabel}${originLabel}, professional B2B commodity product photography, export quality, detailed surface texture. ${suffix}`;
}

export function buildAiPrompt(item: CatalogItemData): string {
  if (item.templateKind === "service") return buildServicePrompt(item);
  return buildProductPrompt(item);
}

// ── Core: generate one image ──────────────────────────────────────────────────

export async function generateSingleImage(opts: {
  vendorCatalogItemId: number;
  vendorId: number | null;
  prompt: string;
  itemName: string;
  uploadedBy: string;
  uploadedByRole: string;
}): Promise<{ mediaId: number; fileUrl: string; storagePath: string }> {
  const openai = getOpenAI();

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: opts.prompt,
    n: 1,
    size: "1024x1024",
    quality: "standard",
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Model tidak mengembalikan gambar");

  const buffer = Buffer.from(b64, "base64");
  const { publicUrl, storagePath } = await uploadToSupabase(buffer, "image/png", "product-media/images");

  const [inserted] = await db.insert(productMediaTable).values({
    vendorCatalogItemId: opts.vendorCatalogItemId,
    vendorId: opts.vendorId,
    mediaType: "image",
    fileUrl: publicUrl,
    storagePath,
    isPrimary: false,
    isActive: true,
    title: `AI — ${opts.itemName}`,
    uploadedBy: opts.uploadedBy,
    uploadedByRole: opts.uploadedByRole,
    sortOrder: 0,
    imageSource: "ai",
    aiImageStatus: "waiting_approval",
    generationPrompt: opts.prompt.slice(0, 2000),
  }).returning();

  return { mediaId: inserted.id, fileUrl: publicUrl, storagePath };
}

// ── Generate N images for one item ────────────────────────────────────────────

export async function generateImagesForItem(opts: {
  item: CatalogItemData;
  uploadedBy: string;
  uploadedByRole: string;
  count?: number;
}): Promise<Array<{ mediaId: number; fileUrl: string; success: boolean; error?: string }>> {
  const count = Math.min(opts.count ?? 4, 4);
  const prompt = buildAiPrompt(opts.item);
  const results: Array<{ mediaId: number; fileUrl: string; success: boolean; error?: string }> = [];

  for (let i = 0; i < count; i++) {
    try {
      const r = await generateSingleImage({
        vendorCatalogItemId: opts.item.id,
        vendorId: opts.item.vendorId ?? null,
        prompt,
        itemName: opts.item.name,
        uploadedBy: opts.uploadedBy,
        uploadedByRole: opts.uploadedByRole,
      });
      results.push({ ...r, success: true });
    } catch (e: any) {
      results.push({ mediaId: -1, fileUrl: "", success: false, error: e?.message });
    }
    if (i < count - 1) await new Promise((r) => setTimeout(r, 600));
  }

  return results;
}

// ── Auto-generate on publish (fire-and-forget) ────────────────────────────────

export async function autoGenerateIfNeeded(itemId: number): Promise<void> {
  try {
    const existing = await db.select({ id: productMediaTable.id, imageSource: productMediaTable.imageSource })
      .from(productMediaTable)
      .where(and(eq(productMediaTable.vendorCatalogItemId, itemId), eq(productMediaTable.isActive, true)));

    if (existing.some((m) => m.imageSource === "vendor")) return;
    if (existing.some((m) => m.imageSource === "ai")) return;

    const [r] = (await db.execute(sql`
      SELECT vci.id, vci.name, vci.template_kind, vci.description, vci.spec_values,
             vci.kategori, vci.service_type, vci.origin, vci.vendor_id,
             s.name AS vendor_name, s.service_type AS vendor_service_type
      FROM vendor_catalog_items vci
      LEFT JOIN suppliers s ON s.id = vci.vendor_id
      WHERE vci.id = ${itemId}
    `)) as unknown as any[];

    if (!r) return;

    await generateImagesForItem({
      item: {
        id: Number(r.id), name: r.name, templateKind: r.template_kind,
        description: r.description, specValues: r.spec_values,
        kategori: r.kategori, serviceType: r.service_type,
        origin: r.origin, vendorId: r.vendor_id ? Number(r.vendor_id) : null,
        vendorName: r.vendor_name, vendorServiceType: r.vendor_service_type,
      },
      uploadedBy: "auto-publish",
      uploadedByRole: "system",
    });
  } catch {
    // silent — best effort
  }
}
