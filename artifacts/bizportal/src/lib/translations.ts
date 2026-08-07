export type Locale =
  | "id-ID" | "en-US" | "en-GB" | "zh-CN" | "zh-TW" | "ja-JP"
  | "ko-KR" | "ar-SA" | "fr-FR" | "de-DE" | "es-ES" | "pt-BR"
  | "ru-RU" | "hi-IN" | "ms-MY" | "th-TH" | "vi-VN";

type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };

function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key in override) {
    const v = (override as Record<string, unknown>)[key];
    const b = (base as Record<string, unknown>)[key];
    if (v !== undefined) {
      if (typeof v === "object" && v !== null && typeof b === "object" && b !== null) {
        result[key] = deepMerge(b as Record<string, unknown>, v as Record<string, unknown>);
      } else {
        result[key] = v;
      }
    }
  }
  return result as T;
}

export interface Translations {
  nav: {
    modules: string;
    dashboard: string;
    sales: string;
    salesDashboard: string;
    masterItem: string;
    quotations: string;
    salesOrders: string;
    aiDrafts: string;
    customers: string;
    invoices: string;
    purchase: string;
    purchaseDashboard: string;
    rfq: string;
    purchaseOrders: string;
    vendors: string;
    vendorService: string;
    bills: string;
    reports: string;
    salesReport: string;
    purchaseReport: string;
    arAging: string;
    apAging: string;
    accounting: string;
    chartOfAccounts: string;
    journals: string;
    journalEntry: string;
    journalItems: string;
    payments: string;
    taxes: string;
    trialBalance: string;
    generalLedger: string;
    profitLoss: string;
    balanceSheet: string;
    reconciliation: string;
    accountingSettings: string;
    trading: string;
    overview: string;
    logistics: string;
    shipments: string;
    freightForwarding: string;
    portalOrders: string;
    portalProductOrders: string;
    pos: string;
    expense: string;
    expenseList: string;
    expenseCategories: string;
    expenseReports: string;
    correspondences: string;
    emailInbox: string;
    users: string;
    aiChatbot: string;
    aiKnowledgeBase: string;
    aiScanSettings: string;
    uomSettings: string;
    settings: string;
    holding: string;
    holdingDashboard: string;
    holdingPLReport: string;
    holdingCompanies: string;
    holdingCoa: string;
    holdingJournals: string;
  };
  common: {
    save: string;
    saving: string;
    saved: string;
    cancel: string;
    delete: string;
    edit: string;
    add: string;
    search: string;
    filter: string;
    loading: string;
    error: string;
    success: string;
    noData: string;
    noResults: string;
    confirm: string;
    close: string;
    back: string;
    next: string;
    submit: string;
    create: string;
    update: string;
    view: string;
    download: string;
    export: string;
    import: string;
    print: string;
    all: string;
    status: string;
    date: string;
    name: string;
    email: string;
    phone: string;
    address: string;
    description: string;
    amount: string;
    total: string;
    actions: string;
    type: string;
    category: string;
    logOut: string;
    noRole: string;
    division: string;
    signOut: string;
    refresh: string;
    off: string;
    seconds: string;
    minute: string;
    interval: string;
    accessDenied: string;
    adminOnly: string;
    optional: string;
    contactEmail: string;
    confirmDeleteTitle: string;
    confirmDeleteDesc: string;
    viewAll: string;
    new: string;
    inProgress: string;
    completed: string;
    cancelled: string;
    noResults2: string;
    number: string;
  };
  welcome: {
    title: string;
    subtitle: string;
    ecommerce: string;
    ecommerceDesc: string;
    ecommerceDetail: string;
    trading: string;
    tradingDesc: string;
    tradingDetail: string;
    logistics: string;
    logisticsDesc: string;
    logisticsDetail: string;
    pos: string;
    posDesc: string;
    posDetail: string;
    signOut: string;
  };
  dashboard: {
    title: string;
    subtitle: string;
    totalRevenue: string;
    totalOrders: string;
    activeCustomers: string;
    pendingShipments: string;
    recentOrders: string;
    salesOverview: string;
    quickActions: string;
    newQuotation: string;
    newOrder: string;
    viewReports: string;
    activeFreight: string;
    awaitingQuote: string;
    inTransit: string;
    driverStatus: string;
    available: string;
    busy: string;
    portalOrdersTitle: string;
    systemHealth: string;
    refreshInterval: string;
    allOrders: string;
    createSalesOrder: string;
    statusUpdated: string;
    updatedAt: string;
    refreshIn: string;
    loadedIn: string;
    allPortalOrders: string;
    noOrdersForStatus: string;
    noActiveDrivers: string;
  };
  settings: {
    title: string;
    profile: string;
    language: string;
    languageDesc: string;
    notifications: string;
    security: string;
    calculator: string;
    calculatorDesc: string;
    cargoTypes: string;
    cargoTypesDesc: string;
    aiIntake: string;
    aiIntakeDesc: string;
    waNotif: string;
    waNotifDesc: string;
  };
  pos: {
    title: string;
    subtitle: string;
    products: string;
    cart: string;
    total: string;
    payment: string;
    cashier: string;
    receipt: string;
    emptyCart: string;
    checkout: string;
    searchProduct: string;
    cashierTab: string;
    historyStats: string;
    selectProduct: string;
    searchProductSku: string;
    noProducts: string;
    paymentMethod: string;
    cash: string;
    qris: string;
    debit: string;
    credit: string;
    transfer: string;
    items: string;
    todaySales: string;
    txCount: string;
    avgOrder: string;
    historyTitle: string;
    time: string;
    product: string;
    price: string;
    document: string;
    noTransactions: string;
    qty: string;
    monthSales: string;
    monthTxCount: string;
    isProcessing: string;
    pay: string;
  };
  trading: {
    title: string;
    subtitle: string;
    inventory: string;
    stock: string;
    sku: string;
    costPrice: string;
    salePrice: string;
    hsCode: string;
    supplier: string;
    stockInventory: string;
    addStock: string;
    addStockTitle: string;
    addStockDesc: string;
    editStockTitle: string;
    addSupplierTitle: string;
    editSupplierTitle: string;
    productName: string;
    quantity: string;
    unit: string;
    noStock: string;
    noSuppliers: string;
    supplierName: string;
    country: string;
    addSupplier: string;
  };
  logistics: {
    title: string;
    subtitle: string;
    trackingNumber: string;
    origin: string;
    destination: string;
    estimatedDelivery: string;
    deliveryStatus: string;
    driver: string;
    vehicle: string;
    weight: string;
    dimensions: string;
    newShipment: string;
    statusDraft: string;
    statusRfqSent: string;
    statusConfirmed: string;
    statusInTransit: string;
    statusCompleted: string;
    statusCancelled: string;
    noShipments: string;
    allStatus: string;
    last7Days: string;
    last30Days: string;
    custom: string;
    newest: string;
    oldest: string;
    filters: string;
    clearFilters: string;
    viewAll: string;
    freightTitle: string;
    freightSubtitle: string;
    shipmentsTitle: string;
    shipmentsSubtitle: string;
    addShipment: string;
    carrier: string;
    sortBy: string;
    dateRange: string;
  };
  sales: {
    title: string;
    subtitle: string;
    quotation: string;
    order: string;
    invoice: string;
    customer: string;
    item: string;
    qty: string;
    unitPrice: string;
    subtotal: string;
    discount: string;
    tax: string;
    grandTotal: string;
    dueDate: string;
    paymentTerms: string;
    notes: string;
    newQuotation: string;
    newOrder: string;
    newInvoice: string;
    toInvoice: string;
    revenue: string;
    recentDocuments: string;
    noDocuments: string;
    searchPlaceholder: string;
    docNumber: string;
    customerName: string;
  };
  purchase: {
    title: string;
    subtitle: string;
    rfq: string;
    order: string;
    bill: string;
    vendor: string;
    item: string;
    qty: string;
    unitPrice: string;
    subtotal: string;
    newRFQ: string;
    newOrder: string;
    newBill: string;
    toReceive: string;
    toBill: string;
    totalSpend: string;
    recentDocuments: string;
    noDocuments: string;
  };
  users: {
    title: string;
    subtitle: string;
    editTitle: string;
    editDesc: string;
    role: string;
    divisionOptional: string;
    noUsers: string;
    accessDenied: string;
    adminOnly: string;
  };
  notFound: {
    title: string;
    subtitle: string;
  };
  accounting: {
    title: string;
    account: string;
    debit: string;
    credit: string;
    balance: string;
    journal: string;
    entry: string;
    payment: string;
    tax: string;
    period: string;
    openingBalance: string;
    closingBalance: string;
    netIncome: string;
    totalAssets: string;
    totalLiabilities: string;
    equity: string;
  };
  uom: {
    title: string; addUom: string; editUom: string; deleteUom: string;
    conversions: string; addConversion: string; editConversion: string; deleteConversion: string;
    symbol: string; factor: string; meaning: string; fromUom: string; toUom: string;
    selectUom: string; active: string; inactive: string;
    saved: string; deleted: string; conversionSaved: string; conversionDeleted: string;
    confirmDelete: string; confirmDeleteConversion: string;
  };
  reportsMain: {
    title: string; subtitle: string;
    groupPos: string; groupInventory: string;
    tabDaily: string; tabBranch: string; tabCashier: string; tabTopProducts: string;
    tabStock: string; tabStockLow: string; tabMovements: string; tabTransfers: string; tabReturns: string;
    filterFrom: string; filterTo: string; filterCompany: string; filterBranch: string;
    filterWarehouse: string; filterCashier: string; filterProduct: string; filterThreshold: string;
    filterReset: string; export: string; loading: string; noData: string;
  };
  vendorStatus: {
    aktif: string;
    nonaktif: string;
    ditangguhkan: string;
    diarsipkan: string;
    dipublikasikan: string;
    ditarikDariMarketplace: string;
    statusDiperbarui: string;
    gagalUbahStatus: string;
    vendorTerverifikasi: string;
    gagalVerifikasi: string;
    statusMarketplaceDiperbarui: string;
    dokumenTersimpan: string;
    jenisDokumenWajib: string;
    gagalUploadDokumen: string;
    dokumenDihapus: string;
    gagalModerasiReview: string;
    memuatStatus: string;
    statusLegalitas: string;
    terverifikasi: string;
    belumTerverifikasi: string;
    marketplace: string;
    vendorTidakBisaTransaksi: string;
    ubahStatus: string;
    dokumen: string;
    riwayat: string;
    review: string;
    statusBaru: string;
    pilihStatus: string;
    statusMarketplace: string;
    alasanOpsional: string;
    terapkanStatus: string;
    verifikasiVendor: string;
    jenisDokumen: string;
    fileOpsional: string;
    simpanDokumen: string;
    kadaluarsa: string;
    setujuiPublikasikan: string;
    tolak: string;
  };
  kasirUsers: {
    kembali: string;
    dashboard: string;
    tenantProperty: string;
    posTenant: string;
    kasirPengguna: string;
    semuaCabang: string;
    tambah: string;
    terakhirDiperbarui: string;
    username: string;
    namaLengkap: string;
    role: string;
    cabang: string;
    kontak: string;
    status: string;
    aktif: string;
    nonaktif: string;
    nonaktifkanUser: string;
    editPengguna: string;
    tambahPengguna: string;
    pilihCabang: string;
    tidakAda: string;
    email: string;
    telepon: string;
    batal: string;
    menyimpan: string;
    simpan: string;
    tersimpan: string;
    dinonaktifkan: string;
    errorMsg: string;
  };
}

