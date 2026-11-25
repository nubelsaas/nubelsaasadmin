import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { NOTE_COLUMNS, canChangeNote, validateNoteBody } from '@/lib/tenantNotes';

type Params = { params: { id: string; noteId: string } };

async function findNote(noteId: string, tenantId: string) {
  const { data, error } = await createAdminClient()
    .from('admin_tenant_notes').select('id, author_user_id')
    .eq('id', noteId).eq('tenant_id', tenantId).is('deleted_at', null).maybeSingle();
  return { note: data, error };
}

/** Edita el texto ({ body }) o fija/suelta la nota ({ pinned }), una cosa por vez. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const input = await req.json().catch(() => ({}));
  const editing = input && 'body' in input;
  if (!editing && typeof input?.pinned !== 'boolean') return NextResponse.json({ error: 'body or pinned is required' }, { status: 400 });

  const checked = editing ? validateNoteBody(input.body) : null;
  if (checked && 'error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const { note, error: findError } = await findNote(params.noteId, params.id);
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canChangeNote(note, session.user.id, editing ? 'body' : 'pin')) {
    return NextResponse.json({ error: 'Only the author can edit this note' }, { status: 403 });
  }

  const action = editing ? 'note.update' : input.pinned ? 'note.pin' : 'note.unpin';
  const logged = await logAdminAction(session, action, { tenantId: params.id, details: { note_id: note.id } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  // Fijar no cuenta como edición: no toca updated_at.
  const update = checked && 'body' in checked
    ? { body: checked.body, updated_at: new Date().toISOString() }
    : { pinned: input.pinned };
  const { data, error } = await createAdminClient()
    .from('admin_tenant_notes').update(update).eq('id', note.id).select(NOTE_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** Oculta la nota (deleted_at): el texto queda en la tabla. */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { note, error: findError } = await findNote(params.noteId, params.id);
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canChangeNote(note, session.user.id, 'delete')) {
    return NextResponse.json({ error: 'Only the author can delete this note' }, { status: 403 });
  }

  const logged = await logAdminAction(session, 'note.delete', { tenantId: params.id, details: { note_id: note.id } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { error } = await createAdminClient().from('admin_tenant_notes')
    .update({ deleted_at: new Date().toISOString(), deleted_by_email: session.user.email ?? '' })
    .eq('id', note.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
