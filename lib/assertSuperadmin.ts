import { createServerSupabaseClient } from '@/lib/supabaseServer';

/**
 * Verifies the caller has a valid session, passed MFA AND is registered in admin_superadmins.
 * Returns { user } on success, null otherwise.
 * Use this at the top of every API route handler.
 *
 * getUser() validates the token against Supabase. getSession() only reads the cookie, so the user
 * id it returns could be forged; see docs/features/auth.md.
 */
export async function assertSuperadmin() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: admin } = await supabase
    .from('admin_superadmins').select('id').eq('user_id', user.id).single();
  if (!admin) return null;

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return assurance?.currentLevel === 'aal2' ? { user } : null;
}
