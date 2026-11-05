import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState as RNAppState, Platform } from 'react-native';

import {
  MATCH_THRESHOLD,
  applyNeeds,
  askAssistant,
  emptyProfile,
  learnFromSwipe,
  normalizeProfile,
  parseNeeds,
  rankProperties,
  scoreProperty,
  type Scored,
} from '@/services/ai';
import * as api from '@/services/api';
import { notify } from '@/utils/platform';
import type { Coords } from '@/services/geo';
import { getPushToken, notifyNewMatch, setupNotifications } from '@/services/notifications';
import {
  checkNearby,
  getForegroundPermission,
  requestForegroundLocation,
  syncBackgroundGeofences,
  type BackgroundStatus,
} from '@/services/proximity';
import type { Approval, ChatMessage, Lead, Profile, Property, PropertyStats, Role, Swipe, SwipeAction, User, VisitStatus } from '@/types';

type RegisterInput = Omit<User, 'id' | 'role' | 'createdAt'> & { needs?: string; profile?: Partial<Profile> };

type AppState = {
  ready: boolean;
  user: User | null;
  users: User[];
  properties: Property[];
  swipes: Swipe[];
  leads: Lead[];
  /** Vus / likes / visites par bien (promoteur : ses biens ; super admin : tous). */
  stats: PropertyStats[];
  profile: Profile;
  chat: ChatMessage[];
  thinking: boolean;
  position: Coords | null;
  locationGranted: boolean;
  backgroundStatus: BackgroundStatus;

  likedIds: Set<string>;
  dislikedIds: Set<string>;
  /** Biens pas encore swipés, triés par compatibilité. */
  deck: Scored[];
  score: (p: Property) => Scored;

  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  swipe: (propertyId: string, action: SwipeAction) => Promise<void>;
  resetSwipes: () => Promise<void>;
  sendMessage: (text: string, profileEditMode?: boolean) => Promise<void>;
  /** Enregistre d'abord le message audio, puis le transcrit et l'envoie à l'assistant. */
  sendAudioMessage: (audioUri: string, profileEditMode?: boolean) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  enableLocation: () => Promise<boolean>;
  /** Demande (ou déplace) une visite à cette date ; les erreurs (créneau pris…) remontent au calendrier. */
  requestVisit: (propertyId: string, visitAt: number, note?: string) => Promise<void>;
  cancelVisit: (leadId: string) => Promise<void>;
  /** Personnel Selix : confirmer, déplacer ou annuler une visite (le client est notifié). Lève l'erreur en cas de conflit. */
  updateVisit: (leadId: string, patch: { visitAt?: number; visitStatus?: VisitStatus }) => Promise<void>;
  busySlots: (propertyId: string) => Promise<number[]>;
  saveProperty: (p: Property) => Promise<void>;
  deleteProperty: (id: string) => Promise<void>;
  updateLead: (id: string, patch: Partial<Lead>) => Promise<void>;
  /** Super admin : confie un lead à un commercial (null = le remettre « à assigner »). */
  assignLead: (id: string, commercialId: string | null) => Promise<void>;
  /** Super admin : valide ou refuse un bien déposé par un promoteur. */
  setApproval: (id: string, approval: Exclude<Approval, 'en attente'>, reason?: string) => Promise<void>;
  /** Super admin : comptes du personnel. Les erreurs (email déjà pris…) remontent à l'écran. */
  createStaff: (input: api.StaffInput) => Promise<User>;
  updateStaff: (id: string, patch: Parameters<typeof api.updateStaffUser>[1]) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  /** Recharge biens, swipes et leads depuis le serveur. */
  refresh: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

function alertError(e: unknown) {
  notify('Connexion impossible', e instanceof Error ? e.message : String(e));
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp doit être utilisé dans <AppProvider>');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [swipes, setSwipes] = useState<Swipe[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<PropertyStats[]>([]);
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  // Copie synchrone du profil : plusieurs swipes rapides ne doivent pas s'écraser.
  const profileRef = useRef<Profile>(profile);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [position, setPosition] = useState<Coords | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundStatus>('off');
  // Token push enregistré sur le serveur : c'est alors lui qui annonce les nouveaux biens.
  const pushTokenRef = useRef<string | null>(null);

  // ---- Chargement initial ----
  useEffect(() => {
    (async () => {
      try {
        const session = await api.getSession();
        if (session) await loadUser(session);
        else setProperties(await api.getProperties());
      } catch {
        // Serveur injoignable et rien en cache : l'écran de connexion affichera l'erreur.
      }
      setReady(true);
    })();
  }, []);

  /** Données partagées : changent quand l'admin publie ou qu'un client swipe. */
  async function loadShared(role: Role | undefined) {
    const wantsStats = role === 'admin' || role === 'promoteur';
    const [props, sw, ld, us, st] = await Promise.all([
      api.getProperties(),
      api.getSwipes(),
      api.getLeads(),
      api.getUsers(),
      wantsStats ? api.getPropertyStats() : Promise.resolve([] as PropertyStats[]),
    ]);
    setProperties(props);
    setSwipes(sw);
    setLeads(ld);
    setUsers(us);
    setStats(st);
  }

  async function loadUser(u: User) {
    setUser(u);
    const [p, c] = await Promise.all([api.getProfile(u.id), api.getChat(u.id), loadShared(u.role)]);
    /* Ancien chargement : profileRef.current = p ?? emptyProfile(); */
    profileRef.current = normalizeProfile(p);
    setProfile(profileRef.current);
    setChat(c);
    if (u.role === 'user' && Platform.OS !== 'web') {
      setLocationGranted(await getForegroundPermission());
      if (await setupNotifications()) {
        const token = await getPushToken();
        if (token) {
          await api.registerPushToken(token).catch(() => undefined);
          pushTokenRef.current = token;
        }
      }
    }
  }

  // Retour au premier plan, ou push reçu app ouverte : on récupère les nouveaux biens.
  const refreshShared = useEffectEvent(() => {
    if (user) loadShared(user.role).catch(() => undefined);
  });
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'active') refreshShared();
    });
    const pushSub =
      Platform.OS === 'web'
        ? null
        : Notifications.addNotificationReceivedListener((n) => {
            if (['match', 'visit'].includes(String(n.request.content.data?.kind))) refreshShared();
          });
    return () => {
      sub.remove();
      pushSub?.remove();
    };
  }, []);

  const isClient = user?.role === 'user';
  const mySwipes = useMemo(() => swipes.filter((s) => s.userId === user?.id), [swipes, user]);
  const likedIds = useMemo(
    () => new Set(mySwipes.filter((s) => s.action !== 'dislike').map((s) => s.propertyId)),
    [mySwipes],
  );
  const dislikedIds = useMemo(
    () => new Set(mySwipes.filter((s) => s.action === 'dislike').map((s) => s.propertyId)),
    [mySwipes],
  );
  const deck = useMemo(() => {
    const swiped = new Set(mySwipes.map((s) => s.propertyId));
    return rankProperties(profile, properties, { exclude: swiped, position }).filter(
      (s) => s.property.status === 'disponible',
    );
  }, [profile, properties, mySwipes, position]);

  /** Biens surveillés pour les alertes de proximité : aimés ou très compatibles. */
  const nearbyCandidates = useMemo(
    () =>
      properties
        .filter((p) => p.status === 'disponible' && !dislikedIds.has(p.id))
        /* Ancienne logique : .map((p) => ({ p, score: likedIds.has(p.id) ? 100 : scoreProperty(profile, p).score })) */
        .map((p) => ({ p, score: likedIds.has(p.id) ? 100 : scoreProperty(profile, p).score }))
        .filter((x) => x.score >= MATCH_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.p),
    [properties, profile, likedIds, dislikedIds],
  );

  // ---- Suivi de position au premier plan + alertes de proximité ----
  const candidatesRef = useRef(nearbyCandidates);
  const radiusRef = useRef(profile.radiusKm);
  useEffect(() => {
    candidatesRef.current = nearbyCandidates;
    radiusRef.current = profile.radiusKm;
  }, [nearbyCandidates, profile.radiusKm]);

  useEffect(() => {
    if (!isClient || !locationGranted || Platform.OS === 'web') return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 100, timeInterval: 30_000 },
      (loc) => {
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setPosition(coords);
        if (profile.notifyNearby) checkNearby(coords, candidatesRef.current, radiusRef.current);
      },
    ).then((s) => {
      if (cancelled) s.remove();
      else sub = s;
    });
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [isClient, locationGranted, profile.notifyNearby]);

  // ---- Géofencing en arrière-plan (build natif uniquement) ----
  useEffect(() => {
    if (!isClient || !locationGranted) return;
    syncBackgroundGeofences(nearbyCandidates, profile.radiusKm, profile.notifyNearby)
      .then(setBackgroundStatus)
      .catch(() => setBackgroundStatus('off'));
  }, [isClient, locationGranted, nearbyCandidates, profile.radiusKm, profile.notifyNearby]);

  // ---- « Un nouveau bien correspond à vos besoins » ----
  const notifyFreshMatches = useEffectEvent(async (u: User, props: Property[]) => {
    const seen = await api.getSeenPropertyIds(u.id);
    /* Ancienne logique : `if (seen)` ignorait les notifications du premier chargement où l'API renvoie null. */
    const seenIds = seen ?? [];
    const fresh = props.filter((p) => !seenIds.includes(p.id) && p.status === 'disponible');
    // Avec un token push, le serveur a déjà prévenu ce client : pas de doublon local.
    const matches = (pushTokenRef.current ? [] : fresh)
      .map((p) => scoreProperty(profileRef.current, p))
      .filter((s) => s.score >= MATCH_THRESHOLD)
      .slice(0, 3);
    for (const m of matches) await notifyNewMatch(m.property, m.score);
    await api.saveSeenPropertyIds(u.id, Array.from(new Set([...(seen ?? []), ...props.map((p) => p.id)])));
  });
  useEffect(() => {
    if (isClient && user && properties.length) notifyFreshMatches(user, properties);
  }, [isClient, user, properties]);

  async function persistProfile(next: Profile) {
    const normalized = normalizeProfile(next);
    profileRef.current = normalized;
    setProfile(normalized);
    // Hors connexion, le profil reste à jour dans l'app et sera renvoyé au prochain changement.
    if (user) await api.saveProfile(user.id, normalized).catch(() => undefined);
  }

  const value: AppState = {
    ready,
    user,
    users,
    properties,
    swipes,
    leads,
    stats,
    profile,
    chat,
    thinking,
    position,
    locationGranted,
    backgroundStatus,
    likedIds,
    dislikedIds,
    deck,
    score: (p) => scoreProperty(profile, p, position),

    async login(email, password) {
      const u = await api.login(email, password);
      await loadUser(u);
      return u;
    },

    async register({ needs, profile: initial, ...input }) {
      const u = await api.register(input);
      let p: Profile = normalizeProfile({ ...emptyProfile(), ...initial });
      if (needs?.trim()) p = applyNeeds(p, parseNeeds(needs));
      await api.saveProfile(u.id, p);
      await loadUser(u);
      return u;
    },

    async logout() {
      await api.logout(pushTokenRef.current);
      pushTokenRef.current = null;
      setUser(null);
      profileRef.current = emptyProfile();
      setProfile(profileRef.current);
      setChat([]);
      setPosition(null);
      setStats([]);
      setUsers([]);
      setLeads([]);
    },

    async swipe(propertyId, action) {
      if (!user) return;
      const property = properties.find((p) => p.id === propertyId);
      if (!property) return;
      // Optimiste : la carte part tout de suite, le serveur confirme ensuite.
      const isThis = (s: Swipe) => s.userId === user.id && s.propertyId === propertyId;
      setSwipes((prev) => [...prev.filter((s) => !isThis(s)), { userId: user.id, propertyId, action, at: Date.now() }]);
      try {
        setSwipes(await api.recordSwipe(user.id, propertyId, action));
        await persistProfile(learnFromSwipe(profileRef.current, property, action));
        setLeads(await api.getLeads());
      } catch (e) {
        setSwipes((prev) => prev.filter((s) => !isThis(s)));
        alertError(e);
      }
    },

    async resetSwipes() {
      if (!user) return;
      setSwipes(await api.clearSwipes(user.id).catch((e) => (alertError(e), swipes)));
    },

    async sendMessage(text, profileEditMode = false) {
      if (!user || !text.trim()) return;
      const userMsg: ChatMessage = { id: api.uid('m'), role: 'user', text: text.trim(), at: Date.now() };
      const history = [...chat, userMsg];
      setChat(history);
      setThinking(true);
      try {
        const out = await askAssistant({ text, history: chat, profile, properties, dislikedIds, position, profileEditMode });
        const reply: ChatMessage = {
          id: api.uid('m'),
          role: 'assistant',
          text: out.reply,
          propertyIds: out.propertyIds,
          at: Date.now(),
        };
        const next = [...history, reply];
        setChat(next);
        await api.saveChat(user.id, next).catch(() => undefined);
        await persistProfile(out.profile);
      } finally {
        setThinking(false);
      }
    },

    // Nouvelle procédure audio : le message visible contient l'URI audio; sa transcription sert au LLM.
    async sendAudioMessage(audioUri, profileEditMode = false) {
      if (!user) return;
      const userMsg: ChatMessage = { id: api.uid('m'), role: 'user', text: '', audioUri, at: Date.now() };
      const visibleHistory = [...chat, userMsg];
      // La bulle apparaît avant d'attendre la transcription et la réponse du modèle.
      setChat(visibleHistory);
      let persistableHistory = visibleHistory;
      setThinking(true);
      try {
        const transcript = (await api.transcribeAudio(audioUri)).trim();
        if (!transcript) throw new Error('Aucune parole détectée dans cet enregistrement.');
        const historyWithTranscript = [...chat, { ...userMsg, text: transcript }];
        persistableHistory = historyWithTranscript;
        setChat(historyWithTranscript);
        const out = await askAssistant({ text: transcript, history: chat, profile, properties, dislikedIds, position, profileEditMode });
        const reply: ChatMessage = {
          id: api.uid('m'),
          role: 'assistant',
          text: out.reply,
          propertyIds: out.propertyIds,
          at: Date.now(),
        };
        const next = [...historyWithTranscript, reply];
        setChat(next);
        await api.saveChat(user.id, next).catch(() => undefined);
        await persistProfile(out.profile);
      } catch (error) {
        await api.saveChat(user.id, persistableHistory).catch(() => undefined);
        throw error;
      } finally {
        setThinking(false);
      }
    },

    async updateProfile(patch) {
      await persistProfile({ ...profileRef.current, ...patch });
    },

    async enableLocation() {
      const granted = await requestForegroundLocation();
      setLocationGranted(granted);
      if (granted) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setPosition({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
      return granted;
    },

    async requestVisit(propertyId, visitAt, note) {
      if (!user) return;
      setLeads(await api.createLead(user.id, propertyId, 'visite', note, visitAt));
    },

    async cancelVisit(leadId) {
      setLeads(await api.updateLead(leadId, { visitStatus: 'annulée' }));
    },

    async updateVisit(leadId, patch) {
      setLeads(await api.updateLead(leadId, patch));
    },

    busySlots: (propertyId) => api.getBusySlots(propertyId).catch(() => []),

    async saveProperty(p) {
      setProperties(await api.saveProperty(p));
    },

    async deleteProperty(id) {
      setProperties(await api.deleteProperty(id));
    },

    async updateLead(id, patch) {
      setLeads(await api.updateLead(id, patch).catch((e) => (alertError(e), leads)));
    },

    async assignLead(id, commercialId) {
      // « assignedTo » présent mais vide = désassigner (voir api.updateLead).
      setLeads(await api.updateLead(id, { assignedTo: commercialId ?? undefined }).catch((e) => (alertError(e), leads)));
    },

    async setApproval(id, approval, reason) {
      setProperties(await api.setPropertyApproval(id, approval, reason));
    },

    async createStaff(input) {
      const created = await api.createStaffUser(input);
      setUsers((prev) => [...prev, created]);
      return created;
    },

    async updateStaff(id, patch) {
      const updated = await api.updateStaffUser(id, patch);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      // Désactiver un commercial ou changer son rôle remet ses leads « à assigner ».
      if (patch.disabled !== undefined || patch.role !== undefined) setLeads(await api.getLeads());
    },

    async changePassword(current, next) {
      await api.changePassword(current, next);
    },

    async refresh() {
      await loadShared(user?.role);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
