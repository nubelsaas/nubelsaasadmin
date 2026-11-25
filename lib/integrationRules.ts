// Estado de las integraciones de un salón (email, WhatsApp, Google Calendar, push) a partir de lo
// que el app principal registra. Sin dependencias: se prueba con node --test
// (tests/integrationRules.test.mjs). La lectura está en lib/integrationHealth.ts.

export type Level = 'ok' | 'warning' | 'error' | 'off' | 'unavailable';
export type IntegrationKey = 'email' | 'whatsapp' | 'google' | 'push';

export type IntegrationError = { at: string; message: string; who?: string | null };

export type Integration = {
  key: IntegrationKey;
  label: string;
  level: Level;
  summary: string;
  details: string[];
  errors: IntegrationError[];
};

export const WINDOW_DAYS = 30;
const MAX_ERRORS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Errores guardados como JSON (Meta, Google) o texto: una línea legible y corta. */
export function readableError(raw: string | null | undefined): string {
  if (!raw) return 'Unknown error';
  const text = raw.trim();
  try {
    const parsed = JSON.parse(text);
    const err = parsed?.error ?? parsed;
    const message = typeof err === 'string' ? err : err?.message ?? err?.error_description ?? err?.error;
    if (typeof message === 'string' && message) {
      const code = typeof err === 'object' && err?.code !== undefined ? ` (code ${err.code})` : '';
      return truncate(`${message}${code}`);
    }
  } catch {
    // no es JSON
  }
  return truncate(text);
}

function truncate(text: string, max = 160) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const newestFirst = (a: IntegrationError, b: IntegrationError) => b.at.localeCompare(a.at);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Email ────────────────────────────────────────────────────────────────

export type EmailJob = { notification_type: string; status: string; attempt_count: number; last_error: string | null; updated_at: string };

export function emailStatus(input: { remindersEnabled: boolean; contactEmail: string | null; jobs: EmailJob[] | null }): Integration {
  const base = { key: 'email' as const, label: 'Email' };
  const notLogged = 'Only reminder emails are logged. Confirmation, receipt and login emails leave no record, so their failures don\'t show here.';
  const details = [notLogged];
  if (!input.contactEmail) details.unshift('No contact email: cash alerts are not sent.');

  if (input.jobs === null) {
    return { ...base, level: 'unavailable', summary: 'Reminder log not available in this database.', details, errors: [] };
  }
  const jobs = input.jobs.filter(j => j.notification_type.includes('email'));
  const dead = jobs.filter(j => j.status === 'dead');
  const retrying = jobs.filter(j => (j.status === 'pending' || j.status === 'leased') && j.attempt_count > 0 && j.last_error);
  const sent = jobs.filter(j => j.status === 'completed').length;
  const errors = [...dead, ...retrying]
    .map(j => ({ at: j.updated_at, message: readableError(j.last_error) }))
    .sort(newestFirst)
    .slice(0, MAX_ERRORS);

  if (!input.remindersEnabled) {
    return { ...base, level: 'off', summary: 'Reminder emails are turned off for this salon.', details, errors };
  }
  const level: Level = dead.length ? 'error' : retrying.length ? 'warning' : 'ok';
  if (!sent && !dead.length && !retrying.length) {
    return { ...base, level, summary: `No reminder emails in the last ${WINDOW_DAYS} days.`, details, errors };
  }
  const parts = [`${plural(sent, 'reminder')} sent`];
  if (dead.length) parts.push(`${dead.length} failed`);
  if (retrying.length) parts.push(`${retrying.length} retrying`);
  return { ...base, level, summary: `${parts.join(', ')} in the last ${WINDOW_DAYS} days.`, details, errors };
}

// ── WhatsApp ─────────────────────────────────────────────────────────────

export type WhatsAppConnection = {
  display_phone: string | null;
  is_active: boolean;
  status?: string | null;
  disconnect_reason?: string | null;
  connection_type?: string | null;
};
export type WhatsAppMessage = { status: string; last_error: string | null; created_at: string };

