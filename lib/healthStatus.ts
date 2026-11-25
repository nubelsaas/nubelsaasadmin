// Reglas de salud de un salón, sin dependencias para poder probarlas con node --test.
const DAY_MS = 24 * 60 * 60 * 1000;
export const QUIET_DAYS = 14;

export type HealthStatus = 'active' | 'quiet' | 'declining' | 'new' | 'suspended';

export const STATUS_LABEL: Record<HealthStatus, string> = { active: 'Active', quiet: 'Quiet', declining: 'Declining', new: 'No sales yet', suspended: 'Suspended' };
export const STATUS_STYLE: Record<HealthStatus, string> = {
  active: 'bg-emerald-50 text-emerald-600',
  quiet: 'bg-amber-50 text-amber-700',
  declining: 'bg-amber-50 text-amber-700',
  new: 'bg-slate-100 text-slate-500',
  suspended: 'bg-rose-50 text-rose-600',
};

type HealthInput = { suspended: boolean; lastSale: string | null; revenue30: number; revenuePrev30: number };

/** Sin ventas nunca es "new": no se puede estar callado sin haber vendido. */
export function classify(h: HealthInput, now: number): HealthStatus {
  if (h.suspended) return 'suspended';
  if (!h.lastSale) return 'new';
  if (now - new Date(h.lastSale).getTime() > QUIET_DAYS * DAY_MS) return 'quiet';
  if (h.revenuePrev30 > 0 && h.revenue30 < h.revenuePrev30 * 0.5) return 'declining';
  return 'active';
}
