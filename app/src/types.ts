export type Transaction = 'location' | 'achat';
export type PropertyType = 'appartement' | 'villa' | 'studio' | 'riad' | 'bureau' | 'terrain';
export type PropertyStatus = 'disponible' | 'réservé' | 'vendu';
/** « admin » est le super admin ; commerciaux et promoteurs sont créés par lui. */
export type Role = 'user' | 'admin' | 'commercial' | 'promoteur';
export type StaffRole = 'commercial' | 'promoteur';
/** Un bien déposé par un promoteur n'est publié qu'après validation du super admin. */
export type Approval = 'validé' | 'en attente' | 'refusé';
/** Visite demandée par le client, puis confirmée (ou annulée) par Selix. */
export type VisitStatus = 'demandée' | 'confirmée' | 'annulée';

export type Property = {
  id: string;
  title: string;
  /** Ex. « HAUT STANDING » */
  standing?: string;
  /** Ex. « CFC 2 - disponible fin 2026 » */
  delivery?: string;
  transaction: Transaction;
  type: PropertyType;
  city: string;
  district: string;
  /** En MAD. Loyer mensuel pour une location, prix total pour un achat. */
  price: number;
  surface: number;
  bedrooms: number;
  bathrooms: number;
  features: string[];
  description: string;
  latitude: number;
  longitude: number;
  /** « local:<nom> » pour les photos embarquées, URI (https://, file://) sinon. */
  images: string[];
  status: PropertyStatus;
  agentPhone: string;
  createdAt: number;
  /** Promoteur propriétaire (vu seulement du propriétaire et du super admin). */
  ownerId?: string;
  /** Absent = bien Selix déjà publié. */
  approval?: Approval;
  rejectionReason?: string;
};

/** Statistiques d'un bien, sans aucune donnée client (promoteurs et super admin). */
export type PropertyStats = { propertyId: string; views: number; likes: number; superlikes: number; visits: number };

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Seulement à l'inscription : le serveur le hache et ne le renvoie jamais. */
  password?: string;
  role: Role;
  disabled?: boolean;
  createdAt: number;
};

export type SwipeAction = 'like' | 'dislike' | 'superlike';

export type Swipe = {
  userId: string;
  propertyId: string;
  action: SwipeAction;
  at: number;
};

/** Besoins explicites (dits au chat / onboarding) + préférences apprises (swipes). */
export type Profile = {
  transaction?: Transaction;
  cities: string[];
  districts: string[];
  types: PropertyType[];
  budgetMin?: number;
  budgetMax?: number;
  bedroomsMin?: number;
  mustHave: string[];
  learned: {
    cities: Record<string, number>;
    districts: Record<string, number>;
    types: Record<string, number>;
    features: Record<string, number>;
    /** Moyenne des prix aimés, par type de transaction. */
    likedPrice: Partial<Record<Transaction, { sum: number; n: number }>>;
    bedrooms: { sum: number; n: number };
  };
  notifyNearby: boolean;
  radiusKm: number;
};

export type LeadStatus = 'nouveau' | 'contacté' | 'visite planifiée' | 'clôturé';

export type Lead = {
  id: string;
  userId: string;
  propertyId: string;
  kind: 'like' | 'visite' | 'contact';
  status: LeadStatus;
  note?: string;
  createdAt: number;
  /** Commercial à qui le super admin a confié le lead (vu du personnel seulement). */
  assignedTo?: string;
  client?: { name: string; phone: string; email: string };
  /** Date et heure de la visite (millisecondes) et son état. */
  visitAt?: number;
  visitStatus?: VisitStatus;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  propertyIds?: string[];
  at: number;
};
