'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// Diálogo para pedir un motivo o confirmar escribiendo un nombre, en lugar de window.prompt:
// muestra el mínimo que exige el servidor y no se pierde lo escrito por un clic fuera.

export const MIN_REASON = 5;   // mismo mínimo que las rutas API (reason.trim().length < 5)

export type AskOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  placeholder?: string;
  /** Si se da, en vez de un motivo hay que escribir exactamente este texto (p. ej. el nombre del salón). */
  expected?: string;
};

type Pending = AskOptions & { resolve: (value: string | null) => void };

/** `ask(...)` devuelve el texto escrito, o null si se canceló. Renderizar `dialog` en la página. */
export function useAskDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback((options: AskOptions) => new Promise<string | null>(resolve => {
    setPending({ ...options, resolve });
  }), []);

  const close = useCallback((value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  }, [pending]);

  const dialog = pending ? <AskDialog key={pending.title} options={pending} onClose={close} /> : null;
  return { ask, dialog };
}

function AskDialog({ options, onClose }: { options: AskOptions; onClose: (value: string | null) => void }) {
  const { title, message, confirmLabel, tone = 'primary', placeholder, expected } = options;
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = value.trim();
  const valid = expected !== undefined ? value === expected : trimmed.length >= MIN_REASON;
  const submit = () => { if (valid) onClose(expected !== undefined ? value : trimmed); };

  const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const confirmCls = tone === 'danger' ? 'bg-rose-600' : 'bg-indigo-600';

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-0 md:px-4" role="dialog" aria-modal="true" aria-labelledby="ask-dialog-title">
      <form
        onSubmit={e => { e.preventDefault(); submit(); }}
        className="w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl p-5 space-y-4"
      >
        <div className="flex items-start gap-3">
          <h2 id="ask-dialog-title" className="flex-1 text-base font-black text-slate-900">{title}</h2>
          <button type="button" onClick={() => onClose(null)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {message && <p className="text-sm text-slate-600">{message}</p>}

        {expected !== undefined ? (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500">Type <span className="font-mono text-slate-800">{expected}</span> to confirm</label>
            <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)} placeholder={expected} className={inputCls} />
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500">Reason (saved in the audit log)</label>
            <textarea
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              rows={3}
              placeholder={placeholder ?? 'e.g. The owner asked for help with…'}
              className={`${inputCls} resize-none`}
            />
            <p className={`text-[11px] ${trimmed.length > 0 && !valid ? 'text-amber-600' : 'text-slate-400'}`}>
              At least {MIN_REASON} characters.
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => onClose(null)}
            className="text-sm font-bold rounded-full border border-slate-200 px-5 py-2.5 text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={!valid}
            className={`rounded-full ${confirmCls} text-white font-black px-5 py-2.5 text-sm disabled:opacity-50`}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
