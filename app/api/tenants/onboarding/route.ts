import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { loadOnboarding } from '@/lib/onboarding';

export type OnboardingBrief = { done: number; total: number; complete: boolean; stuck: boolean; next: string | null };

// Progreso de arranque de todos los salones, para la lista. Solo conteos: no se registra como lectura.
export async function GET() {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const all = await loadOnboarding(createAdminClient());
    const brief: Record<string, OnboardingBrief> = {};
    for (const [id, s] of Object.entries(all)) brief[id] = { done: s.done, total: s.total, complete: s.complete, stuck: s.stuck, next: s.next };
    return NextResponse.json(brief);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load onboarding' }, { status: 500 });
  }
}
