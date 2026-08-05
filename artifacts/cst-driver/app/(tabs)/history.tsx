import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useJobs } from '@/context/JobsContext';
import { Job } from '@/types';
import { Icon } from '@/components/Icon';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { completedJobs } = useJobs();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  function renderItem({ item }: { item: Job }) {
    const completedLog = item.statusLogs.find((l) => l.status === 'COMPLETED');
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push({ pathname: '/job/[id]', params: { id: item.id } })}
        activeOpacity={0.85}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.jobNumber, { color: '#0F3460' }]}>{item.jobNumber}</Text>
          <View style={styles.completedBadge}>
            <Icon name="check-circle" size={12} color="#10B981" />
            <Text style={styles.completedText}>Selesai</Text>
          </View>
        </View>
        <Text style={[styles.customer, { color: colors.foreground }]}>{item.customerName}</Text>
        <View style={styles.routeRow}>
          <Icon name="map-pin" size={12} color={colors.mutedForeground} />
          <Text style={[styles.routeText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.pickupAddress.split(',')[0]} → {item.deliveryAddress.split(',').slice(-2).join(',')}
          </Text>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.metaItem}>
            <Icon name="calendar" size={11} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {completedLog ? formatDate(completedLog.timestamp) : formatDate(item.deliveryDateTime)}
            </Text>
          </View>
          {item.weight && (
            <View style={styles.metaItem}>
              <Icon name="package" size={11} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.weight}</Text>
            </View>
          )}
          {item.receiverName && (
            <View style={styles.metaItem}>
              <Icon name="user" size={11} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.receiverName}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={styles.title}>Riwayat</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{completedJobs.length}</Text>
        </View>
      </View>

      <FlatList
        data={completedJobs}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!completedJobs.length}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="clock" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Belum ada riwayat</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Job yang sudah selesai akan muncul di sini
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    backgroundColor: '#0F3460', paddingHorizontal: 20,
    paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
  countBadge: {
    backgroundColor: '#10B981', borderRadius: 14, minWidth: 28, height: 28,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  countText: { fontSize: 13, color: '#fff', fontFamily: 'Inter_700Bold' },
  list: { padding: 16 },
  card: {
    borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobNumber: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  completedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#D1FAE5', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  completedText: { fontSize: 11, color: '#065F46', fontFamily: 'Inter_600SemiBold' },
  customer: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routeText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  emptyDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 40 },
});
