import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { Property } from '@/types';
import { formatDistance, formatPrice } from '@/utils/format';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function setupNotifications() {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('nearby', {
      name: 'Biens à proximité',
      importance: AndroidImportance.MAX,
      lightColor: '#C010A0',
    });
    await Notifications.setNotificationChannelAsync('matches', {
      name: 'Nouveaux biens pour vous',
      importance: AndroidImportance.HIGH,
      lightColor: '#7B2FF7',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function notifyNearby(property: Property, km: number) {
  if (Platform.OS === 'web') return;
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
  if (Platform.OS === 'web') return;
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
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}
