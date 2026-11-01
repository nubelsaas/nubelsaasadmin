export type JsonChanges = { set: Record<string, unknown>; remove: string[] };
type JsonObject = Record<string, unknown>;

// Se envía solo lo que cambió: guardar el objeto completo borraría lo que otro escribió mientras
// la pantalla estaba abierta, como la agenda pública o un ajuste del salón.
export function diffJson(original: JsonObject | null | undefined, current: JsonObject): JsonChanges {
  const before = original ?? {};
  return {
    set: Object.fromEntries(
      Object.entries(current).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key]))
    ),
    remove: Object.keys(before).filter(key => !(key in current)),
  };
}

export function applyJsonChanges(current: JsonObject | null | undefined, { set, remove }: JsonChanges) {
  const result: JsonObject = { ...current, ...set };
  for (const key of remove) delete result[key];
  return result;
}

export function isJsonChanges(value: unknown): value is JsonChanges {
  const changes = value as JsonChanges | null;
  return typeof changes?.set === 'object' && changes.set !== null && !Array.isArray(changes.set)
    && Array.isArray(changes.remove) && changes.remove.every(key => typeof key === 'string');
}
