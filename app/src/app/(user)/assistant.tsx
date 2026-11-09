import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PropertyRow } from '@/components/property-card';
import { Header, KeyboardAware, Logo, Screen } from '@/components/ui';
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

const AUDIO_WAVE_SHAPE = [
  0.24, 0.42, 0.7, 0.48, 0.88, 0.56, 0.34, 0.76, 0.48, 0.96,
  0.62, 0.38, 0.82, 0.54, 0.3, 0.72, 0.94, 0.5, 0.36, 0.78,
  0.58, 0.9, 0.42, 0.68, 0.32, 0.84, 0.56, 0.38, 0.74, 0.46,
];

/** Isole les groupes de chiffres en LTR pour empêcher le texte arabe RTL d'en inverser l'ordre visuel. */
function preserveLtrNumberOrder(text: string): string {
  return text.replace(/\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g, '\u2066$&\u2069');
}

function AudioPlayback({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const duration = Math.max(0, Math.floor(status.duration || 0));
  const current = Math.max(0, Math.floor(status.currentTime || 0));
  const progress = duration ? Math.min(1, current / duration) : 0;
  const activeBars = Math.floor(progress * AUDIO_WAVE_SHAPE.length);
  const timeLabel = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;

  return (
    <View style={styles.audioPlayback}>
      <Pressable
        onPress={() => {
          if (status.playing) player.pause();
          else void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).then(() => player.play()).catch(() => undefined);
        }}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Mettre l’audio en pause' : 'Lire le message audio'}
        style={styles.audioPlayButton}>
        <Ionicons name={status.playing ? 'pause' : 'play'} size={17} color="#fff" />
      </Pressable>
      <View style={styles.audioPlaybackDetails}>
        <View style={styles.audioWaveform} accessibilityLabel="Onde sonore du message vocal">
          {AUDIO_WAVE_SHAPE.map((height, index) => (
            <View
              key={index}
              style={[styles.audioWaveBar, {
                height: 5 + height * 20,
                backgroundColor: index < activeBars ? '#fff' : 'rgba(255,255,255,0.42)',
              }]}
            />
          ))}
        </View>
        <Text style={styles.audioDuration}>{timeLabel(status.playing ? current : duration)}</Text>
      </View>
    </View>
  );
}

