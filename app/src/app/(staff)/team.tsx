import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, Chip, Empty, Field, GradientButton, Header, Screen, SectionTitle } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { StaffRole, User } from '@/types';
import { confirmAction } from '@/utils/platform';

const ROLES: { key: StaffRole; label: string; help: string; icon: 'headset' | 'business' }[] = [
  { key: 'commercial', label: 'Commercial', help: 'Voit et gère les leads que vous lui assignez.', icon: 'headset' },
  { key: 'promoteur', label: 'Promoteur', help: 'Ajoute ses biens ; ils sont publiés après votre validation.', icon: 'business' },
];

/** Mot de passe provisoire lisible (sans 0/O/1/l/I), à transmettre au nouveau compte. */
function generatePassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export default function Team() {
  const { user, users, leads, properties, createStaff } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('commercial');
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string; role: StaffRole } | null>(null);

  if (user?.role !== 'admin') return <Redirect href="/" />;
  const staff = users.filter((u) => u.role === 'commercial' || u.role === 'promoteur');

  async function submit() {
    setError('');
    setSaving(true);
    try {
      const made = await createStaff({ name: name.trim(), email: email.trim(), phone: phone.trim(), password, role });
      setCreated({ email: made.email, password, role });
      setName('');
      setEmail('');
      setPhone('');
      setPassword(generatePassword());
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Header title="Équipe" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <Text style={styles.intro}>
          Créez les comptes des commerciaux et des promoteurs. Vous leur transmettez leur email et un mot de passe provisoire : ils le changent
          dans « Compte ».
        </Text>

        {created && (
          <Card style={styles.created}>
            <SectionTitle>Compte créé</SectionTitle>
            <Text style={styles.line}>
              Transmettez ces identifiants à la personne ({created.role === 'commercial' ? 'commercial' : 'promoteur'}) pour se connecter sur
              app.selix.io. Ils ne seront plus affichés ensuite.
            </Text>
            <View style={styles.creds}>
              <Text style={styles.credLabel}>Email</Text>
              <Text style={styles.credValue} selectable>
                {created.email}
              </Text>
              <Text style={[styles.credLabel, { marginTop: 8 }]}>Mot de passe provisoire</Text>
              <Text style={styles.credValue} selectable>
                {created.password}
              </Text>
            </View>
            <GradientButton label="J’ai noté les identifiants" variant="ghost" onPress={() => setCreated(null)} />
          </Card>
        )}

        {open ? (
          <Card>
            <SectionTitle>Nouveau compte</SectionTitle>
            <Text style={styles.label}>Rôle</Text>
            <View style={styles.roles}>
              {ROLES.map((r) => (
                <Chip key={r.key} label={r.label} icon={r.icon} active={role === r.key} onPress={() => setRole(r.key)} />
              ))}
            </View>
            <Text style={styles.help}>{ROLES.find((r) => r.key === role)?.help}</Text>
            <Field label="Nom complet" icon="person-outline" value={name} onChangeText={setName} />
            <Field label="Email" icon="mail-outline" autoCapitalize="none" keyboardType="email-address" autoCorrect={false} value={email} onChangeText={setEmail} />
            <Field label="Téléphone" icon="call-outline" keyboardType="phone-pad" placeholder="+212 6…" value={phone} onChangeText={setPhone} />
            <Field
              label="Mot de passe provisoire (8 caractères minimum)"
              icon="key-outline"
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              right={<Text style={styles.generate} onPress={() => setPassword(generatePassword())}>Générer</Text>}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <GradientButton
                label="Créer le compte"
                icon="person-add"
                loading={saving}
                disabled={!name.trim() || !email.trim() || password.length < 8}
                onPress={submit}
                style={{ flex: 1 }}
              />
              <GradientButton label="Annuler" variant="ghost" onPress={() => (setOpen(false), setError(''))} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <GradientButton label="Ajouter un compte" icon="person-add" onPress={() => (setOpen(true), setCreated(null))} />
        )}

        <SectionTitle style={{ marginTop: 8 }}>Comptes ({staff.length})</SectionTitle>
        {staff.length === 0 && (
          <Empty icon="people-circle-outline" title="Aucun compte pour l’instant" text="Ajoutez un commercial pour pouvoir lui assigner des leads, ou un promoteur pour qu’il dépose ses biens." />
        )}
        {staff.map((u) => (
          <StaffCard
            key={u.id}
            account={u}
            detail={
              u.role === 'commercial'
                ? `${leads.filter((l) => l.assignedTo === u.id).length} lead(s) assigné(s)`
                : `${properties.filter((p) => p.ownerId === u.id).length} bien(s) déposé(s)`
            }
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

function StaffCard({ account, detail }: { account: User; detail: string }) {
  const { updateStaff } = useApp();
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isCommercial = account.role === 'commercial';

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) setMessage({ ok: true, text: success });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled() {
    const disabling = !account.disabled;
    if (
      disabling &&
      !(await confirmAction(
        `Désactiver ${account.name} ?`,
        isCommercial
          ? 'Cette personne sera déconnectée et ne pourra plus se connecter. Ses leads reviendront dans « À assigner ».'
          : 'Cette personne sera déconnectée et ne pourra plus se connecter. Ses biens restent publiés.',
        'Désactiver',
      ))
    ) {
      return;
    }
    await run(() => updateStaff(account.id, { disabled: disabling }));
  }

  return (
    <Card style={account.disabled ? { opacity: 0.6 } : undefined}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Ionicons name={isCommercial ? 'headset' : 'business'} size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{account.name}</Text>
          <Text style={styles.meta}>{account.email}</Text>
          {account.phone ? <Text style={styles.meta}>{account.phone}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Badge label={isCommercial ? 'Commercial' : 'Promoteur'} color={isCommercial ? Colors.star : Colors.magenta} />
          {account.disabled && <Badge label="Désactivé" color={Colors.dislike} icon="ban" />}
        </View>
      </View>
      <Text style={[styles.meta, { marginTop: 10 }]}>{detail}</Text>

      {resetting ? (
        <View style={{ marginTop: 12 }}>
          <Field
            label="Nouveau mot de passe provisoire (8 caractères minimum)"
            icon="key-outline"
            autoCapitalize="none"
            autoCorrect={false}
            value={newPassword}
            onChangeText={setNewPassword}
            right={<Text style={styles.generate} onPress={() => setNewPassword(generatePassword())}>Générer</Text>}
          />
          <View style={styles.actions}>
            <GradientButton
              label="Enregistrer"
              icon="checkmark"
              loading={busy}
              disabled={newPassword.length < 8}
              onPress={() =>
                run(async () => {
                  await updateStaff(account.id, { password: newPassword });
                  setResetting(false);
                  setMessage({ ok: true, text: `Nouveau mot de passe : ${newPassword} (à transmettre à ${account.name}). Il a été déconnecté partout.` });
                  setNewPassword('');
                })
              }
              style={{ flex: 1 }}
            />
            <GradientButton label="Annuler" variant="ghost" onPress={() => setResetting(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={[styles.actions, { marginTop: 12 }]}>
          <GradientButton label="Réinitialiser le mot de passe" icon="key" variant="ghost" onPress={() => (setResetting(true), setNewPassword(generatePassword()), setMessage(null))} style={{ flex: 1 }} />
          <GradientButton
            label={account.disabled ? 'Réactiver' : 'Désactiver'}
            icon={account.disabled ? 'checkmark-circle' : 'ban'}
            variant={account.disabled ? 'primary' : 'ghost'}
            loading={busy}
            onPress={toggleDisabled}
            style={{ flex: 1 }}
          />
        </View>
      )}
      {message && <Text style={[styles.feedback, { color: message.ok ? Colors.like : Colors.dislike }]} selectable>{message.text}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  intro: { color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
  label: { color: Colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  roles: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  help: { color: Colors.textMuted, fontSize: 12, marginTop: 8, marginBottom: 16 },
  generate: { color: Colors.pink, fontWeight: '700', fontSize: 13 },
  error: { color: Colors.dislike, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  created: { borderColor: 'rgba(43,212,125,0.45)' },
  line: { color: Colors.text, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  creds: { padding: 14, borderRadius: Radius.md, backgroundColor: 'rgba(0,0,0,0.25)', marginBottom: 14 },
  credLabel: { color: Colors.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  credValue: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', fontWeight: '700', fontSize: 16 },
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  feedback: { fontSize: 13, marginTop: 12, lineHeight: 18 },
});
