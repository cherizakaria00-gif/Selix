// Sur le web (tableau de bord app.selix.io), react-native-maps n'existe pas : on
// reproduit la petite partie de son API utilisée par l'app avec Leaflet.
import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useEffect, useImperativeHandle, useMemo, type ReactNode, type Ref } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Circle as LCircle, MapContainer, Marker as LMarker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { Colors } from '@/constants/theme';

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type MapHandle = { animateToRegion: (region: Region, duration?: number) => void };
export type MapPressEvent = { nativeEvent: { coordinate: { latitude: number; longitude: number } } };

type LatLng = { latitude: number; longitude: number };

/** Le zoom Leaflet correspondant à l'étendue (en degrés) d'une Region react-native-maps. */
const zoomFor = (delta: number) => Math.min(18, Math.max(3, Math.round(Math.log2(360 / delta))));

export function MapView({
  ref,
  style,
  initialRegion,
  onPress,
  scrollEnabled = true,
  zoomEnabled = true,
  children,
}: {
  ref?: Ref<MapHandle>;
  style?: StyleProp<ViewStyle>;
  initialRegion?: Region;
  onPress?: (e: MapPressEvent) => void;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  children?: ReactNode;
  // Options natives sans équivalent web (showsUserLocation, userInterfaceStyle…).
  [k: string]: unknown;
}) {
  const region = initialRegion ?? { latitude: 32.3, longitude: -7.2, latitudeDelta: 7, longitudeDelta: 7 };
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: Colors.bgElevated }, style]}>
      <MapContainer
        center={[region.latitude, region.longitude]}
        zoom={zoomFor(region.latitudeDelta)}
        dragging={scrollEnabled}
        scrollWheelZoom={zoomEnabled}
        doubleClickZoom={zoomEnabled}
        zoomControl={zoomEnabled}
        style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <MapBridge ref={ref} onPress={onPress} />
        {children}
      </MapContainer>
    </View>
  );
}

/** Relie les événements et la méthode animateToRegion de react-native-maps à Leaflet. */
function MapBridge({ ref, onPress }: { ref?: Ref<MapHandle>; onPress?: (e: MapPressEvent) => void }) {
  const map = useMap();
  useImperativeHandle(ref, () => ({
    animateToRegion: (r, duration = 500) =>
      map.flyTo([r.latitude, r.longitude], zoomFor(r.latitudeDelta), { duration: duration / 1000 }),
  }));
  useMapEvents({
    click: (e) => onPress?.({ nativeEvent: { coordinate: { latitude: e.latlng.lat, longitude: e.latlng.lng } } }),
  });
  // La carte peut être montée dans un conteneur qui change encore de taille (modale, onglet).
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

export function Marker({
  coordinate,
  pinColor = Colors.magenta,
  onPress,
}: {
  coordinate: LatLng;
  pinColor?: string;
  onPress?: (e: { stopPropagation?: () => void }) => void;
  children?: ReactNode;
  [k: string]: unknown;
}) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<div style="width:22px;height:22px;border-radius:11px;background:${pinColor};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>`,
      }),
    [pinColor],
  );
  return (
    <LMarker
      position={[coordinate.latitude, coordinate.longitude]}
      icon={icon}
      eventHandlers={onPress ? { click: (e) => onPress({ stopPropagation: () => L.DomEvent.stopPropagation(e) }) } : undefined}
    />
  );
}

export function Circle({
  center,
  radius,
  strokeColor = Colors.pink,
  fillColor = 'rgba(208,76,224,0.12)',
}: {
  center: LatLng;
  radius: number;
  strokeColor?: string;
  fillColor?: string;
  [k: string]: unknown;
}) {
  return (
    <LCircle
      center={[center.latitude, center.longitude]}
      radius={radius}
      pathOptions={{ color: strokeColor, weight: 2, fillColor, fillOpacity: 1 }}
    />
  );
}
