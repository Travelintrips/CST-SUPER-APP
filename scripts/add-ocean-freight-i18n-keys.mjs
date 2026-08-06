/**
 * add-ocean-freight-i18n-keys.mjs
 * Inject 31 new oceanFreightBooking i18n keys into all 18 locale files.
 * Run once from workspace root: node scripts/add-ocean-freight-i18n-keys.mjs
 */

import fs from "node:fs";
import path from "node:path";

const LOCALES_DIR = "artifacts/customer-portal/src/i18n/locales";

// ── Translation data: 31 new keys × 18 locales ──────────────────────────────
// key → locale-code → translated string
const NEW_KEYS = {
  // Phase 3 — hardcoded labels
  tracking: {
    "ar-AE": "التتبع", "ar-SA": "التتبع", "de-DE": "Tracking",
    "en-AU": "Tracking", "en-GB": "Tracking", "en-SG": "Tracking", "en-US": "Tracking",
    "es-ES": "Seguimiento", "fr-FR": "Suivi", "hi-IN": "ट्रैकिंग", "id-ID": "Pelacakan",
    "it-IT": "Tracciamento", "ja-JP": "追跡", "ko-KR": "추적", "ms-MY": "Penjejakan",
    "nl-NL": "Tracking", "zh-CN": "跟踪", "zh-TW": "追蹤",
  },
  titleOceanFreight: {
    "ar-AE": "الشحن البحري", "ar-SA": "الشحن البحري", "de-DE": "Seefracht",
    "en-AU": "Ocean Freight", "en-GB": "Ocean Freight", "en-SG": "Ocean Freight", "en-US": "Ocean Freight",
    "es-ES": "Flete Marítimo", "fr-FR": "Fret Maritime", "hi-IN": "समुद्री माल ढुलाई", "id-ID": "Ocean Freight",
    "it-IT": "Trasporto Marittimo", "ja-JP": "海上貨物", "ko-KR": "해상 화물", "ms-MY": "Kargo Laut",
    "nl-NL": "Zeevracht", "zh-CN": "海运", "zh-TW": "海運",
  },
  labelOriginPort: {
    "ar-AE": "ميناء الشحن *", "ar-SA": "ميناء الشحن *", "de-DE": "Ursprungshafen *",
    "en-AU": "Origin Port *", "en-GB": "Origin Port *", "en-SG": "Origin Port *", "en-US": "Origin Port *",
    "es-ES": "Puerto de Origen *", "fr-FR": "Port d'Origine *", "hi-IN": "मूल बंदरगाह *", "id-ID": "Pelabuhan Asal *",
    "it-IT": "Porto di Origine *", "ja-JP": "出発港 *", "ko-KR": "출발 항구 *", "ms-MY": "Pelabuhan Asal *",
    "nl-NL": "Herkomstshaven *", "zh-CN": "起运港 *", "zh-TW": "出發港 *",
  },
  labelDestPort: {
    "ar-AE": "ميناء الوصول *", "ar-SA": "ميناء الوصول *", "de-DE": "Zielhafen *",
    "en-AU": "Destination Port *", "en-GB": "Destination Port *", "en-SG": "Destination Port *", "en-US": "Destination Port *",
    "es-ES": "Puerto de Destino *", "fr-FR": "Port de Destination *", "hi-IN": "गंतव्य बंदरगाह *", "id-ID": "Pelabuhan Tujuan *",
    "it-IT": "Porto di Destinazione *", "ja-JP": "仕向け港 *", "ko-KR": "도착 항구 *", "ms-MY": "Pelabuhan Destinasi *",
    "nl-NL": "Bestemmingshaven *", "zh-CN": "目的港 *", "zh-TW": "目的港 *",
  },
  labelTradeType: {
    "ar-AE": "نوع التجارة", "ar-SA": "نوع التجارة", "de-DE": "Handelsrichtung",
    "en-AU": "Trade Type", "en-GB": "Trade Type", "en-SG": "Trade Type", "en-US": "Trade Type",
    "es-ES": "Tipo de Comercio", "fr-FR": "Type de Commerce", "hi-IN": "व्यापार प्रकार", "id-ID": "Jenis Perdagangan",
    "it-IT": "Tipo di Commercio", "ja-JP": "取引タイプ", "ko-KR": "무역 유형", "ms-MY": "Jenis Perdagangan",
    "nl-NL": "Handelstype", "zh-CN": "贸易类型", "zh-TW": "貿易類型",
  },
  labelServiceMode: {
    "ar-AE": "نوع الخدمة", "ar-SA": "نوع الخدمة", "de-DE": "Servicetyp",
    "en-AU": "Service Mode", "en-GB": "Service Mode", "en-SG": "Service Mode", "en-US": "Service Mode",
    "es-ES": "Modo de Servicio", "fr-FR": "Mode de Service", "hi-IN": "सेवा मोड", "id-ID": "Mode Layanan",
    "it-IT": "Modalità di Servizio", "ja-JP": "サービスモード", "ko-KR": "서비스 모드", "ms-MY": "Mod Perkhidmatan",
    "nl-NL": "Servicemodus", "zh-CN": "服务模式", "zh-TW": "服務模式",
  },
  labelContainerType: {
    "ar-AE": "نوع الحاوية *", "ar-SA": "نوع الحاوية *", "de-DE": "Containertyp *",
    "en-AU": "Container Type *", "en-GB": "Container Type *", "en-SG": "Container Type *", "en-US": "Container Type *",
    "es-ES": "Tipo de Contenedor *", "fr-FR": "Type de Conteneur *", "hi-IN": "कंटेनर प्रकार *", "id-ID": "Jenis Kontainer *",
    "it-IT": "Tipo di Contenitore *", "ja-JP": "コンテナタイプ *", "ko-KR": "컨테이너 종류 *", "ms-MY": "Jenis Kontena *",
    "nl-NL": "Containertype *", "zh-CN": "集装箱类型 *", "zh-TW": "貨櫃類型 *",
  },
  labelVolumeCbm: {
    "ar-AE": "الحجم (م³)", "ar-SA": "الحجم (م³)", "de-DE": "Volumen (CBM)",
    "en-AU": "Volume (CBM)", "en-GB": "Volume (CBM)", "en-SG": "Volume (CBM)", "en-US": "Volume (CBM)",
    "es-ES": "Volumen (CBM)", "fr-FR": "Volume (CBM)", "hi-IN": "आयतन (CBM)", "id-ID": "Volume (CBM)",
    "it-IT": "Volume (CBM)", "ja-JP": "容量 (CBM)", "ko-KR": "부피 (CBM)", "ms-MY": "Isipadu (CBM)",
    "nl-NL": "Volume (CBM)", "zh-CN": "体积 (CBM)", "zh-TW": "體積 (CBM)",
  },
  transshipmentDirect: {
    "ar-AE": "مباشر", "ar-SA": "مباشر", "de-DE": "Direkt",
    "en-AU": "Direct", "en-GB": "Direct", "en-SG": "Direct", "en-US": "Direct",
    "es-ES": "Directo", "fr-FR": "Direct", "hi-IN": "सीधा", "id-ID": "Langsung",
    "it-IT": "Diretto", "ja-JP": "直行", "ko-KR": "직항", "ms-MY": "Terus",
    "nl-NL": "Direct", "zh-CN": "直航", "zh-TW": "直航",
  },
  transshipmentViaTS: {
    "ar-AE": "عبر T/S", "ar-SA": "عبر T/S", "de-DE": "Via T/S",
    "en-AU": "Via T/S", "en-GB": "Via T/S", "en-SG": "Via T/S", "en-US": "Via T/S",
    "es-ES": "Vía T/S", "fr-FR": "Via T/S", "hi-IN": "Via T/S", "id-ID": "Via T/S",
    "it-IT": "Via T/S", "ja-JP": "T/S経由", "ko-KR": "T/S 경유", "ms-MY": "Via T/S",
    "nl-NL": "Via T/S", "zh-CN": "T/S中转", "zh-TW": "T/S轉運",
  },
  // Phase 4 — trade type options
  tradeTypeExport: {
    "ar-AE": "تصدير", "ar-SA": "تصدير", "de-DE": "Export",
    "en-AU": "Export", "en-GB": "Export", "en-SG": "Export", "en-US": "Export",
    "es-ES": "Exportación", "fr-FR": "Export", "hi-IN": "निर्यात", "id-ID": "Ekspor",
    "it-IT": "Esportazione", "ja-JP": "輸出", "ko-KR": "수출", "ms-MY": "Eksport",
    "nl-NL": "Export", "zh-CN": "出口", "zh-TW": "出口",
  },
  tradeTypeImport: {
    "ar-AE": "استيراد", "ar-SA": "استيراد", "de-DE": "Import",
    "en-AU": "Import", "en-GB": "Import", "en-SG": "Import", "en-US": "Import",
    "es-ES": "Importación", "fr-FR": "Import", "hi-IN": "आयात", "id-ID": "Impor",
    "it-IT": "Importazione", "ja-JP": "輸入", "ko-KR": "수입", "ms-MY": "Import",
    "nl-NL": "Import", "zh-CN": "进口", "zh-TW": "進口",
  },
  tradeTypeDomestic: {
    "ar-AE": "محلي", "ar-SA": "محلي", "de-DE": "Inland",
    "en-AU": "Domestic", "en-GB": "Domestic", "en-SG": "Domestic", "en-US": "Domestic",
    "es-ES": "Doméstico", "fr-FR": "Domestique", "hi-IN": "घरेलू", "id-ID": "Domestik",
    "it-IT": "Domestico", "ja-JP": "国内", "ko-KR": "국내", "ms-MY": "Domestik",
    "nl-NL": "Binnenland", "zh-CN": "国内", "zh-TW": "國內",
  },
  tradeTypeCrossBorder: {
    "ar-AE": "عبر الحدود", "ar-SA": "عبر الحدود", "de-DE": "Grenzüberschreitend",
    "en-AU": "Cross Border", "en-GB": "Cross Border", "en-SG": "Cross Border", "en-US": "Cross Border",
    "es-ES": "Transfronterizo", "fr-FR": "Transfrontalier", "hi-IN": "क्रॉस बॉर्डर", "id-ID": "Lintas Batas",
    "it-IT": "Transfrontaliero", "ja-JP": "越境", "ko-KR": "국경 간", "ms-MY": "Rentas Sempadan",
    "nl-NL": "Grensoverschrijdend", "zh-CN": "跨境", "zh-TW": "跨境",
  },
  // Phase 4 — service mode options
  serviceModePortPort: {
    "ar-AE": "ميناء إلى ميناء", "ar-SA": "ميناء إلى ميناء", "de-DE": "Hafen zu Hafen",
    "en-AU": "Port to Port", "en-GB": "Port to Port", "en-SG": "Port to Port", "en-US": "Port to Port",
    "es-ES": "Puerto a Puerto", "fr-FR": "Port à Port", "hi-IN": "पोर्ट टू पोर्ट", "id-ID": "Pelabuhan ke Pelabuhan",
    "it-IT": "Porto a Porto", "ja-JP": "港→港", "ko-KR": "항구 간", "ms-MY": "Pelabuhan ke Pelabuhan",
    "nl-NL": "Haven tot Haven", "zh-CN": "港到港", "zh-TW": "港到港",
  },
  serviceModeDoorPort: {
    "ar-AE": "من الباب إلى الميناء", "ar-SA": "من الباب إلى الميناء", "de-DE": "Haus zu Hafen",
    "en-AU": "Door to Port", "en-GB": "Door to Port", "en-SG": "Door to Port", "en-US": "Door to Port",
    "es-ES": "Puerta a Puerto", "fr-FR": "Porte à Port", "hi-IN": "डोर टू पोर्ट", "id-ID": "Pintu ke Pelabuhan",
    "it-IT": "Porta a Porto", "ja-JP": "ドア→港", "ko-KR": "도어 → 항구", "ms-MY": "Pintu ke Pelabuhan",
    "nl-NL": "Deur tot Haven", "zh-CN": "门到港", "zh-TW": "門到港",
  },
  serviceModePortDoor: {
    "ar-AE": "من الميناء إلى الباب", "ar-SA": "من الميناء إلى الباب", "de-DE": "Hafen zu Haus",
    "en-AU": "Port to Door", "en-GB": "Port to Door", "en-SG": "Port to Door", "en-US": "Port to Door",
    "es-ES": "Puerto a Puerta", "fr-FR": "Port à Porte", "hi-IN": "पोर्ट टू डोर", "id-ID": "Pelabuhan ke Pintu",
    "it-IT": "Porto a Porta", "ja-JP": "港→ドア", "ko-KR": "항구 → 도어", "ms-MY": "Pelabuhan ke Pintu",
    "nl-NL": "Haven tot Deur", "zh-CN": "港到门", "zh-TW": "港到門",
  },
  serviceModeDoorDoor: {
    "ar-AE": "من الباب إلى الباب", "ar-SA": "من الباب إلى الباب", "de-DE": "Haus zu Haus",
    "en-AU": "Door to Door", "en-GB": "Door to Door", "en-SG": "Door to Door", "en-US": "Door to Door",
    "es-ES": "Puerta a Puerta", "fr-FR": "Porte à Porte", "hi-IN": "डोर टू डोर", "id-ID": "Pintu ke Pintu",
    "it-IT": "Porta a Porta", "ja-JP": "ドア→ドア", "ko-KR": "도어 투 도어", "ms-MY": "Pintu ke Pintu",
    "nl-NL": "Deur tot Deur", "zh-CN": "门到门", "zh-TW": "門到門",
  },
  // Phase 4 — cargo conditions
  cargoGeneral: {
    "ar-AE": "بضائع عامة", "ar-SA": "بضائع عامة", "de-DE": "Allgemeine Fracht",
    "en-AU": "General Cargo", "en-GB": "General Cargo", "en-SG": "General Cargo", "en-US": "General Cargo",
    "es-ES": "Carga General", "fr-FR": "Marchandise Générale", "hi-IN": "सामान्य कार्गो", "id-ID": "Kargo Umum",
    "it-IT": "Merce Generale", "ja-JP": "一般貨物", "ko-KR": "일반 화물", "ms-MY": "Kargo Am",
    "nl-NL": "Algemene Vracht", "zh-CN": "普通货物", "zh-TW": "一般貨物",
  },
  cargoDG: {
    "ar-AE": "بضائع خطرة", "ar-SA": "بضائع خطرة", "de-DE": "Gefahrgut",
    "en-AU": "DG Cargo", "en-GB": "DG Cargo", "en-SG": "DG Cargo", "en-US": "DG Cargo",
    "es-ES": "Mercancía Peligrosa", "fr-FR": "Marchandise Dangereuse", "hi-IN": "DG कार्गो", "id-ID": "Kargo DG",
    "it-IT": "Merce Pericolosa", "ja-JP": "危険物", "ko-KR": "위험 화물", "ms-MY": "Kargo DG",
    "nl-NL": "Gevaarlijke Goederen", "zh-CN": "危险品", "zh-TW": "危險品",
  },
  cargoReefer: {
    "ar-AE": "مبرد", "ar-SA": "مبرد", "de-DE": "Kühlgut",
    "en-AU": "Reefer", "en-GB": "Reefer", "en-SG": "Reefer", "en-US": "Reefer",
    "es-ES": "Refrigerado", "fr-FR": "Réfrigéré", "hi-IN": "रेफर", "id-ID": "Reefer",
    "it-IT": "Refrigerato", "ja-JP": "冷凍冷蔵", "ko-KR": "냉동 화물", "ms-MY": "Reefer",
    "nl-NL": "Koel", "zh-CN": "冷藏", "zh-TW": "冷藏",
  },
  cargoFragile: {
    "ar-AE": "هش", "ar-SA": "هش", "de-DE": "Zerbrechlich",
    "en-AU": "Fragile", "en-GB": "Fragile", "en-SG": "Fragile", "en-US": "Fragile",
    "es-ES": "Frágil", "fr-FR": "Fragile", "hi-IN": "नाजुक", "id-ID": "Rapuh",
    "it-IT": "Fragile", "ja-JP": "壊れ物", "ko-KR": "깨지기 쉬운", "ms-MY": "Mudah Pecah",
    "nl-NL": "Breekbaar", "zh-CN": "易碎品", "zh-TW": "易碎品",
  },
  cargoOversize: {
    "ar-AE": "بالغ الحجم", "ar-SA": "بالغ الحجم", "de-DE": "Übergröße",
    "en-AU": "Oversize", "en-GB": "Oversize", "en-SG": "Oversize", "en-US": "Oversize",
    "es-ES": "Sobredimensionado", "fr-FR": "Surdimensionné", "hi-IN": "बड़े आकार का", "id-ID": "Kelebihan Ukuran",
    "it-IT": "Fuori Misura", "ja-JP": "過大貨物", "ko-KR": "과대 화물", "ms-MY": "Saiz Besar",
    "nl-NL": "Oversized", "zh-CN": "超大件", "zh-TW": "超大件",
  },
  cargoHighValue: {
    "ar-AE": "قيمة عالية", "ar-SA": "قيمة عالية", "de-DE": "Hochwertig",
    "en-AU": "High Value", "en-GB": "High Value", "en-SG": "High Value", "en-US": "High Value",
    "es-ES": "Alto Valor", "fr-FR": "Haute Valeur", "hi-IN": "उच्च मूल्य", "id-ID": "Barang Berharga",
    "it-IT": "Alto Valore", "ja-JP": "高価物", "ko-KR": "고가 화물", "ms-MY": "Nilai Tinggi",
    "nl-NL": "Hoge Waarde", "zh-CN": "贵重品", "zh-TW": "貴重品",
  },
  // Phase 4 — additional services
  addonTruckingPickup: {
    "ar-AE": "شحن بالشاحنة (استلام)", "ar-SA": "شحن بالشاحنة (استلام)", "de-DE": "LKW-Abholung",
    "en-AU": "Trucking Pickup", "en-GB": "Trucking Pickup", "en-SG": "Trucking Pickup", "en-US": "Trucking Pickup",
    "es-ES": "Recogida en Camión", "fr-FR": "Enlèvement Camion", "hi-IN": "ट्रकिंग पिकअप", "id-ID": "Jemput Truk",
    "it-IT": "Ritiro Camion", "ja-JP": "トラック集荷", "ko-KR": "트럭 픽업", "ms-MY": "Kutipan Trak",
    "nl-NL": "Vrachtwagen Ophalen", "zh-CN": "卡车取货", "zh-TW": "卡車取貨",
  },
  addonTruckingDelivery: {
    "ar-AE": "شحن بالشاحنة (توصيل)", "ar-SA": "شحن بالشاحنة (توصيل)", "de-DE": "LKW-Lieferung",
    "en-AU": "Trucking Delivery", "en-GB": "Trucking Delivery", "en-SG": "Trucking Delivery", "en-US": "Trucking Delivery",
    "es-ES": "Entrega en Camión", "fr-FR": "Livraison Camion", "hi-IN": "ट्रकिंग डिलीवरी", "id-ID": "Antar Truk",
    "it-IT": "Consegna Camion", "ja-JP": "トラック配送", "ko-KR": "트럭 배송", "ms-MY": "Penghantaran Trak",
    "nl-NL": "Vrachtwagen Levering", "zh-CN": "卡车送货", "zh-TW": "卡車送貨",
  },
  addonCustoms: {
    "ar-AE": "التخليص الجمركي", "ar-SA": "التخليص الجمركي", "de-DE": "Zollabfertigung",
    "en-AU": "Customs Clearance", "en-GB": "Customs Clearance", "en-SG": "Customs Clearance", "en-US": "Customs Clearance",
    "es-ES": "Despacho Aduanero", "fr-FR": "Dédouanement", "hi-IN": "कस्टम क्लियरेंस", "id-ID": "Kepabeanan",
    "it-IT": "Sdoganamento", "ja-JP": "通関", "ko-KR": "세관 통관", "ms-MY": "Pelepasan Kastam",
    "nl-NL": "Douaneafhandeling", "zh-CN": "报关", "zh-TW": "報關",
  },
  addonInsurance: {
    "ar-AE": "التأمين", "ar-SA": "التأمين", "de-DE": "Versicherung",
    "en-AU": "Insurance", "en-GB": "Insurance", "en-SG": "Insurance", "en-US": "Insurance",
    "es-ES": "Seguro", "fr-FR": "Assurance", "hi-IN": "बीमा", "id-ID": "Asuransi",
    "it-IT": "Assicurazione", "ja-JP": "保険", "ko-KR": "보험", "ms-MY": "Insurans",
    "nl-NL": "Verzekering", "zh-CN": "保险", "zh-TW": "保險",
  },
  addonFumigation: {
    "ar-AE": "التبخير", "ar-SA": "التبخير", "de-DE": "Begasung",
    "en-AU": "Fumigation", "en-GB": "Fumigation", "en-SG": "Fumigation", "en-US": "Fumigation",
    "es-ES": "Fumigación", "fr-FR": "Fumigation", "hi-IN": "फ्यूमिगेशन", "id-ID": "Fumigasi",
    "it-IT": "Fumigazione", "ja-JP": "くん蒸", "ko-KR": "훈증", "ms-MY": "Fumigasi",
    "nl-NL": "Fumigatie", "zh-CN": "熏蒸", "zh-TW": "燻蒸",
  },
  addonCOO: {
    "ar-AE": "شهادة المنشأ", "ar-SA": "شهادة المنشأ", "de-DE": "Ursprungszeugnis",
    "en-AU": "COO / Certificate", "en-GB": "COO / Certificate", "en-SG": "COO / Certificate", "en-US": "COO / Certificate",
    "es-ES": "COO / Certificado", "fr-FR": "COO / Certificat", "hi-IN": "COO / प्रमाण पत्र", "id-ID": "Surat Keterangan Asal",
    "it-IT": "COO / Certificato", "ja-JP": "原産地証明", "ko-KR": "원산지 증명서", "ms-MY": "Sijil Asal",
    "nl-NL": "COO / Certificaat", "zh-CN": "原产地证书", "zh-TW": "原產地證書",
  },
  addonWarehouse: {
    "ar-AE": "معالجة المستودع", "ar-SA": "معالجة المستودع", "de-DE": "Lagerbehandlung",
    "en-AU": "Warehouse Handling", "en-GB": "Warehouse Handling", "en-SG": "Warehouse Handling", "en-US": "Warehouse Handling",
    "es-ES": "Manejo en Almacén", "fr-FR": "Manutention Entrepôt", "hi-IN": "वेयरहाउस हैंडलिंग", "id-ID": "Penanganan Gudang",
    "it-IT": "Gestione Magazzino", "ja-JP": "倉庫作業", "ko-KR": "창고 처리", "ms-MY": "Pengendalian Gudang",
    "nl-NL": "Magazijnbehandeling", "zh-CN": "仓储处理", "zh-TW": "倉儲處理",
  },
};