const id: Translations = {
  nav: {
    modules: "Modul",
    dashboard: "Dashboard",
    sales: "Sales",
    salesDashboard: "Dashboard",
    masterItem: "Master Item",
    quotations: "Penawaran",
    salesOrders: "Sales Order",
    aiDrafts: "AI Drafts",
    customers: "Pelanggan",
    invoices: "Invoice",
    purchase: "Pembelian",
    purchaseDashboard: "Dashboard",
    rfq: "RFQ",
    purchaseOrders: "Purchase Order",
    vendors: "Vendor",
    vendorService: "Vendor Layanan",
    bills: "Tagihan",
    reports: "Laporan",
    salesReport: "Penjualan",
    purchaseReport: "Pembelian",
    arAging: "Piutang (AR)",
    apAging: "Hutang (AP)",
    accounting: "Akunting",
    chartOfAccounts: "Bagan Akun",
    journals: "Jurnal",
    journalEntry: "Jurnal Entry",
    journalItems: "Jurnal Items",
    payments: "Pembayaran",
    taxes: "Pajak",
    trialBalance: "Neraca Saldo",
    generalLedger: "Buku Besar",
    profitLoss: "Laba Rugi",
    balanceSheet: "Neraca",
    reconciliation: "Rekonsiliasi",
    accountingSettings: "Pengaturan",
    overview: "Ikhtisar",
    trading: "Trading",
    logistics: "Logistik",
    shipments: "Pengiriman",
    freightForwarding: "Freight Forwarding",
    portalOrders: "Pesanan Portal Logistik",
    portalProductOrders: "Pesanan Portal Produk",
    pos: "POS",
    expense: "Biaya Operasional",
    expenseList: "Daftar Expense",
    expenseCategories: "Kategori Biaya",
    expenseReports: "Laporan",
    correspondences: "Korespondensi",
    emailInbox: "Kotak Masuk Email",
    users: "Pengguna",
    aiChatbot: "AI Chatbot",
    aiKnowledgeBase: "Knowledge Base",
    aiScanSettings: "Scan Dokumen",
    uomSettings: "Satuan Ukur",
    settings: "Pengaturan",
    holding: "Holding",
    holdingDashboard: "Holding Dashboard",
    holdingPLReport: "Laporan Laba Rugi",
    holdingCompanies: "Data Perusahaan",
    holdingCoa: "Bagan Akun",
    holdingJournals: "Jurnal",
  },
  common: {
    save: "Simpan",
    saving: "Menyimpan...",
    saved: "Tersimpan!",
    cancel: "Batal",
    delete: "Hapus",
    edit: "Edit",
    add: "Tambah",
    search: "Cari",
    filter: "Filter",
    loading: "Memuat...",
    error: "Error",
    success: "Berhasil",
    noData: "Tidak ada data",
    noResults: "Tidak ada hasil",
    confirm: "Konfirmasi",
    close: "Tutup",
    back: "Kembali",
    next: "Selanjutnya",
    submit: "Kirim",
    create: "Buat",
    update: "Perbarui",
    view: "Lihat",
    download: "Unduh",
    export: "Ekspor",
    import: "Impor",
    print: "Cetak",
    all: "Semua",
    status: "Status",
    date: "Tanggal",
    name: "Nama",
    email: "Email",
    phone: "Telepon",
    address: "Alamat",
    description: "Keterangan",
    amount: "Jumlah",
    total: "Total",
    actions: "Aksi",
    type: "Tipe",
    category: "Kategori",
    logOut: "Keluar",
    noRole: "Belum Ada Role",
    division: "Divisi",
    signOut: "Keluar",
    number: "No.",
    refresh: "Refresh",
    off: "Mati",
    seconds: "detik",
    minute: "menit",
    interval: "Interval",
    accessDenied: "Akses ditolak",
    adminOnly: "Hanya admin yang dapat mengakses halaman ini.",
    optional: "opsional",
    contactEmail: "Email Kontak",
    confirmDeleteTitle: "Konfirmasi Hapus",
    confirmDeleteDesc: "Tindakan ini tidak dapat dibatalkan.",
    viewAll: "Lihat Semua",
    new: "Baru",
    inProgress: "Sedang Diproses",
    completed: "Selesai",
    cancelled: "Dibatalkan",
    noResults2: "Tidak ada hasil yang cocok.",
  },
  welcome: {
    title: "Selamat Datang di BizPortal",
    subtitle: "Akun Anda sudah terdaftar. Hubungi administrator untuk mendapatkan akses ke divisi Anda.",
    ecommerce: "E-Commerce",
    ecommerceDesc: "Manajemen Retail Online",
    ecommerceDetail: "Kelola produk toko online Anda, lacak pesanan pelanggan, dan pantau performa penjualan digital.",
    trading: "Trading",
    tradingDesc: "Inventaris & Supplier B2B",
    tradingDetail: "Lacak inventaris massal, kelola hubungan supplier, pantau harga pokok, dan tangani HS code untuk perdagangan internasional.",
    logistics: "Logistik",
    logisticsDesc: "Pelacakan Armada & Pengiriman",
    logisticsDetail: "Pantau pengiriman secara real-time, perbarui status pengiriman, dan pastikan paket tiba tepat waktu.",
    pos: "Point of Sale",
    posDesc: "Transaksi Toko",
    posDetail: "Proses transaksi retail dengan cepat, dukung berbagai metode pembayaran, dan lacak pendapatan harian toko fisik.",
    signOut: "Keluar",
  },
  dashboard: {
    title: "Dashboard",
    subtitle: "Ringkasan operasional dan KPI bisnis secara real-time.",
    totalRevenue: "Total Pendapatan",
    totalOrders: "Total Order",
    activeCustomers: "Pelanggan Aktif",
    pendingShipments: "Pengiriman Tertunda",
    recentOrders: "Order Terbaru",
    salesOverview: "Ringkasan Penjualan",
    quickActions: "Aksi Cepat",
    newQuotation: "Penawaran Baru",
    newOrder: "Order Baru",
    viewReports: "Lihat Laporan",
    activeFreight: "Freight Aktif",
    awaitingQuote: "Menunggu Penawaran",
    inTransit: "Dalam Perjalanan",
    driverStatus: "Status Pengemudi",
    available: "Tersedia",
    busy: "Sibuk",
    portalOrdersTitle: "Pesanan Portal",
    systemHealth: "Kesehatan Sistem",
    refreshInterval: "Interval Refresh",
    allOrders: "Semua",
    createSalesOrder: "Buat Sales Order",
    statusUpdated: "Status diperbarui",
    updatedAt: "Diperbarui",
    refreshIn: "Refresh dalam",
    loadedIn: "Muat dalam",
    allPortalOrders: "Semua Portal Order",
    noOrdersForStatus: "Tidak ada pesanan untuk status ini",
    noActiveDrivers: "Belum ada driver aktif",
  },
  settings: {
    title: "Pengaturan",
    profile: "Profil",
    language: "Bahasa",
    languageDesc: "Pilih bahasa tampilan",
    notifications: "Notifikasi",
    security: "Keamanan",
    calculator: "Kalkulator Tarif",
    calculatorDesc: "Konfigurasi tarif estimasi biaya logistik",
    cargoTypes: "Tipe Kargo",
    cargoTypesDesc: "Daftar tipe kargo untuk kalkulator",
    aiIntake: "AI Order Intake",
    aiIntakeDesc: "Pengaturan AI untuk proses email/WA masuk",
    waNotif: "Notifikasi WhatsApp",
    waNotifDesc: "Nomor WhatsApp admin untuk notifikasi",
  },
  pos: {
    title: "Point of Sale",
    subtitle: "Kelola transaksi toko fisik dan ringkasan penjualan harian.",
    products: "Produk",
    cart: "Keranjang",
    total: "Total",
    payment: "Pembayaran",
    cashier: "Kasir",
    receipt: "Struk",
    emptyCart: "Keranjang kosong",
    checkout: "Bayar",
    searchProduct: "Cari produk...",
    cashierTab: "Kasir",
    historyStats: "Riwayat & Statistik",
    selectProduct: "Pilih Produk",
    searchProductSku: "Cari produk / SKU...",
    noProducts: "Belum ada produk. Tambahkan dari halaman E-Commerce.",
    paymentMethod: "Metode Pembayaran",
    cash: "Tunai",
    qris: "QRIS",
    debit: "Debit",
    credit: "Kredit",
    transfer: "Transfer",
    items: "item",
    todaySales: "Penjualan Hari Ini",
    txCount: "Jumlah Transaksi",
    avgOrder: "Rata-rata Order",
    historyTitle: "Riwayat Transaksi",
    time: "Waktu",
    product: "Produk",
    price: "Harga",
    document: "Dokumen",
    noTransactions: "Belum ada transaksi.",
    qty: "Qty",
    monthSales: "Penjualan Bulan Ini",
    monthTxCount: "Transaksi Bulan Ini",
    isProcessing: "Memproses...",
    pay: "Bayar",
  },
  trading: {
    title: "Trading & B2B",
    subtitle: "Kelola inventory grosir, supplier, dan barang impor.",
    inventory: "Inventaris",
    stock: "Stok",
    sku: "SKU",
    costPrice: "Harga Pokok",
    salePrice: "Harga Jual",
    hsCode: "HS Code",
    supplier: "Supplier",
    stockInventory: "Stock Inventory",
    addStock: "Tambah Stock",
    addStockTitle: "Tambah Inventory",
    addStockDesc: "Catat stok grosir baru ke gudang.",
    editStockTitle: "Edit Stock",
    addSupplierTitle: "Tambah Supplier",
    editSupplierTitle: "Edit Supplier",
    productName: "Nama Produk",
    quantity: "Jumlah",
    unit: "Satuan",
    noStock: "Belum ada stock inventory.",
    noSuppliers: "Belum ada supplier.",
    supplierName: "Nama Supplier",
    country: "Negara",
    addSupplier: "Tambah Supplier",
  },
  logistics: {
    title: "Logistik",
    subtitle: "Lacak pengiriman dan kelola operasi armada.",
    trackingNumber: "Nomor Resi",
    origin: "Asal",
    destination: "Tujuan",
    estimatedDelivery: "Estimasi Tiba",
    deliveryStatus: "Status Pengiriman",
    driver: "Pengemudi",
    vehicle: "Kendaraan",
    weight: "Berat",
    dimensions: "Dimensi",
    newShipment: "Pengiriman Baru",
    statusDraft: "Draft",
    statusRfqSent: "RFQ Dikirim",
    statusConfirmed: "Dikonfirmasi",
    statusInTransit: "Dalam Perjalanan",
    statusCompleted: "Selesai",
    statusCancelled: "Dibatalkan",
    noShipments: "Belum ada pengiriman.",
    allStatus: "Semua Status",
    last7Days: "7 Hari Terakhir",
    last30Days: "30 Hari Terakhir",
    custom: "Kustom",
    newest: "Terbaru",
    oldest: "Terlama",
    filters: "Filter",
    clearFilters: "Hapus Filter",
    viewAll: "Lihat Semua",
    freightTitle: "Freight Forwarding",
    freightSubtitle: "Shipment internasional aktif.",
    shipmentsTitle: "Pengiriman Lokal",
    shipmentsSubtitle: "Daftar pengiriman armada lokal.",
    addShipment: "Tambah Pengiriman",
    carrier: "Carrier",
    sortBy: "Urutkan",
    dateRange: "Rentang Tanggal",
  },
  sales: {
    title: "Sales",
    subtitle: "Ringkasan penjualan dan dokumen terbaru.",
    quotation: "Penawaran",
    order: "Order",
    invoice: "Invoice",
    customer: "Pelanggan",
    item: "Item",
    qty: "Qty",
    unitPrice: "Harga Satuan",
    subtotal: "Subtotal",
    discount: "Diskon",
    tax: "Pajak",
    grandTotal: "Total",
    dueDate: "Jatuh Tempo",
    paymentTerms: "Syarat Pembayaran",
    notes: "Catatan",
    newQuotation: "Penawaran Baru",
    newOrder: "Order Baru",
    newInvoice: "Invoice Baru",
    toInvoice: "Perlu Ditagih",
    revenue: "Pendapatan",
    recentDocuments: "Dokumen Terbaru",
    noDocuments: "Belum ada dokumen.",
    searchPlaceholder: "Cari dokumen...",
    docNumber: "No. Dokumen",
    customerName: "Nama Pelanggan",
  },
  purchase: {
    title: "Pembelian",
    subtitle: "Ringkasan pembelian dan dokumen terbaru.",
    rfq: "RFQ",
    order: "Purchase Order",
    bill: "Tagihan",
    vendor: "Vendor",
    item: "Item",
    qty: "Qty",
    unitPrice: "Harga Satuan",
    subtotal: "Subtotal",
    newRFQ: "RFQ Baru",
    newOrder: "PO Baru",
    newBill: "Tagihan Baru",
    toReceive: "Perlu Diterima",
    toBill: "Perlu Ditagih",
    totalSpend: "Total Belanja",
    recentDocuments: "Dokumen Terbaru",
    noDocuments: "Belum ada dokumen.",
  },
  users: {
    title: "Manajemen Pengguna",
    subtitle: "Atur peran dan divisi setiap pengguna sistem.",
    editTitle: "Edit Pengguna",
    editDesc: "Ubah peran dan divisi pengguna.",
    role: "Peran",
    divisionOptional: "Divisi (opsional)",
    noUsers: "Belum ada pengguna terdaftar.",
    accessDenied: "Akses Ditolak",
    adminOnly: "Hanya admin yang dapat membuka halaman ini.",
  },
  notFound: {
    title: "404 Halaman Tidak Ditemukan",
    subtitle: "Halaman yang Anda cari tidak ditemukan.",
  },
  accounting: {
    title: "Akunting",
    account: "Akun",
    debit: "Debit",
    credit: "Kredit",
    balance: "Saldo",
    journal: "Jurnal",
    entry: "Entry",
    payment: "Pembayaran",
    tax: "Pajak",
    period: "Periode",
    openingBalance: "Saldo Awal",
    closingBalance: "Saldo Akhir",
    netIncome: "Laba Bersih",
    totalAssets: "Total Aset",
    totalLiabilities: "Total Liabilitas",
    equity: "Ekuitas",
  },
  uom: {
    title: "Satuan Ukur",
    addUom: "Tambah Satuan",
    editUom: "Edit Satuan",
    deleteUom: "Hapus Satuan",
    conversions: "Konversi",
    addConversion: "Tambah Konversi",
    editConversion: "Edit Konversi",
    deleteConversion: "Hapus Konversi",
    symbol: "Simbol",
    factor: "Faktor",
    meaning: "Arti",
    fromUom: "Dari Satuan",
    toUom: "Ke Satuan",
    selectUom: "Pilih Satuan",
    active: "Aktif",
    inactive: "Tidak Aktif",
    saved: "Tersimpan",
    deleted: "Terhapus",
    conversionSaved: "Konversi Tersimpan",
    conversionDeleted: "Konversi Terhapus",
    confirmDelete: "Hapus satuan ini?",
    confirmDeleteConversion: "Hapus konversi ini?",
  },
  reportsMain: {
    title: "Laporan",
    subtitle: "Ringkasan laporan operasional",
    groupPos: "POS",
    groupInventory: "Inventaris",
    tabDaily: "Harian",
    tabBranch: "Cabang",
    tabCashier: "Kasir",
    tabTopProducts: "Produk Terlaris",
    tabStock: "Stok",
    tabStockLow: "Stok Menipis",
    tabMovements: "Pergerakan",
    tabTransfers: "Transfer",
    tabReturns: "Retur",
    filterFrom: "Dari",
    filterTo: "Sampai",
    filterCompany: "Perusahaan",
    filterBranch: "Cabang",
    filterWarehouse: "Gudang",
    filterCashier: "Kasir",
    filterProduct: "Produk",
    filterThreshold: "Batas Minimum",
    filterReset: "Reset Filter",
    export: "Ekspor",
    loading: "Memuat...",
    noData: "Tidak ada data",
  },
  vendorStatus: {
    aktif: "Aktif",
    nonaktif: "Nonaktif",
    ditangguhkan: "Ditangguhkan",
    diarsipkan: "Diarsipkan",
    dipublikasikan: "Dipublikasikan",
    ditarikDariMarketplace: "Ditarik dari Marketplace",
    statusDiperbarui: "Status vendor diperbarui",
    gagalUbahStatus: "Gagal mengubah status",
    vendorTerverifikasi: "Vendor terverifikasi",
    gagalVerifikasi: "Gagal verifikasi vendor",
    statusMarketplaceDiperbarui: "Status marketplace diperbarui",
    dokumenTersimpan: "Dokumen tersimpan",
    jenisDokumenWajib: "Jenis dokumen wajib diisi",
    gagalUploadDokumen: "Gagal upload dokumen",
    dokumenDihapus: "Dokumen dihapus",
    gagalModerasiReview: "Gagal moderasi review",
    memuatStatus: "Memuat status vendor…",
    statusLegalitas: "Status & Legalitas Vendor",
    terverifikasi: "Terverifikasi",
    belumTerverifikasi: "Belum Terverifikasi",
    marketplace: "Marketplace",
    vendorTidakBisaTransaksi: "Vendor tidak bisa bertransaksi",
    ubahStatus: "Ubah Status",
    dokumen: "Dokumen",
    riwayat: "Riwayat",
    review: "Review",
    statusBaru: "Status Baru",
    pilihStatus: "Pilih status",
    statusMarketplace: "Status Marketplace",
    alasanOpsional: "Alasan (opsional, tercatat di riwayat)",
    terapkanStatus: "Terapkan Status",
    verifikasiVendor: "Verifikasi Vendor",
    jenisDokumen: "Jenis Dokumen",
    fileOpsional: "File (opsional)",
    simpanDokumen: "Simpan Dokumen",
    kadaluarsa: "kadaluarsa",
    setujuiPublikasikan: "Setujui & Publikasikan",
    tolak: "Tolak",
  },
  kasirUsers: {
    kembali: "Kembali",
    dashboard: "Dashboard",
    tenantProperty: "Tenant & Property",
    posTenant: "POS Tenant",
    kasirPengguna: "Kasir — Pengguna",
    semuaCabang: "Semua cabang",
    tambah: "Tambah",
    terakhirDiperbarui: "Terakhir diperbarui",
    username: "Username",
    namaLengkap: "Nama Lengkap",
    role: "Role",
    cabang: "Cabang",
    kontak: "Kontak",
    status: "Status",
    aktif: "Aktif",
    nonaktif: "Nonaktif",
    nonaktifkanUser: "Nonaktifkan user ini?",
    editPengguna: "Edit Pengguna Kasir",
    tambahPengguna: "Tambah Pengguna Kasir",
    pilihCabang: "Pilih cabang",
    tidakAda: "— Tidak ada —",
    email: "Email",
    telepon: "Telepon / WA",
    batal: "Batal",
    menyimpan: "Menyimpan...",
    simpan: "Simpan",
    tersimpan: "Tersimpan",
    dinonaktifkan: "Dinonaktifkan",
    errorMsg: "Error",
  },
};

