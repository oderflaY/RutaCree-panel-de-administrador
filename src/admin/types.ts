// Tipos del panel admin, cercanos al JSON del backend en Go (ids numéricos, inglés).

export type Role = 'superadmin' | 'dispatcher' | 'mechanic'
export type Session = { id: number; name: string; username: string; email: string; role: Role }
export type User = Session & { active: boolean; locked: boolean }

export type Driver = {
  id: string
  name: string
  email: string
  phone: string
  active: boolean
  canLogin: boolean
  locked: boolean
}

export type BusStatus = 'active' | 'workshop' | 'ramp_broken' | 'retired'
export type Bus = {
  id: number
  number: string
  plates: string
  brand: string
  model: string
  serial: string
  year: number | null
  unitNo: string // No. de camión pintado en la unidad
  centro: string // CREE DURANGO, CREE GOMEZ PALACIO, …
  lastMaintenance: string | null
  status: BusStatus
}

export type Assignment = { id: number; date: string; driverId: string; busId: number; routeId: string }

export type ActiveShift = {
  shiftId: number
  driverId: string
  busId: number
  busNumber: string
  routeId: string
  rampOperational: boolean
  lat?: number
  lon?: number
  speedKmh?: number
  lastFix?: string
}

// Una ruta realizada (turno del chofer): inicio, fin y pasajeros que contó al iniciar.
export type Trip = {
  shiftId: number
  driverId: string
  driverName: string
  busNumber: string
  routeId: string
  startedAt: string
  endedAt: string | null
  endReason: 'completed' | 'emergency' | 'expired' | 'replaced' | 'withdrawn' | null
  finalLocation: 'terminal' | 'workshop' | 'depot' | null
  // Usuarios de la vuelta, con las categorías de la bitácora del DIF.
  men: number | null
  women: number | null
  disability: number | null
  elderly: number | null
  pregnant: number | null
  companions: number | null
  // Solo viajes registrados con apps anteriores.
  children: number | null
  adults: number | null
}

export type Report = {
  id: number
  type: string
  status: 'open' | 'in_review' | 'reviewed' | 'dismissed'
  createdAt: string
  busId: number | null
  busNumber?: string
  speedKmh?: number | null
  driverName?: string
  routeId?: string
  comment?: string
  resolution?: string
}

export type Incident = {
  id: number
  type: string
  status: 'open' | 'in_review' | 'resolved'
  createdAt: string
  busId: number
  busNumber: string
  driverName: string
  driverId: string
  routeId: string
  lat?: number | null
  lon?: number | null
  resolution?: string
}

export type Rider = {
  id: number
  name: string
  email: string
  userType: string
  wheelchair: boolean
  lowVision: boolean
  reducedMobility: boolean
  active: boolean
  locked: boolean
  createdAt: string
}
export type RidersResponse = {
  total: number
  wheelchair: number
  lowVision: number
  reducedMobility: number
  suspended: number
  riders: Rider[]
}

export type MaintenanceOrder = {
  id: number
  busId: number
  busNumber: string
  kind: 'preventive' | 'corrective' | 'ramp'
  description: string
  notes: string
  openedBy: string
  openedAt: string
  closedBy: string | null
  closedAt: string | null
  // Campos de la orden de servicio (Solicitud y autorización del servicio).
  km: number | null
  partida: string
  recurso: string
  execution: string
  items: ServiceItem[]
}

// Un formato del DIF tal como lo dibuja el panel: la misma cuadrícula que en Excel.
export type FormKind = 'bitacora' | 'orden' | 'vehiculo'
export type FormCell = { ref: string; r: number; c: number; v?: string; cs?: number; rs?: number; s: number; f?: boolean; a?: string }
export type FormStyle = {
  b?: boolean; i?: boolean; u?: boolean; sz?: number; ff?: string; c?: string; bg?: string
  ha?: string; va?: string; wr?: boolean; bd: [number, number, number, number]
}
export type FormPicture = { r: number; c: number; dx: number; dy: number; w: number; h: number; src: string; crop?: [number, number, number, number] }
export type FormSheet = { name: string; cols: number[]; rows: number[]; cells: FormCell[]; styles: FormStyle[]; pictures: FormPicture[] }
export type FormValues = Record<string, Record<string, string>>
export type FormView = { kind: FormKind; ref: string; title: string; sheets: FormSheet[]; edited: FormValues }

export type ServiceItem = { description: string; unit: string; quantity: string }

export type VehicleReport = {
  id: number
  busId: number
  busNumber: string
  day: string
  observations: string
  createdBy: string | null
  createdAt: string
}

export type AuditEntry = { id: number; at: string; actor: string; action: string }

// Una tarjeta del tablero de incidencias (reporte o incidente unificados).
export type Card = {
  id: string // 'r123' | 'i123'
  isIncident: boolean
  folio: string
  title: string
  who: string
  at: string
  detail: string
  column: 'nuevo' | 'revision' | 'cerrado'
  resolution?: string
  severity: 'menor' | 'emergencia'
}

// Estadísticas de pasajeros (GET /api/v1/admin/estadisticas): lo que cuentan los choferes al iniciar cada vuelta.
export type Counts = {
  hombres: number; mujeres: number; total: number
  discapacidad: number; adultosMayores: number; embarazadas: number; acompanantes: number
}
export type Stats = {
  desde: string; hasta: string
  vueltas: number; vueltasConConteo: number
  usuarios: Counts
  rutas: { id: string; nombre: string; color: string; vueltas: number; usuarios: Counts }[]
  dias: { dia: string; vueltas: number; usuarios: Counts }[]
  horas: { hora: number; vueltas: number; usuarios: number }[]
  semana: { dia: string; vueltas: number; usuarios: Counts }[]
  choferes: { nombre: string; vueltas: number; usuarios: number }[]
  incidentes: Record<string, number>
}
