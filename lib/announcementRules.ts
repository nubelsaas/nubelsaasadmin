// Anuncios a los salones: reglas sin dependencias (se prueban con node --test). La tabla y las
// funciones que usa el app están en nubelsaas, docs/database/announcements.sql: los límites de
// acá son los mismos CHECK de la tabla, y matchesAudience es el mismo filtro de
// get_my_announcements().

export type AnnouncementLevel = 'info' | 'warning' | 'critical';
export const LEVELS: AnnouncementLevel[] = ['info', 'warning', 'critical'];
export const TITLE_MAX = 120;
export const BODY_MAX = 1000;
export const LINK_LABEL_MAX = 40;

export type Audience = {
  plan_ids: string[] | null;     // null = todos los planes
  countries: string[] | null;    // null = todos los países
  tenant_ids: string[] | null;   // null = todos los salones
  owners_only: boolean;
};

export type AnnouncementFields = Audience & {
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  level: AnnouncementLevel;
  starts_at: string;
  ends_at: string | null;
};

export type AnnouncementStatus = 'scheduled' | 'live' | 'ended';

const list = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const clean = Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim())));
  return clean.length ? clean : null;
};

const isoOrNull = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/** Limpia lo que llega del formulario, o devuelve el error a mostrar. Sin inicio, empieza ya. */
export function validateAnnouncement(input: Record<string, unknown>, now = Date.now()): { value: AnnouncementFields } | { error: string } {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { error: 'A title is required' };
  if (title.length > TITLE_MAX) return { error: `The title can be up to ${TITLE_MAX} characters` };

  const body = typeof input.body === 'string' ? input.body.replace(/\r\n/g, '\n').trim() : '';
  if (body.length > BODY_MAX) return { error: `The message can be up to ${BODY_MAX} characters` };

  const level = LEVELS.includes(input.level as AnnouncementLevel) ? input.level as AnnouncementLevel : null;
  if (!level) return { error: 'Choose a level' };

  const linkRaw = typeof input.link_url === 'string' ? input.link_url.trim() : '';
  let link_url: string | null = null;
  if (linkRaw) {
    try {
      if (new URL(linkRaw).protocol !== 'https:' || /\s/.test(linkRaw)) throw new Error();
      link_url = linkRaw;
    } catch {
      return { error: 'The link must start with https://' };
    }
  }
  const labelRaw = typeof input.link_label === 'string' ? input.link_label.trim() : '';
  if (labelRaw && !link_url) return { error: 'A link label needs a link' };
  if (labelRaw.length > LINK_LABEL_MAX) return { error: `The link label can be up to ${LINK_LABEL_MAX} characters` };

  const startsAt = isoOrNull(input.starts_at);
  const endsAt = isoOrNull(input.ends_at);
  if (startsAt === undefined || endsAt === undefined) return { error: 'Invalid date' };
  const starts_at = startsAt ?? new Date(now).toISOString();
  if (endsAt && Date.parse(endsAt) <= Date.parse(starts_at)) return { error: 'The end must be after the start' };
  if (endsAt && Date.parse(endsAt) <= now) return { error: 'The end is in the past' };

  return {
    value: {
      title, body, level, link_url, link_label: labelRaw || null, starts_at, ends_at: endsAt,
      plan_ids: list(input.plan_ids),
      countries: list(input.countries)?.map(c => c.toUpperCase()) ?? null,
      tenant_ids: list(input.tenant_ids),
      owners_only: input.owners_only === true,
    },
  };
}

export function announcementStatus(
  a: { starts_at: string; ends_at: string | null; ended_at: string | null },
  now = Date.now(),
): AnnouncementStatus {
  if (a.ended_at || (a.ends_at && Date.parse(a.ends_at) <= now)) return 'ended';
  return Date.parse(a.starts_at) > now ? 'scheduled' : 'live';
}

export type AudienceTenant = { id: string; plan_id: string | null; country_iso: string | null };
export type AudienceUser = { tenant_id: string; is_owner: boolean };

/** Mismo filtro que get_my_announcements(): todos los filtros con valor deben cumplirse. */
export function matchesAudience(a: Omit<Audience, 'owners_only'>, t: AudienceTenant): boolean {
  return (!a.plan_ids || (t.plan_id !== null && a.plan_ids.includes(t.plan_id)))
    && (!a.countries || (t.country_iso !== null && a.countries.includes(t.country_iso)))
    && (!a.tenant_ids || a.tenant_ids.includes(t.id));
}

/** A cuántos salones y personas (activas) llega. */
export function audienceReach(a: Audience, tenants: AudienceTenant[], users: AudienceUser[]): { salons: number; people: number } {
  const salons = new Set(tenants.filter(t => matchesAudience(a, t)).map(t => t.id));
  const people = users.filter(u => salons.has(u.tenant_id) && (!a.owners_only || u.is_owner)).length;
  return { salons: salons.size, people };
}

/** Dueño: can_do_everything, aunque permissions llegue como texto JSON. */
export function isOwner(permissions: unknown): boolean {
  let p = permissions;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch { return false; }
  }
  return typeof p === 'object' && p !== null && (p as Record<string, unknown>).can_do_everything === true;
}
