import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchRoutes, serves, type Route } from './api'

// Municipio elegido en el panel: cada pantalla muestra solo sus rutas, camiones y vueltas.
// '' = todos. Se recuerda en este navegador.
const KEY = 'panel.municipio'

type Ctx = {
  routes: Route[] | null
  /** Municipios con al menos una ruta, en el orden en que aparecen. */
  municipios: string[]
  municipio: string
  setMunicipio: (m: string) => void
  /** Rutas del municipio elegido. */
  visibleRoutes: Route[] | null
  /** ¿La ruta con ese id es del municipio elegido? (las desconocidas solo se ven con "Todos"). */
  servesRoute: (routeId: string) => boolean
  reloadRoutes: () => void
}

const MunicipioCtx = createContext<Ctx>(null as unknown as Ctx)
export const useMunicipio = () => useContext(MunicipioCtx)

function saved() {
  try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
}

export function MunicipioProvider({ children }: { children: ReactNode }) {
  const [routes, setRoutes] = useState<Route[] | null>(null)
  const [municipio, setState] = useState(saved)
  const [version, setVersion] = useState(0)
  useEffect(() => { fetchRoutes().then(setRoutes).catch(() => setRoutes([])) }, [version])

  const value = useMemo<Ctx>(() => {
    const municipios = [...new Set((routes ?? []).flatMap((r) => r.municipios))]
    // Un municipio guardado que ya no tiene rutas cuenta como "Todos".
    const m = municipios.includes(municipio) ? municipio : ''
    const visibleRoutes = routes && routes.filter((r) => serves(r, m))
    const ids = new Set((visibleRoutes ?? []).map((r) => r.id))
    return {
      routes,
      municipios,
      municipio: m,
      setMunicipio: (x) => {
        setState(x)
        try { localStorage.setItem(KEY, x) } catch { /* sin almacenamiento: solo esta sesión */ }
      },
      visibleRoutes,
      servesRoute: (id) => m === '' || ids.has(id),
      reloadRoutes: () => setVersion((v) => v + 1),
    }
  }, [routes, municipio])

  return <MunicipioCtx.Provider value={value}>{children}</MunicipioCtx.Provider>
}

/** Selector de municipio para la barra lateral; no aparece si las rutas son de un solo municipio. */
export function MunicipioSelect({ className = '' }: { className?: string }) {
  const { municipios, municipio, setMunicipio } = useMunicipio()
  if (municipios.length < 2) return null
  return (
    <label className={`block text-xs text-slate-500 ${className}`}>
      Municipio
      <select
        value={municipio}
        onChange={(e) => setMunicipio(e.target.value)}
        className="neu-inset mt-1 block w-full px-3 py-2 text-sm text-slate-700 outline-none"
      >
        <option value="">Todos los municipios</option>
        {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </label>
  )
}
