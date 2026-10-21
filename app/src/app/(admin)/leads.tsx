import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PropertyImage } from '@/components/property-card';
import { Card, Chip, Empty, Header, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { openWhatsApp } from '@/services/geo';
import { useApp } from '@/store/app-store';
import type { LeadStatus } from '@/types';
import { formatPrice, timeAgo } from '@/utils/format';

const STATUSES: LeadStatus[] = ['nouveau', 'contacté', 'visite planifiée', 'clôturé'];

export default function Leads() {
  const { leads, users, properties, updateLead, swipes } = useApp();
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');
  const list = leads.filter((l) => filter === 'all' || l.status === filter);

  return (
    <Screen>
      <Header title="Leads" />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <Chip label={`Tous (${leads.length})`} active={filter === 'all'} onPress={() => setFilter('all')} />
          {STATUSES.map((s) => (
            <Chip
              key={s}
              label={`${s} (${leads.filter((l) => l.status === s).length})`}
              active={filter === s}
              onPress={() => setFilter(s)}
            />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={list}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40, flexGrow: 1 }}
        renderItem={({ item }) => {
          const client = users.find((u) => u.id === item.userId);
          const p = properties.find((x) => x.id === item.propertyId);
          const superlike = swipes.some(
            (s) => s.userId === item.userId && s.propertyId === item.propertyId && s.action === 'superlike',
          );
          return (
            <Card>
              <View style={styles.top}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.client}>{client?.name ?? 'Client supprimé'}</Text>
                  <Text style={styles.meta}>
                    {item.kind === 'visite' ? 'Demande de visite' : superlike ? 'Coup de cœur' : 'Like'} ·{' '}
                    {timeAgo(item.createdAt)}
                  </Text>
                </View>
                {client?.phone ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable style={styles.action} onPress={() => Linking.openURL(`tel:${client.phone}`)}>
                      <Ionicons name="call" size={18} color="#fff" />
                    </Pressable>
                    <Pressable
                      style={[styles.action, { backgroundColor: '#1FA855' }]}
                      onPress={() =>
                        openWhatsApp(
                          client.phone,
                          `Bonjour ${client.name}, ici Selix. Vous avez aimé « ${p?.title ?? 'un bien'} », souhaitez-vous organiser une visite ?`,
                        )
                      }>
                      <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                    </Pressable>
                  </View>
                ) : null}
              </View>
              {p && (
                <Pressable
                  style={styles.property}
                  onPress={() => router.push({ pathname: '/property/[id]', params: { id: p.id } })}>
                  <PropertyImage src={p.images[0]} style={styles.thumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pTitle}>{p.title}</Text>
                    <Text style={styles.meta}>
                      {p.district}, {p.city} · {formatPrice(p.price, p.transaction)}
                    </Text>
                  </View>
                </Pressable>
              )}
              <View style={styles.statuses}>
                {STATUSES.map((s) => (
                  <Chip key={s} label={s} active={item.status === s} onPress={() => updateLead(item.id, { status: s })} />
                ))}
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Empty
              icon="people-outline"
              title="Aucun lead"
              text="Chaque like ou demande de visite d’un client apparaît ici pour que l’équipe commerciale le contacte."
            />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: 16, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  client: { color: '#fff', fontWeight: '700', fontSize: 16 },
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  action: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  property: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 8,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  thumb: { width: 54, height: 54, borderRadius: 10 },
  pTitle: { color: '#fff', fontWeight: '600' },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
});