const en: Translations = {
  nav: {
    modules: "Modules",
    dashboard: "Dashboard",
    sales: "Sales",
    salesDashboard: "Dashboard",
    masterItem: "Master Items",
    quotations: "Quotations",
    salesOrders: "Sales Orders",
    aiDrafts: "AI Drafts",
    customers: "Customers",
    invoices: "Invoices",
    purchase: "Purchase",
    purchaseDashboard: "Dashboard",
    rfq: "RFQ",
    purchaseOrders: "Purchase Orders",
    vendors: "Vendors",
    vendorService: "Service Vendors",
    bills: "Bills",
    reports: "Reports",
    salesReport: "Sales",
    purchaseReport: "Purchase",
    arAging: "Receivables (AR)",
    apAging: "Payables (AP)",
    accounting: "Accounting",
    chartOfAccounts: "Chart of Accounts",
    journals: "Journals",
    journalEntry: "Journal Entry",
    journalItems: "Journal Items",
    payments: "Payments",
    taxes: "Taxes",
    trialBalance: "Trial Balance",
    generalLedger: "General Ledger",
    profitLoss: "Profit & Loss",
    balanceSheet: "Balance Sheet",
    reconciliation: "Reconciliation",
    accountingSettings: "Settings",
    overview: "Overview",
    trading: "Trading",
    logistics: "Logistics",
    shipments: "Shipments",
    freightForwarding: "Freight Forwarding",
    portalOrders: "Portal Orders (Logistic)",
    portalProductOrders: "Portal Orders (Product)",
    pos: "POS",
    expense: "Operational Expenses",
    expenseList: "Expense List",
    expenseCategories: "Categories",
    expenseReports: "Reports",
    correspondences: "Correspondences",
    emailInbox: "Email Inbox",
    users: "Users",
    aiChatbot: "AI Chatbot",
    aiKnowledgeBase: "Knowledge Base",
    aiScanSettings: "Document Scan",
    uomSettings: "Unit of Measure",
    settings: "Settings",
    holding: "Holding",
    holdingDashboard: "Holding Dashboard",
    holdingPLReport: "P&L Report",
    holdingCompanies: "Companies",
    holdingCoa: "Chart of Accounts",
    holdingJournals: "Journals",
  },
  common: {
    save: "Save",
    saving: "Saving...",
    saved: "Saved!",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    search: "Search",
    filter: "Filter",
    loading: "Loading...",
    error: "Error",
    success: "Success",
    noData: "No data",
    noResults: "No results",
    confirm: "Confirm",
    close: "Close",
    back: "Back",
    next: "Next",
    submit: "Submit",
    create: "Create",
    update: "Update",
    view: "View",
    download: "Download",
    export: "Export",
    import: "Import",
    print: "Print",
    all: "All",
    status: "Status",
    date: "Date",
    name: "Name",
    email: "Email",
    phone: "Phone",
    address: "Address",
    description: "Description",
    amount: "Amount",
    total: "Total",
    actions: "Actions",
    type: "Type",
    category: "Category",
    logOut: "Log out",
    noRole: "No Role",
    division: "Division",
    signOut: "Sign Out",
    refresh: "Refresh",
    off: "Off",
    seconds: "sec",
    minute: "min",
    interval: "Interval",
    accessDenied: "Access Denied",
    adminOnly: "Only admins can access this page.",
    optional: "optional",
    contactEmail: "Contact Email",
    confirmDeleteTitle: "Confirm Delete",
    confirmDeleteDesc: "This action cannot be undone.",
    viewAll: "View All",
    new: "New",
    inProgress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
    noResults2: "No matching results.",
    number: "No.",
  },
  welcome: {
    title: "Welcome to BizPortal",
    subtitle: "Your account is registered. Contact the administrator to get access to your division.",
    ecommerce: "E-Commerce",
    ecommerceDesc: "Online Retail Management",
    ecommerceDetail: "Manage your online store products, track customer orders, and monitor digital sales performance.",
    trading: "Trading",
    tradingDesc: "B2B Inventory & Suppliers",
    tradingDetail: "Track bulk inventory, manage supplier relationships, monitor cost prices, and handle HS codes for international trading.",
    logistics: "Logistics",
    logisticsDesc: "Fleet & Shipment Tracking",
    logisticsDetail: "Monitor deliveries in real-time, update shipment statuses, and ensure packages reach their destinations on time.",
    pos: "Point of Sale",
    posDesc: "In-Store Transactions",
    posDetail: "Process retail transactions quickly, support multiple payment methods, and track daily physical store revenue.",
    signOut: "Sign Out",
  },
  dashboard: {
    title: "Dashboard",
    subtitle: "Real-time operational summary and business KPIs.",
    totalRevenue: "Total Revenue",
    totalOrders: "Total Orders",
    activeCustomers: "Active Customers",
    pendingShipments: "Pending Shipments",
    recentOrders: "Recent Orders",
    salesOverview: "Sales Overview",
    quickActions: "Quick Actions",
    newQuotation: "New Quotation",
    newOrder: "New Order",
    viewReports: "View Reports",
    activeFreight: "Active Freight",
    awaitingQuote: "Awaiting Quote",
    inTransit: "In Transit",
    driverStatus: "Driver Status",
    available: "Available",
    busy: "Busy",
    portalOrdersTitle: "Portal Orders",
    systemHealth: "System Health",
    refreshInterval: "Refresh Interval",
    allOrders: "All",
    createSalesOrder: "Create Sales Order",
    statusUpdated: "Status updated",
    updatedAt: "Updated",
    refreshIn: "Refresh in",
    loadedIn: "Loaded in",
    allPortalOrders: "All Portal Orders",
    noOrdersForStatus: "No orders for this status",
    noActiveDrivers: "No active drivers",
  },
  settings: {
    title: "Settings",
    profile: "Profile",
    language: "Language",
    languageDesc: "Select display language",
    notifications: "Notifications",
    security: "Security",
    calculator: "Rate Calculator",
    calculatorDesc: "Configure logistics cost estimation rates",
    cargoTypes: "Cargo Types",
    cargoTypesDesc: "Cargo type list for calculator",
    aiIntake: "AI Order Intake",
    aiIntakeDesc: "AI settings for incoming email/WA processing",
    waNotif: "WhatsApp Notifications",
    waNotifDesc: "Admin WhatsApp number for notifications",
  },
  pos: {
    title: "Point of Sale",
    subtitle: "Manage physical store transactions and daily sales summary.",
    products: "Products",
    cart: "Cart",
    total: "Total",
    payment: "Payment",
    cashier: "Cashier",
    receipt: "Receipt",
    emptyCart: "Cart is empty",
    checkout: "Checkout",
    searchProduct: "Search product...",
    cashierTab: "Cashier",
    historyStats: "History & Statistics",
    selectProduct: "Select Product",
    searchProductSku: "Search product / SKU...",
    noProducts: "No products yet. Add them from the E-Commerce page.",
    paymentMethod: "Payment Method",
    cash: "Cash",
    qris: "QRIS",
    debit: "Debit Card",
    credit: "Credit Card",
    transfer: "Bank Transfer",
    items: "item(s)",
    todaySales: "Today's Sales",
    txCount: "Transaction Count",
    avgOrder: "Average Order",
    historyTitle: "Transaction History",
    time: "Time",
    product: "Product",
    price: "Price",
    document: "Document",
    noTransactions: "No transactions yet.",
    qty: "Qty",
    monthSales: "This Month's Sales",
    monthTxCount: "This Month's Transactions",
    isProcessing: "Processing...",
    pay: "Pay",
  },
  trading: {
    title: "Trading & B2B",
    subtitle: "Manage wholesale inventory, suppliers, and imported goods.",
    inventory: "Inventory",
    stock: "Stock",
    sku: "SKU",
    costPrice: "Cost Price",
    salePrice: "Sale Price",
    hsCode: "HS Code",
    supplier: "Supplier",
    stockInventory: "Stock Inventory",
    addStock: "Add Stock",
    addStockTitle: "Add Inventory",
    addStockDesc: "Record new wholesale stock to the warehouse.",
    editStockTitle: "Edit Stock",
    addSupplierTitle: "Add Supplier",
    editSupplierTitle: "Edit Supplier",
    productName: "Product Name",
    quantity: "Quantity",
    unit: "Unit",
    noStock: "No inventory stock yet.",
    noSuppliers: "No suppliers yet.",
    supplierName: "Supplier Name",
    country: "Country",
    addSupplier: "Add Supplier",
  },
  logistics: {
    title: "Logistics",
    subtitle: "Track shipments and manage fleet operations.",
    trackingNumber: "Tracking Number",
    origin: "Origin",
    destination: "Destination",
    estimatedDelivery: "Estimated Delivery",
    deliveryStatus: "Delivery Status",
    driver: "Driver",
    vehicle: "Vehicle",
    weight: "Weight",
    dimensions: "Dimensions",
    newShipment: "New Shipment",
    statusDraft: "Draft",
    statusRfqSent: "RFQ Sent",
    statusConfirmed: "Confirmed",
    statusInTransit: "In Transit",
    statusCompleted: "Completed",
    statusCancelled: "Cancelled",
    noShipments: "No shipments yet.",
    allStatus: "All Statuses",
    last7Days: "Last 7 Days",
    last30Days: "Last 30 Days",
    custom: "Custom",
    newest: "Newest",
    oldest: "Oldest",
    filters: "Filters",
    clearFilters: "Clear Filters",
    viewAll: "View All",
    freightTitle: "Freight Forwarding",
    freightSubtitle: "Active international shipments.",
    shipmentsTitle: "Local Shipments",
    shipmentsSubtitle: "Local fleet shipment list.",
    addShipment: "Add Shipment",
    carrier: "Carrier",
    sortBy: "Sort By",
    dateRange: "Date Range",
  },
  sales: {
    title: "Sales",
    subtitle: "Sales summary and recent documents.",
    quotation: "Quotation",
    order: "Order",
    invoice: "Invoice",
    customer: "Customer",
    item: "Item",
    qty: "Qty",
    unitPrice: "Unit Price",
    subtotal: "Subtotal",
    discount: "Discount",
    tax: "Tax",
    grandTotal: "Grand Total",
    dueDate: "Due Date",
    paymentTerms: "Payment Terms",
    notes: "Notes",
    newQuotation: "New Quotation",
    newOrder: "New Order",
    newInvoice: "New Invoice",
    toInvoice: "To Invoice",
    revenue: "Revenue",
    recentDocuments: "Recent Documents",
    noDocuments: "No documents yet.",
    searchPlaceholder: "Search documents...",
    docNumber: "Doc Number",
    customerName: "Customer Name",
  },
  purchase: {
    title: "Purchase",
    subtitle: "Purchase summary and recent documents.",
    rfq: "RFQ",
    order: "Purchase Order",
    bill: "Bill",
    vendor: "Vendor",
    item: "Item",
    qty: "Qty",
    unitPrice: "Unit Price",
    subtotal: "Subtotal",
    newRFQ: "New RFQ",
    newOrder: "New PO",
    newBill: "New Bill",
    toReceive: "To Receive",
    toBill: "To Bill",
    totalSpend: "Total Spend",
    recentDocuments: "Recent Documents",
    noDocuments: "No documents yet.",
  },
  users: {
    title: "User Management",
    subtitle: "Manage roles and divisions for each system user.",
    editTitle: "Edit User",
    editDesc: "Change user role and division.",
    role: "Role",
    divisionOptional: "Division (optional)",
    noUsers: "No users registered yet.",
    accessDenied: "Access Denied",
    adminOnly: "Only admins can access this page.",
  },
  notFound: {
    title: "404 Page Not Found",
    subtitle: "The page you are looking for does not exist.",
  },
  accounting: {
    title: "Accounting",
    account: "Account",
    debit: "Debit",
    credit: "Credit",
    balance: "Balance",
    journal: "Journal",
    entry: "Entry",
    payment: "Payment",
    tax: "Tax",
    period: "Period",
    openingBalance: "Opening Balance",
    closingBalance: "Closing Balance",
    netIncome: "Net Income",
    totalAssets: "Total Assets",
    totalLiabilities: "Total Liabilities",
    equity: "Equity",
  },
  uom: {
    title: "Units of Measure",
    addUom: "Add Unit",
    editUom: "Edit Unit",
    deleteUom: "Delete Unit",
    conversions: "Conversions",
    addConversion: "Add Conversion",
    editConversion: "Edit Conversion",
    deleteConversion: "Delete Conversion",
    symbol: "Symbol",
    factor: "Factor",
    meaning: "Meaning",
    fromUom: "From Unit",
    toUom: "To Unit",
    selectUom: "Select Unit",
    active: "Active",
    inactive: "Inactive",
    saved: "Saved",
    deleted: "Deleted",
    conversionSaved: "Conversion Saved",
    conversionDeleted: "Conversion Deleted",
    confirmDelete: "Delete this unit?",
    confirmDeleteConversion: "Delete this conversion?",
  },
  reportsMain: {
    title: "Reports",
    subtitle: "Operational report summary",
    groupPos: "POS",
    groupInventory: "Inventory",
    tabDaily: "Daily",
    tabBranch: "Branch",
    tabCashier: "Cashier",
    tabTopProducts: "Top Products",
    tabStock: "Stock",
    tabStockLow: "Low Stock",
    tabMovements: "Movements",
    tabTransfers: "Transfers",
    tabReturns: "Returns",
    filterFrom: "From",
    filterTo: "To",
    filterCompany: "Company",
    filterBranch: "Branch",
    filterWarehouse: "Warehouse",
    filterCashier: "Cashier",
    filterProduct: "Product",
    filterThreshold: "Minimum Threshold",
    filterReset: "Reset Filters",
    export: "Export",
    loading: "Loading...",
    noData: "No data",
  },
  vendorStatus: {
    aktif: "Active",
    nonaktif: "Inactive",
    ditangguhkan: "Suspended",
    diarsipkan: "Archived",
    dipublikasikan: "Published",
    ditarikDariMarketplace: "Withdrawn from Marketplace",
    statusDiperbarui: "Vendor status updated",
    gagalUbahStatus: "Failed to change status",
    vendorTerverifikasi: "Vendor verified",
    gagalVerifikasi: "Failed to verify vendor",
    statusMarketplaceDiperbarui: "Marketplace status updated",
    dokumenTersimpan: "Document saved",
    jenisDokumenWajib: "Document type is required",
    gagalUploadDokumen: "Failed to upload document",
    dokumenDihapus: "Document deleted",
    gagalModerasiReview: "Failed to moderate review",
    memuatStatus: "Loading vendor status…",
    statusLegalitas: "Vendor Status & Legality",
    terverifikasi: "Verified",
    belumTerverifikasi: "Not Verified",
    marketplace: "Marketplace",
    vendorTidakBisaTransaksi: "Vendor cannot transact",
    ubahStatus: "Change Status",
    dokumen: "Documents",
    riwayat: "History",
    review: "Review",
    statusBaru: "New Status",
    pilihStatus: "Select status",
    statusMarketplace: "Marketplace Status",
    alasanOpsional: "Reason (optional, recorded in history)",
    terapkanStatus: "Apply Status",
    verifikasiVendor: "Verify Vendor",
    jenisDokumen: "Document Type",
    fileOpsional: "File (optional)",
    simpanDokumen: "Save Document",
    kadaluarsa: "expires",
    setujuiPublikasikan: "Approve & Publish",
    tolak: "Reject",
  },
  kasirUsers: {
    kembali: "Back",
    dashboard: "Dashboard",
    tenantProperty: "Tenant & Property",
    posTenant: "POS Tenant",
    kasirPengguna: "Cashier — Users",
    semuaCabang: "All branches",
    tambah: "Add",
    terakhirDiperbarui: "Last updated",
    username: "Username",
    namaLengkap: "Full Name",
    role: "Role",
    cabang: "Branch",
    kontak: "Contact",
    status: "Status",
    aktif: "Active",
    nonaktif: "Inactive",
    nonaktifkanUser: "Deactivate this user?",
    editPengguna: "Edit Cashier User",
    tambahPengguna: "Add Cashier User",
    pilihCabang: "Select branch",
    tidakAda: "— None —",
    email: "Email",
    telepon: "Phone / WA",
    batal: "Cancel",
    menyimpan: "Saving...",
    simpan: "Save",
    tersimpan: "Saved",
    dinonaktifkan: "Deactivated",
    errorMsg: "Error",
  },
};

const zhCN: DeepPartial<Translations> = {
  nav: {
    modules: "模块",
    dashboard: "仪表板",
    sales: "销售",
    salesDashboard: "仪表板",
    masterItem: "商品主数据",
    quotations: "报价单",
    salesOrders: "销售订单",
    aiDrafts: "AI草稿",
    customers: "客户",
    invoices: "发票",
    purchase: "采购",
    purchaseDashboard: "仪表板",
    rfq: "询价单",
    purchaseOrders: "采购订单",
    vendors: "供应商",
    vendorService: "服务供应商",
    bills: "账单",
    reports: "报表",
    salesReport: "销售",
    purchaseReport: "采购",
    arAging: "应收账款",
    apAging: "应付账款",
    accounting: "会计",
    chartOfAccounts: "科目表",
    journals: "日记账",
    journalEntry: "日记账分录",
    journalItems: "分录明细",
    payments: "付款",
    taxes: "税务",
    trialBalance: "试算平衡表",
    generalLedger: "总账",
    profitLoss: "损益表",
    balanceSheet: "资产负债表",
    reconciliation: "对账",
    accountingSettings: "设置",
    trading: "贸易",
    logistics: "物流",
    shipments: "货运",
    freightForwarding: "货运代理",
    portalOrders: "门户订单",
    pos: "收银台",
    expense: "运营费用",
    expenseList: "费用列表",
    expenseCategories: "费用类别",
    expenseReports: "费用报表",
    correspondences: "往来函件",
    emailInbox: "收件箱",
    users: "用户",
    aiChatbot: "AI聊天机器人",
    aiKnowledgeBase: "知识库",
    aiScanSettings: "扫描文档",
    uomSettings: "计量单位",
    settings: "设置",
    holding: "控股",
    holdingDashboard: "控股仪表板",
    holdingPLReport: "损益报告",
    holdingCompanies: "公司管理",
    holdingCoa: "科目表",
    holdingJournals: "日记账",
    portalProductOrders: "产品订单",
  },
  common: {
    save: "保存",
    saving: "保存中...",
    saved: "已保存！",
    cancel: "取消",
    delete: "删除",
    edit: "编辑",
    add: "添加",
    search: "搜索",
    filter: "筛选",
    loading: "加载中...",
    error: "错误",
    success: "成功",
    noData: "暂无数据",
    noResults: "无结果",
    confirm: "确认",
    close: "关闭",
    back: "返回",
    next: "下一步",
    submit: "提交",
    create: "创建",
    update: "更新",
    view: "查看",
    download: "下载",
    export: "导出",
    import: "导入",
    print: "打印",
    all: "全部",
    status: "状态",
    date: "日期",
    name: "名称",
    email: "邮箱",
    phone: "电话",
    address: "地址",
    description: "描述",
    amount: "金额",
    total: "总计",
    actions: "操作",
    type: "类型",
    category: "类别",
    logOut: "退出登录",
    noRole: "无角色",
    division: "部门",
    signOut: "退出",
    refresh: "刷新",
    off: "关",
    seconds: "秒",
    minute: "分钟",
    interval: "刷新间隔",
    accessDenied: "访问被拒绝",
    adminOnly: "只有管理员可以访问此页面。",
    optional: "可选",
    contactEmail: "联系邮箱",
    confirmDeleteTitle: "确认删除",
    confirmDeleteDesc: "此操作无法撤销。",
    viewAll: "查看全部",
    new: "新建",
    inProgress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
    noResults2: "没有匹配结果。",
    number: "编号",
  },
  welcome: {
    title: "欢迎使用 BizPortal",
    subtitle: "您的账户已注册。请联系管理员获取您的部门访问权限。",
    ecommerce: "电商",
    ecommerceDesc: "在线零售管理",
    ecommerceDetail: "管理您的网店商品，追踪客户订单，监控数字销售业绩。",
    trading: "贸易",
    tradingDesc: "B2B库存与供应商",
    tradingDetail: "追踪大宗库存，管理供应商关系，监控成本价格，处理国际贸易HS编码。",
    logistics: "物流",
    logisticsDesc: "车队与货运追踪",
    logisticsDetail: "实时监控货运，更新发货状态，确保货物准时到达目的地。",
    pos: "销售终端",
    posDesc: "门店交易",
    posDetail: "快速处理零售交易，支持多种支付方式，追踪门店日营业额。",
    signOut: "退出",
  },
  dashboard: { title: "仪表板", subtitle: "实时运营摘要和业务KPI", totalRevenue: "总收入", totalOrders: "总订单", activeCustomers: "活跃客户", pendingShipments: "待发货", recentOrders: "最近订单", salesOverview: "销售概览", quickActions: "快速操作", newQuotation: "新报价单", newOrder: "新订单", viewReports: "查看报表", activeFreight: "在途货运", awaitingQuote: "待报价", inTransit: "运输中", driverStatus: "司机状态", available: "可用", busy: "繁忙", portalOrdersTitle: "门户订单", systemHealth: "系统健康", refreshInterval: "刷新间隔", allOrders: "全部", createSalesOrder: "创建销售订单", statusUpdated: "状态已更新", updatedAt: "更新于", refreshIn: "刷新于", loadedIn: "加载于", allPortalOrders: "所有门户订单", noOrdersForStatus: "此状态没有订单", noActiveDrivers: "没有活跃司机" },
  settings: { title: "设置", profile: "个人资料", language: "语言", languageDesc: "选择显示语言", notifications: "通知", security: "安全", calculator: "费率计算器", calculatorDesc: "配置物流费用估算费率", cargoTypes: "货物类型", cargoTypesDesc: "计算器的货物类型列表", aiIntake: "AI订单录入", aiIntakeDesc: "AI处理传入电子邮件/WA设置", waNotif: "WhatsApp通知", waNotifDesc: "管理员WhatsApp号码" },
  pos: { title: "销售终端", subtitle: "管理实体店交易和日销售汇总", products: "商品", cart: "购物车", total: "总计", payment: "付款", cashier: "收银员", receipt: "收据", emptyCart: "购物车为空", checkout: "结账", searchProduct: "搜索商品...", cashierTab: "收银台", historyStats: "历史与统计", selectProduct: "选择商品", searchProductSku: "搜索商品/SKU...", noProducts: "暂无商品，请在电商页面添加。", paymentMethod: "支付方式", cash: "现金", qris: "QRIS", debit: "借记卡", credit: "信用卡", transfer: "银行转账", items: "件", todaySales: "今日销售额", txCount: "交易次数", avgOrder: "平均订单", historyTitle: "交易记录", time: "时间", product: "商品", price: "价格", document: "单据", noTransactions: "暂无交易记录", qty: "数量", monthSales: "本月销售额", monthTxCount: "本月交易次数", isProcessing: "处理中...", pay: "支付" },
  trading: { title: "贸易", subtitle: "管理批发库存、供应商及进口商品", inventory: "库存", stock: "库存量", sku: "SKU", costPrice: "成本价", salePrice: "销售价", hsCode: "HS编码", supplier: "供应商", stockInventory: "库存清单", addStock: "添加库存", addStockTitle: "添加库存", addStockDesc: "向仓库记录新的批发库存。", editStockTitle: "编辑库存", addSupplierTitle: "添加供应商", editSupplierTitle: "编辑供应商", productName: "商品名称", quantity: "数量", unit: "单位", noStock: "暂无库存。", noSuppliers: "暂无供应商。", supplierName: "供应商名称", country: "国家", addSupplier: "添加供应商" },
  logistics: { title: "物流", subtitle: "追踪货运并管理车队运营", trackingNumber: "追踪号", origin: "发货地", destination: "目的地", estimatedDelivery: "预计到达", deliveryStatus: "配送状态", driver: "司机", vehicle: "车辆", weight: "重量", dimensions: "尺寸", newShipment: "新货运", statusDraft: "草稿", statusRfqSent: "已发询价", statusConfirmed: "已确认", statusInTransit: "运输中", statusCompleted: "已完成", statusCancelled: "已取消", noShipments: "暂无货运。", allStatus: "所有状态", last7Days: "最近7天", last30Days: "最近30天", custom: "自定义", newest: "最新", oldest: "最旧", filters: "筛选", clearFilters: "清除筛选", viewAll: "查看全部", freightTitle: "国际货运代理", freightSubtitle: "活跃的国际货运。", shipmentsTitle: "本地货运", shipmentsSubtitle: "本地车队货运列表。", addShipment: "添加货运", carrier: "承运商", sortBy: "排序", dateRange: "日期范围" },
  sales: { title: "销售", subtitle: "销售摘要及最近单据", quotation: "报价单", order: "订单", invoice: "发票", customer: "客户", item: "商品", qty: "数量", unitPrice: "单价", subtotal: "小计", discount: "折扣", tax: "税", grandTotal: "合计", dueDate: "到期日", paymentTerms: "付款条件", notes: "备注", newQuotation: "新报价单", newOrder: "新订单", newInvoice: "新发票", toInvoice: "转为发票", revenue: "收入", recentDocuments: "最近单据", noDocuments: "暂无单据。", searchPlaceholder: "搜索单据...", docNumber: "单据编号", customerName: "客户名称" },
  purchase: { title: "采购", subtitle: "采购摘要及最近单据", rfq: "询价单", order: "采购订单", bill: "账单", vendor: "供应商", item: "商品", qty: "数量", unitPrice: "单价", subtotal: "小计", newRFQ: "新询价单", newOrder: "新采购单", newBill: "新账单", toReceive: "待收货", toBill: "待开票", totalSpend: "总支出", recentDocuments: "最近单据", noDocuments: "暂无单据。" },
  accounting: { title: "会计", account: "账户", debit: "借方", credit: "贷方", balance: "余额", journal: "日记账", entry: "分录", payment: "付款", tax: "税", period: "期间", openingBalance: "期初余额", closingBalance: "期末余额", netIncome: "净利润", totalAssets: "总资产", totalLiabilities: "总负债", equity: "权益" },
};

