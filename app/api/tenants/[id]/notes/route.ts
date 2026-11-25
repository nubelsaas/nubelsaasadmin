import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { NOTE_COLUMNS, sortNotes, validateNoteBody } from '@/lib/tenantNotes';

type Params = { params: { id: string } };

// Notas internas del salón. Las escribe el equipo, no son datos del salón: leerlas no se
// registra como vista.
export async function GET(_req: Request, { params }: Params) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await createAdminClient()
    .from('admin_tenant_notes').select(NOTE_COLUMNS)
    .eq('tenant_id', params.id).is('deleted_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: sortNotes(data ?? []), userId: session.user.id });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const input = await req.json().catch(() => ({}));
  const checked = validateNoteBody(input?.body);
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const db = createAdminClient();
  const { data: tenant } = await db.from('tenants').select('id').eq('id', params.id).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // El id se elige antes, para que el registro diga qué nota se creó.
  const id = crypto.randomUUID();
  const logged = await logAdminAction(session, 'note.create', { tenantId: params.id, details: { note_id: id } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { data, error } = await db.from('admin_tenant_notes').insert({
    id,
    tenant_id: params.id,
    author_user_id: session.user.id,
    author_email: session.user.email ?? '',
    body: checked.body,
  }).select(NOTE_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
