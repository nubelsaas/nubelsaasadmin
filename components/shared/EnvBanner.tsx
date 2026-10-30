import { Database } from 'lucide-react';
import { getNubelEnv } from '@/lib/environment';

const STYLES = {
  prod: { className: 'bg-rose-600 text-white', label: 'Producción' },
  dev: { className: 'bg-amber-400 text-amber-950', label: 'Desarrollo' },
  unknown: { className: 'bg-slate-800 text-white', label: 'Entorno sin definir (NEXT_PUBLIC_NUBEL_ENV)' },
} as const;

/** Franja fija con la base de datos a la que escribe el portal. Siempre visible, también en /login. */
export default function EnvBanner() {
  const { env, projectRef } = getNubelEnv();
  const { className, label } = STYLES[env];
  return (
    <div className={`sticky top-0 z-50 flex items-center justify-center gap-1.5 px-4 py-1 text-[11px] font-black uppercase tracking-wider ${className}`}>
      <Database size={12} className="shrink-0" />
      <span>{label}</span>
      <span className="font-mono font-bold normal-case opacity-80">· {projectRef}</span>
    </div>
  );
}
