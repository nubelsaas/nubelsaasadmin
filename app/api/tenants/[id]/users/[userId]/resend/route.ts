import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

type Params = { params: { id: string; userId: string } };

// POST { action: 'invite' | 'magic_link' }
// 'invite'     → resends the invite email
// 'magic_link' → generates a one-time login link the admin can share manually
export async function POST(req: NextRequest, { params }: Params) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action } = await req.json();
  if (action !== 'invite' && action !== 'magic_link')
    return NextResponse.json({ error: 'action must be "invite" or "magic_link"' }, { status: 400 });

  const db = createAdminClient();

  // Resolve email from users table (userId = auth.users.id)
  const { data: user } = await db
    .from('users')
    .select('email')
    .eq('id', params.userId)
    .eq('tenant_id', params.id)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (action === 'invite') {
    const { error } = await db.auth.admin.inviteUserByEmail(user.email, {
      redirectTo: process.env.MAIN_APP_URL ?? 'https://app.nubel.tech',
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // magic_link
  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: { redirectTo: process.env.MAIN_APP_URL ?? 'https://app.nubel.tech' },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data.properties?.action_link });
}
