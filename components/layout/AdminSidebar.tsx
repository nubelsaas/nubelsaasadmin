'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, Copy, Upload, Flag, UserCog, ScrollText, LogOut, Tag } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

const NAV = [
  { href: '/',            label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/tenants',     label: 'Tenants',        icon: Building2 },
  { href: '/clone',       label: 'Clone',          icon: Copy },
  { href: '/import',      label: 'Import',         icon: Upload },
  { href: '/flags',       label: 'Feature Flags',  icon: Flag },
  { href: '/categories',  label: 'Categories',     icon: Tag },
  { href: '/impersonate', label: 'Impersonate',    icon: UserCog },
  { href: '/audit',       label: 'Audit Log',      icon: ScrollText },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-slate-200 h-screen sticky top-0">
        <div className="px-6 py-5 border-b border-slate-100">
          <span className="text-lg font-black text-indigo-600">Nubel Admin</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                isActive(href) ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={18} />{label}
            </Link>
          ))}
        </nav>
        <div className="px-3 pb-4">
          <button onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 w-full transition-colors">
            <LogOut size={18} />Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-50">
        {NAV.slice(0, 5).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              isActive(href) ? 'text-indigo-600' : 'text-slate-500'
            }`}
          >
            <Icon size={20} /><span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