// ── Quote style detector ──────────────────────────────────────────────────────
function detectQuoteChar(src) {
  // Check what quote style the oceanFreightBooking block uses
  const start = src.indexOf("oceanFreightBooking:");
  if (start === -1) return "'";
  const block = src.slice(start, start + 200);
  const single = (block.match(/'/g) || []).length;
  const dbl = (block.match(/"/g) || []).length;
  return dbl > single ? '"' : "'";
}

// ── Build new keys string ─────────────────────────────────────────────────────
function buildNewKeysString(localeCode, indent, quote) {
  const q = quote;
  return Object.entries(NEW_KEYS)
    .map(([key, translations]) => {
      const val = translations[localeCode] ?? translations["en-US"];
      const escaped = val.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`);
      return `${indent}${key}: ${q}${escaped}${q},`;
    })
    .join("\n");
}

// ── Inject into file ──────────────────────────────────────────────────────────
function injectKeys(filePath, localeCode) {
  let src = fs.readFileSync(filePath, "utf-8");

  const nsStart = src.indexOf("oceanFreightBooking:");
  if (nsStart === -1) {
    console.warn(`  SKIP ${localeCode}: oceanFreightBooking namespace not found`);
    return false;
  }

  // Already patched? Check for first new key
  if (src.includes("tradeTypeExport:") && src.includes("addonWarehouse:")) {
    console.log(`  SKIP ${localeCode}: keys already present`);
    return false;
  }

  // Find the closing brace of the oceanFreightBooking block
  let depth = 0;
  let i = src.indexOf("{", nsStart);
  let blockEnd = -1;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { blockEnd = i; break; }
    }
    i++;
  }

  if (blockEnd === -1) {
    console.warn(`  SKIP ${localeCode}: could not find block end`);
    return false;
  }

  // Determine indentation from existing keys
  const blockContent = src.slice(src.indexOf("{", nsStart) + 1, blockEnd);
  const indentMatch = blockContent.match(/\n(\s+)\w/);
  const indent = indentMatch ? indentMatch[1] : "    ";

  const quote = detectQuoteChar(src.slice(nsStart, blockEnd));
  const newKeysStr = buildNewKeysString(localeCode, indent, quote);

  // Insert before the closing brace
  const before = src.slice(0, blockEnd);
  const after = src.slice(blockEnd);
  src = `${before}\n${newKeysStr}\n${after}`;

  fs.writeFileSync(filePath, src, "utf-8");
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const localeFiles = fs.readdirSync(LOCALES_DIR)
  .filter(f => f.endsWith(".ts") && f !== "types.ts")
  .sort();

let patched = 0;
let skipped = 0;

console.log(`\nPatching ${localeFiles.length} locale files with ${Object.keys(NEW_KEYS).length} new keys...\n`);
for (const file of localeFiles) {
  const localeCode = file.replace(".ts", "");
  const filePath = path.join(LOCALES_DIR, file);
  console.log(`Processing ${localeCode}...`);
  try {
    const ok = injectKeys(filePath, localeCode);
    if (ok) patched++;
    else skipped++;
  } catch (err) {
    console.error(`  ERROR ${localeCode}:`, err.message);
  }
}

console.log(`\nDone: ${patched} patched, ${skipped} skipped.`);
