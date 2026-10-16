import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

// Carga asíncrona con estado y recarga manual.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    fn().then((d) => { setData(d); setError('') }).catch((e) => setError(String(e?.message ?? e))).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(reload, [reload])
  return { data, error, loading, reload, setData }
}

const accents = {
  base: 'text-slate-600',
  blue: 'text-sky-600 font-semibold',
  green: 'text-emerald-600 font-semibold',
  red: 'text-rose-500 font-semibold',
  ghost: 'text-slate-500 shadow-none! hover:bg-slate-500/5',
}
export function Button({ variant = 'base', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof accents }) {
  const ghost = variant === 'ghost'
  return <button className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-sm ${ghost ? 'rounded-lg' : 'neu-btn'} ${accents[variant]} ${className}`} {...p} />
}

export function Input({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`neu-inset w-full px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 ${className}`} {...p} />
}
export function Select({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`neu-inset w-full px-3 py-2 text-sm text-slate-700 outline-none ${className}`} {...p}>{children}</select>
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-500">
      {label}
      {children}
    </label>
  )
}

export function Section({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="neu-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-700">
            <span aria-hidden className="h-4 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Kpi({ label, value, tone = 'blue', sub }: { label: string; value: ReactNode; tone?: 'blue' | 'amber' | 'red' | 'green'; sub?: string }) {
  const tones = { blue: 'text-sky-600', amber: 'text-amber-500', red: 'text-rose-500', green: 'text-emerald-600' }
  return (
    <div className="neu-card-sm px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone]}`}>
        {value}
        {sub && <span className="ml-0.5 text-sm font-normal text-slate-400">{sub}</span>}
      </div>
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'gray' | 'blue'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-rose-100 text-rose-600',
    gray: 'bg-slate-200 text-slate-500',
    blue: 'bg-sky-100 text-sky-700',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="neu-inset overflow-x-auto p-1.5">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-400">
          <tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-300/40 text-slate-600">{children}</tbody>
      </table>
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="neu-card w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-700">{title}</h3>
          <button className="neu-btn h-8 w-8 text-lg text-slate-500" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Una fecha sola (YYYY-MM-DD) es del calendario local: leída como UTC saldría un día antes en Durango.
const parseDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso))
export const fmtDate = (iso?: string | null) => (iso ? parseDate(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
