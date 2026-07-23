import { createServerSupabaseClient } from '@/lib/supabaseServer';

/**
 * Verifies the caller has an active session AND is registered in admin_superadmins.
 * Returns the session on success, null otherwise.
 * Use this at the top of every API route handler.
 */
export async function assertSuperadmin() {
  const supabase = createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: admin } = await supabase
    .from('admin_superadmins').select('id').eq('user_id', session.user.id).single();
  return admin ? session : null;
}
