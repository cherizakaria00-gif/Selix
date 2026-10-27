// Dates des visites : l'heure affichée est celle de l'appareil (les visites ont lieu au Maroc).

export const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const pad = (n: number) => String(n).padStart(2, '0');

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Clé stable d'un jour (« 2026-10-31 ») pour regrouper les visites. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const formatTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** « samedi 31 octobre » */
export const formatDay = (d: Date) => `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;

export const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « samedi 31 octobre à 10:00 » */
export const formatVisit = (ms: number) => `${formatDay(new Date(ms))} à ${formatTime(ms)}`;

/** Semaines d'un mois, lundi en premier ; null = case vide. */
export function monthMatrix(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Créneaux proposés : toutes les 30 minutes, de 9:00 à 18:30 (en minutes depuis minuit). */
export const SLOT_MINUTES: number[] = Array.from({ length: 20 }, (_, i) => 9 * 60 + i * 30);

export const slotLabel = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Une visite dure environ une heure : même règle que l'API pour deux visites sur un même bien. */
export const VISIT_DURATION_MS = 3_600_000;
/** On ne peut pas réserver moins d'une heure à l'avance, ni au-delà de 90 jours. */
export const MIN_NOTICE_MS = 3_600_000;
export const MAX_DAYS_AHEAD = 90;

export function slotTimestamp(day: Date, minutes: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
}

/** Créneau indisponible : trop proche, ou chevauche une visite déjà confirmée sur ce bien. */
export function isSlotTaken(ts: number, busy: number[], now = Date.now()) {
  return ts < now + MIN_NOTICE_MS || busy.some((b) => Math.abs(b - ts) < VISIT_DURATION_MS);
}