const zhTW: DeepPartial<Translations> = {
  nav: { modules: "模組", dashboard: "儀表板", sales: "銷售", salesDashboard: "儀表板", masterItem: "商品主資料", quotations: "報價單", salesOrders: "銷售訂單", aiDrafts: "AI草稿", customers: "客戶", invoices: "發票", purchase: "採購", purchaseDashboard: "儀表板", rfq: "詢價單", purchaseOrders: "採購訂單", vendors: "供應商", vendorService: "服務供應商", bills: "帳單", reports: "報表", salesReport: "銷售", purchaseReport: "採購", arAging: "應收帳款", apAging: "應付帳款", accounting: "會計", chartOfAccounts: "科目表", journals: "日記帳", journalEntry: "日記帳分錄", journalItems: "分錄明細", payments: "付款", taxes: "稅務", trialBalance: "試算平衡表", generalLedger: "總帳", profitLoss: "損益表", balanceSheet: "資產負債表", reconciliation: "對帳", accountingSettings: "設定", trading: "貿易", logistics: "物流", shipments: "貨運", freightForwarding: "貨運代理", portalOrders: "門戶訂單", pos: "收銀台", expense: "營運費用", expenseList: "費用列表", expenseCategories: "費用類別", expenseReports: "費用報表", correspondences: "往來函件", emailInbox: "收件匣", users: "使用者", aiChatbot: "AI聊天機器人", aiScanSettings: "掃描文件", uomSettings: "計量單位", settings: "設定" },
  common: { save: "儲存", saving: "儲存中...", saved: "已儲存！", cancel: "取消", delete: "刪除", edit: "編輯", add: "新增", search: "搜尋", filter: "篩選", loading: "載入中...", error: "錯誤", success: "成功", noData: "暫無資料", noResults: "無結果", confirm: "確認", close: "關閉", back: "返回", next: "下一步", submit: "送出", create: "建立", update: "更新", view: "檢視", download: "下載", export: "匯出", import: "匯入", print: "列印", all: "全部", status: "狀態", date: "日期", name: "名稱", email: "電子郵件", phone: "電話", address: "地址", description: "描述", amount: "金額", total: "總計", actions: "操作", type: "類型", category: "類別", logOut: "登出", noRole: "無角色", division: "部門", signOut: "登出" },
  welcome: { title: "歡迎使用 BizPortal", subtitle: "您的帳戶已註冊。請聯絡管理員取得您的部門存取權限。", ecommerce: "電商", ecommerceDesc: "線上零售管理", ecommerceDetail: "管理您的網店商品，追蹤客戶訂單，監控數位銷售業績。", trading: "貿易", tradingDesc: "B2B庫存與供應商", tradingDetail: "追蹤大宗庫存，管理供應商關係，監控成本價格，處理國際貿易HS編碼。", logistics: "物流", logisticsDesc: "車隊與貨運追蹤", logisticsDetail: "即時監控貨運，更新發貨狀態，確保貨物準時到達目的地。", pos: "銷售終端", posDesc: "門市交易", posDetail: "快速處理零售交易，支援多種支付方式，追蹤門市日營業額。", signOut: "登出" },
  dashboard: { title: "儀表板", totalRevenue: "總收入", totalOrders: "總訂單", activeCustomers: "活躍客戶", pendingShipments: "待出貨", recentOrders: "最近訂單", salesOverview: "銷售概覽", quickActions: "快速操作", newQuotation: "新報價單", newOrder: "新訂單", viewReports: "查看報表" },
  settings: { title: "設定", profile: "個人資料", language: "語言", languageDesc: "選擇顯示語言", notifications: "通知", security: "安全", calculator: "費率計算器", calculatorDesc: "設定物流費用估算費率", cargoTypes: "貨物類型", cargoTypesDesc: "計算器的貨物類型列表", aiIntake: "AI訂單錄入", aiIntakeDesc: "AI處理傳入電子郵件/WA設定", waNotif: "WhatsApp通知", waNotifDesc: "管理員WhatsApp號碼" },
  pos: { title: "銷售終端", products: "商品", cart: "購物車", total: "總計", payment: "付款", cashier: "收銀員", receipt: "收據", emptyCart: "購物車為空", checkout: "結帳", searchProduct: "搜尋商品..." },
  trading: { title: "貿易", inventory: "庫存", stock: "庫存量", sku: "SKU", costPrice: "成本價", salePrice: "銷售價", hsCode: "HS編碼", supplier: "供應商" },
  logistics: { title: "物流", trackingNumber: "追蹤號", origin: "發貨地", destination: "目的地", estimatedDelivery: "預計到達", deliveryStatus: "配送狀態", driver: "司機", vehicle: "車輛", weight: "重量", dimensions: "尺寸" },
  sales: { title: "銷售", quotation: "報價單", order: "訂單", invoice: "發票", customer: "客戶", item: "商品", qty: "數量", unitPrice: "單價", subtotal: "小計", discount: "折扣", tax: "稅", grandTotal: "合計", dueDate: "到期日", paymentTerms: "付款條件", notes: "備註", newQuotation: "新報價單", newOrder: "新訂單", newInvoice: "新發票" },
  purchase: { title: "採購", rfq: "詢價單", order: "採購訂單", bill: "帳單", vendor: "供應商", item: "商品", qty: "數量", unitPrice: "單價", subtotal: "小計", newRFQ: "新詢價單", newOrder: "新採購單", newBill: "新帳單" },
  accounting: { title: "會計", account: "帳戶", debit: "借方", credit: "貸方", balance: "餘額", journal: "日記帳", entry: "分錄", payment: "付款", tax: "稅", period: "期間", openingBalance: "期初餘額", closingBalance: "期末餘額", netIncome: "淨利潤", totalAssets: "總資產", totalLiabilities: "總負債", equity: "權益" },
};

const ja: DeepPartial<Translations> = {
  nav: { modules: "モジュール", dashboard: "ダッシュボード", sales: "営業", salesDashboard: "ダッシュボード", masterItem: "商品マスタ", quotations: "見積書", salesOrders: "受注", aiDrafts: "AIドラフト", customers: "顧客", invoices: "請求書", purchase: "仕入", purchaseDashboard: "ダッシュボード", rfq: "見積依頼", purchaseOrders: "発注書", vendors: "仕入先", vendorService: "サービス業者", bills: "請求", reports: "レポート", salesReport: "営業", purchaseReport: "仕入", arAging: "売掛金", apAging: "買掛金", accounting: "会計", chartOfAccounts: "勘定科目表", journals: "仕訳帳", journalEntry: "仕訳入力", journalItems: "仕訳明細", payments: "支払", taxes: "税金", trialBalance: "試算表", generalLedger: "総勘定元帳", profitLoss: "損益計算書", balanceSheet: "貸借対照表", reconciliation: "照合", accountingSettings: "設定", trading: "貿易", logistics: "物流", shipments: "配送", freightForwarding: "貨物輸送", portalOrders: "ポータル注文", pos: "POS", expense: "経費", expenseList: "経費一覧", expenseCategories: "経費カテゴリ", expenseReports: "経費レポート", correspondences: "往来文書", emailInbox: "受信トレイ", users: "ユーザー", aiChatbot: "AIチャットボット", uomSettings: "計量単位", settings: "設定" },
  common: { save: "保存", saving: "保存中...", saved: "保存済！", cancel: "キャンセル", delete: "削除", edit: "編集", add: "追加", search: "検索", filter: "絞込", loading: "読込中...", error: "エラー", success: "成功", noData: "データなし", noResults: "結果なし", confirm: "確認", close: "閉じる", back: "戻る", next: "次へ", submit: "送信", create: "作成", update: "更新", view: "表示", download: "ダウンロード", export: "エクスポート", import: "インポート", print: "印刷", all: "すべて", status: "ステータス", date: "日付", name: "名前", email: "メール", phone: "電話", address: "住所", description: "説明", amount: "金額", total: "合計", actions: "操作", type: "種類", category: "カテゴリ", logOut: "ログアウト", noRole: "役割なし", division: "部門", signOut: "サインアウト" },
  welcome: { title: "BizPortalへようこそ", subtitle: "アカウントが登録されました。管理者に連絡して部門へのアクセスを取得してください。", ecommerce: "EC（電子商取引）", ecommerceDesc: "オンライン小売管理", ecommerceDetail: "オンラインストアの商品を管理し、顧客注文を追跡し、デジタル販売実績を監視します。", trading: "貿易", tradingDesc: "B2B在庫・仕入先", tradingDetail: "大量在庫の追跡、仕入先管理、原価監視、国際貿易のHSコード処理。", logistics: "物流", logisticsDesc: "車両・配送追跡", logisticsDetail: "リアルタイムで配送を監視し、出荷ステータスを更新し、荷物が時間通りに届くようにします。", pos: "POS（販売時点情報管理）", posDesc: "店頭取引", posDetail: "小売取引を素早く処理し、複数の支払方法に対応し、日次実店舗売上を追跡します。", signOut: "サインアウト" },
  dashboard: { title: "ダッシュボード", totalRevenue: "総収益", totalOrders: "総注文数", activeCustomers: "アクティブ顧客", pendingShipments: "保留中の出荷", recentOrders: "最近の注文", salesOverview: "営業概要", quickActions: "クイックアクション", newQuotation: "新規見積", newOrder: "新規注文", viewReports: "レポート表示" },
  settings: { title: "設定", profile: "プロフィール", language: "言語", languageDesc: "表示言語を選択", notifications: "通知", security: "セキュリティ", calculator: "料率計算機", calculatorDesc: "物流費用見積料率設定", cargoTypes: "貨物種別", cargoTypesDesc: "計算機用貨物種別リスト", aiIntake: "AI受注取込", aiIntakeDesc: "受信メール/WA処理AI設定", waNotif: "WhatsApp通知", waNotifDesc: "管理者WhatsApp番号" },
  pos: { title: "POS", products: "商品", cart: "カート", total: "合計", payment: "支払", cashier: "レジ係", receipt: "領収書", emptyCart: "カートが空です", checkout: "会計", searchProduct: "商品を検索..." },
  trading: { title: "貿易", inventory: "在庫", stock: "在庫数", sku: "SKU", costPrice: "原価", salePrice: "販売価格", hsCode: "HSコード", supplier: "仕入先" },
  logistics: { title: "物流", trackingNumber: "追跡番号", origin: "発送元", destination: "目的地", estimatedDelivery: "配達予定日", deliveryStatus: "配送状況", driver: "ドライバー", vehicle: "車両", weight: "重量", dimensions: "寸法" },
  sales: { title: "営業", quotation: "見積書", order: "受注", invoice: "請求書", customer: "顧客", item: "商品", qty: "数量", unitPrice: "単価", subtotal: "小計", discount: "割引", tax: "税", grandTotal: "合計", dueDate: "支払期限", paymentTerms: "支払条件", notes: "備考", newQuotation: "新規見積", newOrder: "新規注文", newInvoice: "新規請求書" },
  purchase: { title: "仕入", rfq: "見積依頼", order: "発注書", bill: "請求", vendor: "仕入先", item: "商品", qty: "数量", unitPrice: "単価", subtotal: "小計", newRFQ: "新規見積依頼", newOrder: "新規発注", newBill: "新規請求" },
  accounting: { title: "会計", account: "勘定", debit: "借方", credit: "貸方", balance: "残高", journal: "仕訳帳", entry: "仕訳", payment: "支払", tax: "税", period: "期間", openingBalance: "期首残高", closingBalance: "期末残高", netIncome: "純利益", totalAssets: "総資産", totalLiabilities: "総負債", equity: "純資産" },
};

const ko: DeepPartial<Translations> = {
  nav: { modules: "모듈", dashboard: "대시보드", sales: "영업", salesDashboard: "대시보드", masterItem: "상품 마스터", quotations: "견적서", salesOrders: "판매 주문", aiDrafts: "AI 초안", customers: "고객", invoices: "청구서", purchase: "구매", purchaseDashboard: "대시보드", rfq: "견적 요청", purchaseOrders: "구매 주문", vendors: "공급업체", vendorService: "서비스 업체", bills: "청구", reports: "보고서", salesReport: "영업", purchaseReport: "구매", arAging: "매출채권", apAging: "매입채무", accounting: "회계", chartOfAccounts: "계정과목표", journals: "분개장", journalEntry: "분개 입력", journalItems: "분개 내역", payments: "지급", taxes: "세금", trialBalance: "시산표", generalLedger: "총계정원장", profitLoss: "손익계산서", balanceSheet: "대차대조표", reconciliation: "조정", accountingSettings: "설정", trading: "무역", logistics: "물류", shipments: "배송", freightForwarding: "화물 운송", portalOrders: "포털 주문", pos: "POS", expense: "운영비용", expenseList: "비용 목록", expenseCategories: "비용 카테고리", expenseReports: "비용 보고서", correspondences: "서신", emailInbox: "받은 편지함", users: "사용자", aiChatbot: "AI 챗봇", uomSettings: "측정 단위", settings: "설정" },
  common: { save: "저장", saving: "저장 중...", saved: "저장됨!", cancel: "취소", delete: "삭제", edit: "편집", add: "추가", search: "검색", filter: "필터", loading: "로딩 중...", error: "오류", success: "성공", noData: "데이터 없음", noResults: "결과 없음", confirm: "확인", close: "닫기", back: "뒤로", next: "다음", submit: "제출", create: "생성", update: "업데이트", view: "보기", download: "다운로드", export: "내보내기", import: "가져오기", print: "인쇄", all: "전체", status: "상태", date: "날짜", name: "이름", email: "이메일", phone: "전화", address: "주소", description: "설명", amount: "금액", total: "합계", actions: "작업", type: "유형", category: "카테고리", logOut: "로그아웃", noRole: "역할 없음", division: "부서", signOut: "로그아웃" },
  welcome: { title: "BizPortal에 오신 것을 환영합니다", subtitle: "계정이 등록되었습니다. 관리자에게 연락하여 부서 접근 권한을 받으세요.", ecommerce: "전자상거래", ecommerceDesc: "온라인 소매 관리", ecommerceDetail: "온라인 스토어 상품 관리, 고객 주문 추적, 디지털 판매 성과 모니터링.", trading: "무역", tradingDesc: "B2B 재고 및 공급업체", tradingDetail: "대량 재고 추적, 공급업체 관계 관리, 원가 모니터링, 국제 무역 HS 코드 처리.", logistics: "물류", logisticsDesc: "차량 및 배송 추적", logisticsDetail: "실시간 배송 모니터링, 발송 상태 업데이트, 제 시간에 목적지 도착 보장.", pos: "판매 시점 단말기", posDesc: "매장 거래", posDetail: "소매 거래 신속 처리, 다양한 결제 수단 지원, 일일 매장 매출 추적.", signOut: "로그아웃" },
  dashboard: { title: "대시보드", totalRevenue: "총 수익", totalOrders: "총 주문", activeCustomers: "활성 고객", pendingShipments: "대기 중인 배송", recentOrders: "최근 주문", salesOverview: "영업 개요", quickActions: "빠른 작업", newQuotation: "새 견적", newOrder: "새 주문", viewReports: "보고서 보기" },
  settings: { title: "설정", profile: "프로필", language: "언어", languageDesc: "표시 언어 선택", notifications: "알림", security: "보안", calculator: "요율 계산기", calculatorDesc: "물류 비용 견적 요율 설정", cargoTypes: "화물 유형", cargoTypesDesc: "계산기용 화물 유형 목록", aiIntake: "AI 주문 접수", aiIntakeDesc: "수신 이메일/WA 처리 AI 설정", waNotif: "WhatsApp 알림", waNotifDesc: "관리자 WhatsApp 번호" },
  pos: { title: "POS", products: "상품", cart: "장바구니", total: "합계", payment: "결제", cashier: "계산원", receipt: "영수증", emptyCart: "장바구니가 비어있습니다", checkout: "결제하기", searchProduct: "상품 검색..." },
  trading: { title: "무역", inventory: "재고", stock: "재고량", sku: "SKU", costPrice: "원가", salePrice: "판매가", hsCode: "HS 코드", supplier: "공급업체" },
  logistics: { title: "물류", trackingNumber: "추적 번호", origin: "출발지", destination: "목적지", estimatedDelivery: "예상 배송일", deliveryStatus: "배송 상태", driver: "기사", vehicle: "차량", weight: "무게", dimensions: "규격" },
  sales: { title: "영업", quotation: "견적서", order: "주문", invoice: "청구서", customer: "고객", item: "상품", qty: "수량", unitPrice: "단가", subtotal: "소계", discount: "할인", tax: "세금", grandTotal: "합계", dueDate: "만기일", paymentTerms: "결제 조건", notes: "메모", newQuotation: "새 견적서", newOrder: "새 주문", newInvoice: "새 청구서" },
  purchase: { title: "구매", rfq: "견적 요청", order: "구매 주문", bill: "청구", vendor: "공급업체", item: "상품", qty: "수량", unitPrice: "단가", subtotal: "소계", newRFQ: "새 견적 요청", newOrder: "새 구매 주문", newBill: "새 청구서" },
  accounting: { title: "회계", account: "계정", debit: "차변", credit: "대변", balance: "잔액", journal: "분개장", entry: "분개", payment: "지급", tax: "세금", period: "기간", openingBalance: "기초 잔액", closingBalance: "기말 잔액", netIncome: "순이익", totalAssets: "총자산", totalLiabilities: "총부채", equity: "자본" },
};

