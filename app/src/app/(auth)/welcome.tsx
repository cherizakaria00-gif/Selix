import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { PropertyImage } from '@/components/property-card';
import { GradientButton, Logo, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';

const hero = 'local:anfa-ext';

export default function Welcome() {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {/* 1 — Splash */}
        <View style={[styles.page, { width }]}>
          <View style={styles.center}>
            <Logo height={78} />
            <Text style={styles.tagline}>Real estate matching</Text>
          </View>
        </View>

        {/* 2 — Promesse */}
        <View style={[styles.page, { width }]}>
          <Text style={styles.kicker}>Real estate matching</Text>
          <View style={styles.stack}>
            <View style={[styles.stackBack, { transform: [{ rotate: '-8deg' }] }]} />
            <View style={styles.stackFront}>
              <PropertyImage src={hero} style={StyleSheet.absoluteFill} />
              <View style={styles.cardCaption}>
                <Text style={styles.cardTitle}>Les Villas d’Anfa 5</Text>
                <Text style={styles.cardStanding}>HAUT STANDING</Text>
                <Text style={styles.cardSub}>Dar Bouazza · villas avec piscine</Text>
              </View>
            </View>
          </View>
          <Text style={styles.h1}>Une expérience immobilière</Text>
          <Text style={styles.h1Accent}>premium et intelligente</Text>
          <Text style={styles.body}>Matching, assistant IA, alertes de proximité et suivi de vos visites dans une seule application.</Text>
        </View>

        {/* 3 — Swipe */}
        <View style={[styles.page, { width }]}>
          <Text style={styles.h1Accent}>Swipe to like</Text>
          <Text style={styles.body}>Un commercial va vous contacter pour chaque coup de cœur.</Text>
          <View style={[styles.stack, { marginTop: 24 }]}>
            <View style={[styles.side, { left: 4, backgroundColor: 'rgba(255,77,94,0.55)' }]} />
            <View style={[styles.side, { right: 4, backgroundColor: 'rgba(43,212,125,0.55)' }]} />
            <View style={styles.stackFront}>
              <PropertyImage src="local:kech-1" style={StyleSheet.absoluteFill} />
              <View style={styles.cardCaption}>
                <Text style={styles.cardTitle}>Les Villas d’Anfa</Text>
                <Text style={styles.cardStanding}>MARRAKECH</Text>
              </View>
            </View>
          </View>
          <View style={styles.actions}>
            <View style={[styles.round, { borderColor: Colors.dislike }]}>
              <Ionicons name="close" size={26} color={Colors.dislike} />
            </View>
            <View style={[styles.round, styles.roundSmall, { borderColor: Colors.star }]}>
              <Ionicons name="star" size={18} color={Colors.star} />
            </View>
            <View style={[styles.round, { borderColor: Colors.like }]}>
              <Ionicons name="heart" size={26} color={Colors.like} />
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
          ))}
        </View>
        <GradientButton label="Commencer l'inscription guidée" onPress={() => router.push('/register')} />
        <GradientButton
          label="J'ai déjà un compte"
          variant="ghost"
          onPress={() => router.push('/login')}
          style={{ marginTop: 12 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 28, paddingTop: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
  tagline: { color: Colors.pink, fontSize: 20, letterSpacing: 1.5 },
  kicker: { color: Colors.text, fontSize: 20, fontWeight: '500', marginBottom: 12 },
  stack: { height: 260, justifyContent: 'center', alignItems: 'center', marginBottom: 28 },
  stackBack: {
    position: 'absolute',
    width: '86%',
    height: 240,
    borderRadius: Radius.xl,
    backgroundColor: 'rgba(200,190,230,0.55)',
  },
  stackFront: {
    width: '86%',
    height: 230,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Colors.bgElevated,
  },
  side: { position: 'absolute', width: 60, height: 200, borderRadius: Radius.lg },
  cardCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    backgroundColor: 'rgba(60,20,90,0.55)',
  },
  cardTitle: { color: '#fff', fontSize: 24 },
  cardStanding: { color: Colors.gold, fontSize: 13, fontWeight: '600' },
  cardSub: { color: '#fff', fontSize: 10, marginTop: 2 },
  h1: { color: Colors.text, fontSize: 32, fontWeight: '400', lineHeight: 38 },
  h1Accent: { color: Colors.pink, fontSize: 26, marginTop: 6, marginBottom: 8 },
  body: { color: 'rgba(200,130,230,0.9)', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
  round: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundSmall: { width: 46, height: 46 },
  footer: { paddingHorizontal: 24, paddingBottom: 12 },
  dots: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(123,47,247,0.6)' },
  dotActive: { width: 22, backgroundColor: '#fff' },
});
