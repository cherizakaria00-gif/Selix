import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, type TextInputInstance } from 'react-native';

import { Card, Field, GradientButton, Header, KeyboardAware, Screen, SectionTitle } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { Role } from '@/types';
import { notify, openPrivacyPolicy } from '@/utils/platform';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Super admin',
  commercial: 'Commercial',
  promoteur: 'Promoteur',
  user: 'Client',
};

export default function Settings() {
  const { user, logout, refresh, changePassword } = useApp();
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwdMessage, setPwdMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const nextRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);

  async function reload() {
    setLoading(true);
    try {
      await refresh();
    } catch (e) {
      notify('Serveur injoignable', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function savePassword() {
    setPwdMessage(null);
    if (next !== confirm) return setPwdMessage({ ok: false, text: 'La confirmation ne correspond pas au nouveau mot de passe.' });
    setSaving(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setPwdMessage({ ok: true, text: 'Mot de passe modifié. Vos autres appareils ont été déconnectés.' });
    } catch (e) {
      setPwdMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Header title="Compte" />
      <KeyboardAware>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Card>
            <SectionTitle>{user?.name}</SectionTitle>
            <Text style={styles.meta}>{user?.email}</Text>
            {user?.phone ? <Text style={styles.meta}>{user.phone}</Text> : null}
            <Text style={[styles.meta, { marginTop: 6 }]}>Rôle : {user ? ROLE_LABEL[user.role] : ''}</Text>
          </Card>

          <Card>
            <SectionTitle>Changer mon mot de passe</SectionTitle>
            <Field
              label="Mot de passe actuel"
              icon="lock-closed-outline"
              secureTextEntry
              value={current}
              onChangeText={setCurrent}
              autoComplete="current-password"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => nextRef.current?.focus()}
            />
            <Field
              ref={nextRef}
              label="Nouveau mot de passe (8 caractères minimum)"
              icon="key-outline"
              secureTextEntry
              value={next}
              onChangeText={setNext}
              autoComplete="new-password"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmRef.current?.focus()}
            />
            <Field
              ref={confirmRef}
              label="Confirmer le nouveau mot de passe"
              icon="key-outline"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              autoComplete="new-password"
              returnKeyType="done"
            />
            {pwdMessage && <Text style={[styles.message, { color: pwdMessage.ok ? Colors.like : Colors.dislike }]}>{pwdMessage.text}</Text>}
            <GradientButton label="Modifier le mot de passe" icon="checkmark" loading={saving} disabled={!current || !next || !confirm} onPress={savePassword} />
          </Card>

          <Card>
            <SectionTitle>Données</SectionTitle>
            <Text style={styles.meta}>
              Les données viennent du serveur Selix. Elles se mettent à jour à l’ouverture ; ce bouton force l’actualisation.
            </Text>
            <GradientButton label="Actualiser les données" variant="ghost" icon="refresh" onPress={reload} loading={loading} style={{ marginTop: 14 }} />
          </Card>
          <GradientButton label="Politique de confidentialité" variant="ghost" icon="document-text-outline" onPress={openPrivacyPolicy} />
          <GradientButton label="Se déconnecter" variant="ghost" icon="log-out-outline" onPress={logout} />
        </ScrollView>
      </KeyboardAware>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
  message: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
});
