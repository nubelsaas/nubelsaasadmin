import { createHmac, timingSafeEqual } from 'node:crypto';

// Rollback borra todo el contenido de un tenant, así que solo se acepta para un clone
// recién terminado: el stream emite este token al finalizar y la UI lo devuelve en "Undo clone".
// Ver docs/features/clone.md §"Modo Rollback".
const TTL_MS = 60 * 60 * 1000;

function sign(target: string, expires: string, secret: string) {
  return createHmac('sha256', secret).update(`clone-undo:${target}:${expires}`).digest('hex');
}

export function createUndoToken(target: string, secret: string, now = Date.now()) {
  const expires = String(now + TTL_MS);
  return `${expires}.${sign(target, expires, secret)}`;
}

export function verifyUndoToken(token: unknown, target: string, secret: string, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [expires, signature, ...rest] = token.split('.');
  if (!expires || !signature || rest.length) return false;
  if (!(Number(expires) > now)) return false;

  const expected = Buffer.from(sign(target, expires, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
