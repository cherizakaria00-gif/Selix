import { Redirect } from 'expo-router';

import { useApp } from '@/store/app-store';

export default function Index() {
  const { ready, user } = useApp();
  if (!ready) return null;
  if (!user) return <Redirect href="/welcome" />;
  return <Redirect href={user.role === 'admin' ? '/dashboard' : '/match'} />;
}
