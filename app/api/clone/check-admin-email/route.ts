import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

// Availability check for the clone "new superadmin" email.
// An email registered in auth.users is a globally-unique identity already tied
// to a tenant, so it cannot become the fresh superadmin of a new clone.
// Returns { available, reason } — used for live UI feedback before the clone runs.
// The authoritative re-check happens server-side in createAdminUserForTenant({ requireNew }).
export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const email = (req.nextUrl.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const db = createAdminClient();
  const { data: { users }, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const taken = users.some(u => u.email?.toLowerCase() === email);
  return NextResponse.json({
    available: !taken,
    reason: taken ? 'Este email ya está registrado como usuario.' : null,
  });
}
