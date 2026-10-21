import { Redirect, Stack } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useApp } from '@/store/app-store';

export default function AuthLayout() {
  const { user } = useApp();
  if (user) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }} />;
}
