// Columnas que un CSV puede escribir: nunca `id`, `tenant_id` ni columnas internas.
export const IMPORT_FIELDS = {
  services:  ['name', 'type', 'price', 'cost_price', 'sku', 'tax_pct', 'is_active'],
  inventory: ['name', 'type', 'price', 'cost_price', 'sku', 'brand', 'expected_yield', 'is_active'],
  clients:   ['first_name', 'last_name', 'phone', 'email', 'document_type', 'document_number',
              'birthday', 'address', 'instagram_user', 'acquisition_source', 'is_active'],
} as const;

export function pickFields(record: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(field => field in record).map(field => [field, record[field]]));
}
