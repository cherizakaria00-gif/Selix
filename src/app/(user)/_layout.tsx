import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, tabScreenOptions } from '@/components/tab-bar';
import { useApp } from '@/store/app-store';

export default function UserLayout() {
  const { user, likedIds } = useApp();
  if (!user) return <Redirect href="/welcome" />;
  if (user.role === 'admin') return <Redirect href="/dashboard" />;

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
