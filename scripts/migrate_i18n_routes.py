#!/usr/bin/env python3
"""
Replace hardcoded strings with t() calls in 5 customer-portal route files.
Run after add_new_i18n_keys_v2.py.
"""
import os, sys

BASE = os.path.join(os.path.dirname(__file__), "../artifacts/customer-portal/src/pages")

def patch(filename, replacements):
    path = os.path.join(BASE, filename)
    content = open(path, encoding="utf-8").read()
    original = content
    applied = []
    skipped = []
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new)
            applied.append(old[:60])
        else:
            skipped.append(old[:60])
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return applied, skipped

# ══════════════════════════════════════════════════════════════
# 1. PABEAN.TSX
# ══════════════════════════════════════════════════════════════
pabean_replacements = [
    # Upload / remove logo titles (edit mode buttons)
    ('title="Upload logo"', 'title={t("pabean.uploadLogoTitle")}'),
    ('title="Hapus logo"', 'title={t("pabean.removeLogoTitle")}'),
    # Edit mode hover hint badge
    (
        '                      Hover icon → upload logo',
        '                      {t("pabean.hoverUploadHint")}',
    ),
    # Email and phone labels in step 3
    (
        '<Label className="text-xs">Email <span className="text-red-500">*</span></Label>',
        '<Label className="text-xs">{t("pabean.emailLabel")} <span className="text-red-500">*</span></Label>',
    ),
    (
        '<Label className="text-xs">Telepon / WhatsApp <span className="text-red-500">*</span></Label>',
        '<Label className="text-xs">{t("pabean.phoneLabel")} <span className="text-red-500">*</span></Label>',
    ),
]

