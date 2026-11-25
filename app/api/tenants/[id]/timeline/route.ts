import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminView } from '@/lib/adminAudit';
import { matchesAudience } from '@/lib/announcementRules';
import { buildTimeline, type AnnouncementRow, type SessionRow } from '@/lib/timeline';

type Params = { params: { id: string } };

const LIMIT = 300;

/** Tabla o columna que esta base todavía no tiene (p. ej. PROD antes de su SQL). */
function missing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ['PGRST205', '42P01', '42703', 'PGRST204'].includes(error.code ?? '') || /does not exist|Could not find/i.test(error.message ?? '');
}

// Línea de tiempo del salón (lib/timeline.ts). Muestra motivos y correos: se registra como lectura
// (view.timeline). Una fuente que la base no tiene se omite y se avisa en `unavailable`.
export async function GET(_req: Request, { params }: Params) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = createAdminClient();
  const { data: tenant } = await db.from('tenants').select('id, created_at, plan_id, country_iso').eq('id', params.id).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!await logAdminView(session, 'view.timeline', params.id)) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const unavailable: string[] = [];
  const [audit, notes, sessions, announcements] = await Promise.all([
    db.from('admin_audit_logs').select('id, action, admin_email, details, created_at')
      .eq('tenant_id', params.id).not('action', 'like', 'view.%').order('created_at', { ascending: false }).limit(LIMIT),
    db.from('admin_tenant_notes').select('id, body, author_email, pinned, created_at')
      .eq('tenant_id', params.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(LIMIT),
    db.from('admin_impersonation_sessions').select('session_id, admin_email, target_user_id, reason, created_at, ended_at, ended_by_email')
      .eq('tenant_id', params.id).order('created_at', { ascending: false }).limit(LIMIT),
    db.from('admin_announcements').select('id, title, level, starts_at, ends_at, ended_at, owners_only, audience_plan_ids, audience_countries, audience_tenant_ids')
      .order('starts_at', { ascending: false }).limit(LIMIT),
  ]);
  if (audit.error) return NextResponse.json({ error: audit.error.message }, { status: 500 });
  for (const [name, r] of [['notes', notes], ['support sessions', sessions], ['announcements', announcements]] as const) {
    if (r.error && !missing(r.error)) return NextResponse.json({ error: `${name}: ${r.error.message}` }, { status: 500 });
    if (r.error) unavailable.push(name);
  }

  // Correo del usuario del salón con el que se abrió cada sesión.
  const sessionRows = sessions.data ?? [];
  const targetIds = Array.from(new Set(sessionRows.map(s => s.target_user_id)));
  const { data: targets } = targetIds.length ? await db.from('users').select('id, email').in('id', targetIds) : { data: [] };
  const emailOf = new Map((targets ?? []).map(u => [u.id, u.email]));

  // Anuncios que le llegaron a este salón, con cuántas personas del salón lo vieron y cerraron.
  const reached = (announcements.data ?? []).filter(a => matchesAudience(
    { plan_ids: a.audience_plan_ids, countries: a.audience_countries, tenant_ids: a.audience_tenant_ids }, tenant));
  const announcementRows: AnnouncementRow[] = await Promise.all(reached.map(async a => {
    const base = () => db.from('admin_announcement_receipts').select('user_id', { count: 'exact', head: true })
      .eq('announcement_id', a.id).eq('tenant_id', params.id);
    const [seen, dismissed] = await Promise.all([base(), base().not('dismissed_at', 'is', null)]);
    return { ...a, seen: seen.count ?? 0, dismissed: dismissed.count ?? 0 };
  }));

  const items = buildTimeline({
    tenantCreatedAt: tenant.created_at,
    audit: audit.data ?? [],
    notes: notes.data ?? [],
    sessions: sessionRows.map((s): SessionRow => ({ ...s, target_email: emailOf.get(s.target_user_id) ?? null })),
    announcements: announcementRows,
  });
  return NextResponse.json({ items, unavailable });
}
