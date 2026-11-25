// Progreso del clone: el servidor manda pasos exactos (evento SSE "progress") en vez de que la
// página adivine contando líneas del log. Sin dependencias: se prueba con node --test.

export type ClonePhase = 'onboarding' | 'demo' | 'rollback';
export type CloneProgress = { phase: ClonePhase; done: number; total: number; label: string };

/** Pasos de cada modo: armar los mapas de ids + una tabla por paso; Demo suma estructura, clientes y 3 meses. */
export function cloneStepTotal(phase: ClonePhase, tables: number): number {
  if (phase === 'rollback') return tables;
  if (phase === 'onboarding') return 1 + tables;
  return 1 + tables + 1 + 1 + 3;
}

export function progressPercent(p: CloneProgress | null): number {
  if (!p || p.total <= 0) return 0;
  return Math.min(100, Math.round((p.done / p.total) * 100));
}

/** Contador de pasos: cada step() avanza uno y avisa. */
export function makeTracker(phase: ClonePhase, total: number, emit: (p: CloneProgress) => void) {
  let done = 0;
  emit({ phase, done, total, label: 'Starting' });
  return (label: string) => {
    done = Math.min(total, done + 1);
    emit({ phase, done, total, label });
  };
}

export type SseEvent = { event: string; data: string };

/**
 * Corta el texto recibido en eventos SSE completos (separados por una línea vacía) y devuelve lo
 * que quedó a medias para el próximo pedazo: un evento puede llegar partido entre dos lecturas.
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events = blocks.flatMap(block => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? [{ event, data: data.join('\n') }] : [];
  });
  return { events, rest };
}
