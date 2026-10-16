import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { applyBase, baseStyle } from '../../mapBase'
import { REGRESO_OPACITY, legFeatures, legOpacity, routeExtras, serves } from '../../api'
import { MUNICIPIOS } from '../../municipios'
import { useMunicipio } from '../../municipio'
import { useTheme } from '../../theme'
import { adminApi, type RawRoute } from '../adminApi'
import { errMsg, useToast } from '../ctx'
import { Badge, Button, Modal, Section } from '../ui'

type Parsed = {
  id: string
  name: string
  color: string
  line: [number, number][]
  municipios: string[]
  regresoDesde: number | null
  stops: { id: string; name: string; lng: number; lat: number; accessible: boolean }[]
  raw: RawRoute
}

function parse(raw: RawRoute): Parsed {
  const r: Parsed = { id: '', name: '', color: '#2F5DA8', line: [], municipios: [], regresoDesde: null, stops: [], raw }
  for (const f of raw.features) {
    const p = f.properties
    if (f.geometry.type === 'LineString') {
      r.id = String(p.id ?? '')
      r.name = String(p.name ?? r.id)
      if (typeof p.color === 'string') r.color = p.color
      r.line = f.geometry.coordinates as [number, number][]
      Object.assign(r, routeExtras(p, r.line.length))
    } else if (f.geometry.type === 'Point') {
      const c = f.geometry.coordinates as [number, number]
      r.stops.push({ id: String(p.id ?? ''), name: String(p.name ?? ''), lng: c[0], lat: c[1], accessible: Boolean(p.accessible) })
    }
  }
  return r
}

const DURANGO = MUNICIPIOS[0].center

/** Mapa de la ruta; sin ruta (aún no hay ninguna publicada) muestra la ciudad vacía. */
function RoutePreview({ route }: { route: Parsed | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const theme = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme
  useEffect(() => { if (mapRef.current) applyBase(mapRef.current, theme) }, [theme])
  useEffect(() => {
    if (!ref.current) return
    const map = new maplibregl.Map({ container: ref.current, style: baseStyle(themeRef.current), center: route?.line[0] ?? DURANGO, zoom: route ? 12 : 12.4, attributionControl: false })
    mapRef.current = map
    map.on('load', () => {
      if (!route) return
      // Ida con el color de la ruta y regreso tenue; cada tramo corrido a su derecha para que en
      // calles compartidas se vean los dos, como carriles.
      map.addSource('l', { type: 'geojson', data: { type: 'FeatureCollection', features: legFeatures(route) } })
      map.addLayer({ id: 'l', type: 'line', source: 'l', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': legOpacity(1), 'line-offset': 2.5 } })
      map.addSource('s', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: route.stops.map((s) => ({ type: 'Feature', properties: { a: s.accessible }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) },
      })
      map.addLayer({ id: 's', type: 'circle', source: 's', paint: { 'circle-radius': 5, 'circle-color': ['case', ['get', 'a'], '#34b8bb', '#1b1f26'], 'circle-stroke-color': route.color, 'circle-stroke-width': 2 } })
      const b = new maplibregl.LngLatBounds()
      for (const c of route.line) b.extend(c)
      map.fitBounds(b, { padding: 40, duration: 0 })
    })
    return () => { mapRef.current = null; map.remove() }
  }, [route])
  return (
    <div className="relative">
      <div ref={ref} className="h-80 w-full overflow-hidden rounded-xl border border-slate-300/50" />
      {route && (
        <div className="neu-card-sm absolute left-2 top-2 flex gap-3 px-3 py-1.5 text-xs font-medium text-slate-600">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full" style={{ background: route.color }} />Ida</span>
          {route.regresoDesde != null && (
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full" style={{ background: route.color, opacity: REGRESO_OPACITY }} />Regreso</span>
          )}
        </div>
      )}
    </div>
  )
}

export function Rutas() {
  const toast = useToast()
  const { municipio, reloadRoutes } = useMunicipio()
  const [allRoutes, setRoutes] = useState<Parsed[]>([])
  const [error, setError] = useState('')
  const [sel, setSel] = useState('')
  const [geojson, setGeojson] = useState<Parsed | null>(null)

  async function load() {
    try {
      const raw = await adminApi.rawRoutes()
      const parsed = raw.map(parse).filter((r) => r.id)
      setRoutes(parsed)
      reloadRoutes()
    } catch (e) {
      setError(errMsg(e))
    }
  }
  useEffect(() => { load() }, [])

  const routes = useMemo(() => allRoutes.filter((r) => serves(r, municipio)), [allRoutes, municipio])
  const route = useMemo(() => routes.find((r) => r.id === sel) ?? routes[0], [routes, sel])

  async function toggleStop(stopId: string) {
    if (!route) return
    // Muta solo la propiedad accesible de esa parada, conservando todo lo demás (horarios incluidos).
    const raw: RawRoute = JSON.parse(JSON.stringify(route.raw))
    for (const f of raw.features) {
      if (f.geometry.type === 'Point' && String(f.properties.id) === stopId) {
        f.properties.accessible = !f.properties.accessible
      }
    }
    try {
      await adminApi.putRoute(raw)
      toast('Ruta actualizada')
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  async function del(r: Parsed) {
    if (!confirm(`¿Borrar la ruta ${r.name}? Desaparece de las apps.`)) return
    try {
      await adminApi.deleteRoute(r.id)
      toast('Ruta borrada')
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  if (error) return <p className="text-sm text-rose-500">{error}</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {routes.map((r) => (
          <button
            key={r.id}
            onClick={() => setSel(r.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${r.id === route?.id ? 'bg-slate-500/15 text-slate-700' : 'bg-slate-500/5 text-slate-600 hover:bg-slate-500/10'}`}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />
            {r.name}
          </button>
        ))}
      </div>

      {routes.length === 0 && (
        <Section title="Sin rutas publicadas" subtitle="Las apps muestran el mapa de la ciudad hasta que se publique una ruta.">
          <RoutePreview route={null} />
        </Section>
      )}

      {route && (
        <Section
          title={route.name}
          subtitle={`${route.municipios.join(', ') || 'Sin municipio'} · ${route.stops.length} paradas · ${route.stops.filter((s) => s.accessible).length} accesibles`}
          actions={
            <div className="flex gap-2">
              <Button onClick={() => setGeojson(route)}>GeoJSON</Button>
              <Button variant="red" onClick={() => del(route)}>Borrar ruta</Button>
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <RoutePreview route={route} />
            <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-300/50">
              <ul className="divide-y divide-slate-300/40">
                {route.stops.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="truncate">{s.name}</span>
                    <button
                      onClick={() => toggleStop(s.id)}
                      className="ml-auto"
                      title="Marcar si la parada tiene rampa accesible"
                    >
                      {s.accessible ? <Badge tone="green">Accesible</Badge> : <Badge tone="gray">No accesible</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Toca el estado de una parada para marcarla como accesible (rampa) o no; se publica a las apps al instante.
            La edición del trazo se hace por GeoJSON.
          </p>
        </Section>
      )}

      {geojson && (
        <Modal title={`GeoJSON · ${geojson.name}`} onClose={() => setGeojson(null)}>
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-[var(--bg-sunk)] p-3 text-xs text-slate-600">{JSON.stringify(geojson.raw, null, 2)}</pre>
        </Modal>
      )}
    </div>
  )
}
