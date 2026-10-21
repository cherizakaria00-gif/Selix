import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Card, GradientButton, Header, Screen, SectionTitle } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { useApp } from '@/store/app-store';

export default function Settings() {
  const { user, logout, refresh } = useApp();
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      await refresh();
    } catch (e) {
      Alert.alert('Serveur injoignable', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header title="Compte" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Card>
          <SectionTitle>{user?.name}</SectionTitle>
          <Text style={styles.meta}>{user?.email}</Text>
          <Text style={styles.meta}>Rôle : administrateur</Text>
        </Card>
        <Card>
          <SectionTitle>Données</SectionTitle>
          <Text style={styles.meta}>
            Biens, clients et leads sont partagés via le serveur Selix : un bien publié ici apparaît
            aussitôt chez les clients, et ceux à qui il correspond reçoivent une notification.
          </Text>
          <GradientButton label="Actualiser les données" variant="ghost" icon="refresh" onPress={reload} loading={loading} style={{ marginTop: 14 }} />
        </Card>
        <GradientButton label="Se déconnecter" variant="ghost" icon="log-out-outline" onPress={logout} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
});
