import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Platform, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useJobs } from '@/context/JobsContext';
import { Icon, FeatherName } from '@/components/Icon';
import { notifyNewJob, requestNotificationPermission } from '@/services/notifications';

interface MenuItemProps {
  icon: FeatherName;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, value, onPress, danger }: MenuItemProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.menuItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[styles.menuIcon, { backgroundColor: danger ? '#FEE2E2' : '#EFF6FF' }]}>
        <Icon name={icon} size={18} color={danger ? '#EF4444' : '#0F3460'} />
      </View>
      <Text style={[styles.menuLabel, { color: danger ? '#EF4444' : colors.foreground }]}>{label}</Text>
      {value ? (
        <Text style={[styles.menuValue, { color: colors.mutedForeground }]}>{value}</Text>
      ) : onPress ? (
        <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
      ) : null}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { driver, logout } = useAuth();
  const { completedJobs, activeJobs } = useJobs();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  async function handleLogout() {
    Alert.alert('Keluar', 'Yakin ingin keluar dari akun?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Keluar',
        style: 'destructive',
        onPress: async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await logout();
          router.replace('/login');
        },
      },
    ]);
  }

  async function handleOpenNotifSettings() {
    if (Platform.OS === 'android') {
      await Linking.openSettings();
    }
  }

  async function handleTestNotif() {
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert(
        'Izin Notifikasi Ditolak',
        'Buka Setelan Notifikasi dan aktifkan izin notifikasi untuk aplikasi CST Driver.',
        [
          { text: 'Buka Setelan', onPress: handleOpenNotifSettings },
          { text: 'Batal', style: 'cancel' },
        ],
      );
      return;
    }
    notifyNewJob('JOB-TEST-001', 'Pelanggan Demo', 'Jl. Sudirman No. 1, Jakarta');
    Alert.alert('Test Dikirim', 'Notifikasi bunyi & getar sudah dikirim. Cek bar notifikasi HP kamu.');
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>
            {driver?.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.driverName}>{driver?.name}</Text>
        <Text style={styles.driverId}>{driver?.id}</Text>
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Icon
              key={s}
              name="star"
              size={14}
              color={s <= Math.round(driver?.rating ?? 0) ? '#F59E0B' : 'rgba(255,255,255,0.3)'}
            />
          ))}
          <Text style={styles.ratingText}>{driver?.rating.toFixed(1)}</Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={[styles.statBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: '#0F3460' }]}>{driver?.totalDeliveries}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Pengiriman</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: '#10B981' }]}>{completedJobs.length}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Bulan Ini</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: '#0EA5E9' }]}>{activeJobs.length}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Aktif</Text>
        </View>
      </View>

      {/* Info Driver */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Informasi Driver</Text>
        <MenuItem icon="phone" label="Telepon" value={driver?.phone} />
        <MenuItem icon="mail" label="Email" value={driver?.email} />
        <MenuItem icon="credit-card" label="No. SIM" value={driver?.licenseNumber} />
      </View>

      {/* Info Kendaraan */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Kendaraan</Text>
        <MenuItem icon="truck" label="Jenis Kendaraan" value={driver?.vehicleType} />
        <MenuItem icon="hash" label="Plat Nomor" value={driver?.truckPlate} />
      </View>

      {/* Setelan Notifikasi */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Setelan Notifikasi</Text>
        <MenuItem
          icon="bell"
          label="Test Bunyi & Getar"
          onPress={handleTestNotif}
        />
        <MenuItem
          icon="settings"
          label="Setelan Notifikasi HP"
          onPress={handleOpenNotifSettings}
        />
      </View>

      {/* Logout */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem icon="log-out" label="Keluar dari Akun" onPress={handleLogout} danger />
      </View>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>CST Driver v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    backgroundColor: '#0F3460', alignItems: 'center', paddingBottom: 28, gap: 6,
  },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#0EA5E9', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)',
  },
  avatarText: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#fff' },
  driverName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#fff' },
  driverId: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_400Regular' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontSize: 13, color: '#F59E0B', fontFamily: 'Inter_600SemiBold', marginLeft: 4 },
  statsRow: {
    flexDirection: 'row', gap: 10, padding: 16, marginTop: -16,
  },
  statBox: {
    flex: 1, borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  statValue: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 2, textAlign: 'center' },
  section: {
    marginHorizontal: 16, marginBottom: 12, borderRadius: 16,
    overflow: 'hidden', paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, textTransform: 'uppercase', paddingVertical: 14 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1,
  },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium' },
  menuValue: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  version: { textAlign: 'center', fontSize: 12, fontFamily: 'Inter_400Regular', marginVertical: 16 },
});
