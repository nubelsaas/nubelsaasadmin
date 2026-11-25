import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { loadTenantHealth } from '@/lib/tenantHealth';
import type { HealthSummary } from '@/lib/tenantFilters';

// Salud de cada salón para la lista de tenants. Es la misma lectura que el dashboard (ventas de
// 6 meses), más lenta que la lista: la página la pide aparte y muestra la lista sin esperarla.
export async function GET() {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const health = await loadTenantHealth(createAdminClient());
    const summary: Record<string, HealthSummary> = {};
    for (const h of health) {
      summary[h.id] = {
        status: h.status,
        // Los mismos avisos "high" por salón que muestra el dashboard (lib/tenantHealth.ts loadAlerts).
        needsAttention: h.auditOff || (!h.hasOwner && !h.suspended) || h.contactIssue === 'inactive',
      };
    }
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load health' }, { status: 500 });
  }
}
