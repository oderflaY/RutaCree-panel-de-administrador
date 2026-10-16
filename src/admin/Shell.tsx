import { useEffect, useState } from 'react'
import { roleLabel } from './adminApi'
import { useAuth } from './ctx'
import { NAV, PERMS, type Screen } from './permissions'
import { ThemeToggle } from '../theme'
import { MunicipioProvider, MunicipioSelect } from '../municipio'
import { Monitoreo } from './screens/Monitoreo'
import { Formatos } from './screens/Formatos'
import { Estadisticas } from './screens/Estadisticas'
import { Turnos } from './screens/Turnos'
import { Mantenimiento } from './screens/Mantenimiento'
import { Incidencias } from './screens/Incidencias'
import { Rutas } from './screens/Rutas'
import { Pasajeros } from './screens/Pasajeros'
import { Cuentas } from './screens/Cuentas'
import difLogo from '../assets/dif-logo.png'

const hashScreen = () => location.hash.replace(/^#\/?/, '') as Screen

export function Shell() {
  const { session, logout } = useAuth()
  const perms = PERMS[session!.role]
  const visible = NAV.filter((n) => perms.screens.includes(n.screen))

  const [screen, setScreen] = useState<Screen>(() => {
    const h = hashScreen()
    return visible.some((v) => v.screen === h) ? h : visible[0].screen
  })

  useEffect(() => {
    const onHash = () => {
      const h = hashScreen()
      setScreen(visible.some((v) => v.screen === h) ? h : visible[0].screen)
    }
    window.addEventListener('hashchange', onHash)
    if (hashScreen() !== screen) location.hash = `/${screen}`
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (s: Screen) => { location.hash = `/${s}`; setScreen(s) }

  return (
    <MunicipioProvider>
    <div data-section={screen} className="flex h-full w-full p-4 text-slate-700">
      <aside className="neu-card mr-4 flex w-60 shrink-0 flex-col overflow-hidden pb-4">
        <div className="dif-franja mx-4 mt-3" />
        <div className="flex items-center gap-3 px-5 pb-4 pt-4">
          <img src={difLogo} alt="DIF Durango" className="h-10 w-auto" />
          <div className="border-l border-slate-300/60 pl-3">
            <div className="font-semibold leading-tight text-slate-700">RutaCree</div>
            <div className="text-[11px] leading-tight text-slate-500">Ruta Azul · DIF</div>
          </div>
        </div>
        <MunicipioSelect className="mx-4 mb-2" />
        <nav className="flex-1 space-y-1.5 px-3 py-2">
          {visible.map((n) => {
            const label = n.screen === 'turnos' && !perms.turnos ? 'Flotilla' : n.label
            const on = screen === n.screen
            return (
              <button
                key={n.screen}
                onClick={() => go(n.screen)}
                data-on={on}
                data-section={n.screen}
                className={`neu-btn nav-item flex w-full items-center gap-3 px-2.5 py-2 text-sm ${on ? '' : 'text-slate-500'}`}
              >
                <span className="nav-chip">
                  <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
                </span>
                <span className={on ? 'font-semibold' : 'font-medium'}>{label}</span>
              </button>
            )
          })}
        </nav>
        <ThemeToggle className="mx-4 mt-2" />
        <div className="mx-4 mt-3 flex items-center justify-between gap-2 border-t border-slate-300/50 pt-3 text-sm">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">{roleLabel(session!.role)}</div>
            <strong className="block truncate text-slate-700">{session!.username}</strong>
          </div>
          <button onClick={logout} className="neu-btn shrink-0 px-3 py-1.5 text-xs text-slate-500">Salir</button>
        </div>
      </aside>

      <main className="section-wash min-w-0 flex-1 overflow-y-auto rounded-[18px] pr-1">
        {screen === 'monitoreo' && <Monitoreo />}
        {screen === 'formatos' && <Formatos role={session!.role} />}
        {screen === 'estadisticas' && <Estadisticas />}
        {screen === 'turnos' && <Turnos showTurnos={perms.turnos} showFlotilla={perms.flotilla} />}
        {screen === 'mantenimiento' && <Mantenimiento />}
        {screen === 'incidencias' && <Incidencias />}
        {screen === 'rutas' && <Rutas />}
        {screen === 'pasajeros' && <Pasajeros />}
        {screen === 'cuentas' && <Cuentas />}
      </main>
    </div>
    </MunicipioProvider>
  )
}