export function whatsappStatus(input: { connections: WhatsAppConnection[] | null; messages: WhatsAppMessage[] | null }): Integration {
  const base = { key: 'whatsapp' as const, label: 'WhatsApp' };
  if (input.connections === null) {
    return { ...base, level: 'unavailable', summary: 'WhatsApp is not available in this database.', details: [], errors: [] };
  }
  if (input.connections.length === 0) {
    return { ...base, level: 'off', summary: 'Not connected.', details: [], errors: [] };
  }

  const isLive = (c: WhatsAppConnection) => c.is_active && (!c.status || c.status === 'active');
  const live = input.connections.filter(isLive);
  const details = input.connections.map(c => {
    const name = c.display_phone ?? 'Unknown number';
    const kind = c.connection_type ? ` (${c.connection_type})` : '';
    return isLive(c)
      ? `${name}${kind}: connected`
      : `${name}${kind}: disconnected${c.disconnect_reason ? ` — ${c.disconnect_reason}` : c.status ? ` (${c.status})` : ''}`;
  });

  const messages = input.messages ?? [];
  if (input.messages === null) details.push('The message log is not available in this database, so send failures don\'t show here.');
  const failed = messages.filter(m => m.status === 'failed');
  const sent = messages.length - failed.length;
  const latest = [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const errors = failed
    .map(m => ({ at: m.created_at, message: readableError(m.last_error) }))
    .sort(newestFirst)
    .slice(0, MAX_ERRORS);

  if (live.length === 0) {
    return { ...base, level: 'error', summary: 'Disconnected: messages to customers are not being sent.', details, errors };
  }
  if (latest?.status === 'failed') {
    return { ...base, level: 'error', summary: `The last message failed: ${readableError(latest.last_error)}`, details, errors };
  }
  const level: Level = failed.length ? 'warning' : 'ok';
  const counts = input.messages === null ? '' : ` ${plural(sent, 'message')} sent, ${failed.length} failed in the last ${WINDOW_DAYS} days.`;
  return { ...base, level, summary: `${plural(live.length, 'number')} connected.${counts}`, details, errors };
}

// ── Google Calendar ──────────────────────────────────────────────────────

export type GoogleToken = { who: string | null; google_email: string | null; token_expiry: string | null; hasRefresh: boolean };

export function googleStatus(input: { tokens: GoogleToken[] | null; synced: number | null; now: number }): Integration {
  const base = { key: 'google' as const, label: 'Google Calendar' };
  if (input.tokens === null) {
    return { ...base, level: 'unavailable', summary: 'Google Calendar is not available in this database.', details: [], errors: [] };
  }
  if (input.tokens.length === 0) {
    return { ...base, level: 'off', summary: 'No staff connected.', details: [], errors: [] };
  }

  // Sin refresh token, Google deja de aceptar el acceso cuando vence el access token (1 hora).
  const expired = (t: GoogleToken) => t.token_expiry !== null && new Date(t.token_expiry).getTime() < input.now;
  const broken = input.tokens.filter(t => !t.hasRefresh && expired(t));
  const fragile = input.tokens.filter(t => !t.hasRefresh && !expired(t));
  const details = input.tokens.map(t => {
    const name = t.who ?? 'Deleted user';
    const account = t.google_email ? ` → ${t.google_email}` : '';
    const state = broken.includes(t) ? ': needs to reconnect' : fragile.includes(t) ? ': will stop syncing when its access expires' : '';
    return `${name}${account}${state}`;
  });
  const errors = broken.map(t => ({ at: t.token_expiry!, message: 'Access expired and there is no refresh token: reconnect Google Calendar.', who: t.who }));

  const level: Level = broken.length ? 'error' : fragile.length ? 'warning' : 'ok';
  const synced = input.synced === null ? '' : ` ${plural(input.synced, 'appointment')} synced in the last ${WINDOW_DAYS} days.`;
  const summary = broken.length
    ? `${plural(broken.length, 'staff member')} must reconnect.${synced}`
    : `${plural(input.tokens.length, 'staff member')} connected.${synced}`;
  return { ...base, level, summary, details, errors };
}

// ── Push ─────────────────────────────────────────────────────────────────

export type PushDevice = { who: string | null; status: string; platform: string | null; last_seen_at: string | null };
export type PushDelivery = { status: string; error_code: string | null; created_at: string };
export type ReminderJob = EmailJob;

export function pushStatus(input: { devices: PushDevice[] | null; deliveries: PushDelivery[] | null; jobs: ReminderJob[] | null; now: number }): Integration {
  const base = { key: 'push' as const, label: 'Push notifications' };
  if (input.devices === null) {
    return { ...base, level: 'unavailable', summary: 'Push notifications are not available in this database.', details: [], errors: [] };
  }
  if (input.devices.length === 0) {
    return { ...base, level: 'off', summary: 'No devices subscribed.', details: [], errors: [] };
  }

  const active = input.devices.filter(d => d.status === 'active');
  const expired = input.devices.length - active.length;
  const deliveries = input.deliveries ?? [];
  const failed = deliveries.filter(d => d.status === 'FAILED' || d.status === 'REJECTED');
  const sent = deliveries.filter(d => d.status === 'SENT').length;
  // Los recordatorios al equipo que se dieron por perdidos (los de email van en Email).
  const dead = (input.jobs ?? []).filter(j => !j.notification_type.includes('email') && j.status === 'dead');

  const lastSeen = active.map(d => d.last_seen_at).filter(Boolean).sort().at(-1) ?? null;
  const details = [
    `${plural(active.length, 'active device')}${expired ? `, ${expired} expired` : ''}.`,
    ...(lastSeen ? [`Last device activity: ${new Date(lastSeen).toISOString().slice(0, 10)}.`] : []),
    ...Array.from(new Set(active.map(d => d.who ?? 'Deleted user'))).map(who => `Receives notifications: ${who}`),
  ];
  const errors = [
    ...failed.map(d => ({ at: d.created_at, message: `Delivery ${d.status.toLowerCase()}${d.error_code ? `: ${d.error_code}` : ''}` })),
    ...dead.map(j => ({ at: j.updated_at, message: `Reminder gave up: ${readableError(j.last_error)}` })),
  ].sort(newestFirst).slice(0, MAX_ERRORS);

  if (active.length === 0) {
    return { ...base, level: 'warning', summary: 'Every device subscription has expired: nobody receives notifications.', details, errors };
  }
  const level: Level = dead.length ? 'error' : failed.length ? 'warning' : 'ok';
  const counts = input.deliveries === null ? ''
    : !sent && !failed.length ? ` No notifications in the last ${WINDOW_DAYS} days.`
    : ` ${plural(sent, 'notification')} delivered, ${failed.length} failed in the last ${WINDOW_DAYS} days.`;
  return { ...base, level, summary: `${plural(active.length, 'device')} active.${counts}`, details, errors };
}

/** El peor estado, para resumir el panel: error > warning > ok > off > unavailable. */
export function worstLevel(levels: Level[]): Level {
  const order: Level[] = ['error', 'warning', 'ok', 'off', 'unavailable'];
  return order.find(level => levels.includes(level)) ?? 'unavailable';
}

export const sinceWindow = (now: number) => new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
