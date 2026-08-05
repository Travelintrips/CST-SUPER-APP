import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useColors } from '@/hooks/useColors';
import { useJobs } from '@/context/JobsContext';
import { StatusBadge } from '@/components/StatusBadge';
import { ShipmentStatus, STATUS_LABELS, NEXT_ACTION_LABEL } from '@/types';
import { Icon } from '@/components/Icon';

export default function UpdateStatusScreen() {
  const { jobId, nextStatus } = useLocalSearchParams<{ jobId: string; nextStatus: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getJob, updateJobStatus } = useJobs();
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const job = getJob(jobId);
  const status = nextStatus as ShipmentStatus;

  if (!job) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  async function captureGeo(): Promise<{ lat: number; lng: number; deviceTimestamp: string } | undefined> {
    if (Platform.OS === 'web') return undefined;
    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        Alert.alert('Izin Lokasi', 'Izin GPS tidak diberikan. Status diupdate tanpa lokasi.');
        return undefined;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: loc.coords.latitude, lng: loc.coords.longitude, deviceTimestamp: new Date().toISOString() };
    } catch {
      return undefined;
    }
  }

  async function handleConfirm() {
    setLoading(true);
    try {
      const geoLocation = await captureGeo();
      await updateJobStatus(jobId, status, note.trim() || undefined, geoLocation);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert('Gagal', 'Tidak dapat mengupdate status. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Status update card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.arrow}>
            <View style={styles.statusFrom}>
              <Text style={[styles.fromLabel, { color: colors.mutedForeground }]}>Status Saat Ini</Text>
              <StatusBadge status={job.status} />
            </View>
            <Icon name="arrow-right" size={22} color="#0EA5E9" />
            <View style={styles.statusTo}>
              <Text style={[styles.fromLabel, { color: colors.mutedForeground }]}>Status Baru</Text>
              <StatusBadge status={status} />
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.jobInfo, { color: colors.mutedForeground }]}>
            {job.jobNumber} — {job.customerName}
          </Text>
        </View>

        {/* Note */}
        <View style={[styles.noteSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.noteLabel, { color: colors.foreground }]}>Catatan (opsional)</Text>
          <TextInput
            style={[styles.noteInput, { borderColor: colors.border, color: colors.foreground }]}
            placeholder="Tambahkan catatan..."
            placeholderTextColor={colors.mutedForeground}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>
      </View>

      {/* Action buttons */}
      <View style={[styles.actions, { paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 8 }]}>
        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: colors.border }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.cancelText, { color: colors.foreground }]}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, loading && { opacity: 0.7 }]}
          onPress={handleConfirm}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name="check" size={18} color="#fff" />
              <Text style={styles.confirmText}>Konfirmasi</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, padding: 16, gap: 12 },
  card: {
    borderRadius: 16, borderWidth: 1, padding: 20, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  arrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusFrom: { alignItems: 'flex-start', gap: 8, flex: 1 },
  statusTo: { alignItems: 'flex-end', gap: 8, flex: 1 },
  fromLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, textTransform: 'uppercase' },
  divider: { height: 1 },
  jobInfo: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  noteSection: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  noteLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  noteInput: {
    borderWidth: 1.5, borderRadius: 12, padding: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', minHeight: 80,
  },
  actions: {
    flexDirection: 'row', gap: 10, padding: 16,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0',
  },
  cancelBtn: {
    flex: 1, height: 54, borderRadius: 16, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  confirmBtn: {
    flex: 2, height: 54, borderRadius: 16, backgroundColor: '#0F3460',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#0F3460', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  confirmText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});
