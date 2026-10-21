import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageStyle } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp } from 'react-native';

import { MatchBadge } from '@/components/ui';
import { LOCAL_IMAGES } from '@/data/seed';
import { Colors, Gradients, Radius } from '@/constants/theme';
import type { Property } from '@/types';
import { formatDistance, formatPrice, propertySubtitle } from '@/utils/format';

export function imageSource(src: string | number | undefined) {
  if (typeof src === 'number') return src;
  if (!src) return LOCAL_IMAGES['anfa-ext'];
  if (src.startsWith('local:')) return LOCAL_IMAGES[src.slice(6)] ?? LOCAL_IMAGES['anfa-ext'];
  return { uri: src };
}

export function PropertyImage({ src, style }: { src?: string | number; style?: StyleProp<ImageStyle> }) {
  return <Image source={imageSource(src)} style={style} contentFit="cover" transition={200} />;
}

/** Carte compacte (listes, favoris, chat). */
export function PropertyRow({
  property,
  score,
  distance,
  right,
  onPress,
}: {
  property: Property;
  score?: number;
  distance?: number;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: '/property/[id]', params: { id: property.id } }))}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
      <PropertyImage src={property.images[0]} style={styles.thumb} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.title} numberOfLines={1}>
          {property.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {property.district}, {property.city}
          {distance !== undefined ? ` · ${formatDistance(distance)}` : ''}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {propertySubtitle(property)}
        </Text>
        <Text style={styles.price}>{formatPrice(property.price, property.transaction)}</Text>
      </View>
      {right ?? (score !== undefined ? <MatchBadge score={score} /> : null)}
    </Pressable>
  );
}

/** Grande carte visuelle façon maquette Selix (swipe & détails). */
export function PropertyHero({ property, score }: { property: Property; score?: number }) {
  return (
    <View style={styles.hero}>
      <PropertyImage src={property.images[0]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={Gradients.cardShade} locations={[0.35, 0.65, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.heroTop}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{property.transaction === 'location' ? 'À LOUER' : 'À VENDRE'}</Text>
        </View>
        {score !== undefined && <MatchBadge score={score} />}
      </View>
      <View style={styles.heroBottom}>
        <Text style={styles.heroTitle}>{property.title}</Text>
        {property.standing && <Text style={styles.standing}>{property.standing}</Text>}
        {property.delivery && <Text style={styles.delivery}>{property.delivery}</Text>}
        <View style={styles.heroMeta}>
          <Ionicons name="location" size={14} color={Colors.pink} />
          <Text style={styles.heroMetaText}>
            {property.district}, {property.city}
          </Text>
        </View>
        <View style={styles.heroFoot}>
          <Text style={styles.heroPrice}>{formatPrice(property.price, property.transaction)}</Text>
          <Text style={styles.heroSpecs}>{propertySubtitle(property)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: Radius.lg,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumb: { width: 86, height: 86, borderRadius: Radius.md },
  title: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: Colors.textMuted, fontSize: 12 },
  price: { color: Colors.gold, fontSize: 14, fontWeight: '700', marginTop: 2 },
  hero: {
    flex: 1,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  pill: {
    backgroundColor: 'rgba(18,6,42,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  heroBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20 },
  heroTitle: { color: '#fff', fontSize: 30, fontWeight: '500' },
  standing: { color: Colors.gold, fontSize: 15, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 },
  delivery: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  heroMetaText: { color: Colors.textMuted, fontSize: 13 },
  heroFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 },
  heroPrice: { color: '#fff', fontSize: 18, fontWeight: '800' },
  heroSpecs: { color: Colors.textMuted, fontSize: 12 },
});
