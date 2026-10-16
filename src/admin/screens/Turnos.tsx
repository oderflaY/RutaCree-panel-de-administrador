import { useMemo, useState } from 'react'
import { adminApi } from '../adminApi'
import { useMunicipio } from '../../municipio'
import { errMsg, useToast } from '../ctx'
import { Badge, Button, Field, Input, Section, Select, Table, fmtDate, useAsync } from '../ui'
import type { BusStatus, Trip } from '../types'

const STATUS: Record<BusStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  active: { label: 'Activo', tone: 'green' },
  workshop: { label: 'En taller', tone: 'amber' },
  ramp_broken: { label: 'Rampa dañada', tone: 'red' },
  retired: { label: 'Baja', tone: 'gray' },
}
// "Unidad 25-3369 (camión 3)": el No. de camión es como lo conocen los choferes.
const busLabel = (b: { number: string; unitNo: string }) => `Unidad ${b.number}${b.unitNo ? ` (camión ${b.unitNo})` : ''}`
const today = () => new Date().toISOString().slice(0, 10)

// Fecha local (no UTC): una ruta de las 7 de la noche en Durango sigue siendo de "hoy".
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
function duration(t: Trip) {
  if (!t.endedAt) return '—'
  const min = Math.round((Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}
const END: Record<NonNullable<Trip['endReason']>, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  completed: { label: 'Terminada', tone: 'green' },
  emergency: { label: 'Falla / accidente', tone: 'red' },
  expired: { label: 'Sin cerrar (vencida)', tone: 'amber' },
  replaced: { label: 'Reemplazada', tone: 'gray' },
  withdrawn: { label: 'Unidad al taller', tone: 'amber' },
}
const count = (n: number | null) => (n == null ? '—' : n)

// Usuarios por vuelta, en el orden de la bitácora semanal del DIF. TOTAL = hombres + mujeres.
const USERS = [
  { key: 'men', label: 'Hombres' },
  { key: 'women', label: 'Mujeres' },
  { key: 'disability', label: 'Discap.' },
  { key: 'elderly', label: 'Adultos may.' },
  { key: 'pregnant', label: 'Embaraz.' },
  { key: 'companions', label: 'Acomp.' },
] as const
type UserKey = (typeof USERS)[number]['key']
const tripTotal = (t: Trip) => (t.men == null && t.women == null ? null : (t.men ?? 0) + (t.women ?? 0))

export function Turnos({ showTurnos, showFlotilla }: { showTurnos: boolean; showFlotilla: boolean }) {
  const toast = useToast()
  const buses = useAsync(() => adminApi.buses(), [])
  const [showRetired, setShowRetired] = useState(false)
  const [importing, setImporting] = useState(false)
  const inFleet = buses.data?.filter((b) => b.status !== 'retired') ?? []
  const retiredCount = (buses.data?.length ?? 0) - inFleet.length
  const centros = [...new Set(inFleet.map((b) => b.centro).filter(Boolean))]
  const drivers = useAsync(() => (showTurnos ? adminApi.drivers() : Promise.resolve([])), [showTurnos])
  // Rutas, turnos y vueltas solo del municipio elegido en la barra lateral.
  const { visibleRoutes, servesRoute } = useMunicipio()
  const routes = { data: showTurnos ? visibleRoutes : [] }
  const assignments = useAsync(() => (showTurnos ? adminApi.assignments() : Promise.resolve([])), [showTurnos])

  const [date, setDate] = useState(today())
  const [tripDate, setTripDate] = useState(localToday())
  const allTrips = useAsync(() => {
    if (!showTurnos) return Promise.resolve([] as Trip[])
    const from = new Date(`${tripDate}T00:00:00`)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    return adminApi.trips(from, to)
  }, [showTurnos, tripDate])
  const trips = { data: allTrips.data?.filter((t) => servesRoute(t.routeId)), error: allTrips.error }
  const totals = useMemo(() => {
    const acc = Object.fromEntries(USERS.map((u) => [u.key, 0])) as Record<UserKey, number>
    for (const t of trips.data ?? []) for (const u of USERS) acc[u.key] += t[u.key] ?? 0
    return acc
  }, [trips.data])
  const [downloading, setDownloading] = useState(false)
  async function downloadWeek() {
    setDownloading(true)
    try {
      await adminApi.downloadBitacora(tripDate)
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setDownloading(false)
    }
  }

  const dayList = useMemo(
    () => (assignments.data ?? []).filter((a) => a.date === date && servesRoute(a.routeId)),
    [assignments.data, date, servesRoute],
  )
  const busByNum = (id: number) => buses.data?.find((b) => b.id === id)?.number ?? id
  const driverName = (id: string) => drivers.data?.find((d) => d.id === id)?.name ?? id

  async function createShift(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const fd = new FormData(f)
    try {
      await adminApi.createAssignment({
        date: String(fd.get('date')),
        driverId: String(fd.get('driverId')),
        busId: Number(fd.get('busId')),
        routeId: String(fd.get('routeId')),
      })
      toast('Turno generado')
      assignments.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }
  async function del(id: number) {
    try {
      await adminApi.deleteAssignment(id)
      assignments.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  async function createBus(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const fd = new FormData(f)
    try {
      await adminApi.createBus({
        number: String(fd.get('number')).toUpperCase(),
        plates: String(fd.get('plates')),
        brand: String(fd.get('brand')),
        model: String(fd.get('model')),
        unitNo: String(fd.get('unitNo') ?? ''),
        centro: String(fd.get('centro') ?? ''),
        ...(fd.get('year') ? { year: Number(fd.get('year')) } : {}),
      })
      toast('Unidad dada de alta')
      f.reset()
      buses.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }
  async function importFleet(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file) return
    const retire = window.confirm(
      '¿Dar de baja las unidades que NO vienen en este Excel?\n\nAceptar: el Excel queda como el parque completo (las demás pasan a "Baja", con su historial).\nCancelar: solo agrega y actualiza las del Excel.',
    )
    setImporting(true)
    try {
      const r = await adminApi.importBuses(file, retire)
      const n = (x: string[] | null) => x?.length ?? 0
      toast(`Parque vehicular: ${n(r.created)} nuevas, ${n(r.updated)} actualizadas${retire ? `, ${n(r.retired)} dadas de baja` : ''}`)
      buses.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setImporting(false)
    }
  }
  async function patchBus(id: number, body: Parameters<typeof adminApi.patchBus>[1]) {
    try {
      await adminApi.patchBus(id, body)
      buses.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {showTurnos && (
        <Section title="Asignar turno" subtitle="Chofer, unidad y ruta para una fecha.">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={createShift}>
            <Field label="Fecha"><Input type="date" name="date" defaultValue={date} required /></Field>
            <Field label="Ruta">
              <Select name="routeId" required defaultValue="">
                <option value="" disabled>Elige ruta</option>
                {routes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Chofer">
              <Select name="driverId" required defaultValue="">
                <option value="" disabled>Elige chofer</option>
                {drivers.data?.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
              </Select>
            </Field>
            <Field label="Unidad">
              <Select name="busId" required defaultValue="">
                <option value="" disabled>Elige unidad</option>
                {buses.data?.filter((b) => b.status === 'active').map((b) => <option key={b.id} value={b.id}>{busLabel(b)}{b.centro && b.centro !== 'CREE DURANGO' ? ` · ${b.centro}` : ''}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2"><Button variant="blue" type="submit">Generar turno</Button></div>
          </form>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-600">
              <span>Turnos del</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
            </div>
            {dayList.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Sin turnos para esta fecha.</p>
            ) : (
              <Table head={['Chofer', 'Unidad', 'Ruta', '']}>
                {dayList.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2">{driverName(a.driverId)}</td>
                    <td className="px-3 py-2">Unidad {busByNum(a.busId)}</td>
                    <td className="px-3 py-2 text-slate-500">{a.routeId}</td>
                    <td className="px-3 py-2 text-right"><Button variant="red" className="px-2 py-1" onClick={() => del(a.id)}>Cancelar</Button></td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </Section>
      )}

      {showTurnos && (
        <div className="xl:col-span-2">
          <Section
            title="Bitácora de viajes"
            subtitle="Salida y llegada de cada vuelta, y los usuarios que el chofer registró al iniciarla."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} className="w-auto" />
                <Button variant="green" onClick={downloadWeek} disabled={downloading}>
                  {downloading ? 'Generando…' : 'Bitácora semanal (Excel)'}
                </Button>
                <Button onClick={() => { location.hash = 'formatos' }}>Ver y llenar en Formatos</Button>
              </div>
            }
          >
            {trips.error && <p className="text-sm text-rose-500">{trips.error}</p>}
            {trips.data?.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Ninguna ruta iniciada en esta fecha.</p>
            ) : (
              <Table head={['Chofer', 'Unidad', 'Ruta', 'Salida', 'Llegada', 'Duración', ...USERS.map((u) => u.label), 'Total', 'Estado']}>
                {trips.data?.map((t) => (
                  <tr key={t.shiftId}>
                    <td className="px-3 py-2">{t.driverName}</td>
                    <td className="px-3 py-2">Unidad {t.busNumber}</td>
                    <td className="px-3 py-2 text-slate-500">{t.routeId}</td>
                    <td className="px-3 py-2 tabular-nums">{hhmm(t.startedAt)}</td>
                    <td className="px-3 py-2 tabular-nums">{t.endedAt ? hhmm(t.endedAt) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{duration(t)}</td>
                    {USERS.map((u) => <td key={u.key} className="px-3 py-2 tabular-nums">{count(t[u.key])}</td>)}
                    <td className="px-3 py-2 tabular-nums font-medium">{count(tripTotal(t))}</td>
                    <td className="px-3 py-2">
                      {t.endReason ? <Badge tone={END[t.endReason].tone}>{END[t.endReason].label}</Badge> : <Badge tone="blue">En ruta</Badge>}
                    </td>
                  </tr>
                ))}
                {(trips.data?.length ?? 0) > 1 && (
                  <tr className="font-semibold">
                    <td className="px-3 py-2" colSpan={6}>Total del día ({trips.data!.length} vueltas)</td>
                    {USERS.map((u) => <td key={u.key} className="px-3 py-2 tabular-nums">{totals[u.key]}</td>)}
                    <td className="px-3 py-2 tabular-nums">{totals.men + totals.women}</td>
                    <td />
                  </tr>
                )}
              </Table>
            )}
          </Section>
        </div>
      )}

      {showFlotilla && (
        <div className="xl:col-span-2">
        <Section
          title="Flotilla"
          subtitle={`${inFleet.length} unidades en el parque vehicular${retiredCount ? `, ${retiredCount} ${retiredCount === 1 ? 'dada' : 'dadas'} de baja` : ''}.`}
          actions={
            <label className={`neu-btn inline-flex cursor-pointer items-center px-3.5 py-1.5 text-sm text-sky-600 ${importing ? 'opacity-50' : ''}`}>
              {importing ? 'Importando…' : 'Importar Excel del parque'}
              <input type="file" accept=".xlsx" className="hidden" disabled={importing} onChange={importFleet} />
            </label>
          }
        >
          <form className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8" onSubmit={createBus}>
            <Field label="No. económico"><Input name="number" maxLength={16} placeholder="25-3369" required /></Field>
            <Field label="No. camión"><Input name="unitNo" maxLength={8} placeholder="3" /></Field>
            <Field label="Placas"><Input name="plates" maxLength={16} placeholder="FU-8971-B" /></Field>
            <Field label="Marca"><Input name="brand" maxLength={40} placeholder="DINA" /></Field>
            <Field label="Modelo"><Input name="model" maxLength={40} placeholder="CRAFTER" /></Field>
            <Field label="Año"><Input name="year" type="number" min={1950} max={2100} placeholder="2017" /></Field>
            <Field label="Centro"><Input name="centro" maxLength={60} placeholder="CREE DURANGO" list="centros" /></Field>
            <div className="flex items-end"><Button variant="blue" type="submit" className="w-full">Dar de alta</Button></div>
            <datalist id="centros">{centros.map((c) => <option key={c} value={c} />)}</datalist>
          </form>
          <div className="mt-5">
            {buses.error && <p className="text-sm text-rose-500">{buses.error}</p>}
            <Table head={['Económico', 'Camión', 'Placas', 'Marca y modelo', 'Año', 'Serie', 'Centro', 'Últ. mant.', 'Estado']}>
              {(showRetired ? buses.data ?? [] : inFleet).map((b) => (
                <tr key={b.id} className={b.status === 'retired' ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{b.number}</td>
                  <td className="px-3 py-2"><EditCell value={b.unitNo} placeholder="—" width="w-14" onSave={(v) => patchBus(b.id, { unitNo: v })} /></td>
                  <td className="px-3 py-2"><EditCell value={b.plates} placeholder="Placas" onSave={(v) => patchBus(b.id, { plates: v })} /></td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <EditCell value={b.brand} placeholder="Marca" onSave={(v) => patchBus(b.id, { brand: v })} />
                      <EditCell value={b.model} placeholder="Modelo" onSave={(v) => patchBus(b.id, { model: v })} />
                    </div>
                  </td>
                  <td className="px-3 py-2"><EditCell value={b.year ? String(b.year) : ''} placeholder="Año" width="w-16" onSave={(v) => patchBus(b.id, { year: Number(v) || 0 })} /></td>
                  <td className="px-3 py-2"><EditCell value={b.serial} placeholder="Serie" width="w-44" onSave={(v) => patchBus(b.id, { serial: v })} /></td>
                  <td className="px-3 py-2 text-xs text-slate-500">{b.centro || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(b.lastMaintenance)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Select
                      value={b.status}
                      onChange={(e) => patchBus(b.id, { status: e.target.value as BusStatus })}
                      className="w-auto py-1"
                    >
                      {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                    </Select>
                    {' '}
                    <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
            {retiredCount > 0 && (
              <button type="button" className="mt-3 text-xs text-sky-600 hover:underline" onClick={() => setShowRetired((v) => !v)}>
                {showRetired ? 'Ocultar unidades dadas de baja' : `Ver ${retiredCount === 1 ? 'la unidad dada' : `${retiredCount} unidades dadas`} de baja`}
              </button>
            )}
          </div>
        </Section>
        </div>
      )}
    </div>
  )
}

// Celda editable: guarda al salir del campo o con Enter, solo si cambió.
function EditCell({ value, placeholder, onSave, width = 'w-28' }: { value: string; placeholder: string; onSave: (v: string) => void; width?: string }) {
  const [v, setV] = useState(value)
  const save = () => { if (v.trim() !== value) onSave(v.trim()) }
  return (
    <Input
      value={v}
      placeholder={placeholder}
      maxLength={40}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className={`${width} py-1 text-sm`}
    />
  )
}
