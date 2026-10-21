import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Circle, MapView, Marker, type MapHandle } from '@/components/maps';
import { PropertyRow } from '@/components/property-card';
import { Chip, GradientButton } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { MATCH_THRESHOLD } from '@/services/ai';
import { MOROCCO_REGION, openDirections } from '@/services/geo';
import { useApp } from '@/store/app-store';
import { formatCompact } from '@/utils/format';

export default function MapScreen() {
  const { properties, score, position, locationGranted, enableLocation, profile, likedIds } = useApp();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<'match' | 'all'>('match');
  const [selected, setSelected] = useState<string | null>(null);

  const items = useMemo(
    () =>
      properties
        .filter((p) => p.status === 'disponible')
        .map((p) => score(p))
        .filter((s) => filter === 'all' || s.score >= MATCH_THRESHOLD || likedIds.has(s.property.id)),
    [properties, score, filter, likedIds],
  );
  const current = items.find((s) => s.property.id === selected);

  const map = useRef<MapHandle>(null);
  const centered = useRef(false);

  // Recentre une première fois sur l'utilisateur dès que sa position est connue.
  useEffect(() => {
    if (!position || centered.current) return;
    centered.current = true;
    map.current?.animateToRegion({ ...position, latitudeDelta: 0.08, longitudeDelta: 0.08 }, 700);
  }, [position]);

  function recenter() {
    if (position) map.current?.animateToRegion({ ...position, latitudeDelta: 0.08, longitudeDelta: 0.08 }, 500);
    else enableLocation();
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={MOROCCO_REGION}
        showsUserLocation={locationGranted}
        userInterfaceStyle="dark"
        onPress={() => setSelected(null)}>
        {position && profile.notifyNearby && (
          <Circle
            center={position}
            radius={profile.radiusKm * 1000}
            strokeColor="rgba(208,76,224,0.8)"
            fillColor="rgba(208,76,224,0.12)"
          />
        )}
        {items.map(({ property: p, score: s }) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            onPress={(e: { stopPropagation?: () => void }) => {
              e.stopPropagation?.();
              setSelected(p.id);
            }}>
            <View
              style={[
                styles.marker,
                { backgroundColor: likedIds.has(p.id) ? Colors.magenta : s >= 80 ? '#14935A' : Colors.primary },
                selected === p.id && styles.markerSelected,
              ]}>
              <Text style={styles.markerText}>{formatCompact(p.price)}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Chip solid label="Pour moi" icon="sparkles" active={filter === 'match'} onPress={() => setFilter('match')} />
        <Chip solid label="Tous les biens" active={filter === 'all'} onPress={() => setFilter('all')} />
      </View>

      <Pressable onPress={recenter} style={[styles.locate, { bottom: current ? 190 : 24 }]}>
        <Ionicons name="locate" size={22} color="#fff" />
      </Pressable>

      {!locationGranted && (
        <View style={[styles.banner, { top: insets.top + 60 }]}>
          <Ionicons name="navigate-circle" size={28} color={Colors.pink} />
          <Text style={styles.bannerText}>
            Activez la localisation pour être alerté quand un bien qui vous correspond est à {profile.radiusKm} km.
          </Text>
          <Pressable onPress={enableLocation} style={styles.bannerBtn}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Activer</Text>
          </Pressable>
        </View>
      )}

      {current && (
        <View style={styles.sheet}>
          <PropertyRow property={current.property} score={current.score} distance={current.distance} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <GradientButton
              label="Voir"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/property/[id]', params: { id: current.property.id } })}
            />
            <GradientButton
              label="Itinéraire"
              icon="navigate"
              style={{ flex: 1 }}
              onPress={() => openDirections(current.property, current.property.title)}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 8 },
  marker: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: '#fff',
  },
  markerSelected: { transform: [{ scale: 1.2 }], borderColor: Colors.gold },
  markerText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(29,11,64,0.95)',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bannerText: { flex: 1, color: Colors.text, fontSize: 12, lineHeight: 17 },
  bannerBtn: { backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill },
  locate: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    padding: 12,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(18,6,42,0.97)',
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
