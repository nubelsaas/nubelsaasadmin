// Reglas de salud de un salón, sin dependencias para poder probarlas con node --test.
const DAY_MS = 24 * 60 * 60 * 1000;
export const QUIET_DAYS = 14;

export type HealthStatus = 'active' | 'quiet' | 'declining' | 'new' | 'suspended';

type HealthInput = { suspended: boolean; lastSale: string | null; revenue30: number; revenuePrev30: number };

/** Sin ventas nunca es "new": no se puede estar callado sin haber vendido. */
export function classify(h: HealthInput, now: number): HealthStatus {
  if (h.suspended) return 'suspended';
  if (!h.lastSale) return 'new';
  if (now - new Date(h.lastSale).getTime() > QUIET_DAYS * DAY_MS) return 'quiet';
  if (h.revenuePrev30 > 0 && h.revenue30 < h.revenuePrev30 * 0.5) return 'declining';
  return 'active';
}
