import { useState } from 'react'
import { ApiError } from './adminApi'
import { useAuth } from './ctx'
import { Button, Field, Input } from './ui'
import { ThemeToggle } from '../theme'

export function Login() {
  const { login } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const d = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      await login(String(d.get('email')).trim(), String(d.get('password')))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Correo o contraseña incorrectos.' : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center p-4 text-slate-700">
      <ThemeToggle className="absolute right-4 top-4 w-48" />
      <form onSubmit={submit} className="neu-card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="neu-btn grid h-12 w-12 place-items-center text-sky-600">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 16V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M5 11h14M5 16h14v3H5z" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-700">RutaCree</div>
            <div className="text-xs text-slate-500">Centro de Control CREE</div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Correo"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
          <Field label="Contraseña"><Input name="password" type="password" autoComplete="current-password" required /></Field>
          {error && <p className="text-sm text-rose-500">{error}</p>}
          <Button variant="blue" type="submit" disabled={busy} className="mt-2 w-full py-2.5">{busy ? 'Entrando…' : 'Entrar'}</Button>
        </div>
      </form>
    </div>
  )
}
