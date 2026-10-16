// Cliente REST del backend admin. Guarda el token en localStorage y avisa al perder la sesión.
import type {
  ActiveShift, Assignment, AuditEntry, Bus, Card, Driver, Incident,
  FormKind, FormValues, Stats, FormView, MaintenanceOrder, Report, Rider, RidersResponse, ServiceItem, Session, Trip, User, VehicleReport,
} from './types'

const TOKEN_KEY = 'rutacree.token'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function setToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* sin storage */ }
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onSessionLost = () => {}
export function setOnSessionLost(fn: () => void) { onSessionLost = fn }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  let r: Response
  try {
    // no-cache: el panel siempre revalida (con ETag) y ve al instante lo que acaba de publicar.
    r = await fetch(path, { method, headers, cache: 'no-cache', body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'red', 'No hay conexión con el servidor.')
  }
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
    if (r.status === 401 && path !== '/api/v1/admin/login') onSessionLost()
    throw new ApiError(r.status, e.error ?? 'http', e.message ?? `Error ${r.status} del servidor`)
  }
  return (r.status === 204 ? undefined : await r.json()) as T
}

// Descarga un archivo (los formatos en Excel) con la sesión del panel y lo guarda con su nombre.
async function download(path: string, fallbackName: string): Promise<void> {
  const token = getToken()
  let r: Response
  try {
    r = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new ApiError(0, 'red', 'No hay conexión con el servidor.')
  }
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
    if (r.status === 401) onSessionLost()
    throw new ApiError(r.status, e.error ?? 'http', e.message ?? `Error ${r.status} del servidor`)
  }
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const roleName: Record<Session['role'], string> = {
  superadmin: 'SuperAdmin',
  dispatcher: 'Despachador',
  mechanic: 'Mecánico',
}
export const roleLabel = (r: Session['role']) => roleName[r]

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
const folio = (p: string, id: number) => `${p}-${String(id).padStart(4, '0')}`

const REPORT_TITLES: Record<string, string> = {
  ramp_broken: 'La rampa no funciona',
  did_not_stop: 'El camión no se detuvo en la parada',
  bus_full: 'Camión lleno',
  stop_blocked: 'Parada bloqueada',
}
const INCIDENT_TITLES: Record<string, string> = {
  accident: 'Accidente reportado por el chofer',
  breakdown: 'Unidad descompuesta',
  ramp_failure: 'Falla de rampa reportada por el chofer',
}
const REPORT_COL: Record<Report['status'], Card['column']> = {
  open: 'nuevo', in_review: 'revision', reviewed: 'cerrado', dismissed: 'cerrado',
}
const INCIDENT_COL: Record<Incident['status'], Card['column']> = {
  open: 'nuevo', in_review: 'revision', resolved: 'cerrado',
}
export const COL_TO_REPORT: Record<Card['column'], Report['status']> = { nuevo: 'open', revision: 'in_review', cerrado: 'reviewed' }
export const COL_TO_INCIDENT: Record<Card['column'], Incident['status']> = { nuevo: 'open', revision: 'in_review', cerrado: 'resolved' }

function reportCard(r: Report): Card {
  const parts = [`Reporte anónimo de pasajero, ${hhmm(r.createdAt)} hrs.`]
  if (r.busNumber) {
    parts.push(r.speedKmh != null
      ? `Según el GPS, la Unidad ${r.busNumber} iba a ${Math.round(r.speedKmh)} km/h.`
      : `Unidad ${r.busNumber}; sin posición GPS a esa hora.`)
  } else parts.push('El pasajero no indicó la unidad.')
  if (r.driverName) parts.push(`Chofer: ${r.driverName}.`)
  if (r.routeId) parts.push(`Ruta: ${r.routeId}.`)
  if (r.comment) parts.push(`Comentario: “${r.comment}”`)
  return {
    id: `r${r.id}`, isIncident: false, folio: folio('QJA', r.id), severity: 'menor',
    title: REPORT_TITLES[r.type] ?? r.type, who: 'Pasajero (anónimo)', at: r.createdAt,
    detail: parts.join(' '), column: REPORT_COL[r.status], resolution: r.resolution,
  }
}
function incidentCard(i: Incident): Card {
  const place = i.lat != null ? ` Última posición: ${i.lat.toFixed(5)}, ${i.lon!.toFixed(5)}.` : ' Sin posición GPS en la alarma.'
  const ramp = i.type === 'ramp_failure'
  const outcome = ramp ? 'la unidad sigue en ruta y quedó marcada con rampa dañada' : 'su turno se cerró'
  return {
    id: `i${i.id}`, isIncident: true, folio: folio('INC', i.id), severity: 'emergencia',
    title: INCIDENT_TITLES[i.type] ?? i.type, who: `${ramp ? 'Reporte' : 'Botón de pánico'} (${i.driverName})`, at: i.createdAt,
    detail: `Alarma a las ${hhmm(i.createdAt)} en ${i.routeId}. Unidad ${i.busNumber}, chofer ${i.driverName} (${i.driverId}); ${outcome}.${place}`,
    column: INCIDENT_COL[i.status], resolution: i.resolution,
  }
}

