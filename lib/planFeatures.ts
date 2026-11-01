// Mismas equivalencias que src/lib/tenantFeatures.ts en nubelsaas. Si cambian allá, cambiar aquí.
export const PLAN_FEATURE_BY_FLAG: Record<string, string> = {
  enableTips: 'tips',
  enableCustomerAdvancements: 'advances',
  enableGiftCards: 'giftcards',
  enableScheduler: 'appointments',
};

export function planDefault(flag: string, defaultFeatures: Record<string, unknown> | null | undefined) {
  const feature = PLAN_FEATURE_BY_FLAG[flag];
  if (!feature || !defaultFeatures || !(feature in defaultFeatures)) return undefined;
  return Boolean(defaultFeatures[feature]);
}
