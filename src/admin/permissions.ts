import type { Role } from './types'

export type Screen = 'monitoreo' | 'formatos' | 'estadisticas' | 'turnos' | 'mantenimiento' | 'incidencias' | 'rutas' | 'pasajeros' | 'cuentas'

// Qué puede ver cada rol. "flotilla" (alta de unidades) vive dentro de Turnos; el mecánico solo ve esa parte.
export const PERMS: Record<Role, { screens: Screen[]; flotilla: boolean; turnos: boolean }> = {
  superadmin: { screens: ['monitoreo', 'formatos', 'estadisticas', 'turnos', 'mantenimiento', 'incidencias', 'rutas', 'pasajeros', 'cuentas'], flotilla: true, turnos: true },
  dispatcher: { screens: ['monitoreo', 'formatos', 'estadisticas', 'turnos'], flotilla: false, turnos: true },
  mechanic: { screens: ['formatos', 'turnos', 'mantenimiento'], flotilla: true, turnos: false },
}

export const NAV: { screen: Screen; label: string; icon: string }[] = [
  { screen: 'monitoreo', label: 'Ojo de Dios', icon: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' },
  { screen: 'formatos', label: 'Formatos DIF', icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h8M8 9h2' },
  { screen: 'estadisticas', label: 'Estadísticas', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { screen: 'turnos', label: 'Turnos y Flotilla', icon: 'M5 16V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M5 11h14M5 16h14v3H5z' },
  { screen: 'mantenimiento', label: 'Mantenimiento', icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z' },
  { screen: 'incidencias', label: 'Incidencias', icon: 'M12 9v4m0 4h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' },
  { screen: 'rutas', label: 'Rutas', icon: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14' },
  { screen: 'pasajeros', label: 'Pasajeros', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z' },
  { screen: 'cuentas', label: 'Cuentas', icon: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m17 0v-1a4 4 0 0 0-3-3.9M14 3.1a4 4 0 0 1 0 7.8M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' },
]
