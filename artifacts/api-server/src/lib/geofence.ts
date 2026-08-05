import { geocodeAddress } from "./geocoding";

const DEVIATION_THRESHOLD_KM = 5;

function toRad(deg: number) { return (deg * Math.PI) / 180; }

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentDistanceKm(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const ab = { lat: bLat - aLat, lng: bLng - aLng };
  const ap = { lat: pLat - aLat, lng: pLng - aLng };
  const abLenSq = ab.lat ** 2 + ab.lng ** 2;
  if (abLenSq === 0) return haversineKm(pLat, pLng, aLat, aLng);
  const t = Math.max(0, Math.min(1, (ap.lat * ab.lat + ap.lng * ab.lng) / abLenSq));
  const closestLat = aLat + t * ab.lat;
  const closestLng = aLng + t * ab.lng;
  return haversineKm(pLat, pLng, closestLat, closestLng);
}

export interface GeofenceResult {
  deviated: boolean;
  deviationKm: number;
  pickupCoords: { lat: number; lng: number } | null;
  deliveryCoords: { lat: number; lng: number } | null;
  thresholdKm: number;
}

async function _checkGeofenceCore(
  driverLat: number,
  driverLng: number,
  pickupAddress: string | null,
  deliveryAddress: string | null,
  thresholdKm: number,
): Promise<GeofenceResult | null> {
  if (!pickupAddress || !deliveryAddress) return null;

  const [pickupCoords, deliveryCoords] = await Promise.all([
    geocodeAddress(pickupAddress),
    geocodeAddress(deliveryAddress),
  ]);

  if (!pickupCoords || !deliveryCoords) return null;

  const routeLen = haversineKm(pickupCoords.lat, pickupCoords.lng, deliveryCoords.lat, deliveryCoords.lng);

  if (routeLen < 0.5) {
    const distPickup = haversineKm(driverLat, driverLng, pickupCoords.lat, pickupCoords.lng);
    const distDelivery = haversineKm(driverLat, driverLng, deliveryCoords.lat, deliveryCoords.lng);
    const deviationKm = Math.min(distPickup, distDelivery);
    return { deviated: deviationKm > thresholdKm, deviationKm, pickupCoords, deliveryCoords, thresholdKm };
  }

  const deviationKm = pointToSegmentDistanceKm(
    driverLat, driverLng,
    pickupCoords.lat, pickupCoords.lng,
    deliveryCoords.lat, deliveryCoords.lng,
  );

  return { deviated: deviationKm > thresholdKm, deviationKm, pickupCoords, deliveryCoords, thresholdKm };
}

export async function checkGeofence(
  driverLat: number,
  driverLng: number,
  pickupAddress: string | null,
  deliveryAddress: string | null,
): Promise<GeofenceResult | null> {
  return _checkGeofenceCore(driverLat, driverLng, pickupAddress, deliveryAddress, DEVIATION_THRESHOLD_KM);
}

export async function checkGeofenceWithThreshold(
  driverLat: number,
  driverLng: number,
  pickupAddress: string | null,
  deliveryAddress: string | null,
  thresholdKm: number,
): Promise<GeofenceResult | null> {
  return _checkGeofenceCore(driverLat, driverLng, pickupAddress, deliveryAddress, thresholdKm);
}
