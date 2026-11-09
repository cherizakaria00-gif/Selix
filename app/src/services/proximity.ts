/**
 * Alertes de proximité : « Un bien qui vous correspond est à 2 km, allez le visiter ».
 *
 * - App ouverte (y compris Expo Go) : suivi de position au premier plan + calcul de distance.
 * - App fermée / en arrière-plan : géofencing natif (une zone par bien correspondant).
 *   Nécessite un build de développement ou de production, Expo Go ne le permet pas.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getProperties } from '@/services/api';
import { distanceKm, type Coords } from '@/services/geo';
import { notifyNearby } from '@/services/notifications';
import type { Property } from '@/types';

export const GEOFENCE_TASK = 'selix-geofence';
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const NOTIFIED_KEY = 'selix:nearby-notified';
/** On ne renotifie pas le même bien avant 12 h. */
const COOLDOWN_MS = 12 * 60 * 60 * 1000;
/** iOS surveille au maximum 20 zones à la fois. */
const MAX_REGIONS = 20;

async function shouldNotify(propertyId: string) {
  const raw = await AsyncStorage.getItem(NOTIFIED_KEY);
  const log: Record<string, number> = raw ? JSON.parse(raw) : {};
  if (Date.now() - (log[propertyId] ?? 0) < COOLDOWN_MS) return false;
  log[propertyId] = Date.now();
  await AsyncStorage.setItem(NOTIFIED_KEY, JSON.stringify(log));
  return true;
}

// Doit être défini au chargement du module (portée globale) pour que l'OS puisse
// relancer la tâche quand l'app est fermée.
if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(
    GEOFENCE_TASK,
    async ({ data, error }) => {
      if (error || !data || data.eventType !== Location.GeofencingEventType.Enter) return;
      const id = data.region.identifier;
      if (!id) return;
      const property = (await getProperties()).find((p) => p.id === id);
      if (!property || property.status !== 'disponible') return;
      if (!(await shouldNotify(id))) return;
      await notifyNearby(property, (data.region.radius ?? 2000) / 1000);
    },
  );
}

export async function requestForegroundLocation() {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

export async function requestBackgroundLocation() {
  const { granted } = await Location.requestBackgroundPermissionsAsync();
  return granted;
}

export async function getForegroundPermission() {
  const { granted } = await Location.getForegroundPermissionsAsync();
  return granted;
}

/** Vérification au premier plan : notifie le bien correspondant le plus proche dans le rayon. */
export async function checkNearby(position: Coords, candidates: Property[], radiusKm: number) {
  const inRange = candidates
    .map((p) => ({ p, km: distanceKm(position, p) }))
    .filter((x) => x.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
  for (const { p, km } of inRange) {
    if (await shouldNotify(p.id)) {
      await notifyNearby(p, km);
      return p;
    }
  }
  return null;
}

export type BackgroundStatus = 'active' | 'expo-go' | 'denied' | 'off';

/** Active (ou met à jour) le géofencing en arrière-plan autour des biens correspondants. */
export async function syncBackgroundGeofences(
  candidates: Property[],
  radiusKm: number,
  enabled: boolean,
): Promise<BackgroundStatus> {
  if (Platform.OS === 'web') return 'off';
  if (isExpoGo) return 'expo-go';
  const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
  if (!enabled || !candidates.length) {
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    return 'off';
  }
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  // L'autorisation n'est jamais demandée ici : elle suit l'écran d'explication du profil.
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) return 'denied';

  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    candidates.slice(0, MAX_REGIONS).map((p) => ({
      identifier: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
      radius: radiusKm * 1000,
      notifyOnEnter: true,
      notifyOnExit: false,
    })),
  );
  return 'active';
}
