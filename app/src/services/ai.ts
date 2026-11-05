/**
 * Moteur IA Selix (côté app).
 *
 * 1. Apprentissage : chaque swipe (like / dislike / coup de cœur) ajuste des
 *    poids par ville, quartier, type de bien, équipements et gamme de prix.
 * 2. Scoring : chaque bien reçoit un score de compatibilité 0–100 combinant les
 *    besoins explicites (dits dans le chat) et les préférences apprises.
 * 3. Assistant : comprend une demande en français (et quelques mots de darija),
 *    met à jour les besoins et propose les meilleurs biens.
 *
 * Quand l'API Selix est configurée (EXPO_PUBLIC_SELIX_API_URL), la conversation
 * est envoyée au serveur, qui interroge Claude ; hors connexion, le moteur local répond.
 */
import { API_URL, postChat } from '@/services/api';
import { distanceKm, type Coords } from '@/services/geo';
import type { ChatMessage, Profile, Property, PropertyType, SwipeAction, Transaction } from '@/types';
import { formatCompact } from '@/utils/format';

export function emptyProfile(): Profile {
  return {
    cities: [],
    districts: [],
    types: [],
    mustHave: [],
    learned: { cities: {}, districts: {}, types: {}, features: {}, likedPrice: {}, bedrooms: { sum: 0, n: 0 } },
    notifyNearby: true,
    radiusKm: 2,
  };
}

function normalizeLearned(value: unknown): Profile['learned'] {
  const defaults = emptyProfile().learned;
  const source = value && typeof value === 'object' ? (value as Partial<Profile['learned']>) : {};
  return {
    ...defaults,
    ...source,
    cities: { ...defaults.cities, ...(source.cities ?? {}) },
    districts: { ...defaults.districts, ...(source.districts ?? {}) },
    types: { ...defaults.types, ...(source.types ?? {}) },
    features: { ...defaults.features, ...(source.features ?? {}) },
    likedPrice: { ...defaults.likedPrice, ...(source.likedPrice ?? {}) },
    bedrooms: { ...defaults.bedrooms, ...(source.bedrooms ?? {}) },
  };
}

