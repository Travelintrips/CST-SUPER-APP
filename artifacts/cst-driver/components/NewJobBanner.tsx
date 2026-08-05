import React, { useEffect, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { useJobs } from '@/context/JobsContext';

const BANNER_HEIGHT = 90;
const AUTO_DISMISS_MS = 6000;

export function NewJobBanner() {
  const { pendingNewJob, clearPendingNewJob } = useJobs();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT - 60)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pendingNewJob) {
      if (timerRef.current) clearTimeout(timerRef.current);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 18,
          stiffness: 220,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -BANNER_HEIGHT - 60,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pendingNewJob]);

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -BANNER_HEIGHT - 60,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => clearPendingNewJob());
  }

  function handleViewJob() {
    if (!pendingNewJob) return;
    dismiss();
    router.push({ pathname: '/job/[id]', params: { id: pendingNewJob.id } });
  }

  const topOffset = Platform.OS === 'web' ? 12 : insets.top + 8;

  return (
    <Animated.View
      pointerEvents={pendingNewJob ? 'box-none' : 'none'}
      style={[
        styles.container,
        { top: topOffset, transform: [{ translateY }], opacity },
      ]}
    >
      <View style={styles.banner}>
        <View style={styles.iconWrap}>
          <Text style={styles.truckEmoji}>🚛</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.label}>Job Baru Masuk!</Text>
          <Text style={styles.jobNumber} numberOfLines={1}>
            {pendingNewJob?.jobNumber}
          </Text>
          <Text style={styles.customer} numberOfLines={1}>
            {pendingNewJob?.customerName}
          </Text>
          <Text style={styles.address} numberOfLines={1}>
            📍 {pendingNewJob?.pickupAddress?.split(',')[0]}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.viewBtn} onPress={handleViewJob}>
            <Text style={styles.viewBtnText}>Lihat</Text>
          </Pressable>
          <TouchableOpacity onPress={dismiss} hitSlop={10}>
            <Icon name="x" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  banner: {
    backgroundColor: '#0F3460',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FF6B00',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,107,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckEmoji: {
    fontSize: 22,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#FF6B00',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  jobNumber: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  customer: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.85)',
  },
  address: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
  },
  actions: {
    alignItems: 'center',
    gap: 10,
  },
  viewBtn: {
    backgroundColor: '#0EA5E9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  viewBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
});
