import { Redirect } from 'expo-router';

import { useApp } from '@/store/app-store';
import { isWeb } from '@/utils/platform';

export default function Index() {
  const { ready, user } = useApp();
  if (!ready) return null;
  // Sur le web (app.selix.io), pas d'onboarding client : on va droit à la connexion admin.
  if (!user) return <Redirect href={isWeb ? '/login' : '/welcome'} />;
  const home = { admin: '/dashboard', commercial: '/leads', promoteur: '/properties', user: '/match' } as const;
  return <Redirect href={home[user.role]} />;
}
