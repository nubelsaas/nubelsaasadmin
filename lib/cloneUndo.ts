import type { SupabaseClient } from '@supabase/supabase-js';

// Rollback borra todo el contenido de un tenant. Si se puede o no se decide aquí, con los registros
// clone.* de admin_audit_logs: así sobrevive a cerrar la pestaña y no se puede repetir.
// Ver docs/features/clone.md §"Modo Rollback".
const UNDO_WINDOW_MS = 60 * 60 * 1000;
const RUN_LOCK_MS    = 15 * 60 * 1000;

// Lo que deja un salón operando. Las filas del clone quedan fuera por fecha: se crean antes de que
// termine. Toda venta tiene cabecera en `transactions`. `users` no está: el admin se crea al acabar el clone.
const ACTIVITY_CHECKS = [
  ['customers', 'created_at'],
  ['transactions', 'created_at'],
  ['appointments', 'created_at'],
  ['expenses_purchases', 'created_at'],
  ['inventory_movements', 'created_at'],
] as const;

export type CloneRun =
  | { state: 'none' }
  | { state: 'running' }
  | { state: 'finished' | 'interrupted'; since: number };

/** Estado del último clone o rollback del tenant. Lanza error si no se puede leer. */
export async function getCloneRun(db: SupabaseClient, tenantId: string, now = Date.now()): Promise<CloneRun> {
  const { data, error } = await db
    .from('admin_audit_logs')
    .select('action, created_at')
    .eq('tenant_id', tenantId)
    .like('action', 'clone.%')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read the clone history of tenant ${tenantId}`);

  const last = data?.[0];
  if (!last || last.action === 'clone.rollback_finished') return { state: 'none' };

  const at = new Date(last.created_at).getTime();
  if (last.action === 'clone.finished') return { state: 'finished', since: at };
  if (last.action === 'clone.rollback_failed') return { state: 'interrupted', since: at };

  // Empezó y nunca terminó: sigue corriendo, o el servidor murió a la mitad.
  if (now - at < RUN_LOCK_MS) return { state: 'running' };
  return { state: 'interrupted', since: at + RUN_LOCK_MS };
}

/** Tablas con filas nuevas después de `since`. Lanza error si no se puede verificar. */
async function findActivitySince(db: SupabaseClient, tenantId: string, since: number): Promise<string[]> {
  const iso = new Date(since).toISOString();
  const checks = await Promise.all(
    ACTIVITY_CHECKS.map(([table, column]) =>
      db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gt(column, iso)
    )
  );

  const failed = ACTIVITY_CHECKS.find((_, i) => checks[i].error);
  if (failed) throw new Error(`Could not verify ${failed[0]} on tenant ${tenantId}`);

  return ACTIVITY_CHECKS.filter((_, i) => (checks[i].count ?? 0) > 0).map(([table]) => table);
}

/** `reason` es null cuando no hay ningún clone que deshacer. */
export async function getUndoStatus(
  db: SupabaseClient,
  tenantId: string,
  now = Date.now(),
): Promise<{ available: boolean; reason: string | null }> {
  const run = await getCloneRun(db, tenantId, now);

  if (run.state === 'none') return { available: false, reason: null };
  if (run.state === 'running') {
    return { available: false, reason: 'A clone or Undo is still running on this tenant. Check again in a few minutes.' };
  }
  if (run.state === 'finished' && now - run.since > UNDO_WINDOW_MS) {
    return { available: false, reason: 'Undo is only available for 1 hour after a clone.' };
  }

  const activity = await findActivitySince(db, tenantId, run.since);
  if (activity.length > 0) {
    return { available: false, reason: `Undo is blocked: this tenant has new activity since the clone (${activity.join(', ')}).` };
  }
  return { available: true, reason: null };
}
