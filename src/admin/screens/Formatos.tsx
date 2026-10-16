import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../adminApi'
import { errMsg, useToast } from '../ctx'
import { FormSheet } from '../FormSheet'
import { Button, Field, Input, Section, Select, fmtDate, useAsync } from '../ui'
import type { FormKind, FormValues, FormView, Role } from '../types'

// Los formatos del DIF, iguales a sus archivos de Excel: el sistema los llena solo y cualquier celda
// se puede corregir o completar aquí. "Descargar Excel" da el mismo archivo con lo que se ve.

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const TABS: { kind: FormKind; label: string; roles: Role[] }[] = [
  { kind: 'bitacora', label: 'Bitácora semanal', roles: ['superadmin', 'dispatcher'] },
  { kind: 'orden', label: 'Órdenes de servicio', roles: ['superadmin', 'mechanic'] },
  { kind: 'vehiculo', label: 'Reportes de vehículo', roles: ['superadmin', 'dispatcher', 'mechanic'] },
]

// Nombres de las hojas como las reconoce el departamento.
const SHEET_LABEL: Record<string, string> = {
  'HUGO CAS': '3 CAS', 'FERNANDO CAS': '1 CAS', 'JORGE CAS 2': '2 CAS',
  Hoja1: 'Rutas Durango', Hoja2: 'Rutas 1 y 2 (categorías)', Hoja3: 'Usuarios por categoría', Hoja4: 'Reporte de vehículo',
}

export function Formatos({ role }: { role: Role }) {
  const tabs = TABS.filter((t) => t.roles.includes(role))
  const [kind, setKind] = useState<FormKind>(tabs[0].kind)
  const [week, setWeek] = useState(localDay())
  const [orderId, setOrderId] = useState('')
  const [reportId, setReportId] = useState('')

  const orders = useAsync(() => (kind === 'orden' ? adminApi.maintenance() : Promise.resolve([])), [kind])
  const reports = useAsync(() => (kind === 'vehiculo' ? adminApi.vehicleReports() : Promise.resolve([])), [kind])
  const buses = useAsync(() => (kind === 'vehiculo' ? adminApi.buses() : Promise.resolve([])), [kind])
  const toast = useToast()

  useEffect(() => {
    if (!orderId && orders.data?.length) setOrderId(String(orders.data[0].id))
  }, [orders.data, orderId])
  useEffect(() => {
    if (!reportId && reports.data?.length) setReportId(String(reports.data[0].id))
  }, [reports.data, reportId])

  async function newReport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    try {
      const v = await adminApi.createVehicleReport({ busId: Number(fd.get('busId')), day: String(fd.get('day')), observations: '' })
      await reports.reload()
      setReportId(String(v.id))
      toast('Reporte creado: llénalo abajo')
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  const ref = kind === 'bitacora' ? week : kind === 'orden' ? orderId : reportId

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.kind}
            onClick={() => setKind(t.kind)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${kind === t.kind ? 'bg-sky-500/15 text-sky-700' : 'bg-slate-500/5 text-slate-600 hover:bg-slate-500/10'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Section
        title={TABS.find((t) => t.kind === kind)!.label}
        subtitle={
          kind === 'bitacora'
            ? 'El libro completo de bitácoras (las 7 hojas), lleno con los viajes, choferes y usuarios de la semana.'
            : kind === 'orden'
              ? 'La Solicitud y autorización del servicio de cada orden de mantenimiento.'
              : 'El Reporte de vehículo de una unidad en una fecha.'
        }
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {kind === 'bitacora' && (
              <Field label="Semana del día"><Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} className="w-auto" /></Field>
            )}
            {kind === 'orden' && (
              <Field label="Orden">
                <Select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="w-auto">
                  {orders.data?.length === 0 && <option value="">Sin órdenes: créalas en Mantenimiento</option>}
                  {orders.data?.map((o) => (
                    <option key={o.id} value={o.id}>Unidad {o.busNumber} · {fmtDate(o.openedAt)} · {o.description.slice(0, 40)}</option>
                  ))}
                </Select>
              </Field>
            )}
            {kind === 'vehiculo' && (
              <Field label="Reporte">
                <Select value={reportId} onChange={(e) => setReportId(e.target.value)} className="w-auto">
                  {reports.data?.length === 0 && <option value="">Sin reportes: crea uno</option>}
                  {reports.data?.map((v) => <option key={v.id} value={v.id}>Unidad {v.busNumber} · {fmtDate(v.day)}</option>)}
                </Select>
              </Field>
            )}
          </div>
        }
      >
        {kind === 'vehiculo' && (
          <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={newReport}>
            <Field label="Nuevo reporte: unidad">
              <Select name="busId" required defaultValue="" className="w-auto">
                <option value="" disabled>Elige unidad</option>
                {buses.data?.filter((b) => b.status !== 'retired').map((b) => <option key={b.id} value={b.id}>Unidad {b.number}</option>)}
              </Select>
            </Field>
            <Field label="Fecha"><Input type="date" name="day" defaultValue={localDay()} required className="w-auto" /></Field>
            <Button variant="blue" type="submit">Crear reporte</Button>
          </form>
        )}
        {ref ? <FormEditor key={`${kind}/${ref}`} kind={kind} refId={ref} /> : (
          <p className="py-8 text-center text-sm text-slate-400">Nada que mostrar todavía.</p>
        )}
      </Section>
    </div>
  )
}