export default function Assistant() {
  const { user, chat, sendMessage, sendAudioMessage, thinking, properties, profile, score } = useApp();
  const { profileEdit } = useLocalSearchParams<{ profileEdit?: string }>();
  const profileEditMode = profileEdit === '1';
  // Le premier message après le bouton est maintenant forcé côté serveur ; les suivants sont classifiés normalement.
  const forceFirstProfileEdit = useRef(profileEditMode);
  const [text, setText] = useState('');
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const [audioMessage, setAudioMessage] = useState('');
  const [permissionSettingsRequired, setPermissionSettingsRequired] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const criteria = describeProfile(profile);
  const audioLevel = typeof recorderState.metering === 'number'
    ? Math.max(0.12, Math.min(1, (recorderState.metering + 60) / 60))
    : 0.2;
  const waveformShape = [0.35, 0.56, 0.76, 0.48, 1, 0.68, 0.86, 0.55, 0.32, 0.62, 0.42, 0.78, 0.5, 0.9, 0.38, 0.7, 0.54, 0.84, 0.46, 0.58, 0.82, 0.4, 0.7, 0.52, 0.92, 0.44, 0.66];
  const waveformLevels = waveformShape.map((shape) => Math.max(0.12, audioLevel * shape));

  const welcome: ChatMessage = {
    id: 'welcome',
    role: 'assistant',
    text: `Bonjour ${user?.name.split(' ')[0] ?? ''}, je suis l’assistant Selix.\nDites-moi ce que vous cherchez (location ou achat, ville, budget, chambres…) et je vous propose les meilleurs biens. J’apprends aussi de vos swipes.`,
    at: 0,
  };
  const messages = [welcome, ...chat];

  async function send(value = text) {
    if (thinking || transcribingAudio) return;
    if (recordingAudio || recorderState.isRecording) {
      setRecordingAudio(false);
      setTranscribingAudio(true);
      setAudioMessage('');
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error('L’enregistrement audio est introuvable.');
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        setText('');
        Keyboard.dismiss();
        const forceProfileEdit = forceFirstProfileEdit.current;
        await sendAudioMessage(uri, profileEditMode, forceProfileEdit);
        if (forceProfileEdit) forceFirstProfileEdit.current = false;
      } catch (error) {
        setAudioMessage(error instanceof Error ? error.message : 'Impossible de traiter cet enregistrement.');
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      } finally {
        setRecordingAudio(false);
        setTranscribingAudio(false);
      }
      return;
    }
    if (!value.trim()) return;
    setText('');
    Keyboard.dismiss();
    const forceProfileEdit = forceFirstProfileEdit.current;
    await sendMessage(value.trim(), profileEditMode, forceProfileEdit);
    if (forceProfileEdit) forceFirstProfileEdit.current = false;
  }

  async function toggleAudioRecording() {
    if (recordingAudio || transcribingAudio || thinking) return;
    setAudioMessage('');
    setPermissionSettingsRequired(false);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPermissionSettingsRequired(!permission.canAskAgain);
        setAudioMessage(permission.canAskAgain
          ? 'L’accès au microphone est refusé. Appuyez sur le micro et autorisez-le pour enregistrer.'
          : 'L’accès au microphone est bloqué. Autorisez-le dans les réglages du téléphone.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingAudio(true);
    } catch (error) {
      setRecordingAudio(false);
      setAudioMessage(error instanceof Error ? error.message : 'Impossible de traiter cet enregistrement.');
      if (recorderState.isRecording) await recorder.stop().catch(() => undefined);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    } finally {
      setTranscribingAudio(false);
    }
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

      <KeyboardAware>
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
            // Le clavier qui s'ouvre ou se ferme change la hauteur de la liste : le dernier message reste en vue.
            onLayout={() => list.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => (
              <View style={{ gap: 8 }}>
                <View style={[styles.bubble, item.role === 'user' ? styles.mine : styles.theirs]}>
                  {item.audioUri
                    ? <AudioPlayback uri={item.audioUri} />
                    : <Text style={styles.bubbleText}>{preserveLtrNumberOrder(item.text)}</Text>}
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
          <View style={styles.composerField}>
            {recorderState.isRecording ? (
              <View style={styles.waveform} accessibilityLabel="Niveau sonore du microphone">
                {waveformLevels.map((level, index) => (
                  <View key={index} style={[styles.waveformBar, { height: 5 + level * 22 }]} />
                ))}
              </View>
            ) : (
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={transcribingAudio ? 'Transcription en cours…' : 'Décrivez votre besoin…'}
                placeholderTextColor={Colors.textFaint}
                style={styles.composerTextInput}
                multiline
                editable={!transcribingAudio}
                onSubmitEditing={() => send()}
                submitBehavior="submit"
                returnKeyType="send"
              />
            )}
            {!recordingAudio && !recorderState.isRecording && !transcribingAudio ? (
              <Pressable
                onPress={toggleAudioRecording}
                disabled={thinking}
                accessibilityRole="button"
                accessibilityLabel="Enregistrer une demande vocale"
                style={[styles.audioButton, thinking && { opacity: 0.5 }]}>
                <Ionicons name="mic" size={20} color="#fff" />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => send()}
            disabled={(!text.trim() && !recordingAudio && !recorderState.isRecording) || thinking || transcribingAudio}
            style={[styles.send, ((!text.trim() && !recordingAudio && !recorderState.isRecording) || thinking || transcribingAudio) && { opacity: 0.4 }]}>
            {transcribingAudio ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={22} color="#fff" />}
          </Pressable>
        </View>
        {audioMessage ? (
          <View style={styles.audioFeedback}>
            <Text style={styles.audioMessage}>{audioMessage}</Text>
            {permissionSettingsRequired ? (
              <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
                <Text style={styles.settingsLink}>Ouvrir les réglages</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </KeyboardAware>
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
  audioPlayback: { minWidth: 190, maxWidth: 260, flexDirection: 'row', alignItems: 'center', gap: 10 },
  audioPlayButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioPlaybackDetails: { flex: 1, gap: 4 },
  audioWaveform: { height: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 },
  audioWaveBar: { width: 3, borderRadius: 2 },
  audioDuration: { color: '#fff', fontSize: 11 },
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
  composerField: {
    flex: 1,
    minHeight: 48,
    maxHeight: 110,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: Colors.card,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 6,
  },
  composerTextInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    minHeight: 46,
    maxHeight: 108,
    paddingTop: 12,
    paddingBottom: 12,
  },
  audioButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  waveform: {
    flex: 1,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    marginHorizontal: 10,
    marginBottom: 4,
  },
  waveformBar: { width: 2, borderRadius: 1, backgroundColor: '#FF7190' },
  audioFeedback: { paddingHorizontal: 18, paddingBottom: 6, gap: 4 },
  audioMessage: { color: Colors.textMuted, fontSize: 12 },
  settingsLink: { color: Colors.gold, fontSize: 12, fontWeight: '600' },
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
