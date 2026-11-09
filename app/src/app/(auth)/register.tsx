import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextInputInstance } from 'react-native';

import { Chip, Field, GradientButton, Header, KeyboardAware, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { PropertyType, Transaction } from '@/types';
import { openPrivacyPolicy } from '@/utils/platform';

const CITIES = ['Casablanca', 'Rabat', 'Marrakech', 'Tanger', 'Agadir', 'Dar Bouazza', 'Bouskoura', 'Fès', 'Mohammedia'];
const TYPES: { key: PropertyType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'appartement', label: 'Appartement', icon: 'business-outline' },
  { key: 'villa', label: 'Villa', icon: 'home-outline' },
  { key: 'studio', label: 'Studio', icon: 'bed-outline' },
  { key: 'riad', label: 'Riad', icon: 'leaf-outline' },
  { key: 'bureau', label: 'Bureau', icon: 'briefcase-outline' },
  { key: 'terrain', label: 'Terrain', icon: 'map-outline' },
];
const BUDGETS: Record<Transaction, { label: string; max: number }[]> = {
  location: [
    { label: '≤ 5 000 DH', max: 5_000 },
    { label: '≤ 8 000 DH', max: 8_000 },
    { label: '≤ 12 000 DH', max: 12_000 },
    { label: '≤ 20 000 DH', max: 20_000 },
    { label: '≤ 50 000 DH', max: 50_000 },
  ],
  achat: [
    { label: '≤ 1 M DH', max: 1_000_000 },
    { label: '≤ 2 M DH', max: 2_000_000 },
    { label: '≤ 3,5 M DH', max: 3_500_000 },
    { label: '≤ 5 M DH', max: 5_000_000 },
    { label: '≤ 10 M DH', max: 10_000_000 },
  ],
};
const FEATURES = ['piscine', 'jardin', 'parking', 'meublé', 'vue mer', 'terrasse', 'ascenseur', 'sécurité'];
const STEPS = ['Votre projet', 'Où et quoi ?', 'Budget', 'Vos envies', 'Votre compte'];

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function Register() {
  const { register } = useApp();
  const [step, setStep] = useState(0);
  const [transaction, setTransaction] = useState<Transaction | undefined>();
  const [cities, setCities] = useState<string[]>([]);
  const [types, setTypes] = useState<PropertyType[]>([]);
  const [budgetMax, setBudgetMax] = useState<number | undefined>();
  const [bedrooms, setBedrooms] = useState<number | undefined>();
  const [mustHave, setMustHave] = useState<string[]>([]);
  const [needs, setNeeds] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const phoneRef = useRef<TextInputInstance>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const canNext = [!!transaction, cities.length > 0, true, true, !!name && !!email && password.length >= 6][step];

  async function finish() {
    setError('');
    setLoading(true);
    try {
      await register({
        name: name.trim(),
        phone: phone.trim(),
        email,
        password,
        needs,
        profile: { transaction, cities, types, budgetMax, bedroomsMin: bedrooms, mustHave },
      });
      router.replace('/match');
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
          <Pressable onPress={() => (step ? setStep(step - 1) : router.back())} hitSlop={12}>
            <Ionicons name="chevron-back" size={30} color={Colors.primary} />
          </Pressable>
        }
      />
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.bar, i <= step && styles.barActive]} />
        ))}
      </View>
      <KeyboardAware>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.step}>
            Étape {step + 1}/{STEPS.length}
          </Text>
          <Text style={styles.title}>{STEPS[step]}</Text>

          {step === 0 && (
            <View style={{ gap: 14, marginTop: 12 }}>
              {(
                [
                  ['location', 'Je veux louer', 'key-outline', 'Appartements, villas, bureaux à la location'],
                  ['achat', 'Je veux acheter', 'home-outline', 'Résidence principale ou investissement'],
                ] as const
              ).map(([key, label, icon, sub]) => (
                <Pressable
                  key={key}
                  onPress={() => {
                    setTransaction(key);
                    setBudgetMax(undefined);
                  }}
                  style={[styles.option, transaction === key && styles.optionActive]}>
                  <Ionicons name={icon} size={28} color={transaction === key ? '#fff' : Colors.pink} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{label}</Text>
                    <Text style={styles.optionSub}>{sub}</Text>
                  </View>
                  {transaction === key && <Ionicons name="checkmark-circle" size={24} color="#fff" />}
                </Pressable>
              ))}
            </View>
          )}

          {step === 1 && (
            <>
              <Text style={styles.label}>Ville(s)</Text>
              <View style={styles.wrap}>
                {CITIES.map((c) => (
                  <Chip key={c} label={c} active={cities.includes(c)} onPress={() => setCities(toggle(cities, c))} />
                ))}
              </View>
              <Text style={styles.label}>Type de bien</Text>
              <View style={styles.wrap}>
                {TYPES.map((t) => (
                  <Chip
                    key={t.key}
                    label={t.label}
                    icon={t.icon}
                    active={types.includes(t.key)}
                    onPress={() => setTypes(toggle(types, t.key))}
                  />
                ))}
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.label}>
                Budget maximum {transaction === 'location' ? '(par mois)' : ''}
              </Text>
              <View style={styles.wrap}>
                {BUDGETS[transaction ?? 'achat'].map((b) => (
                  <Chip
                    key={b.max}
                    label={b.label}
                    active={budgetMax === b.max}
                    onPress={() => setBudgetMax(budgetMax === b.max ? undefined : b.max)}
                  />
                ))}
              </View>
              <Text style={styles.label}>Chambres minimum</Text>
              <View style={styles.wrap}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Chip
                    key={n}
                    label={n === 5 ? '5+' : `${n}`}
                    active={bedrooms === n}
                    onPress={() => setBedrooms(bedrooms === n ? undefined : n)}
                  />
                ))}
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.label}>Indispensables</Text>
              <View style={styles.wrap}>
                {FEATURES.map((f) => (
                  <Chip
                    key={f}
                    label={f.charAt(0).toUpperCase() + f.slice(1)}
                    active={mustHave.includes(f)}
                    onPress={() => setMustHave(toggle(mustHave, f))}
                  />
                ))}
              </View>
              <Text style={styles.label}>Décrivez votre bien idéal (l’IA s’en souviendra)</Text>
              <Field
                icon="sparkles-outline"
                placeholder="Ex. : proche de l’école des enfants, lumineux, quartier calme à Anfa…"
                multiline
                value={needs}
                onChangeText={setNeeds}
              />
            </>
          )}

          {step === 4 && (
            <View style={{ marginTop: 12 }}>
              <Field
                label="Nom complet"
                icon="person-outline"
                value={name}
                onChangeText={setName}
                autoComplete="name"
                textContentType="name"
                autoCapitalize="words"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => phoneRef.current?.focus()}
              />
              <Field
                ref={phoneRef}
                label="Téléphone (WhatsApp)"
                icon="call-outline"
                placeholder="+212 6…"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                autoComplete="tel"
                textContentType="telephoneNumber"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
              <Field
                ref={emailRef}
                label="Email"
                icon="mail-outline"
                placeholder="votre@email.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                autoComplete="email"
                textContentType="emailAddress"
                autoCorrect={false}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Field
                ref={passwordRef}
                label="Mot de passe (6 caractères min.)"
                icon="lock-closed-outline"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
              />
              {error ? <Text style={{ color: Colors.dislike }}>{error}</Text> : null}
            </View>
          )}
        </ScrollView>
        <View style={styles.footer}>
          {step < STEPS.length - 1 ? (
            <GradientButton label="Continuer" disabled={!canNext} onPress={() => setStep(step + 1)} />
          ) : (
            <>
              <GradientButton label="Créer mon compte" icon="sparkles" disabled={!canNext} loading={loading} onPress={finish} />
              <Text style={styles.legal}>
                En créant un compte, vous acceptez notre{' '}
                <Text style={styles.legalLink} accessibilityRole="link" onPress={openPrivacyPolicy}>
                  politique de confidentialité
                </Text>
                .
              </Text>
            </>
          )}
        </View>
      </KeyboardAware>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: 24 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  barActive: { backgroundColor: Colors.pink },
  content: { padding: 24 },
  legal: { color: Colors.textFaint, fontSize: 11, textAlign: 'center', marginTop: 12 },
  legalLink: { color: Colors.pink, textDecorationLine: 'underline' },
  step: { color: Colors.pink, fontSize: 13, fontWeight: '600' },
  title: { color: Colors.text, fontSize: 30, fontWeight: '500', marginTop: 4, marginBottom: 8 },
  label: { color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 20, marginBottom: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  optionActive: { backgroundColor: Colors.primary, borderColor: Colors.pink },
  optionTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  optionSub: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
  footer: { padding: 24, paddingTop: 8 },
});
