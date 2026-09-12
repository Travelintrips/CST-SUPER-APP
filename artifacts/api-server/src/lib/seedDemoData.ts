import {
  db,
  customersTable,
  salesDocumentsTable,
  salesDocumentLinesTable,
  purchaseDocumentsTable,
  purchaseDocumentLinesTable,
  freightShipmentsTable,
  freightAttachmentsTable,
  expenseCategoriesTable,
  expensesTable,
  chartOfAccountsTable,
  productsTable,
  driversTable,
} from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";

const DEMO_SO_NUMBER = "SO-DEMO-2026-001";

const EXPENSE_CATEGORIES = [
  { code: "BIAYA-OCEAN-FREIGHT", name: "Biaya Ocean Freight" },
  { code: "BIAYA-AIR-FREIGHT",   name: "Biaya Air Freight" },
  { code: "BIAYA-TRUCKING",      name: "Biaya Trucking & Transport" },
  { code: "BIAYA-HANDLING",      name: "Biaya Handling & Port Charges" },
  { code: "BIAYA-CUSTOMS",       name: "Biaya Customs Clearance" },
  { code: "BIAYA-STORAGE",       name: "Biaya Storage & Demurrage" },
  { code: "BIAYA-ASURANSI",      name: "Biaya Asuransi Kargo" },
  { code: "BIAYA-LAINNYA",       name: "Biaya Operasional Lainnya" },
];

// ── AR / AP Aging demo orders (always idempotent, run even on pre-seeded DBs) ──
async function seedAgingDemoOrders(): Promise<void> {
  const arDemoOrders = [
    {
      docNumber: "SO-AR-DEMO-001",
      customerName: "PT. Maju Bersama Indonesia",
      grandTotal: "8500000",
      amountPaid: "0",
      confirmedAt: new Date(Date.now() - 15 * 86400000), // 15 days ago → 0-30 bucket
      notes: "Demo AR aging — piutang baru (0–30 hari)",
    },
    {
      docNumber: "SO-AR-DEMO-002",
      customerName: "CV. Karya Logistik Utama",
      grandTotal: "12000000",
      amountPaid: "3000000",
      confirmedAt: new Date(Date.now() - 45 * 86400000), // 45 days ago → 31-60 bucket
      notes: "Demo AR aging — piutang jatuh tempo (31–60 hari), dibayar sebagian",
    },
    {
      docNumber: "SO-AR-DEMO-003",
      customerName: "PT. Sarana Distribusi Raya",
      grandTotal: "5750000",
      amountPaid: "0",
      confirmedAt: new Date(Date.now() - 95 * 86400000), // 95 days ago → 90+ bucket
      notes: "Demo AR aging — piutang lewat jatuh tempo (90+ hari)",
    },
  ];

  for (const order of arDemoOrders) {
    const [existing] = await db
      .select({ id: salesDocumentsTable.id })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.docNumber, order.docNumber))
      .limit(1);
    if (!existing) {
      const [doc] = await db
        .insert(salesDocumentsTable)
        .values({
          docNumber: order.docNumber,
          kind: "order",
          status: "confirmed",
          invoiceStatus: "to_invoice",
          deliveryStatus: "to_deliver",
          customerName: order.customerName,
          totalAmount: order.grandTotal,
          taxAmount: "0",
          grandTotal: order.grandTotal,
          amountPaid: order.amountPaid,
          confirmedAt: order.confirmedAt,
          notes: order.notes,
        })
        .returning();
      await db.insert(salesDocumentLinesTable).values({
        documentId: doc!.id,
        name: "Jasa Freight & Logistik",
        description: "Layanan freight internasional",
        quantity: "1",
        unitPrice: order.grandTotal,
        subtotal: order.grandTotal,
      });
    }
  }

  logger.info("AR aging demo orders (3 entries) seeded");

  const apDemoOrders = [
    {
      docNumber: "PO-AP-DEMO-001",
      supplierName: "PT. Samudera Shipping Lines",
      grandTotal: "6000000",
      amountPaid: "0",
      confirmedAt: new Date(Date.now() - 20 * 86400000), // 20 days ago → 0-30 bucket
      notes: "Demo AP aging — hutang baru (0–30 hari)",
    },
    {
      docNumber: "PO-AP-DEMO-002",
      supplierName: "PT. Graha Port Services",
      grandTotal: "9500000",
      amountPaid: "2000000",
      confirmedAt: new Date(Date.now() - 55 * 86400000), // 55 days ago → 31-60 bucket
      notes: "Demo AP aging — hutang jatuh tempo (31–60 hari), dibayar sebagian",
    },
    {
      docNumber: "PO-AP-DEMO-003",
      supplierName: "CV. Agen Bea Cukai Nusantara",
      grandTotal: "4250000",
      amountPaid: "0",
      confirmedAt: new Date(Date.now() - 80 * 86400000), // 80 days ago → 61-90 bucket
      notes: "Demo AP aging — hutang mendekati jatuh tempo (61–90 hari)",
    },
  ];

  for (const order of apDemoOrders) {
    const [existing] = await db
      .select({ id: purchaseDocumentsTable.id })
      .from(purchaseDocumentsTable)
      .where(eq(purchaseDocumentsTable.docNumber, order.docNumber))
      .limit(1);
    if (!existing) {
      const [doc] = await db
        .insert(purchaseDocumentsTable)
        .values({
          docNumber: order.docNumber,
          kind: "order",
          status: "confirmed",
          billStatus: "to_bill",
          receiveStatus: "to_receive",
          supplierName: order.supplierName,
          totalAmount: order.grandTotal,
          taxAmount: "0",
          grandTotal: order.grandTotal,
          amountPaid: order.amountPaid,
          confirmedAt: order.confirmedAt,
          notes: order.notes,
        })
        .returning();
      await db.insert(purchaseDocumentLinesTable).values({
        documentId: doc!.id,
        name: "Jasa Freight & Logistik",
        description: "Layanan freight internasional",
        quantity: "1",
        unitCost: order.grandTotal,
        subtotal: order.grandTotal,
      });
    }
  }

  logger.info("AP aging demo orders (3 entries) seeded");
}

