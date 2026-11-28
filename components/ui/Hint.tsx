'use client';
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { FIELD_HELP, type HelpKey } from '@/lib/fieldHelp';

// Descripción al pasar el mouse sobre una etiqueta o campo (lib/fieldHelp.ts tiene los textos).
// - Mouse: aparece tras HOVER_DELAY sobre todo lo que envuelve <Hint>.
// - Teclado: aparece al entrar con Tab a un campo dentro (solo :focus-visible, no con clic).
// - Táctil: no hay hover; <HintIcon /> junto a la etiqueta abre y cierra al tocar.
// Se oculta al escribir, al hacer clic dentro, con Escape y al hacer scroll.
// La caja va en un portal con posición fija: el contenido de la página scrollea dentro de su
// propio panel y una caja absoluta quedaría recortada por las tarjetas.

const HOVER_DELAY = 400;
const GAP = 6;
const MARGIN = 8;

// Cómo llegó el foco: Chrome marca un campo de texto como :focus-visible aunque se haga clic,
// así que se mira la última interacción (tecla o puntero) en vez de :focus-visible.
let lastInputWasKeyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
  window.addEventListener('pointerdown', () => { lastInputWasKeyboard = false; }, true);
}
// Una sola descripción abierta a la vez.
let closeCurrent: (() => void) | null = null;

type HintState = { id: string; text: string; open: boolean; toggle: () => void; iconRef: React.RefObject<HTMLButtonElement> };
const HintContext = createContext<HintState | null>(null);

export default function Hint({ id, children, inline = false, className = '', extra }: {
  id: HelpKey;
  /** Dato propio de la fila (p. ej. el próximo paso), en otra línea debajo del texto fijo. */
  extra?: string;
  children: ReactNode;
  /** Envuelve con <span> (badges, botones en línea) en vez de <div>. */
  inline?: boolean;
  className?: string;
}) {
  const text = extra ? `${FIELD_HELP[id]} ${extra}` : FIELD_HELP[id];
  const tipId = useId();
  const wrapRef = useRef<HTMLElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);   // abierta tocando el ícono: no se cierra al salir el puntero
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (closeCurrent && closeCurrent !== close) closeCurrent();
    closeCurrent = close;
    return () => { if (closeCurrent === close) closeCurrent = null; };
  }, [open, close]);

  const toggle = useCallback(() => {
    clearTimeout(timer.current);
    setPinned(p => !p);
    setOpen(o => !o);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Posición: arriba de lo envuelto (no tapa el campo que se está usando); abajo si no cabe.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const anchor = (pinned && iconRef.current) || wrapRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    let top = a.top - GAP - height;
    if (top < MARGIN) top = Math.min(a.bottom + GAP, window.innerHeight - height - MARGIN);
    const left = Math.max(MARGIN, Math.min(a.left, window.innerWidth - width - MARGIN));
    setPos({ top, left });
  }, [open, pinned]);

  // Mientras está abierta: scroll, resize, Escape y toque fuera la cierran.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !tipRef.current?.contains(t)) close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  const Wrapper = inline ? 'span' : 'div';
  const handlers = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse' || pinned) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen(true), HOVER_DELAY);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse' || pinned) return;
      close();
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (iconRef.current?.contains(e.target as Node)) return;
      close();
    },
    onFocus: (e: React.FocusEvent) => {
      if (lastInputWasKeyboard && e.target !== iconRef.current) setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (open && e.key !== 'Tab' && e.key !== 'Shift' && !(iconRef.current && e.target === iconRef.current)) close();
    },
  };

  return (
    <HintContext.Provider value={{ id: tipId, text, open, toggle, iconRef }}>
      <Wrapper ref={wrapRef as never} className={className} data-hint={id} {...handlers}>
        {children}
      </Wrapper>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={tipRef} id={tipId} role="tooltip"
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className="fixed z-[100] max-w-[280px] rounded-xl bg-slate-900 px-3 py-2 text-xs leading-snug font-normal normal-case tracking-normal text-white shadow-lg pointer-events-none">
          {FIELD_HELP[id]}
          {extra && <span className="block mt-1 text-slate-300">{extra}</span>}
        </div>,
        document.body,
      )}
    </HintContext.Provider>
  );
}

/** Ícono ⓘ junto a la etiqueta, dentro de un <Hint>. Es lo que abre la descripción en táctil. */
export function HintIcon() {
  const ctx = useContext(HintContext);
  if (!ctx) return null;
  return (
    // Fuera del orden de Tab: con teclado la descripción ya abre al entrar al campo.
    <button ref={ctx.iconRef} type="button" tabIndex={-1} onClick={e => { e.preventDefault(); e.stopPropagation(); ctx.toggle(); }}
      aria-label="More info" aria-expanded={ctx.open} aria-describedby={`${ctx.id}-text`}
      className="inline-flex align-middle ml-1 text-slate-300 hover:text-slate-500 focus-visible:text-indigo-600 focus:outline-none">
      <Info size={12} aria-hidden />
      {/* Nombre corto ("More info") y la descripción aparte: si no, el nombre del botón incluiría todo el texto. */}
      <span id={`${ctx.id}-text`} hidden>{ctx.text}</span>
    </button>
  );
}
