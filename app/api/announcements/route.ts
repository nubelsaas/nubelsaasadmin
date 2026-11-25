import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { validateAnnouncement } from '@/lib/announcementRules';
import { ANNOUNCEMENT_COLUMNS, fromDb, listAnnouncements, toDb } from '@/lib/announcements';

// Anuncios a los salones. No muestran datos de un salón: listarlos no se registra como vista.
export async function GET() {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await listAnnouncements(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load announcements' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const checked = validateAnnouncement(await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  const f = checked.value;

  const id = crypto.randomUUID();
  const logged = await logAdminAction(session, 'announcement.create', {
    details: {
      announcement_id: id, title: f.title, level: f.level, starts_at: f.starts_at, ends_at: f.ends_at,
      audience: { plan_ids: f.plan_ids, countries: f.countries, tenant_ids: f.tenant_ids, owners_only: f.owners_only },
    },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { data, error } = await createAdminClient().from('admin_announcements').insert({
    id, ...toDb(f), created_by_user_id: session.user.id, created_by_email: session.user.email ?? '',
  }).select(ANNOUNCEMENT_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(fromDb(data as never), { status: 201 });
}
