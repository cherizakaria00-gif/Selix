import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

import type { IconName } from '@/components/ui';
import { Colors } from '@/constants/theme';

export const tabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: Colors.pink,
  tabBarInactiveTintColor: Colors.textFaint,
  tabBarStyle: {
    backgroundColor: '#0E0422',
    borderTopColor: Colors.border,
    height: 84,
    paddingTop: 8,
  },
  tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
  sceneStyle: { backgroundColor: Colors.bg },
};

export function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} size={size} color={color as string} />;
  };
}
