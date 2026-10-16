import { useCallback, useEffect, useMemo, useState } from 'react'
import { REGRESO_OPACITY } from '../../api'
import { useMunicipio } from '../../municipio'
import { BusMap, STALE_MS } from '../../BusMap'
import { useLiveBuses, type Bus } from '../../useLiveBuses'
import { adminApi } from '../adminApi'
import type { ActiveShift, Driver } from '../types'
import { Kpi } from '../ui'

// Cuánto hace que reportó, en palabras: "hace 4 s", "hace 3 min".
function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`
}

type Row = {
  bus: Bus
  number: string
  routeName: string
  color: string
  driver: string
  live: boolean
  located: boolean
  sinceMs: number
}

// El Ojo de Dios: mapa en vivo y, a un lado, cada camión en ruta con su estado en palabras.
export function Monitoreo() {
  // Solo las rutas (y sus camiones) del municipio elegido en la barra lateral.
  const { visibleRoutes: routes, servesRoute } = useMunicipio()
  const { busesRef, status, tick } = useLiveBuses()
  const [selected, setSelected] = useState<number | null>(null)

  // Quién maneja cada unidad: turnos abiertos + nombres de choferes (si el rol puede verlos).
  const [shifts, setShifts] = useState<ActiveShift[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  useEffect(() => {
    let alive = true
    const load = () => {
      adminApi.activeShifts().then((s) => alive && setShifts(s)).catch(() => {})
      adminApi.drivers().then((d) => alive && setDrivers(d)).catch(() => {})
    }
    load()
    const t = window.setInterval(load, 15_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const shiftByBus = useMemo(() => new Map(shifts.map((s) => [s.busId, s])), [shifts])
  const driverName = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers])
  const routeById = useMemo(() => new Map((routes ?? []).map((r) => [r.id, r])), [routes])

  const labelOf = useCallback((bus: Bus) => shiftByBus.get(bus.id)?.busNumber ?? bus.name, [shiftByBus])

  const rows: Row[] = useMemo(() => {
    const now = performance.now()
    const out: Row[] = []
    for (const bus of busesRef.current.values()) {
      if (!servesRoute(bus.routeId)) continue
      const shift = shiftByBus.get(bus.id)
      const route = routeById.get(bus.routeId)
      const located = !Number.isNaN(bus.tgtLng)
      out.push({
        bus,
        number: labelOf(bus),
        routeName: route?.name ?? bus.routeId,
        color: route?.color ?? '#6c8cff',
        driver: shift ? (driverName.get(shift.driverId) ?? shift.driverId) : '',
        located,
        live: located && now - bus.updated <= STALE_MS,
        sinceMs: now - bus.updated,
      })
    }
    // Primero los que se ven en vivo; luego por número de unidad.
    return out.sort((a, b) => Number(b.live) - Number(a.live) || a.number.localeCompare(b.number, 'es', { numeric: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, shiftByBus, driverName, routeById, labelOf, servesRoute])

  const liveCount = rows.filter((r) => r.live).length
  const dot = status === 'en vivo' ? 'bg-emerald-400' : status === 'reconectando' ? 'bg-amber-400' : 'bg-sky-400'

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Kpi label="Camiones en ruta" value={rows.length} tone="blue" />
        <Kpi label="Reportando ahora" value={liveCount} sub={`/${rows.length}`} tone={liveCount < rows.length ? 'amber' : 'green'} />
        <div className="neu-card-sm ml-auto flex items-center gap-2 px-4 py-3 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${dot} ${status === 'en vivo' ? 'animate-pulse' : ''}`} />
          <span className="text-slate-500">
            {status === 'en vivo' ? 'Conectado: el mapa se actualiza solo' : status === 'reconectando' ? 'Sin conexión, reintentando…' : 'Conectando…'}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <aside className="neu-card flex max-h-72 flex-col overflow-hidden lg:max-h-none lg:w-80">
          <h2 className="px-4 pt-4 text-sm font-semibold text-slate-600">Camiones en ruta</h2>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {rows.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-slate-400">
                Ningún camión en ruta ahora. Aparecen aquí en cuanto un chofer inicia su ruta en la app.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((r) => (
                  <li key={r.bus.id}>
                    <button
                      onClick={() => setSelected(r.bus.id)}
                      disabled={!r.located}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selected === r.bus.id ? 'border-sky-400 bg-sky-400/10' : 'border-slate-300/50 hover:bg-slate-500/5'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
                        <strong className="text-slate-700">Unidad {r.number}</strong>
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${r.live ? 'bg-emerald-500/15 text-emerald-700' : r.located ? 'bg-amber-500/15 text-amber-700' : 'bg-slate-500/10 text-slate-500'}`}>
                          {r.live ? 'En vivo' : r.located ? 'Sin señal' : 'Sin ubicación'}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-600">{r.routeName}</div>
                      <div className="mt-0.5 flex justify-between text-xs text-slate-400">
                        <span className="truncate">{r.driver ? `Chofer: ${r.driver}` : ''}</span>
                        <span className="shrink-0 pl-2">{r.located ? `Último reporte ${ago(r.sinceMs)}` : 'Esperando GPS'}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {routes && routes.length > 0 && (
            <div className="border-t border-slate-300/40 px-4 py-3">
              <p className="mb-1.5 text-xs font-semibold text-slate-500">Rutas</p>
              <ul className="flex flex-col gap-1 text-xs text-slate-600">
                {routes.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-5 rounded-full" style={{ background: r.color }} />
                    {r.name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-1.5 w-5 rounded-full bg-slate-500" />Ida
                <span className="ml-2 h-1.5 w-5 rounded-full bg-slate-500" style={{ opacity: REGRESO_OPACITY }} />Regreso (mismo color, más tenue)
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Gris = no ha reportado en {STALE_MS / 1000} s (se ve su última posición). Acércate para ver las paradas.
              </p>
            </div>
          )}
        </aside>

        <div className="neu-inset relative min-h-[360px] flex-1 overflow-hidden p-1.5">
          {routes && (
            <BusMap routes={routes} busesRef={busesRef} labelOf={labelOf} selected={selected} onSelect={setSelected} showBus={servesRoute} />
          )}
        </div>
      </div>
    </div>
  )
}
