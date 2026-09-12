#!/usr/bin/env python3
"""
Add new i18n keys to customer-portal translations.ts for all 18 locales.
Idempotent: skips keys that already exist.
"""
import re, sys, os

FILE = os.path.join(os.path.dirname(__file__), "../artifacts/customer-portal/src/i18n/translations.ts")
LOCALES = ["id-ID","en-US","en-GB","en-AU","en-SG","zh-CN","zh-TW","ja-JP","ko-KR","ms-MY","de-DE","fr-FR","nl-NL","es-ES","it-IT","hi-IN","ar-AE","ar-SA"]

# ── Translation data ────────────────────────────────────────────────────────────
# Format: NEW_KEYS[namespace][key][locale] = value

def T(**kw):
    """Helper: build locale dict. Provide overrides; missing locales keep 'en-US'."""
    base = kw.get("en_US", kw.get("en", ""))
    result = {}
    for loc in LOCALES:
        key = loc.replace("-","_")
        result[loc] = kw.get(key, kw.get("en", base))
    # explicit overrides
    for k,v in kw.items():
        loc = k.replace("_","-")
        if loc in LOCALES:
            result[loc] = v
    return result

NEW_KEYS = {
    # ── pabean ─────────────────────────────────────────────────────────────────
    "pabean": {
        "emailLabel": T(**{"id-ID":"Email","en-US":"Email","en-GB":"Email","en-AU":"Email","en-SG":"Email","zh-CN":"电子邮件","zh-TW":"電子郵件","ja-JP":"メールアドレス","ko-KR":"이메일","ms-MY":"E-mel","de-DE":"E-Mail","fr-FR":"E-mail","nl-NL":"E-mail","es-ES":"Correo electrónico","it-IT":"E-mail","hi-IN":"ईमेल","ar-AE":"البريد الإلكتروني","ar-SA":"البريد الإلكتروني"}),
        "phoneLabel": T(**{"id-ID":"Telepon / WhatsApp","en-US":"Phone / WhatsApp","en-GB":"Phone / WhatsApp","en-AU":"Phone / WhatsApp","en-SG":"Phone / WhatsApp","zh-CN":"电话 / WhatsApp","zh-TW":"電話 / WhatsApp","ja-JP":"電話番号 / WhatsApp","ko-KR":"전화 / WhatsApp","ms-MY":"Telefon / WhatsApp","de-DE":"Telefon / WhatsApp","fr-FR":"Téléphone / WhatsApp","nl-NL":"Telefoon / WhatsApp","es-ES":"Teléfono / WhatsApp","it-IT":"Telefono / WhatsApp","hi-IN":"फ़ोन / WhatsApp","ar-AE":"الهاتف / واتساب","ar-SA":"الهاتف / واتساب"}),
        "uploadLogoTitle": T(**{"id-ID":"Upload logo","en-US":"Upload logo","en-GB":"Upload logo","en-AU":"Upload logo","en-SG":"Upload logo","zh-CN":"上传 Logo","zh-TW":"上傳 Logo","ja-JP":"ロゴをアップロード","ko-KR":"로고 업로드","ms-MY":"Muat naik logo","de-DE":"Logo hochladen","fr-FR":"Télécharger le logo","nl-NL":"Logo uploaden","es-ES":"Subir logo","it-IT":"Carica logo","hi-IN":"लोगो अपलोड करें","ar-AE":"رفع الشعار","ar-SA":"رفع الشعار"}),
        "removeLogoTitle": T(**{"id-ID":"Hapus logo","en-US":"Remove logo","en-GB":"Remove logo","en-AU":"Remove logo","en-SG":"Remove logo","zh-CN":"删除 Logo","zh-TW":"移除 Logo","ja-JP":"ロゴを削除","ko-KR":"로고 삭제","ms-MY":"Buang logo","de-DE":"Logo entfernen","fr-FR":"Supprimer le logo","nl-NL":"Logo verwijderen","es-ES":"Eliminar logo","it-IT":"Rimuovi logo","hi-IN":"लोगो हटाएं","ar-AE":"إزالة الشعار","ar-SA":"إزالة الشعار"}),
        "hoverUploadHint": T(**{"id-ID":"Arahkan kursor → upload logo","en-US":"Hover icon → upload logo","en-GB":"Hover icon → upload logo","en-AU":"Hover icon → upload logo","en-SG":"Hover icon → upload logo","zh-CN":"悬停图标 → 上传 Logo","zh-TW":"懸停圖示 → 上傳 Logo","ja-JP":"アイコンにホバー → ロゴをアップロード","ko-KR":"아이콘에 마우스 올리기 → 로고 업로드","ms-MY":"Arahkan kursor → muat naik logo","de-DE":"Symbol berühren → Logo hochladen","fr-FR":"Survoler l'icône → télécharger le logo","nl-NL":"Icoon aanwijzen → logo uploaden","es-ES":"Pasar el cursor → subir logo","it-IT":"Passa il cursore → carica logo","hi-IN":"आइकन पर जाएं → लोगो अपलोड करें","ar-AE":"مرر المؤشر على الأيقونة → رفع الشعار","ar-SA":"مرر المؤشر على الأيقونة → رفع الشعار"}),
    },

    # ── customClearance ────────────────────────────────────────────────────────
    "customClearance": {
        "emailLabel": T(**{"id-ID":"Email","en-US":"Email","en-GB":"Email","en-AU":"Email","en-SG":"Email","zh-CN":"电子邮件","zh-TW":"電子郵件","ja-JP":"メールアドレス","ko-KR":"이메일","ms-MY":"E-mel","de-DE":"E-Mail","fr-FR":"E-mail","nl-NL":"E-mail","es-ES":"Correo electrónico","it-IT":"E-mail","hi-IN":"ईमेल","ar-AE":"البريد الإلكتروني","ar-SA":"البريد الإلكتروني"}),
        "phoneLabel": T(**{"id-ID":"Telepon / WhatsApp","en-US":"Phone / WhatsApp","en-GB":"Phone / WhatsApp","en-AU":"Phone / WhatsApp","en-SG":"Phone / WhatsApp","zh-CN":"电话 / WhatsApp","zh-TW":"電話 / WhatsApp","ja-JP":"電話番号 / WhatsApp","ko-KR":"전화 / WhatsApp","ms-MY":"Telefon / WhatsApp","de-DE":"Telefon / WhatsApp","fr-FR":"Téléphone / WhatsApp","nl-NL":"Telefoon / WhatsApp","es-ES":"Teléfono / WhatsApp","it-IT":"Telefono / WhatsApp","hi-IN":"फ़ोन / WhatsApp","ar-AE":"الهاتف / واتساب","ar-SA":"الهاتف / واتساب"}),
        "labelExchangeRate": T(**{"id-ID":"Kurs {currency} → IDR","en-US":"Rate {currency} → IDR","en-GB":"Rate {currency} → IDR","en-AU":"Rate {currency} → IDR","en-SG":"Rate {currency} → IDR","zh-CN":"汇率 {currency} → IDR","zh-TW":"匯率 {currency} → IDR","ja-JP":"レート {currency} → IDR","ko-KR":"환율 {currency} → IDR","ms-MY":"Kadar {currency} → IDR","de-DE":"Kurs {currency} → IDR","fr-FR":"Taux {currency} → IDR","nl-NL":"Koers {currency} → IDR","es-ES":"Tasa {currency} → IDR","it-IT":"Tasso {currency} → IDR","hi-IN":"दर {currency} → IDR","ar-AE":"سعر الصرف {currency} → IDR","ar-SA":"سعر الصرف {currency} → IDR"}),
        "labelValue": T(**{"id-ID":"Nilai","en-US":"Value","en-GB":"Value","en-AU":"Value","en-SG":"Value","zh-CN":"价值","zh-TW":"價值","ja-JP":"金額","ko-KR":"금액","ms-MY":"Nilai","de-DE":"Betrag","fr-FR":"Valeur","nl-NL":"Waarde","es-ES":"Valor","it-IT":"Valore","hi-IN":"मूल्य","ar-AE":"القيمة","ar-SA":"القيمة"}),
        "valueCifLabel": T(**{"id-ID":"Nilai {type} (setara IDR)","en-US":"{type} Value (equiv. IDR)","en-GB":"{type} Value (equiv. IDR)","en-AU":"{type} Value (equiv. IDR)","en-SG":"{type} Value (equiv. IDR)","zh-CN":"{type} 价值（等值 IDR）","zh-TW":"{type} 價值（等值 IDR）","ja-JP":"{type} 価値（IDR 換算）","ko-KR":"{type} 가격 (IDR 환산)","ms-MY":"Nilai {type} (setara IDR)","de-DE":"{type}-Wert (IDR-Äquivalent)","fr-FR":"Valeur {type} (équiv. IDR)","nl-NL":"{type} Waarde (IDR equiv.)","es-ES":"Valor {type} (equiv. IDR)","it-IT":"Valore {type} (equiv. IDR)","hi-IN":"{type} मूल्य (IDR के बराबर)","ar-AE":"قيمة {type} (ما يعادل IDR)","ar-SA":"قيمة {type} (ما يعادل IDR)"}),
        "handlingLaneLabel": T(**{"id-ID":"Handling — Jalur","en-US":"Handling — Lane","en-GB":"Handling — Lane","en-AU":"Handling — Lane","en-SG":"Handling — Lane","zh-CN":"报关 — 通道","zh-TW":"報關 — 通道","ja-JP":"通関 — ルート","ko-KR":"통관 — 경로","ms-MY":"Pengendalian — Laluan","de-DE":"Abfertigung — Weg","fr-FR":"Dédouanement — Voie","nl-NL":"Inklaring — Baan","es-ES":"Despacho — Vía","it-IT":"Sdoganamento — Corsia","hi-IN":"कस्टम — मार्ग","ar-AE":"التخليص — المسار","ar-SA":"التخليص — المسار"}),
        "undernamCountryLabel": T(**{"id-ID":"Undername — Negara","en-US":"Undername — Country","en-GB":"Undername — Country","en-AU":"Undername — Country","en-SG":"Undername — Country","zh-CN":"代理进口 — 国家","zh-TW":"代理進口 — 國家","ja-JP":"アンダーネーム — 国","ko-KR":"언더네임 — 국가","ms-MY":"Undername — Negara","de-DE":"Undername — Land","fr-FR":"Importation pour compte — Pays","nl-NL":"Undername — Land","es-ES":"Undername — País","it-IT":"Undername — Paese","hi-IN":"अंडरनाम — देश","ar-AE":"الاسم التحتي — الدولة","ar-SA":"الاسم التحتي — الدولة"}),
        "phGoods1": T(**{"id-ID":"Contoh: Mesin Produksi, Garmen, Produk Elektronik...","en-US":"e.g. Production Machinery, Garment, Electronic Products...","en-GB":"e.g. Production Machinery, Garment, Electronic Products...","en-AU":"e.g. Production Machinery, Garment, Electronic Products...","en-SG":"e.g. Production Machinery, Garment, Electronic Products...","zh-CN":"例如：生产机械、服装、电子产品...","zh-TW":"例如：生產機械、服裝、電子產品...","ja-JP":"例：生産機械、衣料品、電子製品...","ko-KR":"예: 생산 기계, 의류, 전자 제품...","ms-MY":"Contoh: Mesin Pengeluaran, Pakaian, Produk Elektronik...","de-DE":"z.B. Produktionsmaschinen, Bekleidung, Elektronik...","fr-FR":"Ex. Machines de production, Vêtements, Produits électroniques...","nl-NL":"Bijv. Productiemachines, Kleding, Elektronische producten...","es-ES":"Ej.: Maquinaria de producción, Ropa, Productos electrónicos...","it-IT":"Es.: Macchinari, Abbigliamento, Prodotti elettronici...","hi-IN":"उदा.: उत्पादन मशीनरी, वस्त्र, इलेक्ट्रॉनिक उत्पाद...","ar-AE":"مثال: آلات إنتاج، ملابس، منتجات إلكترونية...","ar-SA":"مثال: آلات إنتاج، ملابس، منتجات إلكترونية..."}),
        "phHsCode": T(**{"id-ID":"Contoh: 8477.80.00","en-US":"e.g. 8477.80.00","en-GB":"e.g. 8477.80.00","en-AU":"e.g. 8477.80.00","en-SG":"e.g. 8477.80.00","zh-CN":"例：8477.80.00","zh-TW":"例：8477.80.00","ja-JP":"例：8477.80.00","ko-KR":"예: 8477.80.00","ms-MY":"Contoh: 8477.80.00","de-DE":"z.B. 8477.80.00","fr-FR":"Ex. 8477.80.00","nl-NL":"Bijv. 8477.80.00","es-ES":"Ej.: 8477.80.00","it-IT":"Es.: 8477.80.00","hi-IN":"उदा.: 8477.80.00","ar-AE":"مثال: 8477.80.00","ar-SA":"مثال: 8477.80.00"}),
        "phValueNumber": T(**{"id-ID":"Contoh: 15000","en-US":"e.g. 15000","en-GB":"e.g. 15000","en-AU":"e.g. 15000","en-SG":"e.g. 15000","zh-CN":"例：15000","zh-TW":"例：15000","ja-JP":"例：15000","ko-KR":"예: 15000","ms-MY":"Contoh: 15000","de-DE":"z.B. 15000","fr-FR":"Ex. 15000","nl-NL":"Bijv. 15000","es-ES":"Ej.: 15000","it-IT":"Es.: 15000","hi-IN":"उदा.: 15000","ar-AE":"مثال: 15000","ar-SA":"مثال: 15000"}),
        "phExchangeRate": T(**{"id-ID":"Contoh: 15900","en-US":"e.g. 15900","en-GB":"e.g. 15900","en-AU":"e.g. 15900","en-SG":"e.g. 15900","zh-CN":"例：15900","zh-TW":"例：15900","ja-JP":"例：15900","ko-KR":"예: 15900","ms-MY":"Contoh: 15900","de-DE":"z.B. 15900","fr-FR":"Ex. 15900","nl-NL":"Bijv. 15900","es-ES":"Ej.: 15900","it-IT":"Es.: 15900","hi-IN":"उदा.: 15900","ar-AE":"مثال: 15900","ar-SA":"مثال: 15900"}),
        "phWeight": T(**{"id-ID":"Contoh: 500","en-US":"e.g. 500","en-GB":"e.g. 500","en-AU":"e.g. 500","en-SG":"e.g. 500","zh-CN":"例：500","zh-TW":"例：500","ja-JP":"例：500","ko-KR":"예: 500","ms-MY":"Contoh: 500","de-DE":"z.B. 500","fr-FR":"Ex. 500","nl-NL":"Bijv. 500","es-ES":"Ej.: 500","it-IT":"Es.: 500","hi-IN":"उदा.: 500","ar-AE":"مثال: 500","ar-SA":"مثال: 500"}),
        "phCountry1": T(**{"id-ID":"Contoh: China, Amerika Serikat, Jepang...","en-US":"e.g. China, United States, Japan...","en-GB":"e.g. China, United States, Japan...","en-AU":"e.g. China, United States, Japan...","en-SG":"e.g. China, United States, Japan...","zh-CN":"例如：中国、美国、日本...","zh-TW":"例如：中國、美國、日本...","ja-JP":"例：中国、アメリカ、日本...","ko-KR":"예: 중국, 미국, 일본...","ms-MY":"Contoh: China, Amerika Syarikat, Jepun...","de-DE":"z.B. China, USA, Japan...","fr-FR":"Ex. Chine, États-Unis, Japon...","nl-NL":"Bijv. China, VS, Japan...","es-ES":"Ej.: China, EE.UU., Japón...","it-IT":"Es.: Cina, USA, Giappone...","hi-IN":"उदा.: चीन, अमेरिका, जापान...","ar-AE":"مثال: الصين، الولايات المتحدة، اليابان...","ar-SA":"مثال: الصين، الولايات المتحدة، اليابان..."}),
        "phSpecialNotesPib": T(**{"id-ID":"Contoh: perlu LarTas dari Kemendag, ada fasilitas KITE, barang sensitif, dll.","en-US":"e.g. special import permit required, KITE facility available, sensitive goods, etc.","en-GB":"e.g. special import permit required, KITE facility available, sensitive goods, etc.","en-AU":"e.g. special import permit required, KITE facility available, sensitive goods, etc.","en-SG":"e.g. special import permit required, KITE facility available, sensitive goods, etc.","zh-CN":"例如：需要特殊进口许可证，有优惠税率，敏感商品等","zh-TW":"例如：需特殊進口許可證，有優惠稅率，敏感商品等","ja-JP":"例：特別輸入許可が必要、優遇税制あり、敏感商品など","ko-KR":"예: 특별 수입 허가 필요, 우대 관세 적용, 민감 물품 등","ms-MY":"Contoh: memerlukan lesen import khas, kemudahan KITE, barang sensitif, dll.","de-DE":"z.B. spezielle Einfuhrgenehmigung erforderlich, KITE-Fazilität, sensible Waren usw.","fr-FR":"Ex. licence d'importation spéciale requise, facilité KITE, marchandises sensibles, etc.","nl-NL":"Bijv. speciale invoervergunning vereist, KITE-faciliteit, gevoelige goederen, etc.","es-ES":"Ej.: necesita permiso especial de importación, facilidad KITE, bienes sensibles, etc.","it-IT":"Es.: richiede licenza speciale di importazione, agevolazione KITE, merci sensibili, ecc.","hi-IN":"उदा.: विशेष आयात लाइसेंस की जरूरत, KITE सुविधा, संवेदनशील सामान, आदि","ar-AE":"مثال: يتطلب تصريح استيراد خاص، تسهيل KITE، بضائع حساسة، إلخ","ar-SA":"مثال: يتطلب تصريح استيراد خاص، تسهيل KITE، بضائع حساسة، إلخ"}),
        "phGoods2": T(**{"id-ID":"Contoh: Spare Part, Tekstil, Bahan Kimia...","en-US":"e.g. Spare Parts, Textiles, Chemicals...","en-GB":"e.g. Spare Parts, Textiles, Chemicals...","en-AU":"e.g. Spare Parts, Textiles, Chemicals...","en-SG":"e.g. Spare Parts, Textiles, Chemicals...","zh-CN":"例如：零件、纺织品、化学品...","zh-TW":"例如：零件、紡織品、化學品...","ja-JP":"例：スペアパーツ、繊維、化学品...","ko-KR":"예: 부품, 섬유, 화학물질...","ms-MY":"Contoh: Alat Ganti, Tekstil, Bahan Kimia...","de-DE":"z.B. Ersatzteile, Textilien, Chemikalien...","fr-FR":"Ex. Pièces détachées, Textiles, Produits chimiques...","nl-NL":"Bijv. Reserveonderdelen, Textiel, Chemicaliën...","es-ES":"Ej.: Repuestos, Textiles, Productos químicos...","it-IT":"Es.: Ricambi, Tessili, Prodotti chimici...","hi-IN":"उदा.: स्पेयर पार्ट्स, टेक्सटाइल, रसायन...","ar-AE":"مثال: قطع غيار، منسوجات، مواد كيميائية...","ar-SA":"مثال: قطع غيار، منسوجات، مواد كيميائية..."}),
        "phPibPebDocNum": T(**{"id-ID":"Nomor dokumen PIB/PEB","en-US":"PIB/PEB document number","en-GB":"PIB/PEB document number","en-AU":"PIB/PEB document number","en-SG":"PIB/PEB document number","zh-CN":"PIB/PEB 文件编号","zh-TW":"PIB/PEB 文件編號","ja-JP":"PIB/PEB 書類番号","ko-KR":"PIB/PEB 서류 번호","ms-MY":"Nombor dokumen PIB/PEB","de-DE":"PIB/PEB Dokumentennummer","fr-FR":"Numéro de document PIB/PEB","nl-NL":"PIB/PEB documentnummer","es-ES":"Número de documento PIB/PEB","it-IT":"Numero documento PIB/PEB","hi-IN":"PIB/PEB दस्तावेज़ संख्या","ar-AE":"رقم وثيقة PIB/PEB","ar-SA":"رقم وثيقة PIB/PEB"}),
        "phSpecialNotesHc": T(**{"id-ID":"Misal: barang ada pembatasan khusus, perlu koordinasi gudang...","en-US":"e.g. special goods restrictions, warehouse coordination needed...","en-GB":"e.g. special goods restrictions, warehouse coordination needed...","en-AU":"e.g. special goods restrictions, warehouse coordination needed...","en-SG":"e.g. special goods restrictions, warehouse coordination needed...","zh-CN":"例如：商品有特殊限制，需要仓库协调...","zh-TW":"例如：商品有特殊限制，需要倉庫協調...","ja-JP":"例：商品に特別な制限あり、倉庫調整が必要...","ko-KR":"예: 상품에 특별 제한 있음, 창고 조율 필요...","ms-MY":"Contoh: barang ada sekatan khas, perlu koordinasi gudang...","de-DE":"z.B. spezielle Warenbeschränkungen, Lagerkoordination erforderlich...","fr-FR":"Ex. restrictions spéciales sur les marchandises, coordination entrepôt requise...","nl-NL":"Bijv. speciale beperkingen goederen, magazijncoördinatie vereist...","es-ES":"Ej.: restricciones especiales en mercancías, coordinación almacén necesaria...","it-IT":"Es.: restrizioni speciali merci, coordinamento magazzino necessario...","hi-IN":"उदा.: माल पर विशेष प्रतिबंध, गोदाम समन्वय आवश्यक...","ar-AE":"مثال: توجد قيود خاصة على البضائع، يلزم تنسيق المستودع...","ar-SA":"مثال: توجد قيود خاصة على البضائع، يلزم تنسيق المستودع..."}),
        "phGoods3": T(**{"id-ID":"Contoh: Mesin, Bahan Baku, Produk Konsumsi...","en-US":"e.g. Machinery, Raw Materials, Consumer Products...","en-GB":"e.g. Machinery, Raw Materials, Consumer Products...","en-AU":"e.g. Machinery, Raw Materials, Consumer Products...","en-SG":"e.g. Machinery, Raw Materials, Consumer Products...","zh-CN":"例如：机械、原材料、消费品...","zh-TW":"例如：機械、原材料、消費品...","ja-JP":"例：機械、原材料、消費財...","ko-KR":"예: 기계, 원자재, 소비재...","ms-MY":"Contoh: Mesin, Bahan Mentah, Produk Pengguna...","de-DE":"z.B. Maschinen, Rohstoffe, Konsumgüter...","fr-FR":"Ex. Machines, Matières premières, Produits de consommation...","nl-NL":"Bijv. Machines, Grondstoffen, Consumptiegoederen...","es-ES":"Ej.: Maquinaria, Materias primas, Productos de consumo...","it-IT":"Es.: Macchinari, Materie prime, Prodotti di consumo...","hi-IN":"उदा.: मशीनरी, कच्चा माल, उपभोक्ता उत्पाद...","ar-AE":"مثال: آلات، مواد خام، منتجات استهلاكية...","ar-SA":"مثال: آلات، مواد خام، منتجات استهلاكية..."}),
        "phValueNumber2": T(**{"id-ID":"Contoh: 20000","en-US":"e.g. 20000","en-GB":"e.g. 20000","en-AU":"e.g. 20000","en-SG":"e.g. 20000","zh-CN":"例：20000","zh-TW":"例：20000","ja-JP":"例：20000","ko-KR":"예: 20000","ms-MY":"Contoh: 20000","de-DE":"z.B. 20000","fr-FR":"Ex. 20000","nl-NL":"Bijv. 20000","es-ES":"Ej.: 20000","it-IT":"Es.: 20000","hi-IN":"उदा.: 20000","ar-AE":"مثال: 20000","ar-SA":"مثال: 20000"}),
        "phWeight2": T(**{"id-ID":"Contoh: 1000","en-US":"e.g. 1000","en-GB":"e.g. 1000","en-AU":"e.g. 1000","en-SG":"e.g. 1000","zh-CN":"例：1000","zh-TW":"例：1000","ja-JP":"例：1000","ko-KR":"예: 1000","ms-MY":"Contoh: 1000","de-DE":"z.B. 1000","fr-FR":"Ex. 1000","nl-NL":"Bijv. 1000","es-ES":"Ej.: 1000","it-IT":"Es.: 1000","hi-IN":"उदा.: 1000","ar-AE":"مثال: 1000","ar-SA":"مثال: 1000"}),
        "phCountry2": T(**{"id-ID":"Contoh: China, Jerman, Amerika Serikat...","en-US":"e.g. China, Germany, United States...","en-GB":"e.g. China, Germany, United States...","en-AU":"e.g. China, Germany, United States...","en-SG":"e.g. China, Germany, United States...","zh-CN":"例如：中国、德国、美国...","zh-TW":"例如：中國、德國、美國...","ja-JP":"例：中国、ドイツ、アメリカ...","ko-KR":"예: 중국, 독일, 미국...","ms-MY":"Contoh: China, Jerman, Amerika Syarikat...","de-DE":"z.B. China, Deutschland, USA...","fr-FR":"Ex. Chine, Allemagne, États-Unis...","nl-NL":"Bijv. China, Duitsland, VS...","es-ES":"Ej.: China, Alemania, EE.UU....","it-IT":"Es.: Cina, Germania, USA...","hi-IN":"उदा.: चीन, जर्मनी, अमेरिका...","ar-AE":"مثال: الصين، ألمانيا، الولايات المتحدة...","ar-SA":"مثال: الصين، ألمانيا، الولايات المتحدة..."}),
        "phSpecialNotesUn": T(**{"id-ID":"Contoh: perusahaan belum memiliki API Umum, masih proses pengurusan NIB, dll.","en-US":"e.g. company does not yet have API license, NIB registration in progress, etc.","en-GB":"e.g. company does not yet have API license, NIB registration in progress, etc.","en-AU":"e.g. company does not yet have API license, NIB registration in progress, etc.","en-SG":"e.g. company does not yet have API license, NIB registration in progress, etc.","zh-CN":"例如：公司尚未取得API许可证，NIB注册进行中等","zh-TW":"例如：公司尚未取得API許可證，NIB註冊進行中等","ja-JP":"例：会社がAPIライセンスを未取得、NIB登録中など","ko-KR":"예: 회사 API 라이선스 미보유, NIB 등록 진행 중 등","ms-MY":"Contoh: syarikat belum memiliki lesen API Umum, proses pendaftaran NIB, dll.","de-DE":"z.B. Unternehmen hat noch keine API-Lizenz, NIB-Registrierung läuft, usw.","fr-FR":"Ex. l'entreprise n'a pas encore de licence API, enregistrement NIB en cours, etc.","nl-NL":"Bijv. bedrijf heeft nog geen API-licentie, NIB-registratie loopt, etc.","es-ES":"Ej.: empresa sin licencia API aún, registro NIB en proceso, etc.","it-IT":"Es.: azienda senza licenza API, registrazione NIB in corso, ecc.","hi-IN":"उदा.: कंपनी के पास अभी API लाइसेंस नहीं है, NIB पंजीकरण प्रक्रिया में है, आदि","ar-AE":"مثال: الشركة لا تملك ترخيص API بعد، تسجيل NIB قيد المعالجة، إلخ","ar-SA":"مثال: الشركة لا تملك ترخيص API بعد، تسجيل NIB قيد المعالجة، إلخ"}),
    },

    # ── marketplace ────────────────────────────────────────────────────────────
    "marketplace": {
        "loadingMobile": T(**{"id-ID":"Memuat...","en-US":"Loading...","en-GB":"Loading...","en-AU":"Loading...","en-SG":"Loading...","zh-CN":"加载中...","zh-TW":"載入中...","ja-JP":"読み込み中...","ko-KR":"로딩 중...","ms-MY":"Memuatkan...","de-DE":"Laden...","fr-FR":"Chargement...","nl-NL":"Laden...","es-ES":"Cargando...","it-IT":"Caricamento...","hi-IN":"लोड हो रहा है...","ar-AE":"جارٍ التحميل...","ar-SA":"جارٍ التحميل..."}),
        "loadingProducts": T(**{"id-ID":"Memuat produk...","en-US":"Loading products...","en-GB":"Loading products...","en-AU":"Loading products...","en-SG":"Loading products...","zh-CN":"正在加载产品...","zh-TW":"正在載入產品...","ja-JP":"商品を読み込み中...","ko-KR":"상품 로딩 중...","ms-MY":"Memuatkan produk...","de-DE":"Produkte werden geladen...","fr-FR":"Chargement des produits...","nl-NL":"Producten laden...","es-ES":"Cargando productos...","it-IT":"Caricamento prodotti...","hi-IN":"उत्पाद लोड हो रहे हैं...","ar-AE":"جارٍ تحميل المنتجات...","ar-SA":"جارٍ تحميل المنتجات..."}),
        "resetFiltersCount": T(**{"id-ID":"Reset ({n})","en-US":"Reset ({n})","en-GB":"Reset ({n})","en-AU":"Reset ({n})","en-SG":"Reset ({n})","zh-CN":"重置 ({n})","zh-TW":"重置 ({n})","ja-JP":"リセット ({n})","ko-KR":"초기화 ({n})","ms-MY":"Set Semula ({n})","de-DE":"Zurücksetzen ({n})","fr-FR":"Réinitialiser ({n})","nl-NL":"Resetten ({n})","es-ES":"Restablecer ({n})","it-IT":"Reimposta ({n})","hi-IN":"रीसेट ({n})","ar-AE":"إعادة ضبط ({n})","ar-SA":"إعادة ضبط ({n})"}),
        "noProductsMatch": T(**{"id-ID":"Tidak ada produk yang cocok.","en-US":"No matching products found.","en-GB":"No matching products found.","en-AU":"No matching products found.","en-SG":"No matching products found.","zh-CN":"未找到匹配的产品。","zh-TW":"找不到符合的產品。","ja-JP":"一致する商品が見つかりません。","ko-KR":"일치하는 상품이 없습니다.","ms-MY":"Tiada produk yang sepadan.","de-DE":"Keine passenden Produkte gefunden.","fr-FR":"Aucun produit correspondant trouvé.","nl-NL":"Geen overeenkomende producten gevonden.","es-ES":"No se encontraron productos que coincidan.","it-IT":"Nessun prodotto corrispondente trovato.","hi-IN":"कोई मेल खाने वाला उत्पाद नहीं मिला।","ar-AE":"لا توجد منتجات مطابقة.","ar-SA":"لا توجد منتجات مطابقة."}),
        "tryChangeFilters": T(**{"id-ID":"Coba ubah atau hapus filter untuk melihat lebih banyak item.","en-US":"Try changing or removing filters to see more items.","en-GB":"Try changing or removing filters to see more items.","en-AU":"Try changing or removing filters to see more items.","en-SG":"Try changing or removing filters to see more items.","zh-CN":"尝试更改或移除筛选条件以查看更多商品。","zh-TW":"嘗試更改或移除篩選條件以查看更多商品。","ja-JP":"フィルターを変更または削除して、より多くの商品を表示してください。","ko-KR":"필터를 변경하거나 제거하여 더 많은 상품을 확인하세요.","ms-MY":"Cuba ubah atau buang penapis untuk melihat lebih banyak item.","de-DE":"Versuchen Sie, Filter zu ändern oder zu entfernen, um mehr Artikel zu sehen.","fr-FR":"Essayez de modifier ou supprimer des filtres pour voir plus d'articles.","nl-NL":"Probeer filters aan te passen of te verwijderen om meer items te zien.","es-ES":"Intente cambiar o eliminar filtros para ver más artículos.","it-IT":"Prova a modificare o rimuovere i filtri per vedere più articoli.","hi-IN":"अधिक आइटम देखने के लिए फ़िल्टर बदलें या हटाएं।","ar-AE":"حاول تغيير الفلاتر أو إزالتها لرؤية المزيد من العناصر.","ar-SA":"حاول تغيير الفلاتر أو إزالتها لرؤية المزيد من العناصر."}),
        "comingSoonHeader": T(**{"id-ID":"Segera Hadir","en-US":"Coming Soon","en-GB":"Coming Soon","en-AU":"Coming Soon","en-SG":"Coming Soon","zh-CN":"即将推出","zh-TW":"即將推出","ja-JP":"近日公開","ko-KR":"곧 출시 예정","ms-MY":"Akan Datang","de-DE":"Demnächst verfügbar","fr-FR":"Bientôt disponible","nl-NL":"Binnenkort beschikbaar","es-ES":"Próximamente","it-IT":"Prossimamente","hi-IN":"जल्द आ रहा है","ar-AE":"قريباً","ar-SA":"قريباً"}),
    },

    # ── mktCard ────────────────────────────────────────────────────────────────
    "mktCard": {
        "moqLabel": T(**{"id-ID":"MOQ:","en-US":"MOQ:","en-GB":"MOQ:","en-AU":"MOQ:","en-SG":"MOQ:","zh-CN":"MOQ:","zh-TW":"MOQ:","ja-JP":"MOQ:","ko-KR":"MOQ:","ms-MY":"MOQ:","de-DE":"MOQ:","fr-FR":"MOQ :","nl-NL":"MOQ:","es-ES":"MOQ:","it-IT":"MOQ:","hi-IN":"MOQ:","ar-AE":"الحد الأدنى للطلب:","ar-SA":"الحد الأدنى للطلب:"}),
        "priceOnRequestDialog": T(**{"id-ID":"Harga atas permintaan","en-US":"Price on Request","en-GB":"Price on Request","en-AU":"Price on Request","en-SG":"Price on Request","zh-CN":"价格面议","zh-TW":"價格面議","ja-JP":"要見積もり","ko-KR":"가격 문의","ms-MY":"Harga atas permintaan","de-DE":"Preis auf Anfrage","fr-FR":"Prix sur demande","nl-NL":"Prijs op aanvraag","es-ES":"Precio a consultar","it-IT":"Prezzo su richiesta","hi-IN":"कीमत पर अनुरोध","ar-AE":"السعر عند الطلب","ar-SA":"السعر عند الطلب"}),
    },

    # ── importTariff ────────────────────────────────────────────────────────────
    "importTariff": {
        "pageSeoTitle": T(**{"id-ID":"Kalkulator Tarif Impor — BM, PPN & PPh Pasal 22 | B2B Logistik","en-US":"Import Tariff Calculator — BM, PPN & PPh Art. 22 | B2B Logistics","en-GB":"Import Tariff Calculator — BM, PPN & PPh Art. 22 | B2B Logistics","en-AU":"Import Tariff Calculator — BM, PPN & PPh Art. 22 | B2B Logistics","en-SG":"Import Tariff Calculator — BM, PPN & PPh Art. 22 | B2B Logistics","zh-CN":"进口关税计算器 — BM、PPN 和 PPh 第22条 | B2B 物流","zh-TW":"進口關稅計算器 — BM、PPN 和 PPh 第22條 | B2B 物流","ja-JP":"輸入関税計算機 — BM・PPN・PPh第22条 | B2B物流","ko-KR":"수입 관세 계산기 — BM, PPN 및 PPh 제22조 | B2B 물류","ms-MY":"Kalkulator Tarif Import — BM, PPN & PPh Fasal 22 | B2B Logistik","de-DE":"Importzollrechner — BM, PPN & PPh Art. 22 | B2B Logistik","fr-FR":"Calculateur de droits d'importation — BM, PPN & PPh Art. 22 | B2B Logistique","nl-NL":"Importtariefcalculator — BM, PPN & PPh Art. 22 | B2B Logistiek","es-ES":"Calculadora de aranceles de importación — BM, PPN & PPh Art. 22 | B2B Logística","it-IT":"Calcolatore dazi doganali — BM, PPN & PPh Art. 22 | B2B Logistica","hi-IN":"आयात शुल्क कैलकुलेटर — BM, PPN & PPh धारा 22 | B2B लॉजिस्टिक्स","ar-AE":"حاسبة رسوم الاستيراد — BM, PPN & PPh المادة 22 | B2B لوجستيك","ar-SA":"حاسبة رسوم الاستيراد — BM, PPN & PPh المادة 22 | B2B لوجستيك"}),
        "freightLabel": T(**{"id-ID":"Ongkir / Freight (IDR)","en-US":"Freight Cost (IDR)","en-GB":"Freight Cost (IDR)","en-AU":"Freight Cost (IDR)","en-SG":"Freight Cost (IDR)","zh-CN":"运费 (IDR)","zh-TW":"運費 (IDR)","ja-JP":"運賃 (IDR)","ko-KR":"운임 (IDR)","ms-MY":"Kos Pengangkutan (IDR)","de-DE":"Frachtkosten (IDR)","fr-FR":"Coût de fret (IDR)","nl-NL":"Vrachtkosten (IDR)","es-ES":"Costo de flete (IDR)","it-IT":"Costo di trasporto (IDR)","hi-IN":"माल ढुलाई (IDR)","ar-AE":"تكلفة الشحن (IDR)","ar-SA":"تكلفة الشحن (IDR)"}),
        "freightPlaceholder": T(**{"id-ID":"mis. 5.000.000","en-US":"e.g. 5,000,000","en-GB":"e.g. 5,000,000","en-AU":"e.g. 5,000,000","en-SG":"e.g. 5,000,000","zh-CN":"例：5,000,000","zh-TW":"例：5,000,000","ja-JP":"例：5,000,000","ko-KR":"예: 5,000,000","ms-MY":"cth. 5,000,000","de-DE":"z.B. 5.000.000","fr-FR":"ex. 5 000 000","nl-NL":"bijv. 5.000.000","es-ES":"ej. 5.000.000","it-IT":"es. 5.000.000","hi-IN":"उदा. 5,000,000","ar-AE":"مثال 5,000,000","ar-SA":"مثال 5,000,000"}),
        "insuranceLabel": T(**{"id-ID":"Asuransi (%)","en-US":"Insurance (%)","en-GB":"Insurance (%)","en-AU":"Insurance (%)","en-SG":"Insurance (%)","zh-CN":"保险 (%)","zh-TW":"保險 (%)","ja-JP":"保険 (%)","ko-KR":"보험 (%)","ms-MY":"Insurans (%)","de-DE":"Versicherung (%)","fr-FR":"Assurance (%)","nl-NL":"Verzekering (%)","es-ES":"Seguro (%)","it-IT":"Assicurazione (%)","hi-IN":"बीमा (%)","ar-AE":"التأمين (%)","ar-SA":"التأمين (%)"}),
        "importerTypeLabel": T(**{"id-ID":"Jenis Importir (PPh Pasal 22)","en-US":"Importer Type (Art. 22 Tax)","en-GB":"Importer Type (Art. 22 Tax)","en-AU":"Importer Type (Art. 22 Tax)","en-SG":"Importer Type (Art. 22 Tax)","zh-CN":"进口商类型（第22条税）","zh-TW":"進口商類型（第22條稅）","ja-JP":"輸入者タイプ（第22条税）","ko-KR":"수입업자 유형 (제22조 세금)","ms-MY":"Jenis Pengimport (Cukai Perkara 22)","de-DE":"Importeur-Typ (Art. 22 Steuer)","fr-FR":"Type d'importateur (Art. 22 taxe)","nl-NL":"Type importeur (Art. 22 belasting)","es-ES":"Tipo de importador (Art. 22 impuesto)","it-IT":"Tipo importatore (Art. 22 imposta)","hi-IN":"आयातक प्रकार (धारा 22 कर)","ar-AE":"نوع المستورد (ضريبة المادة 22)","ar-SA":"نوع المستورد (ضريبة المادة 22)"}),
        "ftaRateLabel": T(**{"id-ID":"Tarif Preferensi (FTA) — opsional","en-US":"Preferential Rate (FTA) — optional","en-GB":"Preferential Rate (FTA) — optional","en-AU":"Preferential Rate (FTA) — optional","en-SG":"Preferential Rate (FTA) — optional","zh-CN":"优惠税率 (FTA) — 可选","zh-TW":"優惠稅率 (FTA) — 選填","ja-JP":"優遇税率 (FTA) — 任意","ko-KR":"우대 관세율 (FTA) — 선택","ms-MY":"Kadar Keutamaan (FTA) — pilihan","de-DE":"Präferenzzoll (FTA) — optional","fr-FR":"Taux préférentiel (FTA) — optionnel","nl-NL":"Preferentieel tarief (FTA) — optioneel","es-ES":"Tasa preferencial (FTA) — opcional","it-IT":"Tariffa preferenziale (FTA) — opzionale","hi-IN":"वरीयता दर (FTA) — वैकल्पिक","ar-AE":"السعر التفضيلي (FTA) — اختياري","ar-SA":"السعر التفضيلي (FTA) — اختياري"}),
        "calcSpinner": T(**{"id-ID":"Menghitung…","en-US":"Calculating…","en-GB":"Calculating…","en-AU":"Calculating…","en-SG":"Calculating…","zh-CN":"计算中…","zh-TW":"計算中…","ja-JP":"計算中…","ko-KR":"계산 중…","ms-MY":"Mengira…","de-DE":"Berechnung…","fr-FR":"Calcul en cours…","nl-NL":"Berekening…","es-ES":"Calculando…","it-IT":"Calcolo in corso…","hi-IN":"गणना हो रही है…","ar-AE":"جارٍ الحساب…","ar-SA":"جارٍ الحساب…"}),
        "lartasNotes": T(**{"id-ID":"Keterangan:","en-US":"Notes:","en-GB":"Notes:","en-AU":"Notes:","en-SG":"Notes:","zh-CN":"备注：","zh-TW":"備註：","ja-JP":"備考：","ko-KR":"비고:","ms-MY":"Keterangan:","de-DE":"Hinweise:","fr-FR":"Notes :","nl-NL":"Opmerkingen:","es-ES":"Notas:","it-IT":"Note:","hi-IN":"नोट्स:","ar-AE":"ملاحظات:","ar-SA":"ملاحظات:"}),
        "lartasRegulator": T(**{"id-ID":"Regulator:","en-US":"Regulator:","en-GB":"Regulator:","en-AU":"Regulator:","en-SG":"Regulator:","zh-CN":"监管机构：","zh-TW":"監管機構：","ja-JP":"規制機関：","ko-KR":"규제 기관:","ms-MY":"Penguatkuasa:","de-DE":"Regulierungsbehörde:","fr-FR":"Régulateur :","nl-NL":"Regelgever:","es-ES":"Regulador:","it-IT":"Autorità:","hi-IN":"नियामक:","ar-AE":"الجهة التنظيمية:","ar-SA":"الجهة التنظيمية:"}),
        "lartasPermits": T(**{"id-ID":"Perizinan yang dibutuhkan:","en-US":"Required permits:","en-GB":"Required permits:","en-AU":"Required permits:","en-SG":"Required permits:","zh-CN":"所需许可证：","zh-TW":"所需許可證：","ja-JP":"必要な許可：","ko-KR":"필요 허가:","ms-MY":"Permit yang diperlukan:","de-DE":"Erforderliche Genehmigungen:","fr-FR":"Autorisations requises :","nl-NL":"Vereiste vergunningen:","es-ES":"Permisos requeridos:","it-IT":"Permessi richiesti:","hi-IN":"आवश्यक परमिट:","ar-AE":"التصاريح المطلوبة:","ar-SA":"التصاريح المطلوبة:"}),
        "hsSectionTitle": T(**{"id-ID":"HS Code — BTKI 2022","en-US":"HS Code — BTKI 2022","en-GB":"HS Code — BTKI 2022","en-AU":"HS Code — BTKI 2022","en-SG":"HS Code — BTKI 2022","zh-CN":"HS Code — BTKI 2022","zh-TW":"HS Code — BTKI 2022","ja-JP":"HS Code — BTKI 2022","ko-KR":"HS Code — BTKI 2022","ms-MY":"HS Code — BTKI 2022","de-DE":"HS Code — BTKI 2022","fr-FR":"HS Code — BTKI 2022","nl-NL":"HS Code — BTKI 2022","es-ES":"HS Code — BTKI 2022","it-IT":"HS Code — BTKI 2022","hi-IN":"HS Code — BTKI 2022","ar-AE":"HS Code — BTKI 2022","ar-SA":"HS Code — BTKI 2022"}),
        "exportCsv": T(**{"id-ID":"Export CSV","en-US":"Export CSV","en-GB":"Export CSV","en-AU":"Export CSV","en-SG":"Export CSV","zh-CN":"导出 CSV","zh-TW":"匯出 CSV","ja-JP":"CSV エクスポート","ko-KR":"CSV 내보내기","ms-MY":"Eksport CSV","de-DE":"CSV exportieren","fr-FR":"Exporter CSV","nl-NL":"CSV exporteren","es-ES":"Exportar CSV","it-IT":"Esporta CSV","hi-IN":"CSV निर्यात","ar-AE":"تصدير CSV","ar-SA":"تصدير CSV"}),
        "exportJson": T(**{"id-ID":"Export JSON","en-US":"Export JSON","en-GB":"Export JSON","en-AU":"Export JSON","en-SG":"Export JSON","zh-CN":"导出 JSON","zh-TW":"匯出 JSON","ja-JP":"JSON エクスポート","ko-KR":"JSON 내보내기","ms-MY":"Eksport JSON","de-DE":"JSON exportieren","fr-FR":"Exporter JSON","nl-NL":"JSON exporteren","es-ES":"Exportar JSON","it-IT":"Esporta JSON","hi-IN":"JSON निर्यात","ar-AE":"تصدير JSON","ar-SA":"تصدير JSON"}),
        "inputGoodsValueLabel": T(**{"id-ID":"Nilai Barang","en-US":"Goods Value","en-GB":"Goods Value","en-AU":"Goods Value","en-SG":"Goods Value","zh-CN":"货物价值","zh-TW":"貨物價值","ja-JP":"商品価値","ko-KR":"물품 가격","ms-MY":"Nilai Barangan","de-DE":"Warenwert","fr-FR":"Valeur des marchandises","nl-NL":"Waarde goederen","es-ES":"Valor de la mercancía","it-IT":"Valore della merce","hi-IN":"माल का मूल्य","ar-AE":"قيمة البضائع","ar-SA":"قيمة البضائع"}),
        "inputRateUsedLabel": T(**{"id-ID":"Kurs Pakai","en-US":"Exchange Rate Used","en-GB":"Exchange Rate Used","en-AU":"Exchange Rate Used","en-SG":"Exchange Rate Used","zh-CN":"使用汇率","zh-TW":"使用匯率","ja-JP":"使用レート","ko-KR":"적용 환율","ms-MY":"Kadar Pertukaran Digunakan","de-DE":"Verwendeter Kurs","fr-FR":"Taux utilisé","nl-NL":"Gebruikte koers","es-ES":"Tasa utilizada","it-IT":"Tasso utilizzato","hi-IN":"उपयोग किया गया दर","ar-AE":"سعر الصرف المستخدم","ar-SA":"سعر الصرف المستخدم"}),
        "inputDutyScheme": T(**{"id-ID":"Skema Tarif BM","en-US":"Import Duty Scheme","en-GB":"Import Duty Scheme","en-AU":"Import Duty Scheme","en-SG":"Import Duty Scheme","zh-CN":"关税方案","zh-TW":"關稅方案","ja-JP":"関税スキーム","ko-KR":"관세 체계","ms-MY":"Skim Duti Import","de-DE":"Zollregelung","fr-FR":"Régime douanier","nl-NL":"Douaneregeling","es-ES":"Esquema arancelario","it-IT":"Schema daziale","hi-IN":"आयात शुल्क योजना","ar-AE":"نظام الرسوم الجمركية","ar-SA":"نظام الرسوم الجمركية"}),
        "inputNdpbm": T(**{"id-ID":"NDPBM (Nilai CIF dalam IDR)","en-US":"NDPBM (CIF Value in IDR)","en-GB":"NDPBM (CIF Value in IDR)","en-AU":"NDPBM (CIF Value in IDR)","en-SG":"NDPBM (CIF Value in IDR)","zh-CN":"NDPBM（IDR 计 CIF 价值）","zh-TW":"NDPBM（IDR 計 CIF 價值）","ja-JP":"NDPBM（IDR でのCIF価値）","ko-KR":"NDPBM (IDR 기준 CIF 가격)","ms-MY":"NDPBM (Nilai CIF dalam IDR)","de-DE":"NDPBM (CIF-Wert in IDR)","fr-FR":"NDPBM (Valeur CIF en IDR)","nl-NL":"NDPBM (CIF-waarde in IDR)","es-ES":"NDPBM (Valor CIF en IDR)","it-IT":"NDPBM (Valore CIF in IDR)","hi-IN":"NDPBM (IDR में CIF मूल्य)","ar-AE":"NDPBM (قيمة CIF بـ IDR)","ar-SA":"NDPBM (قيمة CIF بـ IDR)"}),
        "ndpbmLabel": T(**{"id-ID":"Nilai Barang (NDPBM/CIF)","en-US":"Goods Value (NDPBM/CIF)","en-GB":"Goods Value (NDPBM/CIF)","en-AU":"Goods Value (NDPBM/CIF)","en-SG":"Goods Value (NDPBM/CIF)","zh-CN":"货物价值（NDPBM/CIF）","zh-TW":"貨物價值（NDPBM/CIF）","ja-JP":"商品価値（NDPBM/CIF）","ko-KR":"물품 가격 (NDPBM/CIF)","ms-MY":"Nilai Barangan (NDPBM/CIF)","de-DE":"Warenwert (NDPBM/CIF)","fr-FR":"Valeur marchandises (NDPBM/CIF)","nl-NL":"Waarde goederen (NDPBM/CIF)","es-ES":"Valor mercancía (NDPBM/CIF)","it-IT":"Valore merce (NDPBM/CIF)","hi-IN":"माल का मूल्य (NDPBM/CIF)","ar-AE":"قيمة البضائع (NDPBM/CIF)","ar-SA":"قيمة البضائع (NDPBM/CIF)"}),
        "taxDetailTitle": T(**{"id-ID":"Rincian Pajak & Pungutan Impor","en-US":"Tax & Import Duty Breakdown","en-GB":"Tax & Import Duty Breakdown","en-AU":"Tax & Import Duty Breakdown","en-SG":"Tax & Import Duty Breakdown","zh-CN":"税费与进口关税明细","zh-TW":"稅費與進口關稅明細","ja-JP":"税金・輸入関税の内訳","ko-KR":"세금 및 수입 관세 내역","ms-MY":"Perincian Cukai & Duti Import","de-DE":"Steuer- & Zollaufschlüsselung","fr-FR":"Détail des taxes et droits d'importation","nl-NL":"Belasting- en invoerrechten specificatie","es-ES":"Desglose de impuestos y aranceles","it-IT":"Dettaglio tasse e dazi doganali","hi-IN":"कर और आयात शुल्क विवरण","ar-AE":"تفصيل الضرائب والرسوم الجمركية","ar-SA":"تفصيل الضرائب والرسوم الجمركية"}),
        "tableColComponent": T(**{"id-ID":"Komponen","en-US":"Component","en-GB":"Component","en-AU":"Component","en-SG":"Component","zh-CN":"组成部分","zh-TW":"組成部分","ja-JP":"項目","ko-KR":"구성 요소","ms-MY":"Komponen","de-DE":"Komponente","fr-FR":"Composant","nl-NL":"Component","es-ES":"Componente","it-IT":"Componente","hi-IN":"घटक","ar-AE":"المكوّن","ar-SA":"المكوّن"}),
        "tableColRate": T(**{"id-ID":"Tarif","en-US":"Rate","en-GB":"Rate","en-AU":"Rate","en-SG":"Rate","zh-CN":"税率","zh-TW":"稅率","ja-JP":"税率","ko-KR":"세율","ms-MY":"Kadar","de-DE":"Satz","fr-FR":"Taux","nl-NL":"Tarief","es-ES":"Tasa","it-IT":"Aliquota","hi-IN":"दर","ar-AE":"المعدل","ar-SA":"المعدل"}),
        "tableColAmount": T(**{"id-ID":"Jumlah (IDR)","en-US":"Amount (IDR)","en-GB":"Amount (IDR)","en-AU":"Amount (IDR)","en-SG":"Amount (IDR)","zh-CN":"金额 (IDR)","zh-TW":"金額 (IDR)","ja-JP":"金額 (IDR)","ko-KR":"금액 (IDR)","ms-MY":"Jumlah (IDR)","de-DE":"Betrag (IDR)","fr-FR":"Montant (IDR)","nl-NL":"Bedrag (IDR)","es-ES":"Monto (IDR)","it-IT":"Importo (IDR)","hi-IN":"राशि (IDR)","ar-AE":"المبلغ (IDR)","ar-SA":"المبلغ (IDR)"}),
        "ftaRateResult": T(**{"id-ID":"Tarif Preferensi FTA","en-US":"FTA Preferential Rate","en-GB":"FTA Preferential Rate","en-AU":"FTA Preferential Rate","en-SG":"FTA Preferential Rate","zh-CN":"FTA 优惠税率","zh-TW":"FTA 優惠稅率","ja-JP":"FTA 優遇税率","ko-KR":"FTA 우대 관세율","ms-MY":"Kadar Keutamaan FTA","de-DE":"FTA Präferenzzoll","fr-FR":"Taux préférentiel FTA","nl-NL":"FTA Preferentieel tarief","es-ES":"Tasa preferencial FTA","it-IT":"Tariffa preferenziale FTA","hi-IN":"FTA वरीयता दर","ar-AE":"معدل تفضيلي FTA","ar-SA":"معدل تفضيلي FTA"}),
        "importHelpTitle": T(**{"id-ID":"Butuh Bantuan Pengurusan Impor?","en-US":"Need Help with Import Processing?","en-GB":"Need Help with Import Processing?","en-AU":"Need Help with Import Processing?","en-SG":"Need Help with Import Processing?","zh-CN":"需要进口报关协助？","zh-TW":"需要進口報關協助？","ja-JP":"輸入通関のサポートが必要ですか？","ko-KR":"수입 통관 지원이 필요하신가요?","ms-MY":"Perlukan Bantuan Pengurusan Import?","de-DE":"Hilfe bei der Importabwicklung benötigt?","fr-FR":"Besoin d'aide pour les formalités d'importation ?","nl-NL":"Hulp nodig bij importafhandeling?","es-ES":"¿Necesita ayuda con el procesamiento de importación?","it-IT":"Hai bisogno di assistenza per le pratiche di importazione?","hi-IN":"आयात प्रक्रिया में सहायता चाहिए?","ar-AE":"هل تحتاج مساعدة في إجراءات الاستيراد؟","ar-SA":"هل تحتاج مساعدة في إجراءات الاستيراد؟"}),
        "cooCertNote": T(**{"id-ID":"✓ Membutuhkan Certificate of Origin (COO/Form) dari eksportir","en-US":"✓ Requires Certificate of Origin (COO/Form) from exporter","en-GB":"✓ Requires Certificate of Origin (COO/Form) from exporter","en-AU":"✓ Requires Certificate of Origin (COO/Form) from exporter","en-SG":"✓ Requires Certificate of Origin (COO/Form) from exporter","zh-CN":"✓ 需要出口商提供原产地证书 (COO/表格)","zh-TW":"✓ 需要出口商提供原產地證書 (COO/表格)","ja-JP":"✓ 輸出者からの原産地証明書（COO/フォーム）が必要","ko-KR":"✓ 수출자의 원산지 증명서 (COO/양식) 필요","ms-MY":"✓ Memerlukan Sijil Asal (COO/Borang) dari pengeksport","de-DE":"✓ Ursprungszeugnis (COO/Formular) vom Exporteur erforderlich","fr-FR":"✓ Certificat d'origine (COO/Formulaire) requis de l'exportateur","nl-NL":"✓ Oorsprongscertificaat (COO/Formulier) van exporteur vereist","es-ES":"✓ Requiere Certificado de Origen (COO/Formulario) del exportador","it-IT":"✓ Richiede Certificato di Origine (COO/Modulo) dall'esportatore","hi-IN":"✓ निर्यातक से मूल प्रमाण पत्र (COO/फ़ॉर्म) आवश्यक","ar-AE":"✓ يتطلب شهادة المنشأ (COO/نموذج) من المصدر","ar-SA":"✓ يتطلب شهادة المنشأ (COO/نموذج) من المصدر"}),
        "multiSharedSettings": T(**{"id-ID":"Pengaturan Bersama","en-US":"Shared Settings","en-GB":"Shared Settings","en-AU":"Shared Settings","en-SG":"Shared Settings","zh-CN":"共同设置","zh-TW":"共同設定","ja-JP":"共通設定","ko-KR":"공통 설정","ms-MY":"Tetapan Dikongsi","de-DE":"Gemeinsame Einstellungen","fr-FR":"Paramètres partagés","nl-NL":"Gedeelde instellingen","es-ES":"Configuración compartida","it-IT":"Impostazioni condivise","hi-IN":"साझा सेटिंग्स","ar-AE":"الإعدادات المشتركة","ar-SA":"الإعدادات المشتركة"}),
    },
}

