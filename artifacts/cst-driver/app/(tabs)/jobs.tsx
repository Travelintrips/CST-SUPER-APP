import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useJobs } from '@/context/JobsContext';
import { JobCard } from '@/components/JobCard';
import { Job } from '@/types';
import { Icon } from '@/components/Icon';

type Filter = 'all' | 'ASSIGNED' | 'ACCEPTED' | 'IN_TRANSIT';

export default function JobsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeJobs, refreshJobs } = useJobs();
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const filteredJobs = filter === 'all'
    ? activeJobs
    : activeJobs.filter((j) => j.status === filter);

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Semua' },
    { key: 'ASSIGNED', label: 'Baru' },
    { key: 'ACCEPTED', label: 'Diterima' },
    { key: 'IN_TRANSIT', label: 'Transit' },
  ];

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshJobs();
    } finally {
      setRefreshing(false);
    }
  }

  function renderJob({ item }: { item: Job }) {
    return (
      <JobCard
        job={item}
        onPress={() => router.push({ pathname: '/job/[id]', params: { id: item.id } })}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={styles.title}>Daftar Job</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{activeJobs.length}</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filterBtn,
              filter === f.key && { backgroundColor: '#0F3460' },
              { borderColor: filter === f.key ? '#0F3460' : colors.border },
            ]}
            onPress={() => setFilter(f.key)}
          >
            <Text
              style={[
                styles.filterText,
                { color: filter === f.key ? '#fff' : colors.mutedForeground },
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={filteredJobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJob}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!filteredJobs.length}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#0EA5E9"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="inbox" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Tidak ada job</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Belum ada job dengan filter ini
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
    backgroundColor: '#0F3460',
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
  countBadge: {
    backgroundColor: '#0EA5E9', borderRadius: 14, minWidth: 28,
    height: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  countText: { fontSize: 13, color: '#fff', fontFamily: 'Inter_700Bold' },
  filterRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16,
    paddingVertical: 14, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5,
  },
  filterText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  listContent: { padding: 16 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  emptyDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
