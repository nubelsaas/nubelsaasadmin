import { NextResponse } from 'next/server';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { getNubelEnv } from '@/lib/environment';
import { loadSnapshot } from '@/lib/schemaSnapshot';

// Estructura de la base a la que apunta el portal (sin filas). No es dato de un salón: no se
// registra como vista.
export async function GET() {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const snapshot = await loadSnapshot({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      env: getNubelEnv().env,
    });
    return NextResponse.json(snapshot);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the schema' }, { status: 500 });
  }
}
