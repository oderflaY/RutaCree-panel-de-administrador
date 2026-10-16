import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import { applyBase, baseStyle } from '../../mapBase'
import { MUNICIPIOS } from '../../municipios'
import { useTheme } from '../../theme'
import { adminApi, type RawRoute } from '../adminApi'
import { errMsg, useToast } from '../ctx'
import { Button, Field, Input, Modal, Select } from '../ui'
import {
  dist, fmtKm, fmtMin, joinSegments, lineLength, nearestVertex, project, shortStreet, simplifyIdx, slug, type LngLat,
} from '../routeGeo'

// Editor de rutas a mano: se hace clic por donde pasa el camión y el trazo sigue las calles solo
// (OSRM, a través del servidor); las paradas se ponen sobre el recorrido y toman el nombre de la
// calle. Se publica como el mismo GeoJSON que leen las apps.

type Waypoint = { id: string; p: LngLat; free: boolean } // free: el tramo que LLEGA a este punto va recto
type Leg = 'ida' | 'regreso'
type EStop = { id: string; name: string; p: LngLat; accessible: boolean; horarios: string[]; leg: Leg; fresh?: boolean } // fresh: aún sin clave en el servidor
type Draft = {
  id: string
  name: string
  color: string
  destino: string | null // id de la parada donde termina la ida
  waypoints: Waypoint[]
  stops: EStop[]
  extra: Record<string, unknown> // otras propiedades de la ruta que se conservan (fuente, …)
}
type Seg = { coords: LngLat[]; meters: number; seconds: number; status: 'ok' | 'loading' | 'error' }
type Tool = 'trazar' | 'paradas' | 'mover'

export type EditorStart =
  | { kind: 'new' }
  | { kind: 'edit'; raw: RawRoute }
  | { kind: 'copy'; raw: RawRoute }
  | { kind: 'import'; raw: RawRoute }

export const DIF_COLORS = [
  { name: 'Azul', hex: '#2F5DA8' }, { name: 'Magenta', hex: '#D91178' }, { name: 'Turquesa', hex: '#34B8BB' },
  { name: 'Naranja', hex: '#F19025' }, { name: 'Morado', hex: '#9A6CB1' }, { name: 'Rojo', hex: '#E31E31' },
  { name: 'Vino', hex: '#AD1B71' }, { name: 'Amarillo', hex: '#E8B10C' },
]

const BUS_FACTOR = 1.35 // el camión va más lento que un auto (lo que estima OSRM)
const STOP_SECONDS = 30 // tiempo que se detiene en cada parada
const MAX_STOP_DISTANCE = 120 // m: una parada más lejos del recorrido no se acepta
let uid = 0
const newId = () => `w${Date.now().toString(36)}${(uid++).toString(36)}`
const keyOf = (a: LngLat, b: LngLat, free: boolean) =>
  `${free ? 's' : 'r'}|${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}`
const round = (p: LngLat): LngLat => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]
const draftKey = (start: EditorStart, id: string) => `rutacree.editor.${start.kind === 'edit' ? id : 'nueva'}`

// ---------- GeoJSON → borrador ----------

function fromRaw(raw: RawRoute, cache: Map<string, Seg>): Draft {
  const line = raw.features.find((f) => f.geometry.type === 'LineString')
  const lp = (line?.properties ?? {}) as Record<string, unknown>
  const coords = ((line?.geometry.coordinates as LngLat[]) ?? []).map(round)
  const { id, name, color, destino, editor, municipios, regreso_desde, ...extra } = lp
  void municipios; void regreso_desde // el servidor los vuelve a calcular al publicar

  // Puntos de control: los que guardó el editor la vez anterior, o la forma simplificada del trazo.
  let idx: number[]
  let frees: boolean[] = []
  const saved = (editor as { waypoints?: [number, number, number?][] } | undefined)?.waypoints
  if (Array.isArray(saved) && saved.length >= 2) {
    idx = []
    let from = 0
    for (const w of saved) {
      const i = nearestVertex(coords, [w[0], w[1]], from)
      idx.push(i)
      from = i
    }
    frees = saved.map((w) => Boolean(w[2]))
  } else {
    idx = simplifyIdx(coords, 18)
  }
  const waypoints: Waypoint[] = idx.map((i, k) => ({ id: newId(), p: coords[i], free: frees[k] ?? false }))
  // Cada tramo del trazo publicado queda tal cual (no se vuelve a pedir) hasta que se mueva un punto.
  for (let k = 0; k + 1 < idx.length; k++) {
    const part = coords.slice(idx[k], idx[k + 1] + 1)
    if (part.length < 2) continue
    cache.set(keyOf(waypoints[k].p, waypoints[k + 1].p, waypoints[k + 1].free), {
      coords: part, meters: lineLength(part), seconds: lineLength(part) / 8.3, status: 'ok',
    })
  }

  const pts = raw.features.filter((f) => f.geometry.type === 'Point')
  // Sin "destino" explícito el servidor usa la parada llamada CREE o CRIT; aquí igual.
  const destIdx = destino
    ? pts.findIndex((f) => f.properties.id === destino || f.properties.name === destino)
    : pts.findIndex((f) => /^(CREE|CRIT)\b/.test(String(f.properties.name ?? '')))
  // El sentido de cada parada sale del orden publicado (antes del destino = ida), no de la cercanía:
  // en calles por las que pasa de ida y de regreso, la más cercana puede ser la del otro sentido.
  const stops: EStop[] = pts.map((f, k) => {
    const p = round(f.geometry.coordinates as LngLat)
    return {
      id: String(f.properties.id ?? newId()),
      name: String(f.properties.name ?? ''),
      p,
      accessible: Boolean(f.properties.accessible),
      horarios: Array.isArray(f.properties.horarios) ? f.properties.horarios.map(String) : [],
      leg: destIdx >= 0 && k > destIdx ? 'regreso' : 'ida',
    }
  })
  return {
    id: String(id ?? ''), name: String(name ?? ''), color: typeof color === 'string' ? color : DIF_COLORS[0].hex,
    destino: destIdx >= 0 ? stops[destIdx].id : null, waypoints, stops, extra,
  }
}

const emptyDraft = (): Draft => ({ id: '', name: '', color: DIF_COLORS[0].hex, destino: null, waypoints: [], stops: [], extra: {} })

// ---------- cálculo del trazo ----------

type Built = {
  line: LngLat[]
  segIndex: number[] // primer vértice de `line` de cada tramo
  split: number | null // vértice donde empieza el regreso
  idaM: number; regM: number; idaS: number; regS: number
  pending: number; errors: number
  stopsOn: { stop: EStop; point: LngLat; along: number; off: number; leg: Leg }[]
}

