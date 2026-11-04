import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Colors, Gradients, Radius, Spacing } from '@/constants/theme';
import { isWeb, useIsDesktop } from '@/utils/platform';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Fond d'écran Selix : dégradé violet nuit + halos colorés. */
export function Screen({
  children,
  edges = ['top'],
  style,
}: {
  children: ReactNode;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  const desktop = useIsDesktop();
  return (
    // overflow: les halos décoratifs dépassent du bord ; sur le web ils créaient un défilement horizontal.
    <View style={[styles.flex, { overflow: 'hidden' }]}>
      <LinearGradient colors={Gradients.background} style={StyleSheet.absoluteFill} />
      <View style={[styles.glow, { top: -120, left: -100, backgroundColor: 'rgba(192,16,160,0.18)' }]} />
      <View style={[styles.glow, { top: 220, right: -140, backgroundColor: 'rgba(106,40,234,0.22)' }]} />
      <SafeAreaView edges={edges} style={[styles.flex, desktop && styles.desktop, style]}>
        {children}
      </SafeAreaView>
    </View>
  );
}

/**
 * Zone qui garde ses champs au-dessus du clavier : à placer autour de tout contenu avec un TextInput.
 * Android est en edge-to-edge depuis le SDK 54 : la fenêtre ne se redimensionne plus à l'ouverture
 * du clavier (adjustResize sans effet), il faut donc le même « padding » que sur iOS. Les ScrollView
 * à l'intérieur ramènent ensuite d'elles-mêmes le champ actif dans la zone visible.
 */
export function KeyboardAware({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView behavior={isWeb ? undefined : 'padding'} style={[styles.flex, style]}>
      {children}
    </KeyboardAvoidingView>
  );
}

export function Logo({ height = 36, variant = 'full' }: { height?: number; variant?: 'full' | 'mark' }) {
  if (variant === 'mark') {
    return (
      <Image
        source={require('@/assets/images/mark-white.png')}
        style={{ height, width: height * (682 / 689) }}
        contentFit="contain"
      />
    );
  }
  return (
    <Image
      source={require('@/assets/images/logo-white.png')}
      style={{ height, width: height * (937 / 345) }}
      contentFit="contain"
    />
  );
}

export function Header({ title, right, left }: { title?: string; right?: ReactNode; left?: ReactNode }) {
  const desktop = useIsDesktop();
  // Sur bureau, le logo est déjà dans le menu latéral : le titre prend sa place, aligné à gauche.
  if (desktop && title) {
    return (
      <View style={[styles.header, styles.headerDesktop]}>
        {left}
        <Text style={[styles.headerTitle, styles.headerTitleDesktop]}>{title}</Text>
        {right}
      </View>
    );
  }
  return (
    <View style={styles.header}>
      {left ?? <Logo height={34} />}
      {title ? <Text style={styles.headerTitle}>{title}</Text> : <View style={styles.flex} />}
      {right}
    </View>
  );
}

export function GradientButton({
  label,
  onPress,
  icon,
  loading,
  disabled,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'premium' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const content = loading ? (
    <ActivityIndicator color="#fff" />
  ) : (
    <View style={styles.row}>
      {icon && <Ionicons name={icon} size={18} color="#fff" style={{ marginRight: 8 }} />}
      <Text style={styles.buttonLabel}>{label}</Text>
    </View>
  );
  const colors =
    variant === 'premium' ? Gradients.premium : variant === 'danger' ? (['#E5394A', '#B3142A'] as const) : Gradients.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      {variant === 'ghost' ? (
        <View style={[styles.button, styles.ghost]}>{content}</View>
      ) : (
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
          {content}
        </LinearGradient>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  icon,
  right,
  style,
  ...props
}: TextInputProps & { label?: string; icon?: IconName; right?: ReactNode; ref?: Ref<TextInputInstance> }) {
  return (
    <View style={{ marginBottom: Spacing.md }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.field}>
        {icon && <Ionicons name={icon} size={18} color={Colors.textFaint} style={{ marginRight: 10 }} />}
        <TextInput
          placeholderTextColor={Colors.textFaint}
          selectionColor={Colors.pink}
          style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }, style]}
          {...props}
        />
        {right}
      </View>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  solid,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Fond opaque, pour un chip posé sur une photo ou une carte. */
  solid?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, solid && styles.chipSolid, active && styles.chipActive]}>
      {icon && <Ionicons name={icon} size={14} color={active ? '#fff' : Colors.textMuted} style={{ marginRight: 6 }} />}
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, icon, color = Colors.orange }: { label: string; icon?: IconName; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      {icon && <Ionicons name={icon} size={12} color="#fff" style={{ marginRight: 4 }} />}
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function MatchBadge({ score }: { score: number }) {
  const color = score >= 80 ? Colors.like : score >= 60 ? Colors.pink : Colors.textFaint;
  return (
    <View style={[styles.badge, { backgroundColor: 'rgba(18,6,42,0.75)', borderWidth: 1, borderColor: color }]}>
      <Ionicons name="sparkles" size={12} color={color} style={{ marginRight: 4 }} />
      <Text style={[styles.badgeText, { color }]}>{score}% match</Text>
    </View>
  );
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.section, style]}>{children}</Text>;
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={32} color={Colors.pink} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text && <Text style={styles.emptyText}>{text}</Text>}
      {action}
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  glow: { position: 'absolute', width: 360, height: 360, borderRadius: 180 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  headerTitle: { flex: 1, color: Colors.text, fontSize: 20, fontWeight: '700', textAlign: 'right' },
  headerDesktop: { paddingTop: 28, paddingBottom: 16 },
  headerTitleDesktop: { fontSize: 28, textAlign: 'left' },
  desktop: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 16 },
  button: {
    height: 54,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ghost: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  buttonLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  label: { color: Colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  input: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  chipSolid: { backgroundColor: Colors.bgElevated },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.pink },
  chipText: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: Colors.card,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  section: { color: Colors.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  empty: { alignItems: 'center', padding: 32, gap: 10 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(208,76,224,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: { color: Colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
});
