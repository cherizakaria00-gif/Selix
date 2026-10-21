import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { PropertyHero } from '@/components/property-card';
import { Colors, Radius } from '@/constants/theme';
import type { Scored } from '@/services/ai';
import type { SwipeAction } from '@/types';

type Props = {
  items: Scored[];
  onSwipe: (propertyId: string, action: SwipeAction) => void;
  /** Action déclenchée par les boutons sous le deck. */
  forced: SwipeAction | null;
  onForcedDone: () => void;
};

export function SwipeDeck({ items, onSwipe, forced, onForcedDone }: Props) {
  const [top, next] = items;
  return (
    <View style={styles.deck}>
      {next && (
        <View style={[StyleSheet.absoluteFill, styles.behind]} pointerEvents="none">
          <PropertyHero property={next.property} score={next.score} />
        </View>
      )}
      {top && (
        <TopCard
          key={top.property.id}
          item={top}
          onSwipe={onSwipe}
          forced={forced}
          onForcedDone={onForcedDone}
        />
      )}
    </View>
  );
}

function TopCard({
  item,
  onSwipe,
  forced,
  onForcedDone,
}: {
  item: Scored;
  onSwipe: Props['onSwipe'];
  forced: SwipeAction | null;
  onForcedDone: () => void;
}) {
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const threshold = width * 0.28;
  const id = item.property.id;

  function commit(action: SwipeAction) {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(
        action === 'dislike' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      );
    }
    onSwipe(id, action);
  }

  function fly(action: SwipeAction) {
    const toX = action === 'dislike' ? -width * 1.5 : action === 'like' ? width * 1.5 : 0;
    const toY = action === 'superlike' ? -900 : 60;
    tx.set(withTiming(toX, { duration: 260 }));
    ty.set(
      withTiming(toY, { duration: 260 }, (done) => {
        if (done) scheduleOnRN(commit, action);
      }),
    );
  }

  const onForced = useEffectEvent((action: SwipeAction) => {
    fly(action);
    onForcedDone();
  });
  useEffect(() => {
    if (forced) onForced(forced);
  }, [forced]);

  // Recréé à chaque rendu (le React Compiler mémoïse) : commit voit toujours les props courantes.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.set(e.translationX);
      ty.set(e.translationY);
    })
    .onEnd((e) => {
      const vx = e.velocityX;
      if (e.translationY < -160 && Math.abs(e.translationX) < threshold) {
        ty.set(withTiming(-900, { duration: 240 }, () => scheduleOnRN(commit, 'superlike' as SwipeAction)));
      } else if (e.translationX > threshold || vx > 900) {
        tx.set(withTiming(width * 1.5, { duration: 220 }, () => scheduleOnRN(commit, 'like' as SwipeAction)));
      } else if (e.translationX < -threshold || vx < -900) {
        tx.set(withTiming(-width * 1.5, { duration: 220 }, () => scheduleOnRN(commit, 'dislike' as SwipeAction)));
      } else {
        tx.set(withSpring(0));
        ty.set(withSpring(0));
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.get() },
      { translateY: ty.get() },
      { rotate: `${interpolate(tx.get(), [-width, 0, width], [-14, 0, 14])}deg` },
    ],
  }));
  const likeStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.get(), [0, threshold], [0, 1], 'clamp') }));
  const nopeStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.get(), [-threshold, 0], [1, 0], 'clamp') }));
  const superStyle = useAnimatedStyle(() => ({ opacity: interpolate(ty.get(), [-160, 0], [1, 0], 'clamp') }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[StyleSheet.absoluteFill, cardStyle]}>
        <PropertyHero property={item.property} score={item.score} />

        {item.reasons.length > 0 && (
          <View style={styles.reasons} pointerEvents="none">
            {item.reasons.map((r) => (
              <View key={r} style={styles.reason}>
                <Ionicons name="checkmark" size={11} color={Colors.like} />
                <Text style={styles.reasonText}>{r}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          style={styles.info}
          hitSlop={8}
          onPress={() => router.push({ pathname: '/property/[id]', params: { id } })}>
          <Ionicons name="information" size={20} color="#fff" />
        </Pressable>

        <Animated.View style={[styles.stamp, styles.stampLike, likeStyle]} pointerEvents="none">
          <Text style={[styles.stampText, { color: Colors.like }]}>J’AIME</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampNope, nopeStyle]} pointerEvents="none">
          <Text style={[styles.stampText, { color: Colors.dislike }]}>NON</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampSuper, superStyle]} pointerEvents="none">
          <Text style={[styles.stampText, { color: Colors.star }]}>COUP DE CŒUR</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export function SwipeButtons({ onPress, disabled }: { onPress: (a: SwipeAction) => void; disabled?: boolean }) {
  return (
    <View style={[styles.buttons, disabled && { opacity: 0.4 }]}>
      <Pressable disabled={disabled} onPress={() => onPress('dislike')} style={[styles.round, { borderColor: Colors.dislike }]}>
        <Ionicons name="close" size={30} color={Colors.dislike} />
      </Pressable>
      <Pressable
        disabled={disabled}
        onPress={() => onPress('superlike')}
        style={[styles.round, styles.roundSmall, { borderColor: Colors.star }]}>
        <Ionicons name="star" size={20} color={Colors.star} />
      </Pressable>
      <Pressable disabled={disabled} onPress={() => onPress('like')} style={[styles.round, { borderColor: Colors.like }]}>
        <Ionicons name="heart" size={30} color={Colors.like} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { flex: 1, marginHorizontal: 20, marginVertical: 8 },
  behind: { transform: [{ scale: 0.94 }, { translateY: 14 }], opacity: 0.6 },
  reasons: { position: 'absolute', top: 58, left: 16, gap: 6 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(18,6,42,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  reasonText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  info: {
    position: 'absolute',
    right: 16,
    top: 56,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(18,6,42,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stamp: {
    position: 'absolute',
    top: 110,
    borderWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  stampLike: { left: 24, borderColor: Colors.like, transform: [{ rotate: '-14deg' }] },
  stampNope: { right: 24, borderColor: Colors.dislike, transform: [{ rotate: '14deg' }] },
  stampSuper: { alignSelf: 'center', top: 200, borderColor: Colors.star },
  stampText: { fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  buttons: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 34, paddingVertical: 14 },
  round: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,6,42,0.6)',
  },
  roundSmall: { width: 50, height: 50, borderRadius: 25 },
});
