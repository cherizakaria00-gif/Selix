import { router } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { PropertyRow } from '@/components/property-card';
import { Empty, GradientButton, Header, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { LeadStatus } from '@/types';
import { formatVisit } from '@/utils/dates';

const STATUS_LABEL: Record<LeadStatus, { label: string; color: string }> = {
  nouveau: { label: 'Commercial notifié', color: Colors.orange },
  contacté: { label: 'Contacté', color: Colors.star },
  'visite planifiée': { label: 'Visite planifiée', color: Colors.pink },
  clôturé: { label: 'Clôturé', color: Colors.like },
};

export default function Favorites() {
  const { properties, likedIds, swipes, user, leads, score } = useApp();
  const liked = swipes
    .filter((s) => s.userId === user?.id && s.action !== 'dislike')
    .sort((a, b) => b.at - a.at)
    .map((s) => ({ swipe: s, property: properties.find((p) => p.id === s.propertyId) }))
    .filter((x) => x.property);

  return (
    <Screen>
      <Header title="Mes biens" />
      <FlatList
        data={liked}
        keyExtractor={(x) => x.swipe.propertyId}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        ListHeaderComponent={
          liked.length ? (
            <Text style={styles.intro}>
              {likedIds.size} bien{likedIds.size > 1 ? 's' : ''} aimé{likedIds.size > 1 ? 's' : ''} · suivi de votre dossier en temps réel
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => {
          const lead = leads.find((l) => l.userId === user?.id && l.propertyId === item.swipe.propertyId);
          const st = lead ? STATUS_LABEL[lead.status] : null;
          return (
            <View>
              <PropertyRow property={item.property!} score={score(item.property!).score} />
              <View style={styles.tags}>
                {item.swipe.action === 'superlike' && <Text style={[styles.tag, { color: Colors.star }]}>Coup de cœur</Text>}
                {lead?.visitAt && lead.visitStatus !== 'annulée' ? (
                  <Text style={[styles.tag, { color: lead.visitStatus === 'confirmée' ? Colors.like : Colors.orange }]}>
                    {lead.visitStatus === 'confirmée' ? 'Visite confirmée' : 'Visite demandée'} · {formatVisit(lead.visitAt)}
                  </Text>
                ) : lead?.kind === 'visite' ? (
                  <Text style={[styles.tag, { color: Colors.pink }]}>Visite demandée</Text>
                ) : null}
                {st && <Text style={[styles.tag, { color: st.color }]}>● {st.label}</Text>}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Empty
              icon="heart-outline"
              title="Aucun bien aimé pour l’instant"
              text="Swipez à droite sur les biens qui vous plaisent : ils apparaîtront ici et un commercial vous contactera."
              action={<GradientButton label="Commencer le matching" onPress={() => router.push('/match')} />}
            />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: Colors.textMuted, marginBottom: 4 },
  tags: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 6, flexWrap: 'wrap' },
  tag: {
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: Colors.card,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
});
