import type { SupabaseClient } from '@supabase/supabase-js';
import { announcementStatus, isOwner, type AnnouncementFields, type AnnouncementStatus, type AudienceTenant, type AudienceUser } from '@/lib/announcementRules';

// Lecturas del portal sobre admin_announcements (nubelsaas, docs/database/announcements.sql).

export type AnnouncementRow = AnnouncementFields & {
  id: string;
  ended_at: string | null;
  ended_by_email: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

export type AnnouncementListItem = AnnouncementRow & { status: AnnouncementStatus; seen: number; dismissed: number };

export const ANNOUNCEMENT_COLUMNS = 'id, title, body, link_url, link_label, level, audience_plan_ids, audience_countries, audience_tenant_ids, owners_only, starts_at, ends_at, ended_at, ended_by_email, created_by_email, created_at, updated_at';

type DbRow = Omit<AnnouncementRow, 'plan_ids' | 'countries' | 'tenant_ids'> & {
  audience_plan_ids: string[] | null;
  audience_countries: string[] | null;
  audience_tenant_ids: string[] | null;
};

/** Nombres de la tabla (audience_*) a los del formulario. */
export function fromDb(r: DbRow): AnnouncementRow {
  const { audience_plan_ids, audience_countries, audience_tenant_ids, ...rest } = r;
  return { ...rest, plan_ids: audience_plan_ids, countries: audience_countries, tenant_ids: audience_tenant_ids };
}

/** Campos del formulario a columnas de la tabla. */
export function toDb(f: AnnouncementFields) {
  const { plan_ids, countries, tenant_ids, ...rest } = f;
  return { ...rest, audience_plan_ids: plan_ids, audience_countries: countries, audience_tenant_ids: tenant_ids };
}

export async function listAnnouncements(db: SupabaseClient, now = Date.now()): Promise<AnnouncementListItem[]> {
  const { data, error } = await db.from('admin_announcements').select(ANNOUNCEMENT_COLUMNS).order('starts_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map(r => fromDb(r as DbRow));

  const counts = await Promise.all(rows.map(async r => {
    const base = () => db.from('admin_announcement_receipts').select('user_id', { count: 'exact', head: true }).eq('announcement_id', r.id);
    const [seen, dismissed] = await Promise.all([base(), base().not('dismissed_at', 'is', null)]);
    if (seen.error) throw new Error(seen.error.message);
    if (dismissed.error) throw new Error(dismissed.error.message);
    return { seen: seen.count ?? 0, dismissed: dismissed.count ?? 0 };
  }));

  return rows.map((r, i) => ({ ...r, status: announcementStatus(r, now), ...counts[i] }));
}

/** Salones y personas activas, para calcular a quién llega un anuncio. */
export async function loadAudience(db: SupabaseClient): Promise<{ tenants: AudienceTenant[]; users: AudienceUser[] }> {
  const [tenants, users] = await Promise.all([
    db.from('tenants').select('id, plan_id, country_iso'),
    db.from('users').select('tenant_id, permissions').eq('is_active', true),
  ]);
  if (tenants.error) throw new Error(tenants.error.message);
  if (users.error) throw new Error(users.error.message);
  return {
    tenants: tenants.data ?? [],
    users: (users.data ?? []).map(u => ({ tenant_id: u.tenant_id, is_owner: isOwner(u.permissions) })),
  };
}