/** Normalise et ne conserve que les champs du profil utilisateur. */
export function normalizeProfile(value?: Partial<Profile> | null): Profile {
  const defaults = emptyProfile();
  const raw = value ?? {};
  const learned = normalizeLearned(raw.learned);
  return {
    transaction: raw.transaction,
    cities: raw.cities ?? defaults.cities,
    districts: raw.districts ?? defaults.districts,
    types: raw.types ?? defaults.types,
    budgetMin: raw.budgetMin,
    budgetMax: raw.budgetMax,
    bedroomsMin: raw.bedroomsMin,
    mustHave: raw.mustHave ?? defaults.mustHave,
    learned,
    notifyNearby: raw.notifyNearby ?? defaults.notifyNearby,
    radiusKm: raw.radiusKm ?? defaults.radiusKm,
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// ---------------------------------------------------------------------------
// Apprentissage par les swipes
// ---------------------------------------------------------------------------

const SWIPE_WEIGHT: Record<SwipeAction, number> = { like: 1, superlike: 2, dislike: -0.6 };

export function learnFromSwipe(profile: Profile, property: Property, action: SwipeAction): Profile {
  const d = SWIPE_WEIGHT[action];
  const bump = (rec: Record<string, number>, key: string, delta: number) => ({
    ...rec,
    [key]: clamp((rec[key] ?? 0) + delta, -6, 10),
  });
  const l = profile.learned;
  let features = l.features;
  for (const f of property.features) features = bump(features, f, d * 0.5);

  const learned: Profile['learned'] = {
    cities: bump(l.cities, property.city, d),
    districts: bump(l.districts, property.district, d),
    types: bump(l.types, property.type, d),
    features,
    likedPrice: { ...l.likedPrice },
    bedrooms: { ...l.bedrooms },
  };
  if (action !== 'dislike') {
    const prev = learned.likedPrice[property.transaction] ?? { sum: 0, n: 0 };
    learned.likedPrice[property.transaction] = { sum: prev.sum + property.price, n: prev.n + 1 };
    if (property.bedrooms > 0) {
      learned.bedrooms = { sum: l.bedrooms.sum + property.bedrooms, n: l.bedrooms.n + 1 };
    }
  }
  return { ...profile, learned };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type Scored = { property: Property; score: number; reasons: string[]; distance?: number };

export function scoreProperty(profile: Profile, p: Property, position?: Coords | null): Scored {
  let s = 50;
  const reasons: string[] = [];
  const l = profile.learned;

  if (profile.transaction) {
    if (profile.transaction === p.transaction) s += 10;
    else s -= 45;
  }

  if (profile.budgetMax) {
    if (p.price <= profile.budgetMax) {
      s += 15;
      reasons.push('Dans votre budget');
    } else {
      s -= Math.min(40, (p.price / profile.budgetMax - 1) * 80);
    }
  }
  if (profile.budgetMin && p.price < profile.budgetMin * 0.7) s -= 5;

  const liked = l.likedPrice[p.transaction];
  if (!profile.budgetMax && liked && liked.n >= 2) {
    const ratio = p.price / (liked.sum / liked.n);
    if (ratio > 0.7 && ratio < 1.3) {
      s += 8;
      reasons.push('Prix proche de ce que vous aimez');
    } else s -= Math.min(15, Math.abs(Math.log(ratio)) * 15);
  }

  if (profile.cities.length) {
    if (profile.cities.includes(p.city)) {
      s += 15;
      reasons.push(`À ${p.city}`);
    } else s -= 40;
  }
  if (profile.districts.length && profile.districts.includes(p.district)) {
    s += 8;
    reasons.push(`Quartier ${p.district}`);
  }
  const cityW = l.cities[p.city] ?? 0;
  const districtW = l.districts[p.district] ?? 0;
  s += clamp(cityW * 4, -10, 10) + clamp(districtW * 3, -8, 8);
  if (districtW >= 2 && !reasons.some((r) => r.startsWith('Quartier'))) {
    reasons.push(`${p.district}, un quartier que vous aimez`);
  }

  if (profile.types.length) {
    if (profile.types.includes(p.type)) s += 10;
    // Un studio reste proche d'un appartement ; un bureau ou un terrain non.
    else if (p.type === 'studio' && profile.types.includes('appartement')) s -= 8;
    else s -= 30;
  }
  const typeW = l.types[p.type] ?? 0;
  s += clamp(typeW * 4, -10, 10);
  if (typeW >= 2) reasons.push(`Vous aimez les ${p.type}s`);

  if (profile.bedroomsMin) {
    if (p.bedrooms >= profile.bedroomsMin) {
      s += 6;
      reasons.push(`${p.bedrooms} chambres`);
    } else s -= 12 * (profile.bedroomsMin - p.bedrooms);
  }

  for (const f of profile.mustHave) {
    if (p.features.includes(f)) {
      s += 5;
      reasons.push(f.charAt(0).toUpperCase() + f.slice(1));
    } else s -= 8;
  }
  s += clamp(
    p.features.reduce((sum, f) => sum + (l.features[f] ?? 0), 0) * 2,
    -10,
    12,
  );

  if (p.status !== 'disponible') s -= 30;

  let distance: number | undefined;
  if (position) {
    distance = distanceKm(position, p);
    if (distance <= profile.radiusKm) reasons.unshift('Tout près de vous');
  }

  return { property: p, score: Math.round(clamp(s, 0, 100)), reasons: reasons.slice(0, 3), distance };
}

export function rankProperties(
  profile: Profile,
  properties: Property[],
  opts: { exclude?: Set<string>; position?: Coords | null } = {},
): Scored[] {
  return properties
    .filter((p) => !opts.exclude?.has(p.id))
    .map((p) => scoreProperty(profile, p, opts.position))
    .sort((a, b) => b.score - a.score);
}

/** Seuil à partir duquel un bien est considéré comme « fait pour vous ». */
export const MATCH_THRESHOLD = 65;

// ---------------------------------------------------------------------------
// Compréhension des besoins
// ---------------------------------------------------------------------------

// Ancien parser (sans les synonymes ajoutés) conservé ci-dessous :
// const CITIES: Record<string, string[]> = {
//   Casablanca: ['casablanca', 'casa', 'dar el beida', 'derb'],
//   Rabat: ['rabat'],
//   Marrakech: ['marrakech', 'marrakesh', 'kech'],
//   Tanger: ['tanger', 'tangier', 'tanja'],
//   Agadir: ['agadir'],
//   Fès: ['fes', 'fez'],
//   Bouskoura: ['bouskoura'],
//   Mohammedia: ['mohammedia'],
//   Kénitra: ['kenitra'],
//   'Dar Bouazza': ['dar bouazza'],
//   Témara: ['temara'],
//   Salé: ['sale'],
//   Meknès: ['meknes'],
//   Oujda: ['oujda'],
// };
//
// const DISTRICTS: Record<string, { keys: string[]; city: string }> = {
//   Anfa: { keys: ['anfa(?! 5)'], city: 'Casablanca' },
//   Maârif: { keys: ['maarif'], city: 'Casablanca' },
//   Racine: { keys: ['racine'], city: 'Casablanca' },
//   Gauthier: { keys: ['gauthier'], city: 'Casablanca' },
//   'Aïn Diab': { keys: ['ain diab'], city: 'Casablanca' },
//   Californie: { keys: ['californie'], city: 'Casablanca' },
//   Bourgogne: { keys: ['bourgogne'], city: 'Casablanca' },
//   'CIL': { keys: ['cil'], city: 'Casablanca' },
//   Palmeraie: { keys: ['palmeraie'], city: 'Marrakech' },
//   Guéliz: { keys: ['gueliz'], city: 'Marrakech' },
//   Hivernage: { keys: ['hivernage'], city: 'Marrakech' },
//   Agdal: { keys: ['agdal'], city: 'Rabat' },
//   'Hay Riad': { keys: ['hay riad'], city: 'Rabat' },
//   Souissi: { keys: ['souissi'], city: 'Rabat' },
//   Malabata: { keys: ['malabata'], city: 'Tanger' },
//   Marina: { keys: ['marina'], city: 'Agadir' },
//   'Ville Verte': { keys: ['ville verte'], city: 'Bouskoura' },
//   Chrifia: { keys: ['chrifia'], city: 'Marrakech' },
//   'Anfa 5': { keys: ['anfa 5'], city: 'Dar Bouazza' },
// };
//
// const TYPES: Record<PropertyType, RegExp> = {
//   appartement: /\b(appartements?|appart|appt|duplex|penthouse|[tf][1-6])\b/,
//   villa: /\b(villas?|maison|dar(?! bouazza| el beida))\b/,
//   studio: /\bstudios?\b/,
//   riad: /\briads?\b/,
//   bureau: /\b(bureaux?|plateau|local commercial|magasin)\b/,
//   terrain: /\b(terrains?|lot)\b/,
// };
//
// const FEATURES: Record<string, RegExp> = {
//   padel: /padel/,
//   piscine: /piscine/,
//   jardin: /jardin/,
//   parking: /parking|garage/,
//   meublé: /\bmeuble/,
//   'vue mer': /vue (sur )?(la )?mer|bord de mer|front de mer/,
//   terrasse: /terrasse/,
//   ascenseur: /ascenseur/,
//   sécurité: /securi|gardien|residence fermee/,
//   climatisation: /clim/,
//   balcon: /balcon/,
// };

const CITIES: Record<string, string[]> = {
  Casablanca: ['casablanca', 'casa', 'dar el beida', 'derb', 'الدار البيضاء'],
  Rabat: ['rabat', 'الرباط'],
  Marrakech: ['marrakech', 'marrakesh', 'kech', 'مراكش'],
  Tanger: ['tanger', 'tangier', 'tanja', 'طنجة'],
  Agadir: ['agadir', 'أكادير'],
  Fès: ['fes', 'fez', 'فاس'],
  Bouskoura: ['bouskoura', 'بوسكورة'],
  Mohammedia: ['mohammedia', 'المحمدية'],
  Kénitra: ['kenitra', 'القنيطرة'],
  'Dar Bouazza': ['dar bouazza', 'دار بوعزة'],
  Témara: ['temara', 'تمارة'],
  Salé: ['sale', 'سلا'],
  Meknès: ['meknes', 'مكناس'],
  Oujda: ['oujda', 'وجدة'],
};

const DISTRICTS: Record<string, { keys: string[]; city: string }> = {
  Anfa: { keys: ['anfa(?! 5)', 'أنفا'], city: 'Casablanca' },
  Maârif: { keys: ['maarif','معاريف'], city: 'Casablanca' },
  Racine: { keys: ['racine','راسين'], city: 'Casablanca' },
  Gauthier: { keys: ['gauthier','غوتيي'], city: 'Casablanca' },
  'Aïn Diab': { keys: ['ain diab','عين الدياب'], city: 'Casablanca' },
  Californie: { keys: ['californie','كاليفورنيا'], city: 'Casablanca' },
  Bourgogne: { keys: ['bourgogne','بوركون'], city: 'Casablanca' },
  'CIL': { keys: ['cil','سيل'], city: 'Casablanca' },
  Palmeraie: { keys: ['palmeraie'], city: 'Marrakech' },
  Guéliz: { keys: ['gueliz','كيليز'], city: 'Marrakech' },
  Hivernage: { keys: ['hivernage'], city: 'Marrakech' },
  Agdal: { keys: ['agdal','اكدال '], city: 'Rabat' },
  'Hay Riad': { keys: ['hay riad','حي الرياض'], city: 'Rabat' },
  Souissi: { keys: ['souissi','سويسي'], city: 'Rabat' },
  Malabata: { keys: ['malabata','مالاباطا'], city: 'Tanger' },
  Marina: { keys: ['marina','مارينا'], city: 'Agadir' },
  'Ville Verte': { keys: ['ville verte'], city: 'Bouskoura' },
  Chrifia: { keys: ['chrifia','شريفية'], city: 'Marrakech' },
  'Anfa 5': { keys: ['anfa 5','أنفا 5'], city: 'Dar Bouazza' },
};

const TYPES: Record<PropertyType, RegExp> = {
  appartement: /\b(appartements?|appart|appt|duplex|penthouse|[tf][1-6])\b|شقة|شقق|بارطما|دوبلكس/iu,
  villa: /\b(villas?|maison|dar(?! bouazza| el beida))\b|فيلا|فيلات|منزل|منازل/iu,
  studio: /\bstudios?\b|ستوديو|استوديو/iu,
  riad: /\briads?\b|رياض/iu,
  bureau: /\b(bureaux?|plateau|local commercial|magasin)\b|مكتب|مكاتب/iu,
  terrain: /\b(terrains?|lot)\b|أرض|أراضي|ارض|اراضي/iu,
};


/* Ancien dictionnaire conservé en commentaire selon la consigne du projet.
const FEATURES: Record<string, RegExp> = {
  padel: /padel/,
  piscine: /piscine/,
  jardin: /jardin/,
  parking: /parking|garage/,
  meublé: /\bmeuble/,
  'vue mer': /vue (sur )?(la )?mer|bord de mer|front de mer/,
  terrasse: /terrasse/,
  ascenseur: /ascenseur/,
  sécurité: /securi|gardien|residence fermee/,
  climatisation: /clim/,
  balcon: /balcon/,
};
*/

// Ajout arabe : les synonymes sont ramenés aux clés de caractéristiques utilisées par le score.
const FEATURES: Record<string, RegExp> = {
  padel: /padel|بادل/iu,
  piscine: /piscine|مسبح|مسابح|حمام\s+سباحة|بيسين/iu,
  jardin: /jardin|حديقة|حدائق|جنان/iu,
  parking: /parking|garage|كراج|مرآب|مراب|موقف\s+سيارات|باركينغ/iu,
  meublé: /\bmeuble|مفروش|مفروشة|مؤثث|مؤثثة/iu,
  'vue mer': /vue (sur )?(la )?mer|bord de mer|front de mer|مطلة?\s+على\s+البحر|إطلالة\s+(?:على\s+)?البحر|اطلالة\s+(?:على\s+)?البحر/iu,
  terrasse: /terrasse|تراس|سطح/iu,
  ascenseur: /ascenseur|مصعد|أسانسير|اسانسير/iu,
  sécurité: /securi|gardien|residence fermee|أمن|امن|حراسة|حارس|آمن|امن/iu,
  climatisation: /clim|تكييف|مكيف|مكيفة|مكيف الهواء/iu,
  balcon: /balcon|شرفة|بلكون|/iu,
};

// JavaScript \b ne reconnaît pas les lettres arabes : les alias arabes sont cherchés comme sous-chaînes.
function containsAlias(text: string, alias: string): boolean {
  return /[\u0600-\u06ff]/i.test(alias) ? text.includes(alias) : new RegExp(`\\b${alias}\\b`).test(text);
}

export type Needs = {
  transaction?: Transaction;
  cities: string[];
  districts: string[];
  types: PropertyType[];
  budgetMin?: number;
  budgetMax?: number;
  bedroomsMin?: number;
  mustHave: string[];
  nearMe: boolean;
  reset: boolean;
  greeting: boolean;
  more: boolean;
};

function parseAmount(num: string, unit?: string) {
  const n = parseFloat(num.replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(n)) return undefined;
  if (unit && /^(millions?|mdh|m)$/.test(unit)) return n * 1_000_000;
  if (unit && /^(k|mille)$/.test(unit)) return n * 1_000;
  return n;
}

export function parseNeeds(input: string): Needs {
  const t = ` ${norm(input)} `;
  const needs: Needs = {
    cities: [],
    districts: [],
    types: [],
    mustHave: [],
    nearMe: /pres de moi|autour de moi|proche de moi|a cote de moi|a proximite|9rib/.test(t),
    reset: /recommencer|reinitialis|nouvelle recherche|oublie (tout|mes)/.test(t),
    greeting: /^\s*(salut|bonjour|bonsoir|salam|slm|hello|hi|coucou|cc)\b/.test(t),
    more: /\b(autres?|encore|d'autres|plus de (choix|propositions))\b/.test(t),
  };

  if (/\b(louer|location|loyer|a louer|kra|nkri|kira|par mois)\b|كراء|نكري/ui.test(t)) needs.transaction = 'location';
  if (/\b(acheter|achat|acquerir|investir|investissement|a vendre|chri|nchri|acquisition)\b|شراء|نشري/ui.test(t)) {
    needs.transaction = 'achat';
  }

  for (const [city, keys] of Object.entries(CITIES)) {
    if (keys.some((k) => containsAlias(t, k))) needs.cities.push(city);
  }
  for (const [district, { keys, city }] of Object.entries(DISTRICTS)) {
    if (keys.some((k) => containsAlias(t, k))) {
      needs.districts.push(district);
      if (!needs.cities.includes(city)) needs.cities.push(city);
    }
  }
  for (const [type, re] of Object.entries(TYPES) as [PropertyType, RegExp][]) {
    if (re.test(t)) needs.types.push(type);
  }
  for (const [feature, re] of Object.entries(FEATURES)) {
    if (re.test(t)) needs.mustHave.push(feature);
  }

  const bed = t.match(/(\d+)\s*(chambres?|ch\b|pieces?)/);
  const tf = t.match(/\b[tf]([2-6])\b/);
  if (bed) needs.bedroomsMin = /piece/.test(bed[2]) ? Math.max(1, +bed[1] - 1) : +bed[1];
  else if (tf) needs.bedroomsMin = +tf[1] - 1;

  // Montants : « 2 millions », « 12 000 dh », « 15k », « 1,5 m », « entre 8000 et 12000 »
  const amountRe = /(\d+(?:[ .]\d{3})*(?:,\d+)?)\s*(millions?|mdh|m(?![2²a-z])|k(?![a-z])|mille)?/g;
  const amounts: { value: number; index: number }[] = [];
  for (const m of t.matchAll(amountRe)) {
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 10);
    if (/^\s*(chambres?|ch\b|pieces?|m2|m²|metres|salles?)/.test(after)) continue;
    const value = parseAmount(m[1].replace(/\./g, ' '), m[2]);
    if (value && value >= 1000) amounts.push({ value, index: m.index ?? 0 });
  }
  if (amounts.length) {
    const between = /entre\s/.test(t) && amounts.length >= 2;
    if (between) {
      needs.budgetMin = Math.min(amounts[0].value, amounts[1].value);
      needs.budgetMax = Math.max(amounts[0].value, amounts[1].value);
    } else {
      const { value, index } = amounts[0];
      const before = t.slice(Math.max(0, index - 18), index);
      if (/(plus de|a partir de|minimum|au moins|min)\s*$/.test(before)) needs.budgetMin = value;
      else needs.budgetMax = value;
    }
    if (!needs.transaction) {
      const ref = needs.budgetMax ?? needs.budgetMin ?? 0;
      needs.transaction = ref < 100_000 ? 'location' : 'achat';
    }
  }
  return needs;
}

// Ancienne fonction applyNeeds conservée ci-dessous :
// export function applyNeeds(profile: Profile, needs: Needs): Profile {
//   const base: Profile = needs.reset
//     ? { ...emptyProfile(), learned: profile.learned, notifyNearby: profile.notifyNearby, radiusKm: profile.radiusKm }
//     : profile;
//   const transactionChanged = needs.transaction && needs.transaction !== base.transaction;
//   return {
//     ...base,
//     transaction: needs.transaction ?? base.transaction,
//     cities: needs.cities.length ? needs.cities : base.cities,
//     districts: needs.districts.length ? needs.districts : needs.cities.length ? [] : base.districts,
//     types: needs.types.length ? needs.types : base.types,
//     // Passer de location à achat (ou l'inverse) rend l'ancien budget caduc.
//     budgetMin: needs.budgetMin ?? (needs.budgetMax || transactionChanged ? undefined : base.budgetMin),
//     budgetMax: needs.budgetMax ?? (transactionChanged ? undefined : base.budgetMax),
//     bedroomsMin: needs.bedroomsMin ?? base.bedroomsMin,
//     mustHave: Array.from(new Set([...base.mustHave, ...needs.mustHave])),
//   };
// }

export function applyNeeds(profile: Profile, needs: Needs): Profile {
  // Le reset réinitialise les critères de ce profil unique, tout en gardant les préférences apprises.
  const base: Profile = needs.reset
    ? {
        ...emptyProfile(),
        learned: profile.learned,
        notifyNearby: profile.notifyNearby,
        radiusKm: profile.radiusKm,
      }
    : profile;
  const transactionChanged = needs.transaction && needs.transaction !== base.transaction;
  const next: Profile = {
    ...base,
    transaction: needs.transaction ?? base.transaction,
    cities: needs.cities.length ? needs.cities : base.cities,
    districts: needs.districts.length ? needs.districts : needs.cities.length ? [] : base.districts,
    types: needs.types.length ? needs.types : base.types,
    // Passer de location à achat (ou l'inverse) rend l'ancien budget caduc.
    budgetMin: needs.budgetMin ?? (needs.budgetMax || transactionChanged ? undefined : base.budgetMin),
    budgetMax: needs.budgetMax ?? (transactionChanged ? undefined : base.budgetMax),
    bedroomsMin: needs.bedroomsMin ?? base.bedroomsMin,
    mustHave: Array.from(new Set([...base.mustHave, ...needs.mustHave])),
  };
  return next;
}

export function describeProfile(p: Profile) {
  const parts: string[] = [];
  if (p.transaction) parts.push(p.transaction === 'location' ? 'location' : 'achat');
  if (p.types.length) parts.push(p.types.join(' / '));
  if (p.districts.length) parts.push(p.districts.join(', '));
  else if (p.cities.length) parts.push(p.cities.join(', '));
  if (p.bedroomsMin) parts.push(`${p.bedroomsMin} ch. min.`);
  if (p.budgetMin && p.budgetMax) parts.push(`${formatCompact(p.budgetMin)} – ${formatCompact(p.budgetMax)} MAD`);
  else if (p.budgetMax) parts.push(`max ${formatCompact(p.budgetMax)} MAD`);
  else if (p.budgetMin) parts.push(`min ${formatCompact(p.budgetMin)} MAD`);
  if (p.mustHave.length) parts.push(p.mustHave.join(', '));
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Assistant conversationnel
// ---------------------------------------------------------------------------

export type AssistantInput = {
  text: string;
  history: ChatMessage[];
  profile: Profile;
  properties: Property[];
  dislikedIds: Set<string>;
  position?: Coords | null;
  /** Activé uniquement depuis « Modifier avec l’assistant » dans le profil. */
  profileEditMode?: boolean;
};

export type AssistantOutput = {
  reply: string;
  propertyIds: string[];
  profile: Profile;
};

/** Toute demande qui change le type est temporaire et ne modifie pas le profil enregistré. */
function isTypeExploration(profile: Profile, needs: Needs): boolean {
  return Boolean(
    profile.types.length > 0 &&
    needs.types.length === 1 &&
    !profile.types.includes(needs.types[0])
  );
}

/** Applique à la requête temporaire uniquement les critères explicitement cités avec le nouveau type. */
function filterByExplicitNeeds(properties: Property[], needs: Needs, position?: Coords | null): Property[] {
  return properties.filter((property) => {
    if (needs.transaction && property.transaction !== needs.transaction) return false;
    if (needs.cities.length && !needs.cities.includes(property.city)) return false;
    if (needs.districts.length && !needs.districts.includes(property.district)) return false;
    if (needs.budgetMin !== undefined && property.price < needs.budgetMin) return false;
    if (needs.budgetMax !== undefined && property.price > needs.budgetMax) return false;
    if (needs.bedroomsMin !== undefined && property.bedrooms < needs.bedroomsMin) return false;
    if (needs.mustHave.some((feature) => !property.features.includes(feature))) return false;
    if (needs.nearMe && (!position || distanceKm(position, property) > 15)) return false;
    return true;
  });
}

export async function askAssistant(input: AssistantInput): Promise<AssistantOutput> {
  if (API_URL) {
    try {
      return await askRemote(input);
    } catch {
      // Hors ligne ou serveur indisponible : le moteur local prend le relais.
    }
  }
  return askLocal(input);
}

/**
 * Contrat du serveur (POST {EXPO_PUBLIC_SELIX_API_URL}/chat, voir selix-api/src/chat.php) :
 *   requête : { message, history, profile, candidates: [{ id, score, ... }] }
 *   réponse : { reply: string, propertyIds: string[], needs?: Partial<Needs> }
 * Le moteur local pré-classe les biens : Claude choisit parmi ces candidats.
 */
async function askRemote(input: AssistantInput): Promise<AssistantOutput> {
  const needs = parseNeeds(input.text);
  const profileEditMode = Boolean(input.profileEditMode);
  // Ancienne règle remplacée : la détection locale du changement de type choisissait directement le mode exploration.
  // const typeExploration = isTypeExploration(input.profile, needs);
  const queryProfile = profileEditMode ? applyNeeds(input.profile, needs) : input.profile;
  // Le serveur classifie le message avant de choisir entre la requête complète et les suggestions classées.
  const queryCriteria = applyNeeds(emptyProfile(), needs);
  const candidates = rankProperties(queryProfile, input.properties, { position: input.position })
    .filter((s) => s.property.status === 'disponible')
    .map(({ property: p, score, distance }) => ({
      id: p.id, title: p.title, transaction: p.transaction, type: p.type, city: p.city,
      district: p.district, price: p.price, bedrooms: p.bedrooms, surface: p.surface, features: p.features,
      score: score - (input.dislikedIds.has(p.id) ? 100 : 0),
      ...(distance !== undefined ? { distanceKm: Math.round(distance * 10) / 10 } : null),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  const data = await postChat({
    message: input.text,
    history: input.history.slice(-10).map(({ role, text }) => ({ role, text })),
    profile: queryProfile,
    candidates,
    conversationMode: profileEditMode ? 'profile_edit' : 'chat',
    queryCriteria,
    position: input.position ?? undefined,
    nearMe: needs.nearMe,
  });
  const merged = profileEditMode && data.needs
    ? applyNeeds(queryProfile, { ...parseNeeds(''), ...(data.needs as Partial<Needs>) })
    : input.profile;
  return { reply: data.reply, propertyIds: data.propertyIds ?? [], profile: merged };
}
// Ancienne fonction askLocal conservée ci-dessous :
// function askLocal({ text, history, profile, properties, dislikedIds, position }: AssistantInput): AssistantOutput {
//   const needs = parseNeeds(text);
//   const next = applyNeeds(profile, needs);
//   const understood =
//     needs.transaction || needs.cities.length || needs.types.length || needs.budgetMax ||
//     needs.budgetMin || needs.bedroomsMin || needs.mustHave.length;
//
//   if (needs.reset) {
//     return {
//       reply: "C'est noté, on repart de zéro.\nVous cherchez plutôt à louer ou à acheter ?",
//       propertyIds: [],
//       profile: next,
//     };
//   }
//
//   if (needs.greeting && !understood && !needs.nearMe) {
//     return {
//       reply:
//         "Bonjour, je suis l'assistant Selix.\nDites-moi ce que vous cherchez, par exemple :\n« Appartement 3 chambres à louer à Casablanca, max 12 000 DH »",
//       propertyIds: [],
//       profile: next,
//     };
//   }
//
//   if (!understood && !needs.nearMe && !needs.more) {
//     return {
//       reply:
//         "Je n'ai pas bien saisi. Précisez-moi : location ou achat, la ville, le type de bien et votre budget.\nEx. : « Villa avec piscine à Marrakech, budget 5 millions »",
//       propertyIds: [],
//       profile: next,
//     };
//   }
//
//   const lastShown = new Set(
//     needs.more ? history.filter((m) => m.role === 'assistant').flatMap((m) => m.propertyIds ?? []) : [],
//   );
//   let ranked = rankProperties(next, properties, {
//     exclude: new Set([...dislikedIds, ...lastShown]),
//     position,
//   }).filter((s) => s.property.status === 'disponible');
//
//   if (needs.nearMe) {
//     if (!position) {
//       return {
//         reply: "Activez la localisation pour que je trouve les biens autour de vous (Profil → Localisation).",
//         propertyIds: [],
//         profile: next,
//       };
//     }
//     ranked = ranked
//       .filter((s) => (s.distance ?? Infinity) <= 15)
//       .sort((a, b) => b.score - a.score || (a.distance ?? 0) - (b.distance ?? 0));
//   }
//
//   // Ville et transaction explicites = critères éliminatoires pour l'assistant.
//   const picks = ranked
//     .filter((s) => !next.transaction || s.property.transaction === next.transaction)
//     .filter((s) => !next.cities.length || next.cities.includes(s.property.city))
//     .filter((s) => s.score >= 50)
//     .slice(0, 3);
//   const summary = describeProfile(next);
//   const lines: string[] = [];
//   if (summary) lines.push(`Compris. Je cherche : ${summary}.`);
//   if (picks.length) {
//     lines.push(
//       picks.length === 1 ? 'Voici le bien qui vous correspond le mieux :' : `Voici mes ${picks.length} meilleures propositions :`,
//     );
//   } else {
//     lines.push(
//       "Aucun bien ne correspond exactement pour l'instant. Je vous enverrai une notification dès qu'un bien arrive.",
//     );
//   }
//
//   const ask = !next.transaction
//     ? 'Vous souhaitez louer ou acheter ?'
//     : !next.cities.length
//       ? 'Dans quelle ville cherchez-vous ?'
//       : !next.budgetMax
//         ? 'Quel est votre budget maximum ?'
//         : !next.bedroomsMin && !next.types.some((x) => x === 'bureau' || x === 'terrain' || x === 'studio')
//           ? 'Combien de chambres au minimum ?'
//           : null;
//   if (ask) lines.push(ask);
//   else if (picks.length) lines.push('Swipez-les dans Matching pour affiner mes prochaines propositions.');
//
//   return { reply: lines.join('\n'), propertyIds: picks.map((s) => s.property.id), profile: next };
// }

function askLocal(input: AssistantInput): AssistantOutput {
  const { text, history, properties, dislikedIds, position } = input;
  const needs = parseNeeds(text);
  // Les critères explicites du message mettent à jour le profil enregistré.
  // Ancien comportement : chaque message de chat appliquait immédiatement ses critères au profil.
  // const next = applyNeeds(input.profile, needs);
  const next = input.profileEditMode ? applyNeeds(input.profile, needs) : input.profile;
  const understood =
    needs.transaction || needs.cities.length || needs.types.length || needs.budgetMax ||
    needs.budgetMin || needs.bedroomsMin || needs.mustHave.length;

  if (needs.reset) {
    return {
      reply: "C'est noté, on repart de zéro.\nVous cherchez plutôt à louer ou à acheter ?",
      propertyIds: [],
      profile: next,
    };
  }

  if (isTypeExploration(input.profile, needs)) {
    const requestedType = needs.types[0];
    const typeLabel: Record<PropertyType, string> = {
      appartement: 'appartements', villa: 'villas', studio: 'studios',
      riad: 'riads', bureau: 'bureaux', terrain: 'terrains',
    };
    // Les critères exprimés avec ce nouveau type sont appliqués temporairement à la sélection.
    const catalogueProfile = applyNeeds(emptyProfile(), needs);
    const picks = rankProperties(
      catalogueProfile,
      filterByExplicitNeeds(
        properties.filter((property) => property.type === requestedType),
        needs,
        position,
      ),
      { position },
    )
      .filter((s) => s.property.status === 'disponible')
      .slice(0, 3);
    const reply = picks.length
      ? `Voici ${picks.length === 1 ? 'un bien' : 'quelques biens'} ${typeLabel[requestedType]} actuellement disponibles. Quels autres critères souhaitez-vous explorer ?`
      : `Je ne vois pas de ${typeLabel[requestedType]} correspondant à cette demande temporaire pour le moment. Quels critères souhaitez-vous explorer ?`;
    return { reply, propertyIds: picks.map((s) => s.property.id), profile: input.profile };
  }

  if (needs.greeting && !understood && !needs.nearMe) {
    return {
      reply:
        "Bonjour, je suis l'assistant Selix.\nDites-moi ce que vous cherchez, par exemple :\n« Appartement 3 chambres à louer à Casablanca, max 12 000 DH »",
      propertyIds: [],
      profile: next,
    };
  }

  if (!understood && !needs.nearMe && !needs.more) {
    return {
      reply:
        "Je n'ai pas bien saisi. Précisez-moi : location ou achat, la ville, le type de bien et votre budget.\nEx. : « Villa avec piscine à Marrakech, budget 5 millions »",
      propertyIds: [],
      profile: next,
    };
  }

  const lastShown = new Set(
    needs.more ? history.filter((m) => m.role === 'assistant').flatMap((m) => m.propertyIds ?? []) : [],
  );
  let ranked = rankProperties(next, properties, {
    exclude: lastShown,
    position,
  })
    .map((s) => ({ ...s, score: s.score - (dislikedIds.has(s.property.id) ? 100 : 0) }))
    .filter((s) => s.property.status === 'disponible');

  if (needs.nearMe) {
    if (!position) {
      return {
        reply: "Activez la localisation pour que je trouve les biens autour de vous (Profil → Localisation).",
        propertyIds: [],
        profile: next,
      };
    }
    ranked = ranked
      .filter((s) => (s.distance ?? Infinity) <= 15)
      .sort((a, b) => b.score - a.score || (a.distance ?? 0) - (b.distance ?? 0));
  }

  // Ville et transaction explicites = critères éliminatoires pour l'assistant.
  const picks = ranked
    .filter((s) => !next.transaction || s.property.transaction === next.transaction)
    .filter((s) => !next.cities.length || next.cities.includes(s.property.city))
    .filter((s) => s.score >= 50)
    .slice(0, 3);
  const summary = describeProfile(next);
  const lines: string[] = [];
  if (summary) lines.push(`Compris. Je cherche : ${summary}.`);
  if (picks.length) {
    lines.push(
      picks.length === 1 ? 'Voici le bien qui vous correspond le mieux :' : `Voici mes ${picks.length} meilleures propositions :`,
    );
  } else {
    lines.push(
      "Aucun bien ne correspond exactement pour l'instant. Je vous enverrai une notification dès qu'un bien arrive.",
    );
  }

  const ask = !next.transaction
    ? 'Vous souhaitez louer ou acheter ?'
    : !next.cities.length
      ? 'Dans quelle ville cherchez-vous ?'
      : !next.budgetMax
        ? 'Quel est votre budget maximum ?'
        : !next.bedroomsMin && !next.types.some((x) => x === 'bureau' || x === 'terrain' || x === 'studio')
          ? 'Combien de chambres au minimum ?'
          : null;
  if (ask) lines.push(ask);
  else if (picks.length) lines.push('Swipez-les dans Matching pour affiner mes prochaines propositions.');

  return { reply: lines.join('\n'), propertyIds: picks.map((s) => s.property.id), profile: next };
}
