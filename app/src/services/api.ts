/**
 * Couche de données Selix : client de l'API REST (dossier `selix-api/`, hébergée
 * avec le site). L'URL vient de EXPO_PUBLIC_SELIX_API_URL.
 *
 * - Authentification par jeton (stocké dans le trousseau de l'appareil) ; les
 *   mots de passe ne sont jamais conservés dans l'app, le serveur les hache.
 * - Les lectures sont mises en cache : hors connexion, l'app affiche les
 *   dernières données reçues au lieu d'un écran vide.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Approval, ChatMessage, Lead, Profile, Property, PropertyStats, StaffRole, Swipe, SwipeAction, User } from '@/types';

export const API_URL = (process.env.EXPO_PUBLIC_SELIX_API_URL ?? '').replace(/\/+$/, '');

const TOKEN_KEY = 'selix.token';
const CACHE = (path: string) => `selix:cache:${path}`;

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ---------- Jeton de session ----------

let token: string | null | undefined;

async function getToken() {
  if (token === undefined) {
    token = Platform.OS === 'web' ? await AsyncStorage.getItem(TOKEN_KEY) : await SecureStore.getItemAsync(TOKEN_KEY);
  }
  return token;
}

async function setToken(value: string | null) {
  token = value;
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(TOKEN_KEY, value);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } else if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ---------- HTTP ----------

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new ApiError(0, 'EXPO_PUBLIC_SELIX_API_URL n’est pas défini.');
  const t = await getToken();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : null),
        ...(t ? { Authorization: `Bearer ${t}` } : null),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Pas de connexion au serveur Selix.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && t) await setToken(null);
    throw new ApiError(res.status, data?.error ?? `Erreur serveur (${res.status}).`);
  }
  return data as T;
}

/** GET avec repli sur la dernière réponse connue quand le réseau ne répond pas. */
async function cachedGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const data = await request<T>('GET', path);
    AsyncStorage.setItem(CACHE(path), JSON.stringify(data)).catch(() => undefined);
    return data;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 0) throw e;
    const raw = await AsyncStorage.getItem(CACHE(path));
    return raw ? (JSON.parse(raw) as T) : fallback;
  }
}

async function clearCache() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('selix:')));
}

// ---------- Auth ----------

type AuthResponse = { token: string; user: User };

export async function getSession(): Promise<User | null> {
  if (!(await getToken())) return null;
  try {
    return await cachedGet<User | null>('/me', null);
  } catch {
    return null; // Jeton expiré ou révoqué : retour à l'écran de connexion.
  }
}

export async function login(email: string, password: string): Promise<User> {
  const res = await request<AuthResponse>('POST', '/auth/login', { email: email.trim(), password });
  await setToken(res.token);
  return res.user;
}

export async function register(input: Omit<User, 'id' | 'role' | 'createdAt'>): Promise<User> {
  const res = await request<AuthResponse>('POST', '/auth/register', { ...input, email: input.email.trim() });
  await setToken(res.token);
  return res.user;
}

export async function logout(pushToken?: string | null) {
  try {
    if (pushToken) await request('DELETE', `/push-tokens/${encodeURIComponent(pushToken)}`);
    await request('POST', '/auth/logout');
  } catch {
    // Hors ligne : le jeton local est effacé quand même.
  }
  await setToken(null);
  await clearCache();
}

/** Liste des comptes (admin uniquement ; vide pour un client). */
export function getUsers(): Promise<User[]> {
  return cachedGet<User[]>('/users', []);
}

// ---------- Biens ----------

export function getProperties(): Promise<Property[]> {
  return cachedGet<Property[]>('/properties', []);
}

/** Envoie une photo choisie sur le téléphone et renvoie son URL publique. */
async function uploadImage(uri: string): Promise<string> {
  const form = new FormData();
  const name = uri.split('/').pop()?.split('?')[0] || 'photo.jpg';
  if (Platform.OS === 'web') {
    form.append('file', await (await fetch(uri)).blob(), name);
  } else {
    const ext = name.split('.').pop()?.toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    // React Native accepte { uri, name, type } comme fichier dans un FormData.
    form.append('file', { uri, name, type } as unknown as Blob);
  }
  const { url } = await request<{ url: string }>('POST', '/photos', form);
  return url;
}

const isRemoteImage = (src: string) => src.startsWith('local:') || /^https?:\/\//.test(src);

export async function saveProperty(property: Property): Promise<Property[]> {
  const images = await Promise.all(property.images.map((src) => (isRemoteImage(src) ? src : uploadImage(src))));
  return request<Property[]>('PUT', `/properties/${encodeURIComponent(property.id)}`, { ...property, images });
}

export function deleteProperty(id: string): Promise<Property[]> {
  return request<Property[]>('DELETE', `/properties/${encodeURIComponent(id)}`);
}