export async function seedDemoData(): Promise<void> {
  try {
    // Always seed AR/AP aging demo orders — idempotent per-order, runs on
    // pre-seeded databases too so the aging reports always have rows to show.
    await seedAgingDemoOrders();

    // Check if main demo already seeded
    const [existing] = await db
      .select({ id: salesDocumentsTable.id })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.docNumber, DEMO_SO_NUMBER))
      .limit(1);
    if (existing) {
      logger.info("Demo data already seeded, skipping");
      return;
    }

    // ── 1. Expense Categories ─────────────────────────────────────────────────
    // Find relevant accounts (Beban Operasional Lain & Hutang Usaha)
    const [expenseAccount] = await db
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "5-2040"))
      .limit(1);
    const [payableAccount] = await db
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "2-1010"))
      .limit(1);

    await db
      .insert(expenseCategoriesTable)
      .values(
        EXPENSE_CATEGORIES.map((cat) => ({
          code: cat.code,
          name: cat.name,
          expenseAccountId: expenseAccount?.id ?? null,
          payableAccountId: payableAccount?.id ?? null,
          requiresAttachment: false,
          isActive: true,
        }))
      )
      .onConflictDoNothing({ target: expenseCategoriesTable.code });

    logger.info("Expense categories seeded");

    // ── 2. Demo Customer ──────────────────────────────────────────────────────
    let customerId: number;
    const [existingCustomer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.name, "PT. Ekspedisi Nusantara"))
      .limit(1);

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const [newCustomer] = await db
        .insert(customersTable)
        .values({
          name: "PT. Ekspedisi Nusantara",
          email: "ops@ekspedisinusantara.co.id",
          phone: "+62-21-5555-1234",
          address: "Jl. Pelabuhan Raya No. 88, Tanjung Priok, Jakarta Utara",
          taxId: "01.234.567.8-901.000",
        })
        .returning();
      customerId = newCustomer!.id;
      logger.info("Demo customer created");
    }

    // ── 3. Logistics Products (get IDs) ───────────────────────────────────────
    const oceanFreightProduct = await db
      .select({ id: productsTable.id, name: productsTable.name, price: productsTable.price })
      .from(productsTable)
      .where(eq(productsTable.sku, "SVC-OCEAN-FREIGHT"))
      .limit(1);
    const handlingProduct = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable)
      .where(eq(productsTable.sku, "SVC-HANDLING"))
      .limit(1);
    const customsProduct = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable)
      .where(eq(productsTable.sku, "SVC-CUSTOMS"))
      .limit(1);

    // ── 4. Demo Sales Order (Confirmed & Invoiced) ────────────────────────────
    const soLines = [
      {
        productId: oceanFreightProduct[0]?.id ?? null,
        name: "Jasa Ocean Freight – Jakarta ke Singapore",
        description: "FCL 20' Container, tarif all-in",
        quantity: "1",
        unitPrice: "15000000",
        subtotal: "15000000",
      },
      {
        productId: handlingProduct[0]?.id ?? null,
        name: "Jasa Handling & Port Charges",
        description: "Container handling di Tanjung Priok",
        quantity: "1",
        unitPrice: "2500000",
        subtotal: "2500000",
      },
      {
        productId: customsProduct[0]?.id ?? null,
        name: "Jasa Customs Clearance Ekspor",
        description: "Pengurusan dokumen ekspor PEB",
        quantity: "1",
        unitPrice: "1500000",
        subtotal: "1500000",
      },
    ];
    const totalAmount = 19000000;

    const [demoSo] = await db
      .insert(salesDocumentsTable)
      .values({
        docNumber: DEMO_SO_NUMBER,
        kind: "order",
        status: "confirmed",
        invoiceStatus: "invoiced",
        deliveryStatus: "to_deliver",
        customerId,
        customerName: "PT. Ekspedisi Nusantara",
        totalAmount: String(totalAmount),
        taxAmount: "0",
        grandTotal: String(totalAmount),
        origin: "Jakarta, Indonesia",
        destination: "Singapore",
        transportMode: "sea",
        expectedDate: new Date("2026-05-15"),
        confirmedAt: new Date(),
        notes: "Demo Sales Order — dibuat otomatis untuk contoh data",
      })
      .returning();

    await db.insert(salesDocumentLinesTable).values(
      soLines.map((line) => ({ ...line, documentId: demoSo!.id }))
    );

    logger.info(`Demo Sales Order ${DEMO_SO_NUMBER} created`);

    // ── 5. Demo Freight Shipment ──────────────────────────────────────────────
    const shipmentNumber = "FS-DEMO-2026-001";

    const [existingShipment] = await db
      .select({ id: freightShipmentsTable.id })
      .from(freightShipmentsTable)
      .where(eq(freightShipmentsTable.shipmentNumber, shipmentNumber))
      .limit(1);

    let shipmentId: number;
    if (existingShipment) {
      shipmentId = existingShipment.id;
    } else {
      const [demoShipment] = await db
        .insert(freightShipmentsTable)
        .values({
          shipmentNumber,
          shipperName: "PT. Maju Bersama Indonesia",
          shipperAddress: "Kawasan Industri MM2100 Blok A-1, Cikarang, Bekasi",
          consigneeName: "PT. Ekspedisi Nusantara",
          consigneeAddress: "8 Kallang Avenue, Singapore 339509",
          notifyParty: "PT. Ekspedisi Nusantara — sama dengan consignee",
          commodity: "Garment / Pakaian Jadi",
          hsCode: "6204.62.00",
          grossWeight: "3250",
          netWeight: "3050",
          quantity: 120,
          packingType: "Carton",
          dimensions: "120 x 80 x 100 cm per pallet",
          marksAndNumbers: "PT MBI / JKT-SGP-2026 / Carton No. 1-120",
          measurement: "9.6 CBM",
          origin: "Jakarta, Indonesia",
          destination: "Singapore",
          portOfLoading: "Tanjung Priok, Jakarta",
          portOfDischarge: "Port of Singapore (PSA)",
          vessel: "MV. Strait Enterprise",
          voyage: "SE-2026-0412",
          transportMode: "sea",
          cargoType: "FCL",
          containerNo: "MSCU7234561",
          awbNumber: "BL-2026-01234",
          status: "in_transit",
          departureDate: "2026-04-15",
          approvedVendorName: "PT. Samudera Shipping Lines",
          salesDocId: demoSo!.id,
          notes: "Demo Shipment — FCL 20' Jakarta → Singapore",
        })
        .returning();
      shipmentId = demoShipment!.id;
    }

    logger.info(`Demo Freight Shipment ${shipmentNumber} created`);

    // ── 6. Demo Freight Attachments (BL & AWB documents) ─────────────────────
    await db
      .insert(freightAttachmentsTable)
      .values([
        {
          shipmentId,
          objectPath: "demo/documents/bl-2026-01234.pdf",
          fileName: "BL-2026-01234.pdf",
          contentType: "application/pdf",
          fileType: "document",
          label: "Bill of Lading",
          docType: "BL",
          docNumber: "BL-2026-01234",
          docDate: "2026-04-15",
          docStatus: "issued",
        },
        {
          shipmentId,
          objectPath: "demo/documents/packing-list-2026-001.pdf",
          fileName: "PackingList-2026-001.pdf",
          contentType: "application/pdf",
          fileType: "document",
          label: "Packing List",
          docType: "PackingList",
          docNumber: "PL-2026-001",
          docDate: "2026-04-14",
          docStatus: "issued",
        },
        {
          shipmentId,
          objectPath: "demo/documents/peb-2026-005678.pdf",
          fileName: "PEB-2026-005678.pdf",
          contentType: "application/pdf",
          fileType: "document",
          label: "Pemberitahuan Ekspor Barang",
          docType: "PEB",
          docNumber: "PEB-2026-005678",
          docDate: "2026-04-14",
          docStatus: "submitted",
        },
      ]);

    logger.info("Demo freight documents (BL, Packing List, PEB) attached");

    // ── 7. Demo Expenses ──────────────────────────────────────────────────────
    const [oceanFreightCat] = await db
      .select({ id: expenseCategoriesTable.id })
      .from(expenseCategoriesTable)
      .where(eq(expenseCategoriesTable.code, "BIAYA-OCEAN-FREIGHT"))
      .limit(1);
    const [handlingCat] = await db
      .select({ id: expenseCategoriesTable.id })
      .from(expenseCategoriesTable)
      .where(eq(expenseCategoriesTable.code, "BIAYA-HANDLING"))
      .limit(1);
    const [customsCat] = await db
      .select({ id: expenseCategoriesTable.id })
      .from(expenseCategoriesTable)
      .where(eq(expenseCategoriesTable.code, "BIAYA-CUSTOMS"))
      .limit(1);

    await db.insert(expensesTable).values([
      {
        expenseNumber: "EXP-DEMO-2026-001",
        date: "2026-04-13",
        vendorEmployee: "PT. Samudera Shipping Lines",
        expenseType: "vendor_bill",
        shipmentId,
        salesDocId: demoSo!.id,
        categoryId: oceanFreightCat?.id ?? null,
        description: "Biaya Ocean Freight FCL 20' — Jakarta ke Singapore",
        qty: "1",
        unit: "shipment",
        unitPrice: "12500000",
        subtotal: "12500000",
        taxAmount: "0",
        total: "12500000",
        currency: "IDR",
        status: "posted",
        expenseAccountId: expenseAccount?.id ?? null,
        payableAccountId: payableAccount?.id ?? null,
        notes: "Invoice No. SSP/2026/04/0891 dari Samudera Shipping",
      },
      {
        expenseNumber: "EXP-DEMO-2026-002",
        date: "2026-04-13",
        vendorEmployee: "PT. Graha Port Services",
        expenseType: "vendor_bill",
        shipmentId,
        salesDocId: demoSo!.id,
        categoryId: handlingCat?.id ?? null,
        description: "Biaya Handling & Port Charges di Tanjung Priok",
        qty: "1",
        unit: "lot",
        unitPrice: "1800000",
        subtotal: "1800000",
        taxAmount: "0",
        total: "1800000",
        currency: "IDR",
        status: "posted",
        expenseAccountId: expenseAccount?.id ?? null,
        payableAccountId: payableAccount?.id ?? null,
        notes: "Termasuk biaya TKBM dan lift-on/lift-off",
      },
      {
        expenseNumber: "EXP-DEMO-2026-003",
        date: "2026-04-14",
        vendorEmployee: "PT. Bea Cukai Partner",
        expenseType: "vendor_bill",
        shipmentId,
        salesDocId: demoSo!.id,
        categoryId: customsCat?.id ?? null,
        description: "Biaya Customs Clearance Ekspor (PEB)",
        qty: "1",
        unit: "dokumen",
        unitPrice: "750000",
        subtotal: "750000",
        taxAmount: "0",
        total: "750000",
        currency: "IDR",
        status: "draft",
        expenseAccountId: expenseAccount?.id ?? null,
        payableAccountId: payableAccount?.id ?? null,
        notes: "Menunggu konfirmasi final dari Bea Cukai",
      },
    ]).onConflictDoNothing({ target: expensesTable.expenseNumber });

    logger.info("Demo expenses (3 entries) created");

    logger.info(
      `Demo data seeded successfully — SO: ${DEMO_SO_NUMBER}, Shipment: ${shipmentNumber}, ` +
      `Revenue: IDR 19,000,000, Total Cost: IDR 15,050,000, Estimated Profit: IDR 3,950,000 (20.8%)`
    );
  } catch (err) {
    logger.error({ err }, "Failed to seed demo data");
  }
}

