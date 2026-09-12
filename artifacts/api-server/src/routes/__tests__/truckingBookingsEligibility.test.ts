import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, validateTruckingVendorIdsMock } = vi.hoisted(() => ({
  mockDb: {
    execute: vi.fn().mockResolvedValue({ rows: [{ id: 90001 }] }),
  },
  validateTruckingVendorIdsMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: mockDb }));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    queryChunks: strings,
    values,
  }),
}));

vi.mock("../../lib/truckingVendorEligibility.js", () => ({
  validateTruckingVendorIds: validateTruckingVendorIdsMock,
}));

vi.mock("../../lib/supabaseAuth.js", () => ({
  optionalCustomerPortalAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../../lib/requireAdmin.js", () => ({
  requireAdmin: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../lib/waTransport.js", () => ({
  sendViaService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/adminWa.js", () => ({
  getAdminGroupWa: vi.fn().mockResolvedValue(null),
  getAdminWa: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../lib/services/notificationService.js", () => ({
  NotificationService: { saveAndBroadcast: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../lib/services/portalCustomerContextService.js", () => ({
  getPortalCustomerContext: vi.fn(),
  PortalCustomerContextError: class PortalCustomerContextError extends Error {},
}));

import truckingBookingsRouter from "../truckingBookings.js";

const DIVA_VENDOR_ID = 18001;
const WANGSAMAS_VENDOR_ID = 18002;
const UNKNOWN_VENDOR_ID = 18999;

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    vehicleType: "box",
    vehicleName: "Box Truck",
    areaPickup: "jawa-sumatra",
    alamatPickup: "Alamat pickup",
    picPickup: "PIC Pickup",
    hpPickup: "081234567890",
    areaDelivery: "jawa-sumatra",
    alamatDelivery: "Alamat delivery",
    picPenerima: "PIC Penerima",
    hpPenerima: "081234567891",
    jadwalType: "sekarang",
    jumlahTrip: 1,
    addons: {},
    estimasiTotal: 1000000,
    ...overrides,
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/trucking/bookings", truckingBookingsRouter);
  return app;
}

describe("Trucking booking vendor eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rows: [{ id: 90001 }] });
    validateTruckingVendorIdsMock.mockImplementation(async (vendorIds: unknown[]) => {
      const requestedVendorIds = vendorIds.map(Number);
      const eligibleVendorIds = new Set<number>(
        requestedVendorIds.filter((vendorId) => vendorId === DIVA_VENDOR_ID),
      );
      return {
        requestedVendorIds,
        eligibleVendorIds,
        invalidVendorIds: requestedVendorIds.filter((vendorId) => !eligibleVendorIds.has(vendorId)),
      };
    });
  });

  it("accepts an eligible Diva Trucking selection", async () => {
    const response = await request(makeApp())
      .post("/api/trucking/bookings")
      .send(makeBooking({
        candidateVendorIds: [DIVA_VENDOR_ID],
        selectedVendorId: DIVA_VENDOR_ID,
      }));

    expect(response.status).toBe(201);
    expect(validateTruckingVendorIdsMock).toHaveBeenCalledWith([
      DIVA_VENDOR_ID,
      DIVA_VENDOR_ID,
    ]);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects Wangsamas before any booking persistence", async () => {
    const response = await request(makeApp())
      .post("/api/trucking/bookings")
      .send(makeBooking({ selectedVendorId: WANGSAMAS_VENDOR_ID }));

    expect(response.status).toBe(422);
    expect(response.body.invalidVendorIds).toEqual([WANGSAMAS_VENDOR_ID]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("rejects mixed candidates atomically before persistence", async () => {
    const response = await request(makeApp())
      .post("/api/trucking/bookings")
      .send(makeBooking({
        candidateVendorIds: [DIVA_VENDOR_ID, WANGSAMAS_VENDOR_ID],
      }));

    expect(response.status).toBe(422);
    expect(response.body.invalidVendorIds).toEqual([WANGSAMAS_VENDOR_ID]);
    expect(validateTruckingVendorIdsMock).toHaveBeenCalledWith([
      DIVA_VENDOR_ID,
      WANGSAMAS_VENDOR_ID,
    ]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("rejects an unknown or inactive vendor before persistence", async () => {
    const response = await request(makeApp())
      .post("/api/trucking/bookings")
      .send(makeBooking({ candidateVendorIds: [UNKNOWN_VENDOR_ID] }));

    expect(response.status).toBe(422);
    expect(response.body.invalidVendorIds).toEqual([UNKNOWN_VENDOR_ID]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});