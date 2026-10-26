import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MapView, Marker, type MapPressEvent } from '@/components/maps';
import { PropertyImage } from '@/components/property-card';
import { Chip, Field, GradientButton, Header, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { uid } from '@/services/api';
import { MOROCCO_REGION } from '@/services/geo';
import { useApp } from '@/store/app-store';
import { confirmAction, goBack, notify } from '@/utils/platform';
import type { Property, PropertyStatus, PropertyType, Transaction } from '@/types';

const TYPES: PropertyType[] = ['appartement', 'villa', 'studio', 'riad', 'bureau', 'terrain'];
const STATUSES: PropertyStatus[] = ['disponible', 'réservé', 'vendu'];
const FEATURES = [
  'piscine', 'jardin', 'parking', 'meublé', 'vue mer', 'terrasse', 'ascenseur', 'sécurité', 'climatisation', 'balcon', 'concierge',
];
const CITIES = ['Casablanca', 'Rabat', 'Marrakech', 'Tanger', 'Agadir', 'Dar Bouazza', 'Bouskoura', 'Fès', 'Mohammedia'];

function blank(): Property {
  return {
    id: uid('p'),
    title: '',
    transaction: 'achat',
    type: 'appartement',
    city: 'Casablanca',
    district: '',
    price: 0,
    surface: 0,
    bedrooms: 0,
    bathrooms: 0,
    features: [],
    description: '',
    latitude: 0,
    longitude: 0,
    images: [],
    status: 'disponible',
    agentPhone: '+212522000000',
    createdAt: Date.now(),
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v: string) => Number(v.replace(/[^\d]/g, '')) || 0;

export default function EditProperty() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { properties, saveProperty, deleteProperty } = useApp();
  const existing = properties.find((p) => p.id === id);
  const [p, setP] = useState<Property>(() => existing ?? blank());
  // Ouvert par son adresse (rechargement, lien direct), le bien arrive après le premier
  // rendu : on remplit alors le formulaire, sinon l'enregistrement écraserait le bien.
  const [loadedId, setLoadedId] = useState(existing?.id);
  if (existing && loadedId !== existing.id) {
    setLoadedId(existing.id);
    setP(existing);
  }
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Property>(k: K, v: Property[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const hasPin = p.latitude !== 0 || p.longitude !== 0;

  async function pickImages() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.7,
    });
    if (!res.canceled) set('images', [...p.images, ...res.assets.map((a) => a.uri)]);
  }

  async function useMyPosition() {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return notify('Localisation refusée', 'Placez le bien en touchant la carte.');
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setP((prev) => ({ ...prev, latitude: loc.coords.latitude, longitude: loc.coords.longitude }));
  }

  async function save() {
    const missing = [
      !p.title.trim() && 'titre',
      !p.price && 'prix',
      !p.district.trim() && 'quartier',
      !hasPin && 'position sur la carte',
      !p.images.length && 'au moins une photo',
    ].filter(Boolean);
    if (missing.length) return notify('Champs manquants', `Merci de renseigner : ${missing.join(', ')}.`);
    setSaving(true);
    try {
      await saveProperty({ ...p, title: p.title.trim(), district: p.district.trim() });
      goBack('/properties');
    } catch (e) {
      notify('Enregistrement impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!(await confirmAction('Supprimer ce bien ?', 'Cette action est définitive.', 'Supprimer'))) return;
    try {
      await deleteProperty(p.id);
      goBack('/properties');
    } catch (e) {
      notify('Suppression impossible', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Header
        left={
          <Pressable onPress={() => goBack('/properties')} hitSlop={10}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        }
        title={existing ? 'Modifier le bien' : 'Nouveau bien'}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Photos</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginBottom: 16 }}>
            {p.images.map((src, i) => (
              <View key={`${i}`}>
                <PropertyImage src={src} style={styles.photo} />
                <Pressable
                  style={styles.removePhoto}
                  onPress={() => set('images', p.images.filter((_, j) => j !== i))}>
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={pickImages} style={[styles.photo, styles.addPhoto]}>
              <Ionicons name="camera-outline" size={26} color={Colors.pink} />
              <Text style={{ color: Colors.textMuted, fontSize: 11 }}>Ajouter</Text>
            </Pressable>
          </ScrollView>

          <Field label="Titre" placeholder="Ex. : Les Villas d’Anfa 5" value={p.title} onChangeText={(v) => set('title', v)} />
          <Field
            label="Standing (optionnel)"
            placeholder="HAUT STANDING, PRESTIGE…"
            autoCapitalize="characters"
            value={p.standing ?? ''}
            onChangeText={(v) => set('standing', v || undefined)}
          />
          <Field
            label="Disponibilité (optionnel)"
            placeholder="CFC 2 - disponible fin 2026"
            value={p.delivery ?? ''}
            onChangeText={(v) => set('delivery', v || undefined)}
          />

          <Text style={styles.label}>Transaction</Text>
          <View style={styles.wrap}>
            {(['achat', 'location'] as Transaction[]).map((t) => (
              <Chip key={t} label={t === 'achat' ? 'Vente' : 'Location'} active={p.transaction === t} onPress={() => set('transaction', t)} />
            ))}
          </View>

          <Text style={styles.label}>Type</Text>
          <View style={styles.wrap}>
            {TYPES.map((t) => (
              <Chip key={t} label={cap(t)} active={p.type === t} onPress={() => set('type', t)} />
            ))}
          </View>

          <Text style={styles.label}>Ville</Text>
          <View style={[styles.wrap, { marginBottom: 16 }]}>
            {CITIES.map((c) => (
              <Chip key={c} label={c} active={p.city === c} onPress={() => set('city', c)} />
            ))}
          </View>
          <Field label="Quartier" placeholder="Anfa, Guéliz, Hay Riad…" value={p.district} onChangeText={(v) => set('district', v)} />

          <View style={styles.cols}>
            <View style={{ flex: 1 }}>
              <Field
                label={p.transaction === 'location' ? 'Loyer (MAD/mois)' : 'Prix (MAD)'}
                keyboardType="number-pad"
                value={p.price ? String(p.price) : ''}
                onChangeText={(v) => set('price', num(v))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Surface (m²)" keyboardType="number-pad" value={p.surface ? String(p.surface) : ''} onChangeText={(v) => set('surface', num(v))} />
            </View>
          </View>
          <View style={styles.cols}>
            <View style={{ flex: 1 }}>
              <Field label="Chambres" keyboardType="number-pad" value={String(p.bedrooms)} onChangeText={(v) => set('bedrooms', num(v))} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Salles de bain" keyboardType="number-pad" value={String(p.bathrooms)} onChangeText={(v) => set('bathrooms', num(v))} />
            </View>
          </View>

          <Text style={styles.label}>Équipements</Text>
          <View style={[styles.wrap, { marginBottom: 16 }]}>
            {FEATURES.map((f) => (
              <Chip
                key={f}
                label={cap(f)}
                active={p.features.includes(f)}
                onPress={() =>
                  set('features', p.features.includes(f) ? p.features.filter((x) => x !== f) : [...p.features, f])
                }
              />
            ))}
          </View>

          <Field
            label="Description"
            multiline
            value={p.description}
            onChangeText={(v) => set('description', v)}
            placeholder="Points forts, environnement, finitions…"
          />
          <Field label="Téléphone du commercial" keyboardType="phone-pad" value={p.agentPhone} onChangeText={(v) => set('agentPhone', v)} />

          <Text style={styles.label}>Position du bien (pour les alertes de proximité)</Text>
          <Text style={styles.help}>Touchez la carte pour placer le bien, ou utilisez votre position si vous êtes sur place.</Text>
          <View style={styles.map}>
            <MapView
              key={loadedId ?? 'new'}
              style={StyleSheet.absoluteFill}
              initialRegion={
                hasPin ? { latitude: p.latitude, longitude: p.longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 } : MOROCCO_REGION
              }
              userInterfaceStyle="dark"
              onPress={(e: MapPressEvent) => {
                const { latitude, longitude } = e.nativeEvent.coordinate;
                setP((prev) => ({ ...prev, latitude, longitude }));
              }}>
              {hasPin && <Marker coordinate={{ latitude: p.latitude, longitude: p.longitude }} pinColor={Colors.magenta} />}
            </MapView>
          </View>
          <View style={[styles.cols, { alignItems: 'center', marginTop: 10 }]}>
            <Text style={[styles.help, { flex: 1, marginBottom: 0 }]}>
              {hasPin ? ` ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : 'Aucune position'}
            </Text>
            <Chip label="Ma position" icon="locate" onPress={useMyPosition} />
          </View>

          <Text style={styles.label}>Statut</Text>
          <View style={[styles.wrap, { marginBottom: 24 }]}>
            {STATUSES.map((s) => (
              <Chip key={s} label={cap(s)} active={p.status === s} onPress={() => set('status', s)} />
            ))}
          </View>

          <GradientButton label={existing ? 'Enregistrer' : 'Publier le bien'} icon="checkmark" loading={saving} onPress={save} />
          {existing && <GradientButton label="Supprimer" variant="danger" onPress={remove} style={{ marginTop: 12 }} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  help: { color: Colors.textMuted, fontSize: 12, marginBottom: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  cols: { flexDirection: 'row', gap: 12 },
  photo: { width: 96, height: 96, borderRadius: Radius.md },
  addPhoto: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.pink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  removePhoto: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  map: { height: 220, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
});