# ══════════════════════════════════════════════════════════════
# 2. CUSTOM-CLEARANCE.TSX
# ══════════════════════════════════════════════════════════════
cc_replacements = [
    # PIB/PEB section placeholders
    ('placeholder="Contoh: Mesin Produksi, Garmen, Produk Elektronik..."',
     'placeholder={t("customClearance.phGoods1")}'),
    ('placeholder="Contoh: 8477.80.00"',
     'placeholder={t("customClearance.phHsCode")}'),   # replace_all (2 occurrences)
    ('placeholder="Contoh: 15000"',
     'placeholder={t("customClearance.phValueNumber")}'),
    ('placeholder="Contoh: 15900"',
     'placeholder={t("customClearance.phExchangeRate")}'),   # 2 occurrences
    ('placeholder="Contoh: 500"',
     'placeholder={t("customClearance.phWeight")}'),
    ('placeholder="Contoh: China, Amerika Serikat, Jepang..."',
     'placeholder={t("customClearance.phCountry1")}'),
    ('placeholder="Contoh: perlu LarTas dari Kemendag, ada fasilitas KITE, barang sensitif, dll."',
     'placeholder={t("customClearance.phSpecialNotesPib")}'),
    # Kurs label (PIB/PEB section)
    (
        '<Label className="text-xs font-semibold">Kurs {pibPebMataUang} → IDR</Label>',
        '<Label className="text-xs font-semibold">{t("customClearance.labelExchangeRate").replace("{currency}", pibPebMataUang)}</Label>',
    ),
    # Nilai CIF/FOB estimator label (PIB/PEB)
    (
        '<span className="text-muted-foreground">Nilai {pibEstimasi.arah === "Impor" ? "CIF" : "FOB"} (setara IDR)</span>',
        '<span className="text-muted-foreground">{t("customClearance.valueCifLabel").replace("{type}", pibEstimasi.arah === "Impor" ? "CIF" : "FOB")}</span>',
    ),
    # Handling (HC) section placeholders
    ('placeholder="Contoh: Spare Part, Tekstil, Bahan Kimia..."',
     'placeholder={t("customClearance.phGoods2")}'),
    ('placeholder="Nomor dokumen PIB/PEB"',
     'placeholder={t("customClearance.phPibPebDocNum")}'),
    ('placeholder="Misal: barang ada pembatasan khusus, perlu koordinasi gudang..."',
     'placeholder={t("customClearance.phSpecialNotesHc")}'),
    # Undername section placeholders
    ('placeholder="Contoh: Mesin, Bahan Baku, Produk Konsumsi..."',
     'placeholder={t("customClearance.phGoods3")}'),
    ('placeholder="Contoh: 20000"',
     'placeholder={t("customClearance.phValueNumber2")}'),
    # Kurs label (undername section)
    (
        '<Label className="text-xs font-semibold">Kurs {unMataUang} → IDR</Label>',
        '<Label className="text-xs font-semibold">{t("customClearance.labelExchangeRate").replace("{currency}", unMataUang)}</Label>',
    ),
    ('placeholder="Contoh: 1000"',
     'placeholder={t("customClearance.phWeight2")}'),
    ('placeholder="Contoh: China, Jerman, Amerika Serikat..."',
     'placeholder={t("customClearance.phCountry2")}'),
    ('placeholder="Contoh: perusahaan belum memiliki API Umum, masih proses pengurusan NIB, dll."',
     'placeholder={t("customClearance.phSpecialNotesUn")}'),
    # Nilai CIF/FOB estimator (undername)
    (
        '<span className="text-muted-foreground">Nilai {unEstimasi.arah === "Impor" ? "CIF" : "FOB"} (setara IDR)</span>',
        '<span className="text-muted-foreground">{t("customClearance.valueCifLabel").replace("{type}", unEstimasi.arah === "Impor" ? "CIF" : "FOB")}</span>',
    ),
    # Step 3 — requester info labels
    (
        '<Label className="text-xs">Email <span className="text-red-500">*</span></Label>',
        '<Label className="text-xs">{t("customClearance.emailLabel")} <span className="text-red-500">*</span></Label>',
    ),
    (
        '<Label className="text-xs">Telepon / WhatsApp <span className="text-red-500">*</span></Label>',
        '<Label className="text-xs">{t("customClearance.phoneLabel")} <span className="text-red-500">*</span></Label>',
    ),
    # Step 4 summary labels
    (
        '                  <span className="text-muted-foreground">Handling — Jalur</span>',
        '                  <span className="text-muted-foreground">{t("customClearance.handlingLaneLabel")}</span>',
    ),
    (
        '                  <span className="text-muted-foreground">Undername — Negara</span>',
        '                  <span className="text-muted-foreground">{t("customClearance.undernamCountryLabel")}</span>',
    ),
]