const ar: DeepPartial<Translations> = {
  nav: { modules: "الوحدات", dashboard: "لوحة التحكم", sales: "المبيعات", salesDashboard: "لوحة التحكم", masterItem: "الأصناف الرئيسية", quotations: "عروض الأسعار", salesOrders: "أوامر البيع", aiDrafts: "مسودات AI", customers: "العملاء", invoices: "الفواتير", purchase: "المشتريات", purchaseDashboard: "لوحة التحكم", rfq: "طلب عروض أسعار", purchaseOrders: "أوامر الشراء", vendors: "الموردون", vendorService: "موردو الخدمات", bills: "الفواتير", reports: "التقارير", salesReport: "المبيعات", purchaseReport: "المشتريات", arAging: "الذمم المدينة", apAging: "الذمم الدائنة", accounting: "المحاسبة", chartOfAccounts: "دليل الحسابات", journals: "دفاتر اليومية", journalEntry: "قيد اليومية", journalItems: "بنود اليومية", payments: "المدفوعات", taxes: "الضرائب", trialBalance: "ميزان المراجعة", generalLedger: "الأستاذ العام", profitLoss: "الأرباح والخسائر", balanceSheet: "الميزانية العمومية", reconciliation: "التسوية", accountingSettings: "الإعدادات", trading: "التجارة", logistics: "اللوجستيات", shipments: "الشحنات", freightForwarding: "الشحن الدولي", portalOrders: "طلبات البوابة", pos: "نقطة البيع", expense: "المصروفات التشغيلية", expenseList: "قائمة المصروفات", expenseCategories: "فئات المصروفات", expenseReports: "تقارير المصروفات", correspondences: "المراسلات", emailInbox: "صندوق الوارد", users: "المستخدمون", aiChatbot: "روبوت المحادثة AI", uomSettings: "وحدة القياس", settings: "الإعدادات" },
  common: { save: "حفظ", saving: "جاري الحفظ...", saved: "تم الحفظ!", cancel: "إلغاء", delete: "حذف", edit: "تعديل", add: "إضافة", search: "بحث", filter: "تصفية", loading: "جاري التحميل...", error: "خطأ", success: "نجاح", noData: "لا توجد بيانات", noResults: "لا توجد نتائج", confirm: "تأكيد", close: "إغلاق", back: "رجوع", next: "التالي", submit: "إرسال", create: "إنشاء", update: "تحديث", view: "عرض", download: "تنزيل", export: "تصدير", import: "استيراد", print: "طباعة", all: "الكل", status: "الحالة", date: "التاريخ", name: "الاسم", email: "البريد الإلكتروني", phone: "الهاتف", address: "العنوان", description: "الوصف", amount: "المبلغ", total: "الإجمالي", actions: "الإجراءات", type: "النوع", category: "الفئة", logOut: "تسجيل الخروج", noRole: "بدون دور", division: "القسم", signOut: "خروج" },
  welcome: { title: "مرحباً بك في BizPortal", subtitle: "تم تسجيل حسابك. تواصل مع المسؤول للحصول على صلاحية الوصول إلى قسمك.", ecommerce: "التجارة الإلكترونية", ecommerceDesc: "إدارة البيع بالتجزئة عبر الإنترنت", ecommerceDetail: "إدارة منتجات متجرك الإلكتروني وتتبع طلبات العملاء ومراقبة أداء المبيعات الرقمية.", trading: "التجارة", tradingDesc: "المخزون والموردون B2B", tradingDetail: "تتبع المخزون الضخم وإدارة علاقات الموردين ومراقبة التكاليف والتعامل مع رموز HS للتجارة الدولية.", logistics: "اللوجستيات", logisticsDesc: "تتبع الأسطول والشحنات", logisticsDetail: "مراقبة التسليم في الوقت الفعلي وتحديث حالات الشحن وضمان وصول الطرود في الوقت المحدد.", pos: "نقطة البيع", posDesc: "معاملات المتجر", posDetail: "معالجة معاملات البيع بالتجزئة بسرعة ودعم طرق دفع متعددة وتتبع إيرادات المتجر اليومية.", signOut: "خروج" },
  dashboard: { title: "لوحة التحكم", totalRevenue: "إجمالي الإيرادات", totalOrders: "إجمالي الطلبات", activeCustomers: "العملاء النشطون", pendingShipments: "الشحنات المعلقة", recentOrders: "الطلبات الأخيرة", salesOverview: "نظرة عامة على المبيعات", quickActions: "إجراءات سريعة", newQuotation: "عرض سعر جديد", newOrder: "طلب جديد", viewReports: "عرض التقارير" },
  settings: { title: "الإعدادات", profile: "الملف الشخصي", language: "اللغة", languageDesc: "اختر لغة العرض", notifications: "الإشعارات", security: "الأمان", calculator: "حاسبة الأسعار", calculatorDesc: "تكوين أسعار تقدير تكاليف اللوجستيات", cargoTypes: "أنواع البضائع", cargoTypesDesc: "قائمة أنواع البضائع للحاسبة", aiIntake: "استلام طلبات AI", aiIntakeDesc: "إعدادات AI لمعالجة البريد الوارد/WA", waNotif: "إشعارات WhatsApp", waNotifDesc: "رقم WhatsApp المسؤول" },
  pos: { title: "نقطة البيع", products: "المنتجات", cart: "السلة", total: "الإجمالي", payment: "الدفع", cashier: "أمين الصندوق", receipt: "الإيصال", emptyCart: "السلة فارغة", checkout: "الدفع", searchProduct: "البحث عن منتج..." },
  trading: { title: "التجارة", inventory: "المخزون", stock: "الكميات", sku: "SKU", costPrice: "سعر التكلفة", salePrice: "سعر البيع", hsCode: "رمز HS", supplier: "المورد" },
  logistics: { title: "اللوجستيات", trackingNumber: "رقم التتبع", origin: "الأصل", destination: "الوجهة", estimatedDelivery: "التسليم المتوقع", deliveryStatus: "حالة التسليم", driver: "السائق", vehicle: "المركبة", weight: "الوزن", dimensions: "الأبعاد" },
  sales: { title: "المبيعات", quotation: "عرض السعر", order: "الطلب", invoice: "الفاتورة", customer: "العميل", item: "الصنف", qty: "الكمية", unitPrice: "سعر الوحدة", subtotal: "المجموع الفرعي", discount: "الخصم", tax: "الضريبة", grandTotal: "الإجمالي", dueDate: "تاريخ الاستحقاق", paymentTerms: "شروط الدفع", notes: "ملاحظات", newQuotation: "عرض سعر جديد", newOrder: "طلب جديد", newInvoice: "فاتورة جديدة" },
  purchase: { title: "المشتريات", rfq: "طلب عرض السعر", order: "أمر الشراء", bill: "الفاتورة", vendor: "المورد", item: "الصنف", qty: "الكمية", unitPrice: "سعر الوحدة", subtotal: "المجموع الفرعي", newRFQ: "طلب عرض سعر جديد", newOrder: "أمر شراء جديد", newBill: "فاتورة جديدة" },
  accounting: { title: "المحاسبة", account: "الحساب", debit: "مدين", credit: "دائن", balance: "الرصيد", journal: "اليومية", entry: "القيد", payment: "الدفع", tax: "الضريبة", period: "الفترة", openingBalance: "الرصيد الافتتاحي", closingBalance: "الرصيد الختامي", netIncome: "صافي الدخل", totalAssets: "إجمالي الأصول", totalLiabilities: "إجمالي الخصوم", equity: "حقوق الملكية" },
};

const fr: DeepPartial<Translations> = {
  nav: { modules: "Modules", dashboard: "Tableau de bord", sales: "Ventes", salesDashboard: "Tableau de bord", masterItem: "Articles", quotations: "Devis", salesOrders: "Commandes", aiDrafts: "Brouillons IA", customers: "Clients", invoices: "Factures", purchase: "Achats", purchaseDashboard: "Tableau de bord", rfq: "Appel d'offres", purchaseOrders: "Bons de commande", vendors: "Fournisseurs", vendorService: "Prestataires", bills: "Factures fournisseurs", reports: "Rapports", salesReport: "Ventes", purchaseReport: "Achats", arAging: "Créances clients", apAging: "Dettes fournisseurs", accounting: "Comptabilité", chartOfAccounts: "Plan comptable", journals: "Journaux", journalEntry: "Écriture", journalItems: "Lignes de journal", payments: "Paiements", taxes: "Taxes", trialBalance: "Balance de vérification", generalLedger: "Grand livre", profitLoss: "Résultat net", balanceSheet: "Bilan", reconciliation: "Rapprochement", accountingSettings: "Paramètres", trading: "Commerce", logistics: "Logistique", shipments: "Expéditions", freightForwarding: "Transport de fret", portalOrders: "Commandes portail", pos: "Point de vente", expense: "Charges opérationnelles", expenseList: "Liste des dépenses", expenseCategories: "Catégories", expenseReports: "Rapports de dépenses", correspondences: "Correspondances", emailInbox: "Boîte mail", users: "Utilisateurs", aiChatbot: "Chatbot IA", uomSettings: "Unité de mesure", settings: "Paramètres" },
  common: { save: "Enregistrer", saving: "Enregistrement...", saved: "Enregistré!", cancel: "Annuler", delete: "Supprimer", edit: "Modifier", add: "Ajouter", search: "Rechercher", filter: "Filtrer", loading: "Chargement...", error: "Erreur", success: "Succès", noData: "Aucune donnée", noResults: "Aucun résultat", confirm: "Confirmer", close: "Fermer", back: "Retour", next: "Suivant", submit: "Soumettre", create: "Créer", update: "Mettre à jour", view: "Voir", download: "Télécharger", export: "Exporter", import: "Importer", print: "Imprimer", all: "Tout", status: "Statut", date: "Date", name: "Nom", email: "Email", phone: "Téléphone", address: "Adresse", description: "Description", amount: "Montant", total: "Total", actions: "Actions", type: "Type", category: "Catégorie", logOut: "Déconnexion", noRole: "Aucun rôle", division: "Division", signOut: "Déconnexion" },
  welcome: { title: "Bienvenue sur BizPortal", subtitle: "Votre compte est enregistré. Contactez l'administrateur pour accéder à votre division.", ecommerce: "E-Commerce", ecommerceDesc: "Gestion du commerce en ligne", ecommerceDetail: "Gérez les produits de votre boutique en ligne, suivez les commandes clients et surveillez les performances de vente numériques.", trading: "Commerce", tradingDesc: "Stock B2B & Fournisseurs", tradingDetail: "Suivez les stocks en vrac, gérez les fournisseurs, surveillez les prix de revient et gérez les codes HS pour le commerce international.", logistics: "Logistique", logisticsDesc: "Suivi des véhicules et expéditions", logisticsDetail: "Surveillez les livraisons en temps réel, mettez à jour les statuts d'expédition et assurez la livraison dans les délais.", pos: "Point de vente", posDesc: "Transactions en magasin", posDetail: "Traitez rapidement les transactions de détail, acceptez plusieurs modes de paiement et suivez le chiffre d'affaires quotidien.", signOut: "Déconnexion" },
  dashboard: { title: "Tableau de bord", totalRevenue: "Chiffre d'affaires total", totalOrders: "Commandes totales", activeCustomers: "Clients actifs", pendingShipments: "Expéditions en attente", recentOrders: "Commandes récentes", salesOverview: "Vue d'ensemble des ventes", quickActions: "Actions rapides", newQuotation: "Nouveau devis", newOrder: "Nouvelle commande", viewReports: "Voir les rapports" },
  settings: { title: "Paramètres", profile: "Profil", language: "Langue", languageDesc: "Sélectionner la langue d'affichage", notifications: "Notifications", security: "Sécurité", calculator: "Calculateur de tarifs", calculatorDesc: "Configurer les tarifs d'estimation des coûts logistiques", cargoTypes: "Types de fret", cargoTypesDesc: "Liste des types de fret pour le calculateur", aiIntake: "Saisie des commandes IA", aiIntakeDesc: "Paramètres IA pour le traitement des emails/WA entrants", waNotif: "Notifications WhatsApp", waNotifDesc: "Numéro WhatsApp administrateur" },
  pos: { title: "Point de vente", products: "Produits", cart: "Panier", total: "Total", payment: "Paiement", cashier: "Caissier", receipt: "Reçu", emptyCart: "Le panier est vide", checkout: "Régler", searchProduct: "Rechercher un produit..." },
  trading: { title: "Commerce", inventory: "Inventaire", stock: "Stock", sku: "SKU", costPrice: "Prix de revient", salePrice: "Prix de vente", hsCode: "Code HS", supplier: "Fournisseur" },
  logistics: { title: "Logistique", trackingNumber: "Numéro de suivi", origin: "Origine", destination: "Destination", estimatedDelivery: "Livraison estimée", deliveryStatus: "Statut de livraison", driver: "Chauffeur", vehicle: "Véhicule", weight: "Poids", dimensions: "Dimensions" },
  sales: { title: "Ventes", quotation: "Devis", order: "Commande", invoice: "Facture", customer: "Client", item: "Article", qty: "Qté", unitPrice: "Prix unitaire", subtotal: "Sous-total", discount: "Remise", tax: "Taxe", grandTotal: "Total", dueDate: "Échéance", paymentTerms: "Conditions de paiement", notes: "Notes", newQuotation: "Nouveau devis", newOrder: "Nouvelle commande", newInvoice: "Nouvelle facture" },
  purchase: { title: "Achats", rfq: "Appel d'offres", order: "Bon de commande", bill: "Facture fournisseur", vendor: "Fournisseur", item: "Article", qty: "Qté", unitPrice: "Prix unitaire", subtotal: "Sous-total", newRFQ: "Nouvel appel d'offres", newOrder: "Nouveau bon de commande", newBill: "Nouvelle facture" },
  accounting: { title: "Comptabilité", account: "Compte", debit: "Débit", credit: "Crédit", balance: "Solde", journal: "Journal", entry: "Écriture", payment: "Paiement", tax: "Taxe", period: "Période", openingBalance: "Solde d'ouverture", closingBalance: "Solde de clôture", netIncome: "Résultat net", totalAssets: "Total des actifs", totalLiabilities: "Total des passifs", equity: "Capitaux propres" },
};

const de: DeepPartial<Translations> = {
  nav: { modules: "Module", dashboard: "Dashboard", sales: "Vertrieb", salesDashboard: "Dashboard", masterItem: "Artikelstamm", quotations: "Angebote", salesOrders: "Verkaufsaufträge", aiDrafts: "KI-Entwürfe", customers: "Kunden", invoices: "Rechnungen", purchase: "Einkauf", purchaseDashboard: "Dashboard", rfq: "Anfrage", purchaseOrders: "Bestellungen", vendors: "Lieferanten", vendorService: "Dienstleister", bills: "Eingangsrechnungen", reports: "Berichte", salesReport: "Vertrieb", purchaseReport: "Einkauf", arAging: "Forderungen", apAging: "Verbindlichkeiten", accounting: "Buchhaltung", chartOfAccounts: "Kontenplan", journals: "Journale", journalEntry: "Buchungssatz", journalItems: "Buchungszeilen", payments: "Zahlungen", taxes: "Steuern", trialBalance: "Probesaldo", generalLedger: "Hauptbuch", profitLoss: "Gewinn & Verlust", balanceSheet: "Bilanz", reconciliation: "Abstimmung", accountingSettings: "Einstellungen", trading: "Handel", logistics: "Logistik", shipments: "Sendungen", freightForwarding: "Frachtspedition", portalOrders: "Portalaufträge", pos: "Kasse", expense: "Betriebskosten", expenseList: "Ausgabenliste", expenseCategories: "Kategorien", expenseReports: "Ausgabenberichte", correspondences: "Korrespondenz", emailInbox: "Posteingang", users: "Benutzer", aiChatbot: "KI-Chatbot", uomSettings: "Maßeinheit", settings: "Einstellungen" },
  common: { save: "Speichern", saving: "Wird gespeichert...", saved: "Gespeichert!", cancel: "Abbrechen", delete: "Löschen", edit: "Bearbeiten", add: "Hinzufügen", search: "Suchen", filter: "Filtern", loading: "Wird geladen...", error: "Fehler", success: "Erfolg", noData: "Keine Daten", noResults: "Keine Ergebnisse", confirm: "Bestätigen", close: "Schließen", back: "Zurück", next: "Weiter", submit: "Senden", create: "Erstellen", update: "Aktualisieren", view: "Anzeigen", download: "Herunterladen", export: "Exportieren", import: "Importieren", print: "Drucken", all: "Alle", status: "Status", date: "Datum", name: "Name", email: "E-Mail", phone: "Telefon", address: "Adresse", description: "Beschreibung", amount: "Betrag", total: "Gesamt", actions: "Aktionen", type: "Typ", category: "Kategorie", logOut: "Abmelden", noRole: "Keine Rolle", division: "Abteilung", signOut: "Abmelden" },
  welcome: { title: "Willkommen bei BizPortal", subtitle: "Ihr Konto ist registriert. Kontaktieren Sie den Administrator für Zugang zu Ihrer Abteilung.", ecommerce: "E-Commerce", ecommerceDesc: "Online-Einzelhandelsverwaltung", ecommerceDetail: "Verwalten Sie Ihre Online-Shop-Produkte, verfolgen Sie Kundenbestellungen und überwachen Sie digitale Verkaufsleistungen.", trading: "Handel", tradingDesc: "B2B-Bestand & Lieferanten", tradingDetail: "Großlagerbestände verfolgen, Lieferantenbeziehungen verwalten, Einstandspreise überwachen und HS-Codes für internationalen Handel verwalten.", logistics: "Logistik", logisticsDesc: "Fahrzeug- & Sendungsverfolgung", logisticsDetail: "Lieferungen in Echtzeit überwachen, Sendungsstatus aktualisieren und pünktliche Paketzustellung sicherstellen.", pos: "Kassensystem", posDesc: "Ladentransaktionen", posDetail: "Einzelhandelstransaktionen schnell abwickeln, mehrere Zahlungsmethoden unterstützen und tägliche Ladeneinnahmen verfolgen.", signOut: "Abmelden" },
  dashboard: { title: "Dashboard", totalRevenue: "Gesamtumsatz", totalOrders: "Gesamtbestellungen", activeCustomers: "Aktive Kunden", pendingShipments: "Ausstehende Sendungen", recentOrders: "Aktuelle Bestellungen", salesOverview: "Verkaufsübersicht", quickActions: "Schnellaktionen", newQuotation: "Neues Angebot", newOrder: "Neue Bestellung", viewReports: "Berichte anzeigen" },
  settings: { title: "Einstellungen", profile: "Profil", language: "Sprache", languageDesc: "Anzeigesprache auswählen", notifications: "Benachrichtigungen", security: "Sicherheit", calculator: "Tarifrechner", calculatorDesc: "Logistik-Kostenschätzungstarife konfigurieren", cargoTypes: "Frachttypen", cargoTypesDesc: "Frachttypliste für Rechner", aiIntake: "KI-Auftragsannahme", aiIntakeDesc: "KI-Einstellungen für eingehende E-Mail/WA-Verarbeitung", waNotif: "WhatsApp-Benachrichtigungen", waNotifDesc: "Admin-WhatsApp-Nummer" },
  pos: { title: "Kassensystem", products: "Produkte", cart: "Warenkorb", total: "Gesamt", payment: "Zahlung", cashier: "Kassierer", receipt: "Quittung", emptyCart: "Warenkorb ist leer", checkout: "Bezahlen", searchProduct: "Produkt suchen..." },
  trading: { title: "Handel", inventory: "Inventar", stock: "Bestand", sku: "SKU", costPrice: "Einstandspreis", salePrice: "Verkaufspreis", hsCode: "HS-Code", supplier: "Lieferant" },
  logistics: { title: "Logistik", trackingNumber: "Sendungsnummer", origin: "Herkunft", destination: "Ziel", estimatedDelivery: "Voraussichtliche Lieferung", deliveryStatus: "Lieferstatus", driver: "Fahrer", vehicle: "Fahrzeug", weight: "Gewicht", dimensions: "Abmessungen" },
  sales: { title: "Vertrieb", quotation: "Angebot", order: "Auftrag", invoice: "Rechnung", customer: "Kunde", item: "Artikel", qty: "Menge", unitPrice: "Stückpreis", subtotal: "Zwischensumme", discount: "Rabatt", tax: "Steuer", grandTotal: "Gesamtbetrag", dueDate: "Fälligkeitsdatum", paymentTerms: "Zahlungsbedingungen", notes: "Notizen", newQuotation: "Neues Angebot", newOrder: "Neue Bestellung", newInvoice: "Neue Rechnung" },
  purchase: { title: "Einkauf", rfq: "Anfrage", order: "Bestellung", bill: "Eingangsrechnung", vendor: "Lieferant", item: "Artikel", qty: "Menge", unitPrice: "Stückpreis", subtotal: "Zwischensumme", newRFQ: "Neue Anfrage", newOrder: "Neue Bestellung", newBill: "Neue Rechnung" },
  accounting: { title: "Buchhaltung", account: "Konto", debit: "Soll", credit: "Haben", balance: "Saldo", journal: "Journal", entry: "Buchung", payment: "Zahlung", tax: "Steuer", period: "Periode", openingBalance: "Anfangssaldo", closingBalance: "Endsaldo", netIncome: "Nettogewinn", totalAssets: "Gesamtvermögen", totalLiabilities: "Gesamtverbindlichkeiten", equity: "Eigenkapital" },
};

