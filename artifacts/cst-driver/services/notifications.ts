import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NOTIFY_SOUND = require('../assets/sounds/notify.mp3') as string | number;

// expo-notifications dropped push/remote notification support in Expo Go SDK 53.
// Use lazy require so the import itself doesn't crash in Expo Go.
const isExpoGo =
  Constants.appOwnership === 'expo' ||
  (Constants.executionEnvironment as string) === 'storeClient';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNotifications(): any | null {
  if (isExpoGo || Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch {
    return null;
  }
}

async function playNotificationSound(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      // Web: gunakan Web Audio API
      const src = typeof NOTIFY_SOUND === 'string' ? NOTIFY_SOUND : String(NOTIFY_SOUND);
      const audio = new window.Audio(src);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    } else {
      // Android / iOS: gunakan expo-av (berjalan di Expo Go maupun APK)
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const { sound } = await Audio.Sound.createAsync(NOTIFY_SOUND as number, {
        shouldPlay: true,
        volume: 1.0,
      });
      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
        }
      });
    }
  } catch {}
}

// Setup notification handler pada native dev/prod build (bukan Expo Go)
(function setupHandler() {
  const Notif = getNotifications();
  if (!Notif) return;
  try {
    Notif.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {}
})();

export async function requestNotificationPermission(): Promise<boolean> {
  const Notif = getNotifications();
  if (!Notif) return false;
  try {
    const { status: existing } = await Notif.getPermissionsAsync();
    let final = existing;
    if (existing !== 'granted') {
      const { status } = await Notif.requestPermissionsAsync();
      final = status;
    }
    if (final !== 'granted') return false;

    if (Platform.OS === 'android') {
      await Notif.setNotificationChannelAsync('job-alerts', {
        name: 'Notifikasi Job Baru',
        importance: Notif.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#FF6B00',
        sound: 'notify.mp3',
        enableVibrate: true,
        showBadge: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function notifyNewJob(
  jobNumber: string,
  customerName: string,
  pickupAddress: string,
): void {
  playNotificationSound();
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

  const Notif = getNotifications();
  if (!Notif) return;

  Notif.scheduleNotificationAsync({
    content: {
      title: `🚛 Job Baru: ${jobNumber}`,
      body: `${customerName || 'Pelanggan'}\n📍 ${pickupAddress || '-'}`,
      sound: 'notify.mp3',
      data: { jobNumber },
      ...(Platform.OS === 'android' ? { channelId: 'job-alerts' } : {}),
    },
    trigger: null,
  }).catch(() => {});
}