const DEMO_DRIVERS = [
  {
    name: "Demo Driver",
    email: "driver@cst.co.id",
    password: "driver123",
    phone: "+62 812-0000-0001",
    licenseNumber: "SIM-B2-DEMO-001",
    vehiclePlate: "B 1234 CST",
    vehicleType: "Truk Engkel",
  },
  {
    name: "Budi Santoso",
    email: "budi@cst.co.id",
    password: "driver123",
    phone: "+62 812-0000-0002",
    licenseNumber: "SIM-B2-DEMO-002",
    vehiclePlate: "B 5678 CST",
    vehicleType: "Truk Fuso",
  },
];

const AIR_FREIGHT_SEEDS = [
  {
    rate_source_type: "airline",
    rate_source_name: "Singapore Airlines",
    airline: "Singapore Airlines",
    origin_city: "Jakarta",
    origin_airport: "CGK",
    destination_city: "Singapore",
    destination_airport: "SIN",
    trade_type: "export",
    service_mode: "airport_to_airport",
    service_level: "standard",
    currency: "IDR",
    exchange_rate_to_idr: 1,
    rate_minimum: 850000,
    rate_45: 37000,
    rate_100: 22000,
    rate_250: 18500,
    rate_300: 18000,
    rate_500: 16500,
    rate_1000: 15000,
    fuel_surcharge_per_kg: 3500,
    security_surcharge_per_kg: 1400,
    awb_fee: 88000,
    xray_fee: 100000,
    handling_fee: 430000,
    doc_fee: 180000,
    edi_fee: 300000,
    customs_clearance_fee: 1500000,
    pickup_trucking_estimate: 800000,
    delivery_trucking_estimate: 0,
    transit_days: 2,
    routing_type: "direct",
    price_status: "active",
    is_active: true,
  },
  {
    rate_source_type: "airline",
    rate_source_name: "Vietnam Airlines",
    airline: "Vietnam Airlines",
    origin_city: "Jakarta",
    origin_airport: "CGK",
    destination_city: "Hanoi",
    destination_airport: "HAN",
    trade_type: "export",
    service_mode: "airport_to_airport",
    service_level: "standard",
    currency: "IDR",
    exchange_rate_to_idr: 1,
    rate_minimum: null,
    rate_45: 37700,
    rate_100: 21800,
    rate_250: 18200,
    rate_300: null,
    rate_500: 16700,
    rate_1000: 16700,
    fuel_surcharge_per_kg: 900,
    security_surcharge_per_kg: 1400,
    awb_fee: 150000,
    xray_fee: 0,
    handling_fee: 0,
    doc_fee: 0,
    edi_fee: 0,
    customs_clearance_fee: 0,
    pickup_trucking_estimate: 0,
    delivery_trucking_estimate: 0,
    transit_days: 3,
    routing_type: "direct",
    price_status: "active",
    is_active: true,
  },
  {
    rate_source_type: "airline",
    rate_source_name: "Singapore Airlines",
    airline: "Singapore Airlines",
    origin_city: "Jakarta",
    origin_airport: "CGK",
    destination_city: "Guangzhou",
    destination_airport: "CAN",
    trade_type: "export",
    service_mode: "airport_to_airport",
    service_level: "standard",
    currency: "IDR",
    exchange_rate_to_idr: 1,
    rate_minimum: null,
    rate_45: null,
    rate_100: 16000,
    rate_250: null,
    rate_300: null,
    rate_500: null,
    rate_1000: null,
    fuel_surcharge_per_kg: 0,
    security_surcharge_per_kg: 0,
    awb_fee: 20000,
    xray_fee: 0,
    handling_fee: 430000,
    doc_fee: 0,
    edi_fee: 360000,
    customs_clearance_fee: 1500000,
    pickup_trucking_estimate: 800000,
    delivery_trucking_estimate: 0,
    transit_days: 3,
    routing_type: "direct",
    price_status: "active",
    is_active: true,
  },
];

