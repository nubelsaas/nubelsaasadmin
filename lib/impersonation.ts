import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Sesión de soporte ("Impersonate"). El portal abre la sesión en el servidor para conocer su
// session_id y registrarlo en admin_impersonation_sessions antes de entregar el acceso: así el
// app principal marca en audit_log (impersonated_by) todo lo que se haga en esa sesión.
// Tabla y trigger: docs/database/audit_impersonation.sql del repo nubelsaas.

export type SupportSession = {
  link: string;
  sessionId: string;
  targetUserId: string;
  expiresAt: number;
};

export function jwtSessionId(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

// El app principal usa supabase-js con el flujo implícito: al cargar con estos datos en el
// fragmento (#) guarda la sesión, igual que al volver de un magic link. El fragmento no se
// envía a ningún servidor.
export function buildSessionLink(appUrl: string, s: { access_token: string; refresh_token: string; expires_in: number; expires_at?: number }) {
  const hash = new URLSearchParams({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: String(s.expires_in),
    expires_at: String(s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in),
    token_type: 'bearer',
    type: 'magiclink',
  });
  return `${appUrl.replace(/#.*$/, '')}#${hash.toString()}`;
}

export async function openSupportSession(
  db: SupabaseClient,
  opts: { email: string; tenantId: string | null; reason: string; admin: { id: string; email: string }; appUrl: string },
): Promise<SupportSession | { error: string }> {
  const { data: linkData, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: opts.email });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) return { error: linkError?.message ?? 'Could not create the sign-in link' };

  // Cliente aparte, sin guardar nada: la sesión es del usuario del salón, no del portal.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  const session = verified?.session;
  const sessionId = session ? jwtSessionId(session.access_token) : null;
  if (verifyError || !session || !sessionId) return { error: verifyError?.message ?? 'Could not open the session' };

  const { error: recordError } = await db.from('admin_impersonation_sessions').insert({
    session_id: sessionId,
    admin_user_id: opts.admin.id,
    admin_email: opts.admin.email,
    target_user_id: session.user.id,
    tenant_id: opts.tenantId,
    reason: opts.reason,
  });
  if (recordError) {
    // Sin registro no se entrega: se cierra la sesión que se acaba de abrir.
    await db.auth.admin.signOut(session.access_token, 'local').catch(() => {});
    return { error: `Could not record the support session: ${recordError.message}` };
  }

  return {
    link: buildSessionLink(opts.appUrl, session),
    sessionId,
    targetUserId: session.user.id,
    expiresAt: session.expires_at ?? 0,
  };
}