const es: DeepPartial<Translations> = {
  nav: { modules: "Módulos", dashboard: "Panel de control", sales: "Ventas", salesDashboard: "Panel de control", masterItem: "Artículos maestros", quotations: "Presupuestos", salesOrders: "Pedidos de venta", aiDrafts: "Borradores IA", customers: "Clientes", invoices: "Facturas", purchase: "Compras", purchaseDashboard: "Panel de control", rfq: "Solicitud de presupuesto", purchaseOrders: "Órdenes de compra", vendors: "Proveedores", vendorService: "Proveedores de servicios", bills: "Facturas de proveedor", reports: "Informes", salesReport: "Ventas", purchaseReport: "Compras", arAging: "Cuentas por cobrar", apAging: "Cuentas por pagar", accounting: "Contabilidad", chartOfAccounts: "Plan de cuentas", journals: "Diarios", journalEntry: "Asiento contable", journalItems: "Líneas de asiento", payments: "Pagos", taxes: "Impuestos", trialBalance: "Balance de comprobación", generalLedger: "Libro mayor", profitLoss: "Pérdidas y ganancias", balanceSheet: "Balance general", reconciliation: "Conciliación", accountingSettings: "Configuración", trading: "Comercio", logistics: "Logística", shipments: "Envíos", freightForwarding: "Agencia de carga", portalOrders: "Pedidos del portal", pos: "Punto de venta", expense: "Gastos operativos", expenseList: "Lista de gastos", expenseCategories: "Categorías", expenseReports: "Informes de gastos", correspondences: "Correspondencia", emailInbox: "Bandeja de entrada", users: "Usuarios", aiChatbot: "Chatbot IA", uomSettings: "Unidad de medida", settings: "Configuración" },
  common: { save: "Guardar", saving: "Guardando...", saved: "¡Guardado!", cancel: "Cancelar", delete: "Eliminar", edit: "Editar", add: "Agregar", search: "Buscar", filter: "Filtrar", loading: "Cargando...", error: "Error", success: "Éxito", noData: "Sin datos", noResults: "Sin resultados", confirm: "Confirmar", close: "Cerrar", back: "Volver", next: "Siguiente", submit: "Enviar", create: "Crear", update: "Actualizar", view: "Ver", download: "Descargar", export: "Exportar", import: "Importar", print: "Imprimir", all: "Todos", status: "Estado", date: "Fecha", name: "Nombre", email: "Correo", phone: "Teléfono", address: "Dirección", description: "Descripción", amount: "Monto", total: "Total", actions: "Acciones", type: "Tipo", category: "Categoría", logOut: "Cerrar sesión", noRole: "Sin rol", division: "División", signOut: "Salir" },
  welcome: { title: "Bienvenido a BizPortal", subtitle: "Su cuenta está registrada. Contacte al administrador para obtener acceso a su división.", ecommerce: "E-Commerce", ecommerceDesc: "Gestión de ventas minoristas en línea", ecommerceDetail: "Gestione los productos de su tienda en línea, realice el seguimiento de pedidos de clientes y monitoree el rendimiento de ventas digitales.", trading: "Comercio", tradingDesc: "Inventario y proveedores B2B", tradingDetail: "Realice seguimiento de inventario a granel, gestione relaciones con proveedores, monitoree precios de costo y gestione códigos HS para comercio internacional.", logistics: "Logística", logisticsDesc: "Seguimiento de flota y envíos", logisticsDetail: "Monitoree entregas en tiempo real, actualice estados de envío y asegure que los paquetes lleguen a tiempo.", pos: "Punto de venta", posDesc: "Transacciones en tienda", posDetail: "Procese transacciones minoristas rápidamente, acepte múltiples métodos de pago y realice seguimiento de ingresos diarios.", signOut: "Salir" },
  dashboard: { title: "Panel de control", totalRevenue: "Ingresos totales", totalOrders: "Pedidos totales", activeCustomers: "Clientes activos", pendingShipments: "Envíos pendientes", recentOrders: "Pedidos recientes", salesOverview: "Resumen de ventas", quickActions: "Acciones rápidas", newQuotation: "Nuevo presupuesto", newOrder: "Nuevo pedido", viewReports: "Ver informes" },
  settings: { title: "Configuración", profile: "Perfil", language: "Idioma", languageDesc: "Seleccionar idioma de visualización", notifications: "Notificaciones", security: "Seguridad", calculator: "Calculadora de tarifas", calculatorDesc: "Configurar tarifas de estimación de costos logísticos", cargoTypes: "Tipos de carga", cargoTypesDesc: "Lista de tipos de carga para la calculadora", aiIntake: "Recepción de pedidos IA", aiIntakeDesc: "Configuración de IA para procesamiento de email/WA entrante", waNotif: "Notificaciones WhatsApp", waNotifDesc: "Número WhatsApp del administrador" },
  pos: { title: "Punto de venta", products: "Productos", cart: "Carrito", total: "Total", payment: "Pago", cashier: "Cajero", receipt: "Recibo", emptyCart: "El carrito está vacío", checkout: "Pagar", searchProduct: "Buscar producto..." },
  trading: { title: "Comercio", inventory: "Inventario", stock: "Stock", sku: "SKU", costPrice: "Precio de costo", salePrice: "Precio de venta", hsCode: "Código HS", supplier: "Proveedor" },
  logistics: { title: "Logística", trackingNumber: "Número de seguimiento", origin: "Origen", destination: "Destino", estimatedDelivery: "Entrega estimada", deliveryStatus: "Estado de entrega", driver: "Conductor", vehicle: "Vehículo", weight: "Peso", dimensions: "Dimensiones" },
  sales: { title: "Ventas", quotation: "Presupuesto", order: "Pedido", invoice: "Factura", customer: "Cliente", item: "Artículo", qty: "Cant.", unitPrice: "Precio unitario", subtotal: "Subtotal", discount: "Descuento", tax: "Impuesto", grandTotal: "Total general", dueDate: "Fecha de vencimiento", paymentTerms: "Condiciones de pago", notes: "Notas", newQuotation: "Nuevo presupuesto", newOrder: "Nuevo pedido", newInvoice: "Nueva factura" },
  purchase: { title: "Compras", rfq: "Solicitud de cotización", order: "Orden de compra", bill: "Factura proveedor", vendor: "Proveedor", item: "Artículo", qty: "Cant.", unitPrice: "Precio unitario", subtotal: "Subtotal", newRFQ: "Nueva solicitud", newOrder: "Nueva orden", newBill: "Nueva factura" },
  accounting: { title: "Contabilidad", account: "Cuenta", debit: "Débito", credit: "Crédito", balance: "Saldo", journal: "Diario", entry: "Asiento", payment: "Pago", tax: "Impuesto", period: "Período", openingBalance: "Saldo inicial", closingBalance: "Saldo final", netIncome: "Ingreso neto", totalAssets: "Activos totales", totalLiabilities: "Pasivos totales", equity: "Patrimonio" },
};

const pt: DeepPartial<Translations> = {
  nav: { modules: "Módulos", dashboard: "Painel", sales: "Vendas", salesDashboard: "Painel", masterItem: "Itens Mestre", quotations: "Orçamentos", salesOrders: "Pedidos de Venda", aiDrafts: "Rascunhos IA", customers: "Clientes", invoices: "Faturas", purchase: "Compras", purchaseDashboard: "Painel", rfq: "Solicitação de Cotação", purchaseOrders: "Ordens de Compra", vendors: "Fornecedores", vendorService: "Prestadores de Serviço", bills: "Contas a Pagar", reports: "Relatórios", salesReport: "Vendas", purchaseReport: "Compras", arAging: "Contas a Receber", apAging: "Contas a Pagar", accounting: "Contabilidade", chartOfAccounts: "Plano de Contas", journals: "Diários", journalEntry: "Lançamento", journalItems: "Itens de Lançamento", payments: "Pagamentos", taxes: "Impostos", trialBalance: "Balancete", generalLedger: "Livro Razão", profitLoss: "DRE", balanceSheet: "Balanço", reconciliation: "Conciliação", accountingSettings: "Configurações", trading: "Comércio", logistics: "Logística", shipments: "Embarques", freightForwarding: "Frete Internacional", portalOrders: "Pedidos do Portal", pos: "PDV", expense: "Despesas Operacionais", expenseList: "Lista de Despesas", expenseCategories: "Categorias", expenseReports: "Relatórios de Despesas", correspondences: "Correspondências", emailInbox: "Caixa de Entrada", users: "Usuários", aiChatbot: "Chatbot IA", settings: "Configurações" },
  common: { save: "Salvar", saving: "Salvando...", saved: "Salvo!", cancel: "Cancelar", delete: "Excluir", edit: "Editar", add: "Adicionar", search: "Pesquisar", filter: "Filtrar", loading: "Carregando...", error: "Erro", success: "Sucesso", noData: "Sem dados", noResults: "Sem resultados", confirm: "Confirmar", close: "Fechar", back: "Voltar", next: "Próximo", submit: "Enviar", create: "Criar", update: "Atualizar", view: "Ver", download: "Baixar", export: "Exportar", import: "Importar", print: "Imprimir", all: "Todos", status: "Status", date: "Data", name: "Nome", email: "E-mail", phone: "Telefone", address: "Endereço", description: "Descrição", amount: "Valor", total: "Total", actions: "Ações", type: "Tipo", category: "Categoria", logOut: "Sair", noRole: "Sem perfil", division: "Divisão", signOut: "Sair" },
  welcome: { title: "Bem-vindo ao BizPortal", subtitle: "Sua conta está registrada. Entre em contato com o administrador para obter acesso à sua divisão.", ecommerce: "E-Commerce", ecommerceDesc: "Gestão de Varejo Online", ecommerceDetail: "Gerencie os produtos da sua loja online, acompanhe pedidos de clientes e monitore o desempenho de vendas digitais.", trading: "Comércio", tradingDesc: "Estoque B2B & Fornecedores", tradingDetail: "Acompanhe estoques em volume, gerencie relacionamentos com fornecedores, monitore preços de custo e gerencie códigos HS para comércio internacional.", logistics: "Logística", logisticsDesc: "Rastreamento de Frota & Embarques", logisticsDetail: "Monitore entregas em tempo real, atualize status de embarque e garanta que os pacotes cheguem no prazo.", pos: "Ponto de Venda", posDesc: "Transações na Loja", posDetail: "Processe transações de varejo rapidamente, aceite múltiplos métodos de pagamento e acompanhe a receita diária.", signOut: "Sair" },
  dashboard: { title: "Painel", totalRevenue: "Receita Total", totalOrders: "Pedidos Totais", activeCustomers: "Clientes Ativos", pendingShipments: "Embarques Pendentes", recentOrders: "Pedidos Recentes", salesOverview: "Visão Geral de Vendas", quickActions: "Ações Rápidas", newQuotation: "Novo Orçamento", newOrder: "Novo Pedido", viewReports: "Ver Relatórios" },
  settings: { title: "Configurações", profile: "Perfil", language: "Idioma", languageDesc: "Selecionar idioma de exibição", notifications: "Notificações", security: "Segurança", calculator: "Calculadora de Tarifas", calculatorDesc: "Configurar tarifas de estimativa de custos logísticos", cargoTypes: "Tipos de Carga", cargoTypesDesc: "Lista de tipos de carga para a calculadora", aiIntake: "Recebimento de Pedidos IA", aiIntakeDesc: "Configurações de IA para processamento de e-mail/WA entrante", waNotif: "Notificações WhatsApp", waNotifDesc: "Número WhatsApp do administrador" },
  pos: { title: "PDV", products: "Produtos", cart: "Carrinho", total: "Total", payment: "Pagamento", cashier: "Caixa", receipt: "Recibo", emptyCart: "Carrinho vazio", checkout: "Finalizar", searchProduct: "Buscar produto..." },
  trading: { title: "Comércio", inventory: "Estoque", stock: "Estoque", sku: "SKU", costPrice: "Preço de Custo", salePrice: "Preço de Venda", hsCode: "Código HS", supplier: "Fornecedor" },
  logistics: { title: "Logística", trackingNumber: "Número de Rastreio", origin: "Origem", destination: "Destino", estimatedDelivery: "Entrega Estimada", deliveryStatus: "Status de Entrega", driver: "Motorista", vehicle: "Veículo", weight: "Peso", dimensions: "Dimensões" },
  sales: { title: "Vendas", quotation: "Orçamento", order: "Pedido", invoice: "Fatura", customer: "Cliente", item: "Item", qty: "Qtd", unitPrice: "Preço Unitário", subtotal: "Subtotal", discount: "Desconto", tax: "Imposto", grandTotal: "Total Geral", dueDate: "Vencimento", paymentTerms: "Condições de Pagamento", notes: "Observações", newQuotation: "Novo Orçamento", newOrder: "Novo Pedido", newInvoice: "Nova Fatura" },
  purchase: { title: "Compras", rfq: "Solicitação de Cotação", order: "Ordem de Compra", bill: "Conta a Pagar", vendor: "Fornecedor", item: "Item", qty: "Qtd", unitPrice: "Preço Unitário", subtotal: "Subtotal", newRFQ: "Nova Solicitação", newOrder: "Nova Ordem", newBill: "Nova Conta" },
  accounting: { title: "Contabilidade", account: "Conta", debit: "Débito", credit: "Crédito", balance: "Saldo", journal: "Diário", entry: "Lançamento", payment: "Pagamento", tax: "Imposto", period: "Período", openingBalance: "Saldo Inicial", closingBalance: "Saldo Final", netIncome: "Lucro Líquido", totalAssets: "Ativo Total", totalLiabilities: "Passivo Total", equity: "Patrimônio Líquido" },
};

