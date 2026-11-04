import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApprovalBadge, approvalOf } from '@/components/approval';
import { PropertyRow } from '@/components/property-card';
import { Chip, Empty, Field, GradientButton, Header, KeyboardAware, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { Approval, Property, PropertyStatus, Transaction } from '@/types';
import { notify } from '@/utils/platform';

const STATUS_COLOR: Record<PropertyStatus, string> = {
  disponible: Colors.like,
  réservé: Colors.orange,
  vendu: Colors.dislike,
};

export default function Properties() {
  const { user, properties, users, stats } = useApp();
  const [q, setQ] = useState('');
  const [tx, setTx] = useState<Transaction | 'all'>('all');
  const [approval, setApproval] = useState<Approval | 'all'>('all');

  if (!user || (user.role !== 'admin' && user.role !== 'promoteur')) return <Redirect href="/" />;
  const isAdmin = user.role === 'admin';

  // Le promoteur ne gère que ses biens (l'API lui renvoie aussi les biens publiés des autres).
  const managed = isAdmin ? properties : properties.filter((p) => p.ownerId === user.id);
  const pending = managed.filter((p) => approvalOf(p) === 'en attente').length;
  const query = q.trim().toLowerCase();
  const list = managed.filter(
    (p) =>
      (tx === 'all' || p.transaction === tx) &&
      (approval === 'all' || approvalOf(p) === approval) &&
      (!query || `${p.title} ${p.city} ${p.district} ${p.type}`.toLowerCase().includes(query)),
  );

  return (
    <Screen>
      <Header
        title={isAdmin ? 'Biens' : 'Mes biens'}
        right={
          <Pressable
            onPress={() => router.push({ pathname: '/edit-property', params: { id: 'new' } })}
            style={styles.add}
            accessibilityLabel="Ajouter un bien"
            hitSlop={8}>
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        }
      />
      {!isAdmin && (
        <View style={styles.info}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.pink} />
          <Text style={styles.infoText}>
            Vos biens sont publiés aux clients de Selix après validation par notre équipe. Vous suivez ici leur état et leur audience.
          </Text>
        </View>
      )}
      <View style={{ paddingHorizontal: 16 }}>
        <Field icon="search" placeholder="Rechercher (titre, ville, quartier…)" value={q} onChangeText={setQ} />
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <Chip label={`Tous (${managed.length})`} active={approval === 'all' && tx === 'all'} onPress={() => (setApproval('all'), setTx('all'))} />
          <Chip
            label={`À valider (${pending})`}
            icon="time-outline"
            active={approval === 'en attente'}
            onPress={() => setApproval(approval === 'en attente' ? 'all' : 'en attente')}
          />
          <Chip label="Refusés" active={approval === 'refusé'} onPress={() => setApproval(approval === 'refusé' ? 'all' : 'refusé')} />
          <Chip label="Vente" active={tx === 'achat'} onPress={() => setTx(tx === 'achat' ? 'all' : 'achat')} />
          <Chip label="Location" active={tx === 'location'} onPress={() => setTx(tx === 'location' ? 'all' : 'location')} />
        </ScrollView>
      </View>
      <KeyboardAware>
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const st = stats.find((s) => s.propertyId === item.id);
            const state = approvalOf(item);
            const owner = users.find((u) => u.id === item.ownerId);
            return (
              <View>
                <PropertyRow
                  property={item}
                  onPress={() => router.push({ pathname: '/edit-property', params: { id: item.id } })}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <ApprovalBadge approval={state} />
                      <Text style={[styles.status, { color: STATUS_COLOR[item.status] }]}>● {item.status}</Text>
                    </View>
                  }
                />
                <View style={styles.meta}>
                  {isAdmin && item.ownerId && <Text style={styles.metaText}>Promoteur : {owner?.name ?? 'compte supprimé'}</Text>}
                  <Text style={styles.metaText}>
                    {st ? `${st.views} vu${st.views > 1 ? 's' : ''} · ${st.likes} like${st.likes > 1 ? 's' : ''} · ${st.visits} visite${st.visits > 1 ? 's' : ''}` : 'Pas encore de statistiques'}
                  </Text>
                </View>
                {state === 'refusé' && (
                  <View style={styles.refused}>
                    <Text style={styles.refusedTitle}>Bien refusé</Text>
                    <Text style={styles.refusedText}>
                      {item.rejectionReason || 'Aucun motif indiqué.'}
                      {!isAdmin ? ' Corrigez le bien et enregistrez-le pour le soumettre à nouveau.' : ''}
                    </Text>
                  </View>
                )}
                {isAdmin && state === 'en attente' && <ReviewActions property={item} />}
              </View>
            );
          }}
          ListEmptyComponent={
            <Empty
              icon="business-outline"
              title={isAdmin ? 'Aucun bien' : 'Aucun bien pour le moment'}
              text={isAdmin ? 'Aucun bien ne correspond à ces filtres.' : 'Ajoutez votre premier bien avec le bouton +. Il sera publié après validation.'}
              action={
                !isAdmin && !managed.length ? (
                  <GradientButton label="Ajouter un bien" icon="add-circle" onPress={() => router.push({ pathname: '/edit-property', params: { id: 'new' } })} />
                ) : undefined
              }
            />
          }
        />
      </KeyboardAware>
    </Screen>
  );
}

/** Super admin : valider un bien déposé par un promoteur, ou le refuser en expliquant pourquoi. */
function ReviewActions({ property }: { property: Property }) {
  const { setApproval } = useApp();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(decision: 'validé' | 'refusé') {
    setBusy(true);
    try {
      await setApproval(property.id, decision, decision === 'refusé' ? reason.trim() : undefined);
    } catch (e) {
      notify('Action impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (refusing) {
    return (
      <View style={styles.review}>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Motif du refus (visible du promoteur)"
          placeholderTextColor={Colors.textFaint}
          multiline
          style={styles.reason}
        />
        <View style={styles.actions}>
          <GradientButton label="Confirmer le refus" variant="danger" loading={busy} onPress={() => run('refusé')} style={{ flex: 1 }} />
          <GradientButton label="Annuler" variant="ghost" onPress={() => setRefusing(false)} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.review, styles.actions]}>
      <GradientButton label="Valider et publier" icon="checkmark" loading={busy} onPress={() => run('validé')} style={{ flex: 1 }} />
      <GradientButton label="Refuser" variant="ghost" icon="close" onPress={() => setRefusing(true)} style={{ flex: 1 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  add: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(208,76,224,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(208,76,224,0.3)',
  },
  infoText: { flex: 1, color: Colors.text, fontSize: 13, lineHeight: 18 },
  filters: { paddingHorizontal: 16, gap: 8 },
  status: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 10, paddingTop: 6 },
  metaText: { color: Colors.textMuted, fontSize: 12 },
  refused: {
    marginTop: 8,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,77,94,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,94,0.35)',
  },
  refusedTitle: { color: Colors.dislike, fontWeight: '700', fontSize: 13 },
  refusedText: { color: Colors.text, fontSize: 13, marginTop: 2, lineHeight: 18 },
  review: { marginTop: 10, gap: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  reason: {
    color: '#fff',
    fontSize: 14,
    minHeight: 64,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    textAlignVertical: 'top',
  },
});