export async function seedAirFreightRates(): Promise<void> {
  try {
    for (const r of AIR_FREIGHT_SEEDS) {
      const existing = await db.execute(sql`
        SELECT id FROM air_freight_rates
        WHERE origin_airport = ${r.origin_airport}
          AND destination_airport = ${r.destination_airport}
          AND rate_source_name = ${r.rate_source_name}
        LIMIT 1
      `);
      if (existing.rows.length > 0) continue;
      await db.execute(sql`
        INSERT INTO air_freight_rates (
          rate_source_type, rate_source_name, airline,
          origin_city, origin_airport, destination_city, destination_airport,
          trade_type, service_mode, service_level,
          currency, exchange_rate_to_idr,
          rate_minimum, rate_45, rate_100, rate_250, rate_300, rate_500, rate_1000,
          fuel_surcharge_per_kg, security_surcharge_per_kg,
          awb_fee, xray_fee, handling_fee, doc_fee, edi_fee,
          customs_clearance_fee, pickup_trucking_estimate, delivery_trucking_estimate,
          transit_days, routing_type,
          valid_from, valid_until,
          price_status, is_active
        ) VALUES (
          ${r.rate_source_type}, ${r.rate_source_name}, ${r.airline},
          ${r.origin_city}, ${r.origin_airport}, ${r.destination_city}, ${r.destination_airport},
          ${r.trade_type}, ${r.service_mode}, ${r.service_level},
          ${r.currency}, ${r.exchange_rate_to_idr},
          ${r.rate_minimum ?? null}, ${r.rate_45 ?? null}, ${r.rate_100 ?? null},
          ${r.rate_250 ?? null}, ${r.rate_300 ?? null}, ${r.rate_500 ?? null}, ${r.rate_1000 ?? null},
          ${r.fuel_surcharge_per_kg}, ${r.security_surcharge_per_kg},
          ${r.awb_fee}, ${r.xray_fee}, ${r.handling_fee}, ${r.doc_fee}, ${r.edi_fee},
          ${r.customs_clearance_fee}, ${r.pickup_trucking_estimate}, ${r.delivery_trucking_estimate},
          ${r.transit_days}, ${r.routing_type},
          CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
          ${r.price_status}, ${r.is_active}
        )
      `);
    }
    logger.info("Air freight rates: 3 seed rows ensured (CGK→SIN, CGK→HAN, CGK→CAN)");
  } catch (err) {
    logger.warn({ err }, "seedAirFreightRates failed (non-fatal)");
  }
}

export async function seedDemoDrivers() {
  try {
    for (const d of DEMO_DRIVERS) {
      const passwordHash = await bcrypt.hash(d.password, 10);
      await db.insert(driversTable).values({
        name: d.name,
        email: d.email,
        passwordHash,
        phone: d.phone,
        licenseNumber: d.licenseNumber,
        vehiclePlate: d.vehiclePlate,
        vehicleType: d.vehicleType,
        isActive: true,
      }).onConflictDoUpdate({
        target: driversTable.email,
        set: { isActive: true },
      });
    }
    logger.info(`Demo drivers: seeded/ensured active (${DEMO_DRIVERS.map(d => d.email).join(", ")})`);
  } catch (err) {
    logger.error({ err }, "Failed to seed demo drivers");
  }
}
