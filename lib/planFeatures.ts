// Mismas equivalencias que src/lib/tenantFeatures.ts en nubelsaas. Si cambian allá, cambiar aquí.
export const PLAN_FEATURE_BY_FLAG: Record<string, string> = {
  enableTips: 'tips',
  enableCustomerAdvancements: 'advances',
  enableGiftCards: 'giftcards',
  enableScheduler: 'appointments',
};

/** Qué flag controla cada función del plan; las que no aparecen aquí aún no tienen efecto en el app. */
export function flagForPlanFeature(feature: string): string | undefined {
  return Object.keys(PLAN_FEATURE_BY_FLAG).find(flag => PLAN_FEATURE_BY_FLAG[flag] === feature);
}

export function planDefault(flag: string, defaultFeatures: Record<string, unknown> | null | undefined) {
  const feature = PLAN_FEATURE_BY_FLAG[flag];
  if (!feature || !defaultFeatures || !(feature in defaultFeatures)) return undefined;
  return Boolean(defaultFeatures[feature]);
}
