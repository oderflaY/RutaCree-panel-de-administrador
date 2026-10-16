import { useState } from 'react'
import { ApiError } from './adminApi'
import { useAuth } from './ctx'
import { Button, Field, Input } from './ui'
import { ThemeToggle } from '../theme'
import difLogo from '../assets/dif-logo.png'

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
    <div data-section="monitoreo" className="relative flex min-h-full items-center justify-center p-4 text-slate-700">
      <ThemeToggle className="absolute right-4 top-4 w-48" />
      <form onSubmit={submit} className="neu-card w-full max-w-sm p-7">
        <div className="dif-franja -mx-1 mb-6" />
        <div className="mb-6 flex items-center gap-4">
          <img src={difLogo} alt="DIF Durango" className="h-14 w-auto" />
          <div className="border-l border-slate-300/60 pl-4">
            <div className="text-lg font-semibold text-slate-700">RutaCree</div>
            <div className="text-xs text-slate-500">Ruta Azul · Centro de Control</div>
            <div className="text-[11px] text-slate-400">DIF Estatal Durango</div>
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
