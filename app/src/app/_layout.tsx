import { DarkTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { Notifications } from '@/services/notifications';
// Importé ici pour que la tâche de géofencing soit définie dès le lancement.
import '@/services/proximity';
import { AppProvider, useApp } from '@/store/app-store';

SplashScreen.preventAutoHideAsync();

// Pas de notifications sur web ni dans Expo Go Android (le hook y lève une erreur).
const useLastNotificationResponse = Notifications ? Notifications.useLastNotificationResponse : () => null;

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Colors.bg, card: Colors.bg, primary: Colors.pink },
};

function NotificationRouter() {
  const { ready, user } = useApp();
  const response = useLastNotificationResponse();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    const id = response?.notification.request.content.data?.propertyId;
    if (!Notifications || !ready || !user || typeof id !== 'string') return;
    if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    router.push({ pathname: '/property/[id]', params: { id } });
    Notifications.clearLastNotificationResponse();
  }, [ready, user, response]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ThemeProvider value={theme}>
        <AppProvider>
          <StatusBar style="light" />
          <NotificationRouter />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(user)" />
            <Stack.Screen name="(staff)" />
            <Stack.Screen name="property/[id]" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="edit-property" options={{ presentation: 'modal' }} />
          </Stack>
        </AppProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
