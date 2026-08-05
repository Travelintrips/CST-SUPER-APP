import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useJobs } from '@/context/JobsContext';
import { StatusBadge } from '@/components/StatusBadge';
import { StepIndicator } from '@/components/StepIndicator';
import { NEXT_ACTION_LABEL, NEXT_STATUS } from '@/types';
import { Icon, FeatherName } from '@/components/Icon';

function InfoRow({ icon, label, value }: { icon: FeatherName; label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon name={icon} size={15} color="#0F3460" />
      </View>
      <View style={styles.infoContent}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('id-ID', {
    weekday: 'short', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getJob, rejectJob } = useJobs();
  const job = getJob(id);

  if (!job) {
    return (
      <View style={[styles.notFound, { backgroundColor: colors.background }]}>
        <Icon name="alert-circle" size={40} color={colors.mutedForeground} />
        <Text style={[styles.notFoundText, { color: colors.foreground }]}>Job tidak ditemukan</Text>
      </View>
    );
  }

  const currentJob = job;
  const nextStatus = NEXT_STATUS[currentJob.status];
  const actionLabel = NEXT_ACTION_LABEL[currentJob.status];
  const isCompleted = currentJob.status === 'COMPLETED' || currentJob.status === 'CANCELLED';
  const isPODStep = currentJob.status === 'ARRIVED_AT_DESTINATION';

  async function handleAction() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isPODStep) {
      router.push({ pathname: '/job/pod', params: { jobId: currentJob.id } });
    } else if (nextStatus) {
      router.push({ pathname: '/job/update', params: { jobId: currentJob.id, nextStatus } });
    }
  }

  async function handleReject() {
    Alert.alert('Tolak Job', 'Yakin ingin menolak job ini?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Tolak',
        style: 'destructive',
        onPress: async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await rejectJob(currentJob.id);
          router.back();
        },
      },
    ]);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 120 : insets.bottom + 120 }}
      >
        {/* Status + Step */}
        <View style={[styles.statusSection, { backgroundColor: colors.card }]}>
          <View style={styles.statusHeader}>
            <View>
              <Text style={[styles.jobNumber, { color: '#0F3460' }]}>{job.jobNumber}</Text>
              <Text style={[styles.customerName, { color: colors.foreground }]}>{job.customerName}</Text>
            </View>
            <StatusBadge status={job.status} />
          </View>
          <StepIndicator currentStatus={job.status} />
        </View>

        {/* Route */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Rute Pengiriman</Text>
          <View style={styles.routeContainer}>
            <View style={styles.routeLeft}>
              <View style={[styles.routeDot, { backgroundColor: '#0EA5E9' }]} />
              <View style={[styles.routeVertLine, { backgroundColor: colors.border }]} />
              <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
            </View>
            <View style={styles.routeRight}>
              <View style={styles.routeStop}>
                <Text style={[styles.routeStopLabel, { color: colors.mutedForeground }]}>PICKUP</Text>
                <Text style={[styles.routeStopAddr, { color: colors.foreground }]}>{job.pickupAddress}</Text>
                <Text style={[styles.routeStopTime, { color: colors.mutedForeground }]}>{formatDateTime(job.pickupDateTime)}</Text>
              </View>
              <View style={styles.routeStop}>
                <Text style={[styles.routeStopLabel, { color: colors.mutedForeground }]}>TUJUAN</Text>
                <Text style={[styles.routeStopAddr, { color: colors.foreground }]}>{job.deliveryAddress}</Text>
                <Text style={[styles.routeStopTime, { color: colors.mutedForeground }]}>{formatDateTime(job.deliveryDateTime)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Cargo info */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Info Kargo</Text>
          <InfoRow icon="package" label="Deskripsi" value={job.cargoDescription} />
          <InfoRow icon="truck" label="Kendaraan" value={`${job.vehicleType} — ${job.truckPlate}`} />
          {job.weight && <InfoRow icon="layers" label="Berat" value={job.weight} />}
          {job.distance && <InfoRow icon="map" label="Jarak" value={job.distance} />}
          {job.specialInstruction && (
            <InfoRow icon="alert-triangle" label="Instruksi Khusus" value={job.specialInstruction} />
          )}
        </View>

        {/* Photos quick access */}
        <TouchableOpacity
          style={[styles.card, styles.photoBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
          onPress={() => router.push({ pathname: '/job/photos', params: { jobId: job.id } })}
        >
          <Icon name="camera" size={20} color="#0F3460" />
          <View style={styles.photoBtnText}>
            <Text style={styles.photoBtnTitle}>Foto Bukti</Text>
            <Text style={styles.photoBtnSub}>{job.photos.length} foto tersimpan</Text>
          </View>
          <Icon name="chevron-right" size={18} color="#0F3460" />
        </TouchableOpacity>

        {/* Status logs */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Riwayat Status</Text>
          {job.statusLogs.slice().reverse().map((log, idx) => (
            <View key={idx} style={styles.logItem}>
              <View style={[styles.logDot, { backgroundColor: idx === 0 ? '#0F3460' : colors.border }]} />
              <View style={styles.logContent}>
                <Text style={[styles.logStatus, { color: idx === 0 ? '#0F3460' : colors.mutedForeground }]}>
                  {log.status.replace(/_/g, ' ')}
                </Text>
                <Text style={[styles.logTime, { color: colors.mutedForeground }]}>
                  {new Date(log.timestamp).toLocaleString('id-ID')}
                </Text>
                {log.note && <Text style={[styles.logNote, { color: colors.mutedForeground }]}>{log.note}</Text>}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Action Button */}
      {!isCompleted && (
        <View style={[styles.actionBar, { paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 8 }]}>
          {job.status === 'ASSIGNED' && (
            <TouchableOpacity style={styles.rejectBtn} onPress={handleReject}>
              <Icon name="x" size={18} color="#EF4444" />
              <Text style={styles.rejectText}>Tolak</Text>
            </TouchableOpacity>
          )}
          {actionLabel && (
            <TouchableOpacity style={styles.actionBtn} onPress={handleAction} activeOpacity={0.85}>
              <Text style={styles.actionBtnText}>{actionLabel}</Text>
              <Icon name="arrow-right" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {job.status === 'COMPLETED' && (
        <View style={[styles.completedBar, { paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 8 }]}>
          <Icon name="check-circle" size={20} color="#10B981" />
          <Text style={styles.completedBarText}>Job Selesai</Text>
          {job.receiverName && <Text style={styles.completedReceiver}>Penerima: {job.receiverName}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  notFoundText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  statusSection: { padding: 16, gap: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  jobNumber: { fontSize: 13, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  customerName: { fontSize: 18, fontFamily: 'Inter_700Bold', maxWidth: '70%' },
  card: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 16,
    borderWidth: 1, padding: 16, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 0.5, textTransform: 'uppercase' },
  routeContainer: { flexDirection: 'row', gap: 12 },
  routeLeft: { alignItems: 'center', paddingTop: 4 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeVertLine: { width: 2, flex: 1, marginVertical: 4 },
  routeRight: { flex: 1, gap: 16 },
  routeStop: { gap: 2 },
  routeStopLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  routeStopAddr: { fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 20 },
  routeStopTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  infoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, textTransform: 'uppercase' },
  infoValue: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 20 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  photoBtnText: { flex: 1 },
  photoBtnTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0F3460' },
  photoBtnSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#475569' },
  logItem: { flexDirection: 'row', gap: 12 },
  logDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  logContent: { flex: 1 },
  logStatus: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  logTime: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  logNote: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, fontStyle: 'italic' },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0',
    padding: 16, flexDirection: 'row', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 8,
  },
  rejectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: '#EF4444', borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rejectText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },
  actionBtn: {
    flex: 1, backgroundColor: '#0F3460', borderRadius: 16, height: 54,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: '#0F3460', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  actionBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  completedBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#F0FDF4', borderTopWidth: 1, borderTopColor: '#A7F3D0',
    padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  completedBarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#065F46', flex: 1 },
  completedReceiver: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#047857' },
});
