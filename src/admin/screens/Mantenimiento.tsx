import { useMemo, useState } from 'react'
import { adminApi } from '../adminApi'
import { errMsg, useToast } from '../ctx'
import { Button, Field, Input, Kpi, Modal, Section, Select, Table, fmtDate, fmtDateTime, useAsync } from '../ui'
import type { MaintenanceOrder, ServiceItem } from '../types'

const KIND: Record<string, string> = { preventive: 'Preventivo', corrective: 'Correctivo', ramp: 'Rampa' }
const STALE_DAYS = 90
const today = () => new Date().toISOString().slice(0, 10)
// Fecha local (no UTC), para el reporte de vehículo.
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// La orden de servicio impresa tiene cuatro renglones de conceptos.
const MAX_ITEMS = 4
const EXECUTIONS = ['MANTENIMIENTO PROVEEDOR', 'MANTENIMIENTO INTERNO']
const emptyItem = (): ServiceItem => ({ description: '', unit: '', quantity: '' })

export function Mantenimiento() {
  const toast = useToast()
  const buses = useAsync(() => adminApi.buses(), [])
  const orders = useAsync(() => adminApi.maintenance(), [])
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [editing, setEditing] = useState<MaintenanceOrder | null>(null)
  const reports = useAsync(() => adminApi.vehicleReports(), [])

  async function download(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }
  async function createReport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const fd = new FormData(f)
    try {
      const v = await adminApi.createVehicleReport({
        busId: Number(fd.get('busId')), day: String(fd.get('day')), observations: String(fd.get('observations')),
      })
      toast('Reporte de vehículo guardado')
      f.reset()
      reports.reload()
      await adminApi.downloadVehicleReport(v.id)
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  const open = useMemo(() => (orders.data ?? []).filter((o) => !o.closedAt), [orders.data])
  const closed = useMemo(() => (orders.data ?? []).filter((o) => o.closedAt), [orders.data])
  const kpis = useMemo(() => {
    const b = (buses.data ?? []).filter((x) => x.status !== 'retired')
    const stale = b.filter((x) => !x.lastMaintenance || Date.parse(x.lastMaintenance) < Date.now() - STALE_DAYS * 86400000).length
    const closed30 = (orders.data ?? []).filter((o) => o.closedAt && Date.parse(o.closedAt) > Date.now() - 30 * 86400000).length
    return {
      workshop: b.filter((x) => x.status === 'workshop').length,
      ramp: b.filter((x) => x.status === 'ramp_broken').length,
      total: b.length,
      stale,
      closed30,
    }
  }, [buses.data, orders.data])

  async function openOrder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const fd = new FormData(f)
    try {
      const km = String(fd.get('km') ?? '').trim()
      await adminApi.openMaintenance({
        busId: Number(fd.get('busId')),
        kind: String(fd.get('kind')),
        description: String(fd.get('description')),
        km: km === '' ? null : Number(km),
        partida: String(fd.get('partida') ?? ''),
        recurso: String(fd.get('recurso') ?? ''),
        execution: String(fd.get('execution') ?? EXECUTIONS[0]),
      })
      toast('Unidad enviada al taller')
      f.reset()
      orders.reload()
      buses.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }
  async function saveNotes(id: number) {
    try {
      await adminApi.patchMaintenance(id, { notes: notes[id] ?? '' })
      toast('Notas guardadas')
      orders.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }
  async function release(id: number) {
    try {
      await adminApi.patchMaintenance(id, { notes: notes[id] ?? '', close: true, date: today() })
      toast('Unidad liberada: vuelve al servicio')
      orders.reload()
      buses.reload()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="En el taller" value={kpis.workshop} sub={`/${kpis.total}`} tone="amber" />
        <Kpi label="Rampa dañada en servicio" value={kpis.ramp} tone={kpis.ramp ? 'red' : 'green'} />
        <Kpi label={`Servicio vencido (+${STALE_DAYS} d)`} value={kpis.stale} tone={kpis.stale ? 'amber' : 'green'} />
        <Kpi label="Órdenes cerradas (30 d)" value={kpis.closed30} tone="blue" />
      </div>

      <Section title="Mandar al taller">
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={openOrder}>
          <Field label="Unidad">
            <Select name="busId" required defaultValue="">
              <option value="" disabled>Elige unidad</option>
              {buses.data?.filter((b) => b.status !== 'workshop' && b.status !== 'retired').map((b) => <option key={b.id} value={b.id}>Unidad {b.number}</option>)}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select name="kind" defaultValue="corrective">
              {Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Qué se le va a hacer"><Input name="description" maxLength={500} placeholder="La rampa no despliega" required /></Field>
          <Field label="Kilometraje"><Input name="km" type="number" min={0} max={9999999} placeholder="154320" /></Field>
          <Field label="Partida"><Input name="partida" maxLength={60} /></Field>
          <Field label="Recurso"><Input name="recurso" maxLength={60} /></Field>
          <Field label="Ejecución">
            <Select name="execution" defaultValue={EXECUTIONS[0]}>
              {EXECUTIONS.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          <div className="flex items-end sm:col-span-4"><Button variant="blue" type="submit">Mandar al taller</Button></div>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          Con estos datos se llena la Solicitud y autorización del servicio; los conceptos se completan en la orden.
        </p>
      </Section>

      <Section title="En el taller" subtitle={`${open.length} unidad(es)`}>
        {open.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Ninguna unidad en el taller.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {open.map((o) => (
              <div key={o.id} className="rounded-xl border border-slate-300/50 bg-[var(--bg-sunk)] p-4">
                <div className="flex items-center justify-between">
                  <strong>Unidad {o.busNumber}</strong>
                  <span className="text-xs text-slate-500">{KIND[o.kind]} · entró {fmtDateTime(o.openedAt)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{o.description}</p>
                <textarea
                  className="mt-3 w-full rounded-lg border border-slate-300/50 bg-[var(--bg-sunk)] px-3 py-2 text-sm outline-none focus:border-sky-400/70"
                  rows={2}
                  placeholder="Qué se encontró, refacciones, pendientes…"
                  value={notes[o.id] ?? o.notes}
                  onChange={(e) => setNotes((n) => ({ ...n, [o.id]: e.target.value }))}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Orden de servicio: {o.items.length} concepto(s){o.km != null ? ` · ${o.km.toLocaleString('es-MX')} km` : ''}
                  {o.partida ? ` · partida ${o.partida}` : ''}{o.recurso ? ` · recurso ${o.recurso}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button onClick={() => saveNotes(o.id)}>Guardar notas</Button>
                  <Button onClick={() => setEditing(o)}>Editar orden de servicio</Button>
                  <Button onClick={() => download(() => adminApi.downloadOrden(o.id))}>Orden de servicio (Excel)</Button>
                  <Button variant="green" onClick={() => release(o.id)}>Liberar unidad</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Historial" subtitle={`${closed.length} orden(es) cerradas`}>
        <Table head={['Unidad', 'Tipo', 'Trabajo', 'Entró', 'Liberó', 'Cerró', '']}>
          {closed.map((o) => (
            <tr key={o.id}>
              <td className="px-3 py-2 font-medium">{o.busNumber}</td>
              <td className="px-3 py-2">{KIND[o.kind]}</td>
              <td className="px-3 py-2 text-slate-600">{o.description}</td>
              <td className="px-3 py-2 text-slate-500">{fmtDate(o.openedAt)}</td>
              <td className="px-3 py-2 text-slate-500">{fmtDate(o.closedAt)}</td>
              <td className="px-3 py-2 text-slate-500">{o.closedBy ?? '—'}</td>
              <td className="px-3 py-2 text-right">
                <Button className="px-2 py-1" onClick={() => download(() => adminApi.downloadOrden(o.id))}>Orden (Excel)</Button>
              </td>
            </tr>
          ))}
          {closed.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Sin órdenes cerradas.</td></tr>}
        </Table>
      </Section>

      <Section title="Reporte de vehículo" subtitle="Se guarda y se descarga en el formato del DIF.">
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={createReport}>
          <Field label="Unidad">
            <Select name="busId" required defaultValue="">
              <option value="" disabled>Elige unidad</option>
              {buses.data?.filter((b) => b.status !== 'retired').map((b) => <option key={b.id} value={b.id}>Unidad {b.number}</option>)}
            </Select>
          </Field>
          <Field label="Fecha"><Input type="date" name="day" defaultValue={localToday()} required /></Field>
          <div className="sm:col-span-2">
            <Field label="Observaciones">
              <textarea
                name="observations"
                required
                maxLength={2000}
                rows={3}
                className="neu-inset w-full px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Estado de la unidad, fallas, golpes, niveles…"
              />
            </Field>
          </div>
          <div className="sm:col-span-4"><Button variant="blue" type="submit">Guardar y descargar</Button></div>
        </form>
        <div className="mt-5">
          <Table head={['Fecha', 'Unidad', 'Observaciones', 'Levantó', '']}>
            {reports.data?.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2 text-slate-500">{fmtDate(v.day)}</td>
                <td className="px-3 py-2 font-medium">{v.busNumber}</td>
                <td className="max-w-md truncate px-3 py-2 text-slate-600" title={v.observations}>{v.observations}</td>
                <td className="px-3 py-2 text-slate-500">{v.createdBy ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <Button className="px-2 py-1" onClick={() => download(() => adminApi.downloadVehicleReport(v.id))}>Excel</Button>
                </td>
              </tr>
            ))}
            {reports.data?.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Sin reportes de vehículo.</td></tr>}
          </Table>
        </div>
      </Section>

      {editing && (
        <OrderEditor
          order={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); orders.reload() }}
        />
      )}
    </div>
  )
}

// Edita los datos de la Solicitud y autorización del servicio de una orden abierta.
function OrderEditor({ order, onClose, onSaved }: { order: MaintenanceOrder; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [km, setKm] = useState(order.km == null ? '' : String(order.km))
  const [partida, setPartida] = useState(order.partida)
  const [recurso, setRecurso] = useState(order.recurso)
  const [execution, setExecution] = useState(order.execution || EXECUTIONS[0])
  const [items, setItems] = useState<ServiceItem[]>(order.items.length ? order.items : [emptyItem()])
  const setItem = (i: number, patch: Partial<ServiceItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function save() {
    try {
      await adminApi.patchMaintenance(order.id, {
        km: km.trim() === '' ? null : Number(km), partida, recurso, execution,
        items: items.filter((x) => x.description.trim() || x.unit.trim() || x.quantity.trim()),
      })
      toast('Orden de servicio guardada')
      onSaved()
    } catch (err) {
      toast(errMsg(err), 'error')
    }
  }

  return (
    <Modal title={`Orden de servicio · Unidad ${order.busNumber}`} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kilometraje"><Input type="number" min={0} value={km} onChange={(e) => setKm(e.target.value)} /></Field>
        <Field label="Ejecución">
          <Select value={execution} onChange={(e) => setExecution(e.target.value)}>
            {[...new Set([execution, ...EXECUTIONS])].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Partida"><Input maxLength={60} value={partida} onChange={(e) => setPartida(e.target.value)} /></Field>
        <Field label="Recurso"><Input maxLength={60} value={recurso} onChange={(e) => setRecurso(e.target.value)} /></Field>
      </div>
      <p className="mt-4 mb-2 text-sm font-medium text-slate-600">Descripción de la solicitud</p>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_5rem_auto] gap-2">
            <Input placeholder="Descripción" maxLength={200} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
            <Input placeholder="Unidad" maxLength={20} value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} />
            <Input placeholder="Cant." maxLength={20} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} />
            <Button variant="ghost" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} aria-label="Quitar concepto">✕</Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length < MAX_ITEMS && <Button onClick={() => setItems((xs) => [...xs, emptyItem()])}>Agregar concepto</Button>}
        <Button variant="blue" onClick={save}>Guardar</Button>
      </div>
    </Modal>
  )
}
