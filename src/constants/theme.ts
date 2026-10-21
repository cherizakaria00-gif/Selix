// Charte graphique Selix — fond violet nuit, dégradé violet → magenta, accents or.
export const Colors = {
  bg: '#12062A',
  bgDeep: '#0B031C',
  bgElevated: '#1D0B40',
  card: 'rgba(255,255,255,0.06)',
  cardStrong: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.12)',
  primary: '#7B2FF7',
  violet: '#6A28EA',
  magenta: '#C010A0',
  pink: '#D04CE0',
  gold: '#F5A524',
  orange: '#F7931E',
  like: '#2BD47D',
  dislike: '#FF4D5E',
  star: '#3B82F6',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.68)',
  textFaint: 'rgba(255,255,255,0.42)',
} as const;

export const Gradients = {
  background: ['#1E0A45', '#12062A', '#0B031C'] as const,
  primary: ['#5B21B6', '#9D1FB8'] as const,
  brand: ['#6A28EA', '#C010A0'] as const,
  premium: ['#F7931E', '#F5A524'] as const,
  cardShade: ['transparent', 'rgba(18,6,42,0.55)', 'rgba(18,6,42,0.95)'] as const,
};

export const Radius = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
