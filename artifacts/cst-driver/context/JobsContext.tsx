import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { api, API_BASE_URL } from '@/services/api';
import { supabase } from '@/services/supabase';
import { useAuth } from './AuthContext';
import { Job, PODPayload, ShipmentStatus } from '@/types';
import { notifyNewJob } from '@/services/notifications';

interface JobsContextType {
  jobs: Job[];
  activeJobs: Job[];
  completedJobs: Job[];
  isLoading: boolean;
  error: string | null;
  pendingNewJob: Job | null;
  clearPendingNewJob: () => void;
  getJob: (id: string) => Job | undefined;
  updateJobStatus: (id: string, status: ShipmentStatus, note?: string, geoLocation?: { lat: number; lng: number; deviceTimestamp?: string }) => Promise<void>;
  addJobPhoto: (id: string, uri: string, type?: string) => Promise<void>;
  submitPOD: (id: string, payload: PODPayload) => Promise<void>;
  rejectJob: (id: string) => Promise<void>;
  refreshJobs: () => Promise<void>;
}

const JobsContext = createContext<JobsContextType>({
  jobs: [],
  activeJobs: [],
  completedJobs: [],
  isLoading: false,
  error: null,
  pendingNewJob: null,
  clearPendingNewJob: () => {},
  getJob: () => undefined,
  updateJobStatus: async () => {},
  addJobPhoto: async () => {},
  submitPOD: async (_id: string, _payload: PODPayload) => {},
  rejectJob: async () => {},
  refreshJobs: async () => {},
});

function toAbsoluteUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${API_BASE_URL}${url}`;
  return url;
}

const LOCATION_INTERVAL_MS = 60_000;
const POLL_INTERVAL_MS = 15_000;

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const { token, driver, isAuthenticated } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNewJob, setPendingNewJob] = useState<Job | null>(null);
  const locationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track both job ID and last known status so we fire notification whenever
  // a job transitions INTO 'ASSIGNED' (new assignment OR re-assignment).
  const knownJobsRef = useRef<Map<string, ShipmentStatus> | null>(null);

  const clearPendingNewJob = useCallback(() => setPendingNewJob(null), []);

  const refreshJobs = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getJobs(token);
      const newJobs = (data as unknown as Record<string, unknown>[]).map(mapApiJob);

      if (knownJobsRef.current === null) {
        // First load — seed the map, no notifications
        knownJobsRef.current = new Map(newJobs.map((j) => [j.id, j.status]));
      } else {
        for (const job of newJobs) {
          const prevStatus = knownJobsRef.current.get(job.id);
          // Notify when: new job that is ASSIGNED, OR existing job whose
          // status just changed TO ASSIGNED (re-assignment after cancellation)
          if (
            job.status === 'ASSIGNED' &&
            prevStatus !== 'ASSIGNED'
          ) {
            notifyNewJob(job.jobNumber, job.customerName, job.pickupAddress);
            setPendingNewJob(job);
          }
        }
        knownJobsRef.current = new Map(newJobs.map((j) => [j.id, j.status]));
      }

      setJobs(newJobs);
    } catch {
      setError('Gagal memuat data pekerjaan');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Polling fallback — runs every 60s as backstop
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    refreshJobs();
    const pollInterval = setInterval(refreshJobs, POLL_INTERVAL_MS);
    return () => clearInterval(pollInterval);
  }, [isAuthenticated, token, refreshJobs]);

  // Supabase Realtime — subscribe to driver_jobs changes for this driver (optional, only when configured)
  useEffect(() => {
    if (!isAuthenticated || !driver || !supabase) return;
    const driverIdNum = parseInt(driver.id, 10);
    if (isNaN(driverIdNum)) return;

    const channel = supabase
      .channel(`driver-jobs-${driverIdNum}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_jobs' },
        (payload) => {
          const record = (payload.new ?? payload.old) as Record<string, unknown>;
          const oldRecord = (payload.old ?? {}) as Record<string, unknown>;
          if (Number(record?.driver_id) === driverIdNum) {
            refreshJobs();
            // Fire notification on INSERT or UPDATE that transitions status to ASSIGNED
            const isNowAssigned = record.status === 'ASSIGNED';
            const wasAssigned = oldRecord.status === 'ASSIGNED';
            if (
              isNowAssigned && !wasAssigned &&
              record.job_number
            ) {
              notifyNewJob(
                String(record.job_number),
                String(record.customer_name ?? ''),
                String(record.pickup_address ?? ''),
              );
              // Banner will be populated after refreshJobs resolves
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [isAuthenticated, driver, refreshJobs]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      if (locationTimerRef.current) {
        clearInterval(locationTimerRef.current);
        locationTimerRef.current = null;
      }
      return;
    }

    async function startLocationTracking() {
      if (Platform.OS === 'web') return;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        async function postLocation() {
          if (!token) return;
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            await api.updateLocation(token, loc.coords.latitude, loc.coords.longitude);
          } catch {
          }
        }

        await postLocation();
        locationTimerRef.current = setInterval(postLocation, LOCATION_INTERVAL_MS);
      } catch {
      }
    }

    startLocationTracking();

    return () => {
      if (locationTimerRef.current) {
        clearInterval(locationTimerRef.current);
        locationTimerRef.current = null;
      }
    };
  }, [isAuthenticated, token]);

  async function updateJobStatus(id: string, status: ShipmentStatus, note?: string, geoLocation?: { lat: number; lng: number; deviceTimestamp?: string }) {
    if (!token) return;
    const updated = await api.updateStatus(token, id, status, note, geoLocation);
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? mergeJobUpdate(j, updated as Record<string, unknown>) : j))
    );
  }

  async function addJobPhoto(id: string, uri: string, type = 'general') {
    if (!token) return;
    const photo = await api.uploadPhoto(token, id, uri, type);
    const photoUrl = toAbsoluteUrl((photo as Record<string, string>).url ?? uri);
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id
          ? { ...j, photos: [...j.photos, photoUrl] }
          : j
      )
    );
  }

  async function submitPOD(id: string, payload: PODPayload) {
    if (!token) return;
    const updated = await api.submitPOD(token, id, payload);
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? mergeJobUpdate(j, updated as Record<string, unknown>) : j))
    );
  }

  async function rejectJob(id: string) {
    if (!token) return;
    await updateJobStatus(id, 'CANCELLED', 'Ditolak oleh driver');
  }

  const activeJobs = jobs.filter(
    (j) => j.status !== 'COMPLETED' && j.status !== 'CANCELLED'
  );
  const completedJobs = jobs.filter((j) => j.status === 'COMPLETED');

  return (
    <JobsContext.Provider
      value={{
        jobs,
        activeJobs,
        completedJobs,
        isLoading,
        error,
        pendingNewJob,
        clearPendingNewJob,
        getJob: (id) => jobs.find((j) => j.id === id),
        updateJobStatus,
        addJobPhoto,
        submitPOD,
        rejectJob,
        refreshJobs,
      }}
    >
      {children}
    </JobsContext.Provider>
  );
}

