import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { audienceReach } from '@/lib/announcementRules';
import { loadAudience } from '@/lib/announcements';

// A cuántos salones y personas llegaría un anuncio. Solo cuenta: no escribe ni devuelve nombres.
export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const input = await req.json().catch(() => ({}));
  const arr = (v: unknown) => (Array.isArray(v) && v.length ? v.filter((x): x is string => typeof x === 'string') : null);
  try {
    const { tenants, users } = await loadAudience(createAdminClient());
    return NextResponse.json(audienceReach({
      plan_ids: arr(input?.plan_ids), countries: arr(input?.countries), tenant_ids: arr(input?.tenant_ids),
      owners_only: input?.owners_only === true,
    }, tenants, users));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not count the audience' }, { status: 500 });
  }
}
