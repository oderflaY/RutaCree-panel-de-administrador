// Tema claro/oscuro: se guarda en localStorage y se aplica como <html data-theme="…">.
// Sin elección guardada se sigue el tema del sistema.
import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'rutacree.theme'
const listeners = new Set<() => void>()

function initial(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'light' || t === 'dark') return t
  } catch { /* sin storage */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let current: Theme = initial()
document.documentElement.dataset.theme = current

export function setTheme(t: Theme) {
  current = t
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch { /* sin storage */ }
  listeners.forEach((l) => l())
}

export const useTheme = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => current)

const SUN = 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
const MOON = 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme()
  const opt = (t: Theme, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => setTheme(t)}
      data-on={theme === t}
      aria-pressed={theme === t}
      className={`neu-btn flex flex-1 items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs ${theme === t ? 'text-sky-600' : 'text-slate-500'}`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      {label}
    </button>
  )
  return (
    <div className={`flex gap-2 ${className}`} role="group" aria-label="Tema">
      {opt('light', 'Claro', SUN)}
      {opt('dark', 'Oscuro', MOON)}
    </div>
  )
}
