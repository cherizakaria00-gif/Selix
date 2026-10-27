import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Logo, type IconName } from '@/components/ui';
import { Colors, Gradients, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { Role } from '@/types';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Super admin',
  commercial: 'Espace commercial',
  promoteur: 'Espace promoteur',
  user: 'Client',
};

const ICONS: Record<string, IconName> = {
  dashboard: 'grid',
  properties: 'business',
  leads: 'people',
  agenda: 'calendar',
  settings: 'settings',
  team: 'people-circle',
};

/** Menu latéral du tableau de bord admin sur grand écran (app.selix.io). */
export function AdminSidebar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const { user, logout } = useApp();

  return (
    <View style={styles.sidebar}>
      <View style={styles.brand}>
        <Logo height={34} />
        <Text style={styles.brandSub}>{ROLE_LABEL[user?.role ?? 'admin']}</Text>
      </View>

      <View style={styles.nav}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          if (options.hidden) return null; // onglet non autorisé pour ce rôle
          const focused = state.index === index;
          const label = typeof options.title === 'string' ? options.title : route.name;
          const badge = options.tabBarBadge;
          return (
            <NavItem key={route.key} focused={focused} onPress={() => !focused && navigateToTab(route.key)}>
              {focused && (
                <LinearGradient
                  colors={Gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[StyleSheet.absoluteFill, { borderRadius: Radius.md }]}
                />
              )}
              <Ionicons
                name={ICONS[route.name] ?? 'ellipse'}
                size={20}
                color={focused ? '#fff' : Colors.textMuted}
              />
              <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
              {badge !== undefined && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              )}
            </NavItem>
          );
        })}
      </View>

      <View style={styles.footer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName} numberOfLines={1}>
            {user?.name}
          </Text>
          <Text style={styles.userMail} numberOfLines={1}>
            {user?.email}
          </Text>
        </View>
        <Pressable onPress={logout} hitSlop={8} accessibilityLabel="Se déconnecter">
          <Ionicons name="log-out-outline" size={20} color={Colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function NavItem({ focused, onPress, children }: { focused: boolean; onPress: () => void; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="link"
      accessibilityState={{ selected: focused }}
      style={[styles.item, hovered && !focused && styles.itemHover]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 260,
    height: '100%',
    backgroundColor: '#0E0422',
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  brand: { paddingHorizontal: 8, marginBottom: 32, gap: 6 },
  brandSub: { color: Colors.pink, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  nav: { gap: 6, flex: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.md,
  },
  itemHover: { backgroundColor: Colors.card },
  label: { color: Colors.textMuted, fontSize: 15, fontWeight: '600', flex: 1 },
  labelActive: { color: '#fff' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '800' },
  userName: { color: '#fff', fontWeight: '700', fontSize: 13 },
  userMail: { color: Colors.textFaint, fontSize: 11 },
});
