import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card, Chip, GradientButton, Header, Screen, SectionTitle } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { describeProfile } from '@/services/ai';
import { isExpoGo } from '@/services/proximity';
import { useApp } from '@/store/app-store';

const RADII = [0.5, 1, 2, 5, 10];

export default function Profile() {
  const { user, profile, updateProfile, logout, locationGranted, enableLocation, backgroundStatus, likedIds, dislikedIds } =
    useApp();
  const l = profile.learned;
  const topOf = (rec: Record<string, number>) =>
    Object.entries(rec)
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
  const learnedCities = topOf(l.cities);
  const learnedTypes = topOf(l.types);
  const learnedFeatures = topOf(l.features);

  const bgText =
    backgroundStatus === 'active'
      ? 'Active : vous serez alerté même application fermée.'
      : backgroundStatus === 'expo-go'
        ? 'Dans Expo Go, les alertes fonctionnent quand l’app est ouverte. La version installée (build) les envoie aussi app fermée.'
        : backgroundStatus === 'denied'
          ? 'Autorisez la localisation « Toujours » pour être alerté app fermée.'
          : 'Inactive';

  return (
    <Screen>
      <Header title="Profil" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <Card style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.meta}>{user?.email}</Text>
            {user?.phone ? <Text style={styles.meta}>{user.phone}</Text> : null}
          </View>
        </Card>

        <Card>
          <SectionTitle>Alertes de proximité</SectionTitle>
          <View style={styles.line}>
            <Text style={styles.lineText}>Me prévenir quand un bien qui me correspond est proche</Text>
            <Switch
              value={profile.notifyNearby}
              onValueChange={(v) => updateProfile({ notifyNearby: v })}
              trackColor={{ true: Colors.primary, false: Colors.border }}
            />
          </View>
          <Text style={[styles.meta, { marginTop: 12, marginBottom: 8 }]}>Rayon d’alerte</Text>
          <View style={styles.wrap}>
            {RADII.map((r) => (
              <Chip
                key={r}
                label={r < 1 ? `${r * 1000} m` : `${r} km`}
                active={profile.radiusKm === r}
                onPress={() => updateProfile({ radiusKm: r })}
              />
            ))}
          </View>
          <View style={[styles.status, { marginTop: 16 }]}>
            <Ionicons
              name={locationGranted ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={locationGranted ? Colors.like : Colors.orange}
            />
            <Text style={styles.statusText}>
              Localisation {locationGranted ? 'activée' : 'désactivée'}
            </Text>
          </View>
          {locationGranted && (
            <View style={styles.status}>
              <Ionicons name="moon" size={16} color={Colors.textMuted} />
              <Text style={styles.statusText}>Arrière-plan : {bgText}</Text>
            </View>
          )}
          {!locationGranted && (
            <GradientButton label="Activer la localisation" icon="navigate" onPress={enableLocation} style={{ marginTop: 12 }} />
          )}
          {locationGranted && backgroundStatus === 'denied' && Platform.OS !== 'web' && (
            <GradientButton
              label="Ouvrir les réglages"
              variant="ghost"
              onPress={() => Linking.openSettings()}
              style={{ marginTop: 12 }}
            />
          )}
        </Card>

        <Card>
          <SectionTitle>Ce que l’IA a compris</SectionTitle>
          <Text style={styles.meta}>Vos besoins</Text>
          <Text style={styles.value}>{describeProfile(profile) || 'Pas encore précisés — parlez à l’assistant.'}</Text>
          <Text style={[styles.meta, { marginTop: 12 }]}>Appris de vos swipes</Text>
          <Text style={styles.value}>
            {likedIds.size} like{likedIds.size > 1 ? 's' : ''} · {dislikedIds.size} non
          </Text>
          {learnedCities.length > 0 && <Text style={styles.value}>Villes : {learnedCities.join(', ')}</Text>}
          {learnedTypes.length > 0 && <Text style={styles.value}>Types : {learnedTypes.join(', ')}</Text>}
          {learnedFeatures.length > 0 && <Text style={styles.value}>Atouts : {learnedFeatures.join(', ')}</Text>}
          <GradientButton
            label="Modifier avec l’assistant"
            icon="sparkles"
            variant="ghost"
            style={{ marginTop: 14 }}
            onPress={() => router.push('/assistant?profileEdit=1')}
          />
        </Card>

        {isExpoGo && (
          <Text style={[styles.meta, { textAlign: 'center' }]}>Mode aperçu Expo Go</Text>
        )}
        <GradientButton label="Se déconnecter" variant="ghost" icon="log-out-outline" onPress={logout} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  name: { color: '#fff', fontSize: 18, fontWeight: '700' },
  meta: { color: Colors.textMuted, fontSize: 13 },
  value: { color: Colors.text, fontSize: 14, marginTop: 4, lineHeight: 20 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineText: { flex: 1, color: Colors.text, fontSize: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  statusText: { flex: 1, color: Colors.textMuted, fontSize: 13, lineHeight: 18 },
});
