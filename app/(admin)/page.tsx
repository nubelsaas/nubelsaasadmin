import { createAdminClient } from '@/lib/supabaseAdmin';
import AdminHeader from '@/components/layout/AdminHeader';
import { Building2, CalendarDays, Globe } from 'lucide-react';
import Link from 'next/link';
import { countryLabel, groupByCountry } from '@/lib/countries';

type TenantRow = { id: string; name: string; country_iso: string | null; created_at: string };

async function getData() {
  const db = createAdminClient();
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [{ data: tenants }, { count: thisMonth }] = await Promise.all([
    db.from('tenants').select('id, name, country_iso, created_at').order('country_iso').order('name'),
    db.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth),
  ]);

  return { tenants: (tenants ?? []) as TenantRow[], thisMonth: thisMonth ?? 0 };
}

export default async function DashboardPage() {
  const { tenants, thisMonth } = await getData();
  const { sortedCodes, groups } = groupByCountry(tenants);

  const cards = [
    { label: 'Total tenants',  value: tenants.length,    icon: Building2,    color: 'text-indigo-600 bg-indigo-50' },
    { label: 'New this month', value: thisMonth,          icon: CalendarDays, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Countries',      value: sortedCodes.length, icon: Globe,        color: 'text-slate-500 bg-slate-100' },
  ];

  return (
    <>
      <AdminHeader title="Dashboard" />
      <div className="p-4 md:p-8 space-y-8">

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
              <div className={`rounded-xl p-3 ${color}`}><Icon size={22} /></div>
              <div>
                <p className="text-xs text-slate-500 font-medium">{label}</p>
                <p className="text-2xl font-black text-slate-900">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tenants by country */}
        <div className="space-y-5">
          {sortedCodes.map((country: string) => (
            <div key={country}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-black text-slate-700">{countryLabel(country)}</span>
                <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                  {groups[country].length}
                </span>
              </div>
              <div className="space-y-1.5">
                {groups[country].map(t => (
                  <Link key={t.id} href={`/tenants/${t.id}`}
                    className="flex items-center justify-between bg-white rounded-2xl border border-slate-200 px-4 py-2.5 hover:border-indigo-200 transition-colors">
                    <p className="text-sm font-medium text-slate-800">{t.name}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(t.created_at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>
    </>
  );
}
