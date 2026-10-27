import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Gradients } from '@/constants/theme';
import { MONTHS_FR, addDays, dayKey, monthMatrix, sameDay, startOfDay } from '@/utils/dates';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type Props = {
  value?: Date | null;
  onChange: (day: Date) => void;
  /** Premier et dernier jour sélectionnables. */
  minDate: Date;
  maxDate: Date;
  /** Nombre d'éléments par jour (clé « 2026-10-31 ») : affiche un point sous le jour. */
  marks?: Record<string, number>;
};

/** Calendrier mensuel (lundi en premier), aux couleurs de Selix. */
export function MonthCalendar({ value, onChange, minDate, maxDate, marks }: Props) {
  const start = startOfDay(value ?? minDate);
  const [cursor, setCursor] = useState({ year: start.getFullYear(), month: start.getMonth() });
  const today = startOfDay(new Date());
  const min = startOfDay(minDate);
  const max = startOfDay(maxDate);

  const weeks = monthMatrix(cursor.year, cursor.month);
  const canPrev = new Date(cursor.year, cursor.month, 0) >= min;
  const canNext = new Date(cursor.year, cursor.month + 1, 1) <= max;
  const move = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  return (
    <View>
      <View style={styles.head}>
        <Pressable onPress={() => move(-1)} disabled={!canPrev} hitSlop={10} accessibilityLabel="Mois précédent" style={[styles.nav, !canPrev && styles.dim]}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </Pressable>
        <Text style={styles.month}>
          {MONTHS_FR[cursor.month]} {cursor.year}
        </Text>
        <Pressable onPress={() => move(1)} disabled={!canNext} hitSlop={10} accessibilityLabel="Mois suivant" style={[styles.nav, !canNext && styles.dim]}>
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.row}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.row}>
          {week.map((day, di) => {
            if (!day) return <View key={di} style={styles.cell} />;
            const disabled = day < min || day > max;
            const selected = !!value && sameDay(day, value);
            const count = marks?.[dayKey(day)] ?? 0;
            return (
              <Pressable
                key={di}
                disabled={disabled}
                onPress={() => onChange(day)}
                accessibilityLabel={`${day.getDate()} ${MONTHS_FR[day.getMonth()]}`}
                style={styles.cell}>
                <View style={[styles.day, sameDay(day, today) && !selected && styles.today]}>
                  {selected && <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
                  <Text style={[styles.dayText, disabled && styles.disabled, selected && styles.selectedText]}>{day.getDate()}</Text>
                </View>
                {count > 0 && <View style={[styles.dot, selected && { backgroundColor: '#fff' }]} />}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Dernier jour réservable : aujourd'hui + N jours. */
export const lastBookableDay = (days: number) => addDays(startOfDay(new Date()), days);

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  nav: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.3 },
  month: { color: '#fff', fontSize: 17, fontWeight: '700', textTransform: 'capitalize' },
  row: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: Colors.textFaint, fontSize: 12, fontWeight: '700', paddingBottom: 8 },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', maxHeight: 48 },
  day: { width: '84%', aspectRatio: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  today: { borderWidth: 1, borderColor: Colors.pink },
  dayText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  disabled: { color: 'rgba(255,255,255,0.22)', fontWeight: '400' },
  selectedText: { color: '#fff', fontWeight: '800' },
  dot: { position: 'absolute', bottom: 3, width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.gold },
});
