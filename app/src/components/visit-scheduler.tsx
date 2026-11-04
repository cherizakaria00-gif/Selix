import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MonthCalendar, lastBookableDay } from '@/components/calendar';
import { GradientButton } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import {
  MAX_DAYS_AHEAD,
  SLOT_MINUTES,
  formatDay,
  formatVisit,
  isSlotTaken,
  slotLabel,
  slotTimestamp,
  startOfDay,
} from '@/utils/dates';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Visites déjà confirmées sur ce bien (millisecondes) : leurs créneaux sont grisés. */
  busy: number[];
  /** Date déjà choisie (modification d'une visite). */
  initial?: number | null;
  confirmLabel: string;
  /** Demander une note au client (« préférences, nombre de personnes… »). */
  askNote?: boolean;
  /** Envoie le créneau ; renvoyer une erreur la montre dans la fenêtre sans la fermer. */
  onSubmit: (visitAt: number, note: string) => Promise<void>;
};

/** Fenêtre « Choisir une date de visite » : calendrier + créneaux de 30 minutes. */
export function VisitScheduler(props: Props) {
  // Le contenu n'existe que pendant l'ouverture : chaque ouverture repart de la visite existante,
  // ou d'une page blanche, avec l'heure du moment.
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      {props.visible ? <Sheet {...props} /> : null}
    </Modal>
  );
}

function Sheet({ onClose, title, subtitle, busy, initial, confirmLabel, askNote, onSubmit }: Props) {
  const [day, setDay] = useState<Date | null>(() => (initial ? startOfDay(new Date(initial)) : null));
  const [slot, setSlot] = useState<number | null>(() => (initial ? new Date(initial).getHours() * 60 + new Date(initial).getMinutes() : null));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [now] = useState(() => Date.now());

  const minDate = startOfDay(new Date());
  const maxDate = lastBookableDay(MAX_DAYS_AHEAD);
  const chosen = day && slot !== null ? slotTimestamp(day, slot) : null;
  const morning = SLOT_MINUTES.filter((m) => m < 13 * 60);
  const afternoon = SLOT_MINUTES.filter((m) => m >= 13 * 60);

  async function submit() {
    if (chosen === null) return;
    setSending(true);
    setError('');
    try {
      await onSubmit(chosen, note.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSlot(null); // le créneau a peut-être été pris entre-temps
    } finally {
      setSending(false);
    }
  }

  const renderSlots = (list: number[], label: string) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.slots}>
        {list.map((m) => {
          const ts = day ? slotTimestamp(day, m) : 0;
          const taken = isSlotTaken(ts, busy, now);
          const active = slot === m;
          return (
            <Pressable
              key={m}
              disabled={taken}
              onPress={() => setSlot(m)}
              accessibilityLabel={`Créneau ${slotLabel(m)}${taken ? ' indisponible' : ''}`}
              style={[styles.slot, active && styles.slotActive, taken && styles.slotTaken]}>
              <Text style={[styles.slotText, active && { color: '#fff' }, taken && styles.slotTakenText]}>{slotLabel(m)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fermer" />
        <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.grab} />
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityLabel="Fermer">
                <Ionicons name="close" size={20} color="#fff" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
              <MonthCalendar
                value={day}
                onChange={(d) => {
                  setDay(d);
                  setSlot(null);
                }}
                minDate={minDate}
                maxDate={maxDate}
              />

              {day ? (
                <View style={{ marginTop: 18 }}>
                  <Text style={styles.sectionTitle}>Horaires du {formatDay(day)}</Text>
                  {renderSlots(morning, 'Matin')}
                  {renderSlots(afternoon, 'Après-midi')}
                </View>
              ) : (
                <Text style={styles.hint}>Choisissez d’abord un jour, puis un horaire.</Text>
              )}

              {askNote && chosen !== null && (
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Un message pour le commercial ? (facultatif)"
                  placeholderTextColor={Colors.textFaint}
                  multiline
                  style={styles.note}
                />
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>

            <View style={styles.footer}>
              {chosen !== null && (
                <View style={styles.summary}>
                  <Ionicons name="calendar" size={18} color={Colors.pink} />
                  <Text style={styles.summaryText}>{formatVisit(chosen)}</Text>
                </View>
              )}
              <GradientButton label={confirmLabel} icon="checkmark" disabled={chosen === null} loading={sending} onPress={submit} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,1,15,0.72)', justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  sheet: {
    backgroundColor: '#17082F',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    paddingBottom: 24,
    maxHeight: '92%',
  },
  grab: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 10 },
  groupLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: {
    minWidth: 72,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  slotActive: { backgroundColor: Colors.primary, borderColor: Colors.pink },
  slotTaken: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.06)' },
  slotText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  slotTakenText: { color: 'rgba(255,255,255,0.22)', textDecorationLine: 'line-through', fontWeight: '400' },
  hint: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 18 },
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
    marginTop: 4,
  },
  error: { color: Colors.dislike, fontSize: 13, marginTop: 10, lineHeight: 18 },
  footer: { gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  summaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
