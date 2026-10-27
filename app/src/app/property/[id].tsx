import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapView, Marker } from '@/components/maps';
import { PropertyImage } from '@/components/property-card';
import { VisitScheduler } from '@/components/visit-scheduler';
import { Badge, Card, Empty, GradientButton, MatchBadge, Screen, SectionTitle } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { openDirections, openWhatsApp } from '@/services/geo';
import { useApp } from '@/store/app-store';
import { confirmAction, goBack, notify } from '@/utils/platform';
import { formatVisit, ucfirst } from '@/utils/dates';
import { formatDistance, formatPrice } from '@/utils/format';

export default function PropertyDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { properties, score, user, likedIds, swipe, requestVisit, cancelVisit, busySlots, leads } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState<number[]>([]);
  const property = properties.find((p) => p.id === id);

  if (!property) {
    return (
      <Screen>
        <Empty icon="home-outline" title="Bien introuvable" action={<GradientButton label="Retour" onPress={() => goBack('/')} />} />
      </Screen>
    );
  }

  const isAdmin = user?.role === 'admin';
  const s = score(property);
  const liked = likedIds.has(property.id);
  // Visite en cours pour ce client : demandée (à confirmer) ou confirmée ; une visite annulée ne compte plus.
  const myLead = leads.find((l) => l.userId === user?.id && l.propertyId === property.id);
  const visit = myLead?.visitAt && myLead.visitStatus !== 'annulée' ? myLead : null;

  async function openScheduler() {
    setBusy(await busySlots(property!.id));
    setScheduling(true);
  }

  async function submitVisit(visitAt: number, note: string) {
    await requestVisit(property!.id, visitAt, note || undefined);
    notify(
      'Demande envoyée',
      `Visite souhaitée le ${formatVisit(visitAt)}. Un commercial Selix vous la confirme très vite, vous serez notifié.`,
    );
  }

  async function cancel() {
    if (!visit) return;
    if (!(await confirmAction('Annuler la visite ?', `Votre visite du ${formatVisit(visit.visitAt!)} sera annulée.`, 'Annuler la visite'))) return;
    try {
      await cancelVisit(visit.id);
    } catch (e) {
      notify('Annulation impossible', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={{ height: 380 }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
            {property.images.map((src, i) => (
              <PropertyImage key={i} src={src} style={{ width, height: 380 }} />
            ))}
          </ScrollView>
          <LinearGradient colors={['rgba(18,6,42,0.6)', 'transparent', Colors.bg]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[styles.topBar, { top: insets.top + 6 }]}>
            <Pressable onPress={() => goBack('/')} style={styles.iconBtn}>
              <Ionicons name="chevron-down" size={24} color="#fff" />
            </Pressable>
            {!isAdmin && (
              <Pressable onPress={() => swipe(property.id, liked ? 'dislike' : 'like')} style={styles.iconBtn}>
                <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? Colors.magenta : '#fff'} />
              </Pressable>
            )}
          </View>
          {property.images.length > 1 && (
            <View style={styles.dots}>
              {property.images.map((_, i) => (
                <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
              ))}
            </View>
          )}
        </View>

        <View style={styles.body}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Badge
              label={property.transaction === 'location' ? 'À LOUER' : 'À VENDRE'}
              color={property.transaction === 'location' ? Colors.star : Colors.magenta}
            />
            {property.status !== 'disponible' && <Badge label={property.status.toUpperCase()} color={Colors.dislike} />}
            {!isAdmin && <MatchBadge score={s.score} />}
          </View>
          <Text style={styles.title}>{property.title}</Text>
          {property.standing && <Text style={styles.standing}>{property.standing}</Text>}
          {property.delivery && <Text style={styles.meta}>{property.delivery}</Text>}
          <View style={styles.loc}>
            <Ionicons name="location" size={16} color={Colors.pink} />
            <Text style={styles.meta}>
              {property.district}, {property.city}
              {s.distance !== undefined ? ` · à ${formatDistance(s.distance)} de vous` : ''}
            </Text>
          </View>
          <Text style={styles.price}>{formatPrice(property.price, property.transaction)}</Text>

          <View style={styles.specs}>
            {[
              ['resize-outline', `${property.surface} m²`],
              ['bed-outline', `${property.bedrooms} ch.`],
              ['water-outline', `${property.bathrooms} sdb`],
              ['business-outline', property.type.charAt(0).toUpperCase() + property.type.slice(1)],
            ].map(([icon, label]) => (
              <View key={label} style={styles.spec}>
                <Ionicons name={icon as 'bed-outline'} size={20} color={Colors.pink} />
                <Text style={styles.specText}>{label}</Text>
              </View>
            ))}
          </View>

          {!isAdmin && s.score >= 50 && s.reasons.length > 0 && (
            <Card style={{ marginTop: 16, borderColor: 'rgba(43,212,125,0.35)' }}>
              <Text style={[styles.cardTitle, { color: Colors.like }]}>Pourquoi ce bien vous correspond</Text>
              {s.reasons.map((r) => (
                <Text key={r} style={styles.reason}>
                  • {r}
                </Text>
              ))}
            </Card>
          )}

          {visit && (
            <Card style={[styles.visitCard, visit.visitStatus === 'confirmée' && { borderColor: 'rgba(43,212,125,0.5)' }]}>
              <View style={styles.visitHead}>
                <Ionicons
                  name={visit.visitStatus === 'confirmée' ? 'checkmark-circle' : 'time'}
                  size={22}
                  color={visit.visitStatus === 'confirmée' ? Colors.like : Colors.orange}
                />
                <Text style={styles.visitTitle}>{visit.visitStatus === 'confirmée' ? 'Visite confirmée' : 'Visite demandée'}</Text>
              </View>
              <Text style={styles.visitDate}>{ucfirst(formatVisit(visit.visitAt!))}</Text>
              <Text style={styles.meta}>
                {visit.visitStatus === 'confirmée'
                  ? 'Un commercial Selix vous attend sur place.'
                  : 'En attente de confirmation par un commercial Selix. Vous serez notifié.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <GradientButton label="Modifier" variant="ghost" icon="create-outline" onPress={openScheduler} style={{ flex: 1 }} />
                <GradientButton label="Annuler" variant="ghost" icon="close" onPress={cancel} style={{ flex: 1 }} />
              </View>
            </Card>
          )}

          <SectionTitle style={{ marginTop: 24 }}>Description</SectionTitle>
          <Text style={styles.description}>{property.description}</Text>

          {property.features.length > 0 && (
            <>
              <SectionTitle style={{ marginTop: 24 }}>Équipements</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {property.features.map((f) => (
                  <View key={f} style={styles.feature}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.like} />
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <SectionTitle style={{ marginTop: 24 }}>Localisation</SectionTitle>
          <View style={styles.map}>
            <MapView
              style={StyleSheet.absoluteFill}
              initialRegion={{ latitude: property.latitude, longitude: property.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
              scrollEnabled={false}
              zoomEnabled={false}
              userInterfaceStyle="dark">
              <Marker coordinate={{ latitude: property.latitude, longitude: property.longitude }} pinColor={Colors.magenta} />
            </MapView>
          </View>
        </View>
      </ScrollView>

      <LinearGradient
        colors={['transparent', Colors.bg, Colors.bg]}
        locations={[0, 0.3, 1]}
        style={[styles.actions, { paddingBottom: insets.bottom + 12 }]}>
        {isAdmin ? (
          <GradientButton
            label="Modifier ce bien"
            icon="create-outline"
            onPress={() => router.push({ pathname: '/edit-property', params: { id: property.id } })}
          />
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <GradientButton
                label="Itinéraire"
                icon="navigate"
                variant="ghost"
                style={{ flex: 1 }}
                onPress={() => openDirections(property, property.title)}
              />
              <GradientButton
                label="WhatsApp"
                icon="logo-whatsapp"
                variant="ghost"
                style={{ flex: 1 }}
                onPress={() =>
                  openWhatsApp(
                    property.agentPhone,
                    `Bonjour Selix, je suis intéressé(e) par « ${property.title} » (${property.district}, ${property.city}).`,
                  )
                }
              />
            </View>
            <GradientButton
              label={visit ? 'Modifier ma visite' : 'Demander une visite'}
              icon="calendar"
              onPress={openScheduler}
              style={{ marginTop: 10 }}
            />
          </>
        )}
      </LinearGradient>

      <VisitScheduler
        visible={scheduling}
        onClose={() => setScheduling(false)}
        title={visit ? 'Modifier ma visite' : 'Choisir une date de visite'}
        subtitle={property.title}
        busy={busy.filter((b) => b !== visit?.visitAt)}
        initial={visit?.visitAt}
        confirmLabel={visit ? 'Envoyer le nouveau créneau' : 'Envoyer ma demande'}
        askNote
        onSubmit={submitVisit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  visitCard: { marginTop: 16, borderColor: 'rgba(245,165,36,0.5)' },
  visitHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visitTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  visitDate: { color: Colors.gold, fontSize: 20, fontWeight: '800', marginVertical: 6 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(18,6,42,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { position: 'absolute', bottom: 22, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 18, backgroundColor: '#fff' },
  body: { paddingHorizontal: 20, marginTop: -8 },
  title: { color: '#fff', fontSize: 32, fontWeight: '500', marginTop: 12 },
  standing: { color: Colors.gold, fontSize: 16, fontWeight: '600', marginTop: 2 },
  meta: { color: Colors.textMuted, fontSize: 14 },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  price: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 12 },
  specs: {
    flexDirection: 'row',
    marginTop: 18,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  spec: { flex: 1, alignItems: 'center', gap: 6 },
  specText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  cardTitle: { fontWeight: '700', fontSize: 15, marginBottom: 6 },
  reason: { color: Colors.text, fontSize: 14, marginTop: 2 },
  description: { color: Colors.textMuted, fontSize: 15, lineHeight: 23 },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  featureText: { color: '#fff', fontSize: 13, textTransform: 'capitalize' },
  map: { height: 180, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  actions: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 30 },
});

