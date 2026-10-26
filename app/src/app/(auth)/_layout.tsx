import { Redirect, Stack, useSegments } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import { isWeb } from '@/utils/platform';

export default function AuthLayout() {
  const { user } = useApp();
  const segments = useSegments();
  if (user) return <Redirect href="/" />;
  // Le site web est réservé aux admins : ni accueil ni inscription client.
  if (isWeb && segments.at(-1) !== 'login') return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }} />;
}
