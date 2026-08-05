export type ShipmentStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'ON_THE_WAY_TO_PICKUP'
  | 'ARRIVED_AT_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'ARRIVED_AT_DESTINATION'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

export const STATUS_FLOW: ShipmentStatus[] = [
  'ASSIGNED', 'ACCEPTED', 'ON_THE_WAY_TO_PICKUP', 'ARRIVED_AT_PICKUP',
  'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'DELIVERED', 'COMPLETED',
];

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  ASSIGNED: 'Ditugaskan',
  ACCEPTED: 'Diterima',
  ON_THE_WAY_TO_PICKUP: 'Menuju Pickup',
  ARRIVED_AT_PICKUP: 'Tiba di Pickup',
  PICKED_UP: 'Barang Diambil',
  IN_TRANSIT: 'Dalam Perjalanan',
  ARRIVED_AT_DESTINATION: 'Tiba di Tujuan',
  DELIVERED: 'Terkirim',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const NEXT_STATUS: Partial<Record<ShipmentStatus, ShipmentStatus>> = {
  ASSIGNED: 'ACCEPTED',
  ACCEPTED: 'ON_THE_WAY_TO_PICKUP',
  ON_THE_WAY_TO_PICKUP: 'ARRIVED_AT_PICKUP',
  ARRIVED_AT_PICKUP: 'PICKED_UP',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'ARRIVED_AT_DESTINATION',
  ARRIVED_AT_DESTINATION: 'DELIVERED',
  DELIVERED: 'COMPLETED',
};

export const NEXT_ACTION_LABEL: Partial<Record<ShipmentStatus, string>> = {
  ASSIGNED: 'Terima Job',
  ACCEPTED: 'Mulai Menuju Pickup',
  ON_THE_WAY_TO_PICKUP: 'Tiba di Lokasi Pickup',
  ARRIVED_AT_PICKUP: 'Barang Sudah Diambil',
  PICKED_UP: 'Mulai Perjalanan',
  IN_TRANSIT: 'Tiba di Tujuan',
  ARRIVED_AT_DESTINATION: 'Konfirmasi Pengiriman',
  DELIVERED: 'Tandai Selesai',
};

export interface StatusLog {
  status: ShipmentStatus;
  timestamp: string;
  note?: string;
}

export interface Job {
  id: string;
  jobNumber: string;
  customerName: string;
  pickupAddress: string;
  deliveryAddress: string;
  cargoDescription: string;
  vehicleType: string;
  truckPlate: string;
  driverName: string;
  pickupDateTime: string;
  deliveryDateTime: string;
  specialInstruction?: string;
  status: ShipmentStatus;
  photos: string[];
  statusLogs: StatusLog[];
  podSigned?: boolean;
  receiverName?: string;
  receiverPosition?: string;
  deliveryNotes?: string;
  podPhotos?: string[];
  weight?: string;
  distance?: string;
}

export interface PODPayload {
  receiverName: string;
  receiverPosition?: string;
  deliveryNotes?: string;
  podPhotos?: string[];
  signatureDataUrl?: string;
  submittedAt?: string;
  geoLocation?: { lat: number; lng: number; deviceTimestamp?: string };
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  licenseNumber: string;
  truckPlate: string;
  vehicleType: string;
  totalDeliveries: number;
  rating: number;
}
