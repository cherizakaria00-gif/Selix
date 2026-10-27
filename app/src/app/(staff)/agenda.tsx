import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MonthCalendar } from '@/components/calendar';
import { PropertyImage } from '@/components/property-card';
import { VisitBlock } from '@/components/visit-actions';
import { Card, Empty, Header, Screen, SectionTitle } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { Lead } from '@/types';
import { addDays, dayKey, formatDay, formatTime, startOfDay, ucfirst } from '@/utils/dates';
import { useIsDesktop } from '@/utils/platform';

/** Agenda des visites : celles à confirmer, puis le calendrier du mois avec le détail de chaque journée. */
export default function Agenda() {
  const { user, leads } = useApp();
  const desktop = useIsDesktop();

  const visits = useMemo(
    () => leads.filter((l) => l.visitAt && l.visitStatus !== 'annulée').sort((a, b) => a.visitAt! - b.visitAt!),
    [leads],
  );
  const [today] = useState(() => startOfDay(new Date()));
  // Au départ : le jour de la prochaine visite, sinon aujourd'hui.
  const [selected, setSelected] = useState<Date>(() => {
    const next = visits.find((l) => l.visitAt! >= Date.now());
    return next ? startOfDay(new Date(next.visitAt!)) : startOfDay(new Date());
  });

  if (!user || (user.role !== 'admin' && user.role !== 'commercial')) return <Redirect href="/" />;

  const pending = visits.filter((l) => l.visitStatus === 'demandée');
  const marks: Record<string, number> = {};
  for (const l of visits) {
    const k = dayKey(new Date(l.visitAt!));
    marks[k] = (marks[k] ?? 0) + 1;
  }
  const ofDay = visits.filter((l) => dayKey(new Date(l.visitAt!)) === dayKey(selected));

  const calendar = (
    <Card style={desktop ? { width: 380 } : undefined}>
      <MonthCalendar value={selected} onChange={setSelected} minDate={addDays(today, -90)} maxDate={addDays(today, 365)} marks={marks} />
      <Text style={styles.legend}>● jours avec visite</Text>
    </Card>
  );

  const day = (
    <View style={{ flex: 1, gap: 12 }}>
      <SectionTitle style={{ marginBottom: 0 }}>{ucfirst(formatDay(selected))}</SectionTitle>
      {ofDay.length === 0 ? (
        <Empty icon="calendar-outline" title="Aucune visite ce jour-là" text="Les visites demandées par les clients apparaissent ici." />
      ) : (
        ofDay.map((l) => <VisitCard key={l.id} lead={l} />)
      )}
    </View>
  );

  return (
    <Screen>
      <Header title="Agenda" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}>
        {pending.length > 0 && (
          <View style={{ gap: 12 }}>
            <SectionTitle style={{ marginBottom: 0 }}>À confirmer ({pending.length})</SectionTitle>
            {pending.map((l) => (
              <VisitCard key={l.id} lead={l} showDay onSelectDay={() => setSelected(startOfDay(new Date(l.visitAt!)))} />
            ))}
          </View>
        )}
        <View style={desktop ? { flexDirection: 'row', gap: 20, alignItems: 'flex-start' } : { gap: 18 }}>
          {calendar}
          {day}
        </View>
      </ScrollView>
    </Screen>
  );
}

function VisitCard({ lead, showDay, onSelectDay }: { lead: Lead; showDay?: boolean; onSelectDay?: () => void }) {
  const { properties } = useApp();
  const p = properties.find((x) => x.id === lead.propertyId);
  const client = lead.client;
  return (
    <Card>
      <View style={styles.top}>
        <View style={styles.time}>
          <Text style={styles.timeText}>{formatTime(lead.visitAt!)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.client}>{client?.name ?? 'Client'}</Text>
          {client?.phone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${client.phone}`)}>
              <Text style={styles.phone}>{client.phone}</Text>
            </Pressable>
          ) : null}
        </View>
        {showDay && onSelectDay && (
          <Pressable onPress={onSelectDay} hitSlop={8} accessibilityLabel="Voir ce jour dans le calendrier">
            <Ionicons name="calendar-outline" size={20} color={Colors.pink} />
          </Pressable>
        )}
      </View>
      {p && (
        <Pressable style={styles.property} onPress={() => router.push({ pathname: '/property/[id]', params: { id: p.id } })}>
          <PropertyImage src={p.images[0]} style={styles.thumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pTitle}>{p.title}</Text>
            <Text style={styles.meta}>
              {p.district}, {p.city}
            </Text>
          </View>
        </Pressable>
      )}
      <VisitBlock lead={lead} />
    </Card>
  );
}

const styles = StyleSheet.create({
  legend: { color: Colors.textFaint, fontSize: 11, marginTop: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  timeText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  client: { color: '#fff', fontWeight: '700', fontSize: 16 },
  phone: { color: Colors.pink, fontSize: 13, fontWeight: '600', marginTop: 2 },
  property: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 8,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  thumb: { width: 48, height: 48, borderRadius: 10 },
  pTitle: { color: '#fff', fontWeight: '600' },
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
});