/** Super admin : valide ou refuse (avec un motif) un bien déposé par un promoteur. */
export function setPropertyApproval(id: string, approval: Exclude<Approval, 'en attente'>, reason?: string): Promise<Property[]> {
  return request<Property[]>('POST', `/properties/${encodeURIComponent(id)}/approval`, { approval, reason });
}

/** Vus / likes / demandes de visite par bien (promoteur : ses biens ; admin : tous). */
export function getPropertyStats(): Promise<PropertyStats[]> {
  return cachedGet<PropertyStats[]>('/stats/properties', []);
}

// ---------- Comptes du personnel (super admin) ----------

export type StaffInput = { name: string; email: string; phone: string; password: string; role: StaffRole };

export function createStaffUser(input: StaffInput): Promise<User> {
  return request<User>('POST', '/users', input);
}

export function updateStaffUser(
  id: string,
  patch: Partial<Pick<User, 'name' | 'phone' | 'disabled'>> & { role?: StaffRole; password?: string },
): Promise<User> {
  return request<User>('PATCH', `/users/${encodeURIComponent(id)}`, patch);
}

export async function changePassword(current: string, next: string) {
  await request('POST', '/me/password', { current, next });
}

// ---------- Swipes & leads ----------
// Le serveur identifie l'utilisateur par son jeton : les paramètres userId sont
// gardés pour la lisibilité des appels mais ne sont pas transmis.

export function getSwipes(): Promise<Swipe[]> {
  return cachedGet<Swipe[]>('/swipes', []);
}

export function recordSwipe(_userId: string, propertyId: string, action: SwipeAction): Promise<Swipe[]> {
  // Un like crée aussi un lead côté serveur (« Un commercial va vous contacter »).
  return request<Swipe[]>('POST', '/swipes', { propertyId, action });
}

export function clearSwipes(_userId: string): Promise<Swipe[]> {
  return request<Swipe[]>('DELETE', '/swipes');
}

export function getLeads(): Promise<Lead[]> {
  return cachedGet<Lead[]>('/leads', []);
}

export function createLead(_userId: string, propertyId: string, kind: Lead['kind'], note?: string, visitAt?: number): Promise<Lead[]> {
  return request<Lead[]>('POST', '/leads', { propertyId, kind, note, visitAt });
}

/** Horaires déjà confirmés pour ce bien : le calendrier les grise. */
export function getBusySlots(propertyId: string): Promise<number[]> {
  return request<number[]>('GET', `/properties/${encodeURIComponent(propertyId)}/busy`);
}

export function updateLead(id: string, patch: Partial<Lead>): Promise<Lead[]> {
  // assignedTo: null = désassigner ; absent = ne pas toucher à l'assignation.
  return request<Lead[]>('PATCH', `/leads/${encodeURIComponent(id)}`, {
    status: patch.status,
    note: patch.note,
    visitAt: patch.visitAt,
    visitStatus: patch.visitStatus,
    ...('assignedTo' in patch ? { assignedTo: patch.assignedTo ?? null } : null),
  });
}

// ---------- Profil IA, chat, biens déjà notifiés ----------

export function getProfile(_userId: string): Promise<Profile | null> {
  return cachedGet<Profile | null>('/me/profile', null);
}

export async function saveProfile(_userId: string, profile: Profile) {
  // Le serveur s'en sert pour choisir à qui envoyer « nouveau bien pour vous ».
  await request('PUT', '/me/profile', { data: profile });
}

export function getChat(_userId: string): Promise<ChatMessage[]> {
  return cachedGet<ChatMessage[] | null>('/me/chat', null).then((c) => c ?? []);
}

export async function saveChat(_userId: string, messages: ChatMessage[]) {
  await request('PUT', '/me/chat', { data: messages.slice(-100) });
}

export function getSeenPropertyIds(_userId: string): Promise<string[] | null> {
  return cachedGet<string[] | null>('/me/seen', null);
}

export async function saveSeenPropertyIds(_userId: string, ids: string[]) {
  await request('PUT', '/me/seen', { data: ids });
}

// ---------- Notifications push & assistant ----------

export async function registerPushToken(pushToken: string) {
  await request('POST', '/push-tokens', { token: pushToken });
}

export type ChatRequest = {
  message: string;
  history: { role: ChatMessage['role']; text: string }[];
  profile: Profile;
  candidates: Record<string, unknown>[];
};

export type ChatResponse = { reply: string; propertyIds?: string[]; needs?: Record<string, unknown> };

/** Assistant Claude, appelé par le serveur (la clé API n'est jamais dans l'app). */
export function postChat(body: ChatRequest): Promise<ChatResponse> {
  return request<ChatResponse>('POST', '/chat', body);
}
