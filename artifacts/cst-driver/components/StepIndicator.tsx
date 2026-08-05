import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ShipmentStatus, STATUS_FLOW, STATUS_LABELS } from '@/types';
import { Icon } from '@/components/Icon';

interface StepIndicatorProps {
  currentStatus: ShipmentStatus;
}

const STEP_LABELS: Partial<Record<ShipmentStatus, string>> = {
  ASSIGNED: 'Ditugaskan',
  ACCEPTED: 'Diterima',
  ON_THE_WAY_TO_PICKUP: 'Ke Pickup',
  ARRIVED_AT_PICKUP: 'Di Pickup',
  PICKED_UP: 'Diambil',
  IN_TRANSIT: 'Transit',
  ARRIVED_AT_DESTINATION: 'Di Tujuan',
  DELIVERED: 'Terkirim',
  COMPLETED: 'Selesai',
};

export function StepIndicator({ currentStatus }: StepIndicatorProps) {
  const colors = useColors();
  const currentIdx = STATUS_FLOW.indexOf(currentStatus);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.container}>
        {STATUS_FLOW.map((status, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isPending = idx > currentIdx;
          return (
            <View key={status} style={styles.stepWrapper}>
              <View style={styles.step}>
                <View
                  style={[
                    styles.circle,
                    isDone && { backgroundColor: colors.success, borderColor: colors.success },
                    isCurrent && { backgroundColor: colors.primary, borderColor: colors.primary },
                    isPending && { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  {isDone ? (
                    <Icon name="check" size={10} color="#fff" />
                  ) : (
                    <Text style={[styles.circleNum, { color: isCurrent ? '#fff' : colors.mutedForeground }]}>
                      {idx + 1}
                    </Text>
                  )}
                </View>
                {idx < STATUS_FLOW.length - 1 && (
                  <View
                    style={[
                      styles.line,
                      { backgroundColor: idx < currentIdx ? colors.success : colors.border },
                    ]}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  { color: isCurrent ? colors.primary : isDone ? colors.success : colors.mutedForeground },
                  isCurrent && { fontFamily: 'Inter_700Bold' },
                ]}
                numberOfLines={2}
              >
                {STEP_LABELS[status]}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: 'flex-start',
  },
  stepWrapper: {
    alignItems: 'center',
    width: 64,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleNum: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
  },
  line: {
    width: 40,
    height: 2,
  },
  label: {
    fontSize: 9,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 13,
    width: 60,
  },
});