export const adminApi = {
  async login(email: string, password: string): Promise<Session> {
    const r = await req<{ token: string; account: Session }>('POST', '/api/v1/admin/login', { email, password })
    setToken(r.token)
    return r.account
  },
  logout: () => setToken(null),
  me: () => req<Session>('GET', '/api/v1/admin/me'),

  buses: () => req<Bus[]>('GET', '/api/v1/admin/buses'),
  drivers: () => req<Driver[]>('GET', '/api/v1/admin/drivers'),
  assignments: () => req<Assignment[]>('GET', '/api/v1/admin/assignments'),
  activeShifts: () => req<ActiveShift[]>('GET', '/api/v1/admin/shifts/active'),
  // Rutas iniciadas en [from, to); las fechas viajan en UTC.
  trips: (from: Date, to: Date) =>
    req<Trip[]>('GET', `/api/v1/admin/shifts?limit=500&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  users: () => req<User[]>('GET', '/api/v1/admin/users'),
  audit: () => req<AuditEntry[]>('GET', '/api/v1/admin/audit?limit=200'),
  maintenance: () => req<MaintenanceOrder[]>('GET', '/api/v1/admin/maintenance?limit=300'),

  async board(): Promise<Card[]> {
    const [reports, incidents] = await Promise.all([
      req<Report[]>('GET', '/api/v1/admin/reports?status=all&limit=300'),
      req<Incident[]>('GET', '/api/v1/admin/incidents?limit=300'),
    ])
    return [...incidents.map(incidentCard), ...reports.map(reportCard)]
  },
  async setCard(id: string, patch: { column?: Card['column']; resolution?: string }): Promise<Card> {
    const isIncident = id[0] === 'i'
    const path = `/api/v1/admin/${isIncident ? 'incidents' : 'reports'}/${id.slice(1)}`
    const body: Record<string, unknown> = {}
    if (patch.column) body.status = (isIncident ? COL_TO_INCIDENT : COL_TO_REPORT)[patch.column]
    if (patch.resolution !== undefined) body.resolution = patch.resolution
    const r = await req<Report & Incident>('PATCH', path, body)
    return isIncident ? incidentCard(r) : reportCard(r)
  },

  createAssignment: (t: { date: string; driverId: string; busId: number; routeId: string }) =>
    req<Assignment>('POST', '/api/v1/admin/assignments', t),
  deleteAssignment: (id: number) => req<void>('DELETE', `/api/v1/admin/assignments/${id}`),

  createBus: (b: { number: string; plates: string; brand: string; model: string } & Partial<FleetFields>) => req<Bus>('POST', '/api/v1/admin/buses', b),
  patchBus: (id: number, body: Partial<{ status: BusStatusApi; plates: string; brand: string; model: string; lastMaintenance: string } & FleetFields>) =>
    req<Bus>('PATCH', `/api/v1/admin/buses/${id}`, body),
  // Excel del parque vehicular del DIF; retireOthers da de baja las unidades que no vienen en él.
  importBuses: (file: File, retireOthers: boolean) => {
    const fd = new FormData()
    fd.append('file', file)
    if (retireOthers) fd.append('retireOthers', '1')
    return req<{ created: string[] | null; updated: string[] | null; retired: string[] | null }>('POST', '/api/v1/admin/buses/import', fd)
  },

  createDriver: (d: { id: string; name: string; email: string; phone: string; password: string }) =>
    req<Driver>('POST', '/api/v1/admin/drivers', d),
  patchDriver: (id: string, body: Partial<{ name: string; email: string; phone: string; active: boolean; password: string }>) =>
    req<Driver>('PATCH', `/api/v1/admin/drivers/${encodeURIComponent(id)}`, body),

  riders: (q = '') => req<RidersResponse>('GET', `/api/v1/admin/riders?limit=200&q=${encodeURIComponent(q)}`),
  patchRider: (id: number, body: Partial<{ active: boolean; unlock: boolean; password: string }>) =>
    req<Rider>('PATCH', `/api/v1/admin/riders/${id}`, body),
  deleteRider: (id: number) => req<void>('DELETE', `/api/v1/admin/riders/${id}`),

  openMaintenance: (o: { busId: number; kind: string; description: string } & Partial<ServiceFields>) =>
    req<MaintenanceOrder>('POST', '/api/v1/admin/maintenance', o),
  patchMaintenance: (id: number, body: Partial<{ notes: string; close: boolean; date: string } & ServiceFields>) =>
    req<MaintenanceOrder>('PATCH', `/api/v1/admin/maintenance/${id}`, body),

  // Formatos del DIF: se ven y se llenan en el panel igual que en Excel, y se descargan en Excel.
  form: (kind: FormKind, ref: string) => req<FormView>('GET', `/api/v1/admin/formatos/${kind}/${encodeURIComponent(ref)}`),
  saveForm: (kind: FormKind, ref: string, values: FormValues) =>
    req<FormView>('PUT', `/api/v1/admin/formatos/${kind}/${encodeURIComponent(ref)}`, { values }),
  downloadForm: (kind: FormKind, ref: string) =>
    download(`/api/v1/admin/formatos/${kind}/${encodeURIComponent(ref)}/xlsx`, `${kind}-${ref}.xlsx`),
  // Formatos del DIF en Excel.
  downloadOrden: (id: number) => download(`/api/v1/admin/maintenance/${id}/orden`, `orden-servicio-${id}.xlsx`),
  downloadBitacora: (day: string) => download(`/api/v1/admin/formatos/bitacora?semana=${day}`, `bitacora-${day}.xlsx`),
  vehicleReports: () => req<VehicleReport[]>('GET', '/api/v1/admin/vehicle-reports?limit=200'),
  createVehicleReport: (v: { busId: number; day: string; observations: string }) =>
    req<VehicleReport>('POST', '/api/v1/admin/vehicle-reports', v),
  stats: (desde: string, hasta: string) =>
    req<Stats>('GET', `/api/v1/admin/estadisticas?desde=${desde}&hasta=${hasta}`),
  downloadStats: (desde: string, hasta: string) =>
    download(`/api/v1/admin/estadisticas/xlsx?desde=${desde}&hasta=${hasta}`, `estadisticas-${desde}-al-${hasta}.xlsx`),
  downloadVehicleReport: (id: number) => download(`/api/v1/admin/vehicle-reports/${id}/xlsx`, `reporte-vehiculo-${id}.xlsx`),

  createUser: (u: { name: string; username: string; email: string; role: string; password: string }) =>
    req<User>('POST', '/api/v1/admin/users', u),
  patchUser: (id: number, body: Partial<{ name: string; email: string; role: string; active: boolean; password: string }>) =>
    req<User>('PATCH', `/api/v1/admin/users/${id}`, body),

  deleteRoute: (id: string) => req<void>('DELETE', `/api/v1/admin/routes/${encodeURIComponent(id)}`),
  putRoute: (geojson: unknown) => req<{ id: string; stops: number }>('PUT', '/api/v1/admin/routes', geojson),
  // Editor de rutas: camino por las calles entre puntos y nombre de la calle bajo una parada.
  routePath: (points: [number, number][]) =>
    req<{ coordinates: [number, number][]; distance: number; duration: number }>('GET',
      `/api/v1/admin/routing/route?points=${encodeURIComponent(points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';'))}`),
  streetName: (p: [number, number]) =>
    req<{ name: string; cross?: string; lon: number; lat: number }>('GET',
      `/api/v1/admin/routing/street?point=${encodeURIComponent(`${p[0].toFixed(6)},${p[1].toFixed(6)}`)}`),
  rawRoutes: () => req<{ routes: RawRoute[] }>('GET', '/api/v1/routes').then((r) => r.routes),
}

// GeoJSON crudo de una ruta (tal cual lo guarda el backend), para editarlo sin perder nada.
export type RawRoute = { type: 'FeatureCollection'; features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] }

type BusStatusApi = 'active' | 'workshop' | 'ramp_broken' | 'retired'
type FleetFields = { serial: string; year: number; unitNo: string; centro: string }
type ServiceFields = { km: number | null; partida: string; recurso: string; execution: string; items: ServiceItem[] }
