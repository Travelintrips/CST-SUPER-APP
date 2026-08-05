import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShipmentStatus, STATUS_LABELS } from '@/types';

const STATUS_COLORS: Record<ShipmentStatus, { bg: string; text: string; dot: string }> = {
  ASSIGNED:             { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  ACCEPTED:             { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
  ON_THE_WAY_TO_PICKUP: { bg: '#EDE9FE', text: '#5B21B6', dot: '#8B5CF6' },
  ARRIVED_AT_PICKUP:    { bg: '#FCE7F3', text: '#9D174D', dot: '#EC4899' },
  PICKED_UP:            { bg: '#E0E7FF', text: '#3730A3', dot: '#6366F1' },
  IN_TRANSIT:           { bg: '#DBEAFE', text: '#0F3460', dot: '#0EA5E9' },
  ARRIVED_AT_DESTINATION:{ bg: '#ECFDF5', text: '#065F46', dot: '#10B981' },
  DELIVERED:            { bg: '#D1FAE5', text: '#047857', dot: '#059669' },
  COMPLETED:            { bg: '#D1FAE5', text: '#065F46', dot: '#10B981' },
  CANCELLED:            { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' },
};

interface StatusBadgeProps {
  status: ShipmentStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const colors = STATUS_COLORS[status];
  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }, isSmall && styles.badgeSm]}>
      <View style={[styles.dot, { backgroundColor: colors.dot }, isSmall && styles.dotSm]} />
      <Text style={[styles.label, { color: colors.text }, isSmall && styles.labelSm]}>
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotSm: {
    width: 5,
    height: 5,
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  labelSm: {
    fontSize: 10,
  },
});
