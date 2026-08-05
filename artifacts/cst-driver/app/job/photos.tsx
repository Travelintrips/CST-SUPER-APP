import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { useJobs } from '@/context/JobsContext';
import { Icon } from '@/components/Icon';

export default function PhotosScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getJob, addJobPhoto } = useJobs();
  const [uploading, setUploading] = useState(false);

  const job = getJob(jobId);
  if (!job) return null;

  async function pickImage(source: 'camera' | 'library') {
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Izin Diperlukan', 'Izinkan akses kamera untuk mengambil foto');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
      });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: false,
      });
    }

    if (!result.canceled && result.assets[0]) {
      setUploading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await new Promise((r) => setTimeout(r, 600));
      await addJobPhoto(jobId, result.assets[0].uri);
      setUploading(false);
    }
  }

  function handleAddPhoto() {
    if (Platform.OS === 'web') {
      Alert.alert('Info', 'Fitur kamera tersedia di perangkat mobile');
      return;
    }
    Alert.alert('Tambah Foto', 'Pilih sumber foto', [
      { text: 'Kamera', onPress: () => pickImage('camera') },
      { text: 'Galeri', onPress: () => pickImage('library') },
      { text: 'Batal', style: 'cancel' },
    ]);
  }

  function renderPhoto({ item, index }: { item: string; index: number }) {
    return (
      <View style={styles.photoWrapper}>
        <Image source={{ uri: item }} style={styles.photo} resizeMode="cover" />
        <View style={styles.photoIndex}>
          <Text style={styles.photoIndexText}>{index + 1}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={job.photos}
        keyExtractor={(item, idx) => `${item}-${idx}`}
        renderItem={renderPhoto}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[
          styles.grid,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 100 },
        ]}
        ListHeaderComponent={
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>{job.jobNumber}</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {job.photos.length} foto tersimpan
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="camera" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Belum ada foto</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Tambahkan foto bukti pickup, kargo, atau pengiriman
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Add button */}
      <View style={[styles.addBar, { paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 8 }]}>
        <TouchableOpacity
          style={[styles.addBtn, uploading && { opacity: 0.7 }]}
          onPress={handleAddPhoto}
          disabled={uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name="camera" size={20} color="#fff" />
              <Text style={styles.addBtnText}>Tambah Foto</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grid: { padding: 12 },
  row: { gap: 10, marginBottom: 10 },
  headerInfo: { marginBottom: 16 },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  photoWrapper: { flex: 1, borderRadius: 14, overflow: 'hidden', aspectRatio: 1, position: 'relative' },
  photo: { width: '100%', height: '100%' },
  photoIndex: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  photoIndexText: { fontSize: 11, color: '#fff', fontFamily: 'Inter_700Bold' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  emptyDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 30 },
  addBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', padding: 16,
  },
  addBtn: {
    backgroundColor: '#0F3460', borderRadius: 16, height: 54,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: '#0F3460', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  addBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});
