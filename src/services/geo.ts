import { Linking, Platform } from 'react-native';

export type Coords = { latitude: number; longitude: number };

/** Distance à vol d'oiseau en km (formule de haversine). */
export function distanceKm(a: Coords, b: Coords) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ouvre l'itinéraire vers le bien dans l'app de cartes du téléphone. */
export async function openDirections(to: Coords, label: string) {
  const dest = `${to.latitude},${to.longitude}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  const native =
    Platform.OS === 'ios'
      ? `maps://?daddr=${dest}&q=${encodeURIComponent(label)}`
      : `google.navigation:q=${dest}`;
  try {
    if (Platform.OS !== 'web' && (await Linking.canOpenURL(native))) return Linking.openURL(native);
  } catch {
    // on retombe sur Google Maps web
  }
  return Linking.openURL(web);
}

export function openWhatsApp(phone: string, message: string) {
  const digits = phone.replace(/[^\d]/g, '');
  return Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
}

/** Centre du Maroc pour la carte quand la position est inconnue. */
export const MOROCCO_REGION = {
  latitude: 32.3,
  longitude: -7.2,
  latitudeDelta: 7,
  longitudeDelta: 7,
};
