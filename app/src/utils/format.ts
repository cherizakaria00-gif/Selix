import type { Property, Transaction } from '@/types';

const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function formatPrice(price: number, transaction: Transaction) {
  return transaction === 'location' ? `${group(price)} MAD / mois` : `${group(price)} MAD`;
}

export function formatCompact(amount: number) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0).replace('.', ',')} M`;
  if (amount >= 1_000) return `${group(amount / 1_000)} k`;
  return group(amount);
}

export function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
}

export function propertySubtitle(p: Property) {
  const parts = [p.type.charAt(0).toUpperCase() + p.type.slice(1), `${p.surface} m²`];
  if (p.bedrooms > 0) parts.push(`${p.bedrooms} ch.`);
  return parts.join(' · ');
}

export function timeAgo(ts: number) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
