import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { legFeatures, legOpacity, type Route } from './api'
import type { Bus } from './useLiveBuses'
import { applyBase, baseStyle } from './mapBase'
import { ESTADO, MUNICIPIOS } from './municipios'
import { useTheme } from './theme'

const DURANGO = MUNICIPIOS[0]
// Sin reportar desde hace más de esto, el camión se dibuja apagado (su última posición conocida).
export const STALE_MS = 30_000

// Etiqueta del camión en el mapa: píldora del color de su ruta con el número económico.
function busElement(onClick: () => void): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'bus-marker'
  el.setAttribute('role', 'button')
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
  return el
}

export function BusMap({
  routes, busesRef, labelOf, selected, onSelect, showBus = () => true,
}: {
  routes: Route[]
  busesRef: React.RefObject<Map<number, Bus>>
  labelOf: (bus: Bus) => string
  selected: number | null
  onSelect: (id: number | null) => void
  /** Filtra camiones por ruta (los de otro municipio no se dibujan). */
  showBus?: (routeId: string) => boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const theme = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const labelRef = useRef(labelOf)
  labelRef.current = labelOf
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const showBusRef = useRef(showBus)
  showBusRef.current = showBus

  useEffect(() => { if (mapRef.current) applyBase(mapRef.current, theme) }, [theme])

  // Seleccionar un camión en la lista lo centra en el mapa.
  useEffect(() => {
    const map = mapRef.current
    const bus = selected == null ? undefined : busesRef.current.get(selected)
    if (map && bus && !Number.isNaN(bus.tgtLng)) {
      map.flyTo({ center: [bus.tgtLng, bus.tgtLat], zoom: Math.max(map.getZoom(), 15), essential: true })
    }
  }, [selected, busesRef])

  useEffect(() => {
    if (!container.current) return
    const colorOf = new Map(routes.map((r) => [r.id, r.color] as const))
    const map = new maplibregl.Map({
      container: container.current,
      style: baseStyle(themeRef.current),
      center: DURANGO.center,
      zoom: DURANGO.zoom,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('click', () => onSelectRef.current(null))

    const markers = new Map<number, { marker: maplibregl.Marker; el: HTMLDivElement }>()
    let raf = 0
    const lerp = (a: number, b: number, f: number) => a + (b - a) * f

    map.on('load', () => {
      // Rutas: un borde blanco debajo para que el color se lea sobre cualquier fondo.
      map.addSource('rutas', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: routes.flatMap(legFeatures),
        },
      })
      map.addLayer({ id: 'rutas-borde', type: 'line', source: 'rutas', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': legOpacity(0.9), 'line-offset': 2.5 } })
      // Ida con el color de la ruta; regreso del mismo color pero tenue. Cada tramo corrido a su
      // derecha para que en calles compartidas se vean los dos, como carriles.
      map.addLayer({ id: 'rutas-linea', type: 'line', source: 'rutas', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4.5, 'line-opacity': legOpacity(1), 'line-offset': 2.5 } })

      // Paradas: aparecen al acercarse, para no saturar la vista de la ciudad.
      map.addSource('paradas', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: routes.flatMap((r) => r.stops.map((s) => ({
            type: 'Feature' as const, properties: { color: r.color, name: s.name }, geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
          }))),
        },
      })
      map.addLayer({ id: 'paradas', type: 'circle', source: 'paradas', minzoom: 13.5,
        paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } })
      const popup = new maplibregl.Popup({ closeButton: false, offset: 10 })
      map.on('mouseenter', 'paradas', (e) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = 'pointer'
        popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(`Parada: ${f.properties?.name}`).addTo(map)
      })
      map.on('mouseleave', 'paradas', () => { map.getCanvas().style.cursor = ''; popup.remove() })

      const b = new maplibregl.LngLatBounds()
      for (const r of routes) for (const c of r.line) b.extend(c as [number, number])
      if (!b.isEmpty()) map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 })

      const frame = () => {
        const now = performance.now()
        const seen = new Set<number>()
        for (const bus of busesRef.current.values()) {
          if (Number.isNaN(bus.tgtLng) || !showBusRef.current(bus.routeId)) continue
          seen.add(bus.id)
          let m = markers.get(bus.id)
          if (!m) {
            const el = busElement(() => onSelectRef.current(bus.id))
            m = { el, marker: new maplibregl.Marker({ element: el }).setLngLat([bus.tgtLng, bus.tgtLat]).addTo(map) }
            markers.set(bus.id, m)
          }
          const f = Math.min(1, (now - bus.t0) / bus.dur)
          m.marker.setLngLat([lerp(bus.prevLng, bus.tgtLng, f), lerp(bus.prevLat, bus.tgtLat, f)])
          const label = labelRef.current(bus)
          if (m.el.textContent !== label) m.el.textContent = label
          m.el.style.background = colorOf.get(bus.routeId) ?? '#2f5da8'
          m.el.classList.toggle('stale', now - bus.updated > STALE_MS)
          m.el.classList.toggle('selected', selectedRef.current === bus.id)
          m.el.setAttribute('aria-label', `Unidad ${label}`)
        }
        for (const [id, m] of markers) {
          if (!seen.has(id)) { m.marker.remove(); markers.delete(id) }
        }
        raf = requestAnimationFrame(frame)
      }
      frame()
    })

    return () => {
      cancelAnimationFrame(raf)
      for (const m of markers.values()) m.marker.remove()
      mapRef.current = null
      map.remove()
    }
  }, [routes, busesRef])

  // Salta a la cabecera de un municipio (o a todo el estado); el mapa se puede mover libremente.
  function goTo(name: string) {
    const m = name === ESTADO.name ? ESTADO : MUNICIPIOS.find((x) => x.name === name)
    if (m && mapRef.current) mapRef.current.flyTo({ center: m.center, zoom: m.zoom, essential: true })
  }

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      <select
        aria-label="Ir a un municipio"
        defaultValue=""
        onChange={(e) => { goTo(e.target.value); e.target.value = '' }}
        className="neu-card-sm absolute left-3 top-3 z-10 max-w-[70%] px-3 py-2 text-sm text-slate-700 outline-none"
      >
        <option value="" disabled>Ir a municipio…</option>
        <option value={ESTADO.name}>{ESTADO.name}</option>
        {MUNICIPIOS.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
      </select>
    </div>
  )
}
