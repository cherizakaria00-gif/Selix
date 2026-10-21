// react-native-maps n'existe pas sur le web : on affiche un simple encart.
import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type MapHandle = { animateToRegion: (region: Region, duration?: number) => void };
export type MapPressEvent = { nativeEvent: { coordinate: { latitude: number; longitude: number } } };

export function MapView({ style }: { style?: StyleProp<ViewStyle>; children?: ReactNode; [k: string]: unknown }) {
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgElevated }, style]}>
      <Text style={{ color: Colors.textMuted }}>Carte disponible sur iOS et Android</Text>
    </View>
  );
}

export function Marker(_: { [k: string]: unknown; children?: ReactNode }) {
  return null;
}

export function Circle(_: { [k: string]: unknown }) {
  return null;
}