# ══════════════════════════════════════════════════════════════
# 3. MARKETPLACE.TSX
# ══════════════════════════════════════════════════════════════
mkt_replacements = [
    # Video badge on product card
    (
        '            <span className="text-[9px] text-white font-bold">Video</span>',
        '            <span className="text-[9px] text-white font-bold">{t("marketplace.videoBadge")}</span>',
    ),
    # Dialog: sell price
    (
        '              <div className="text-[11px] text-sky-600 font-semibold uppercase tracking-wider mb-0.5">Harga Jual</div>',
        '              <div className="text-[11px] text-sky-600 font-semibold uppercase tracking-wider mb-0.5">{t("mktCard.sellPrice")}</div>',
    ),
    # Dialog: price on request
    (
        '              <div className="text-[13px] font-semibold text-slate-500 italic">Price on Request</div>',
        '              <div className="text-[13px] font-semibold text-slate-500 italic">{t("mktCard.priceOnRequestDialog")}</div>',
    ),
    # Dialog: description heading
    (
        '              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Deskripsi</div>',
        '              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{t("mktCard.description")}</div>',
    ),
    # Dialog: specifications heading
    (
        '              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Spesifikasi</div>',
        '              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{t("mktCard.specifications")}</div>',
    ),
    # Dialog: meta labels
    (
        '                <span className="text-slate-400">Asal:</span>',
        '<span className="text-slate-400">{t("mktCard.originLabel")}:</span>',
    ),
    (
        '                <span className="text-slate-400">Lokasi:</span>',
        '<span className="text-slate-400">{t("mktCard.locationLabel")}:</span>',
    ),
    (
        '                <span className="text-slate-400">Lead Time:</span>',
        '<span className="text-slate-400">{t("mktCard.leadTimeLabel")}:</span>',
    ),
    # Dialog: MOQ labels (two variants)
    (
        '                <span className="text-slate-400">MOQ:</span> {item.moq?.toLocaleString()',
        '<span className="text-slate-400">{t("mktCard.moqLabel")}</span> {item.moq?.toLocaleString()',
    ),
    (
        '                <span className="text-slate-400">MOQ:</span> <span className="italic text-slate-400">Upon Request</span>',
        '<span className="text-slate-400">{t("mktCard.moqLabel")}</span> <span className="italic text-slate-400">{t("mktCard.moqOnRequest")}</span>',
    ),
    # Loading states
    (
        '<span className="text-[12px] text-slate-400 animate-pulse">Memuat...</span>',
        '<span className="text-[12px] text-slate-400 animate-pulse">{t("marketplace.loadingMobile")}</span>',
    ),
    (
        '<span className="text-[13px] text-slate-400 animate-pulse">Memuat produk...</span>',
        '<span className="text-[13px] text-slate-400 animate-pulse">{t("marketplace.loadingProducts")}</span>',
    ),
    # Reset filters button with count
    (
        '<X className="h-3.5 w-3.5" /> Reset ({activeFilterCount})',
        '<X className="h-3.5 w-3.5" /> {t("marketplace.resetFiltersCount").replace("{n}", String(activeFilterCount))}',
    ),
    # Empty state
    (
        '                    <p className="text-[16px] font-semibold text-slate-500">Tidak ada produk yang cocok.</p>',
        '                    <p className="text-[16px] font-semibold text-slate-500">{t("marketplace.noProductsMatch")}</p>',
    ),
    (
        '                    <p className="text-[13px] text-slate-400 mt-1 max-w-xs">Coba ubah atau hapus filter untuk melihat lebih banyak item.</p>',
        '                    <p className="text-[13px] text-slate-400 mt-1 max-w-xs">{t("marketplace.tryChangeFilters")}</p>',
    ),
    # Coming soon section
    (
        '                            <span className="text-sky-400 text-[11px] font-bold uppercase tracking-widest">Segera Hadir</span>',
        '                            <span className="text-sky-400 text-[11px] font-bold uppercase tracking-widest">{t("marketplace.comingSoonHeader")}</span>',
    ),
    (
        '                              <span className="mt-1.5 inline-block text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white/80 backdrop-blur-sm">Segera</span>',
        '                              <span className="mt-1.5 inline-block text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white/80 backdrop-blur-sm">{t("marketplace.comingSoon")}</span>',
    ),
    # Vendor CTA
    (
        '                          <p className="text-[14px] font-bold text-slate-800">Anda seorang vendor?</p>',
        '                          <p className="text-[14px] font-bold text-slate-800">{t("marketplace.areYouVendor")}</p>',
    ),
    (
        '                          <p className="text-[12px] text-slate-500">Daftarkan bisnis Anda dan mulai jualan ke buyer B2B hari ini.</p>',
        '                          <p className="text-[12px] text-slate-500">{t("marketplace.vendorCtaDesc")}</p>',
    ),
    # Coming soon categories
    (
        '                      <h4 className="text-white text-[13px] font-bold mb-4">Kategori yang Akan Tersedia</h4>',
        '                      <h4 className="text-white text-[13px] font-bold mb-4">{t("marketplace.comingSoonCategories")}</h4>',
    ),
]

