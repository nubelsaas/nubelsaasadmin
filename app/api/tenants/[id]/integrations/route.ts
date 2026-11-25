import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminView } from '@/lib/adminAudit';
import { loadIntegrationHealth } from '@/lib/integrationHealth';

type Params = { params: { id: string } };

// Estado de email, WhatsApp, Google Calendar y push del salón. Muestra correos del equipo y
// errores de envío: se registra como lectura (view.integrations).
export async function GET(_req: Request, { params }: Params) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!await logAdminView(session, 'view.integrations', params.id)) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  try {
    return NextResponse.json(await loadIntegrationHealth(createAdminClient(), params.id));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not load integrations';
    return NextResponse.json({ error: message }, { status: message === 'Tenant not found' ? 404 : 500 });
  }
}
