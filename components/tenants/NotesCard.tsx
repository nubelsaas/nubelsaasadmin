'use client';
import { useCallback, useEffect, useState } from 'react';
import Hint, { HintIcon } from '@/components/ui/Hint';
import { Pencil, Pin, PinOff, RefreshCw, StickyNote, Trash2 } from 'lucide-react';
import { NOTE_MAX, canChangeNote, wasEdited, type TenantNote } from '@/lib/tenantNotes';

// Notas internas del equipo sobre el salón (lib/tenantNotes.ts). El salón no las ve.

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function NotesCard({ tenantId }: { tenantId: string }) {
  const [notes, setNotes] = useState<TenantNote[] | null>(null);
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/tenants/${tenantId}/notes`);
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setNotes(json.notes);
      setUserId(json.userId);
    } else {
      setError(json?.error ?? 'Could not load notes');
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  async function send(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    if (!res.ok) setError(json?.error ?? 'Could not save the note');
    return res.ok;
  }

  async function add() {
    setSaving(true);
    setError(null);
    if (await send(`/api/tenants/${tenantId}/notes`, 'POST', { body: draft })) {
      setDraft('');
      await load();
    }
    setSaving(false);
  }

  async function change(note: TenantNote, method: 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(note.id);
    setError(null);
    if (await send(`/api/tenants/${tenantId}/notes/${note.id}`, method, body)) {
      setEditing(null);
      setConfirmDelete(null);
      await load();
    }
    setBusy(null);
  }

  const tooLong = draft.trim().length > NOTE_MAX;

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <Hint id="card.notes" className="flex-1">
          <p className="flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-wider">
            <StickyNote size={13} /> Internal notes <HintIcon />
            {notes && notes.length > 0 && <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-slate-100 text-slate-500 normal-case tracking-normal">{notes.length}</span>}
          </p>
        </Hint>
        <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50" aria-label="Refresh notes">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="space-y-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} aria-label="New note"
            placeholder="Add a note for the team. The salon never sees it."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <div className="flex items-center justify-end gap-3">
            {tooLong && <span className="text-xs text-rose-600">Up to {NOTE_MAX} characters</span>}
            <button onClick={add} disabled={saving || !draft.trim() || tooLong}
              className="rounded-full bg-indigo-600 text-white font-black text-xs px-4 py-1.5 disabled:opacity-50">
              {saving ? 'Saving...' : 'Add note'}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        {!notes ? (
          !error && <p className="text-xs text-slate-400">Loading...</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-slate-400">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map(note => {
              const mine = canChangeNote(note, userId, 'body');
              const isEditing = editing?.id === note.id;
              return (
                <li key={note.id} data-note={note.id}
                  className={`rounded-xl border px-3 py-2.5 ${note.pinned ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100'}`}>
                  <div className="flex items-start gap-2">
                    <p className="flex-1 text-[11px] text-slate-400">
                      {note.pinned && <span className="font-bold text-amber-700 mr-1.5">Pinned</span>}
                      {note.author_email} · {formatDate(note.created_at)}
                      {wasEdited(note) && <span className="ml-1">(edited)</span>}
                    </p>
                    <div className="flex items-center gap-2 text-slate-400">
                      <button onClick={() => change(note, 'PATCH', { pinned: !note.pinned })} disabled={busy === note.id}
                        className="hover:text-amber-600 disabled:opacity-50" aria-label={note.pinned ? 'Unpin note' : 'Pin note'}>
                        {note.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                      </button>
                      {mine && !isEditing && (
                        <>
                          <button onClick={() => setEditing({ id: note.id, body: note.body })} className="hover:text-slate-600" aria-label="Edit note">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setConfirmDelete(note.id)} className="hover:text-rose-600" aria-label="Delete note">
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      <textarea value={editing.body} onChange={e => setEditing({ id: note.id, body: e.target.value })} rows={3} aria-label="Edit note"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditing(null)} className="text-xs rounded-full border border-slate-200 px-3 py-1 text-slate-600">Cancel</button>
                        <button onClick={() => change(note, 'PATCH', { body: editing.body })}
                          disabled={busy === note.id || !editing.body.trim() || editing.body.trim().length > NOTE_MAX}
                          className="rounded-full bg-indigo-600 text-white font-black text-xs px-3 py-1 disabled:opacity-50">Save</button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap break-words">{note.body}</p>
                  )}

                  {confirmDelete === note.id && (
                    <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                      <span className="text-slate-500">Delete this note?</span>
                      <button onClick={() => setConfirmDelete(null)} className="rounded-full border border-slate-200 px-3 py-1 text-slate-600">Cancel</button>
                      <button onClick={() => change(note, 'DELETE')} disabled={busy === note.id}
                        className="rounded-full bg-rose-600 text-white font-black px-3 py-1 disabled:opacity-50">Delete</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