function FormEditor({ kind, refId }: { kind: FormKind; refId: string }) {
  const toast = useToast()
  const [view, setView] = useState<FormView | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<FormValues>({})
  const [sheetIdx, setSheetIdx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    adminApi.form(kind, refId)
      .then((v) => { if (alive) { setView(v); setDraft({}) } })
      .catch((e) => alive && setError(errMsg(e)))
    return () => { alive = false }
  }, [kind, refId])

  const sheet = view?.sheets[sheetIdx]
  const dirty = Object.values(draft).some((cells) => Object.keys(cells).length > 0)

  // Lo que se ve en cada celda: lo que se está escribiendo, o lo guardado/automático del servidor.
  const values = useMemo(() => {
    if (!sheet) return {}
    const out: Record<string, string> = {}
    for (const c of sheet.cells) if (c.f) out[c.ref] = c.v ?? ''
    return { ...out, ...(draft[sheet.name] ?? {}) }
  }, [sheet, draft])

  // Escrito a mano = guardado como edición, o cambiado ahora respecto a lo automático.
  const edited = useMemo(() => {
    if (!sheet || !view) return {}
    const out: Record<string, string> = { ...(view.edited[sheet.name] ?? {}) }
    for (const c of sheet.cells) {
      if (!c.f) continue
      const now = draft[sheet.name]?.[c.ref]
      if (now === undefined) continue
      if (now.trim() === (c.a ?? '').trim()) delete out[c.ref]
      else out[c.ref] = now
    }
    return out
  }, [sheet, view, draft])

  function change(ref: string, value: string) {
    if (!sheet) return
    setDraft((d) => ({ ...d, [sheet.name]: { ...(d[sheet.name] ?? {}), [ref]: value } }))
  }

  // Todo lo escrito a mano: lo guardado antes más lo nuevo (lo que vuelve al valor del sistema se descarta en el servidor).
  function allValues(): FormValues {
    const out: FormValues = JSON.parse(JSON.stringify(view?.edited ?? {}))
    for (const [sh, cells] of Object.entries(draft)) out[sh] = { ...(out[sh] ?? {}), ...cells }
    return out
  }

  async function save(): Promise<boolean> {
    setBusy(true)
    try {
      const v = await adminApi.saveForm(kind, refId, allValues())
      setView(v)
      setDraft({})
      toast('Formato guardado')
      return true
    } catch (e) {
      toast(errMsg(e), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }
  async function download() {
    if (dirty && !(await save())) return
    setBusy(true)
    try {
      await adminApi.downloadForm(kind, refId)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  async function resetSheet() {
    if (!view || !sheet) return
    if (!confirm(`¿Regresar la hoja "${SHEET_LABEL[sheet.name] ?? sheet.name}" a lo que llena el sistema? Se borra lo escrito a mano en ella.`)) return
    const values = allValues()
    delete values[sheet.name]
    setBusy(true)
    try {
      setView(await adminApi.saveForm(kind, refId, values))
      setDraft({})
      toast('Hoja restablecida')
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="text-sm text-rose-500">{error}</p>
  if (!view || !sheet) return <p className="py-8 text-center text-sm text-slate-400">Cargando formato…</p>

  const editedCount = Object.keys(edited).length
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto text-slate-700">{view.title}</strong>
        <Button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label="Alejar">−</Button>
        <span className="w-12 text-center text-sm tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
        <Button onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="Acercar">+</Button>
        <Button onClick={resetSheet} disabled={busy}>Restablecer hoja</Button>
        <Button variant="blue" onClick={save} disabled={busy || !dirty}>{dirty ? 'Guardar cambios' : 'Guardado'}</Button>
        <Button variant="green" onClick={download} disabled={busy}>Descargar Excel</Button>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: 'rgb(14 165 233 / 0.25)' }} />Lo llenó el sistema</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: 'rgb(250 204 21 / 0.5)' }} />Escrito a mano ({editedCount} en esta hoja)</span>
        <span>Haz clic en cualquier casilla para escribir. Lo que ves es lo que sale en el Excel.</span>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-300/60 bg-slate-100 p-3" style={{ maxHeight: '70vh' }}>
        <FormSheet sheet={sheet} values={values} edited={edited} onChange={change} zoom={zoom} />
      </div>

      {view.sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 border-t border-slate-300/50 pt-2" role="tablist" aria-label="Hojas del libro">
          {view.sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              aria-selected={i === sheetIdx}
              onClick={() => setSheetIdx(i)}
              className={`rounded-b-lg border px-3 py-1.5 text-sm ${i === sheetIdx ? 'border-sky-400 bg-white font-semibold text-sky-700' : 'border-slate-300/60 text-slate-600 hover:bg-slate-500/5'}`}
            >
              {SHEET_LABEL[s.name] ?? s.name}
              {Object.keys(draft[s.name] ?? {}).length > 0 && ' •'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
