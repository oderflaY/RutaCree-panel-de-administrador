import type maplibregl from 'maplibre-gl'
// Acceso al backend de RutaCree. En desarrollo Vite reenvía /api al servidor (ver vite.config.ts).

export type Route = {
  id: string
  name: string
  color: string
  line: [number, number][] // [lng, lat]
  /** Municipios que atiende (los calcula el servidor; vacío en servidores viejos). */
  municipios: string[]
  /** Índice de `line` donde empieza el regreso; null si la ruta es de un solo sentido. */
  regresoDesde: number | null
  stops: { id: string; name: string; lng: number; lat: number; accessible: boolean }[]
}

type Feature = {
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown }
}

// En el panel cada ruta conserva su color: la ida va con el color lleno y el regreso
// con el mismo color desvanecido, para distinguir los sentidos sin perder de qué ruta es.
export const REGRESO_OPACITY = 0.4

/** municipios y regreso_desde del LineString de una ruta. */
export function routeExtras(p: Record<string, unknown>, points: number) {
  const municipios = Array.isArray(p.municipios) ? p.municipios.map(String) : []
  const i = typeof p.regreso_desde === 'number' ? p.regreso_desde : null
  return { municipios, regresoDesde: i != null && i > 0 && i < points - 1 ? i : null }
}

/** La ruta en dos tramos: ida hasta el destino y regreso desde ahí. */
export function legs(line: [number, number][], regresoDesde: number | null) {
  if (regresoDesde == null) return { ida: line, regreso: [] as [number, number][] }
  return { ida: line.slice(0, regresoDesde + 1), regreso: line.slice(regresoDesde) }
}

/** Los tramos de la ruta como features con su color y sentido (`tramo`: 'ida' | 'regreso'). */
export function legFeatures(r: { color: string; line: [number, number][]; regresoDesde: number | null }) {
  const { ida, regreso } = legs(r.line, r.regresoDesde)
  const f = (coordinates: [number, number][], tramo: 'ida' | 'regreso') => ({
    type: 'Feature' as const,
    properties: { color: r.color, tramo },
    geometry: { type: 'LineString' as const, coordinates },
  })
  return regreso.length ? [f(regreso, 'regreso'), f(ida, 'ida')] : [f(ida, 'ida')]
}

/** Opacidad por sentido para `line-opacity` de MapLibre: el regreso, más tenue. */
export const legOpacity = (ida: number) =>
  ['case', ['==', ['get', 'tramo'], 'regreso'], ida * REGRESO_OPACITY, ida] as maplibregl.ExpressionSpecification

/** Una ruta sin municipios conocidos se muestra en todos. */
export const serves = (r: { municipios: string[] }, municipio: string) =>
  municipio === '' || r.municipios.length === 0 || r.municipios.includes(municipio)

// GET /api/v1/routes → { routes: [FeatureCollection, ...] }. Cada ruta trae un LineString (con
// id/name/color) y Points (paradas). Lo convertimos a algo cómodo para dibujar.
export async function fetchRoutes(): Promise<Route[]> {
  const res = await fetch('/api/v1/routes')
  if (!res.ok) throw new Error(`rutas: HTTP ${res.status}`)
  const body = (await res.json()) as { routes: { features: Feature[] }[] }
  const out: Route[] = []
  for (const fc of body.routes ?? []) {
    const r: Route = { id: '', name: '', color: '#2F5DA8', line: [], municipios: [], regresoDesde: null, stops: [] }
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {}
      if (f.geometry.type === 'LineString') {
        r.id = String(p.id ?? '')
        r.name = String(p.name ?? r.id)
        if (typeof p.color === 'string') r.color = p.color
        r.line = f.geometry.coordinates as [number, number][]
        Object.assign(r, routeExtras(p, r.line.length))
      } else if (f.geometry.type === 'Point') {
        const c = f.geometry.coordinates as [number, number]
        r.stops.push({
          id: String(p.id ?? ''),
          name: String(p.name ?? ''),
          lng: c[0],
          lat: c[1],
          accessible: Boolean(p.accessible),
        })
      }
    }
    if (r.id && r.line.length >= 2) out.push(r)
  }
  return out
}

// Mensajes del WebSocket /api/socket (mismo formato que consume la app).
export type WsMessage = {
  devices?: { id: number; name: string; attributes?: { ruta?: string; rampa?: boolean } }[]
  positions?: { deviceId: number; latitude: number; longitude: number; speed?: number; fixTime?: string }[]
}
