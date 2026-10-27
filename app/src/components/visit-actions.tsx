import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { VisitScheduler } from '@/components/visit-scheduler';
import { GradientButton } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { Lead } from '@/types';
import { formatVisit, ucfirst } from '@/utils/dates';
import { confirmAction, notify } from '@/utils/platform';

const LOOK = {
  demandée: { label: 'Visite à confirmer', color: Colors.orange, icon: 'time' },
  confirmée: { label: 'Visite confirmée', color: Colors.like, icon: 'checkmark-circle' },
  annulée: { label: 'Visite annulée', color: Colors.dislike, icon: 'close-circle' },
} as const;

/** Visite d'un lead côté Selix : le client est prévenu par notification à chaque confirmation ou annulation. */
export function VisitBlock({ lead, title }: { lead: Lead; title?: string }) {
  const { updateVisit, busySlots } = useApp();
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState<number[]>([]);
  const [working, setWorking] = useState(false);

  if (!lead.visitAt) return null;
  const status = lead.visitStatus ?? 'demandée';
  const look = LOOK[status];

  async function run(action: () => Promise<void>) {
    setWorking(true);
    try {
      await action();
    } catch (e) {
      notify('Action impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function openScheduler() {
    setBusy((await busySlots(lead.propertyId)).filter((b) => b !== lead.visitAt));
    setScheduling(true);
  }

  async function cancel() {
    const ok = await confirmAction(
      'Annuler cette visite ?',
      `${lead.client?.name ?? 'Le client'} sera prévenu que sa visite du ${formatVisit(lead.visitAt!)} est annulée.`,
      'Annuler la visite',
    );
    if (ok) await run(() => updateVisit(lead.id, { visitStatus: 'annulée' }));
  }

  return (
    <View style={[styles.box, { borderColor: look.color }]}>
      <View style={styles.head}>
        <Ionicons name={look.icon} size={18} color={look.color} />
        <Text style={[styles.label, { color: look.color }]}>{title ?? look.label}</Text>
      </View>
      <Text style={[styles.date, status === 'annulée' && styles.struck]}>{ucfirst(formatVisit(lead.visitAt))}</Text>

      {status === 'demandée' && (
        <View style={styles.actions}>
          <GradientButton label="Confirmer ce créneau" icon="checkmark" loading={working} onPress={() => run(() => updateVisit(lead.id, { visitStatus: 'confirmée' }))} style={{ flex: 1, minWidth: 180 }} />
          <GradientButton label="Proposer un autre horaire" icon="calendar" variant="ghost" onPress={openScheduler} style={{ flex: 1, minWidth: 180 }} />
        </View>
      )}
      {status === 'confirmée' && (
        <View style={styles.actions}>
          <GradientButton label="Changer l’horaire" icon="calendar" variant="ghost" onPress={openScheduler} style={{ flex: 1, minWidth: 160 }} />
          <GradientButton label="Annuler la visite" icon="close" variant="ghost" loading={working} onPress={cancel} style={{ flex: 1, minWidth: 160 }} />
        </View>
      )}
      {status === 'annulée' && <Text style={styles.hint}>Le client peut redemander une visite à une autre date.</Text>}

      <VisitScheduler
        visible={scheduling}
        onClose={() => setScheduling(false)}
        title="Choisir l’horaire de la visite"
        subtitle="Le client est prévenu dès que vous confirmez."
        busy={busy}
        initial={lead.visitAt}
        confirmLabel="Confirmer ce créneau"
        onSubmit={(visitAt) => updateVisit(lead.id, { visitAt })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 14, padding: 14, borderRadius: Radius.md, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.18)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  date: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 6 },
  struck: { textDecorationLine: 'line-through', color: Colors.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  hint: { color: Colors.textMuted, fontSize: 12, marginTop: 6 },
});
