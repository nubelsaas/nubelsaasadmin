import { createAdminClient } from '@/lib/supabaseAdmin';
import AdminHeader from '@/components/layout/AdminHeader';
import { AlertTriangle, Building2, CalendarDays, Globe, Info, Wallet } from 'lucide-react';
import Link from 'next/link';
import { countryLabel, groupByCountry } from '@/lib/countries';
import { loadAlerts, loadTenantHealth, type HealthStatus, type PortalAlert, type TenantHealth } from '@/lib/tenantHealth';

type TenantRow = { id: string; name: string; country_iso: string | null; created_at: string };

async function getData() {
  const db = createAdminClient();
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [{ data: tenants }, { count: thisMonth }] = await Promise.all([
    db.from('tenants').select('id, name, country_iso, created_at').order('country_iso').order('name'),
    db.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth),
  ]);

  // Si falla, el resto del dashboard se muestra igual y avisa: mejor eso que una pantalla vacía.
  let health: TenantHealth[] = [];
  let alerts: PortalAlert[] = [];
  let healthError: string | null = null;
  try {
    health = await loadTenantHealth(db);
    alerts = await loadAlerts(db, health);
  } catch (e: unknown) {
    healthError = e instanceof Error ? e.message : String(e);
  }

  return { tenants: (tenants ?? []) as TenantRow[], thisMonth: thisMonth ?? 0, health, alerts, healthError };
}

export default async function DashboardPage() {
  const { tenants, thisMonth, health, alerts, healthError } = await getData();
  const monthlyValue = health.filter(h => !h.suspended).reduce((total, h) => total + h.planPrice, 0);
  const { sortedCodes, groups } = groupByCountry(tenants);

  const cards = [
    { label: 'Total tenants',  value: tenants.length,    icon: Building2,    color: 'text-indigo-600 bg-indigo-50' },
    { label: 'New this month', value: thisMonth,          icon: CalendarDays, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Countries',      value: sortedCodes.length, icon: Globe,        color: 'text-slate-500 bg-slate-100' },
    { label: 'Est. monthly value', value: `$${monthlyValue.toLocaleString('en')}`, icon: Wallet, color: 'text-amber-600 bg-amber-50' },
  ];

  return (
    <>
      <AdminHeader title="Dashboard" />
      <div className="p-4 md:p-8 space-y-8">

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

        {healthError && (
          <p className="text-sm text-rose-600 bg-rose-50 rounded-2xl px-4 py-3">Could not load salon health: {healthError}</p>
        )}

        {/* Needs attention */}
        {!healthError && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <p className="text-sm font-black text-slate-700">Needs attention</p>
            {alerts.length === 0 ? (
              <p className="text-xs text-slate-400">Nothing right now.</p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((alert, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {alert.severity === 'high'
                      ? <AlertTriangle size={15} className="text-rose-500 mt-0.5 flex-shrink-0" />
                      : <Info size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />}
                    <span className="text-slate-700">
                      {alert.tenantId && (
                        <Link href={`/tenants/${alert.tenantId}`} className="font-semibold text-indigo-600 hover:underline mr-1">{alert.tenantName}</Link>
                      )}
                      {alert.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Salon health */}
        {!healthError && health.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4">
              <p className="text-sm font-black text-slate-700">Salon health</p>
              <p className="text-xs text-slate-400 mt-0.5">Last 30 days. Revenue in each salon&apos;s own currency, without voided sales. Bars show the last 6 months.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] text-slate-400 uppercase tracking-wider">
                  <tr>
                    {['Salon', 'Status', 'Last sale', 'Sales', 'Revenue', 'Trend', 'Appointments', 'Staff', 'Plan'].map(h => (
                      <th key={h} className="text-left font-black px-4 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {health.map(h => (
                    <tr key={h.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap"><Link href={`/tenants/${h.id}`} className="font-semibold text-slate-800 hover:text-indigo-600">{h.name}</Link></td>
                      <td className="px-4 py-2.5"><span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${STATUS_STYLE[h.status]}`}>{STATUS_LABEL[h.status]}</span></td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{h.lastSale ? new Date(h.lastSale).toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-700">{h.sales30}</td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {formatMoney(h.revenue30)} <span className="text-[10px] text-slate-400">{h.currency}</span>
                        {h.revenuePrev30 > 0 && <span className="block text-[10px] text-slate-400">prev {formatMoney(h.revenuePrev30)}</span>}
                      </td>
                      <td className="px-4 py-2.5"><Trend monthly={h.monthly} currency={h.currency} /></td>
                      <td className="px-4 py-2.5 text-slate-700">{h.appointments30}</td>
                      <td className="px-4 py-2.5 text-slate-700">{h.activeStaff}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{h.planName ?? '—'}{h.planPrice > 0 && ` · $${h.planPrice}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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

const STATUS_LABEL: Record<HealthStatus, string> = { active: 'Active', quiet: 'Quiet', declining: 'Declining', new: 'No sales yet', suspended: 'Suspended' };
const STATUS_STYLE: Record<HealthStatus, string> = {
  active: 'bg-emerald-50 text-emerald-600',
  quiet: 'bg-amber-50 text-amber-700',
  declining: 'bg-amber-50 text-amber-700',
  new: 'bg-slate-100 text-slate-500',
  suspended: 'bg-rose-50 text-rose-600',
};

function formatMoney(value: number) {
  return Math.round(value).toLocaleString('en');
}

function Trend({ monthly, currency }: { monthly: TenantHealth['monthly']; currency: string | null }) {
  const max = Math.max(...monthly.map(m => m.revenue), 1);
  const label = monthly.map(m => `${m.month}: ${formatMoney(m.revenue)} ${currency ?? ''}`).join(' · ');
  return (
    <div className="flex items-end gap-0.5 h-6" title={label}>
      {monthly.map(m => (
        <div key={m.month} className="w-1.5 rounded-sm bg-indigo-300" style={{ height: `${Math.max(2, (m.revenue / max) * 24)}px` }} />
      ))}
    </div>
  );
}
