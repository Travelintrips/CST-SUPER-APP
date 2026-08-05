import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useJobs } from '@/context/JobsContext';
import { JobCard } from '@/components/JobCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { driver } = useAuth();
  const { activeJobs, completedJobs } = useJobs();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const inTransitJob = activeJobs.find((j) => j.status === 'IN_TRANSIT' || j.status === 'ON_THE_WAY_TO_PICKUP' || j.status === 'ARRIVED_AT_PICKUP' || j.status === 'PICKED_UP' || j.status === 'ARRIVED_AT_DESTINATION');
  const assignedJobs = activeJobs.filter((j) => j.status === 'ASSIGNED' || j.status === 'ACCEPTED');

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View>
          <Text style={styles.greeting}>Selamat datang,</Text>
          <Text style={styles.driverName}>{driver?.name ?? 'Driver'}</Text>
          <View style={styles.truckBadge}>
            <Icon name="truck" size={12} color="#0EA5E9" />
            <Text style={styles.truckText}>{driver?.truckPlate}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.notifBtn}>
          <Icon name="bell" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: '#fff' }]}>
          <Text style={[styles.statValue, { color: '#0F3460' }]}>{activeJobs.length}</Text>
          <Text style={styles.statLabel}>Aktif</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fff' }]}>
          <Text style={[styles.statValue, { color: '#10B981' }]}>{completedJobs.length}</Text>
          <Text style={styles.statLabel}>Selesai</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fff' }]}>
          <Text style={[styles.statValue, { color: '#F59E0B' }]}>{driver?.rating.toFixed(1)}</Text>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fff' }]}>
          <Text style={[styles.statValue, { color: '#0EA5E9' }]}>{driver?.totalDeliveries}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>

      {/* Active job in progress */}
      {inTransitJob && (
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Icon name="navigation" size={14} color="#0EA5E9" />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sedang Berjalan</Text>
          </View>
          <TouchableOpacity
            style={styles.activeJobCard}
            onPress={() => router.push({ pathname: '/job/[id]', params: { id: inTransitJob.id } })}
            activeOpacity={0.9}
          >
            <View style={styles.activeJobHeader}>
              <Text style={styles.activeJobNumber}>{inTransitJob.jobNumber}</Text>
              <StatusBadge status={inTransitJob.status} />
            </View>
            <Text style={styles.activeJobCustomer}>{inTransitJob.customerName}</Text>
            <View style={styles.activeJobRoute}>
              <View style={styles.routeItem}>
                <Icon name="circle" size={10} color="#0EA5E9" />
                <Text style={styles.routeText} numberOfLines={1}>{inTransitJob.pickupAddress.split(',').slice(0, 2).join(',')}</Text>
              </View>
              <View style={styles.routeDash} />
              <View style={styles.routeItem}>
                <Icon name="map-pin" size={10} color="#10B981" />
                <Text style={styles.routeText} numberOfLines={1}>{inTransitJob.deliveryAddress.split(',').slice(0, 2).join(',')}</Text>
              </View>
            </View>
            <View style={styles.activeJobFooter}>
              {inTransitJob.distance && <Text style={styles.activeJobMeta}>{inTransitJob.distance}</Text>}
              {inTransitJob.weight && <Text style={styles.activeJobMeta}>{inTransitJob.weight}</Text>}
              <View style={styles.detailBtn}>
                <Text style={styles.detailBtnText}>Lihat Detail</Text>
                <Icon name="chevron-right" size={14} color="#0EA5E9" />
              </View>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Assigned jobs */}
      {assignedJobs.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Icon name="inbox" size={14} color="#F59E0B" />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Job Menunggu ({assignedJobs.length})</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/jobs')}>
              <Text style={styles.seeAll}>Lihat Semua</Text>
            </TouchableOpacity>
          </View>
          {assignedJobs.slice(0, 2).map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
            />
          ))}
        </View>
      )}

      {/* Empty state */}
      {activeJobs.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="check-circle" size={48} color="#10B981" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Semua Job Selesai</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
            Tidak ada job aktif saat ini
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    backgroundColor: '#0F3460',
    paddingHorizontal: 20,
    paddingBottom: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular' },
  driverName: { fontSize: 22, color: '#fff', fontFamily: 'Inter_700Bold', marginTop: 2 },
  truckBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(14,165,233,0.2)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4, marginTop: 6, alignSelf: 'flex-start',
  },
  truckText: { fontSize: 12, color: '#38BDF8', fontFamily: 'Inter_600SemiBold' },
  notifBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row', gap: 10, padding: 16,
    marginTop: -16, backgroundColor: 'transparent',
  },
  statCard: {
    flex: 1, borderRadius: 14, padding: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, color: '#64748B', fontFamily: 'Inter_500Medium', marginTop: 2 },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  seeAll: { fontSize: 13, color: '#0EA5E9', fontFamily: 'Inter_600SemiBold' },
  activeJobCard: {
    backgroundColor: '#0F3460', borderRadius: 20, padding: 18, gap: 10,
    shadowColor: '#0F3460', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  activeJobHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeJobNumber: { fontSize: 13, color: '#38BDF8', fontFamily: 'Inter_700Bold' },
  activeJobCustomer: { fontSize: 17, color: '#fff', fontFamily: 'Inter_700Bold' },
  activeJobRoute: { gap: 6 },
  routeItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeText: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_400Regular', flex: 1 },
  routeDash: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.3)', marginLeft: 4 },
  activeJobFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  activeJobMeta: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_500Medium', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  detailBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  detailBtnText: { fontSize: 13, color: '#0EA5E9', fontFamily: 'Inter_600SemiBold' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  emptyDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
