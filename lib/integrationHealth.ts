import type { SupabaseClient } from '@supabase/supabase-js';
import {
  emailStatus, googleStatus, pushStatus, sinceWindow, whatsappStatus, worstLevel,
  type EmailJob, type Integration, type Level, type PushDelivery, type WhatsAppConnection, type WhatsAppMessage,
} from '@/lib/integrationRules';

// Lee lo que el app principal registra de cada integración de un salón. DEV (develop) tiene
// tablas que PROD (main) aún no tiene, como el log de mensajes de WhatsApp: una tabla o
// columna que no existe se muestra como "no disponible", no rompe el panel.
// Nunca lee tokens: de user_google_tokens solo si hay refresh token, con un filtro.

export type IntegrationReport = { level: Level; integrations: Integration[]; generatedAt: string };

const ROW_LIMIT = 2000;

/** Tabla o columna inexistente en esta base (PostgREST o Postgres). */
function isMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return ['PGRST205', '42P01', '42703', 'PGRST204'].includes(error.code ?? '') || /does not exist|Could not find/i.test(error.message ?? '');
}

/** Filas, null si la tabla no existe, o lanza con cualquier otro error. */
async function rows<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<T[] | null> {
  const { data, error } = await query;
  if (isMissing(error)) return null;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function loadIntegrationHealth(db: SupabaseClient, tenantId: string, now = Date.now()): Promise<IntegrationReport> {
  const since = sinceWindow(now);

  const { data: tenant, error: tenantError } = await db
    .from('tenants').select('admin_email, feature_overrides').eq('id', tenantId).maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  if (!tenant) throw new Error('Tenant not found');

  const [users, jobs, connections, messages, tokens, withRefresh, devices, deliveries, synced] = await Promise.all([
    rows<{ id: string; email: string | null }>(db.from('users').select('id, email').eq('tenant_id', tenantId)),
    rows<EmailJob>(db.from('notification_jobs')
      .select('notification_type, status, attempt_count, last_error, updated_at')
      .eq('tenant_id', tenantId).gte('created_at', since).limit(ROW_LIMIT)),
    loadConnections(db, tenantId),
    rows<WhatsAppMessage>(db.from('whatsapp_outbound_messages')
      .select('status, last_error, created_at')
      .eq('tenant_id', tenantId).gte('created_at', since).order('created_at', { ascending: false }).limit(ROW_LIMIT)),
    rows<{ user_id: string; google_email: string | null; token_expiry: string | null }>(db.from('user_google_tokens')
      .select('user_id, google_email, token_expiry').eq('tenant_id', tenantId)),
    rows<{ user_id: string }>(db.from('user_google_tokens')
      .select('user_id').eq('tenant_id', tenantId).not('refresh_token', 'is', null)),
    rows<{ user_id: string; status: string; platform: string | null; last_seen_at: string | null }>(db.from('push_devices')
      .select('user_id, status, platform, last_seen_at').eq('tenant_id', tenantId)),
    rows<PushDelivery>(db.from('notification_delivery_log')
      .select('status, error_code, created_at')
      .eq('tenant_id', tenantId).gte('created_at', since).limit(ROW_LIMIT)),
    countSynced(db, tenantId, since),
  ]);

  const emailOf = new Map((users ?? []).map(u => [u.id, u.email]));
  const who = (id: string) => emailOf.get(id) ?? null;
  const refresh = new Set((withRefresh ?? []).map(t => t.user_id));
  const reminders = (tenant.feature_overrides as { clientReminders?: { email?: boolean } } | null)?.clientReminders;

  const integrations = [
    emailStatus({ remindersEnabled: reminders?.email !== false, contactEmail: tenant.admin_email, jobs }),
    whatsappStatus({ connections, messages }),
    googleStatus({
      tokens: tokens && tokens.map(t => ({ who: who(t.user_id), google_email: t.google_email, token_expiry: t.token_expiry, hasRefresh: refresh.has(t.user_id) })),
      synced,
      now,
    }),
    pushStatus({
      devices: devices && devices.map(d => ({ who: who(d.user_id), status: d.status, platform: d.platform, last_seen_at: d.last_seen_at })),
      deliveries,
      jobs,
      now,
    }),
  ];

  return { level: worstLevel(integrations.map(i => i.level)), integrations, generatedAt: new Date(now).toISOString() };
}

// PROD (main) tiene la tabla sin status, connection_type ni disconnect_reason: se reintenta con
// las columnas básicas. access_token y verify_token nunca se piden.
async function loadConnections(db: SupabaseClient, tenantId: string): Promise<WhatsAppConnection[] | null> {
  const full = await db.from('whatsapp_integrations')
    .select('display_phone, is_active, status, disconnect_reason, connection_type').eq('tenant_id', tenantId);
  if (!full.error) return (full.data ?? []) as WhatsAppConnection[];
  if (!isMissing(full.error)) throw new Error(full.error.message);
  return rows<WhatsAppConnection>(db.from('whatsapp_integrations').select('display_phone, is_active').eq('tenant_id', tenantId));
}

async function countSynced(db: SupabaseClient, tenantId: string, since: string): Promise<number | null> {
  const { count, error } = await db.from('appointments').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).not('google_event_id', 'is', null).gte('start_time', since);
  if (isMissing(error)) return null;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
