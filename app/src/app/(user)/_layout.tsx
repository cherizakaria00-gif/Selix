import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, tabScreenOptions } from '@/components/tab-bar';
import { Empty, GradientButton, Logo, Screen } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import { isWeb } from '@/utils/platform';

export default function UserLayout() {
  const { user, likedIds, logout } = useApp();
  if (!user) return <Redirect href="/welcome" />;
  // Le personnel (admin, commercial, promoteur) retrouve son espace : « / » choisit la bonne page.
  if (user.role !== 'user') return <Redirect href="/" />;
  if (isWeb) return <ClientsUseTheApp onLogout={logout} />;

  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="match"
        options={{ title: 'Matching', tabBarIcon: tabIcon('heart') }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Assistant IA',
          tabBarIcon: tabIcon('sparkles'),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: 'Carte', tabBarIcon: tabIcon('map') }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Mes biens',
          tabBarBadge: likedIds.size || undefined,
          tabBarIcon: tabIcon('bookmark'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: tabIcon('person') }}
      />
    </Tabs>
  );
}

/** Un compte client qui se connecte sur app.selix.io : l'espace client est dans l'app mobile. */
function ClientsUseTheApp({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Logo height={48} />
        <Empty
          icon="phone-portrait-outline"
          title="Espace réservé aux administrateurs"
          text="Ce site sert à gérer Selix. Pour trouver votre bien, utilisez l’application mobile Selix sur votre téléphone."
          action={<GradientButton label="Se déconnecter" variant="ghost" icon="log-out-outline" onPress={onLogout} />}
        />
        <Text style={styles.hint}>Vous êtes administrateur ? Déconnectez-vous puis utilisez votre compte admin.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  hint: { color: Colors.textFaint, fontSize: 13, textAlign: 'center' },
});
