import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PropertyRow } from '@/components/property-card';
import { Chip, Empty, Field, Header, Screen } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { useApp } from '@/store/app-store';
import type { PropertyStatus, Transaction } from '@/types';

const STATUS_COLOR: Record<PropertyStatus, string> = {
  disponible: Colors.like,
  réservé: Colors.orange,
  vendu: Colors.dislike,
};

export default function AdminProperties() {
  const { properties, swipes } = useApp();
  const [q, setQ] = useState('');
  const [tx, setTx] = useState<Transaction | 'all'>('all');

  const query = q.trim().toLowerCase();
  const list = properties.filter(
    (p) =>
      (tx === 'all' || p.transaction === tx) &&
      (!query || `${p.title} ${p.city} ${p.district} ${p.type}`.toLowerCase().includes(query)),
  );

  return (
    <Screen>
      <Header
        title="Biens"
        right={
          <Pressable
            onPress={() => router.push({ pathname: '/edit-property', params: { id: 'new' } })}
            style={styles.add}
            hitSlop={8}>
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        }
      />
      <View style={{ paddingHorizontal: 16 }}>
        <Field icon="search" placeholder="Rechercher (titre, ville, quartier…)" value={q} onChangeText={setQ} />
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <Chip label={`Tous (${properties.length})`} active={tx === 'all'} onPress={() => setTx('all')} />
          <Chip label="Vente" active={tx === 'achat'} onPress={() => setTx('achat')} />
          <Chip label="Location" active={tx === 'location'} onPress={() => setTx('location')} />
        </ScrollView>
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
        renderItem={({ item }) => {
          const likes = swipes.filter((s) => s.propertyId === item.id && s.action !== 'dislike').length;
          return (
            <PropertyRow
              property={item}
              onPress={() => router.push({ pathname: '/edit-property', params: { id: item.id } })}
              right={
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[styles.status, { color: STATUS_COLOR[item.status] }]}>● {item.status}</Text>
                  <Text style={styles.likes}>{likes} ♥</Text>
                </View>
              }
            />
          );
        }}
        ListEmptyComponent={<Empty icon="business-outline" title="Aucun bien" text="Ajoutez votre premier bien avec le bouton +." />}
      />
    </Screen>
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
  filters: { paddingHorizontal: 16, gap: 8 },
  status: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  likes: { color: Colors.magenta, fontWeight: '700' },
});
