import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTE_MAX, canChangeNote, sortNotes, validateNoteBody, wasEdited } from '../lib/tenantNotes.ts';

test('note body is trimmed and must not be empty', () => {
  assert.deepEqual(validateNoteBody('  Called the owner \r\n'), { body: 'Called the owner' });
  assert.ok('error' in validateNoteBody('   '));
  assert.ok('error' in validateNoteBody(null));
  assert.ok('error' in validateNoteBody(42));
});

test('note body has a maximum length', () => {
  assert.ok('body' in validateNoteBody('a'.repeat(NOTE_MAX)));
  assert.ok('error' in validateNoteBody('a'.repeat(NOTE_MAX + 1)));
});

test('pinned notes first, then newest first', () => {
  const notes = [
    { id: 'old', pinned: false, created_at: '2026-11-01T00:00:00Z' },
    { id: 'pinned-old', pinned: true, created_at: '2026-10-01T00:00:00Z' },
    { id: 'new', pinned: false, created_at: '2026-11-20T00:00:00Z' },
    { id: 'pinned-new', pinned: true, created_at: '2026-11-10T00:00:00Z' },
  ];
  assert.deepEqual(sortNotes(notes).map(n => n.id), ['pinned-new', 'pinned-old', 'new', 'old']);
  assert.equal(notes[0].id, 'old', 'does not change the input');
});

test('only the author edits or deletes; anyone pins', () => {
  const note = { author_user_id: 'me' };
  assert.ok(canChangeNote(note, 'me', 'body'));
  assert.ok(canChangeNote(note, 'me', 'delete'));
  assert.ok(!canChangeNote(note, 'other', 'body'));
  assert.ok(!canChangeNote(note, 'other', 'delete'));
  assert.ok(canChangeNote(note, 'other', 'pin'));
});

test('edited only when saved more than a minute after creation', () => {
  assert.ok(!wasEdited({ created_at: '2026-11-25T10:00:00Z', updated_at: '2026-11-25T10:00:30Z' }));
  assert.ok(wasEdited({ created_at: '2026-11-25T10:00:00Z', updated_at: '2026-11-25T10:05:00Z' }));
});
