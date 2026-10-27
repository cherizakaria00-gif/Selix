import { Badge } from '@/components/ui';
import { Colors } from '@/constants/theme';
import type { Approval, Property } from '@/types';

const LOOK: Record<Approval, { label: string; color: string; icon: 'checkmark-circle' | 'time' | 'close-circle' }> = {
  validé: { label: 'Publié', color: '#14935A', icon: 'checkmark-circle' },
  'en attente': { label: 'En attente de validation', color: Colors.orange, icon: 'time' },
  refusé: { label: 'Refusé', color: Colors.dislike, icon: 'close-circle' },
};

/** Un bien sans état de validation est un bien Selix déjà publié. */
export const approvalOf = (p: Property): Approval => p.approval ?? 'validé';

export function ApprovalBadge({ approval }: { approval: Approval }) {
  const { label, color, icon } = LOOK[approval];
  return <Badge label={label} icon={icon} color={color} />;
}
