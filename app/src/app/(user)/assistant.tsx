import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PropertyRow } from '@/components/property-card';
import { Header, Logo, Screen } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { describeProfile } from '@/services/ai';
import { useApp } from '@/store/app-store';
import type { ChatMessage } from '@/types';

const SUGGESTIONS = [
  'Appartement 2 chambres à louer à Casablanca, max 15 000 DH',
  'Villa avec piscine à Marrakech, budget 9 millions',
  'Des biens près de moi',
  'Montre-moi d’autres propositions',
  'Recommencer ma recherche',
];

export default function Assistant() {
  const { user, chat, sendMessage, thinking, properties, profile, score } = useApp();
  const [text, setText] = useState('');
  const list = useRef<FlatList<ChatMessage>>(null);
  const criteria = describeProfile(profile);

  const welcome: ChatMessage = {
    id: 'welcome',
    role: 'assistant',
    text: `Bonjour ${user?.name.split(' ')[0] ?? ''}, je suis l’assistant Selix.\nDites-moi ce que vous cherchez (location ou achat, ville, budget, chambres…) et je vous propose les meilleurs biens. J’apprends aussi de vos swipes.`,
    at: 0,
  };
  const messages = [welcome, ...chat];

  function send(value = text) {
    if (!value.trim() || thinking) return;
    setText('');
    // On ferme le clavier pour laisser voir la réponse et les biens proposés.
    Keyboard.dismiss();
    sendMessage(value);
  }

  return (
    <Screen>
      <Header
        left={
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              <Logo variant="mark" height={22} />
            </View>
            <View>
              <Text style={styles.name}>Assistant Selix</Text>
              <Text style={styles.status}>● IA immobilière · en ligne</Text>
            </View>
          </View>
        }
      />
      {criteria ? (
        <View style={styles.criteria}>
          <Ionicons name="sparkles" size={13} color={Colors.gold} />
          <Text style={styles.criteriaText} numberOfLines={2}>
            Vos besoins : {criteria}
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
          <FlatList
            ref={list}
            style={{ flex: 1 }}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => (
              <View style={{ gap: 8 }}>
                <View style={[styles.bubble, item.role === 'user' ? styles.mine : styles.theirs]}>
                  <Text style={styles.bubbleText}>{item.text}</Text>
                </View>
                {item.propertyIds?.map((id) => {
                  const p = properties.find((x) => x.id === id);
                  return p ? <PropertyRow key={id} property={p} score={score(p).score} /> : null;
                })}
              </View>
            )}
            ListFooterComponent={
              thinking ? (
                <View style={[styles.bubble, styles.theirs, { marginTop: 12, flexDirection: 'row', gap: 8 }]}>
                  <ActivityIndicator size="small" color={Colors.pink} />
                  <Text style={styles.bubbleText}>Je cherche les meilleurs biens…</Text>
                </View>
              ) : undefined
            }
          />
        </Pressable>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={styles.suggestions}
          keyboardShouldPersistTaps="handled">
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} onPress={() => send(s)} style={styles.suggestion}>
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Décrivez votre besoin…"
            placeholderTextColor={Colors.textFaint}
            style={styles.input}
            multiline
            onSubmitEditing={() => send()}
            submitBehavior="submit"
            returnKeyType="send"
          />
          <Pressable onPress={() => send()} style={[styles.send, !text.trim() && { opacity: 0.4 }]}>
            <Ionicons name="arrow-up" size={22} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: '#fff', fontWeight: '700', fontSize: 16 },
  status: { color: Colors.like, fontSize: 11, marginTop: 2 },
  criteria: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    padding: 10,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(245,165,36,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,165,36,0.3)',
  },
  criteriaText: { color: Colors.text, fontSize: 12, flex: 1 },
  bubble: { maxWidth: '86%', padding: 12, borderRadius: 18 },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.cardStrong,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  suggestions: { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  suggestion: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: Colors.card,
  },
  suggestionText: { color: Colors.textMuted, fontSize: 12 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    paddingTop: 4,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    maxHeight: 110,
    minHeight: 48,
    backgroundColor: Colors.card,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 13,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.magenta,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
