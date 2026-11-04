import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PropertyImage } from '@/components/property-card';
import { Card, Chip, Empty, Header, KeyboardAware, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { VisitBlock } from '@/components/visit-actions';
import { openWhatsApp } from '@/services/geo';
import { useApp } from '@/store/app-store';
import type { Lead, LeadStatus } from '@/types';
import { formatPrice, timeAgo } from '@/utils/format';

const STATUSES: LeadStatus[] = ['nouveau', 'contacté', 'visite planifiée', 'clôturé'];
const KIND_LABEL = { visite: 'Demande de visite', like: 'A aimé ce bien', contact: 'Demande de contact' } as const;

export default function Leads() {
  const { user, leads, users } = useApp();
  const [filter, setFilter] = useState<LeadStatus | 'all' | 'unassigned'>('all');

  if (!user || (user.role !== 'admin' && user.role !== 'commercial')) return <Redirect href="/" />;
  const isAdmin = user.role === 'admin';
  const commercials = users.filter((u) => u.role === 'commercial' && !u.disabled);
  const unassigned = leads.filter((l) => !l.assignedTo).length;
  const list = leads.filter((l) =>
    filter === 'all' ? true : filter === 'unassigned' ? !l.assignedTo : l.status === filter,
  );

  return (
    <Screen>
      <Header title={isAdmin ? 'Leads' : 'Mes leads'} />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <Chip label={`Tous (${leads.length})`} active={filter === 'all'} onPress={() => setFilter('all')} />
          {isAdmin && (
            <Chip
              label={`À assigner (${unassigned})`}
              icon="alert-circle-outline"
              active={filter === 'unassigned'}
              onPress={() => setFilter('unassigned')}
            />
          )}
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
      <KeyboardAware>
        <FlatList
          data={list}
          keyExtractor={(l) => l.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40, flexGrow: 1 }}
          renderItem={({ item }) => <LeadCard lead={item} isAdmin={isAdmin} commercials={commercials} />}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Empty
                icon="people-outline"
                title={isAdmin ? 'Aucun lead' : 'Aucun lead pour le moment'}
                text={
                  isAdmin
                    ? 'Chaque like ou demande de visite d’un client apparaît ici. Assignez-le à un commercial.'
                    : 'Les leads que le super admin vous assigne apparaissent ici.'
                }
              />
            </View>
          }
        />
      </KeyboardAware>
    </Screen>
  );
}

function LeadCard({
  lead,
  isAdmin,
  commercials,
}: {
  lead: Lead;
  isAdmin: boolean;
  commercials: { id: string; name: string }[];
}) {
  const { properties, updateLead, assignLead, swipes } = useApp();
  const [note, setNote] = useState(lead.note ?? '');
  const p = properties.find((x) => x.id === lead.propertyId);
  const client = lead.client;
  const superlike = swipes.some((s) => s.userId === lead.userId && s.propertyId === lead.propertyId && s.action === 'superlike');
  const noteChanged = note.trim() !== (lead.note ?? '');

  return (
    <Card>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.client}>{client?.name ?? 'Client'}</Text>
          <Text style={styles.meta}>
            {KIND_LABEL[lead.kind]}
            {superlike ? ' · Coup de cœur' : ''} · {timeAgo(lead.createdAt)}
          </Text>
          {client?.phone ? <Text style={styles.phone}>{client.phone}</Text> : null}
        </View>
        {client?.phone ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={styles.action} accessibilityLabel="Appeler" onPress={() => Linking.openURL(`tel:${client.phone}`)}>
              <Ionicons name="call" size={18} color="#fff" />
            </Pressable>
            <Pressable
              style={[styles.action, { backgroundColor: '#1FA855' }]}
              accessibilityLabel="WhatsApp"
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

      {p ? (
        <Pressable style={styles.property} onPress={() => router.push({ pathname: '/property/[id]', params: { id: p.id } })}>
          <PropertyImage src={p.images[0]} style={styles.thumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pTitle}>{p.title}</Text>
            <Text style={styles.meta}>
              {p.district}, {p.city} · {formatPrice(p.price, p.transaction)}
            </Text>
          </View>
        </Pressable>
      ) : (
        <Text style={[styles.meta, { marginTop: 12 }]}>Ce bien n’est plus publié.</Text>
      )}

      <VisitBlock lead={lead} />

      {isAdmin && (
        <View style={{ marginTop: 14 }}>
          <Text style={styles.label}>Assigné à</Text>
          {commercials.length ? (
            <View style={styles.chips}>
              <Chip label="Non assigné" active={!lead.assignedTo} onPress={() => lead.assignedTo && assignLead(lead.id, null)} />
              {commercials.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  icon="person"
                  active={lead.assignedTo === c.id}
                  onPress={() => lead.assignedTo !== c.id && assignLead(lead.id, c.id)}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>Aucun commercial actif : créez-en un dans l’onglet Équipe.</Text>
          )}
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <Text style={styles.label}>Suivi</Text>
        <View style={styles.chips}>
          {STATUSES.map((s) => (
            <Chip key={s} label={s} active={lead.status === s} onPress={() => lead.status !== s && updateLead(lead.id, { status: s })} />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 14 }}>
        <Text style={styles.label}>Note</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Ex. : rappeler samedi, budget 3 M, cherche un T3…"
          placeholderTextColor={Colors.textFaint}
          multiline
          style={styles.note}
        />
        {noteChanged && (
          <Pressable style={styles.saveNote} onPress={() => updateLead(lead.id, { note: note.trim() })}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.saveNoteText}>Enregistrer la note</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: 16, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  client: { color: '#fff', fontWeight: '700', fontSize: 16 },
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  phone: { color: Colors.pink, fontSize: 13, marginTop: 4, fontWeight: '600' },
  label: { color: Colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  note: {
    color: '#fff',
    fontSize: 14,
    minHeight: 64,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    textAlignVertical: 'top',
  },
  saveNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  saveNoteText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
