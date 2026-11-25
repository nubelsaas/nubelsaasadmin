import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { announcementStatus, validateAnnouncement } from '@/lib/announcementRules';
import { ANNOUNCEMENT_COLUMNS, fromDb, toDb } from '@/lib/announcements';

/** Editar solo mientras está programado: lo que ya se leyó no cambia. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const checked = validateAnnouncement(await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const db = createAdminClient();
  const { data: current, error: readError } = await db.from('admin_announcements')
    .select('id, starts_at, ends_at, ended_at').eq('id', params.id).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (announcementStatus(current) !== 'scheduled') {
    return NextResponse.json({ error: 'Only scheduled announcements can be edited. End it and create a new one.' }, { status: 409 });
  }

  const f = checked.value;
  const logged = await logAdminAction(session, 'announcement.update', {
    details: {
      announcement_id: current.id, title: f.title, level: f.level, starts_at: f.starts_at, ends_at: f.ends_at,
      audience: { plan_ids: f.plan_ids, countries: f.countries, tenant_ids: f.tenant_ids, owners_only: f.owners_only },
    },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  // El filtro por starts_at evita editar uno que empezó entre la lectura y la escritura.
  const { data, error } = await db.from('admin_announcements')
    .update({ ...toDb(f), updated_at: new Date().toISOString() })
    .eq('id', current.id).is('ended_at', null).gt('starts_at', new Date().toISOString())
    .select(ANNOUNCEMENT_COLUMNS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'It already started. End it and create a new one.' }, { status: 409 });
  return NextResponse.json(fromDb(data[0] as never));
}