function build(d: Draft, segs: (Seg | undefined)[]): Built {
  const parts: LngLat[][] = []
  const segIndex: number[] = []
  let pending = 0, errors = 0
  const segSeconds: number[] = []
  let n = 0
  for (let i = 0; i + 1 < d.waypoints.length; i++) {
    const a = d.waypoints[i].p, b = d.waypoints[i + 1].p
    const s = segs[i]
    if (!s || s.status === 'loading') pending++
    if (s?.status === 'error') errors++
    const coords = s && s.status === 'ok' ? s.coords : [a, b]
    segIndex.push(Math.max(0, n - (parts.length ? 1 : 0)))
    parts.push(coords)
    n += coords.length - (parts.length > 1 ? 1 : 0)
    segSeconds.push(s && s.status === 'ok' ? s.seconds : dist(a, b) / 8.3)
  }
  const line = joinSegments(parts)
  const dest = d.stops.find((s) => s.id === d.destino)
  let split: number | null = null
  if (dest && line.length > 2) {
    const v = nearestVertex(line, dest.p)
    if (v > 0 && v < line.length - 1) split = v
  }
  const total = lineLength(line)
  const idaM = split != null ? lineLength(line, 0, split) : total
  const regM = total - idaM
  const secs = segSeconds.reduce((a, b) => a + b, 0) * BUS_FACTOR
  const idaS = total ? (secs * idaM) / total : 0
  const stopsOn = d.stops.map((stop) => {
    const leg: Leg = split == null ? 'ida' : stop.leg
    const pr = split == null ? project(line, stop.p) : leg === 'ida' ? project(line, stop.p, 0, split) : project(line, stop.p, split)
    return { stop, point: pr?.point ?? stop.p, along: pr?.along ?? 0, off: pr?.distance ?? 0, leg }
  }).sort((a, b) => (a.leg === b.leg ? a.along - b.along : a.leg === 'ida' ? -1 : 1))
  const nIda = stopsOn.filter((s) => s.leg === 'ida').length
  return {
    line, segIndex, split, idaM, regM, pending, errors, stopsOn,
    idaS: idaS + nIda * STOP_SECONDS, regS: secs - idaS + (stopsOn.length - nIda) * STOP_SECONDS,
  }
}

function toGeoJSON(d: Draft, b: Built): RawRoute {
  // Las paradas que ya existían conservan su clave (solicitudes de rampa, reportes); las nuevas estrenan una.
  const used = new Set(d.stops.filter((s) => !s.fresh).map((s) => s.id))
  const ids = new Map<string, string>()
  let n = 0
  for (const s of d.stops) {
    if (!s.fresh) { ids.set(s.id, s.id); continue }
    let id: string
    do { id = `${d.id}-p${++n}` } while (used.has(id))
    used.add(id)
    ids.set(s.id, id)
  }
  const props: Record<string, unknown> = {
    ...d.extra, id: d.id, name: d.name.trim(), color: d.color,
    editor: { v: 1, waypoints: d.waypoints.map((w) => [w.p[0], w.p[1], w.free ? 1 : 0]) },
  }
  if (d.destino && ids.has(d.destino)) props.destino = ids.get(d.destino)
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: b.line } },
      ...b.stopsOn.map(({ stop, point }) => ({
        type: 'Feature',
        properties: {
          id: ids.get(stop.id), name: stop.name.trim(), accessible: stop.accessible,
          ...(stop.horarios.length ? { horarios: stop.horarios } : {}),
        },
        geometry: { type: 'Point', coordinates: round(point) },
      })),
    ],
  } as RawRoute
}

// ---------- el editor ----------