# ── Insertion logic ─────────────────────────────────────────────────────────────

def escape_ts(s):
    """Escape a string for TypeScript single-quoted string."""
    return s.replace("\\", "\\\\").replace("'", "\\'")

def find_ns_end(content, locale, ns):
    """Find the position just before the closing brace of a namespace block in a locale."""
    loc_start = content.find(f'  "{locale}":')
    if loc_start == -1:
        return -1, None
    # Find namespace
    # Try both patterns: `  ns: {` and `  "ns": {`
    ns_pat1 = f'    {ns}: {{'
    ns_pat2 = f'    "{ns}": {{'
    ns_start = -1
    for pat in [ns_pat1, ns_pat2]:
        p = content.find(pat, loc_start)
        if p != -1:
            ns_start = p
            break
    if ns_start == -1:
        return -1, None
    # Find matching closing brace
    depth = 0
    i = content.index('{', ns_start)
    while i < len(content):
        if content[i] == '{': depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                return i, content  # position of closing }
        i += 1
    return -1, None

def key_exists_in_ns(content, locale, ns, key):
    """Check if a key already exists in a namespace for a given locale."""
    loc_start = content.find(f'  "{locale}":')
    if loc_start == -1:
        return False
    ns_pat1 = f'    {ns}: {{'
    ns_pat2 = f'    "{ns}": {{'
    ns_start = -1
    for pat in [ns_pat1, ns_pat2]:
        p = content.find(pat, loc_start)
        if p != -1:
            ns_start = p
            break
    if ns_start == -1:
        return False
    # Find end of namespace
    depth = 0
    i = content.index('{', ns_start)
    ns_content_start = i
    while i < len(content):
        if content[i] == '{': depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                ns_segment = content[ns_content_start:i+1]
                # Check for key
                return bool(re.search(rf'^\s+{re.escape(key)}:', ns_segment, re.MULTILINE))
        i += 1
    return False

