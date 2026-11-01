import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import AdminSidebar from '@/components/layout/AdminSidebar';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: admin } = await supabase
    .from('admin_superadmins')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!admin) redirect('/login');

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') redirect('/mfa');

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar />
      <main className="flex-1 flex flex-col pb-16 md:pb-0 min-w-0">
        {children}
      </main>
    </div>
  );
}