export function RouteEditor({ start, existingIds, landmarks, onClose, onSaved }: {
  start: EditorStart
  existingIds: string[]
  landmarks: { name: string; p: LngLat }[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const toast = useToast()
  const theme = useTheme()
  const cache = useRef(new Map<string, Seg>())
  const [, bump] = useState(0)
  const rerender = useCallback(() => bump((x) => x + 1), [])

  const initial = useMemo(() => {
    if (start.kind === 'new') return emptyDraft()
    const d = fromRaw(start.raw, cache.current)
    if (start.kind === 'copy') {
      const ids = new Map(d.stops.map((s) => [s.id, newId()]))
      return { ...d, id: '', name: `${d.name} (copia)`, destino: d.destino ? ids.get(d.destino) ?? null : null,
        stops: d.stops.map((s) => ({ ...s, id: ids.get(s.id)!, fresh: true })) }
    }
    if (start.kind === 'import') return { ...d, id: existingIds.includes(d.id) ? '' : d.id }
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const isEdit = start.kind === 'edit'
  const [draft, setDraft] = useState<Draft>(initial)
  const [past, setPast] = useState<Draft[]>([])
  const [future, setFuture] = useState<Draft[]>([])
  const [tool, setTool] = useState<Tool>(initial.waypoints.length ? 'mover' : 'trazar')
  const [snap, setSnap] = useState(true)
  const [selected, setSelected] = useState<{ kind: 'wp' | 'stop'; id: string } | null>(null)
  const [tab, setTab] = useState<'datos' | 'paradas' | 'revisar'>('datos')
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [restore, setRestore] = useState<{ draft: Draft; at: number } | null>(null)
  const [idTouched, setIdTouched] = useState(isEdit)

  // Cambios con historial (deshacer / rehacer) y borrador guardado en el navegador.
  const commit = useCallback((next: Draft | ((d: Draft) => Draft)) => {
    setDraft((d) => {
      const n = typeof next === 'function' ? next(d) : next
      if (n === d) return d
      setPast((p) => [...p.slice(-99), d])
      setFuture([])
      setDirty(true)
      return n
    })
  }, [])
  // Al escribir (nombres) no se guarda cada letra: una sola entrada de historial por edición.
  const snapshot = useRef<Draft | null>(null)
  const beginEdit = () => { snapshot.current = draftRef.current }
  const endEdit = () => {
    const before = snapshot.current
    snapshot.current = null
    if (before && before !== draftRef.current) { setPast((p) => [...p.slice(-99), before]); setFuture([]) }
  }
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p
      setDraft((d) => { setFuture((f) => [d, ...f]); return p[p.length - 1] })
      return p.slice(0, -1)
    })
  }, [])
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f
      setDraft((d) => { setPast((p) => [...p, d]); return f[0] })
      return f.slice(1)
    })
  }, [])

  const storeKey = draftKey(start, initial.id)
  useEffect(() => {
    try {
      const s = localStorage.getItem(storeKey)
      if (s) {
        const v = JSON.parse(s) as { draft: Draft; at: number }
        if (v.draft?.waypoints?.length) setRestore(v)
      }
    } catch { /* sin storage */ }
  }, [storeKey])
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => { try { localStorage.setItem(storeKey, JSON.stringify({ draft, at: Date.now() })) } catch { /* lleno */ } }, 600)
    return () => clearTimeout(t)
  }, [draft, dirty, storeKey])
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Tramos: los que faltan se piden al servidor (por calles) o se trazan rectos.
  const segKeys = useMemo(() => draft.waypoints.slice(1).map((w, i) => keyOf(draft.waypoints[i].p, w.p, w.free)), [draft.waypoints])
  useEffect(() => {
    let alive = true
    const queue: { key: string; a: LngLat; b: LngLat }[] = []
    draft.waypoints.slice(1).forEach((w, i) => {
      const a = draft.waypoints[i].p, key = segKeys[i]
      const have = cache.current.get(key)
      if (have && have.status !== 'error') return
      if (w.free) {
        cache.current.set(key, { coords: [a, w.p], meters: dist(a, w.p), seconds: dist(a, w.p) / 8.3, status: 'ok' })
        return
      }
      if (!have) { cache.current.set(key, { coords: [a, w.p], meters: 0, seconds: 0, status: 'loading' }); queue.push({ key, a, b: w.p }) }
    })
    rerender()
    // Hasta 3 a la vez para no saturar el servicio.
    const worker = async () => {
      while (alive && queue.length) {
        const job = queue.shift()!
        try {
          const r = await adminApi.routePath([job.a, job.b])
          const coords = r.coordinates.length >= 2 ? (r.coordinates.map(round) as LngLat[]) : [job.a, job.b]
          // El trazo empieza y termina exactamente en los puntos (OSRM los pega a la calle).
          cache.current.set(job.key, { coords: [job.a, ...coords, job.b], meters: r.distance, seconds: r.duration, status: 'ok' })
        } catch {
          cache.current.set(job.key, { coords: [job.a, job.b], meters: dist(job.a, job.b), seconds: 0, status: 'error' })
        }
        if (alive) rerender()
      }
    }
    worker(); worker(); worker()
    return () => { alive = false; for (const j of queue) cache.current.delete(j.key) }
  }, [segKeys, draft.waypoints, rerender])

  const segs = segKeys.map((k) => cache.current.get(k))
  const built = build(draft, segs)
  const builtRef = useRef(built)
  builtRef.current = built

  // ---------- acciones ----------

  const addWaypoint = useCallback((p: LngLat) => {
    commit((d) => ({ ...d, waypoints: [...d.waypoints, { id: newId(), p: round(p), free: !snapRef.current }] }))
  }, [commit])
  const snapRef = useRef(snap)
  snapRef.current = snap

  const addStop = useCallback(async (p: LngLat, name?: string) => {
    const b = builtRef.current
    if (b.line.length < 2) { toast('Primero traza el recorrido; las paradas van sobre él', 'error'); return }
    const pr = project(b.line, p)
    if (!pr || pr.distance > MAX_STOP_DISTANCE) { toast('Pon la parada sobre el recorrido (a menos de 120 m)', 'error'); return }
    const leg: Leg = b.split != null && pr.index >= b.split ? 'regreso' : 'ida'
    const id = newId()
    commit((d) => ({ ...d, stops: [...d.stops, { id, name: name ?? 'Buscando calle…', p: round(pr.point), accessible: true, horarios: [], leg, fresh: true }] }))
    setSelected({ kind: 'stop', id })
    setTab('paradas')
    if (name) return
    try {
      const s = await adminApi.streetName(pr.point)
      const nm = s.name ? shortStreet(s.name) + (s.cross ? ` y ${shortStreet(s.cross)}` : '') : 'Parada nueva'
      setDraft((d) => ({ ...d, stops: d.stops.map((x) => (x.id === id && x.name === 'Buscando calle…' ? { ...x, name: nm } : x)) }))
    } catch {
      setDraft((d) => ({ ...d, stops: d.stops.map((x) => (x.id === id && x.name === 'Buscando calle…' ? { ...x, name: 'Parada nueva' } : x)) }))
    }
  }, [commit, toast])

  const removeSelected = useCallback(() => {
    if (!selected) return
    if (selected.kind === 'wp') commit((d) => ({ ...d, waypoints: d.waypoints.filter((w) => w.id !== selected.id) }))
    else commit((d) => ({ ...d, stops: d.stops.filter((s) => s.id !== selected.id), destino: d.destino === selected.id ? null : d.destino }))
    setSelected(null)
  }, [selected, commit])

  const sameWayBack = () => {
    const w = draft.waypoints
    if (w.length < 2) return
    // De regreso, el punto j se alcanza desde j+1: el tramo va recto si el de ida (j → j+1) iba recto.
    const back = w.slice(0, -1).reverse().map((p, k) => {
      const j = w.length - 2 - k
      return { id: newId(), p: p.p, free: w[j + 1].free }
    })
    commit((d) => ({ ...d, waypoints: [...d.waypoints, ...back] }))
    toast('Regreso agregado por las mismas calles; en avenidas divididas toma el carril de regreso')
  }
  const closeLoop = () => {
    if (draft.waypoints.length < 2) return
    commit((d) => ({ ...d, waypoints: [...d.waypoints, { id: newId(), p: d.waypoints[0].p, free: !snap }] }))
  }
  const toggleFree = (id: string) => commit((d) => ({ ...d, waypoints: d.waypoints.map((w) => (w.id === id ? { ...w, free: !w.free } : w)) }))
  const retryErrors = () => {
    for (const k of segKeys) if (cache.current.get(k)?.status === 'error') cache.current.delete(k)
    setDraft((d) => ({ ...d, waypoints: [...d.waypoints] }))
  }
  const straightenErrors = () => {
    const bad = new Set(draft.waypoints.slice(1).filter((_, i) => cache.current.get(segKeys[i])?.status === 'error').map((w) => w.id))
    commit((d) => ({ ...d, waypoints: d.waypoints.map((w) => (bad.has(w.id) ? { ...w, free: true } : w)) }))
  }
  const updateStop = (id: string, patch: Partial<EStop>) => commit((d) => ({ ...d, stops: d.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))

  // ---------- teclado ----------

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo() }
      else if (k === 'delete' || k === 'backspace') { if (selected) { e.preventDefault(); removeSelected() } }
      else if (k === 'escape') setSelected(null)
      else if (k === '1' || k === 't') setTool('trazar')
      else if (k === '2' || k === 'p') setTool('paradas')
      else if (k === '3' || k === 'm') setTool('mover')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo, removeSelected, selected])

  // ---------- mapa ----------

  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const stopMarkers = useRef(new Map<string, maplibregl.Marker>())
  const toolRef = useRef(tool)
  toolRef.current = tool
  const draftRef = useRef(draft)
  draftRef.current = draft
  const handlers = useRef({ addWaypoint, addStop, commit, setSelected })
  handlers.current = { addWaypoint, addStop, commit, setSelected }

  useEffect(() => {
    if (!mapEl.current) return
    const first = initial.waypoints[0]?.p
    const map = new maplibregl.Map({
      container: mapEl.current, style: baseStyle(theme), center: first ?? MUNICIPIOS[0].center, zoom: first ? 13 : 12.6,
      attributionControl: false, doubleClickZoom: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('load', () => {
      // Flecha del sentido de circulación, dibujada aquí (el estilo no trae íconos).
      const c = document.createElement('canvas'); c.width = c.height = 24
      const g = c.getContext('2d')!
      g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5
      g.beginPath(); g.moveTo(6, 5); g.lineTo(18, 12); g.lineTo(6, 19); g.lineTo(9, 12); g.closePath(); g.fill(); g.stroke()
      map.addImage('arrow', g.getImageData(0, 0, 24, 24), { pixelRatio: 2 })

      const empty = { type: 'FeatureCollection' as const, features: [] }
      for (const id of ['line', 'pending', 'mid', 'wp']) map.addSource(id, { type: 'geojson', data: empty })
      map.addLayer({ id: 'line-case', type: 'line', source: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 } })
      map.addLayer({ id: 'line', type: 'line', source: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': ['case', ['==', ['get', 'tramo'], 'regreso'], 0.55, 1] } })
      map.addLayer({ id: 'arrows', type: 'symbol', source: 'line', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'arrow', 'icon-size': 0.9, 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map' } })
      map.addLayer({ id: 'pending', type: 'line', source: 'pending', paint: { 'line-color': ['case', ['==', ['get', 'error'], true], '#E31E31', '#6b7686'], 'line-width': 3, 'line-dasharray': [2, 1.5] } })
      map.addLayer({ id: 'mid', type: 'circle', source: 'mid', minzoom: 12.5, paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-opacity': 0.85, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.8 } })
      map.addLayer({ id: 'wp', type: 'circle', source: 'wp', paint: {
        'circle-radius': ['case', ['get', 'sel'], 8, ['get', 'end'], 7.5, 6],
        'circle-color': ['case', ['get', 'start'], '#16a34a', ['get', 'end'], '#1b1f26', '#ffffff'],
        'circle-stroke-color': ['case', ['get', 'sel'], '#111827', ['get', 'color']], 'circle-stroke-width': ['case', ['get', 'sel'], 3.5, 2.5],
      } })
      setMapReady(true)
    })

    // Arrastrar puntos (y los puntos medios, que insertan uno nuevo).
    let drag: { kind: 'wp' | 'mid'; id: string; index: number; moved: boolean } | null = null
    const down = (kind: 'wp' | 'mid') => (e: maplibregl.MapLayerMouseEvent) => {
      if (toolRef.current === 'paradas' || !e.features?.length) return
      e.preventDefault()
      const f = e.features[0].properties as { id: string; i: number }
      drag = { kind, id: f.id, index: f.i, moved: false }
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    }
    map.on('mousedown', 'wp', down('wp'))
    map.on('mousedown', 'mid', down('mid'))
    // Durante el arrastre solo se mueve el punto en pantalla; al soltar se guarda (una sola entrada
    // de historial, también cuando se inserta un punto nuevo desde un punto medio).
    let last: LngLat | null = null
    map.on('mousemove', (e) => {
      if (!drag) return
      drag.moved = true
      last = round([e.lngLat.lng, e.lngLat.lat])
      const src = map.getSource('wp') as maplibregl.GeoJSONSource | undefined
      if (!src) return
      const d = draftRef.current
      const pts = d.waypoints.map((w) => ({ id: w.id, p: w.id === drag!.id ? last! : w.p }))
      if (drag.kind === 'mid') pts.splice(drag.index + 1, 0, { id: '__new', p: last })
      src.setData({ type: 'FeatureCollection', features: pts.map((w, i) => ({ type: 'Feature', properties: { id: w.id, i, color: d.color, sel: w.id === drag!.id || w.id === '__new', start: i === 0, end: i === pts.length - 1 }, geometry: { type: 'Point', coordinates: w.p } })) })
    })
    map.on('mouseup', () => {
      if (!drag) return
      const { kind, id, index, moved } = drag
      drag = null
      map.getCanvas().style.cursor = ''
      map.dragPan.enable()
      if (kind === 'mid') {
        if (!moved || !last) return
        const p = last, nid = newId(), at = index + 1
        handlers.current.commit((d) => ({ ...d, waypoints: [...d.waypoints.slice(0, at), { id: nid, p, free: d.waypoints[at]?.free ?? false }, ...d.waypoints.slice(at)] }))
        handlers.current.setSelected({ kind: 'wp', id: nid })
        return
      }
      if (moved && last) {
        const p = last
        handlers.current.commit((d) => ({ ...d, waypoints: d.waypoints.map((w) => (w.id === id ? { ...w, p } : w)) }))
      }
      handlers.current.setSelected({ kind: 'wp', id })
    })
    for (const l of ['wp', 'mid']) {
      map.on('mouseenter', l, () => { if (toolRef.current !== 'paradas') map.getCanvas().style.cursor = 'grab' })
      map.on('mouseleave', l, () => { map.getCanvas().style.cursor = '' })
    }
    map.on('contextmenu', 'wp', (e) => {
      e.preventDefault()
      const id = (e.features?.[0].properties as { id: string }).id
      handlers.current.commit((d) => ({ ...d, waypoints: d.waypoints.filter((w) => w.id !== id) }))
    })
    map.on('click', (e) => {
      // En Trazar y Mover, un clic sobre un punto lo selecciona (lo hace el mouseup); en Paradas no estorba.
      if (toolRef.current !== 'paradas' && map.queryRenderedFeatures(e.point, { layers: ['wp', 'mid'].filter((l) => map.getLayer(l)) }).length) return
      const p: LngLat = [e.lngLat.lng, e.lngLat.lat]
      if (toolRef.current === 'trazar') handlers.current.addWaypoint(p)
      else if (toolRef.current === 'paradas') handlers.current.addStop(p)
      else handlers.current.setSelected(null)
    })
    return () => { mapRef.current = null; map.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (mapRef.current) applyBase(mapRef.current, theme) }, [theme])
  useEffect(() => {
    const c = mapRef.current?.getCanvas()
    if (c) c.style.cursor = tool === 'mover' ? '' : 'crosshair'
  }, [tool, mapReady])

  // Dibujo del borrador.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const set = (id: string, features: unknown[]) => (map.getSource(id) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection)
    const { line, split } = built
    const lf = (coords: LngLat[], tramo: Leg) => ({ type: 'Feature', properties: { color: draft.color, tramo }, geometry: { type: 'LineString', coordinates: coords } })
    set('line', line.length < 2 ? [] : split == null ? [lf(line, 'ida')] : [lf(line.slice(split), 'regreso'), lf(line.slice(0, split + 1), 'ida')])
    set('pending', draft.waypoints.slice(1).flatMap((w, i) => {
      const s = segs[i]
      if (s && s.status === 'ok') return []
      return [{ type: 'Feature', properties: { error: s?.status === 'error' }, geometry: { type: 'LineString', coordinates: [draft.waypoints[i].p, w.p] } }]
    }))
    set('mid', draft.waypoints.slice(1).map((w, i) => {
      const s = segs[i]
      const coords = s && s.status === 'ok' ? s.coords : [draft.waypoints[i].p, w.p]
      const half = lineLength(coords) / 2
      let acc = 0, mid = coords[0]
      for (let k = 0; k + 1 < coords.length; k++) {
        const d = dist(coords[k], coords[k + 1])
        if (acc + d >= half) { const t = d ? (half - acc) / d : 0; mid = [coords[k][0] + (coords[k + 1][0] - coords[k][0]) * t, coords[k][1] + (coords[k + 1][1] - coords[k][1]) * t]; break }
        acc += d
      }
      return { type: 'Feature', properties: { id: `m${i}`, i, color: draft.color }, geometry: { type: 'Point', coordinates: mid } }
    }))
    set('wp', draft.waypoints.map((w, i) => ({
      type: 'Feature',
      properties: { id: w.id, i, color: draft.color, sel: selected?.kind === 'wp' && selected.id === w.id, start: i === 0, end: i === draft.waypoints.length - 1 && i > 0 },
      geometry: { type: 'Point', coordinates: w.p },
    })))

    // Paradas: marcadores con su número, arrastrables (se vuelven a pegar al recorrido).
    const seen = new Set<string>()
    built.stopsOn.forEach(({ stop, point, leg }, n) => {
      seen.add(stop.id)
      let m = stopMarkers.current.get(stop.id)
      if (!m) {
        const el = document.createElement('div')
        el.className = 'stop-pin'
        m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' }).setLngLat(point).addTo(map)
        el.addEventListener('click', (ev) => { ev.stopPropagation(); handlers.current.setSelected({ kind: 'stop', id: stop.id }); setTab('paradas') })
        m.on('dragend', () => {
          const ll = m!.getLngLat()
          const b = builtRef.current
          const pr = project(b.line, [ll.lng, ll.lat])
          if (!pr || pr.distance > MAX_STOP_DISTANCE) { toast('La parada debe quedar sobre el recorrido', 'error'); rerender(); return }
          const lg: Leg = b.split != null && pr.index >= b.split ? 'regreso' : 'ida'
          handlers.current.commit((d) => ({ ...d, stops: d.stops.map((s) => (s.id === stop.id ? { ...s, p: round(pr.point), leg: lg } : s)) }))
        })
        stopMarkers.current.set(stop.id, m)
      }
      m.setLngLat(point)
      const el = m.getElement()
      const isDest = draft.destino === stop.id
      el.dataset.sel = String(selected?.kind === 'stop' && selected.id === stop.id)
      el.dataset.leg = leg
      el.style.setProperty('--pin', draft.color)
      el.innerHTML = `<b><span>${isDest ? '⚑' : n + 1}</span></b>${stop.accessible ? '<i title="Accesible">♿</i>' : ''}`
      el.title = `${stop.name}${isDest ? ' · destino (aquí empieza el regreso)' : ''}`
    })
    for (const [id, m] of stopMarkers.current) if (!seen.has(id)) { m.remove(); stopMarkers.current.delete(id) }
  })

  const fit = useCallback(() => {
    const map = mapRef.current
    const pts = built.line.length ? built.line : draft.waypoints.map((w) => w.p)
    if (!map || !pts.length) return
    const b = new maplibregl.LngLatBounds()
    for (const p of pts) b.extend(p)
    map.fitBounds(b, { padding: 60, duration: 500, maxZoom: 15.5 })
  }, [built.line, draft.waypoints])
  useEffect(() => { if (mapReady && initial.waypoints.length) setTimeout(fit, 50) }, [mapReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- revisión y publicación ----------

  const issues: { ok: boolean; text: string }[] = [
    { ok: draft.name.trim().length >= 3, text: 'La ruta tiene nombre' },
    { ok: /^[a-z0-9][a-z0-9-]{1,63}$/.test(draft.id), text: 'Clave válida (minúsculas, números y guiones)' },
    { ok: isEdit || !existingIds.includes(draft.id), text: 'La clave no la usa otra ruta' },
    { ok: draft.waypoints.length >= 2 && built.line.length >= 2, text: 'El recorrido tiene al menos 2 puntos' },
    { ok: built.pending === 0, text: 'Todos los tramos terminaron de calcularse' },
    { ok: built.errors === 0, text: 'Ningún tramo falló al seguir las calles' },
    { ok: draft.stops.length >= 2, text: 'Al menos 2 paradas' },
    { ok: draft.stops.every((s) => s.name.trim() && s.name !== 'Buscando calle…'), text: 'Todas las paradas tienen nombre' },
    { ok: built.stopsOn.every((s) => s.off <= MAX_STOP_DISTANCE), text: 'Todas las paradas quedan sobre el recorrido' },
  ]
  const warnings: string[] = []
  if (!draft.destino) warnings.push('Sin destino: la ruta se mostrará de un solo sentido (sin regreso).')
  const looped = draft.waypoints.length > 2 && dist(draft.waypoints[0].p, draft.waypoints[draft.waypoints.length - 1].p) < 300
  if (draft.destino && !looped) warnings.push('El destino divide ida y regreso solo si el recorrido termina donde empezó (usa «Regreso por el mismo camino» o «Cerrar recorrido»).')
  if (!draft.stops.some((s) => s.accessible)) warnings.push('Ninguna parada está marcada como accesible.')
  const ready = issues.every((i) => i.ok)

  async function publish() {
    setSaving(true)
    try {
      const gj = toGeoJSON(draft, built)
      await adminApi.putRoute(gj)
      try { localStorage.removeItem(storeKey) } catch { /* sin storage */ }
      setDirty(false)
      toast(`Ruta «${draft.name}» publicada: ya la ven las apps`)
      onSaved(draft.id)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setSaving(false); setConfirm(false)
    }
  }
  function exportFile() {
    const blob = new Blob([JSON.stringify(toGeoJSON(draft, built), null, 1)], { type: 'application/geo+json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `${draft.id || 'ruta'}.geojson`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  function close() {
    if (dirty && !window.confirm('Hay cambios sin publicar. Quedan guardados como borrador en este navegador. ¿Salir del editor?')) return
    onClose()
  }

  const selWp = selected?.kind === 'wp' ? draft.waypoints.find((w) => w.id === selected.id) : undefined
  const selWpIndex = selWp ? draft.waypoints.indexOf(selWp) : -1
  const total = built.idaM + built.regM

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col gap-3">
      {/* Barra superior */}
      <div className="neu-card-sm flex flex-wrap items-center gap-2 px-3 py-2">
        <Button variant="ghost" onClick={close} title="Volver a la lista de rutas">← Rutas</Button>
        <div className="mr-2 min-w-0">
          <div className="truncate text-sm font-semibold text-slate-700">
            {start.kind === 'edit' ? 'Editar' : start.kind === 'copy' ? 'Duplicar' : 'Nueva ruta'}{draft.name ? ` · ${draft.name}` : ''}
          </div>
          <div className="text-[11px] text-slate-500">{dirty ? 'Cambios sin publicar · borrador guardado en este navegador' : 'Sin cambios'}</div>
        </div>
        <Segmented value={tool} onChange={setTool} options={[
          { v: 'trazar', label: 'Trazar', hint: 'Clic en el mapa para agregar puntos del recorrido (tecla 1)', icon: 'M3 17l6-6 4 4 8-8M14 7h7v7' },
          { v: 'paradas', label: 'Paradas', hint: 'Clic sobre el recorrido para poner una parada (tecla 2)', icon: 'M12 21s-7-6.3-7-11a7 7 0 1 1 14 0c0 4.7-7 11-7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' },
          { v: 'mover', label: 'Mover', hint: 'Arrastra puntos y paradas; mueve el mapa (tecla 3)', icon: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20' },
        ]} />
        <label className="neu-btn flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-600" title="Cada tramo nuevo sigue las calles; apágalo para trazar en línea recta (terracerías, calles que no están en el mapa)">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="accent-[var(--accent)]" />
          Seguir calles
        </label>
        <div className="flex gap-1">
          <Button onClick={undo} disabled={!past.length} title="Deshacer (Ctrl+Z)">↶</Button>
          <Button onClick={redo} disabled={!future.length} title="Rehacer (Ctrl+Y)">↷</Button>
        </div>
        <Menu label="Recorrido" items={[
          { label: 'Regreso por el mismo camino', hint: 'Agrega la vuelta en sentido contrario', onClick: sameWayBack, disabled: draft.waypoints.length < 2 },
          { label: 'Cerrar recorrido (volver al inicio)', hint: 'Une el último punto con el primero', onClick: closeLoop, disabled: draft.waypoints.length < 2 },
          { label: 'Ajustar la vista al recorrido', onClick: fit, disabled: !draft.waypoints.length },
          { label: 'Exportar GeoJSON', onClick: exportFile, disabled: built.line.length < 2 },
          { label: 'Borrar todo el trazo', danger: true, disabled: !draft.waypoints.length,
            onClick: () => { if (window.confirm('¿Borrar todos los puntos y paradas?')) commit((d) => ({ ...d, waypoints: [], stops: [], destino: null })) } },
        ]} />
        <div className="w-44"><Select className="py-1.5" value="" onChange={(e) => {
          const m = MUNICIPIOS.find((x) => x.name === e.target.value)
          if (m) mapRef.current?.flyTo({ center: m.center, zoom: m.zoom })
        }}>
          <option value="" disabled>Ir a municipio…</option>
          {MUNICIPIOS.map((m) => <option key={m.name}>{m.name}</option>)}
        </Select></div>
        <Button variant="blue" className="ml-auto" onClick={() => { setTab('revisar'); setConfirm(true) }} disabled={saving}>Publicar ruta</Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_380px]">
        {/* Mapa */}
        <div className="relative min-h-[420px] overflow-hidden rounded-[18px] border border-slate-300/50">
          {/* MapLibre le pone position: relative al contenedor: el absoluto va en una capa aparte. */}
          <div className="absolute inset-0"><div ref={mapEl} className="h-full w-full" /></div>
          {draft.waypoints.length === 0 && (
            <div className="neu-card pointer-events-auto absolute left-1/2 top-6 w-[min(92%,460px)] -translate-x-1/2 p-4 text-sm text-slate-600">
              <div className="mb-2 font-semibold text-slate-700">Cómo trazar una ruta</div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Con <b>Trazar</b>, haz clic donde empieza (por ejemplo, el DIF Estatal).</li>
                <li>Sigue haciendo clic en las esquinas por donde pasa: el trazo <b>sigue las calles solo</b>.</li>
                <li>Arrastra cualquier punto para corregir, o los puntitos de en medio para meter una vuelta.</li>
                <li>Con <b>Paradas</b>, toca el recorrido donde se sube la gente; el nombre de la calle se pone solo.</li>
                <li>Marca la parada <b>destino</b> (donde termina la ida) y publica.</li>
              </ol>
              {landmarks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="text-xs text-slate-500">Empezar en:</span>
                  {landmarks.slice(0, 4).map((l) => (
                    <button key={l.name} className="neu-btn px-2.5 py-1 text-xs text-[var(--accent-ink)]"
                      onClick={() => { addWaypoint(l.p); mapRef.current?.flyTo({ center: l.p, zoom: 15 }) }}>{l.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Punto seleccionado */}
          {selWp && (
            <div className="neu-card-sm absolute left-3 top-3 flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Punto {selWpIndex + 1}{selWpIndex === 0 ? ' · inicio' : ''}</span>
              {selWpIndex > 0 && (
                <button className="neu-btn px-2 py-1" onClick={() => toggleFree(selWp.id)} title="Cómo llega el trazo a este punto">
                  Tramo anterior: {selWp.free ? 'recto' : 'por calles'}
                </button>
              )}
              <button className="neu-btn px-2 py-1 text-rose-500" onClick={removeSelected}>Quitar punto (Supr)</button>
            </div>
          )}
          {/* Avisos de tramos */}
          {(built.pending > 0 || built.errors > 0) && (
            <div className="neu-card-sm absolute right-3 top-3 flex items-center gap-2 px-3 py-2 text-xs">
              {built.pending > 0 && <span className="text-slate-500"><Spinner /> Siguiendo calles… ({built.pending})</span>}
              {built.errors > 0 && (
                <>
                  <span className="text-rose-500">{built.errors} tramo(s) sin camino por calles</span>
                  <button className="neu-btn px-2 py-1" onClick={retryErrors}>Reintentar</button>
                  <button className="neu-btn px-2 py-1" onClick={straightenErrors}>Dejar recto</button>
                </>
              )}
            </div>
          )}
          {/* Resumen */}
          {built.line.length >= 2 && (
            <div className="neu-card-sm absolute bottom-9 left-3 flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs text-slate-600">
              <Stat label="Ida" value={`${fmtKm(built.idaM)} · ≈${fmtMin(built.idaS)}`} color={draft.color} />
              {built.split != null && <Stat label="Regreso" value={`${fmtKm(built.regM)} · ≈${fmtMin(built.regS)}`} color={draft.color} faded />}
              <Stat label="Total" value={fmtKm(total)} />
              <Stat label="Puntos" value={String(draft.waypoints.length)} />
              <Stat label="Paradas" value={String(draft.stops.length)} />
            </div>
          )}
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-800/70 px-3 py-1 text-[11px] text-white">
            {tool === 'trazar' ? 'Clic: agregar punto · arrastrar: mover · clic derecho: quitar' : tool === 'paradas' ? 'Clic sobre el recorrido: nueva parada · arrastra una parada para moverla' : 'Arrastra puntos y paradas · Supr quita lo seleccionado'}
          </div>
        </div>

        {/* Panel lateral */}
        <div className="neu-card flex min-h-0 flex-col p-4">
          <div className="mb-3 flex gap-1.5">
            {([['datos', 'Datos'], ['paradas', `Paradas (${draft.stops.length})`], ['revisar', 'Revisar']] as const).map(([v, l]) => (
              <button key={v} data-on={tab === v} onClick={() => setTab(v)}
                className={`neu-btn flex-1 px-2 py-1.5 text-xs font-medium ${tab === v ? 'text-[var(--accent-ink)]' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {tab === 'datos' && (
              <div className="flex flex-col gap-3">
                <Field label="Nombre (como lo ve el pasajero)">
                  <Input value={draft.name} maxLength={120} placeholder="Ruta 6 - Las Flores"
                    onChange={(e) => { const name = e.target.value; setDraft((d) => ({ ...d, name, id: idTouched ? d.id : slug(name) })); setDirty(true) }}
                    onFocus={beginEdit} onBlur={endEdit} />
                </Field>
                <Field label="Clave (no cambia después de publicar)">
                  <Input value={draft.id} disabled={isEdit} maxLength={64} placeholder="ruta-6-las-flores"
                    onChange={(e) => { setIdTouched(true); setDraft((d) => ({ ...d, id: slug(e.target.value) })); setDirty(true) }} />
                </Field>
                <Field label="Color en los mapas">
                  <div className="flex flex-wrap items-center gap-2">
                    {DIF_COLORS.map((c) => (
                      <button key={c.hex} title={c.name} onClick={() => commit((d) => ({ ...d, color: c.hex }))}
                        className={`h-8 w-8 rounded-full border-2 transition ${draft.color.toUpperCase() === c.hex ? 'scale-110 border-slate-700' : 'border-white/70'}`}
                        style={{ background: c.hex }} />
                    ))}
                    <label className="neu-btn flex h-8 cursor-pointer items-center gap-1.5 px-2 text-xs text-slate-500" title="Otro color">
                      <input type="color" value={draft.color} onChange={(e) => commit((d) => ({ ...d, color: e.target.value.toUpperCase() }))} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" />
                      Otro
                    </label>
                  </div>
                </Field>
                <Field label="Destino (donde termina la ida y empieza el regreso)">
                  <Select value={draft.destino ?? ''} onChange={(e) => commit((d) => ({ ...d, destino: e.target.value || null }))}>
                    <option value="">Sin destino (un solo sentido)</option>
                    {built.stopsOn.map(({ stop }, i) => <option key={stop.id} value={stop.id}>{i + 1}. {stop.name}</option>)}
                  </Select>
                </Field>
                <div className="rounded-xl bg-[var(--bg-sunk)] p-3 text-xs leading-relaxed text-slate-500">
                  El municipio se detecta solo con la ubicación de las paradas. Las apps reciben la ruta en cuanto se publica.
                  {isEdit && ' Las paradas que ya existían conservan su clave, así no se pierden sus solicitudes de rampa ni reportes.'}
                </div>
              </div>
            )}

            {tab === 'paradas' && (
              <div className="flex flex-col gap-2">
                {draft.stops.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Elige <b>Paradas</b> arriba y toca el recorrido para agregar la primera.</p>}
                {(['ida', 'regreso'] as const).map((leg) => {
                  const list = built.stopsOn.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.leg === leg)
                  if (!list.length) return null
                  return (
                    <div key={leg}>
                      {built.split != null && <div className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{leg === 'ida' ? 'Ida' : 'Regreso'}</div>}
                      {list.map(({ stop, n, off }) => {
                        const sel = selected?.kind === 'stop' && selected.id === stop.id
                        return (
                          <div key={stop.id} onClick={() => { setSelected({ kind: 'stop', id: stop.id }); mapRef.current?.flyTo({ center: stop.p, zoom: Math.max(mapRef.current.getZoom(), 15) }) }}
                            className={`mb-1.5 rounded-xl border p-2 transition ${sel ? 'border-[var(--accent)] bg-[var(--color-sky-100)]' : 'border-slate-300/50 hover:bg-slate-500/5'}`}>
                            <div className="flex items-center gap-2">
                              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: draft.color, opacity: leg === 'regreso' ? 0.7 : 1 }}>
                                {draft.destino === stop.id ? '⚑' : n}
                              </span>
                              <input value={stop.name} onChange={(e) => setDraft((d) => ({ ...d, stops: d.stops.map((s) => (s.id === stop.id ? { ...s, name: e.target.value } : s)) }))}
                                onFocus={beginEdit} onBlur={endEdit}
                                className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm text-slate-700 outline-none focus:bg-[var(--bg-sunk)]" />
                            </div>
                            {sel && (
                              <div className="mt-2 flex flex-col gap-2 pl-8 text-xs" onClick={(e) => e.stopPropagation()}>
                                <div className="flex flex-wrap gap-1.5">
                                  <Chip on={stop.accessible} onClick={() => updateStop(stop.id, { accessible: !stop.accessible })}>♿ {stop.accessible ? 'Accesible' : 'Sin rampa'}</Chip>
                                  <Chip on={draft.destino === stop.id} onClick={() => commit((d) => ({ ...d, destino: d.destino === stop.id ? null : stop.id }))}>⚑ Destino</Chip>
                                  {built.split != null && draft.destino !== stop.id && (
                                    <Chip on={false} onClick={() => updateStop(stop.id, { leg: stop.leg === 'ida' ? 'regreso' : 'ida' })}>Pasar a {stop.leg === 'ida' ? 'regreso' : 'ida'}</Chip>
                                  )}
                                  <Chip on={false} danger onClick={() => { commit((d) => ({ ...d, stops: d.stops.filter((s) => s.id !== stop.id), destino: d.destino === stop.id ? null : d.destino })); setSelected(null) }}>Quitar</Chip>
                                </div>
                                <label className="flex flex-col gap-1 text-slate-500">
                                  Horarios (opcional, separados por coma)
                                  <input defaultValue={stop.horarios.join(', ')} placeholder="07:30, 09:00, 13:15"
                                    onBlur={(e) => {
                                      const hs = e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
                                      const bad = hs.filter((h) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(h))
                                      if (bad.length) { toast(`Horario inválido: ${bad.join(', ')} (usa HH:MM)`, 'error'); return }
                                      updateStop(stop.id, { horarios: hs.map((h) => h.padStart(5, '0')) })
                                    }}
                                    className="neu-inset px-2 py-1.5 text-xs text-slate-700 outline-none" />
                                </label>
                                {off > 40 && <span className="text-amber-700">Queda a {Math.round(off)} m del recorrido; se pegará a él al publicar.</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
                {landmarks.length > 0 && built.line.length >= 2 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-500">Agregar parada:</span>
                    {landmarks.map((l) => (
                      <button key={l.name} className="neu-btn px-2 py-1 text-[var(--accent-ink)]" onClick={() => addStop(l.p, l.name)}>{l.name}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'revisar' && (
              <div className="flex flex-col gap-3 text-sm">
                <ul className="flex flex-col gap-1.5">
                  {issues.map((i) => (
                    <li key={i.text} className={`flex items-start gap-2 ${i.ok ? 'text-slate-600' : 'text-rose-500'}`}>
                      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] text-white ${i.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}>{i.ok ? '✓' : '!'}</span>{i.text}
                    </li>
                  ))}
                </ul>
                {warnings.map((w) => <p key={w} className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-700">{w}</p>)}
                <Button variant="blue" disabled={!ready || saving} onClick={() => setConfirm(true)} className="py-2.5">Publicar ruta</Button>
                <Button onClick={exportFile} disabled={built.line.length < 2}>Descargar GeoJSON</Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {restore && (
        <Modal title="Tienes un borrador sin publicar" onClose={() => setRestore(null)}>
          <p className="text-sm text-slate-600">De {new Date(restore.at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}: {restore.draft.name || 'sin nombre'}, {restore.draft.waypoints.length} puntos y {restore.draft.stops.length} paradas.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => { try { localStorage.removeItem(storeKey) } catch { /* */ } setRestore(null) }}>Descartar</Button>
            <Button variant="blue" onClick={() => { commit(restore.draft); setRestore(null); setTimeout(fit, 100) }}>Continuar borrador</Button>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title={ready ? `Publicar «${draft.name}»` : 'Falta algo antes de publicar'} onClose={() => setConfirm(false)}>
          {ready ? (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Dd k="Clave" v={draft.id} /><Dd k="Recorrido" v={`${fmtKm(total)}${built.split != null ? ` (ida ${fmtKm(built.idaM)})` : ''}`} />
                <Dd k="Paradas" v={`${draft.stops.length} · ${draft.stops.filter((s) => s.accessible).length} accesibles`} />
                <Dd k="Destino" v={draft.stops.find((s) => s.id === draft.destino)?.name ?? 'Sin destino'} />
              </dl>
              {warnings.map((w) => <p key={w} className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-700">{w}</p>)}
              <p className="mt-3 text-xs text-slate-500">Se publica al instante en la app de pasajeros y de choferes{isEdit ? ', reemplazando el trazo actual' : ''}.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button onClick={() => setConfirm(false)}>Seguir editando</Button>
                <Button variant="blue" disabled={saving} onClick={publish}>{saving ? 'Publicando…' : 'Publicar'}</Button>
              </div>
            </>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5 text-sm">
                {issues.filter((i) => !i.ok).map((i) => <li key={i.text} className="text-rose-500">• {i.text}</li>)}
              </ul>
              <div className="mt-4 flex justify-end"><Button onClick={() => setConfirm(false)}>Entendido</Button></div>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

// ---------- piezas ----------

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string; hint: string; icon: string }[] }) {
  return (
    <div className="neu-inset flex gap-1 p-1">
      {options.map((o) => (
        <button key={o.v} title={o.hint} onClick={() => onChange(o.v)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === o.v ? 'bg-[var(--accent)] text-white shadow' : 'text-slate-500 hover:text-[var(--accent-ink)]'}`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={o.icon} /></svg>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Menu({ label, items }: { label: string; items: { label: string; hint?: string; onClick: () => void; disabled?: boolean; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen((o) => !o)}>{label} ▾</Button>
      {open && (
        <div className="neu-card absolute left-0 top-full z-20 mt-2 w-72 p-1.5">
          {items.map((i) => (
            <button key={i.label} disabled={i.disabled} onClick={() => { setOpen(false); i.onClick() }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-500/10 disabled:opacity-40 ${i.danger ? 'text-rose-500' : 'text-slate-600'}`}>
              {i.label}
              {i.hint && <span className="block text-[11px] text-slate-400">{i.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({ on, danger, onClick, children }: { on: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-2.5 py-1 font-medium transition ${danger ? 'bg-rose-100 text-rose-600' : on ? 'bg-[var(--accent)] text-white' : 'bg-slate-500/10 text-slate-600 hover:bg-slate-500/15'}`}>
      {children}
    </button>
  )
}

function Stat({ label, value, color, faded }: { label: string; value: string; color?: string; faded?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {color && <span className="h-1.5 w-4 rounded-full" style={{ background: color, opacity: faded ? 0.55 : 1 }} />}
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold tabular-nums text-slate-700">{value}</span>
    </span>
  )
}

function Dd({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-xs text-slate-400">{k}</dt><dd className="font-medium text-slate-700">{v}</dd></div>
}

function Spinner() {
  return <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent align-[-2px]" />
}
