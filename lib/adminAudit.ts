import type { Session } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabaseAdmin';

export const AUDIT_FAILED = 'Could not write the audit log. The action was not performed.';

export type AdminView = 'view.tenant' | 'view.staff' | 'view.activity';

export type AdminAction =
  | AdminView
  | 'impersonate'
  | 'user.magic_link'
  | 'user.invite_resend'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.make_owner'
  | 'tenant.create'
  | 'tenant.update'
  | 'tenant.delete'
  | 'tenant.suspend'
  | 'tenant.reactivate'
  | 'tenant.export'
  | 'tenant.export_finished'
  | 'tenant.admin_create'
  | 'clone.onboarding'
  | 'clone.demo'
  | 'clone.finished'
  | 'clone.rollback'
  | 'clone.rollback_finished'
  | 'clone.rollback_failed'
  | 'clone.auto_rollback'
  | 'import'
  | 'import.finished'
  | 'import.undone'
  | 'import.undo_finished'
  | 'category.create'
  | 'category.update';

/**
 * Registra una acción del portal en admin_audit_logs. Se llama ANTES de ejecutarla: si devuelve
 * false, la ruta debe abortar, para que ninguna acción quede sin registro.
 * `details` nunca debe incluir contraseñas ni tokens.
 */
export async function logAdminAction(
  session: Pick<Session, 'user'>,
  action: AdminAction,
  { tenantId = null, details = {} }: { tenantId?: string | null; details?: Record<string, unknown> } = {},
): Promise<boolean> {
  const { error } = await createAdminClient().from('admin_audit_logs').insert({
    admin_user_id: session.user.id,
    admin_email:   session.user.email ?? '',
    action,
    tenant_id:     tenantId,
    details,
  });
  if (error) console.error(`[admin-audit] ${action}: ${error.message}`);
  return !error;
}

const VIEW_THROTTLE_MS = 60 * 60 * 1000;

/**
 * Registra que un admin vio datos de un salón, como mucho una vez por hora por admin, vista y
 * salón: así queda quién miró sin llenar el log con cada recarga. Si devuelve false, la ruta no
 * debe devolver los datos, igual que con las escrituras.
 */
export async function logAdminView(
  session: Pick<Session, 'user'>,
  action: AdminView,
  tenantId: string | null,
): Promise<boolean> {
  let recent = createAdminClient()
    .from('admin_audit_logs')
    .select('id')
    .eq('admin_user_id', session.user.id)
    .eq('action', action)
    .gte('created_at', new Date(Date.now() - VIEW_THROTTLE_MS).toISOString())
    .limit(1);
  recent = tenantId ? recent.eq('tenant_id', tenantId) : recent.is('tenant_id', null);

  const { data, error } = await recent;
  if (error) {
    console.error(`[admin-audit] ${action}: ${error.message}`);
    return false;
  }
  return data.length > 0 || logAdminAction(session, action, { tenantId });
}