const ru: DeepPartial<Translations> = {
  nav: { modules: "Модули", dashboard: "Панель управления", sales: "Продажи", salesDashboard: "Панель управления", masterItem: "Мастер товаров", quotations: "Коммерческие предложения", salesOrders: "Заказы на продажу", aiDrafts: "Черновики ИИ", customers: "Клиенты", invoices: "Счета-фактуры", purchase: "Закупки", purchaseDashboard: "Панель управления", rfq: "Запрос котировок", purchaseOrders: "Заказы на закупку", vendors: "Поставщики", vendorService: "Поставщики услуг", bills: "Счета поставщиков", reports: "Отчёты", salesReport: "Продажи", purchaseReport: "Закупки", arAging: "Дебиторская задолженность", apAging: "Кредиторская задолженность", accounting: "Бухгалтерия", chartOfAccounts: "План счетов", journals: "Журналы", journalEntry: "Запись в журнале", journalItems: "Строки журнала", payments: "Платежи", taxes: "Налоги", trialBalance: "Оборотно-сальдовая ведомость", generalLedger: "Главная книга", profitLoss: "Прибыли и убытки", balanceSheet: "Бухгалтерский баланс", reconciliation: "Сверка", accountingSettings: "Настройки", trading: "Торговля", logistics: "Логистика", shipments: "Отгрузки", freightForwarding: "Экспедирование грузов", portalOrders: "Заказы портала", pos: "Касса", expense: "Операционные расходы", expenseList: "Список расходов", expenseCategories: "Категории расходов", expenseReports: "Отчёты по расходам", correspondences: "Корреспонденция", emailInbox: "Входящие", users: "Пользователи", aiChatbot: "ИИ-чатбот", settings: "Настройки" },
  common: { save: "Сохранить", saving: "Сохранение...", saved: "Сохранено!", cancel: "Отмена", delete: "Удалить", edit: "Редактировать", add: "Добавить", search: "Поиск", filter: "Фильтр", loading: "Загрузка...", error: "Ошибка", success: "Успешно", noData: "Нет данных", noResults: "Нет результатов", confirm: "Подтвердить", close: "Закрыть", back: "Назад", next: "Далее", submit: "Отправить", create: "Создать", update: "Обновить", view: "Просмотр", download: "Скачать", export: "Экспорт", import: "Импорт", print: "Печать", all: "Все", status: "Статус", date: "Дата", name: "Имя", email: "Эл. почта", phone: "Телефон", address: "Адрес", description: "Описание", amount: "Сумма", total: "Итого", actions: "Действия", type: "Тип", category: "Категория", logOut: "Выйти", noRole: "Нет роли", division: "Подразделение", signOut: "Выйти" },
  welcome: { title: "Добро пожаловать в BizPortal", subtitle: "Ваш аккаунт зарегистрирован. Свяжитесь с администратором для получения доступа к своему подразделению.", ecommerce: "Электронная коммерция", ecommerceDesc: "Управление онлайн-розницей", ecommerceDetail: "Управляйте товарами интернет-магазина, отслеживайте заказы клиентов и контролируйте цифровые продажи.", trading: "Торговля", tradingDesc: "Склад и поставщики B2B", tradingDetail: "Отслеживайте оптовые запасы, управляйте поставщиками, контролируйте себестоимость и работайте с кодами HS для международной торговли.", logistics: "Логистика", logisticsDesc: "Отслеживание парка и отгрузок", logisticsDetail: "Отслеживайте доставки в реальном времени, обновляйте статусы отгрузок и обеспечивайте своевременную доставку.", pos: "Касса (POS)", posDesc: "Транзакции в магазине", posDetail: "Быстро обрабатывайте розничные транзакции, принимайте несколько способов оплаты и отслеживайте ежедневную выручку.", signOut: "Выйти" },
  dashboard: { title: "Панель управления", totalRevenue: "Общая выручка", totalOrders: "Всего заказов", activeCustomers: "Активные клиенты", pendingShipments: "Ожидающие отгрузки", recentOrders: "Последние заказы", salesOverview: "Обзор продаж", quickActions: "Быстрые действия", newQuotation: "Новое КП", newOrder: "Новый заказ", viewReports: "Просмотр отчётов" },
  settings: { title: "Настройки", profile: "Профиль", language: "Язык", languageDesc: "Выбор языка отображения", notifications: "Уведомления", security: "Безопасность", calculator: "Калькулятор тарифов", calculatorDesc: "Настройка тарифов оценки логистических расходов", cargoTypes: "Типы груза", cargoTypesDesc: "Список типов груза для калькулятора", aiIntake: "Приём заказов ИИ", aiIntakeDesc: "Настройки ИИ для обработки входящих email/WA", waNotif: "Уведомления WhatsApp", waNotifDesc: "Номер WhatsApp администратора" },
  pos: { title: "Касса", products: "Товары", cart: "Корзина", total: "Итого", payment: "Оплата", cashier: "Кассир", receipt: "Чек", emptyCart: "Корзина пуста", checkout: "Оплатить", searchProduct: "Поиск товара..." },
  trading: { title: "Торговля", inventory: "Инвентарь", stock: "Остатки", sku: "Артикул", costPrice: "Себестоимость", salePrice: "Цена продажи", hsCode: "Код HS", supplier: "Поставщик" },
  logistics: { title: "Логистика", trackingNumber: "Номер отслеживания", origin: "Откуда", destination: "Куда", estimatedDelivery: "Ожидаемая доставка", deliveryStatus: "Статус доставки", driver: "Водитель", vehicle: "Транспортное средство", weight: "Вес", dimensions: "Размеры" },
  sales: { title: "Продажи", quotation: "КП", order: "Заказ", invoice: "Счёт-фактура", customer: "Клиент", item: "Позиция", qty: "Кол-во", unitPrice: "Цена за ед.", subtotal: "Промежуточный итог", discount: "Скидка", tax: "Налог", grandTotal: "Итого", dueDate: "Дата оплаты", paymentTerms: "Условия оплаты", notes: "Примечания", newQuotation: "Новое КП", newOrder: "Новый заказ", newInvoice: "Новый счёт" },
  purchase: { title: "Закупки", rfq: "Запрос котировок", order: "Заказ на закупку", bill: "Счёт поставщика", vendor: "Поставщик", item: "Позиция", qty: "Кол-во", unitPrice: "Цена за ед.", subtotal: "Промежуточный итог", newRFQ: "Новый запрос", newOrder: "Новый заказ", newBill: "Новый счёт" },
  accounting: { title: "Бухгалтерия", account: "Счёт", debit: "Дебет", credit: "Кредит", balance: "Остаток", journal: "Журнал", entry: "Запись", payment: "Платёж", tax: "Налог", period: "Период", openingBalance: "Начальный остаток", closingBalance: "Конечный остаток", netIncome: "Чистая прибыль", totalAssets: "Итого активы", totalLiabilities: "Итого обязательства", equity: "Капитал" },
};

const hi: DeepPartial<Translations> = {
  nav: { modules: "मॉड्यूल", dashboard: "डैशबोर्ड", sales: "बिक्री", salesDashboard: "डैशबोर्ड", masterItem: "मास्टर आइटम", quotations: "कोटेशन", salesOrders: "बिक्री ऑर्डर", aiDrafts: "AI ड्राफ्ट", customers: "ग्राहक", invoices: "चालान", purchase: "खरीद", purchaseDashboard: "डैशबोर्ड", rfq: "कोटेशन अनुरोध", purchaseOrders: "खरीद ऑर्डर", vendors: "विक्रेता", vendorService: "सेवा विक्रेता", bills: "बिल", reports: "रिपोर्ट", salesReport: "बिक्री", purchaseReport: "खरीद", arAging: "प्राप्य खाते", apAging: "देय खाते", accounting: "लेखांकन", chartOfAccounts: "खाता चार्ट", journals: "जर्नल", journalEntry: "जर्नल एंट्री", journalItems: "जर्नल आइटम", payments: "भुगतान", taxes: "कर", trialBalance: "ट्रायल बैलेंस", generalLedger: "सामान्य खाताबही", profitLoss: "लाभ-हानि", balanceSheet: "बैलेंस शीट", reconciliation: "समाधान", accountingSettings: "सेटिंग्स", trading: "व्यापार", logistics: "लॉजिस्टिक्स", shipments: "शिपमेंट", freightForwarding: "माल ढुलाई", portalOrders: "पोर्टल ऑर्डर", pos: "बिक्री बिंदु", expense: "परिचालन व्यय", expenseList: "व्यय सूची", expenseCategories: "श्रेणियाँ", expenseReports: "व्यय रिपोर्ट", correspondences: "पत्राचार", emailInbox: "इनबॉक्स", users: "उपयोगकर्ता", aiChatbot: "AI चैटबॉट", settings: "सेटिंग्स" },
  common: { save: "सहेजें", saving: "सहेजा जा रहा है...", saved: "सहेजा गया!", cancel: "रद्द करें", delete: "हटाएं", edit: "संपादित करें", add: "जोड़ें", search: "खोजें", filter: "फ़िल्टर", loading: "लोड हो रहा है...", error: "त्रुटि", success: "सफलता", noData: "कोई डेटा नहीं", noResults: "कोई परिणाम नहीं", confirm: "पुष्टि करें", close: "बंद करें", back: "वापस", next: "अगला", submit: "सबमिट", create: "बनाएं", update: "अपडेट", view: "देखें", download: "डाउनलोड", export: "निर्यात", import: "आयात", print: "प्रिंट", all: "सभी", status: "स्थिति", date: "तारीख", name: "नाम", email: "ईमेल", phone: "फ़ोन", address: "पता", description: "विवरण", amount: "राशि", total: "कुल", actions: "क्रियाएं", type: "प्रकार", category: "श्रेणी", logOut: "लॉग आउट", noRole: "कोई भूमिका नहीं", division: "विभाग", signOut: "साइन आउट" },
  welcome: { title: "BizPortal में आपका स्वागत है", subtitle: "आपका खाता पंजीकृत है। अपने विभाग तक पहुंच के लिए व्यवस्थापक से संपर्क करें।", ecommerce: "ई-कॉमर्स", ecommerceDesc: "ऑनलाइन रिटेल प्रबंधन", ecommerceDetail: "अपने ऑनलाइन स्टोर के उत्पाद प्रबंधित करें, ग्राहक ऑर्डर ट्रैक करें और डिजिटल बिक्री प्रदर्शन मॉनिटर करें।", trading: "व्यापार", tradingDesc: "B2B इन्वेंटरी और सप्लायर", tradingDetail: "थोक इन्वेंटरी ट्रैक करें, सप्लायर संबंध प्रबंधित करें, लागत मूल्य मॉनिटर करें और अंतर्राष्ट्रीय व्यापार के लिए HS कोड संभालें।", logistics: "लॉजिस्टिक्स", logisticsDesc: "फ्लीट और शिपमेंट ट्रैकिंग", logisticsDetail: "वास्तविक समय में डिलीवरी मॉनिटर करें, शिपमेंट स्टेटस अपडेट करें और पैकेज समय पर पहुंचाएं।", pos: "बिक्री बिंदु", posDesc: "स्टोर लेनदेन", posDetail: "खुदरा लेनदेन त्वरित प्रक्रिया करें, कई भुगतान विधियाँ स्वीकार करें और दैनिक स्टोर राजस्व ट्रैक करें।", signOut: "साइन आउट" },
  dashboard: { title: "डैशबोर्ड", totalRevenue: "कुल राजस्व", totalOrders: "कुल ऑर्डर", activeCustomers: "सक्रिय ग्राहक", pendingShipments: "लंबित शिपमेंट", recentOrders: "हाल के ऑर्डर", salesOverview: "बिक्री अवलोकन", quickActions: "त्वरित क्रियाएं", newQuotation: "नया कोटेशन", newOrder: "नया ऑर्डर", viewReports: "रिपोर्ट देखें" },
  settings: { title: "सेटिंग्स", profile: "प्रोफाइल", language: "भाषा", languageDesc: "प्रदर्शन भाषा चुनें", notifications: "सूचनाएं", security: "सुरक्षा", calculator: "टैरिफ कैलकुलेटर", calculatorDesc: "लॉजिस्टिक्स लागत अनुमान दरें कॉन्फ़िगर करें", cargoTypes: "कार्गो प्रकार", cargoTypesDesc: "कैलकुलेटर के लिए कार्गो प्रकार सूची", aiIntake: "AI ऑर्डर इनटेक", aiIntakeDesc: "आने वाले ईमेल/WA प्रोसेसिंग के लिए AI सेटिंग्स", waNotif: "WhatsApp सूचनाएं", waNotifDesc: "व्यवस्थापक WhatsApp नंबर" },
  pos: { title: "बिक्री बिंदु", products: "उत्पाद", cart: "कार्ट", total: "कुल", payment: "भुगतान", cashier: "कैशियर", receipt: "रसीद", emptyCart: "कार्ट खाली है", checkout: "चेकआउट", searchProduct: "उत्पाद खोजें..." },
  trading: { title: "व्यापार", inventory: "इन्वेंटरी", stock: "स्टॉक", sku: "SKU", costPrice: "लागत मूल्य", salePrice: "बिक्री मूल्य", hsCode: "HS कोड", supplier: "सप्लायर" },
  logistics: { title: "लॉजिस्टिक्स", trackingNumber: "ट्रैकिंग नंबर", origin: "उद्गम", destination: "गंतव्य", estimatedDelivery: "अनुमानित डिलीवरी", deliveryStatus: "डिलीवरी स्थिति", driver: "ड्राइवर", vehicle: "वाहन", weight: "वजन", dimensions: "आयाम" },
  sales: { title: "बिक्री", quotation: "कोटेशन", order: "ऑर्डर", invoice: "चालान", customer: "ग्राहक", item: "आइटम", qty: "मात्रा", unitPrice: "इकाई मूल्य", subtotal: "उप-योग", discount: "छूट", tax: "कर", grandTotal: "कुल", dueDate: "देय तिथि", paymentTerms: "भुगतान शर्तें", notes: "नोट्स", newQuotation: "नया कोटेशन", newOrder: "नया ऑर्डर", newInvoice: "नया चालान" },
  purchase: { title: "खरीद", rfq: "कोटेशन अनुरोध", order: "खरीद ऑर्डर", bill: "बिल", vendor: "विक्रेता", item: "आइटम", qty: "मात्रा", unitPrice: "इकाई मूल्य", subtotal: "उप-योग", newRFQ: "नया अनुरोध", newOrder: "नया ऑर्डर", newBill: "नया बिल" },
  accounting: { title: "लेखांकन", account: "खाता", debit: "डेबिट", credit: "क्रेडिट", balance: "शेष", journal: "जर्नल", entry: "प्रविष्टि", payment: "भुगतान", tax: "कर", period: "अवधि", openingBalance: "प्रारंभिक शेष", closingBalance: "समापन शेष", netIncome: "शुद्ध आय", totalAssets: "कुल संपत्ति", totalLiabilities: "कुल देनदारियां", equity: "इक्विटी" },
};

const ms: DeepPartial<Translations> = {
  nav: { modules: "Modul", dashboard: "Papan Pemuka", sales: "Jualan", salesDashboard: "Papan Pemuka", masterItem: "Item Induk", quotations: "Sebut Harga", salesOrders: "Pesanan Jualan", aiDrafts: "Draf AI", customers: "Pelanggan", invoices: "Invois", purchase: "Pembelian", purchaseDashboard: "Papan Pemuka", rfq: "Permintaan Sebut Harga", purchaseOrders: "Pesanan Belian", vendors: "Vendor", vendorService: "Vendor Perkhidmatan", bills: "Bil", reports: "Laporan", salesReport: "Jualan", purchaseReport: "Pembelian", arAging: "Akaun Belum Terima", apAging: "Akaun Belum Bayar", accounting: "Perakaunan", chartOfAccounts: "Carta Akaun", journals: "Jurnal", journalEntry: "Catatan Jurnal", journalItems: "Item Jurnal", payments: "Pembayaran", taxes: "Cukai", trialBalance: "Imbangan Duga", generalLedger: "Lejar Am", profitLoss: "Untung Rugi", balanceSheet: "Lembaran Imbangan", reconciliation: "Penyesuaian", accountingSettings: "Tetapan", trading: "Perdagangan", logistics: "Logistik", shipments: "Penghantaran", freightForwarding: "Pengangkutan Kargo", portalOrders: "Pesanan Portal", pos: "Tempat Jualan", expense: "Perbelanjaan Operasi", expenseList: "Senarai Perbelanjaan", expenseCategories: "Kategori", expenseReports: "Laporan Perbelanjaan", correspondences: "Surat Menyurat", emailInbox: "Peti Masuk", users: "Pengguna", aiChatbot: "Chatbot AI", settings: "Tetapan" },
  common: { save: "Simpan", saving: "Menyimpan...", saved: "Disimpan!", cancel: "Batal", delete: "Padam", edit: "Edit", add: "Tambah", search: "Cari", filter: "Tapis", loading: "Memuatkan...", error: "Ralat", success: "Berjaya", noData: "Tiada data", noResults: "Tiada keputusan", confirm: "Sahkan", close: "Tutup", back: "Kembali", next: "Seterusnya", submit: "Hantar", create: "Cipta", update: "Kemas kini", view: "Lihat", download: "Muat turun", export: "Eksport", import: "Import", print: "Cetak", all: "Semua", status: "Status", date: "Tarikh", name: "Nama", email: "E-mel", phone: "Telefon", address: "Alamat", description: "Keterangan", amount: "Jumlah", total: "Jumlah", actions: "Tindakan", type: "Jenis", category: "Kategori", logOut: "Log Keluar", noRole: "Tiada Peranan", division: "Bahagian", signOut: "Log Keluar" },
  welcome: { title: "Selamat Datang ke BizPortal", subtitle: "Akaun anda telah didaftarkan. Hubungi pentadbir untuk mendapatkan akses ke bahagian anda.", ecommerce: "E-Dagang", ecommerceDesc: "Pengurusan Runcit Dalam Talian", ecommerceDetail: "Urus produk kedai dalam talian anda, jejak pesanan pelanggan, dan pantau prestasi jualan digital.", trading: "Perdagangan", tradingDesc: "Inventori & Pembekal B2B", tradingDetail: "Jejak inventori pukal, urus hubungan pembekal, pantau harga kos, dan kendalikan kod HS untuk perdagangan antarabangsa.", logistics: "Logistik", logisticsDesc: "Penjejakan Armada & Penghantaran", logisticsDetail: "Pantau penghantaran dalam masa nyata, kemas kini status penghantaran, dan pastikan bungkusan tiba tepat pada masanya.", pos: "Tempat Jualan", posDesc: "Transaksi Kedai", posDetail: "Proses transaksi runcit dengan cepat, sokong pelbagai kaedah pembayaran, dan jejak hasil harian.", signOut: "Log Keluar" },
  dashboard: { title: "Papan Pemuka", totalRevenue: "Jumlah Hasil", totalOrders: "Jumlah Pesanan", activeCustomers: "Pelanggan Aktif", pendingShipments: "Penghantaran Tertangguh", recentOrders: "Pesanan Terbaru", salesOverview: "Gambaran Keseluruhan Jualan", quickActions: "Tindakan Pantas", newQuotation: "Sebut Harga Baru", newOrder: "Pesanan Baru", viewReports: "Lihat Laporan" },
  settings: { title: "Tetapan", profile: "Profil", language: "Bahasa", languageDesc: "Pilih bahasa paparan", notifications: "Pemberitahuan", security: "Keselamatan", calculator: "Kalkulator Tarif", calculatorDesc: "Konfigurasi tarif anggaran kos logistik", cargoTypes: "Jenis Kargo", cargoTypesDesc: "Senarai jenis kargo untuk kalkulator", aiIntake: "Penerimaan Pesanan AI", aiIntakeDesc: "Tetapan AI untuk pemprosesan e-mel/WA masuk", waNotif: "Pemberitahuan WhatsApp", waNotifDesc: "Nombor WhatsApp pentadbir" },
  pos: { title: "Tempat Jualan", products: "Produk", cart: "Troli", total: "Jumlah", payment: "Pembayaran", cashier: "Juruwang", receipt: "Resit", emptyCart: "Troli kosong", checkout: "Bayar", searchProduct: "Cari produk..." },
  trading: { title: "Perdagangan", inventory: "Inventori", stock: "Stok", sku: "SKU", costPrice: "Harga Kos", salePrice: "Harga Jualan", hsCode: "Kod HS", supplier: "Pembekal" },
  logistics: { title: "Logistik", trackingNumber: "Nombor Penjejakan", origin: "Asal", destination: "Destinasi", estimatedDelivery: "Anggaran Penghantaran", deliveryStatus: "Status Penghantaran", driver: "Pemandu", vehicle: "Kenderaan", weight: "Berat", dimensions: "Dimensi" },
  sales: { title: "Jualan", quotation: "Sebut Harga", order: "Pesanan", invoice: "Invois", customer: "Pelanggan", item: "Item", qty: "Kuantiti", unitPrice: "Harga Seunit", subtotal: "Subtotal", discount: "Diskaun", tax: "Cukai", grandTotal: "Jumlah Besar", dueDate: "Tarikh Akhir", paymentTerms: "Syarat Pembayaran", notes: "Nota", newQuotation: "Sebut Harga Baru", newOrder: "Pesanan Baru", newInvoice: "Invois Baru" },
  purchase: { title: "Pembelian", rfq: "Permintaan Sebut Harga", order: "Pesanan Belian", bill: "Bil", vendor: "Vendor", item: "Item", qty: "Kuantiti", unitPrice: "Harga Seunit", subtotal: "Subtotal", newRFQ: "Permintaan Baru", newOrder: "Pesanan Baru", newBill: "Bil Baru" },
  accounting: { title: "Perakaunan", account: "Akaun", debit: "Debit", credit: "Kredit", balance: "Baki", journal: "Jurnal", entry: "Catatan", payment: "Pembayaran", tax: "Cukai", period: "Tempoh", openingBalance: "Baki Pembukaan", closingBalance: "Baki Penutupan", netIncome: "Pendapatan Bersih", totalAssets: "Jumlah Aset", totalLiabilities: "Jumlah Liabiliti", equity: "Ekuiti" },
};

