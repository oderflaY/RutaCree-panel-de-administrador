import { Providers, useAuth } from './admin/ctx'
import { Login } from './admin/Login'
import { Shell } from './admin/Shell'

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <div className="grid h-full place-items-center text-sm text-slate-400">Cargando…</div>
  return session ? <Shell /> : <Login />
}

export default function App() {
  return (
    <Providers>
      <Gate />
    </Providers>
  )
}
