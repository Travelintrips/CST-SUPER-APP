import { Job, PODPayload, ShipmentStatus } from '@/types';

export const API_BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : process.env.EXPO_PUBLIC_API_URL ?? 'https://cst-adm.replit.app';

const BASE_URL = `${API_BASE_URL}/api`;

export const api = {
  async login(email: string, password: string) {
    const res = await fetch(`${BASE_URL}/driver/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(String(err.message ?? 'Login gagal'));
    }
    return res.json();
  },

  async getMe(token: string) {
    const res = await fetch(`${BASE_URL}/driver/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Session tidak valid');
    return res.json();
  },

  async getJobs(token: string): Promise<Job[]> {
    const res = await fetch(`${BASE_URL}/driver/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Gagal memuat daftar pekerjaan');
    return res.json();
  },

  async updateStatus(token: string, jobId: string, status: ShipmentStatus, note?: string, geoLocation?: { lat: number; lng: number; deviceTimestamp?: string }) {
    const res = await fetch(`${BASE_URL}/driver/jobs/${jobId}/status`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status, note, geoLocation }),
    });
    if (!res.ok) throw new Error('Gagal update status');
    return res.json();
  },

  async uploadPhoto(token: string, jobId: string, uri: string, type: string) {
    const formData = new FormData();
    formData.append('photo', { uri, type: 'image/jpeg', name: `${type}_${Date.now()}.jpg` } as unknown as Blob);
    formData.append('type', type);
    const res = await fetch(`${BASE_URL}/driver/jobs/${jobId}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error('Gagal unggah foto');
    return res.json();
  },

  async uploadPODPhoto(token: string, jobId: string, uri: string): Promise<{ fileUrl: string; filename: string }> {
    const formData = new FormData();
    formData.append('photo', { uri, type: 'image/jpeg', name: `pod_${Date.now()}.jpg` } as unknown as Blob);
    const res = await fetch(`${BASE_URL}/driver/jobs/${jobId}/pod/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error('Gagal unggah foto POD');
    return res.json();
  },

  async submitPOD(token: string, jobId: string, payload: PODPayload) {
    const res = await fetch(`${BASE_URL}/driver/jobs/${jobId}/pod`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Gagal submit POD');
    return res.json();
  },

  async updateLocation(token: string, lat: number, lng: number) {
    await fetch(`${BASE_URL}/driver/location`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lat, lng }),
    }).catch(() => {});
  },
};
