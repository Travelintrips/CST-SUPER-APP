import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { StatusBadge } from './StatusBadge';
import { Job } from '@/types';
import { Icon } from '@/components/Icon';

interface JobCardProps {
  job: Job;
  onPress: () => void;
  compact?: boolean;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function JobCard({ job, onPress, compact = false }: JobCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.jobNumber, { color: colors.primary }]}>{job.jobNumber}</Text>
          <StatusBadge status={job.status} size="sm" />
        </View>
        <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>

      <Text style={[styles.customer, { color: colors.foreground }]} numberOfLines={1}>
        {job.customerName}
      </Text>

      {!compact && (
        <>
          <View style={styles.route}>
            <View style={styles.routeItem}>
              <View style={[styles.routeDot, { backgroundColor: colors.secondary }]} />
              <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>
                {job.pickupAddress.split(',')[0]}
              </Text>
            </View>
            <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
            <View style={styles.routeItem}>
              <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>
                {job.deliveryAddress.split(',')[0]}
              </Text>
            </View>
          </View>

          <View style={styles.meta}>
            <View style={styles.metaItem}>
              <Icon name="clock" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {formatDate(job.pickupDateTime)}
              </Text>
            </View>
            {job.distance && (
              <View style={styles.metaItem}>
                <Icon name="map-pin" size={12} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{job.distance}</Text>
              </View>
            )}
            {job.weight && (
              <View style={styles.metaItem}>
                <Icon name="package" size={12} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{job.weight}</Text>
              </View>
            )}
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobNumber: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  customer: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  route: {
    gap: 6,
  },
  routeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  routeLine: {
    width: 1,
    height: 12,
    marginLeft: 3.5,
  },
  routeText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
});
