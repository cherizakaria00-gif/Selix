import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PropertyRow } from '@/components/property-card';
import { Card, GradientButton, Header, Screen, SectionTitle, type IconName } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import { useIsDesktop } from '@/utils/platform';
import { timeAgo } from '@/utils/format';

export default function Dashboard() {
  const { properties, swipes, leads, users, user } = useApp();
  const desktop = useIsDesktop();
  if (user?.role !== 'admin') return <Redirect href="/" />;
  const clients = users.filter((u) => u.role === 'user');
  const likes = swipes.filter((s) => s.action !== 'dislike');
  const rate = swipes.length ? Math.round((likes.length / swipes.length) * 100) : 0;

  const stats: { icon: IconName; label: string; value: string | number; color: string }[] = [
    {
      icon: 'business',
      label: 'Biens actifs',
      value: properties.filter((p) => p.status === 'disponible' && (p.approval ?? 'validé') === 'validé').length,
      color: Colors.primary,
    },
    { icon: 'time', label: 'Biens à valider', value: properties.filter((p) => p.approval === 'en attente').length, color: Colors.gold },
    { icon: 'people', label: 'Clients', value: clients.length, color: Colors.star },
    { icon: 'flame', label: 'Leads nouveaux', value: leads.filter((l) => l.status === 'nouveau').length, color: Colors.orange },
    { icon: 'calendar', label: 'Visites à confirmer', value: leads.filter((l) => l.visitStatus === 'demandée').length, color: Colors.star },
    { icon: 'person-add', label: 'Leads à assigner', value: leads.filter((l) => !l.assignedTo).length, color: Colors.magenta },
    { icon: 'heart', label: 'Taux de like', value: `${rate}%`, color: Colors.like },
  ];

  const popularity = properties
    .map((p) => ({
      p,
      likes: likes.filter((s) => s.propertyId === p.id).length,
      views: swipes.filter((s) => s.propertyId === p.id).length,
    }))
    .filter((x) => x.views > 0)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 4);

  return (
    <Screen>
      <Header title="Admin" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.hello}>Bonjour {user?.name.split(' ')[0]} </Text>
        <Text style={styles.sub}>Voici l’activité Selix en temps réel.</Text>

        <View style={styles.grid}>
          {stats.map((s) => (
            <Card key={s.label} style={[styles.stat, desktop && styles.statDesktop]}>
              <View style={[styles.statIcon, { backgroundColor: s.color }]}>
                <Ionicons name={s.icon} size={18} color="#fff" />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Card>
          ))}
        </View>

        <GradientButton
          label="Ajouter un bien"
          icon="add-circle"
          onPress={() => router.push({ pathname: '/edit-property', params: { id: 'new' } })}
          style={{ marginVertical: 20 }}
        />

        <SectionTitle>Derniers leads</SectionTitle>
        {leads.slice(0, 4).map((l) => {
          const c = users.find((u) => u.id === l.userId);
          const p = properties.find((x) => x.id === l.propertyId);
          return (
            <View key={l.id} style={styles.lead}>
              <Ionicons
                name={l.kind === 'visite' ? 'calendar' : 'heart'}
                size={18}
                color={l.kind === 'visite' ? Colors.pink : Colors.like}
              />
              <Text style={styles.leadText} numberOfLines={1}>
                <Text style={{ fontWeight: '700' }}>{c?.name ?? 'Client'}</Text>
                {l.kind === 'visite' ? ' veut visiter ' : ' aime '}
                {p?.title ?? 'un bien'}
              </Text>
              <Text style={styles.time}>{timeAgo(l.createdAt)}</Text>
            </View>
          );
        })}
        {!leads.length && <Text style={styles.sub}>Aucun lead pour l’instant.</Text>}
        {leads.length > 4 && (
          <GradientButton label="Voir tous les leads" variant="ghost" onPress={() => router.push('/leads')} style={{ marginTop: 8 }} />
        )}

        <SectionTitle style={{ marginTop: 24 }}>Biens les plus aimés</SectionTitle>
        <View style={{ gap: 10 }}>
          {popularity.map(({ p, likes: n, views }) => (
            <PropertyRow
              key={p.id}
              property={p}
              right={
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.likes}>{n} ♥</Text>
                  <Text style={styles.time}>{views} vues</Text>
                </View>
              }
            />
          ))}
          {!popularity.length && <Text style={styles.sub}>Les statistiques apparaîtront après les premiers swipes.</Text>}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { color: '#fff', fontSize: 26, fontWeight: '600' },
  sub: { color: Colors.textMuted, fontSize: 14, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 20 },
  stat: { width: '47%', flexGrow: 1, gap: 6 },
  statDesktop: { width: '14%' },
  statIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: '#fff', fontSize: 26, fontWeight: '800' },
  statLabel: { color: Colors.textMuted, fontSize: 12 },
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    marginBottom: 8,
  },
  leadText: { flex: 1, color: '#fff', fontSize: 13 },
  time: { color: Colors.textFaint, fontSize: 11 },
  likes: { color: Colors.magenta, fontWeight: '800', fontSize: 16 },
});
