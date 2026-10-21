import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SwipeButtons, SwipeDeck } from '@/components/swipe-deck';
import { Empty, GradientButton, Header, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { describeProfile } from '@/services/ai';
import { useApp } from '@/store/app-store';
import type { SwipeAction } from '@/types';

export default function Match() {
  const { deck, swipe, resetSwipes, profile } = useApp();
  const [forced, setForced] = useState<SwipeAction | null>(null);
  const [toast, setToast] = useState('');
  const criteria = describeProfile(profile);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  function handleSwipe(id: string, action: SwipeAction) {
    swipe(id, action);
    if (action === 'like') setToast('Ajouté à vos biens — un commercial va vous contacter');
    if (action === 'superlike') setToast('Coup de cœur ! Votre dossier passe en priorité');
  }

  return (
    <Screen>
      <Header
        right={
          <Pressable onPress={() => router.push('/assistant')} style={styles.ai} hitSlop={8}>
            <Ionicons name="sparkles" size={18} color="#fff" />
          </Pressable>
        }
      />
      <View style={styles.titles}>
        <Text style={styles.title}>Swipe to like</Text>
        <Text style={styles.subtitle}>Un commercial va vous contacter</Text>
        {criteria ? (
          <Pressable onPress={() => router.push('/assistant')} style={styles.criteria}>
            <Ionicons name="options-outline" size={14} color={Colors.textMuted} />
            <Text style={styles.criteriaText} numberOfLines={1}>
              {criteria}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {deck.length ? (
        <>
          <SwipeDeck items={deck} onSwipe={handleSwipe} forced={forced} onForcedDone={() => setForced(null)} />
          <SwipeButtons onPress={setForced} disabled={!!forced} />
        </>
      ) : (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Empty
            icon="heart-circle-outline"
            title="Vous avez tout vu !"
            text="L’IA a appris de vos choix. Vous serez notifié dès qu’un nouveau bien vous correspond."
            action={
              <View style={{ gap: 12, alignSelf: 'stretch', paddingHorizontal: 20 }}>
                <GradientButton label="Affiner avec l’assistant" icon="sparkles" onPress={() => router.push('/assistant')} />
                <GradientButton label="Revoir les biens passés" variant="ghost" onPress={resetSwipes} />
              </View>
            }
          />
        </View>
      )}

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ai: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { paddingHorizontal: 24 },
  title: { color: Colors.pink, fontSize: 28, fontWeight: '500' },
  subtitle: { color: 'rgba(200,130,230,0.9)', fontSize: 14, marginTop: 2 },
  criteria: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  criteriaText: { color: Colors.textMuted, fontSize: 12, flexShrink: 1 },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 110,
    backgroundColor: 'rgba(29,11,64,0.96)',
    borderColor: Colors.pink,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 14,
  },
  toastText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
});
