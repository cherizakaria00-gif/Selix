import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextInputInstance } from 'react-native';

import { Badge, Field, GradientButton, Header, KeyboardAware, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import { isWeb, openPrivacyPolicy } from '@/utils/platform';

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  async function submit() {
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Header
        right={
          isWeb ? undefined : (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={30} color={Colors.primary} />
            </Pressable>
          )
        }
      />
      <KeyboardAware>
        <ScrollView contentContainerStyle={[styles.content, isWeb && styles.contentWeb]} keyboardShouldPersistTaps="handled">
          {isWeb ? (
            <>
              <Badge label="Espace administrateur" icon="shield-checkmark" />
              <Text style={styles.title}>Tableau de bord Selix</Text>
              <Text style={styles.sub}>Gérez vos biens, suivez vos leads et l’activité des clients en temps réel.</Text>
            </>
          ) : (
            <>
              <Badge label="Premium onboarding" icon="sparkles" />
              <Text style={styles.title}>Bon retour dans Selix</Text>
              <Text style={styles.sub}>Retrouvez vos matchs, messages, visites et le suivi complet de votre dossier.</Text>
            </>
          )}

          <View style={styles.panel}>
            <View style={styles.stats}>
              {[
                ['100%', 'DIGITAL'],
                ['SMART', 'MATCHING'],
                ['TEMPS RÉEL', 'SUIVI'],
              ].map(([a, b], i) => (
                <View key={a} style={[styles.stat, i > 0 && styles.statBorder]}>
                  <Text style={styles.statA}>{a}</Text>
                  <Text style={styles.statB}>{b}</Text>
                </View>
              ))}
            </View>

            <Field
              label="Email"
              icon="mail-outline"
              placeholder="votre@email.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              autoCorrect={false}
              clearButtonMode="while-editing"
              value={email}
              onChangeText={setEmail}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label="Mot de passe"
              icon="lock-closed-outline"
              placeholder="••••••••••"
              secureTextEntry={!show}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => email && password && submit()}
              right={
                <Pressable onPress={() => setShow((s) => !s)} hitSlop={10}>
                  <Ionicons name={show ? 'eye-outline' : 'eye-off-outline'} size={20} color={Colors.textFaint} />
                </Pressable>
              }
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {!isWeb && (
            <Pressable style={styles.hint} onPress={() => router.replace('/register')}>
              <Ionicons name="person-add-outline" size={18} color={Colors.pink} />
              <Text style={styles.hintText}>
                Nouveau client ? Lancez d’abord le parcours guidé. Votre compte sera créé automatiquement à la fin.
              </Text>
            </Pressable>
            )}

            <GradientButton label="Se connecter" onPress={submit} loading={loading} disabled={!email || !password} />
            {!isWeb && (
            <Pressable onPress={() => router.replace('/register')} style={{ marginTop: 16 }}>
              <Text style={styles.link}>Commencer l’inscription guidée</Text>
            </Pressable>
            )}
          </View>
          <Text style={styles.legal}>
            En continuant, vous acceptez notre{' '}
            <Text style={styles.legalLink} accessibilityRole="link" onPress={openPrivacyPolicy}>
              politique de confidentialité
            </Text>
            .
          </Text>
        </ScrollView>
      </KeyboardAware>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 8 },
  contentWeb: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingTop: 48 },
  title: { color: Colors.text, fontSize: 30, fontWeight: '500', marginTop: 16 },
  sub: { color: Colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8, marginBottom: 20 },
  panel: {
    backgroundColor: 'rgba(10,3,25,0.55)',
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stats: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    paddingVertical: 12,
    marginBottom: 20,
  },
  stat: { flex: 1, alignItems: 'center' },
  statBorder: { borderLeftWidth: 1, borderLeftColor: Colors.border },
  statA: { color: '#fff', fontWeight: '800', fontSize: 13 },
  statB: { color: Colors.textMuted, fontSize: 10, marginTop: 2 },
  error: { color: Colors.dislike, marginBottom: 12 },
  hint: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  hintText: { flex: 1, color: Colors.pink, fontSize: 13, lineHeight: 18 },
  link: { color: Colors.textMuted, textAlign: 'center', fontSize: 14 },
  legal: { color: Colors.textFaint, fontSize: 11, textAlign: 'center', marginTop: 20 },
  legalLink: { color: Colors.pink, textDecorationLine: 'underline' },
});
