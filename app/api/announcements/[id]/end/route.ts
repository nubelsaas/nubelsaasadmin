import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { announcementStatus } from '@/lib/announcementRules';

/** Termina un anuncio vivo, o cancela uno programado. Deja de mostrarse al próximo refresco del app. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = createAdminClient();
  const { data: current, error: readError } = await db.from('admin_announcements')
    .select('id, title, starts_at, ends_at, ended_at').eq('id', params.id).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const status = announcementStatus(current);
  if (status === 'ended') return NextResponse.json({ error: 'It already ended' }, { status: 409 });

  const logged = await logAdminAction(session, 'announcement.end', {
    details: { announcement_id: current.id, title: current.title, was: status },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { error } = await db.from('admin_announcements')
    .update({ ended_at: new Date().toISOString(), ended_by_email: session.user.email ?? '' })
    .eq('id', current.id).is('ended_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