function mapApiJob(d: Record<string, unknown>): Job {
  const logs = (d.statusLogs as Record<string, unknown>[] | undefined) ?? [];
  const photos = (d.photos as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(d.id ?? ''),
    jobNumber: String(d.jobNumber ?? ''),
    customerName: String(d.customerName ?? ''),
    pickupAddress: String(d.pickupAddress ?? ''),
    deliveryAddress: String(d.deliveryAddress ?? ''),
    cargoDescription: String(d.cargoDescription ?? ''),
    vehicleType: String(d.vehicleType ?? ''),
    truckPlate: String(d.truckPlate ?? ''),
    driverName: '',
    pickupDateTime: String(d.pickupDateTime ?? ''),
    deliveryDateTime: String(d.deliveryDateTime ?? ''),
    specialInstruction: d.specialInstruction ? String(d.specialInstruction) : undefined,
    status: String(d.status ?? 'ASSIGNED') as ShipmentStatus,
    photos: photos.map((p) => toAbsoluteUrl(String((p as Record<string, unknown>).url ?? ''))),
    statusLogs: logs.map((l) => ({
      status: String((l as Record<string, unknown>).status ?? '') as ShipmentStatus,
      timestamp: String((l as Record<string, unknown>).timestamp ?? ''),
      note: (l as Record<string, unknown>).note ? String((l as Record<string, unknown>).note) : undefined,
    })),
    podSigned: !!d.podReceiverName,
    receiverName: d.podReceiverName ? String(d.podReceiverName) : undefined,
    receiverPosition: d.podReceiverPosition ? String(d.podReceiverPosition) : undefined,
    deliveryNotes: d.podNotes ? String(d.podNotes) : undefined,
    podPhotos: (() => {
      try {
        if (d.podPhotos && typeof d.podPhotos === 'string') return JSON.parse(d.podPhotos) as string[];
        if (Array.isArray(d.podPhotos)) return d.podPhotos.map(String);
      } catch { /* ignore */ }
      return undefined;
    })(),
    weight: d.weight ? String(d.weight) : undefined,
    distance: d.distance ? String(d.distance) : undefined,
  };
}

function mergeJobUpdate(existing: Job, updated: Record<string, unknown>): Job {
  return {
    ...existing,
    status: String(updated.status ?? existing.status) as ShipmentStatus,
    podSigned: !!updated.podReceiverName || existing.podSigned,
    receiverName: updated.podReceiverName ? String(updated.podReceiverName) : existing.receiverName,
    receiverPosition: updated.podReceiverPosition ? String(updated.podReceiverPosition) : existing.receiverPosition,
    deliveryNotes: updated.podNotes ? String(updated.podNotes) : existing.deliveryNotes,
    statusLogs: [
      ...existing.statusLogs,
      ...(updated.status && updated.status !== existing.status
        ? [{ status: String(updated.status) as ShipmentStatus, timestamp: new Date().toISOString() }]
        : []),
    ],
  };
}

export const useJobs = () => useContext(JobsContext);
