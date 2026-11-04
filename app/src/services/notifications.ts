import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import type * as ExpoNotifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Property } from '@/types';
import { formatDistance, formatPrice } from '@/utils/format';

/**
 * expo-notifications, ou null là où il ne se charge pas : sur web, et dans Expo Go
 * sur Android, qui n'embarque plus le module natif des push depuis le SDK 53
 * (« Cannot find native module 'ExpoTopicSubscriptionModule' » dès l'import).
 * Les builds EAS (stores) l'ont toujours.
 */
export const Notifications: typeof ExpoNotifications | null = loadNotifications();

function loadNotifications() {
  if (Platform.OS === 'web') return null;
  if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as typeof ExpoNotifications;
  } catch {
    return null;
  }
}

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function setupNotifications() {
  if (!Notifications) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('nearby', {
      name: 'Biens à proximité',
      importance: Notifications.AndroidImportance.MAX,
      lightColor: '#C010A0',
    });
    await Notifications.setNotificationChannelAsync('matches', {
      name: 'Nouveaux biens pour vous',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#7B2FF7',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function notifyNearby(property: Property, km: number) {
  if (!Notifications) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${property.title} est à ${formatDistance(km)} de vous`,
      body: `${property.district}, ${property.city} · ${formatPrice(property.price, property.transaction)}. Touchez pour voir l'itinéraire et le visiter.`,
      data: { propertyId: property.id, kind: 'nearby' },
      ...(Platform.OS === 'android' ? { channelId: 'nearby' } : null),
    },
    trigger: null,
  });
}

export async function notifyNewMatch(property: Property, score: number) {
  if (!Notifications) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Nouveau bien pour vous — ${score}% compatible`,
      body: `${property.title} · ${property.district}, ${property.city} · ${formatPrice(property.price, property.transaction)}`,
      data: { propertyId: property.id, kind: 'match' },
      ...(Platform.OS === 'android' ? { channelId: 'matches' } : null),
    },
    trigger: null,
  });
}

/**
 * Token push Expo de l'appareil, que le serveur utilise pour envoyer
 * « nouveau bien pour vous ». Nécessite un build EAS (projectId dans app.json) :
 * Expo Go sur Android ne reçoit pas de push distants depuis le SDK 53.
 */
export async function getPushToken(): Promise<string | null> {
  if (!Notifications || !Device.isDevice) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}
