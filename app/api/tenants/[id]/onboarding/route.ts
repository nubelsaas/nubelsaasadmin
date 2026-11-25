import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { loadOnboarding } from '@/lib/onboarding';

type Params = { params: { id: string } };

// Checklist de arranque de un salón. Solo conteos y fechas: no se registra como lectura.
export async function GET(_req: Request, { params }: Params) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const summary = (await loadOnboarding(createAdminClient(), [params.id]))[params.id];
    if (!summary) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load onboarding' }, { status: 500 });
  }
}
