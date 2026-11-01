import type { SupabaseClient } from '@supabase/supabase-js';

const REGION_FIELDS = ['country_iso', 'currency_code', 'timezone', 'phone_prefix'] as const;
const FINANCIAL_TABLES = ['transactions', 'expenses_purchases', 'account_balance_entries'] as const;

export function changedRegionFields(current: Record<string, unknown>, update: Record<string, unknown>) {
  return REGION_FIELDS.filter(field => field in update && update[field] !== current[field]);
}

/**
 * Con movimientos, cambiar la moneda corrompe los importes guardados y la zona horaria mueve el corte
 * de día de toda la contabilidad. Lanza error si no se puede verificar: quien llama debe bloquear.
 */
export async function hasFinancialHistory(db: SupabaseClient, tenantId: string) {
  const checks = await Promise.all(
    FINANCIAL_TABLES.map(table => db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId))
  );
  if (checks.some(check => check.error)) throw new Error(`Could not check the financial history of tenant ${tenantId}`);
  return checks.some(check => (check.count ?? 0) > 0);
}
