// Línea de tiempo de un salón: junta lo que el portal hizo sobre él (admin_audit_logs), las notas
// internas, las sesiones de soporte y los anuncios que le llegaron. Sin dependencias: se prueba
// con node --test. La lectura está en app/api/tenants/[id]/timeline/route.ts.

export type TimelineKind = 'created' | 'action' | 'note' | 'support' | 'announcement';

export type TimelineItem = {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  actor: string | null;
};

export type AuditRow = { id: string; action: string; admin_email: string; details: Record<string, unknown> | null; created_at: string };
export type NoteRow = { id: string; body: string; author_email: string; pinned: boolean; created_at: string };
export type SessionRow = {
  session_id: string; admin_email: string; target_email: string | null; reason: string;
  created_at: string; ended_at: string | null; ended_by_email: string | null;
};
export type AnnouncementRow = {
  id: string; title: string; level: string; starts_at: string; ends_at: string | null; ended_at: string | null;
  owners_only: boolean; seen: number; dismissed: number;
};

/** 60 minutos: tope de una sesión de soporte (lib/impersonation.ts). */
export const SUPPORT_SESSION_MS = 60 * 60 * 1000;

const ACTION_TITLE: Record<string, string> = {
  'tenant.create': 'Salon created from the portal',
  'tenant.update': 'Settings changed',
  'tenant.suspend': 'Suspended',
  'tenant.reactivate': 'Reactivated',
  'tenant.export': 'Data exported',
  'tenant.export_finished': 'Data export finished',
  'tenant.admin_create': 'Owner login created',
  'user.deactivate': 'User deactivated',
  'user.reactivate': 'User reactivated',
  'user.make_owner': 'User made owner',
  'user.invite_resend': 'Invite resent',
  'user.magic_link': 'Sign-in link sent',
  'clone.onboarding': 'Onboarding clone started',
  'clone.demo': 'Demo Seed started',
  'clone.finished': 'Clone finished',
  'clone.rollback': 'Undo clone started',
  'clone.rollback_finished': 'Clone undone',
  'clone.rollback_failed': 'Undo clone failed',
  'clone.auto_rollback': 'Clone failed and was rolled back',
  'import': 'CSV import started',
  'import.finished': 'CSV import finished',
  'import.undone': 'CSV import undo started',
  'import.undo_finished': 'CSV import undone',
  'audit.export': 'Audit log exported',
};

// Ya salen de su propia fuente (notas, sesiones) o son lecturas.
const SKIP = (action: string) => action.startsWith('view.') || action.startsWith('note.') || action === 'impersonate' || action === 'impersonate.end';

function auditDetail(action: string, d: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (action === 'tenant.update' && d.changes && typeof d.changes === 'object') {
    const fields = Object.keys(d.changes as object);
    if (fields.length) parts.push(fields.map(f => f.replace(/_changes$/, '')).join(', '));
  }
  if (typeof d.email === 'string') parts.push(d.email);
  if (typeof d.entity === 'string') parts.push(d.entity);
  if (typeof d.inserted === 'number') parts.push(`${d.inserted} rows`);
  if (typeof d.records === 'number') parts.push(`${d.records} rows`);
  if (typeof d.error === 'string') parts.push(d.error);
  if (typeof d.reason === 'string') parts.push(`Reason: ${d.reason}`);
  if (typeof d.audit_reason === 'string') parts.push(`Reason: ${d.audit_reason}`);
  return parts.length ? parts.join(' · ') : null;
}

const clip = (text: string, max = 280) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function buildTimeline(input: {
  tenantCreatedAt: string;
  audit: AuditRow[];
  notes: NoteRow[];
  sessions: SessionRow[];
  announcements: AnnouncementRow[];
  now?: number;
}): TimelineItem[] {
  const now = input.now ?? Date.now();
  const items: TimelineItem[] = [
    { id: 'created', at: input.tenantCreatedAt, kind: 'created', title: 'Salon created', detail: null, actor: null },
  ];

  for (const a of input.audit) {
    if (SKIP(a.action)) continue;
    items.push({
      id: `audit:${a.id}`, at: a.created_at, kind: 'action',
      title: ACTION_TITLE[a.action] ?? a.action,
      detail: auditDetail(a.action, a.details ?? {}), actor: a.admin_email,
    });
  }

  for (const n of input.notes) {
    items.push({ id: `note:${n.id}`, at: n.created_at, kind: 'note', title: n.pinned ? 'Note (pinned)' : 'Note', detail: clip(n.body), actor: n.author_email });
  }

  for (const s of input.sessions) {
    const end = s.ended_at
      ? `ended ${s.ended_by_email ? `by ${s.ended_by_email}` : ''}`.trim()
      : Date.parse(s.created_at) + SUPPORT_SESSION_MS <= now ? 'closed at the 60-minute cap' : 'still open';
    items.push({
      id: `support:${s.session_id}`, at: s.created_at, kind: 'support',
      title: `Support session${s.target_email ? ` as ${s.target_email}` : ''}`,
      detail: `Reason: ${s.reason} · ${end}`, actor: s.admin_email,
    });
  }

  for (const a of input.announcements) {
    if (Date.parse(a.starts_at) > now) continue;   // programado: todavía no le llegó
    const reach = `seen by ${a.seen}, closed by ${a.dismissed}${a.owners_only ? ' · owners only' : ''}`;
    items.push({ id: `announcement:${a.id}`, at: a.starts_at, kind: 'announcement', title: `Announcement: ${a.title}`, detail: `${a.level} · ${reach}`, actor: null });
  }

  return items.sort((x, y) => y.at.localeCompare(x.at) || x.id.localeCompare(y.id));
}
