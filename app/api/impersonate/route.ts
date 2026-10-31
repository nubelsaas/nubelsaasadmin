import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';

export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const db = createAdminClient();

  const { data: user } = await db.from('users').select('tenant_id').eq('email', email).maybeSingle();
  const logged = await logAdminAction(session, 'impersonate', { tenantId: user?.tenant_id, details: { email } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: process.env.MAIN_APP_URL ?? 'https://app.nubel.tech',
    },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ link: data.properties?.action_link });
}
