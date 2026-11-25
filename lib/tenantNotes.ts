// Notas internas por salón: reglas sin dependencias (se prueban con node --test). Las rutas están
// en app/api/tenants/[id]/notes.

export const NOTE_MAX = 5000;

export type TenantNote = {
  id: string;
  tenant_id: string;
  author_user_id: string;
  author_email: string;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export const NOTE_COLUMNS = 'id, tenant_id, author_user_id, author_email, body, pinned, created_at, updated_at';

/** Texto limpio de la nota, o el error a mostrar. */
export function validateNoteBody(body: unknown): { body: string } | { error: string } {
  if (typeof body !== 'string') return { error: 'The note is empty' };
  const clean = body.replace(/\r\n/g, '\n').trim();
  if (!clean) return { error: 'The note is empty' };
  if (clean.length > NOTE_MAX) return { error: `Notes can be up to ${NOTE_MAX} characters` };
  return { body: clean };
}

/** Fijadas primero; dentro de cada grupo, la más nueva arriba. */
export function sortNotes<T extends Pick<TenantNote, 'pinned' | 'created_at'>>(notes: T[]): T[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
}

/** Solo quien la escribió la edita o la borra; fijarla la puede cualquier admin. */
export function canChangeNote(note: Pick<TenantNote, 'author_user_id'>, userId: string, change: 'body' | 'pin' | 'delete'): boolean {
  return change === 'pin' || note.author_user_id === userId;
}

/** Se editó si se guardó más de un minuto después de crearla (fijarla no cuenta: no toca updated_at). */
export function wasEdited(note: Pick<TenantNote, 'created_at' | 'updated_at'>): boolean {
  return Date.parse(note.updated_at) - Date.parse(note.created_at) > 60_000;
}
