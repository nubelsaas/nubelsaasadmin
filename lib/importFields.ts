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

export const IMPORT_TABLES = {
  categories: { table: 'product_categories', columns: ['id', 'name', 'type'] },
  services:   { table: 'products_services', columns: ['id', 'name', 'type', 'sku'] },
  inventory:  { table: 'products_services', columns: ['id', 'name', 'type', 'sku'] },
  clients:    { table: 'customers', columns: ['id', 'document_number', 'email', 'phone'], activeOnly: true },
} as const;

export type ImportEntity = keyof typeof IMPORT_TABLES;

const text = (value: unknown) => String(value ?? '').trim().toLowerCase();

// Un cliente solo con nombre no tiene clave: dos "Ana Gómez" pueden ser personas distintas.
function identityKeys(entity: ImportEntity, row: Record<string, unknown>) {
  if (entity === 'categories') return [`name:${text(row.name)}|${text(row.type) || 'service'}`];
  if (entity === 'clients') {
    const phone = text(row.phone).replace(/\D/g, '');
    return [
      text(row.document_number) && `document:${text(row.document_number)}`,
      text(row.email) && `email:${text(row.email)}`,
      phone.length >= 7 && `phone:${phone}`,
    ].filter(Boolean) as string[];
  }
  return [text(row.sku) && `sku:${text(row.sku)}`, `name:${text(row.name)}|${text(row.type)}`].filter(Boolean) as string[];
}

/** Separa lo nuevo de lo que ya existe en el tenant o se repite en el archivo. */
export function splitDuplicates<T extends Record<string, unknown>>(
  entity: ImportEntity,
  records: T[],
  existing: Record<string, unknown>[],
) {
  const seen = new Set(existing.flatMap(row => identityKeys(entity, row)));
  const fresh = records.filter(record => {
    const keys = identityKeys(entity, record);
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  });
  return { fresh, duplicates: records.length - fresh.length };
}
