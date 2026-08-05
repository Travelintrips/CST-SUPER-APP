import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, PanResponder,
  GestureResponderEvent, ScrollView, Image, LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useColors } from '@/hooks/useColors';
import { useJobs } from '@/context/JobsContext';
import { useAuth } from '@/context/AuthContext';
import { Icon } from '@/components/Icon';
import { api } from '@/services/api';
import { PODPayload } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert sigPoints to a single SVG 'd' attribute string */
function buildSvgPath(points: Array<{ x: number; y: number; newLine: boolean }>): string {
  let d = '';
  for (const pt of points) {
    if (pt.newLine) {
      d += `M${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    } else {
      d += ` L${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }
  }
  return d;
}

/**
 * Convert sigPoints to a base64 SVG data URL.
 * Returns '' when there are no points.
 */
function captureSignatureDataUrl(
  points: Array<{ x: number; y: number; newLine: boolean }>,
  width: number,
  height: number,
): string {
  if (points.length < 2) return '';
  const d = buildSvgPath(points);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="white"/>` +
    `<path d="${d}" stroke="#0F3460" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  // btoa is available in Hermes / React-Native runtime
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PODScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getJob, submitPOD } = useJobs();
  const { token } = useAuth();

  const [receiverName, setReceiverName] = useState('');
  const [receiverPosition, setReceiverPosition] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [localPhotos, setLocalPhotos] = useState<string[]>([]);
  const [isSigned, setIsSigned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sigPoints, setSigPoints] = useState<Array<{ x: number; y: number; newLine: boolean }>>([]);
  // Track canvas dimensions for accurate SVG export
  const [sigLayout, setSigLayout] = useState({ width: 340, height: 160 });

  const job = getJob(jobId);
  if (!job) return null;

  function handleSigLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setSigLayout({ width, height });
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        setSigPoints((prev) => [...prev, { x: locationX, y: locationY, newLine: true }]);
        setIsSigned(true);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        setSigPoints((prev) => [...prev, { x: locationX, y: locationY, newLine: false }]);
      },
    })
  ).current;

  function clearSignature() {
    setSigPoints([]);
    setIsSigned(false);
  }

  async function pickPhoto() {
    if (localPhotos.length >= 5) {
      Alert.alert('Batas Foto', 'Maksimal 5 foto POD');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam.granted) {
        Alert.alert('Izin Kamera', 'Izinkan akses kamera/galeri untuk foto POD');
        return;
      }
    }
    Alert.alert('Tambah Foto POD', 'Pilih sumber foto', [
      {
        text: 'Kamera', onPress: async () => {
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsEditing: false,
          });
          if (!result.canceled && result.assets[0]) {
            setLocalPhotos((prev) => [...prev, result.assets[0].uri]);
          }
        },
      },
      {
        text: 'Galeri', onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsEditing: false,
          });
          if (!result.canceled && result.assets[0]) {
            setLocalPhotos((prev) => [...prev, result.assets[0].uri]);
          }
        },
      },
      { text: 'Batal', style: 'cancel' },
    ]);
  }

  function removePhoto(uri: string) {
    setLocalPhotos((prev) => prev.filter((u) => u !== uri));
  }

  async function getGeoLocation(): Promise<{ lat: number; lng: number; deviceTimestamp: string } | undefined> {
    if (Platform.OS === 'web') return undefined;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return undefined;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        deviceTimestamp: new Date().toISOString(),
      };
    } catch {
      return undefined;
    }
  }

  async function doSubmit(signatureDataUrl?: string) {
    setLoading(true);
    try {
      // Upload POD photos first (fail gracefully per photo)
      const uploadedUrls: string[] = [];
      if (localPhotos.length > 0 && token) {
        for (const uri of localPhotos) {
          try {
            const { fileUrl } = await api.uploadPODPhoto(token, jobId, uri);
            uploadedUrls.push(fileUrl);
          } catch {
            // skip failed photos, still submit with those that succeeded
          }
        }
      }

      // Capture geo location
      const geoLocation = await getGeoLocation();

      const payload: PODPayload = {
        receiverName: receiverName.trim(),
        receiverPosition: receiverPosition.trim() || undefined,
        deliveryNotes: deliveryNotes.trim() || undefined,
        podPhotos: uploadedUrls.length > 0 ? uploadedUrls : undefined,
        signatureDataUrl: signatureDataUrl || undefined,
        submittedAt: new Date().toISOString(),
        geoLocation,
      };

      await submitPOD(jobId, payload);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Berhasil!',
        `Bukti pengiriman berhasil disimpan${uploadedUrls.length > 0 ? ` (${uploadedUrls.length} foto)` : ''}`,
        [{ text: 'OK', onPress: () => router.replace('/(tabs)') }]
      );
    } catch {
      Alert.alert('Gagal', 'Tidak dapat menyimpan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!receiverName.trim()) {
      Alert.alert('Perhatian', 'Masukkan nama penerima');
      return;
    }

    // Capture signature from points
    const signatureDataUrl = isSigned
      ? captureSignatureDataUrl(sigPoints, sigLayout.width, sigLayout.height)
      : '';

    // Validate: signature is required but allow override with confirmation
    if (!isSigned || !signatureDataUrl) {
      Alert.alert(
        'Tanda Tangan Kosong',
        'Penerima belum menandatangani dokumen. Lanjutkan tanpa tanda tangan?',
        [
          { text: 'Batal', style: 'cancel' },
          {
            text: 'Lanjutkan Tanpa TTD',
            style: 'destructive',
            onPress: () => doSubmit(undefined),
          },
        ]
      );
      return;
    }

    await doSubmit(signatureDataUrl);
  }

  // Build single SVG path string for rendering
  const svgPathD = buildSvgPath(sigPoints);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Job Summary */}
        <View style={[styles.summaryCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
          <Icon name="package" size={18} color="#0F3460" />
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryJob}>{job.jobNumber}</Text>
            <Text style={styles.summaryCustomer}>{job.customerName}</Text>
            <Text style={styles.summaryAddr} numberOfLines={1}>{job.deliveryAddress}</Text>
            {job.cargoDescription ? (
              <Text style={styles.summaryCargo} numberOfLines={1}>📦 {job.cargoDescription}</Text>
            ) : null}
          </View>
        </View>

        {/* Driver Info (readonly) */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Info Driver</Text>
          <View style={styles.infoRow}>
            <Icon name="user" size={14} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>{job.driverName || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="truck" size={14} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              {job.truckPlate || '-'}{job.vehicleType ? `  ·  ${job.vehicleType}` : ''}
            </Text>
          </View>
        </View>

        {/* Delivery Info */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Data Penerima</Text>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Nama Penerima *</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
              placeholder="Nama lengkap penerima"
              placeholderTextColor={colors.mutedForeground}
              value={receiverName}
              onChangeText={setReceiverName}
              returnKeyType="next"
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Jabatan / Posisi</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
              placeholder="cth: Supervisor Gudang, Security, dll"
              placeholderTextColor={colors.mutedForeground}
              value={receiverPosition}
              onChangeText={setReceiverPosition}
              returnKeyType="next"
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Catatan Pengiriman</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
              placeholder="Kondisi barang, kendala pengiriman, dll"
              placeholderTextColor={colors.mutedForeground}
              value={deliveryNotes}
              onChangeText={setDeliveryNotes}
              multiline
              numberOfLines={3}
              returnKeyType="done"
              textAlignVertical="top"
            />
          </View>
        </View>

        {/* POD Photos */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Foto POD</Text>
            <Text style={[styles.photoCount, { color: colors.mutedForeground }]}>{localPhotos.length}/5</Text>
          </View>

          {localPhotos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
              {localPhotos.map((uri, idx) => (
                <View key={idx} style={styles.photoThumbWrap}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                  <TouchableOpacity
                    style={styles.photoRemoveBtn}
                    onPress={() => removePhoto(uri)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={[styles.addPhotoBtn, { borderColor: colors.border }]}
            onPress={pickPhoto}
            activeOpacity={0.75}
            disabled={localPhotos.length >= 5}
          >
            <Icon name="camera" size={18} color={localPhotos.length >= 5 ? colors.mutedForeground : '#0F3460'} />
            <Text style={[styles.addPhotoText, { color: localPhotos.length >= 5 ? colors.mutedForeground : '#0F3460' }]}>
              {localPhotos.length === 0 ? 'Tambah Foto POD' : 'Tambah Foto Lagi'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Signature Pad — rendered with react-native-svg for accurate capture */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sigHeader}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Tanda Tangan Penerima *</Text>
            {isSigned && (
              <TouchableOpacity onPress={clearSignature} style={styles.clearBtn}>
                <Icon name="trash-2" size={14} color="#EF4444" />
                <Text style={styles.clearText}>Hapus</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Canvas — touch handler wraps SVG layer */}
          <View
            style={[
              styles.sigPad,
              { borderColor: isSigned ? '#0F3460' : colors.border, backgroundColor: '#FFFFFF' },
            ]}
            onLayout={handleSigLayout}
            {...panResponder.panHandlers}
          >
            {/* Placeholder shown before any stroke */}
            {!isSigned && (
              <View style={styles.sigPlaceholder} pointerEvents="none">
                <Icon name="edit-3" size={24} color={colors.mutedForeground} />
                <Text style={[styles.sigPlaceholderText, { color: colors.mutedForeground }]}>
                  Tanda tangan di sini
                </Text>
              </View>
            )}

            {/* SVG stroke rendering — accurate & capturable */}
            {isSigned && svgPathD ? (
              <Svg
                width={sigLayout.width}
                height={sigLayout.height}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              >
                <Path
                  d={svgPathD}
                  stroke="#0F3460"
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
          </View>

          <Text style={[styles.sigHint, { color: colors.mutedForeground }]}>
            Tanda tangan akan disimpan bersama data POD
          </Text>
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Confirm button */}
      <View style={[styles.footer, { paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 8, borderTopColor: colors.border }]}>
        {loading && (
          <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
            {localPhotos.length > 0 ? 'Mengunggah foto & menyimpan data...' : 'Menyimpan data...'}
          </Text>
        )}
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
              <Icon name="check-circle" size={20} color="#fff" />
              <Text style={styles.confirmText}>Konfirmasi Pengiriman</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  summaryCard: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  summaryJob: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#0F3460', marginBottom: 2 },
  summaryCustomer: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#0F172A' },
  summaryAddr: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#64748B', marginTop: 2 },
  summaryCargo: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#64748B', marginTop: 2 },
  card: {
    borderRadius: 14, borderWidth: 1, padding: 14, gap: 10,
  },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  photoCount: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  input: {
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', height: 48,
  },
  inputMultiline: {
    height: 80, paddingTop: 12,
  },
  photoRow: { marginBottom: 4 },
  photoThumbWrap: { position: 'relative', marginRight: 8 },
  photoThumb: { width: 72, height: 72, borderRadius: 10 },
  photoRemoveBtn: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10,
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
  },
  addPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1.5, borderRadius: 12, borderStyle: 'dashed',
    paddingVertical: 12,
  },
  addPhotoText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  sigHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearText: { fontSize: 12, color: '#EF4444', fontFamily: 'Inter_600SemiBold' },
  sigPad: {
    height: 160, borderWidth: 2, borderRadius: 14, borderStyle: 'dashed',
    overflow: 'hidden', position: 'relative',
  },
  sigPlaceholder: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 8 },
  sigPlaceholderText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  sigHint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: -4 },
  footer: {
    backgroundColor: 'transparent', borderTopWidth: 1, padding: 16, gap: 8,
  },
  uploadHint: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  confirmBtn: {
    backgroundColor: '#059669', borderRadius: 16, height: 56,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: '#059669', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  confirmText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },
});
