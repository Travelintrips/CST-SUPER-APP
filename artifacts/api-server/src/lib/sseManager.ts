import type { Response } from "express";

const driverConnections = new Map<number, Set<Response>>();
const adminConnections = new Set<Response>();
const portalConnections = new Set<Response>();
const customerPortalConnections = new Map<number, Set<Response>>();

function flushSse(res: Response): void {
  const flushable = res as Response & { flush?: () => void };
  flushable.flush?.();
}

export function registerDriverConnection(driverId: number, res: Response): void {
  if (!driverConnections.has(driverId)) {
    driverConnections.set(driverId, new Set());
  }
  driverConnections.get(driverId)!.add(res);
}

export function unregisterDriverConnection(driverId: number, res: Response): void {
  const set = driverConnections.get(driverId);
  if (set) {
    set.delete(res);
    if (set.size === 0) driverConnections.delete(driverId);
  }
}

export function pushToDriver(driverId: number, event: string, data: unknown): void {
  const connections = driverConnections.get(driverId);
  if (!connections || connections.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of connections) {
    try {
      res.write(payload);
    } catch {
      connections.delete(res);
    }
  }
}

export function registerAdminConnection(res: Response): void {
  adminConnections.add(res);
}

export function unregisterAdminConnection(res: Response): void {
  adminConnections.delete(res);
}

export function broadcastToAdmins(event: string, data: unknown): void {
  if (adminConnections.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of adminConnections) {
    try {
      res.write(payload);
    } catch {
      adminConnections.delete(res);
    }
  }
}

export function registerPortalConnection(res: Response): void {
  portalConnections.add(res);
}

export function unregisterPortalConnection(res: Response): void {
  portalConnections.delete(res);
}

export function broadcastToPortal(event: string, data: unknown): void {
  if (portalConnections.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of portalConnections) {
    try {
      res.write(payload);
    } catch {
      portalConnections.delete(res);
    }
  }
}

export function registerCustomerPortalConnection(customerId: number, res: Response): void {
  if (!customerPortalConnections.has(customerId)) {
    customerPortalConnections.set(customerId, new Set());
  }
  customerPortalConnections.get(customerId)!.add(res);
}

export function unregisterCustomerPortalConnection(customerId: number, res: Response): void {
  const connections = customerPortalConnections.get(customerId);
  if (!connections) return;
  connections.delete(res);
  if (connections.size === 0) customerPortalConnections.delete(customerId);
}

export function broadcastToCustomer(customerId: number, event: string, data: unknown): void {
  const connections = customerPortalConnections.get(customerId);
  if (!connections || connections.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of connections) {
    try {
      res.write(payload);
      flushSse(res);
    } catch {
      connections.delete(res);
    }
  }
  if (connections.size === 0) customerPortalConnections.delete(customerId);
}

export function getStats() {
  return {
    connectedDrivers: driverConnections.size,
    adminConnections: adminConnections.size,
    portalConnections: portalConnections.size,
    customerPortalConnections: customerPortalConnections.size,
  };
}

// ── Heartbeat: kirim komentar SSE setiap 30 detik ke semua koneksi ────────────
// Tujuan: (1) menjaga koneksi tetap hidup melewati proxy/load-balancer,
//         (2) mendeteksi dan membersihkan ghost connection secara otomatis —
//             jika res.write() gagal, koneksi langsung dihapus dari Set.
const HEARTBEAT_INTERVAL_MS = 30_000;

setInterval(() => {
  const heartbeat = ":keepalive\n\n";

  // Admin connections
  for (const res of adminConnections) {
    try {
      res.write(heartbeat);
    } catch {
      adminConnections.delete(res);
    }
  }

  // Portal connections
  for (const res of portalConnections) {
    try {
      res.write(heartbeat);
    } catch {
      portalConnections.delete(res);
    }
  }

  // Customer-scoped portal connections
  for (const [customerId, connections] of customerPortalConnections) {
    for (const res of connections) {
      try {
        res.write(heartbeat);
        flushSse(res);
      } catch {
        connections.delete(res);
      }
    }
    if (connections.size === 0) customerPortalConnections.delete(customerId);
  }

  // Driver connections
  for (const [driverId, set] of driverConnections) {
    for (const res of set) {
      try {
        res.write(heartbeat);
      } catch {
        set.delete(res);
      }
    }
    if (set.size === 0) driverConnections.delete(driverId);
  }
}, HEARTBEAT_INTERVAL_MS).unref();