content = open(FILE, encoding="utf-8").read()
original_size = len(content)

# Collect all insertions: (position, text)
insertions = []
skip_count = 0
insert_count = 0

for ns, keys in NEW_KEYS.items():
    for locale in LOCALES:
        # Build insertion text for keys not yet present
        lines_to_add = []
        for key, translations in keys.items():
            if key_exists_in_ns(content, locale, ns, key):
                skip_count += 1
                continue
            val = translations.get(locale, translations.get("en-US", ""))
            lines_to_add.append(f"      {key}: '{escape_ts(val)}',")
            insert_count += 1

        if not lines_to_add:
            continue

        # Find insertion position (before closing } of namespace)
        ns_end_pos, _ = find_ns_end(content, locale, ns)
        if ns_end_pos == -1:
            print(f"WARNING: Could not find ns '{ns}' in locale '{locale}'", file=sys.stderr)
            continue

        insert_text = "\n" + "\n".join(lines_to_add) + "\n    "
        insertions.append((ns_end_pos, insert_text))

# Apply insertions in reverse order (to preserve positions)
insertions.sort(key=lambda x: x[0], reverse=True)
# Deduplicate same positions
seen_positions = set()
deduped = []
for pos, text in insertions:
    if pos not in seen_positions:
        seen_positions.add(pos)
        deduped.append((pos, text))
    # If same position, merge
    else:
        for i, (p, t) in enumerate(deduped):
            if p == pos:
                deduped[i] = (p, t.rstrip() + "\n" + text.lstrip())
                break

result = content
for pos, text in deduped:
    result = result[:pos] + text + result[pos:]

with open(FILE, "w", encoding="utf-8") as f:
    f.write(result)

print(f"Done!")
print(f"  Skipped (already exist): {skip_count}")
print(f"  Inserted: {insert_count}")
print(f"  Original size: {original_size} chars ({original_size // 1024} KB)")
print(f"  New size: {len(result)} chars ({len(result) // 1024} KB)")
