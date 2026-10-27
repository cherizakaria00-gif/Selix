import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { AdminSidebar } from '@/components/admin-sidebar';
import { tabIcon, tabScreenOptions } from '@/components/tab-bar';
import { useApp } from '@/store/app-store';
import { isWeb, useIsDesktop } from '@/utils/platform';

/**
 * Espace du personnel (app.selix.io). Les onglets dépendent du rôle :
 * - admin (super admin) : tout, plus la validation des biens et l'équipe ;
 * - commercial : ses leads ;
 * - promoteur : ses biens et leurs statistiques.
 * `href: null` cache l'onglet ; chaque écran vérifie aussi le rôle, et l'API le refuse de toute façon.
 */
export default function StaffLayout() {
  const { user, leads, properties } = useApp();
  const desktop = useIsDesktop();
  if (!user) return <Redirect href={isWeb ? '/login' : '/welcome'} />;
  if (user.role === 'user') return <Redirect href="/match" />;

  const role = user.role;
  const hide = (visible: boolean) => (visible ? {} : { href: null });
  const toValidate = properties.filter((p) => p.approval === 'en attente').length;
  const toAssign = leads.filter((l) => !l.assignedTo).length;
  const fresh = leads.filter((l) => l.status === 'nouveau').length;
  const visitsToConfirm = leads.filter((l) => l.visitStatus === 'demandée').length;

  return (
    <Tabs
      screenOptions={desktop ? { ...tabScreenOptions, tabBarPosition: 'left' } : tabScreenOptions}
      tabBar={desktop ? (props) => <AdminSidebar {...props} /> : undefined}>
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Tableau de bord', tabBarIcon: tabIcon('grid'), ...hide(role === 'admin') }}
      />
      <Tabs.Screen
        name="properties"
        options={{
          title: role === 'promoteur' ? 'Mes biens' : 'Biens',
          tabBarBadge: role === 'admin' ? toValidate || undefined : undefined,
          tabBarIcon: tabIcon('business'),
          ...hide(role !== 'commercial'),
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: role === 'commercial' ? 'Mes leads' : 'Leads',
          tabBarBadge: (role === 'admin' ? toAssign : fresh) || undefined,
          tabBarIcon: tabIcon('people'),
          ...hide(role !== 'promoteur'),
        }}
      />
      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          tabBarBadge: visitsToConfirm || undefined,
          tabBarIcon: tabIcon('calendar'),
          ...hide(role === 'admin' || role === 'commercial'),
        }}
      />
      <Tabs.Screen name="team" options={{ title: 'Équipe', tabBarIcon: tabIcon('people-circle'), ...hide(role === 'admin') }} />
      <Tabs.Screen name="settings" options={{ title: 'Compte', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