const th: DeepPartial<Translations> = {
  nav: { modules: "โมดูล", dashboard: "แดชบอร์ด", sales: "การขาย", salesDashboard: "แดชบอร์ด", masterItem: "รายการหลัก", quotations: "ใบเสนอราคา", salesOrders: "ใบสั่งขาย", aiDrafts: "ร่าง AI", customers: "ลูกค้า", invoices: "ใบแจ้งหนี้", purchase: "การจัดซื้อ", purchaseDashboard: "แดชบอร์ด", rfq: "ขอใบเสนอราคา", purchaseOrders: "ใบสั่งซื้อ", vendors: "ผู้จัดจำหน่าย", vendorService: "ผู้ให้บริการ", bills: "ใบแจ้งหนี้ผู้จัดจำหน่าย", reports: "รายงาน", salesReport: "การขาย", purchaseReport: "การจัดซื้อ", arAging: "ลูกหนี้การค้า", apAging: "เจ้าหนี้การค้า", accounting: "การบัญชี", chartOfAccounts: "ผังบัญชี", journals: "สมุดรายวัน", journalEntry: "รายการบัญชี", journalItems: "รายการในสมุด", payments: "การชำระเงิน", taxes: "ภาษี", trialBalance: "งบทดลอง", generalLedger: "บัญชีแยกประเภท", profitLoss: "กำไรขาดทุน", balanceSheet: "งบดุล", reconciliation: "การกระทบยอด", accountingSettings: "การตั้งค่า", trading: "การค้า", logistics: "โลจิสติกส์", shipments: "การจัดส่ง", freightForwarding: "ขนส่งสินค้า", portalOrders: "คำสั่งซื้อพอร์ทัล", pos: "จุดขาย", expense: "ค่าใช้จ่ายดำเนินงาน", expenseList: "รายการค่าใช้จ่าย", expenseCategories: "หมวดหมู่", expenseReports: "รายงานค่าใช้จ่าย", correspondences: "การติดต่อสื่อสาร", emailInbox: "กล่องขาเข้า", users: "ผู้ใช้งาน", aiChatbot: "แชทบอท AI", settings: "การตั้งค่า" },
  common: { save: "บันทึก", saving: "กำลังบันทึก...", saved: "บันทึกแล้ว!", cancel: "ยกเลิก", delete: "ลบ", edit: "แก้ไข", add: "เพิ่ม", search: "ค้นหา", filter: "กรอง", loading: "กำลังโหลด...", error: "ข้อผิดพลาด", success: "สำเร็จ", noData: "ไม่มีข้อมูล", noResults: "ไม่พบผลลัพธ์", confirm: "ยืนยัน", close: "ปิด", back: "กลับ", next: "ถัดไป", submit: "ส่ง", create: "สร้าง", update: "อัพเดท", view: "ดู", download: "ดาวน์โหลด", export: "ส่งออก", import: "นำเข้า", print: "พิมพ์", all: "ทั้งหมด", status: "สถานะ", date: "วันที่", name: "ชื่อ", email: "อีเมล", phone: "โทรศัพท์", address: "ที่อยู่", description: "คำอธิบาย", amount: "จำนวน", total: "รวม", actions: "การดำเนินการ", type: "ประเภท", category: "หมวดหมู่", logOut: "ออกจากระบบ", noRole: "ไม่มีบทบาท", division: "แผนก", signOut: "ออกจากระบบ" },
  welcome: { title: "ยินดีต้อนรับสู่ BizPortal", subtitle: "บัญชีของคุณได้รับการลงทะเบียนแล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์เข้าถึงแผนกของคุณ", ecommerce: "อีคอมเมิร์ซ", ecommerceDesc: "การจัดการค้าปลีกออนไลน์", ecommerceDetail: "จัดการสินค้าร้านค้าออนไลน์ ติดตามคำสั่งซื้อลูกค้า และตรวจสอบประสิทธิภาพการขายดิจิทัล", trading: "การค้า", tradingDesc: "สินค้าคงคลัง B2B & ซัพพลายเออร์", tradingDetail: "ติดตามสินค้าคงคลังจำนวนมาก จัดการความสัมพันธ์ซัพพลายเออร์ ตรวจสอบราคาต้นทุน และจัดการรหัส HS สำหรับการค้าระหว่างประเทศ", logistics: "โลจิสติกส์", logisticsDesc: "การติดตามยานพาหนะและการจัดส่ง", logisticsDetail: "ตรวจสอบการจัดส่งแบบเรียลไทม์ อัพเดทสถานะการจัดส่ง และให้แน่ใจว่าสินค้าถึงมือผู้รับตรงเวลา", pos: "จุดขาย", posDesc: "ธุรกรรมในร้าน", posDetail: "ประมวลผลธุรกรรมค้าปลีกอย่างรวดเร็ว รองรับหลายวิธีชำระเงิน และติดตามรายได้ร้านค้าประจำวัน", signOut: "ออกจากระบบ" },
  dashboard: { title: "แดชบอร์ด", totalRevenue: "รายได้รวม", totalOrders: "คำสั่งซื้อทั้งหมด", activeCustomers: "ลูกค้าที่ใช้งานอยู่", pendingShipments: "การจัดส่งที่รอดำเนินการ", recentOrders: "คำสั่งซื้อล่าสุด", salesOverview: "ภาพรวมการขาย", quickActions: "การดำเนินการด่วน", newQuotation: "ใบเสนอราคาใหม่", newOrder: "คำสั่งซื้อใหม่", viewReports: "ดูรายงาน" },
  settings: { title: "การตั้งค่า", profile: "โปรไฟล์", language: "ภาษา", languageDesc: "เลือกภาษาที่แสดง", notifications: "การแจ้งเตือน", security: "ความปลอดภัย", calculator: "เครื่องคำนวณอัตรา", calculatorDesc: "กำหนดค่าอัตราประมาณต้นทุนโลจิสติกส์", cargoTypes: "ประเภทสินค้า", cargoTypesDesc: "รายการประเภทสินค้าสำหรับเครื่องคำนวณ", aiIntake: "รับคำสั่งซื้อ AI", aiIntakeDesc: "การตั้งค่า AI สำหรับประมวลผลอีเมล/WA ขาเข้า", waNotif: "การแจ้งเตือน WhatsApp", waNotifDesc: "หมายเลข WhatsApp ของผู้ดูแลระบบ" },
  pos: { title: "จุดขาย", products: "สินค้า", cart: "ตะกร้า", total: "รวม", payment: "การชำระเงิน", cashier: "แคชเชียร์", receipt: "ใบเสร็จ", emptyCart: "ตะกร้าว่างเปล่า", checkout: "ชำระเงิน", searchProduct: "ค้นหาสินค้า..." },
  trading: { title: "การค้า", inventory: "สินค้าคงคลัง", stock: "สต็อก", sku: "SKU", costPrice: "ราคาต้นทุน", salePrice: "ราคาขาย", hsCode: "รหัส HS", supplier: "ซัพพลายเออร์" },
  logistics: { title: "โลจิสติกส์", trackingNumber: "หมายเลขติดตาม", origin: "ต้นทาง", destination: "ปลายทาง", estimatedDelivery: "คาดว่าจะจัดส่ง", deliveryStatus: "สถานะการจัดส่ง", driver: "คนขับ", vehicle: "ยานพาหนะ", weight: "น้ำหนัก", dimensions: "ขนาด" },
  sales: { title: "การขาย", quotation: "ใบเสนอราคา", order: "คำสั่งซื้อ", invoice: "ใบแจ้งหนี้", customer: "ลูกค้า", item: "รายการ", qty: "จำนวน", unitPrice: "ราคาต่อหน่วย", subtotal: "ยอดรวมย่อย", discount: "ส่วนลด", tax: "ภาษี", grandTotal: "ยอดรวม", dueDate: "วันครบกำหนด", paymentTerms: "เงื่อนไขการชำระเงิน", notes: "หมายเหตุ", newQuotation: "ใบเสนอราคาใหม่", newOrder: "คำสั่งซื้อใหม่", newInvoice: "ใบแจ้งหนี้ใหม่" },
  purchase: { title: "การจัดซื้อ", rfq: "ขอใบเสนอราคา", order: "ใบสั่งซื้อ", bill: "ใบแจ้งหนี้", vendor: "ผู้จัดจำหน่าย", item: "รายการ", qty: "จำนวน", unitPrice: "ราคาต่อหน่วย", subtotal: "ยอดรวมย่อย", newRFQ: "คำขอใหม่", newOrder: "ใบสั่งซื้อใหม่", newBill: "ใบแจ้งหนี้ใหม่" },
  accounting: { title: "การบัญชี", account: "บัญชี", debit: "เดบิต", credit: "เครดิต", balance: "ยอดคงเหลือ", journal: "สมุดรายวัน", entry: "รายการ", payment: "การชำระเงิน", tax: "ภาษี", period: "งวด", openingBalance: "ยอดยกมา", closingBalance: "ยอดยกไป", netIncome: "รายได้สุทธิ", totalAssets: "สินทรัพย์รวม", totalLiabilities: "หนี้สินรวม", equity: "ส่วนของผู้ถือหุ้น" },
};

const vi: DeepPartial<Translations> = {
  nav: { modules: "Phân hệ", dashboard: "Bảng điều khiển", sales: "Bán hàng", salesDashboard: "Bảng điều khiển", masterItem: "Danh mục hàng hóa", quotations: "Báo giá", salesOrders: "Đơn bán hàng", aiDrafts: "Bản nháp AI", customers: "Khách hàng", invoices: "Hóa đơn", purchase: "Mua hàng", purchaseDashboard: "Bảng điều khiển", rfq: "Yêu cầu báo giá", purchaseOrders: "Đơn đặt hàng", vendors: "Nhà cung cấp", vendorService: "Nhà cung cấp dịch vụ", bills: "Hóa đơn mua", reports: "Báo cáo", salesReport: "Bán hàng", purchaseReport: "Mua hàng", arAging: "Công nợ phải thu", apAging: "Công nợ phải trả", accounting: "Kế toán", chartOfAccounts: "Hệ thống tài khoản", journals: "Sổ nhật ký", journalEntry: "Bút toán", journalItems: "Chi tiết bút toán", payments: "Thanh toán", taxes: "Thuế", trialBalance: "Bảng cân đối phát sinh", generalLedger: "Sổ cái", profitLoss: "Lãi lỗ", balanceSheet: "Bảng cân đối kế toán", reconciliation: "Đối chiếu", accountingSettings: "Cài đặt", trading: "Thương mại", logistics: "Vận tải", shipments: "Lô hàng", freightForwarding: "Giao nhận hàng hóa", portalOrders: "Đơn hàng portal", pos: "Điểm bán hàng", expense: "Chi phí vận hành", expenseList: "Danh sách chi phí", expenseCategories: "Danh mục chi phí", expenseReports: "Báo cáo chi phí", correspondences: "Thư từ", emailInbox: "Hộp thư đến", users: "Người dùng", aiChatbot: "Chatbot AI", settings: "Cài đặt" },
  common: { save: "Lưu", saving: "Đang lưu...", saved: "Đã lưu!", cancel: "Hủy", delete: "Xóa", edit: "Sửa", add: "Thêm", search: "Tìm kiếm", filter: "Lọc", loading: "Đang tải...", error: "Lỗi", success: "Thành công", noData: "Không có dữ liệu", noResults: "Không có kết quả", confirm: "Xác nhận", close: "Đóng", back: "Quay lại", next: "Tiếp theo", submit: "Gửi", create: "Tạo mới", update: "Cập nhật", view: "Xem", download: "Tải xuống", export: "Xuất", import: "Nhập", print: "In", all: "Tất cả", status: "Trạng thái", date: "Ngày", name: "Tên", email: "Email", phone: "Điện thoại", address: "Địa chỉ", description: "Mô tả", amount: "Số tiền", total: "Tổng", actions: "Thao tác", type: "Loại", category: "Danh mục", logOut: "Đăng xuất", noRole: "Chưa có vai trò", division: "Bộ phận", signOut: "Đăng xuất" },
  welcome: { title: "Chào mừng đến BizPortal", subtitle: "Tài khoản của bạn đã được đăng ký. Liên hệ quản trị viên để được cấp quyền truy cập vào bộ phận của bạn.", ecommerce: "Thương mại điện tử", ecommerceDesc: "Quản lý bán lẻ trực tuyến", ecommerceDetail: "Quản lý sản phẩm cửa hàng trực tuyến, theo dõi đơn hàng khách hàng và giám sát hiệu suất bán hàng kỹ thuật số.", trading: "Thương mại", tradingDesc: "Kho hàng & Nhà cung cấp B2B", tradingDetail: "Theo dõi hàng tồn kho số lượng lớn, quản lý quan hệ nhà cung cấp, theo dõi giá vốn và xử lý mã HS cho thương mại quốc tế.", logistics: "Vận tải", logisticsDesc: "Theo dõi đội xe & Lô hàng", logisticsDetail: "Theo dõi giao hàng theo thời gian thực, cập nhật trạng thái lô hàng và đảm bảo hàng hóa đến đúng hạn.", pos: "Điểm bán hàng", posDesc: "Giao dịch tại cửa hàng", posDetail: "Xử lý nhanh giao dịch bán lẻ, hỗ trợ nhiều phương thức thanh toán và theo dõi doanh thu hàng ngày.", signOut: "Đăng xuất" },
  dashboard: { title: "Bảng điều khiển", totalRevenue: "Tổng doanh thu", totalOrders: "Tổng đơn hàng", activeCustomers: "Khách hàng hoạt động", pendingShipments: "Lô hàng đang chờ", recentOrders: "Đơn hàng gần đây", salesOverview: "Tổng quan bán hàng", quickActions: "Thao tác nhanh", newQuotation: "Báo giá mới", newOrder: "Đơn hàng mới", viewReports: "Xem báo cáo" },
  settings: { title: "Cài đặt", profile: "Hồ sơ", language: "Ngôn ngữ", languageDesc: "Chọn ngôn ngữ hiển thị", notifications: "Thông báo", security: "Bảo mật", calculator: "Máy tính giá cước", calculatorDesc: "Cấu hình giá cước ước tính chi phí logistics", cargoTypes: "Loại hàng hóa", cargoTypesDesc: "Danh sách loại hàng hóa cho máy tính", aiIntake: "Tiếp nhận đơn AI", aiIntakeDesc: "Cài đặt AI xử lý email/WA đến", waNotif: "Thông báo WhatsApp", waNotifDesc: "Số WhatsApp quản trị viên" },
  pos: { title: "Điểm bán hàng", products: "Sản phẩm", cart: "Giỏ hàng", total: "Tổng", payment: "Thanh toán", cashier: "Thu ngân", receipt: "Biên lai", emptyCart: "Giỏ hàng trống", checkout: "Thanh toán", searchProduct: "Tìm sản phẩm..." },
  trading: { title: "Thương mại", inventory: "Tồn kho", stock: "Số lượng", sku: "SKU", costPrice: "Giá vốn", salePrice: "Giá bán", hsCode: "Mã HS", supplier: "Nhà cung cấp" },
  logistics: { title: "Vận tải", trackingNumber: "Mã vận đơn", origin: "Nơi gửi", destination: "Nơi nhận", estimatedDelivery: "Ngày giao dự kiến", deliveryStatus: "Trạng thái giao hàng", driver: "Tài xế", vehicle: "Phương tiện", weight: "Trọng lượng", dimensions: "Kích thước" },
  sales: { title: "Bán hàng", quotation: "Báo giá", order: "Đơn hàng", invoice: "Hóa đơn", customer: "Khách hàng", item: "Mặt hàng", qty: "SL", unitPrice: "Đơn giá", subtotal: "Thành tiền", discount: "Giảm giá", tax: "Thuế", grandTotal: "Tổng cộng", dueDate: "Hạn thanh toán", paymentTerms: "Điều khoản thanh toán", notes: "Ghi chú", newQuotation: "Báo giá mới", newOrder: "Đơn hàng mới", newInvoice: "Hóa đơn mới" },
  purchase: { title: "Mua hàng", rfq: "Yêu cầu báo giá", order: "Đơn đặt hàng", bill: "Hóa đơn mua", vendor: "Nhà cung cấp", item: "Mặt hàng", qty: "SL", unitPrice: "Đơn giá", subtotal: "Thành tiền", newRFQ: "Yêu cầu mới", newOrder: "Đơn hàng mới", newBill: "Hóa đơn mới" },
  accounting: { title: "Kế toán", account: "Tài khoản", debit: "Nợ", credit: "Có", balance: "Số dư", journal: "Sổ nhật ký", entry: "Bút toán", payment: "Thanh toán", tax: "Thuế", period: "Kỳ", openingBalance: "Số dư đầu kỳ", closingBalance: "Số dư cuối kỳ", netIncome: "Lợi nhuận ròng", totalAssets: "Tổng tài sản", totalLiabilities: "Tổng nợ phải trả", equity: "Vốn chủ sở hữu" },
};

export const translationMap: Record<Locale, DeepPartial<Translations>> = {
  "id-ID": id,
  "en-US": en,
  "en-GB": en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "ja-JP": ja,
  "ko-KR": ko,
  "ar-SA": ar,
  "fr-FR": fr,
  "de-DE": de,
  "es-ES": es,
  "pt-BR": pt,
  "ru-RU": ru,
  "hi-IN": hi,
  "ms-MY": ms,
  "th-TH": th,
  "vi-VN": vi,
};

export function getTranslations(locale: Locale): Translations {
  return deepMerge(en as Translations, translationMap[locale] ?? {});
}