# ══════════════════════════════════════════════════════════════
# 4. LOGIN.TSX
# ══════════════════════════════════════════════════════════════
login_replacements = [
    # Remove duplicate hardcoded Loading… (keep the t() version)
    (
        '                      {devLoading === role && <span className="text-xs opacity-70">{t("common.loading", "Loading…")}</span>}\n                      {devLoading === role && <span className="text-xs opacity-70">Loading…</span>}',
        '                      {devLoading === role && <span className="text-xs opacity-70">{t("common.loading", "Loading…")}</span>}',
    ),
]

# ══════════════════════════════════════════════════════════════
# 5. IMPORT-TARIFF-CALCULATOR.TSX
# ══════════════════════════════════════════════════════════════
it_replacements = [
    # PageSeo title
    (
        'title="Kalkulator Tarif Impor — BM, PPN & PPh Pasal 22 | B2B Logistik"',
        'title={t("importTariff.pageSeoTitle")}',
    ),
    # Multi-HS tab badge
    (
        '              <span className="text-[10px] bg-sky-100 text-sky-600 rounded-full px-1.5 py-0.5 font-bold">Baru</span>',
        '              <span className="text-[10px] bg-sky-100 text-sky-600 rounded-full px-1.5 py-0.5 font-bold">{t("importTariff.tabMultiBadge")}</span>',
    ),
    # Step 1 heading
    (
        '                  <span className="text-sm font-semibold text-slate-800">Cari HS Code</span>',
        '                  <span className="text-sm font-semibold text-slate-800">{t("importTariff.step1Title")}</span>',
    ),
    # HS search placeholder
    (
        '                        placeholder="Ketik HS Code atau nama barang…"',
        '                        placeholder={t("importTariff.hcSearchPlaceholder")}',
    ),
    # HS not found
    (
        '                        Tidak ditemukan. Coba kata kunci lain.',
        '                        {t("importTariff.hcNotFound")}',
    ),
    # Step 2 heading
    (
        '                  <span className="text-sm font-semibold text-slate-800">Nilai Barang & Mata Uang</span>',
        '                  <span className="text-sm font-semibold text-slate-800">{t("importTariff.step2Title")}</span>',
    ),
    # Currency label (single tab)
    (
        '                    <label className="text-xs font-medium text-slate-500 mb-1.5 block">Mata Uang</label>',
        '                    <label className="text-xs font-medium text-slate-500 mb-1.5 block">{t("importTariff.currencyLabel")}</label>',
    ),
    # Convert label
    (
        '                  <span className="text-xs font-medium text-slate-600">Konversi ke IDR</span>',
        '                  <span className="text-xs font-medium text-slate-600">{t("importTariff.convertLabel")}</span>',
    ),
    # Rate used label
    (
        '                    Kurs pakai',
        '                    {t("importTariff.rateUsed")}',
    ),
    # Step 3 (Incoterm) heading
    (
        '                  <span className="text-sm font-semibold text-slate-800">Incoterm</span>',
        '                  <span className="text-sm font-semibold text-slate-800">{t("importTariff.step3Title")}</span>',
    ),
    # Freight label and placeholder
    (
        '                  <p className="text-xs font-medium text-slate-600 mb-2">Ongkir / Freight (IDR)</p>',
        '                  <p className="text-xs font-medium text-slate-600 mb-2">{t("importTariff.freightLabel")}</p>',
    ),
    (
        '                      placeholder="mis. 5.000.000"',
        '                      placeholder={t("importTariff.freightPlaceholder")}',
    ),
    # Insurance label
    (
        '                  <p className="text-xs font-medium text-slate-600 mb-2">Asuransi (%)</p>',
        '                  <p className="text-xs font-medium text-slate-600 mb-2">{t("importTariff.insuranceLabel")}</p>',
    ),
    # Step 4 heading
    (
        '                  <span className="text-sm font-semibold text-slate-800">Jenis Importir & FTA</span>',
        '                  <span className="text-sm font-semibold text-slate-800">{t("importTariff.step4Title")}</span>',
    ),
    # Importer type label
    (
        '                  <p className="text-xs font-medium text-slate-600 mb-2">Jenis Importir (PPh Pasal 22)</p>',
        '                  <p className="text-xs font-medium text-slate-600 mb-2">{t("importTariff.importerTypeLabel")}</p>',
    ),
    # FTA rate label
    (
        '                  <p className="text-xs font-medium text-slate-600 mb-2">Tarif Preferensi (FTA) — opsional</p>',
        '                  <p className="text-xs font-medium text-slate-600 mb-2">{t("importTariff.ftaRateLabel")}</p>',
    ),
    # COO cert note
    (
        '                      ✓ Membutuhkan Certificate of Origin (COO/Form) dari eksportir',
        '                      {t("importTariff.cooCertNote")}',
    ),
    # Auto-calc indicator states
    (
        '                    <span>Menghitung otomatis…</span>',
        '                    <span>{t("importTariff.calculating")}</span>',
    ),
    (
        '                    <span>Auto-hitung aktif — diperbarui otomatis saat input berubah</span>',
        '                    <span>{t("importTariff.autoCalcActive")}</span>',
    ),
    (
        '                    <span>Menghitung…</span>',
        '                    <span>{t("importTariff.calcSpinner")}</span>',
    ),
    (
        '                  <p className="text-xs text-slate-400">Lengkapi form untuk mulai menghitung</p>',
        '                  <p className="text-xs text-slate-400">{t("importTariff.fillForm")}</p>',
    ),
    # Ready state
    (
        '                  <h3 className="text-base font-semibold text-slate-700">Siap Menghitung</h3>',
        '                  <h3 className="text-base font-semibold text-slate-700">{t("importTariff.readyTitle")}</h3>',
    ),
    (
        '                    Pilih HS Code dan masukkan nilai barang — kalkulasi berjalan otomatis',
        '                    {t("importTariff.readyDesc")}',
    ),
    # Ready state cards
    (
        '{ icon: <Receipt className="h-4 w-4 text-blue-500" />, label: "Bea Masuk (BM)", color: "bg-blue-50" },',
        '{ icon: <Receipt className="h-4 w-4 text-blue-500" />, label: t("importTariff.calcLabel_bm"), color: "bg-blue-50" },',
    ),
    (
        '{ icon: <Banknote className="h-4 w-4 text-green-500" />, label: "PPN Impor", color: "bg-green-50" },',
        '{ icon: <Banknote className="h-4 w-4 text-green-500" />, label: t("importTariff.calcLabel_ppn"), color: "bg-green-50" },',
    ),
    (
        '{ icon: <Building2 className="h-4 w-4 text-orange-500" />, label: "PPh Pasal 22", color: "bg-orange-50" },',
        '{ icon: <Building2 className="h-4 w-4 text-orange-500" />, label: t("importTariff.calcLabel_pph"), color: "bg-orange-50" },',
    ),
    # Loading
    (
        '                  <p className="text-sm text-slate-600">Menghitung pajak impor…</p>',
        '                  <p className="text-sm text-slate-600">{t("importTariff.calcLoading")}</p>',
    ),
    # LARTAS labels
    (
        '                              {result.lartas.description && (',
        '                              {result.lartas.description && (',
    ),  # no-op anchor
    # Export buttons (title attrs)
    (
        '                          title="Export CSV"',
        '                          title={t("importTariff.exportCsv")}',
    ),
    (
        '                          title="Export JSON"',
        '                          title={t("importTariff.exportJson")}',
    ),
    # HS section title
    (
        '                      HS Code — BTKI 2022',
        '                      {t("importTariff.hsSectionTitle")}',
    ),
    # Input summary labels
    (
        '                        <span className="text-slate-400">Nilai Barang</span>',
        '                        <span className="text-slate-400">{t("importTariff.inputGoodsValueLabel")}</span>',
    ),
    (
        '                        <span className="text-slate-400">Kurs Pakai</span>',
        '                        <span className="text-slate-400">{t("importTariff.inputRateUsedLabel")}</span>',
    ),
    (
        '                        <span className="text-slate-400">Incoterm</span>',
        '                        <span className="text-slate-400">{t("importTariff.step3Title")}</span>',
    ),
    (
        '                        <span className="text-slate-400">Skema Tarif BM</span>',
        '                        <span className="text-slate-400">{t("importTariff.inputDutyScheme")}</span>',
    ),
    (
        '                        <span className="text-slate-400">NDPBM (Nilai CIF dalam IDR)</span>',
        '                        <span className="text-slate-400">{t("importTariff.inputNdpbm")}</span>',
    ),
    # Tax detail table
    (
        '                      <h3 className="text-sm font-bold text-slate-800">Rincian Pajak &amp; Pungutan Impor</h3>',
        '                      <h3 className="text-sm font-bold text-slate-800">{t("importTariff.taxDetailTitle")}</h3>',
    ),
    (
        '                          <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-5 py-2.5">Komponen</th>',
        '                          <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-5 py-2.5">{t("importTariff.tableColComponent")}</th>',
    ),
    (
        '                          <th className="text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-5 py-2.5">Tarif</th>',
        '                          <th className="text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-5 py-2.5">{t("importTariff.tableColRate")}</th>',
    ),
    (
        '                          <th className="text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-5 py-2.5">Jumlah (IDR)</th>',
        '                          <th className="text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-5 py-2.5">{t("importTariff.tableColAmount")}</th>',
    ),
    # NDPBM table row
    (
        '                              Nilai Barang (NDPBM/CIF)',
        '                              {t("importTariff.ndpbmLabel")}',
    ),
    # BM table row
    (
        '                              Bea Masuk (BM)',
        '                              {t("importTariff.calcLabel_bm")}',
    ),
    # FTA result label
    (
        '                          Tarif Preferensi FTA',
        '                          {t("importTariff.ftaRateResult")}',
    ),
    # Import help CTA
    (
        '                    Butuh Bantuan Pengurusan Impor?',
        '                    {t("importTariff.importHelpTitle")}',
    ),
    # Multi-HS shared settings
    (
        '                Pengaturan Bersama',
        '                {t("importTariff.multiSharedSettings")}',
    ),
    # Multi-HS currency label
    (
        '                  <label className="text-xs font-medium text-slate-500 block mb-1.5">Mata Uang</label>',
        '                  <label className="text-xs font-medium text-slate-500 block mb-1.5">{t("importTariff.currencyLabel")}</label>',
    ),
    # LARTAS labels
    (
        '                              Keterangan:',
        '                              {t("importTariff.lartasNotes")}',
    ),
    (
        '                              Regulator:',
        '                              {t("importTariff.lartasRegulator")}',
    ),
    (
        '                              Perizinan yang dibutuhkan:',
        '                              {t("importTariff.lartasPermits")}',
    ),
]

# ── Run all patches ──────────────────────────────────────────────────────────────
FILES = [
    ("pabean.tsx", pabean_replacements),
    ("custom-clearance.tsx", cc_replacements),
    ("marketplace.tsx", mkt_replacements),
    ("login.tsx", login_replacements),
    ("import-tariff-calculator.tsx", it_replacements),
]

for filename, replacements in FILES:
    # Remove no-op entries
    real_replacements = [(o, n) for o, n in replacements if o != n]
    applied, skipped = patch(filename, real_replacements)
    print(f"\n{filename}:")
    print(f"  Applied ({len(applied)}): OK")
    if skipped:
        print(f"  SKIPPED ({len(skipped)}) — not found in file:")
        for s in skipped:
            print(f"    • {s!r}")
