import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, tabScreenOptions } from '@/components/tab-bar';
import { useApp } from '@/store/app-store';

export default function AdminLayout() {
  const { user, leads } = useApp();
  if (!user) return <Redirect href="/welcome" />;
  if (user.role !== 'admin') return <Redirect href="/match" />;
  const fresh = leads.filter((l) => l.status === 'nouveau').length;

  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Tableau de bord', tabBarIcon: tabIcon('grid') }}
      />
      <Tabs.Screen
        name="properties"
        options={{ title: 'Biens', tabBarIcon: tabIcon('business') }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'Leads',
          tabBarBadge: fresh || undefined,
          tabBarIcon: tabIcon('people'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Compte', tabBarIcon: tabIcon('settings') }}
      />
    </Tabs>
  );
}
