export interface GeofenceAlert {
  id: string;
  driverId: number;
  driverName: string;
  jobId: number;
  jobNumber: string;
  deviationKm: number;
  thresholdKm: number;
  lat: number;
  lng: number;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
}

const alerts = new Map<string, GeofenceAlert>();

function alertKey(driverId: number, jobId: number) {
  return `${driverId}:${jobId}`;
}

export function upsertAlert(data: Omit<GeofenceAlert, "id" | "triggeredAt" | "resolvedAt">): GeofenceAlert {
  const key = alertKey(data.driverId, data.jobId);
  const existing = alerts.get(key);
  const alert: GeofenceAlert = {
    id: key,
    ...data,
    triggeredAt: existing?.triggeredAt ?? new Date().toISOString(),
    resolvedAt: null,
  };
  alerts.set(key, alert);
  return alert;
}

export function resolveAlert(driverId: number, jobId: number): GeofenceAlert | null {
  const key = alertKey(driverId, jobId);
  const alert = alerts.get(key);
  if (!alert) return null;
  alert.resolvedAt = new Date().toISOString();
  alerts.delete(key);
  return alert;
}

export function getActiveAlerts(): GeofenceAlert[] {
  return [...alerts.values()].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
}

export function hasActiveAlert(driverId: number, jobId: number): boolean {
  return alerts.has(alertKey(driverId, jobId));
}
